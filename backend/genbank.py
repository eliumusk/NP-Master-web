"""Generate a GenBank file from decoded BGC regions + prodigal CDS calls.

Output layout: one LOCUS per region, with:
  - Source feature spanning the slice, annotated with BGC type / score / origin
  - CDS features from prodigal -p meta on each slice
  - LOCUS name = region index (BGC_0001 ...), keeps under the 16-char limit

This mirrors antiSMASH's per-region GenBank output enough that the file can be
consumed by other downstream tools without modification.
"""
from __future__ import annotations

import csv
import logging
import subprocess
from pathlib import Path

log = logging.getLogger(__name__)


def _read_fasta(path: Path) -> dict[str, str]:
    contigs: dict[str, str] = {}
    cur_id: str | None = None
    cur: list[str] = []
    with open(path) as f:
        for line in f:
            if line.startswith(">"):
                if cur_id is not None:
                    contigs[cur_id] = "".join(cur)
                cur_id = line[1:].split()[0]
                cur = []
            else:
                cur.append(line.strip().upper())
    if cur_id is not None:
        contigs[cur_id] = "".join(cur)
    return contigs


def _read_regions(csv_path: Path) -> list[dict]:
    out: list[dict] = []
    with open(csv_path, newline="") as fh:
        for i, row in enumerate(csv.DictReader(fh), start=1):
            out.append({
                "name": f"BGC_{i:04d}",
                "contig": row["contig"],
                "start": int(row["start"]),
                "end": int(row["end"]),
                "score": float(row["score"]),
                "type": (row.get("v4_1_type") or "Other").strip() or "Other",
                "type_score": _parse_float(row.get("v4_1_type_score")),
            })
    return out


def _parse_float(v) -> float | None:
    if v is None or v == "":
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _run_prodigal_batch(prodigal_bin: Path, in_fa: Path, out_gff: Path) -> None:
    """Single prodigal call across a multi-FASTA of region slices."""
    proc = subprocess.run(
        [str(prodigal_bin), "-p", "meta", "-f", "gff",
         "-i", str(in_fa), "-o", str(out_gff)],
        capture_output=True, text=True,
    )
    if proc.returncode != 0:
        raise RuntimeError(f"prodigal failed: {proc.stderr[-1000:]}")


def _parse_gff(gff_path: Path) -> dict[str, list[dict]]:
    """Group CDS features by seqid (=region name)."""
    by_seq: dict[str, list[dict]] = {}
    with open(gff_path) as fh:
        for line in fh:
            if line.startswith("#") or not line.strip():
                continue
            parts = line.rstrip("\n").split("\t")
            if len(parts) < 9:
                continue
            seqid, _, ftype, start, end, _, strand, _, attrs = parts
            if ftype != "CDS":
                continue
            by_seq.setdefault(seqid, []).append({
                "start": int(start),     # GFF is 1-based inclusive
                "end": int(end),
                "strand": 1 if strand == "+" else -1,
                "attrs": attrs,
            })
    return by_seq


def generate_genbank(*, fasta_path: Path, regions_csv: Path,
                     out_gbk_path: Path, prodigal_bin: Path,
                     work_dir: Path) -> int:
    """Build a multi-LOCUS GenBank file from regions + prodigal CDS calls."""
    from Bio.Seq import Seq
    from Bio.SeqRecord import SeqRecord
    from Bio.SeqFeature import SeqFeature, FeatureLocation
    from Bio import SeqIO

    work_dir.mkdir(parents=True, exist_ok=True)
    out_gbk_path.parent.mkdir(parents=True, exist_ok=True)

    contigs = _read_fasta(fasta_path)
    regions = _read_regions(regions_csv)
    if not regions:
        # Empty GenBank file is valid but bare; emit a placeholder header.
        out_gbk_path.write_text("# No BGC regions detected at the chosen threshold.\n")
        return 0

    # Stage 1: write a multi-FASTA with one record per region slice.
    slices_fa = work_dir / "region_slices.fa"
    with open(slices_fa, "w") as f:
        for r in regions:
            seq = contigs.get(r["contig"], "")
            sub = seq[r["start"]:r["end"]]
            if not sub:
                continue
            f.write(f">{r['name']}\n{sub}\n")

    # Stage 2: prodigal on the batched slices (~few seconds for 32 regions).
    gff_path = work_dir / "region_slices.gff"
    _run_prodigal_batch(prodigal_bin, slices_fa, gff_path)
    cds_by_region = _parse_gff(gff_path)

    # Stage 3: build SeqRecords.
    records: list[SeqRecord] = []
    for r in regions:
        seq = contigs.get(r["contig"], "")
        sub = seq[r["start"]:r["end"]]
        if not sub:
            continue
        rec = SeqRecord(
            Seq(sub),
            id=r["name"],
            name=r["name"][:16],     # GenBank LOCUS limit
            description=f"BGC region; type={r['type']}; score={r['score']:.3f}; source={r['contig']}:{r['start']}-{r['end']}",
            annotations={
                "molecule_type": "DNA",
                "organism": "predicted by NP-Master",
                "topology": "linear",
                "date": "01-JAN-2026",
            },
        )

        # Source feature carries provenance.
        source_quals = {
            "organism": ["predicted by NP-Master"],
            "source_contig": [r["contig"]],
            "source_start": [str(r["start"])],
            "source_end": [str(r["end"])],
            "bgc_type": [r["type"]],
            "bgc_score": [f"{r['score']:.4f}"],
        }
        if r["type_score"] is not None:
            source_quals["bgc_type_score"] = [f"{r['type_score']:.4f}"]
        rec.features.append(SeqFeature(
            FeatureLocation(0, len(sub)),
            type="source",
            qualifiers=source_quals,
        ))

        # CDS features from prodigal.
        for j, cds in enumerate(cds_by_region.get(r["name"], []), start=1):
            cds_seq = Seq(sub[cds["start"] - 1: cds["end"]])
            if cds["strand"] == -1:
                cds_seq = cds_seq.reverse_complement()
            try:
                aa = str(cds_seq.translate(table=11, to_stop=False))
            except Exception:
                aa = ""
            rec.features.append(SeqFeature(
                FeatureLocation(cds["start"] - 1, cds["end"], strand=cds["strand"]),
                type="CDS",
                qualifiers={
                    "locus_tag": [f"{r['name']}_CDS_{j:03d}"],
                    "product": ["hypothetical protein"],
                    "note": [cds["attrs"]],
                    "transl_table": ["11"],
                    "translation": [aa],
                },
            ))

        records.append(rec)

    with open(out_gbk_path, "w") as fh:
        SeqIO.write(records, fh, "genbank")
    log.info("genbank: %d records written to %s", len(records), out_gbk_path)
    return len(records)
