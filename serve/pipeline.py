from __future__ import annotations

import csv
import logging
import shutil
import subprocess
import time
from pathlib import Path
from typing import Any

from .cache import features_dir_for, features_dir_size_bytes, is_features_ready
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

log = logging.getLogger(__name__)


class PipelineError(RuntimeError):
    pass


class GpuBusyTimeout(PipelineError):
    pass


class FastaMismatch(PipelineError):
    pass


def _short_stem(sha256: str) -> str:
    return sha256[:16]


def _run_subprocess(cmd: list[str], cwd: Path, stage: str) -> str:
    log.info("[%s] $ %s", stage, " ".join(str(c) for c in cmd))
    t0 = time.time()
    proc = subprocess.run(
        cmd,
        cwd=str(cwd),
        capture_output=True,
        text=True,
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


def _extract(settings: Settings, fasta_path: Path, features_dir: Path, stem: str) -> str:
    features_dir.mkdir(parents=True, exist_ok=True)
    cmd = [
        str(settings.python_bin),
        "scripts/extract/extract_evo2_per_token_features.py",
        "--source", "genome",
        "--fasta", str(fasta_path),
        "--out-dir", str(features_dir),
        "--stem", stem,
        "--window", str(settings.extract_window),
        "--stride", str(settings.extract_stride),
    ]
    return _run_subprocess(cmd, settings.npmaster_repo_root, stage="extract")


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
    return _run_subprocess(cmd, settings.npmaster_repo_root, stage="infer")


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
    return _run_subprocess(cmd, settings.npmaster_repo_root, stage="decode")


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
    csv_path = results_dir / "regions.csv"
    update_job(supa, job_id, log_tail="decoding regions")
    _decode(settings, probs_dir, csv_path, threshold, min_len_bp)

    bed_path = results_dir / "regions.bed"
    n_regions = csv_regions_to_bed(csv_path, bed_path)
    log.info("decoded %d regions", n_regions)

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
