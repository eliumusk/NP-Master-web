from __future__ import annotations

import csv
import subprocess
from pathlib import Path
from typing import Any


def wrap_fasta(seq: str, width: int = 80) -> str:
    return "\n".join(seq[i : i + width] for i in range(0, len(seq), width))


def read_fasta(path: Path) -> dict[str, str]:
    contigs: dict[str, str] = {}
    cur_id: str | None = None
    cur: list[str] = []
    with open(path) as handle:
        for line in handle:
            if line.startswith(">"):
                if cur_id is not None:
                    contigs[cur_id] = "".join(cur).upper()
                cur_id = line[1:].split()[0]
                cur = []
            else:
                cur.append(line.strip())
    if cur_id is not None:
        contigs[cur_id] = "".join(cur).upper()
    return contigs


def _run_prodigal(prodigal_bin: Path, fasta_path: Path, out_dir: Path) -> tuple[Path, Path]:
    faa = out_dir / "all_cds.faa"
    fna = out_dir / "all_cds.fna"
    gff = out_dir / "all_cds.gff"
    cmd = [
        str(prodigal_bin),
        "-p", "meta",
        "-q",
        "-i", str(fasta_path),
        "-a", str(faa),
        "-d", str(fna),
        "-o", str(gff),
        "-f", "gff",
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        raise RuntimeError(f"prodigal failed:\n{proc.stderr[-2000:]}")
    return faa, fna


def _read_prodigal_fasta(path: Path) -> dict[str, dict[str, Any]]:
    records: dict[str, dict[str, Any]] = {}
    cur_id: str | None = None
    cur_desc = ""
    cur_seq: list[str] = []

    def flush() -> None:
        if cur_id is None:
            return
        header = cur_desc
        parts = [p.strip() for p in header.split("#")]
        gene_name = parts[0].split()[0]
        contig = gene_name.rsplit("_", 1)[0]
        try:
            start0 = int(parts[1]) - 1
            end0 = int(parts[2])
            strand = int(parts[3])
        except (IndexError, ValueError):
            start0, end0, strand = 0, 0, 1
        records[gene_name] = {
            "contig": contig,
            "start": start0,
            "end": end0,
            "strand": strand,
            "sequence": "".join(cur_seq).rstrip("*"),
        }

    with open(path) as handle:
        for line in handle:
            if line.startswith(">"):
                flush()
                cur_desc = line[1:].strip()
                cur_id = cur_desc.split()[0]
                cur_seq = []
            else:
                cur_seq.append(line.strip())
        flush()
    return records


def write_extended_outputs(
    *,
    fasta_path: Path,
    rows: list[dict[str, Any]],
    out_dir: Path,
    genome_name: str,
    prodigal_bin: Path,
    flank_bp: int,
) -> dict[str, Path]:
    """Write extended safe-pass region DNA and CDS outputs.

    All rows receive ext_start/ext_end fields. CDS outputs are restricted to
    rows whose safe_pass is true, matching the BGCMaster export contract.
    """
    out_dir.mkdir(parents=True, exist_ok=True)
    contigs = read_fasta(fasta_path)
    contig_lens = {name: len(seq) for name, seq in contigs.items()}

    for row in rows:
        contig = str(row["contig"])
        contig_len = contig_lens.get(contig, 0)
        start = int(row["start"])
        end = int(row["end"])
        row["ext_start"] = max(0, start - flank_bp)
        row["ext_end"] = min(contig_len, end + flank_bp) if contig_len else end + flank_bp

    regions_fna = out_dir / "extended_regions.fna"
    cds_faa = out_dir / "extended_cds.faa"
    cds_fna = out_dir / "extended_cds.fna"
    cds_csv = out_dir / "extended_cds.csv"
    safe_rows = [row for row in rows if bool(row.get("safe_pass"))]

    with open(regions_fna, "w") as handle:
        for row in safe_rows:
            seq = contigs.get(str(row["contig"]), "")
            ext_start = int(row["ext_start"])
            ext_end = int(row["ext_end"])
            subseq = seq[ext_start:ext_end]
            if not subseq:
                continue
            label = row.get("safe_type_label") or row.get("v4_1_type") or "BGC"
            handle.write(
                f">{genome_name}|{row['contig']}|{row['bgc_id']}|{ext_start}-{ext_end}|{label}\n"
                f"{wrap_fasta(subseq)}\n"
            )

    cds_rows: list[dict[str, Any]] = []
    if safe_rows:
        work_dir = out_dir / "_prodigal"
        work_dir.mkdir(parents=True, exist_ok=True)
        faa_all, fna_all = _run_prodigal(prodigal_bin, fasta_path, work_dir)
        aa = _read_prodigal_fasta(faa_all)
        nt = _read_prodigal_fasta(fna_all)
        genes_by_contig: dict[str, list[tuple[str, dict[str, Any]]]] = {}
        for gene_id, meta in aa.items():
            genes_by_contig.setdefault(str(meta["contig"]), []).append((gene_id, meta))

        with open(cds_faa, "w") as faa_out, open(cds_fna, "w") as fna_out:
            for row in safe_rows:
                contig = str(row["contig"])
                ext_start = int(row["ext_start"])
                ext_end = int(row["ext_end"])
                for gene_id, meta in genes_by_contig.get(contig, []):
                    gene_start = int(meta["start"])
                    gene_end = int(meta["end"])
                    if gene_start >= ext_end or gene_end <= ext_start:
                        continue
                    strand = "+" if int(meta["strand"]) == 1 else "-"
                    aa_seq = str(meta.get("sequence") or "")
                    nt_seq = str((nt.get(gene_id) or {}).get("sequence") or "")
                    header = f"{genome_name}|{contig}|{row['bgc_id']}|{gene_id}|{gene_start}-{gene_end}{strand}"
                    if aa_seq:
                        faa_out.write(f">{header}\n{wrap_fasta(aa_seq)}\n")
                    if nt_seq:
                        fna_out.write(f">{header}\n{wrap_fasta(nt_seq)}\n")
                    cds_rows.append({
                        "genome": genome_name,
                        "contig": contig,
                        "bgc_id": row["bgc_id"],
                        "bgc_type": row.get("v4_1_type") or "",
                        "safe_type_label": row.get("safe_type_label") or "",
                        "region_ext_start": ext_start,
                        "region_ext_end": ext_end,
                        "locus_tag": gene_id,
                        "cds_start": gene_start,
                        "cds_end": gene_end,
                        "strand": strand,
                        "length_aa": len(aa_seq),
                        "aa_sequence": aa_seq,
                        "nt_sequence": nt_seq,
                    })
    else:
        cds_faa.write_text("")
        cds_fna.write_text("")

    fieldnames = [
        "genome", "contig", "bgc_id", "bgc_type", "safe_type_label",
        "region_ext_start", "region_ext_end", "locus_tag", "cds_start",
        "cds_end", "strand", "length_aa", "aa_sequence", "nt_sequence",
    ]
    with open(cds_csv, "w", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(cds_rows)

    return {
        "extended_regions_fna": regions_fna,
        "extended_cds_faa": cds_faa,
        "extended_cds_fna": cds_fna,
        "extended_cds_csv": cds_csv,
    }
