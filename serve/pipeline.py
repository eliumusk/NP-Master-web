from __future__ import annotations

import csv
import hashlib
import logging
import os
import shutil
import subprocess
import time
import zipfile
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np

from .client import (
    download_object,
    feature_cache_insert,
    feature_cache_lookup,
    insert_cds_rows,
    insert_pfam_rows,
    insert_region_rows,
    list_job_genomes,
    update_genome,
    update_job,
    upload_object,
    upsert_job_artifact,
)
from .config import Settings
from .extended import read_fasta, write_extended_outputs
from .fasta import csv_regions_to_bed, sha256_file, validate_fasta, write_faidx
from .gpu_guard import wait_for_gpu
from .parallel_extract import run_parallel as _run_parallel_extract
from .safe import annotate_region
from .type_head import predict_region_types

log = logging.getLogger(__name__)

RESCUE_COLUMNS = [
    "proposal_source",
    "domain_rescue",
    "model_score",
    "seed_type",
    "seed_rule",
    "seed_strength",
    "seed_core_start",
    "seed_core_end",
    "seed_genes",
    "seed_fragment_groups",
    "seed_domains",
    "core_enzyme_id",
    "core_enzyme_status",
    "core_enzyme_component_cds",
    "core_fragment_count",
    "core_reconstruction_rule",
    "core_reconstruction_note",
]


class PipelineError(RuntimeError):
    pass


class GpuBusyTimeout(PipelineError):
    pass


class FastaMismatch(PipelineError):
    pass


@dataclass(frozen=True)
class WindowScore:
    contig: str
    start: int
    end: int
    score: float


@dataclass
class GenomeResult:
    genome_id: str
    genome_name: str
    n_regions: int
    n_safe: int
    regions_csv: Path
    artifacts: dict[str, str]


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _short_stem(sha256: str) -> str:
    return sha256[:16]


def _subprocess_env(python_bin: Path) -> dict[str, str]:
    env = os.environ.copy()
    env_root = python_bin.parent.parent
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
    tail_stderr = proc.stderr[-2000:] if proc.stderr else ""
    log.info("[%s] exit=%d in %.1fs", stage, proc.returncode, dt)
    if proc.returncode != 0:
        raise PipelineError(f"{stage} failed (exit={proc.returncode}):\n{tail_stderr}")
    return (proc.stdout or "")[-2000:] + ("\n" + tail_stderr if tail_stderr.strip() else "")


def _torch_lib_for(python_bin: Path) -> str:
    env_root = python_bin.parent.parent
    candidates = list(env_root.glob("lib/python*/site-packages/torch/lib"))
    if not candidates:
        raise PipelineError(f"could not locate torch/lib under {env_root}")
    return str(candidates[0])


def _daemon_available(settings: Settings) -> bool:
    """True when the resident model daemon pool has >= 1 healthy daemon."""
    if not settings.model_daemon_enabled:
        return False
    try:
        from . import model_pool

        return model_pool.available(settings)
    except Exception as exc:
        log.warning("model daemon health check failed: %s", exc)
        return False


def _extract_via_daemon(settings: Settings, fasta_path: Path, features_dir: Path, stem: str) -> str:
    """Shard the extraction across resident daemons; outputs are merged exactly
    like the cold parallel path (<stem>.partNNNN.npy + _windows.csv)."""
    from . import model_pool
    from .parallel_extract import (
        WorkerSpec,
        _merge_into_one_dir,
        partition_window_ids,
        walk_fasta_to_metadata,
    )

    work_dir = features_dir / "_meta"
    work_dir.mkdir(parents=True, exist_ok=True)
    metadata_csv = work_dir / "windows_metadata.csv"
    n_windows = walk_fasta_to_metadata(
        fasta_path, metadata_csv,
        window=settings.extract_window, stride=settings.extract_stride, stem=stem,
    )
    log.info("walk: %d windows from %s", n_windows, fasta_path.name)
    if n_windows == 0:
        raise PipelineError("FASTA produced 0 windows after filtering")

    gpus = model_pool.healthy_gpus(settings)
    n_workers = len(gpus)
    subsets = partition_window_ids(metadata_csv, n_workers, work_dir / "daemon_subsets")
    tasks: list[dict] = []
    specs: list[WorkerSpec] = []
    for i, gpu in enumerate(gpus):
        out_subdir = features_dir / f"_w{i:02d}"
        out_subdir.mkdir(parents=True, exist_ok=True)
        tasks.append({
            "kind": "extract_per_token",
            "gpu": gpu,
            "fasta": str(fasta_path),
            "metadata_csv": str(metadata_csv),
            "window_ids_txt": str(subsets[i]),
            "out_dir": str(out_subdir),
            "stem": stem,
            "window": settings.extract_window,
            "stride": settings.extract_stride,
        })
        specs.append(WorkerSpec(
            worker_idx=i, host="daemon", cuda_device=gpu,
            subset_txt=subsets[i], out_subdir=out_subdir,
        ))

    t0 = time.time()
    results = model_pool.run_tasks(
        settings, tasks,
        progress_cb=lambda done, total: log.info("daemon extract: %d/%d shards done", done, total),
    )
    failures = [r for r in results if r["status"] != "ok"]
    if failures:
        raise PipelineError(
            f"daemon extract failed on {len(failures)}/{len(results)} shards "
            f"(first: {failures[0]['status']} {str(failures[0]['detail'])[:300]})"
        )
    n_parts = _merge_into_one_dir(specs, features_dir, stem)
    dt = time.time() - t0
    log.info("merged %d parts into %s", n_parts, features_dir)
    return f"daemon extract: {n_parts} parts, {n_workers} daemons gpus={gpus}, {dt:.1f}s"


