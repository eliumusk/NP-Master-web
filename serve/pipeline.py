from __future__ import annotations

import csv
import logging
import os
import shutil
import subprocess
import time
from pathlib import Path
from typing import Any

from .cache import features_dir_for, features_dir_size_bytes, is_features_ready
# classify_adapter is intentionally imported lazily (inside _classify) since it
# pulls numpy/pandas, which the worker venv doesn't need until classify is on.
from .client import (
    download_object,
    feature_cache_insert,
    feature_cache_lookup,
    insert_regions,
    update_job,
    upload_object,
)
from .config import Settings
from .fasta import csv_regions_to_bed, sha256_file, validate_fasta, write_faidx
from .gpu_guard import wait_for_gpu
from .parallel_extract import (
    run_parallel as _run_parallel_extract,
    run_parallel_lr as _run_parallel_lr,
    walk_fasta_to_metadata as _walk_fasta_to_metadata,
)

log = logging.getLogger(__name__)


class PipelineError(RuntimeError):
    pass


class GpuBusyTimeout(PipelineError):
    pass


class FastaMismatch(PipelineError):
    pass


def _short_stem(sha256: str) -> str:
    return sha256[:16]


def _subprocess_env(python_bin: Path) -> dict[str, str]:
    """Build the env for a subprocess that runs python_bin.

    Conda envs with PyTorch require torch/lib on LD_LIBRARY_PATH for libc10.so;
    `conda activate` would normally set this, but we invoke python directly,
    so add it explicitly."""
    env = os.environ.copy()
    env_root = python_bin.parent.parent  # .../envs/<name>
    # Find site-packages/torch/lib under the env's python.
    candidates = list(env_root.glob("lib/python*/site-packages/torch/lib"))
    if candidates:
        torch_lib = str(candidates[0])
        existing = env.get("LD_LIBRARY_PATH", "")
        env["LD_LIBRARY_PATH"] = f"{torch_lib}:{existing}" if existing else torch_lib
    return env


def _run_subprocess(cmd: list[str], cwd: Path, stage: str, python_bin: Path) -> str:
    log.info("[%s] $ %s", stage, " ".join(str(c) for c in cmd))
    t0 = time.time()
    proc = subprocess.run(
        cmd,
        cwd=str(cwd),
        capture_output=True,
        text=True,
        env=_subprocess_env(python_bin),
    )
    dt = time.time() - t0
    tail_stdout = proc.stdout[-2000:] if proc.stdout else ""
    tail_stderr = proc.stderr[-2000:] if proc.stderr else ""
    log.info("[%s] exit=%d in %.1fs", stage, proc.returncode, dt)
    if proc.returncode != 0:
        raise PipelineError(
            f"{stage} failed (exit={proc.returncode}):\n--- stderr tail ---\n{tail_stderr}"
        )
    return tail_stdout + ("\n--- stderr ---\n" + tail_stderr if tail_stderr.strip() else "")


def _torch_lib_for(python_bin: Path) -> str:
    """Resolve the torch/lib dir under the conda env containing python_bin."""
    env_root = python_bin.parent.parent
    candidates = list(env_root.glob("lib/python*/site-packages/torch/lib"))
    if not candidates:
        raise PipelineError(f"could not locate torch/lib under {env_root}")
    return str(candidates[0])


def _extract(settings: Settings, fasta_path: Path, features_dir: Path, stem: str) -> str:
    """Run parallel extract across configured hosts × gpus_per_host."""
    features_dir.mkdir(parents=True, exist_ok=True)
    hosts = [h.strip() for h in settings.extract_hosts.split(",") if h.strip()]
    gpus_per_host = settings.extract_gpus_per_host
    n_workers = len(hosts) * gpus_per_host
    log.info(
        "extract: %d workers across %s (%d gpu/host)",
        n_workers, hosts, gpus_per_host,
    )
    work_dir = features_dir / "_meta"
    t0 = time.time()
    n_parts = _run_parallel_extract(
        fasta_path=fasta_path,
        features_dir=features_dir,
        stem=stem,
        repo_root=settings.npmaster_repo_root,
        python_bin=settings.python_bin,
        torch_lib=_torch_lib_for(settings.python_bin),
        window=settings.extract_window,
        stride=settings.extract_stride,
        hosts=hosts,
        gpus_per_host=gpus_per_host,
        work_dir=work_dir,
    )
    dt = time.time() - t0
    log.info("[extract] done: %d parts in %.1fs (parallel, %d workers)", n_parts, dt, n_workers)
    return f"parallel extract: {n_parts} parts, {n_workers} workers, {dt:.1f}s"


