from __future__ import annotations

from pathlib import Path


def features_dir_for(cache_root: Path, sha256: str) -> Path:
    return cache_root / "features" / sha256


def is_features_ready(features_dir: Path) -> bool:
    """Cached extraction is considered complete iff DONE marker + at least
    one .partNNNN.npy + matching _windows.csv all exist."""
    if not (features_dir / "DONE").exists():
        return False
    npys = list(features_dir.glob("*.part*.npy"))
    if not npys:
        return False
    csvs = list(features_dir.glob("*.part*_windows.csv"))
    return len(csvs) == len(npys)


def features_dir_size_bytes(features_dir: Path) -> int:
    total = 0
    for p in features_dir.rglob("*"):
        if p.is_file():
            total += p.stat().st_size
    return total