def _extract(settings: Settings, fasta_path: Path, features_dir: Path, stem: str) -> str:
    features_dir.mkdir(parents=True, exist_ok=True)
    if _daemon_available(settings):
        try:
            return _extract_via_daemon(settings, fasta_path, features_dir, stem)
        except Exception as exc:
            log.warning("daemon extract failed (%s); falling back to cold parallel extract", exc)
            # Remove partial per-shard dirs so the cold path's merge cannot
            # pick up daemon leftovers.
            for leftover in features_dir.glob("_w*"):
                shutil.rmtree(leftover, ignore_errors=True)
    hosts = [host.strip() for host in settings.extract_hosts.split(",") if host.strip()]
    n_workers = len(hosts) * settings.extract_gpus_per_host
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
        gpus_per_host=settings.extract_gpus_per_host,
        work_dir=work_dir,
    )
    return f"cold parallel extract: {n_parts} parts, {n_workers} workers, {time.time() - t0:.1f}s"


def _infer_via_daemon(settings: Settings, features_dir: Path, probs_dir: Path, stem: str) -> str:
    from . import model_pool

    gpus = model_pool.healthy_gpus(settings)
    task = {
        "kind": "infer_unet",
        "gpu": gpus[0],
        "features_dir": str(features_dir),
        "stems": [stem],
        "out_dir": str(probs_dir),
        "batch": 32,
    }
    t0 = time.time()
    result = model_pool.run_tasks(settings, [task])[0]
    if result["status"] != "ok":
        raise PipelineError(f"daemon infer failed: {result['status']} {str(result['detail'])[:500]}")
    return f"daemon infer: gpu{result['gpu']}, {time.time() - t0:.1f}s, {result['detail']}"


def _infer(settings: Settings, features_dir: Path, probs_dir: Path, stem: str) -> str:
    probs_dir.mkdir(parents=True, exist_ok=True)
    if _daemon_available(settings):
        try:
            return _infer_via_daemon(settings, features_dir, probs_dir, stem)
        except Exception as exc:
            log.warning("daemon infer failed (%s); falling back to cold subprocess", exc)
    cmd = [
        str(settings.python_bin),
        "scripts/inference/evo2_per_token/infer_shards.py",
        "--features-dir", str(features_dir),
        "--ckpt", str(settings.model_unet_ckpt),
        "--out-dir", str(probs_dir),
        "--stems", stem,
    ]
    return "cold " + _run_subprocess(cmd, settings.npmaster_repo_root, stage="infer", python_bin=settings.python_bin)


def _use_precomputed_probs(settings: Settings, probs_dir: Path, *, genome_name: str, stem: str) -> bool:
    """Use benchmark U-Net probability outputs when they already exist.

    This is intentionally narrow: it only checks the current model run's
    `9g_probs` directory and copies files into the normal inference output
    shape, so downstream decoding/annotation remains identical.
    """
    source_dir = settings.model_unet_ckpt.parent / "9g_probs"
    source_probs = source_dir / f"{genome_name}.probs.npz"
    source_coords = source_dir / f"{genome_name}.coords.csv"
    if not source_probs.exists() or not source_coords.exists():
        return False

    probs_dir.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source_probs, probs_dir / f"{stem}.probs.npz")
    shutil.copy2(source_coords, probs_dir / f"{stem}.coords.csv")
    log.info("using precomputed U-Net probabilities for %s from %s", genome_name, source_dir)
    return True


def _decode_regions_hysteresis(
    windows: list[WindowScore],
    *,
    start_threshold: float,
    extend_threshold: float,
    max_gap: int,
    min_support_windows: int,
) -> list[tuple[str, int, int]]:
    if extend_threshold > start_threshold:
        raise PipelineError("extend_threshold must be <= threshold")
    windows = sorted(windows, key=lambda row: (row.contig, row.start))
    regions: list[tuple[str, list[WindowScore]]] = []
    current: list[WindowScore] = []
    seeded = False

    for window in windows:
        if not current:
            if window.score >= start_threshold:
                current = [window]
                seeded = True
            continue

        last = current[-1]
        contiguous = window.contig == last.contig and window.start <= last.end + max_gap
        if not contiguous:
            if seeded and len(current) >= min_support_windows:
                regions.append((current[0].contig, current))
            current = [window] if window.score >= start_threshold else []
            seeded = bool(current)
            continue

        if window.score >= extend_threshold:
            current.append(window)
            if window.score >= start_threshold:
                seeded = True
            continue

        if seeded and len(current) >= min_support_windows:
            regions.append((current[0].contig, current))
        current = [window] if window.score >= start_threshold else []
        seeded = bool(current)

    if current and seeded and len(current) >= min_support_windows:
        regions.append((current[0].contig, current))

    return [(contig, items[0].start, items[-1].end) for contig, items in regions if items]