def _infer(settings: Settings, features_dir: Path, probs_dir: Path, stem: str) -> str:
    probs_dir.mkdir(parents=True, exist_ok=True)
    cmd = [
        str(settings.python_bin),
        "scripts/inference/evo2_per_token/infer_shards.py",
        "--features-dir", str(features_dir),
        "--ckpt", str(settings.model_unet_ckpt),
        "--out-dir", str(probs_dir),
        "--stems", stem,
    ]
    return _run_subprocess(cmd, settings.npmaster_repo_root, stage="infer", python_bin=settings.python_bin)


def _decode(settings: Settings, probs_dir: Path, csv_out: Path,
            threshold: float, min_len_bp: int) -> str:
    csv_out.parent.mkdir(parents=True, exist_ok=True)
    cmd = [
        str(settings.python_bin),
        "scripts/decode/evo2_per_token_regions.py",
        "--probs-dir", str(probs_dir),
        "--out-regions-csv", str(csv_out),
        "--threshold", str(threshold),
        "--min-len-bp", str(min_len_bp),
        "--upsample-k", str(settings.upsample_k),
    ]
    return _run_subprocess(cmd, settings.npmaster_repo_root, stage="decode", python_bin=settings.python_bin)


def _classify(settings: Settings, regions_csv: Path, emb_dir: Path,
              typed_csv_out: Path) -> str:
    """Run per-region 7-class LR classifier and write a typed CSV."""
    typed_csv_out.parent.mkdir(parents=True, exist_ok=True)
    cmd = [
        str(settings.python_bin),
        "scripts/classify/evo2_lr_regions.py",
        "--regions-csv", str(regions_csv),
        "--emb-dir", str(emb_dir),
        "--type-lr-dir", str(settings.lr_type_ckpt_dir),
        "--out-csv", str(typed_csv_out),
    ]
    return _run_subprocess(cmd, settings.npmaster_repo_root, stage="classify", python_bin=settings.python_bin)


