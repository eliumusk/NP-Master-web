"""Smoke tests for the serve/ web pipeline.

Marked `web` so they're skipped by default — they need GPU + Evo2 + a small
fixture FASTA. Run explicitly with:

    pytest -m web tests/test_web_pipeline.py -q

The Supabase-dependent test ('--once' against a live project) lives in
test_web_e2e.py (not committed yet).
"""
from __future__ import annotations

import hashlib
from pathlib import Path

import pytest

pytestmark = pytest.mark.web


def test_fasta_validation_accepts_real_fasta(tmp_path: Path) -> None:
    from serve.fasta import validate_fasta

    p = tmp_path / "ok.fasta"
    p.write_text(">seq1\n" + "ACGTNACGTN" * 1000 + "\n")
    validate_fasta(p)  # no raise


def test_fasta_validation_rejects_garbage(tmp_path: Path) -> None:
    from serve.fasta import InvalidFasta, validate_fasta

    p = tmp_path / "bad.fasta"
    p.write_text("this is not a fasta\nlots of text without > prefix\n")
    with pytest.raises(InvalidFasta):
        validate_fasta(p)


def test_fasta_validation_rejects_low_acgtn_ratio(tmp_path: Path) -> None:
    from serve.fasta import InvalidFasta, validate_fasta

    p = tmp_path / "low.fasta"
    p.write_text(">seq\n" + ("XYZQ" * 1000) + "\n")
    with pytest.raises(InvalidFasta):
        validate_fasta(p)


def test_sha256_file_matches_python_hashlib(tmp_path: Path) -> None:
    from serve.fasta import sha256_file

    p = tmp_path / "blob.bin"
    data = b"abc123" * 4096
    p.write_bytes(data)
    expected = hashlib.sha256(data).hexdigest()
    assert sha256_file(p) == expected


def test_write_faidx_matches_samtools_format(tmp_path: Path) -> None:
    from serve.fasta import write_faidx

    fasta = tmp_path / "g.fasta"
    fasta.write_text(">contig1\nACGT\nACGT\nAC\n>contig2\nNNNN\n")
    fai = tmp_path / "g.fasta.fai"
    write_faidx(fasta, fai)
    rows = [line.split("\t") for line in fai.read_text().strip().splitlines()]
    names = [r[0] for r in rows]
    lengths = [int(r[1]) for r in rows]
    assert names == ["contig1", "contig2"]
    assert lengths == [10, 4]


def test_csv_to_bed_score_scaling_and_color(tmp_path: Path) -> None:
    from serve.fasta import csv_regions_to_bed

    csv_in = tmp_path / "regions.csv"
    csv_in.write_text(
        "genome,contig,start,end,score,type,v4_1_type,v4_1_type_score\n"
        "g,c1,100,2200,0.873,,NRP,0.91\n"
        "g,c2,500,3500,0.4,,Terpene,0.55\n"
        "g,c3,1000,3500,0.6,,,\n"  # no v4_1_type → falls back to Other
    )
    bed_out = tmp_path / "regions.bed"
    n = csv_regions_to_bed(csv_in, bed_out)
    assert n == 3
    rows = [line.split("\t") for line in bed_out.read_text().strip().splitlines()]
    # BED9: contig start end name score strand thickStart thickEnd itemRgb
    assert all(len(r) == 9 for r in rows)
    assert rows[0][:3] == ["c1", "100", "2200"]
    assert int(rows[0][4]) == 873
    assert rows[0][8] == "37,99,235"      # NRP = blue
    assert rows[1][8] == "22,163,74"      # Terpene = green
    assert rows[2][8] == "100,116,139"    # missing → Other = slate
    # name encodes type for human readability
    assert rows[0][3].endswith("_NRP")