def _load_window_scores(probs_dir: Path, stem: str) -> list[WindowScore]:
    coords_path = probs_dir / f"{stem}.coords.csv"
    probs_path = probs_dir / f"{stem}.probs.npz"
    if not coords_path.exists() or not probs_path.exists():
        raise PipelineError(f"missing inference outputs for {stem}")

    coords: dict[str, tuple[str, int, int]] = {}
    with open(coords_path) as handle:
        for row in csv.DictReader(handle):
            coords[row["window_id"]] = (row["contig"], int(row["start"]), int(row["end"]))

    probs = np.load(probs_path)
    windows: list[WindowScore] = []
    for window_id in probs.files:
        coord = coords.get(window_id)
        if coord is None:
            continue
        contig, start, end = coord
        score = float(np.max(probs[window_id].astype(np.float32)))
        windows.append(WindowScore(contig=contig, start=start, end=end, score=score))
    return windows


def _score_region(windows: list[WindowScore], contig: str, start: int, end: int) -> float:
    scores = [w.score for w in windows if w.contig == contig and w.end > start and w.start < end]
    return max(scores) if scores else 0.0


def _decode_to_csv(
    *,
    probs_dir: Path,
    stem: str,
    genome_name: str,
    out_csv: Path,
    threshold: float,
    extend_threshold: float,
    min_support_windows: int,
    min_len_bp: int,
) -> tuple[list[dict[str, Any]], list[WindowScore]]:
    windows = _load_window_scores(probs_dir, stem)
    regions = _decode_regions_hysteresis(
        windows,
        start_threshold=threshold,
        extend_threshold=extend_threshold,
        min_support_windows=min_support_windows,
        max_gap=0,
    )
    rows: list[dict[str, Any]] = []
    for i, (contig, start, end) in enumerate(regions, start=1):
        if end - start < min_len_bp:
            continue
        rows.append({
            "genome": genome_name,
            "contig": contig,
            "start": int(start),
            "end": int(end),
            "score": round(_score_region(windows, contig, start, end), 4),
            "type": "",
            "bgc_id": f"BGC_{i:04d}",
            "proposal_source": "model_only",
            "domain_rescue": False,
            "model_score": round(_score_region(windows, contig, start, end), 4),
        })
    _write_csv(out_csv, rows, ["genome", "contig", "start", "end", "score", "type", "bgc_id", *RESCUE_COLUMNS])
    return rows, windows


