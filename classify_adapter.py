"""Bridge per-token U-Net features to the per-window LR type classifier.

The classifier (scripts/classify/evo2_lr_regions.py) was trained on the
evo2_lr_multiscale line, which expects:
  <emb_dir>/<genome>_embeddings.npy   shape (N_windows, D)
  <emb_dir>/<genome>_windows.csv      columns include contig,start,end

Our pipeline produces per-token features:
  cache/features/<sha>/<stem>.part*.npy   shape (N_part, T_latent, D)
  cache/features/<sha>/<stem>.part*_windows.csv

This module concatenates the parts, mean-pools across T_latent to recover
per-window embeddings, and writes them in the layout the classifier expects.
"""
from __future__ import annotations

import csv
import logging
from pathlib import Path

import numpy as np
import pandas as pd

log = logging.getLogger(__name__)


def prepare_per_window_embeddings(features_dir: Path, stem: str, out_dir: Path) -> Path:
    """Build an emb-dir compatible with evo2_lr_regions.py.

    Returns out_dir; writes:
      <out_dir>/<stem>_embeddings.npy   (N_windows, D) float32
      <out_dir>/<stem>_windows.csv      concatenated rows
    """
    out_dir.mkdir(parents=True, exist_ok=True)
    parts = sorted(features_dir.glob(f"{stem}.part*.npy"))
    if not parts:
        raise FileNotFoundError(f"no part npy files under {features_dir} for stem {stem}")

    pooled_chunks: list[np.ndarray] = []
    csv_chunks: list[pd.DataFrame] = []
    for npy_p in parts:
        csv_p = npy_p.with_name(npy_p.name.replace(".npy", "_windows.csv"))
        if not csv_p.exists():
            raise FileNotFoundError(f"missing windows csv for {npy_p.name}")
        arr = np.load(npy_p, mmap_mode="r")  # (N_part, T, D) fp16
        pooled = np.asarray(arr, dtype=np.float32).mean(axis=1)  # (N_part, D) fp32
        pooled_chunks.append(pooled)
        csv_chunks.append(pd.read_csv(csv_p))

    emb = np.concatenate(pooled_chunks, axis=0)
    wins = pd.concat(csv_chunks, axis=0, ignore_index=True)
    if len(emb) != len(wins):
        raise RuntimeError(f"row mismatch: emb={len(emb)} csv={len(wins)}")

    out_emb = out_dir / f"{stem}_embeddings.npy"
    out_csv = out_dir / f"{stem}_windows.csv"
    np.save(out_emb, emb)
    wins.to_csv(out_csv, index=False)
    log.info("classify_adapter: %d windows × %d dims → %s", emb.shape[0], emb.shape[1], out_dir)
    return out_dir
