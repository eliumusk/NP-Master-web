"""Parallelized Evo2 per-token feature extraction across N GPUs.

Strategy: pre-walk the user FASTA to build a windows_metadata.csv, partition the
window IDs by modulo across N workers, launch one subprocess per GPU
(local + ssh remote hosts), each running scripts/extract/...py with
--source=sliced + --window-ids-subset. Results land as per-worker shards in a
shared NFS dir, which infer_shards.py auto-globs by stem.

Naming convention to avoid collisions:
  - per-worker subprocess writes to <features_dir>/_w<NN>/ with stem=<base_stem>
  - each worker writes <base_stem>.part0000.npy + _windows.csv (one shard, since
    each worker handles ~3200/N << flush_every=1000 windows)
  - after all subprocesses succeed, files are moved/renamed:
      _w00/<base_stem>.part0000.npy  -> <features_dir>/<base_stem>.part0000.npy
      _w01/<base_stem>.part0000.npy  -> <features_dir>/<base_stem>.part0001.npy
      ...
  - infer_shards.py then groups all N parts under one stem cleanly.
"""
from __future__ import annotations

import csv
import logging
import shlex
import shutil
import subprocess
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import NamedTuple

log = logging.getLogger(__name__)


def _iter_fasta_contigs(fasta_path: Path):
    """Yield (contig_id, sequence_str) for each FASTA record. Streaming."""
    cur_id: str | None = None
    cur_chunks: list[str] = []
    with open(fasta_path, "r") as f:
        for line in f:
            if line.startswith(">"):
                if cur_id is not None:
                    yield cur_id, "".join(cur_chunks)
                cur_id = line[1:].split()[0]
                cur_chunks = []
            else:
                cur_chunks.append(line.strip().upper())
    if cur_id is not None:
        yield cur_id, "".join(cur_chunks)


def walk_fasta_to_metadata(fasta_path: Path, out_csv: Path, *, window: int,
                           stride: int, stem: str, genome_id: str | None = None) -> int:
    """Stream-scan FASTA → write metadata CSV with one row per emitted window.

    Columns: window_id, genome_id, contig_id, window_start, window_end, clean_len.
    Window IDs match the original extract script: f"{stem}_{counter:07d}".
    Filter: drop windows with < 100 ACGT bases (matches script behaviour).
    Returns the number of windows written."""
    if genome_id is None:
        genome_id = stem
    out_csv.parent.mkdir(parents=True, exist_ok=True)
    n = 0
    with open(out_csv, "w", newline="") as fh:
        wr = csv.writer(fh)
        wr.writerow(["window_id", "genome_id", "contig_id", "window_start", "window_end", "clean_len"])
        counter = 0
        for contig_id, seq in _iter_fasta_contigs(fasta_path):
            L = len(seq)
            for start in range(0, L, stride):
                end = min(start + window, L)
                sub = seq[start:end]
                clean_len = sum(1 for c in sub if c in "ATCG")
                if clean_len < 100:
                    continue
                wid = f"{stem}_{counter:07d}"
                wr.writerow([wid, genome_id, contig_id, start, end, clean_len])
                counter += 1
                n += 1
    return n


def partition_window_ids(metadata_csv: Path, n_workers: int, out_dir: Path) -> list[Path]:
    """Split window_ids by modulo N → write n_workers txt files. Returns paths."""
    out_dir.mkdir(parents=True, exist_ok=True)
    buckets: list[list[str]] = [[] for _ in range(n_workers)]
    with open(metadata_csv) as fh:
        rd = csv.DictReader(fh)
        for i, row in enumerate(rd):
            buckets[i % n_workers].append(row["window_id"])
    paths: list[Path] = []
    for i, ids in enumerate(buckets):
        p = out_dir / f"window_ids_w{i:02d}.txt"
        p.write_text("\n".join(ids) + ("\n" if ids else ""))
        paths.append(p)
    return paths