def run_job(supa: Any, settings: Settings, job: dict[str, Any]) -> dict[str, Any]:
    """Run the full pipeline for one claimed job. Mutates Supabase rows
    incrementally. Raises on terminal failure (worker catches and marks failed)."""
    job_id: str = job["id"]
    sha: str = job["fasta_sha256"]
    declared_bytes: int = int(job["fasta_bytes"])
    threshold: float = float(job["threshold"])
    min_len_bp: int = int(job["min_len_bp"])

    cache = settings.npmaster_cache_dir
    inputs_dir = cache / "inputs"
    inputs_dir.mkdir(parents=True, exist_ok=True)
    fasta_path = inputs_dir / f"{sha}.fasta"

    update_job(supa, job_id, log_tail="downloading FASTA")
    if not fasta_path.exists():
        download_object(supa, settings.fasta_bucket, job["fasta_path"], fasta_path)
    if fasta_path.stat().st_size > settings.max_fasta_bytes:
        raise PipelineError(f"FASTA exceeds max bytes ({settings.max_fasta_bytes})")
    actual_sha = sha256_file(fasta_path)
    if actual_sha != sha:
        raise FastaMismatch(f"sha256 mismatch: declared={sha} actual={actual_sha}")
    if fasta_path.stat().st_size != declared_bytes:
        log.warning("byte size mismatch: declared=%d actual=%d", declared_bytes, fasta_path.stat().st_size)
    validate_fasta(fasta_path)

    stem = _short_stem(sha)
    features_dir = features_dir_for(cache, sha)

    cache_hit = feature_cache_lookup(supa, sha) and is_features_ready(features_dir)
    if not cache_hit:
        update_job(supa, job_id, log_tail="waiting for GPU (extract)")
        if not wait_for_gpu(settings.gpu_min_free_gb, settings.gpu_wait_timeout_sec, settings.gpu_poll_sec):
            raise GpuBusyTimeout("gpu busy timeout before extract")
        update_job(supa, job_id, log_tail="extracting features (Evo2 7B)")
        try:
            _extract(settings, fasta_path, features_dir, stem)
        except PipelineError:
            shutil.rmtree(features_dir, ignore_errors=True)
            raise
        (features_dir / "DONE").touch()
        feature_cache_insert(supa, sha, str(features_dir), features_dir_size_bytes(features_dir))
    else:
        log.info("feature cache hit for sha=%s", sha[:8])

    probs_dir = cache / "probs" / job_id
    update_job(supa, job_id, log_tail="waiting for GPU (infer)")
    if not wait_for_gpu(settings.gpu_min_free_gb, settings.gpu_wait_timeout_sec, settings.gpu_poll_sec):
        raise GpuBusyTimeout("gpu busy timeout before infer")
    update_job(supa, job_id, log_tail="running U-Net inference")
    _infer(settings, features_dir, probs_dir, stem)

    results_dir = cache / "results" / job_id
    raw_csv = results_dir / "regions_raw.csv"
    update_job(supa, job_id, log_tail="decoding regions")
    _decode(settings, probs_dir, raw_csv, threshold, min_len_bp)

    # ── Type classification (4096-dim mean-pool LR head) ─────────────────
    # Run a second, projection-free Evo2 pass on the same FASTA to feed the
    # 7-class LR. Cached by sha256 in cache/features_lr/<sha>/.
    update_job(supa, job_id, log_tail="extracting 4096-dim features for type classifier")
    lr_emb_dir = cache / "features_lr" / sha
    lr_done_marker = lr_emb_dir / "DONE"
    hosts = [h.strip() for h in settings.extract_hosts.split(",") if h.strip()]
    if not lr_done_marker.exists():
        # Need a windows_metadata.csv. Reuse the per-token metadata if available;
        # otherwise re-walk the FASTA (cheap).
        per_token_meta = features_dir / "_meta" / "windows_metadata.csv"
        if per_token_meta.exists():
            metadata_csv = per_token_meta
        else:
            metadata_csv = lr_emb_dir / "windows_metadata.csv"
            metadata_csv.parent.mkdir(parents=True, exist_ok=True)
            _walk_fasta_to_metadata(
                fasta_path, metadata_csv,
                window=settings.extract_window, stride=settings.extract_stride,
                stem=stem,
            )
        if not wait_for_gpu(settings.gpu_min_free_gb, settings.gpu_wait_timeout_sec, settings.gpu_poll_sec):
            raise GpuBusyTimeout("gpu busy timeout before lr-extract")
        n_lr = _run_parallel_lr(
            fasta_path=fasta_path,
            metadata_csv=metadata_csv,
            emb_dir=lr_emb_dir,
            stem=stem,
            work_dir=lr_emb_dir / "_work",
            serve_root=Path(__file__).resolve().parent,
            npmaster_root=settings.npmaster_repo_root,
            python_bin=settings.python_bin,
            torch_lib=_torch_lib_for(settings.python_bin),
            hosts=hosts,
            gpus_per_host=settings.extract_gpus_per_host,
        )
        lr_done_marker.touch()
        log.info("lr-extract: %d windows × 4096 dims cached at %s", n_lr, lr_emb_dir)
    else:
        log.info("lr-extract cache hit for sha=%s", sha[:8])

    # ── Apply per-region 7-class LR classifier ───────────────────────────
    # The classifier writes the same regions back with v4_1_type / score columns.
    # Note: regions.csv `genome` field must match the emb_dir filename prefix.
    # Our regions are emitted with genome=stem; emb files are <stem>_*.npy/.csv.
    # Already aligned by construction.
    csv_path = results_dir / "regions.csv"
    update_job(supa, job_id, log_tail="classifying BGC types")
    _classify(settings, raw_csv, lr_emb_dir, csv_path)

    bed_path = results_dir / "regions.bed"
    n_regions = csv_regions_to_bed(csv_path, bed_path)
    log.info("decoded + typed %d regions", n_regions)

    fai_path = results_dir / "input.fasta.fai"
    write_faidx(fasta_path, fai_path)

    update_job(supa, job_id, log_tail=f"uploading results ({n_regions} regions)")
    csv_key = f"{job_id}/regions.csv"
    bed_key = f"{job_id}/regions.bed"
    fai_key = f"{job_id}/input.fasta.fai"
    fasta_key = f"{job_id}/input.fasta"
    upload_object(supa, settings.results_bucket, csv_key, csv_path, "text/csv")
    upload_object(supa, settings.results_bucket, bed_key, bed_path, "text/plain")
    upload_object(supa, settings.results_bucket, fai_key, fai_path, "text/plain")
    upload_object(supa, settings.results_bucket, fasta_key, fasta_path, "text/plain")

    with open(csv_path, newline="") as fh:
        rows = list(csv.DictReader(fh))
    insert_regions(supa, job_id, rows)

    return {
        "result_csv_path": csv_key,
        "result_bed_path": bed_key,
        "result_fai_path": fai_key,
        "result_fasta_path": fasta_key,
        "n_regions": n_regions,
    }
