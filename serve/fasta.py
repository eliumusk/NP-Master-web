from __future__ import annotations

import hashlib
from pathlib import Path


class InvalidFasta(ValueError):
    pass


def sha256_file(path: Path, chunk: int = 1 << 20) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        while True:
            block = f.read(chunk)
            if not block:
                break
            h.update(block)
    return h.hexdigest()


def validate_fasta(path: Path, min_acgtn_ratio: float = 0.90, sample_bytes: int = 1 << 20) -> None:
    """Sniff the first chunk of the file. Raises InvalidFasta on problems.

    Checks:
    - first non-empty line starts with '>'
    - first 1MB of sequence content is at least 90% ACGTN (case-insensitive)"""
    seq_chars = []
    head_ok = False
    with open(path, "rb") as f:
        head = f.read(sample_bytes)
    if not head:
        raise InvalidFasta("empty file")
    text = head.decode("utf-8", errors="replace")
    for line in text.splitlines():
        if not line.strip():
            continue
        if not head_ok:
            if not line.startswith(">"):
                raise InvalidFasta("file does not start with a FASTA header line ('>')")
            head_ok = True
            continue
        if line.startswith(">"):
            continue
        seq_chars.append(line.strip().upper())
    if not head_ok:
        raise InvalidFasta("no FASTA header found")
    if not seq_chars:
        return  # only headers in sample; tolerate (multi-contig with long IDs)
    flat = "".join(seq_chars)
    allowed = set("ACGTN")
    n_ok = sum(1 for c in flat if c in allowed)
    ratio = n_ok / max(1, len(flat))
    if ratio < min_acgtn_ratio:
        raise InvalidFasta(f"sequence content is only {ratio:.1%} ACGTN; refusing")


def write_faidx(fasta_path: Path, fai_path: Path) -> None:
    """Write a samtools-compatible .fai index for a FASTA.

    Each record line: name<TAB>length<TAB>offset<TAB>linebases<TAB>linewidth.
    Assumes each contig has uniform line width (samtools convention)."""
    fai_path.parent.mkdir(parents=True, exist_ok=True)
    out_lines: list[str] = []
    with open(fasta_path, "rb") as f:
        cur_name: str | None = None
        cur_len = 0
        cur_offset = 0
        cur_linebases = 0
        cur_linewidth = 0
        seen_first_line = False
        pos = 0
        while True:
            line = f.readline()
            if not line:
                if cur_name is not None:
                    out_lines.append(
                        f"{cur_name}\t{cur_len}\t{cur_offset}\t{cur_linebases}\t{cur_linewidth}"
                    )
                break
            if line.startswith(b">"):
                if cur_name is not None:
                    out_lines.append(
                        f"{cur_name}\t{cur_len}\t{cur_offset}\t{cur_linebases}\t{cur_linewidth}"
                    )
                name = line[1:].split(maxsplit=1)[0].decode("ascii", errors="replace")
                cur_name = name
                cur_len = 0
                cur_offset = pos + len(line)
                cur_linebases = 0
                cur_linewidth = 0
                seen_first_line = False
            else:
                stripped = line.rstrip(b"\r\n")
                lb = len(stripped)
                lw = len(line)
                cur_len += lb
                if not seen_first_line:
                    cur_linebases = lb
                    cur_linewidth = lw
                    seen_first_line = True
            pos += len(line)
    fai_path.write_text("\n".join(out_lines) + ("\n" if out_lines else ""))


def csv_regions_to_bed(csv_path: Path, bed_path: Path, name_prefix: str = "BGC") -> int:
    """Convert decoder CSV (genome,contig,start,end,score,type) to a 5-col BED.

    Returns the number of records written."""
    import csv as _csv

    bed_path.parent.mkdir(parents=True, exist_ok=True)
    n = 0
    with open(csv_path, newline="") as fin, open(bed_path, "w") as fout:
        rd = _csv.DictReader(fin)
        for i, row in enumerate(rd, start=1):
            score_int = max(0, min(1000, int(round(float(row["score"]) * 1000))))
            name = f"{name_prefix}_{i:04d}"
            fout.write(f"{row['contig']}\t{row['start']}\t{row['end']}\t{name}\t{score_int}\n")
            n += 1
    return n