class WorkerSpec(NamedTuple):
    worker_idx: int       # 0..N-1
    host: str             # "localhost" or "node8" (must be in ssh config)
    cuda_device: int      # CUDA_VISIBLE_DEVICES on the target host
    subset_txt: Path      # path to window_ids_w<NN>.txt
    out_subdir: Path      # per-worker output dir <features_dir>/_w<NN>/


def _build_cmd(spec: WorkerSpec, *, repo_root: Path, python_bin: Path,
               metadata_csv: Path, genome_dir: Path, stem: str,
               window: int, stride: int, torch_lib: str) -> list[str]:
    """Build the shell command to launch the extract subprocess.

    For local: returns the python invocation with env vars set via env(1).
    For remote: wraps with `ssh <host> 'sh -c "..."'` so the env applies on
    the remote shell."""
    inner = (
        f"cd {shlex.quote(str(repo_root))} && "
        f"CUDA_VISIBLE_DEVICES={spec.cuda_device} "
        f"LD_LIBRARY_PATH={shlex.quote(torch_lib)}:${{LD_LIBRARY_PATH:-}} "
        f"{shlex.quote(str(python_bin))} "
        f"scripts/extract/extract_evo2_per_token_features.py "
        f"--source sliced "
        f"--metadata-csv {shlex.quote(str(metadata_csv))} "
        f"--genome-dir {shlex.quote(str(genome_dir))} "
        f"--window-ids-subset {shlex.quote(str(spec.subset_txt))} "
        f"--out-dir {shlex.quote(str(spec.out_subdir))} "
        f"--stem {shlex.quote(stem)} "
        f"--window {window} --stride {stride}"
    )
    if spec.host == "localhost":
        return ["bash", "-c", inner]
    return ["ssh", "-o", "BatchMode=yes", spec.host, inner]


def _run_one(spec: WorkerSpec, cmd: list[str]) -> tuple[WorkerSpec, int, str, str]:
    spec.out_subdir.mkdir(parents=True, exist_ok=True)
    t0 = time.time()
    log.info("[w%02d %s gpu%d] launch", spec.worker_idx, spec.host, spec.cuda_device)
    proc = subprocess.run(cmd, capture_output=True, text=True)
    dt = time.time() - t0
    log.info("[w%02d %s gpu%d] exit=%d in %.1fs", spec.worker_idx, spec.host,
             spec.cuda_device, proc.returncode, dt)
    return spec, proc.returncode, proc.stdout[-1500:], proc.stderr[-1500:]


def _merge_into_one_dir(specs: list[WorkerSpec], features_dir: Path, stem: str) -> int:
    """Move per-worker outputs into the single shared features_dir with renumbered
    part indices. Returns total parts merged."""
    n_parts = 0
    for spec in specs:
        for npy in sorted(spec.out_subdir.glob(f"{stem}.part*.npy")):
            csv_p = npy.with_name(npy.name.replace(".npy", "_windows.csv"))
            if not csv_p.exists():
                raise RuntimeError(f"missing windows csv for {npy}")
            new_npy = features_dir / f"{stem}.part{n_parts:04d}.npy"
            new_csv = features_dir / f"{stem}.part{n_parts:04d}_windows.csv"
            shutil.move(str(npy), str(new_npy))
            shutil.move(str(csv_p), str(new_csv))
            n_parts += 1
        # cleanup empty per-worker dir + manifest left behind
        for leftover in list(spec.out_subdir.glob("*")):
            try:
                leftover.unlink()
            except OSError:
                pass
        try:
            spec.out_subdir.rmdir()
        except OSError:
            pass
    return n_parts


