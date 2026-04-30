"""Per-worker 4096-dim mean-pool Evo2 extraction for the LR type classifier.

Reuses the windows_metadata.csv produced for the per-token path. Each worker
takes a window-id subset, walks the same FASTA, extracts Evo2 mean-pool
features for ITS subset only, and writes:

  <out_prefix>_embeddings.npy   (N_subset, 4096) fp16
  <out_prefix>_windows.csv      contig,start,end (preserves order)

Designed to be invoked as a subprocess (one per GPU) by serve.parallel_extract.

Usage:
    python -m serve.lr_extract_worker \
        --fasta <fna> --metadata-csv <meta.csv> \
        --window-ids-subset <subset.txt> --out-prefix <prefix> \
        [--layer blocks.20.mlp.l3] [--batch-size 1]
"""
from __future__ import annotations

import argparse
import csv
import os
import sys
import time
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
NPMASTER_ROOT = Path(os.environ.get("NPMASTER_REPO_ROOT", "/data/muskliu/npmaster"))
# Reuse research codebase's tokenizer + projection-free extract helpers.
sys.path.insert(0, str(NPMASTER_ROOT / "src"))


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--fasta", type=Path, required=True)
    p.add_argument("--metadata-csv", type=Path, required=True)
    p.add_argument("--window-ids-subset", type=Path, required=True)
    p.add_argument("--out-prefix", type=Path, required=True,
                   help="Output prefix; writes <prefix>_embeddings.npy + <prefix>_windows.csv")
    p.add_argument("--layer", default="blocks.20.mlp.l3")
    p.add_argument("--batch-size", type=int, default=1)
    p.add_argument("--evo-model", default="evo2_7b")
    p.add_argument("--cache-dir", default="/data/public_models/hub")
    p.add_argument("--dtype", default="fp16")
    args = p.parse_args()

    import numpy as np

    os.environ.setdefault("HF_HUB_CACHE", args.cache_dir)
    os.environ.setdefault("HF_HUB_OFFLINE", "1")

    from evo2_lr.extract import (  # noqa: E402  (import after sys.path mutation)
        _extract_mean_pool_batched,
        read_fna,
        truncate_blocks_to_layer,
    )
    from evo2 import Evo2  # noqa: E402

    # 1. Build the in-FASTA-order list of (window_id, contig, start, end).
    keep_ids = {ln.strip() for ln in open(args.window_ids_subset) if ln.strip()}
    subset_meta: list[tuple[str, str, int, int]] = []
    with open(args.metadata_csv) as fh:
        rd = csv.DictReader(fh)
        for row in rd:
            if row["window_id"] in keep_ids:
                subset_meta.append((
                    row["window_id"], row["contig_id"],
                    int(row["window_start"]), int(row["window_end"]),
                ))
    if not subset_meta:
        print(f"[lr_extract] subset is empty (window_ids_subset={args.window_ids_subset})", flush=True)
        return 0

    # 2. Slice all needed sequences from the FASTA (load each contig once).
    print(f"[lr_extract] reading FASTA {args.fasta} (workers handles {len(subset_meta)} windows)", flush=True)
    contigs = {cid: seq for cid, seq in read_fna(args.fasta)}
    sequences: list[str] = []
    coords: list[tuple[str, int, int]] = []
    for wid, contig, start, end in subset_meta:
        if contig not in contigs:
            print(f"[lr_extract] WARN: contig {contig!r} missing in FASTA; skipping window {wid}", flush=True)
            continue
        sub = contigs[contig][start:end]
        if len(sub) < (end - start):
            sub = sub + ("N" * ((end - start) - len(sub)))
        sequences.append(sub)
        coords.append((contig, start, end))

    # 3. Load Evo2, truncate to layer, run mean-pool over windows.
    print(f"[lr_extract] loading Evo2 {args.evo_model}...", flush=True)
    t0 = time.time()
    evo2_model = Evo2(args.evo_model)
    print(f"[lr_extract] Evo2 loaded in {time.time() - t0:.1f}s", flush=True)
    info = truncate_blocks_to_layer(evo2_model, args.layer)
    print(f"[lr_extract] truncate: {info}", flush=True)

    dtype_np = np.float16 if args.dtype == "fp16" else np.float32
    print(f"[lr_extract] forward over {len(sequences)} windows...", flush=True)
    t1 = time.time()
    emb = _extract_mean_pool_batched(
        evo2_model, sequences, args.layer, batch_size=args.batch_size,
    ).astype(dtype_np)
    print(f"[lr_extract] forward done in {time.time() - t1:.1f}s; shape={emb.shape}", flush=True)

    # 4. Write subset outputs (worker-scoped; main proc will concatenate).
    out_npy = Path(str(args.out_prefix) + "_embeddings.npy")
    out_csv = Path(str(args.out_prefix) + "_windows.csv")
    out_npy.parent.mkdir(parents=True, exist_ok=True)
    np.save(out_npy, emb)
    with open(out_csv, "w", newline="") as fh:
        wr = csv.writer(fh)
        wr.writerow(["contig", "start", "end"])
        wr.writerows(coords)
    print(f"[lr_extract] wrote {out_npy.name} ({emb.shape}) and {out_csv.name}", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