def _write_csv(path: Path, rows: list[dict[str, Any]], preferred: list[str] | None = None) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fieldnames = list(preferred or [])
    for row in rows:
        for key in row:
            if key not in fieldnames:
                fieldnames.append(key)
    with open(path, "w", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


def _read_contig_lengths(fasta_path: Path) -> dict[str, int]:
    return {name: len(seq) for name, seq in read_fasta(fasta_path).items()}


def _annotate_and_classify(
    *,
    settings: Settings,
    fasta_path: Path,
    gff3_path: Path | None,
    raw_rows: list[dict[str, Any]],
    raw_csv: Path,
    results_dir: Path,
    safe_tier_min: str,
    extend_flank_bp: int,
    core_pep_path: Path | None = None,
) -> tuple[list[dict[str, Any]], dict[str, list[dict[str, Any]]], dict[str, list[dict[str, Any]]], Path | None, Path | None]:
    gbk_path: Path | None = None
    mibig_hits: dict[str, list[dict[str, Any]]] = {}
    cds_by_region: dict[str, list[dict[str, Any]]] = {}

    if raw_rows:
        gbk_candidate = results_dir / "regions.gbk"
        try:
            if gff3_path and gff3_path.exists():
                from .gff3 import generate_genbank_from_gff3

                generate_genbank_from_gff3(
                    fasta_path=fasta_path,
                    gff3_path=gff3_path,
                    core_pep_fasta=core_pep_path,
                    regions_csv=raw_csv,
                    out_gbk_path=gbk_candidate,
                )
            else:
                from .genbank import generate_genbank

                generate_genbank(
                    fasta_path=fasta_path,
                    regions_csv=raw_csv,
                    out_gbk_path=gbk_candidate,
                    prodigal_bin=settings.prodigal_bin,
                    work_dir=results_dir / "_genbank_work",
                )
            gbk_path = gbk_candidate if gbk_candidate.exists() else None
        except Exception as exc:
            log.warning("genbank generation failed; type/safe evidence will be weaker: %s", exc)

    if gbk_path and gbk_path.exists() and settings.mibig_dmnd_path.exists():
        try:
            from .mibig import search_regions_against_mibig

            mibig_hits = search_regions_against_mibig(
                regions_gbk=gbk_path,
                dmnd_db=settings.mibig_dmnd_path,
                meta_json=settings.mibig_meta_path,
                work_dir=results_dir / "_mibig_work",
                diamond_bin=settings.diamond_bin,
                top_k=3,
            )
        except Exception as exc:
            log.warning("MIBiG search failed; continuing without nearest-neighbor hits: %s", exc)

    pfam_tbl: Path | None = None
    if gbk_path and gbk_path.exists() and settings.pfam_db_path.exists():
        try:
            from .pfam import annotate_regions_gbk

            pfam_work = results_dir / "_pfam_work"
            cds_by_region = annotate_regions_gbk(
                regions_gbk=gbk_path,
                pfam_db=settings.pfam_db_path,
                work_dir=pfam_work,
                hmmer_bin=settings.hmmer_bin,
                threads=settings.hmmer_threads,
            )
            candidate = pfam_work / "pfam_hits.domtbl"
            pfam_tbl = candidate if candidate.exists() else None
        except Exception as exc:
            log.warning("Pfam annotation failed; continuing without domain evidence: %s", exc)

    typed = {row["bgc_id"]: {} for row in raw_rows}
    if raw_rows and settings.type_head_joblib.exists():
        try:
            typed = predict_region_types(
                type_head_path=settings.type_head_joblib,
                cds_by_region=cds_by_region,
                region_ids=[str(row["bgc_id"]) for row in raw_rows],
            )
        except Exception as exc:
            log.warning("RandomForest type head failed; defaulting region type to Other: %s", exc)

    contig_lens = _read_contig_lengths(fasta_path)
    out_rows: list[dict[str, Any]] = []
    for row in raw_rows:
        bgc_id = str(row["bgc_id"])
        prediction = typed.get(bgc_id) or {}
        scores = prediction.get("scores") or {}
        row = dict(row)
        rescue_type = str(row.get("seed_type") or "")
        if bool(row.get("domain_rescue")) and rescue_type in {"Alkaloid", "Terpene", "NRP", "Polyketide", "RiPP", "Saccharide"}:
            # Domain-rescued proposals use the seed class as the primary type;
            # the RF head still contributes scores when it has matching Pfams.
            top_type = prediction.get("type") or "Other"
            top_score = float(prediction.get("score") or 0.0)
            if row.get("proposal_source") == "domain_rescued" or top_type == "Other" or top_score < 0.5:
                scores = {rescue_type: 1.0}
                prediction = {
                    "type": rescue_type,
                    "score": 1.0,
                    "top2_type": "",
                    "scores": scores,
                    "scores_text": ";".join(f"{k}={v:.3f}" for k, v in scores.items()),
                }
                scores = prediction["scores"]
        row.update({
            "v4_1_type": prediction.get("type") or "Other",
            "v4_1_type_score": round(float(prediction.get("score") or 0.0), 6),
            "v4_1_type_top2": prediction.get("top2_type") or "",
            "v4_1_type_scores": prediction.get("scores_text") or "",
            "type_scores": scores,
        })
        safe = annotate_region(
            row=row,
            cds_list=cds_by_region.get(bgc_id, []),
            mibig_hits=mibig_hits.get(bgc_id, []),
            contig_len=contig_lens.get(str(row["contig"]), 0),
            safe_tier_min=safe_tier_min,
        )
        row.update(safe)
        out_rows.append(row)

    if gff3_path and gff3_path.exists():
        from .gff3 import write_extended_outputs_from_gff3

        write_extended_outputs_from_gff3(
            fasta_path=fasta_path,
            gff3_path=gff3_path,
            core_pep_fasta=core_pep_path,
            rows=out_rows,
            out_dir=results_dir / "extended",
            genome_name=str(raw_rows[0]["genome"]) if raw_rows else "genome",
            flank_bp=extend_flank_bp,
        )
    else:
        write_extended_outputs(
            fasta_path=fasta_path,
            rows=out_rows,
            out_dir=results_dir / "extended",
            genome_name=str(raw_rows[0]["genome"]) if raw_rows else "genome",
            prodigal_bin=settings.prodigal_bin,
            flank_bp=extend_flank_bp,
        )
    return out_rows, cds_by_region, mibig_hits, gbk_path, pfam_tbl


def _upload_artifact(
    supa: Any,
    settings: Settings,
    *,
    job_id: str,
    genome_id: str | None,
    kind: str,
    key: str,
    path: Path,
    content_type: str,
) -> str:
    upload_object(supa, settings.results_bucket, key, path, content_type)
    upsert_job_artifact(
        supa,
        job_id=job_id,
        genome_id=genome_id,
        kind=kind,
        storage_path=key,
        content_type=content_type,
        bytes_size=path.stat().st_size if path.exists() else None,
    )
    return key


def _insert_regions_for_genome(
    supa: Any,
    *,
    job_id: str,
    genome: dict[str, Any],
    rows: list[dict[str, Any]],
    cds_by_region: dict[str, list[dict[str, Any]]],
    mibig_hits: dict[str, list[dict[str, Any]]],
) -> None:
    payload: list[dict[str, Any]] = []
    for row in rows:
        bgc_id = str(row["bgc_id"])
        payload.append({
            "job_id": job_id,
            "genome_id": genome["id"],
            "genome_name": genome["genome_name"],
            "contig": row["contig"],
            "start_bp": int(row["start"]),
            "end_bp": int(row["end"]),
            "ext_start_bp": int(row["ext_start"]) if row.get("ext_start") is not None else None,
            "ext_end_bp": int(row["ext_end"]) if row.get("ext_end") is not None else None,
            "score": float(row["score"]),
            "bgc_type": row.get("v4_1_type") or "Other",
            "type_score": float(row.get("v4_1_type_score") or 0.0),
            "type_scores": row.get("type_scores") or {},
            "safe_tier": row.get("evidence_tier"),
            "safe_pass": bool(row.get("safe_pass")),
            "safe_type_label": row.get("safe_type_label"),
            "mibig_hits": mibig_hits.get(bgc_id, []),
            "cds_features": cds_by_region.get(bgc_id, []),
        })

    inserted = insert_region_rows(supa, payload)
    region_ids = {row["bgc_id"]: inserted[i]["id"] for i, row in enumerate(rows) if i < len(inserted)}

    cds_payload: list[dict[str, Any]] = []
    pfam_payload: list[dict[str, Any]] = []
    for row in rows:
        bgc_id = str(row["bgc_id"])
        region_db_id = region_ids.get(bgc_id)
        if region_db_id is None:
            continue
        region_start = int(row["start"])
        for cds in cds_by_region.get(bgc_id, []):
            start = int(cds.get("start") or 0)
            end = int(cds.get("end") or 0)
            locus_tag = str(cds.get("locus_tag") or "")
            cds_payload.append({
                "region_id": region_db_id,
                "locus_tag": locus_tag,
                "start_bp": region_start + start,
                "end_bp": region_start + end,
                "strand": int(cds.get("strand") or 1),
                "length_aa": int(cds.get("length_aa") or 0),
                "product": cds.get("product") or "",
                "function_class": cds.get("function_class") or "other",
                "aa_sequence": cds.get("aa_sequence") or "",
                "nt_sequence": cds.get("nt_sequence") or "",
            })
            for domain in cds.get("pfam_domains") or []:
                pfam_payload.append({
                    "region_id": region_db_id,
                    "locus_tag": locus_tag,
                    "domain": domain.get("name") or "",
                    "accession": domain.get("accession") or "",
                    "description": domain.get("description") or "",
                    "e_value": domain.get("e_value"),
                    "bitscore": domain.get("bitscore"),
                    "hmm_start": domain.get("hmm_start"),
                    "hmm_end": domain.get("hmm_end"),
                    "seq_start": domain.get("env_start"),
                    "seq_end": domain.get("env_end"),
                })
    insert_cds_rows(supa, cds_payload)
    insert_pfam_rows(supa, pfam_payload)


def _prepare_fasta(supa: Any, settings: Settings, genome: dict[str, Any]) -> Path:
    sha = str(genome["fasta_sha256"])
    fasta_path = settings.npmaster_cache_dir / "inputs" / f"{sha}.fasta"
    fasta_path.parent.mkdir(parents=True, exist_ok=True)
    if not fasta_path.exists():
        download_object(supa, settings.fasta_bucket, genome["fasta_path"], fasta_path)
    if fasta_path.stat().st_size > settings.max_fasta_bytes:
        raise PipelineError(f"FASTA exceeds max bytes ({settings.max_fasta_bytes})")
    actual_sha = sha256_file(fasta_path)
    if actual_sha != sha:
        raise FastaMismatch(f"sha256 mismatch: declared={sha} actual={actual_sha}")
    validate_fasta(fasta_path)
    return fasta_path


def _prepare_gff3(supa: Any, settings: Settings, genome: dict[str, Any]) -> Path | None:
    """Download an optional genome annotation file when the job schema provides one."""
    storage_path = (
        genome.get("gff3_path")
        or genome.get("gff_path")
        or genome.get("annotation_path")
        or genome.get("gff3_storage_path")
    )
    local_path = genome.get("gff3_local_path") or genome.get("gff_local_path")
    if local_path and Path(str(local_path)).exists():
        return Path(str(local_path))
    if not storage_path:
        return None

    sha = str(genome.get("gff3_sha256") or genome.get("gff_sha256") or hashlib.sha256(str(storage_path).encode()).hexdigest())
    suffix = ".gff3" if str(storage_path).lower().endswith(".gff3") else ".gff"
    gff3_path = settings.npmaster_cache_dir / "inputs" / f"{sha}{suffix}"
    gff3_path.parent.mkdir(parents=True, exist_ok=True)
    if not gff3_path.exists():
        bucket = str(genome.get("gff3_bucket") or genome.get("annotation_bucket") or settings.fasta_bucket)
        download_object(supa, bucket, str(storage_path), gff3_path)
    return gff3_path


def _prepare_core_pep(supa: Any, settings: Settings, genome: dict[str, Any]) -> Path | None:
    """Download an optional corrected peptide FASTA for core-enzyme reconstruction."""
    storage_path = (
        genome.get("pep_path")
        or genome.get("pep_fasta_path")
        or genome.get("protein_path")
        or genome.get("protein_fasta_path")
        or genome.get("core_pep_path")
        or genome.get("core_pep_fasta_path")
    )
    local_path = genome.get("pep_local_path") or genome.get("protein_local_path")
    if local_path and Path(str(local_path)).exists():
        return Path(str(local_path))
    if not storage_path:
        return None

    sha = str(
        genome.get("pep_sha256")
        or genome.get("protein_sha256")
        or hashlib.sha256(str(storage_path).encode()).hexdigest()
    )
    suffix = ".fa" if str(storage_path).lower().endswith((".fa", ".faa", ".fasta")) else ".pep.fa"
    pep_path = settings.npmaster_cache_dir / "inputs" / f"{sha}{suffix}"
    pep_path.parent.mkdir(parents=True, exist_ok=True)
    if not pep_path.exists():
        bucket = str(genome.get("pep_bucket") or genome.get("protein_bucket") or settings.fasta_bucket)
        download_object(supa, bucket, str(storage_path), pep_path)
    return pep_path


def _process_genome(supa: Any, settings: Settings, job: dict[str, Any], genome: dict[str, Any]) -> GenomeResult:
    job_id = str(job["id"])
    genome_name = str(genome["genome_name"])
    genome_id = str(genome["id"])
    sha = str(genome["fasta_sha256"])
    stem = _short_stem(sha)

    update_genome(supa, genome_id, status="running", started_at=_now(), error=None)
    update_job(supa, job_id, log_tail=f"{genome_name}: 下载 FASTA")
    fasta_path = _prepare_fasta(supa, settings, genome)
    gff3_path = _prepare_gff3(supa, settings, genome)
    core_pep_path = _prepare_core_pep(supa, settings, genome)
    if gff3_path:
        update_job(supa, job_id, log_tail=f"{genome_name}: 使用 GFF3 注释和 domain rescue")
    if core_pep_path:
        update_job(supa, job_id, log_tail=f"{genome_name}: 使用 peptide evidence 进行核心酶容错重建")

    probs_dir = settings.npmaster_cache_dir / "probs" / job_id / genome_name
    used_precomputed_probs = (
        settings.use_precomputed_9g_probs
        and _use_precomputed_probs(settings, probs_dir, genome_name=genome_name, stem=stem)
    )
    if used_precomputed_probs:
        update_job(supa, job_id, log_tail=f"{genome_name}: 使用预计算 U-Net 结果")
    else:
        if settings.use_feature_cache:
            features_dir = settings.npmaster_cache_dir / "features" / sha
            cache_hit = feature_cache_lookup(supa, sha) and (features_dir / "DONE").exists()
        else:
            features_dir = settings.npmaster_cache_dir / "features_uncached" / job_id / genome_name
            shutil.rmtree(features_dir, ignore_errors=True)
            cache_hit = False

        if not cache_hit:
            # The VRAM guard only makes sense for the cold-start path; resident
            # daemons legitimately hold GPU memory between jobs.
            if not _daemon_available(settings):
                update_job(supa, job_id, log_tail=f"{genome_name}: 等待 GPU（Evo2 特征提取）")
                if not wait_for_gpu(settings.gpu_min_free_gb, settings.gpu_wait_timeout_sec, settings.gpu_poll_sec):
                    raise GpuBusyTimeout("gpu busy timeout before extract")
            update_job(supa, job_id, log_tail=f"{genome_name}: 提取 Evo2 特征")
            try:
                _extract(settings, fasta_path, features_dir, stem)
            except Exception:
                shutil.rmtree(features_dir, ignore_errors=True)
                raise
            (features_dir / "DONE").touch()
            if settings.use_feature_cache:
                feature_cache_insert(
                    supa,
                    sha,
                    str(features_dir),
                    sum(p.stat().st_size for p in features_dir.rglob("*") if p.is_file()),
                )
        else:
            log.info("feature cache hit for %s", sha[:8])

        if not _daemon_available(settings):
            update_job(supa, job_id, log_tail=f"{genome_name}: 等待 GPU（U-Net 推理）")
            if not wait_for_gpu(settings.gpu_min_free_gb, settings.gpu_wait_timeout_sec, settings.gpu_poll_sec):
                raise GpuBusyTimeout("gpu busy timeout before U-Net inference")
        update_job(supa, job_id, log_tail=f"{genome_name}: 运行 U-Net 推理")
        _infer(settings, features_dir, probs_dir, stem)

    results_dir = settings.npmaster_cache_dir / "results" / job_id / genome_name
    raw_csv = results_dir / "regions_raw.csv"
    update_job(supa, job_id, log_tail=f"{genome_name}: 解码 ALT_OP 区域")
    raw_rows, _windows = _decode_to_csv(
        probs_dir=probs_dir,
        stem=stem,
        genome_name=genome_name,
        out_csv=raw_csv,
        threshold=float(job.get("threshold") or settings.default_threshold),
        extend_threshold=float(job.get("extend_threshold") or settings.default_extend_threshold),
        min_support_windows=int(job.get("min_support_windows") or settings.default_min_support_windows),
        min_len_bp=int(job.get("min_len_bp") or settings.default_min_len_bp),
    )
    if gff3_path and gff3_path.exists() and settings.pfam_db_path.exists():
        try:
            from .domain_rescue import merge_model_and_domain_rows, propose_domain_rescued_regions

            update_job(supa, job_id, log_tail=f"{genome_name}: 运行 GFF3/Pfam domain rescue")
            domain_rows = propose_domain_rescued_regions(
                fasta_path=fasta_path,
                gff3_path=gff3_path,
                pfam_db=settings.pfam_db_path,
                hmmer_bin=settings.hmmer_bin,
                work_dir=results_dir / "_domain_rescue_work",
                genome_name=genome_name,
                threads=settings.hmmer_threads,
            )
            for row in domain_rows:
                model_score = round(_score_region(_windows, str(row["contig"]), int(row["start"]), int(row["end"])), 4)
                row["model_score"] = model_score
            raw_rows = merge_model_and_domain_rows(raw_rows, domain_rows)
            _write_csv(raw_csv, raw_rows, ["genome", "contig", "start", "end", "score", "type", "bgc_id", *RESCUE_COLUMNS])
        except Exception as exc:
            log.warning("domain rescue failed; continuing with model-only regions: %s", exc)

    update_job(supa, job_id, log_tail=f"{genome_name}: 注释 Pfam / MIBiG / 类型 / 安全等级")
    rows, cds_by_region, mibig_hits, gbk_path, pfam_tbl = _annotate_and_classify(
        settings=settings,
        fasta_path=fasta_path,
        gff3_path=gff3_path,
        core_pep_path=core_pep_path,
        raw_rows=raw_rows,
        raw_csv=raw_csv,
        results_dir=results_dir,
        safe_tier_min=str(job.get("safe_tier_min") or settings.default_safe_tier_min),
        extend_flank_bp=int(job.get("extend_flank_bp") or settings.default_extend_flank_bp),
    )

    regions_csv = results_dir / "regions.csv"
    _write_csv(regions_csv, rows, [
        "genome", "contig", "start", "end", "score", "type", "bgc_id",
        *RESCUE_COLUMNS,
        "v4_1_type", "v4_1_type_score", "v4_1_type_top2", "v4_1_type_scores",
        "safe_type_label", "evidence_tier", "safe_pass", "ext_start", "ext_end",
    ])

    bed_path = results_dir / "regions.bed"
    csv_regions_to_bed(regions_csv, bed_path)
    fai_path = results_dir / "input.fasta.fai"
    write_faidx(fasta_path, fai_path)

    wig_path: Path | None = results_dir / "scores.bedgraph"
    try:
        from .score_track import write_bedgraph

        write_bedgraph(
            probs_npz=probs_dir / f"{stem}.probs.npz",
            coords_csv=probs_dir / f"{stem}.coords.csv",
            out_path=wig_path,
        )
    except Exception as exc:
        log.warning("score track generation failed: %s", exc)
        wig_path = None

    _insert_regions_for_genome(
        supa,
        job_id=job_id,
        genome=genome,
        rows=rows,
        cds_by_region=cds_by_region,
        mibig_hits=mibig_hits,
    )

    update_job(supa, job_id, log_tail=f"{genome_name}: 上传结果文件")
    base_key = f"{job_id}/{genome_name}"
    artifacts: dict[str, str] = {}
    artifact_specs: list[tuple[str, Path, str]] = [
        ("regions_csv", regions_csv, "text/csv"),
        ("regions_raw_csv", raw_csv, "text/csv"),
        ("regions_bed", bed_path, "text/plain"),
        ("input_fasta", fasta_path, "text/plain"),
        ("input_fai", fai_path, "text/plain"),
        ("extended_regions_fna", results_dir / "extended" / "extended_regions.fna", "text/plain"),
        ("extended_cds_faa", results_dir / "extended" / "extended_cds.faa", "text/plain"),
        ("extended_cds_fna", results_dir / "extended" / "extended_cds.fna", "text/plain"),
        ("extended_cds_csv", results_dir / "extended" / "extended_cds.csv", "text/csv"),
        ("reconstructed_core_enzymes_faa", results_dir / "extended" / "reconstructed_core_enzymes.faa", "text/plain"),
        ("reconstructed_core_enzymes_fna", results_dir / "extended" / "reconstructed_core_enzymes.fna", "text/plain"),
        ("reconstructed_core_enzymes_csv", results_dir / "extended" / "reconstructed_core_enzymes.csv", "text/csv"),
    ]
    if gff3_path and gff3_path.exists():
        artifact_specs.append(("input_gff3", gff3_path, "text/plain"))
    if core_pep_path and core_pep_path.exists():
        artifact_specs.append(("input_core_pep", core_pep_path, "text/plain"))
    if gbk_path and gbk_path.exists():
        artifact_specs.append(("regions_gbk", gbk_path, "text/plain"))
    if wig_path and wig_path.exists():
        artifact_specs.append(("scores_bedgraph", wig_path, "text/plain"))
    if pfam_tbl and pfam_tbl.exists():
        artifact_specs.append(("pfam_domtbl", pfam_tbl, "text/plain"))

    for kind, path, content_type in artifact_specs:
        if not path.exists():
            continue
        key = f"{base_key}/{path.name}"
        artifacts[kind] = _upload_artifact(
            supa,
            settings,
            job_id=job_id,
            genome_id=genome_id,
            kind=kind,
            key=key,
            path=path,
            content_type=content_type,
        )

    n_regions = len(rows)
    n_safe = sum(1 for row in rows if bool(row.get("safe_pass")))
    update_genome(
        supa,
        genome_id,
        status="done",
        finished_at=_now(),
        error=None,
        n_regions=n_regions,
        n_safe=n_safe,
    )
    return GenomeResult(
        genome_id=genome_id,
        genome_name=genome_name,
        n_regions=n_regions,
        n_safe=n_safe,
        regions_csv=regions_csv,
        artifacts=artifacts,
    )


def _aggregate_results(supa: Any, settings: Settings, job_id: str, results: list[GenomeResult]) -> dict[str, str | int]:
    job_dir = settings.npmaster_cache_dir / "results" / job_id
    all_regions_csv = job_dir / "regions.csv"
    wrote_header = False
    with open(all_regions_csv, "w", newline="") as out_handle:
        writer: csv.DictWriter | None = None
        for result in results:
            with open(result.regions_csv, newline="") as in_handle:
                reader = csv.DictReader(in_handle)
                if writer is None:
                    writer = csv.DictWriter(out_handle, fieldnames=reader.fieldnames or [])
                    writer.writeheader()
                    wrote_header = True
                for row in reader:
                    writer.writerow(row)
    if not wrote_header:
        _write_csv(all_regions_csv, [], ["genome", "contig", "start", "end", "score"])

    zip_path = job_dir / "bgcmaster_results.zip"
    with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.write(all_regions_csv, "regions.csv")
        for result in results:
            genome_dir = job_dir / result.genome_name
            for path in sorted(p for p in genome_dir.rglob("*") if p.is_file()):
                rel = path.relative_to(genome_dir)
                if any(part.startswith("_") for part in rel.parts):
                    continue
                archive.write(path, f"{result.genome_name}/{path.relative_to(genome_dir)}")

    regions_key = _upload_artifact(
        supa,
        settings,
        job_id=job_id,
        genome_id=None,
        kind="regions_csv",
        key=f"{job_id}/regions.csv",
        path=all_regions_csv,
        content_type="text/csv",
    )
    zip_key = _upload_artifact(
        supa,
        settings,
        job_id=job_id,
        genome_id=None,
        kind="results_zip",
        key=f"{job_id}/bgcmaster_results.zip",
        path=zip_path,
        content_type="application/zip",
    )
    return {"result_regions_path": regions_key, "result_zip_path": zip_key}


def run_job(supa: Any, settings: Settings, job: dict[str, Any]) -> dict[str, Any]:
    job_id = str(job["id"])
    genomes = list_job_genomes(supa, job_id)
    if not genomes:
        raise PipelineError("job has no genomes")

    results: list[GenomeResult] = []
    for genome in genomes:
        try:
            results.append(_process_genome(supa, settings, job, genome))
        except Exception as exc:
            update_genome(
                supa,
                str(genome["id"]),
                status="failed",
                finished_at=_now(),
                error=str(exc)[:2000],
            )
            raise

    aggregate = _aggregate_results(supa, settings, job_id, results)
    n_regions = sum(result.n_regions for result in results)
    n_safe = sum(result.n_safe for result in results)
    update_job(
        supa,
        job_id,
        n_regions=n_regions,
        n_safe=n_safe,
        result_regions_path=aggregate["result_regions_path"],
        result_zip_path=aggregate["result_zip_path"],
        log_tail=f"完成：{n_regions} 个候选区域，{n_safe} 个安全通过",
    )
    return {
        "n_genomes": len(results),
        "n_regions": n_regions,
        "n_safe": n_safe,
        **aggregate,
    }
