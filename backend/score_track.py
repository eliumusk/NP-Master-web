"""Convert per-token U-Net probabilities into a binned bedgraph for IGV display.

The worker writes its sigmoid output as <stem>.probs.npz (one (T_latent,) array
per window_id) and <stem>.coords.csv (contig + window coords). We assemble those
back into a per-nucleotide track (mean over overlapping windows) and bin to
64 bp using max-pool, dropping zero-bins to keep the file small enough for
igv.js to load over a signed URL.
"""
from __future__ import annotations

import csv
import logging
from collections import defaultdict
from pathlib import Path

import numpy as np

log = logging.getLogger(__name__)


def write_bedgraph(*, probs_npz: Path, coords_csv: Path, out_path: Path,
                   bin_bp: int = 64, latent_per_bp: int = 8) -> int:
    """Returns the number of bedgraph lines written (excluding header)."""
    if not probs_npz.exists() or not coords_csv.exists():
        raise FileNotFoundError(f"missing input: {probs_npz} or {coords_csv}")

    coords: dict[str, tuple[str, int, int]] = {}
    with open(coords_csv) as fh:
        for row in csv.DictReader(fh):
            coords[row["window_id"]] = (
                row["contig"], int(row["start"]), int(row["end"]),
            )

    probs = np.load(probs_npz)
    by_contig: dict[str, tuple[np.ndarray, np.ndarray]] = {}

    for wid in probs.files:
        if wid not in coords:
            continue
        contig, start, end = coords[wid]
        p_latent = probs[wid].astype(np.float32)
        # Upsample latent → per-bp by repeat
        p_nt = np.repeat(p_latent, latent_per_bp)
        L = end - start
        if p_nt.size >= L:
            p_nt = p_nt[:L]
        else:
            p_nt = np.concatenate([p_nt, np.zeros(L - p_nt.size, dtype=np.float32)])

        if contig not in by_contig:
            by_contig[contig] = (
                np.zeros(end, dtype=np.float32),
                np.zeros(end, dtype=np.int32),
            )
        acc, cnt = by_contig[contig]
        if end > acc.size:
            new_sz = max(end, int(acc.size * 1.5))
            new_acc = np.zeros(new_sz, dtype=np.float32); new_acc[:acc.size] = acc
            new_cnt = np.zeros(new_sz, dtype=np.int32); new_cnt[:cnt.size] = cnt
            acc, cnt = new_acc, new_cnt
            by_contig[contig] = (acc, cnt)
        acc[start:end] += p_nt
        cnt[start:end] += 1

    out_path.parent.mkdir(parents=True, exist_ok=True)
    n_lines = 0
    with open(out_path, "w") as f:
        f.write('track type=bedGraph name="BGC score" description="Evo2 + U-Net per-token sigmoid (max-pooled to ' + str(bin_bp) + 'bp)"\n')
        for contig, (acc, cnt) in by_contig.items():
            track = np.where(cnt > 0, acc / np.maximum(cnt, 1), 0.0).astype(np.float32)
            n_bins = (track.size + bin_bp - 1) // bin_bp
            for i in range(n_bins):
                s = i * bin_bp
                e = min(s + bin_bp, track.size)
                v = float(track[s:e].max())
                if v >= 0.01:        # drop near-zero bins to shrink file
                    f.write(f"{contig}\t{s}\t{e}\t{v:.4f}\n")
                    n_lines += 1

    log.info("score_track: %d bedgraph lines (bin=%dbp) → %s", n_lines, bin_bp, out_path)
    return n_lines