def _build_lr_cmd(spec: WorkerSpec, *, fasta_path: Path, metadata_csv: Path,
                  out_prefix: Path, serve_root: Path, python_bin: Path,
                  npmaster_root: Path, torch_lib: str) -> list[str]:
    """Build cmd for the LR mean-pool 4096-d worker (one per GPU)."""
    inner = (
        f"cd {shlex.quote(str(serve_root.parent))} && "
        f"CUDA_VISIBLE_DEVICES={spec.cuda_device} "
        f"NPMASTER_REPO_ROOT={shlex.quote(str(npmaster_root))} "
        f"LD_LIBRARY_PATH={shlex.quote(torch_lib)}:${{LD_LIBRARY_PATH:-}} "
        f"PYTHONPATH={shlex.quote(str(serve_root.parent))}:${{PYTHONPATH:-}} "
        f"{shlex.quote(str(python_bin))} -m serve.lr_extract_worker "
        f"--fasta {shlex.quote(str(fasta_path))} "
        f"--metadata-csv {shlex.quote(str(metadata_csv))} "
        f"--window-ids-subset {shlex.quote(str(spec.subset_txt))} "
        f"--out-prefix {shlex.quote(str(out_prefix))}"
    )
    if spec.host == "localhost":
        return ["bash", "-c", inner]
    return ["ssh", "-o", "BatchMode=yes", spec.host, inner]


def _concat_lr_outputs(specs: list[WorkerSpec], out_dir: Path, stem: str) -> int:
    """Concatenate per-worker LR outputs into <stem>_embeddings.npy + _windows.csv."""
    import numpy as np

    out_dir.mkdir(parents=True, exist_ok=True)
    parts: list[tuple[Path, Path]] = []
    for spec in specs:
        prefix = spec.out_subdir / "lr"
        npy = Path(str(prefix) + "_embeddings.npy")
        csv_p = Path(str(prefix) + "_windows.csv")
        if npy.exists() and csv_p.exists():
            parts.append((npy, csv_p))
        elif npy.exists() or csv_p.exists():
            raise RuntimeError(f"partial LR output for worker {spec.worker_idx}: {npy} {csv_p}")
        # Empty subset is allowed (some buckets get 0 windows when total < N_workers).

    if not parts:
        raise RuntimeError("no LR worker produced any output")

    embs = [np.load(p) for p, _ in parts]
    emb_cat = np.concatenate(embs, axis=0)
    np.save(out_dir / f"{stem}_embeddings.npy", emb_cat)

    rows: list[list[str]] = []
    header: list[str] = []
    for _, csv_p in parts:
        with open(csv_p) as fh:
            rd = csv.reader(fh)
            file_header = next(rd, None)
            if file_header and not header:
                header = file_header
            for r in rd:
                rows.append(r)
    if not header:
        header = ["contig", "start", "end"]
    with open(out_dir / f"{stem}_windows.csv", "w", newline="") as fh:
        wr = csv.writer(fh)
        wr.writerow(header)
        wr.writerows(rows)

    log.info("lr concat: %d parts → %d rows × %d dims at %s/%s_*",
             len(parts), emb_cat.shape[0], emb_cat.shape[1], out_dir, stem)
    return emb_cat.shape[0]


def run_parallel_lr(*, fasta_path: Path, metadata_csv: Path, emb_dir: Path,
                    stem: str, work_dir: Path,
                    serve_root: Path, npmaster_root: Path, python_bin: Path,
                    torch_lib: str,
                    hosts: list[str], gpus_per_host: int) -> int:
    """Parallel 4096-dim mean-pool extract for the LR type classifier.

    Reuses metadata_csv (already produced by walk_fasta_to_metadata).
    Returns the number of windows in the merged output."""
    n_workers = len(hosts) * gpus_per_host
    subsets = partition_window_ids(metadata_csv, n_workers, work_dir / "lr_subsets")
    specs: list[WorkerSpec] = []
    for i in range(n_workers):
        host = hosts[i // gpus_per_host]
        cuda = i % gpus_per_host
        specs.append(WorkerSpec(
            worker_idx=i, host=host, cuda_device=cuda,
            subset_txt=subsets[i],
            out_subdir=work_dir / f"_lr_w{i:02d}",
        ))

    failures: list[tuple[WorkerSpec, int, str]] = []
    with ThreadPoolExecutor(max_workers=n_workers) as ex:
        futures = []
        for spec in specs:
            cmd = _build_lr_cmd(
                spec, fasta_path=fasta_path, metadata_csv=metadata_csv,
                out_prefix=spec.out_subdir / "lr",
                serve_root=serve_root, python_bin=python_bin,
                npmaster_root=npmaster_root, torch_lib=torch_lib,
            )
            futures.append(ex.submit(_run_one, spec, cmd))
        for fut in as_completed(futures):
            spec, rc, _, stderr = fut.result()
            if rc != 0:
                failures.append((spec, rc, stderr))

    if failures:
        details = "\n".join(
            f"[lr_w{s.worker_idx:02d} {s.host} gpu{s.cuda_device}] exit={rc}\n  stderr:\n{err[-800:]}"
            for s, rc, err in failures
        )
        raise RuntimeError(f"{len(failures)}/{n_workers} LR workers failed:\n{details}")

    n_windows = _concat_lr_outputs(specs, emb_dir, stem)
    # Cleanup per-worker dirs
    for spec in specs:
        for f in list(spec.out_subdir.glob("*")):
            try: f.unlink()
            except OSError: pass
        try: spec.out_subdir.rmdir()
        except OSError: pass
    return n_windows


def run_parallel(*, fasta_path: Path, features_dir: Path, stem: str,
                 repo_root: Path, python_bin: Path, torch_lib: str,
                 window: int, stride: int,
                 hosts: list[str], gpus_per_host: int,
                 work_dir: Path) -> int:
    """End-to-end parallel extraction. Returns number of part files produced."""
    features_dir.mkdir(parents=True, exist_ok=True)
    work_dir.mkdir(parents=True, exist_ok=True)

    # Stage 1: write metadata CSV
    metadata_csv = work_dir / "windows_metadata.csv"
    n_windows = walk_fasta_to_metadata(fasta_path, metadata_csv,
                                        window=window, stride=stride, stem=stem)
    log.info("walk: %d windows from %s", n_windows, fasta_path.name)
    if n_windows == 0:
        raise RuntimeError("FASTA produced 0 windows after filtering")

    # Stage 2: provide a genome-dir with <stem>.fna for the script
    genome_dir = work_dir / "genome"
    genome_dir.mkdir(exist_ok=True)
    genome_link = genome_dir / f"{stem}.fna"
    if genome_link.exists() or genome_link.is_symlink():
        genome_link.unlink()
    genome_link.symlink_to(fasta_path.resolve())

    # Stage 3: build worker specs (round-robin GPUs across hosts)
    n_workers = len(hosts) * gpus_per_host
    subsets = partition_window_ids(metadata_csv, n_workers, work_dir / "subsets")
    specs: list[WorkerSpec] = []
    for i in range(n_workers):
        host = hosts[i // gpus_per_host]
        cuda = i % gpus_per_host
        specs.append(WorkerSpec(
            worker_idx=i, host=host, cuda_device=cuda,
            subset_txt=subsets[i],
            out_subdir=features_dir / f"_w{i:02d}",
        ))

    # Stage 4: launch all in parallel, wait for completion
    failures: list[tuple[WorkerSpec, int, str]] = []
    with ThreadPoolExecutor(max_workers=n_workers) as ex:
        futures = []
        for spec in specs:
            cmd = _build_cmd(spec, repo_root=repo_root, python_bin=python_bin,
                             metadata_csv=metadata_csv, genome_dir=genome_dir,
                             stem=stem, window=window, stride=stride,
                             torch_lib=torch_lib)
            futures.append(ex.submit(_run_one, spec, cmd))
        for fut in as_completed(futures):
            spec, rc, _, stderr = fut.result()
            if rc != 0:
                failures.append((spec, rc, stderr))

    if failures:
        details = "\n".join(
            f"[w{s.worker_idx:02d} {s.host} gpu{s.cuda_device}] exit={rc}\n  stderr:\n{err[-800:]}"
            for s, rc, err in failures
        )
        raise RuntimeError(f"{len(failures)}/{n_workers} workers failed:\n{details}")

    # Stage 5: merge per-worker parts into shared features_dir under one stem
    n_parts = _merge_into_one_dir(specs, features_dir, stem)
    log.info("merged %d parts into %s", n_parts, features_dir)
    return n_parts
