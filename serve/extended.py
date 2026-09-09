from __future__ import annotations

import csv
import logging
import subprocess
from pathlib import Path
from typing import Any

log = logging.getLogger(__name__)


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


def _biosynth_terms() -> list[str]:
    """Combined biosynthesis-related keyword list from serve.safe term groups."""
    from . import safe

    names = [
        "TAILORING_TERMS", "TRANSPORT_TERMS", "REGULATORY_TERMS",
        "PKS_KS_TERMS", "PKS_AT_TERMS", "PKS_ACP_TERMS", "PKS_REDUCING_TERMS",
        "TYPEII_PKS_TERMS", "NRPS_A_TERMS", "NRPS_C_TERMS", "NRPS_PCP_TERMS",
        "NRPS_TE_TERMS", "RIPP_TERMS", "TERPENE_TERMS", "SACCHARIDE_TERMS",
        "RESISTANCE_TERMS",
    ]
    terms: list[str] = []
    for name in names:
        group = getattr(safe, name, None)
        if group:
            terms.extend(group)
    return terms


def apply_evidence_extension(
    *,
    rows: list[dict[str, Any]],
    genes_by_contig: dict[str, list[dict[str, Any]]],
    contig_lens: dict[str, int],
    flank_bp: int,
    work_dir: Path,
    pfam_db: Path | None,
    hmmer_bin: Path | None,
    threads: int = 8,
    e_cutoff: float = 1e-5,
    search_bp: int = 25_000,
    max_gap_bp: int = 3_000,
    max_non_biosynth_run: int = 2,
) -> dict[str, list[dict[str, Any]]]:
    """Extend ext_start/ext_end beyond the fixed flank using Pfam evidence.

    For each region side, walk outward gene by gene from the region boundary:
    while the next CDS carries a biosynthesis-related Pfam domain (keyword
    match on the significant domain name + description) and the gap to the
    current edge is <= max_gap_bp, extend the edge to that CDS's end. The walk
    stops at the first "non-biosynthetic desert" — max_non_biosynth_run
    consecutive CDS without a biosynthesis-related domain — so a single
    unannotated CDS inside an otherwise biosynthetic chain does not truncate
    the extension. Each side extends at most flank_bp + search_bp from the
    boundary, and the result never shrinks below the fixed flank. On any
    hmmscan problem the rows keep their fixed-flank coordinates.

    genes_by_contig values are dicts with locus_tag/start/end/sequence keys
    (sequence = amino acids). Rows must already carry fixed-flank
    ext_start/ext_end and ext_method="fixed_flank".

    Returns the parsed flank-hmmscan domtblout as {locus_tag: [domain_hit, ...]}
    so callers can reuse the Pfam hits (e.g. for display flank CDS); {} when
    no scan ran.
    """
    if not rows or not genes_by_contig:
        return {}
    if hmmer_bin is None or not Path(hmmer_bin).exists():
        log.warning("evidence extension disabled: hmmscan not found at %s; keeping fixed flank", hmmer_bin)
        return {}
    if pfam_db is None or not Path(pfam_db).exists():
        log.warning("evidence extension disabled: Pfam db not found at %s; keeping fixed flank", pfam_db)
        return {}

    terms = _biosynth_terms()

    # Only boundary-neighbouring CDS are scanned: a genome-wide hmmscan
    # against Pfam-A would be far too slow.
    candidates: dict[str, dict[str, Any]] = {}
    for row in rows:
        contig = str(row["contig"])
        start = int(row["start"])
        end = int(row["end"])
        for gene in genes_by_contig.get(contig, []):
            g_start = int(gene["start"])
            g_end = int(gene["end"])
            near_left = g_start < start and g_end > start - search_bp
            near_right = g_start < end + search_bp and g_end > end
            if (near_left or near_right) and str(gene.get("sequence") or ""):
                candidates[str(gene["locus_tag"])] = gene

    biosynth_ids: set[str] = set()
    domains_by_query: dict[str, list[dict[str, Any]]] = {}
    if candidates:
        work_dir.mkdir(parents=True, exist_ok=True)
        faa = work_dir / "flank_candidates.faa"
        tbl = work_dir / "flank_candidates.domtbl"
        with open(faa, "w") as handle:
            for tag, gene in candidates.items():
                handle.write(f">{tag}\n{wrap_fasta(str(gene['sequence']))}\n")
        try:
            from .pfam import parse_domtblout, scan_proteins

            n_hits = scan_proteins(
                faa_path=faa,
                pfam_db=Path(pfam_db),
                out_tbl=tbl,
                hmmer_bin=Path(hmmer_bin),
                threads=threads,
                e_cutoff=e_cutoff,
            )
            log.info("evidence extension: hmmscan on %d flank CDS -> %d domain hits", len(candidates), n_hits)
            domains_by_query = parse_domtblout(tbl)
        except Exception as exc:
            log.warning("evidence extension hmmscan failed (%s); keeping fixed flank", exc)
            return {}
        from .safe import has_any

        for tag, hits in domains_by_query.items():
            text = " ".join(
                f"{hit.get('name') or ''} {hit.get('description') or ''}"
                for hit in hits
                if float(hit.get("e_value") or 1.0) <= e_cutoff
            ).lower()
            if has_any(text, terms):
                biosynth_ids.add(tag)

    for row in rows:
        contig = str(row["contig"])
        contig_len = contig_lens.get(contig, 0)
        start = int(row["start"])
        end = int(row["end"])
        genes = genes_by_contig.get(contig, [])
        fixed_start = max(0, start - flank_bp)
        fixed_end = min(contig_len, end + flank_bp) if contig_len else end + flank_bp

        left_edge = start
        left_limit = start - (flank_bp + search_bp)
        left_genes = sorted(
            (g for g in genes if int(g["end"]) <= start),
            key=lambda g: int(g["end"]),
            reverse=True,
        )
        non_bio_run = 0
        for gene in left_genes:
            g_start = int(gene["start"])
            g_end = int(gene["end"])
            if str(gene["locus_tag"]) not in biosynth_ids:
                non_bio_run += 1
                if non_bio_run >= max_non_biosynth_run:
                    break
                continue
            if left_edge - g_end > max_gap_bp:
                break
            non_bio_run = 0
            left_edge = min(left_edge, g_start)
            if left_edge <= left_limit:
                left_edge = left_limit
                break

        right_edge = end
        right_limit = end + flank_bp + search_bp
        right_genes = sorted(
            (g for g in genes if int(g["start"]) >= end),
            key=lambda g: int(g["start"]),
        )
        non_bio_run = 0
        for gene in right_genes:
            g_start = int(gene["start"])
            g_end = int(gene["end"])
            if str(gene["locus_tag"]) not in biosynth_ids:
                non_bio_run += 1
                if non_bio_run >= max_non_biosynth_run:
                    break
                continue
            if g_start - right_edge > max_gap_bp:
                break
            non_bio_run = 0
            right_edge = max(right_edge, g_end)
            if right_edge >= right_limit:
                right_edge = right_limit
                break

        new_start = max(0, min(fixed_start, left_edge))
        new_end = max(fixed_end, right_edge)
        if contig_len:
            new_end = min(contig_len, new_end)
        if new_start < fixed_start or new_end > fixed_end:
            row["ext_method"] = "evidence"
            log.info(
                "evidence extension %s (%s:%d-%d): ext %d-%d -> %d-%d (+%d bp left, +%d bp right)",
                row.get("bgc_id"), contig, start, end,
                fixed_start, fixed_end, new_start, new_end,
                fixed_start - new_start, new_end - fixed_end,
            )
        row["ext_start"] = new_start
        row["ext_end"] = new_end

    return domains_by_query


def trim_flank_domains(
    hits: list[dict[str, Any]],
    max_domains: int = 6,
) -> list[dict[str, Any]]:
    """Trim raw parse_domtblout hits to the regions.cds_features pfam_domains shape.

    Keeps the top hits by bitscore (display order N→C), mirroring
    pfam.annotate_regions_gbk's per-CDS trim.
    """
    kept = sorted(hits, key=lambda d: -float(d.get("bitscore") or 0.0))[:max_domains]
    kept.sort(key=lambda d: int(d.get("env_start") or 0))
    return [{
        "name": d.get("name") or "",
        "accession": d.get("accession") or "",
        "e_value": d.get("e_value"),
        "bitscore": d.get("bitscore"),
        "env_start": d.get("env_start"),
        "env_end": d.get("env_end"),
        "description": d.get("description") or "",
    } for d in kept]


def write_extended_outputs(
    *,
    fasta_path: Path,
    rows: list[dict[str, Any]],
    out_dir: Path,
    genome_name: str,
    prodigal_bin: Path,
    flank_bp: int,
    evidence_extend: bool = True,
    pfam_db: Path | None = None,
    hmmer_bin: Path | None = None,
    hmmscan_threads: int = 8,
) -> dict[str, Path]:
    """Write extended safe-pass region DNA and CDS outputs.

    All rows receive ext_start/ext_end fields. CDS outputs are restricted to
    rows whose safe_pass is true, matching the BGCMaster export contract.
    With evidence_extend=True (default), the fixed flank is widened where
    boundary-adjacent CDS carry biosynthesis-related Pfam domains; set it to
    False to restore the plain fixed-flank behaviour.
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
        row["ext_method"] = "fixed_flank"

    regions_fna = out_dir / "extended_regions.fna"
    cds_faa = out_dir / "extended_cds.faa"
    cds_fna = out_dir / "extended_cds.fna"
    cds_csv = out_dir / "extended_cds.csv"
    safe_rows = [row for row in rows if bool(row.get("safe_pass"))]

    aa: dict[str, dict[str, Any]] = {}
    nt: dict[str, dict[str, Any]] = {}
    genes_by_contig: dict[str, list[tuple[str, dict[str, Any]]]] = {}
    if safe_rows:
        work_dir = out_dir / "_prodigal"
        work_dir.mkdir(parents=True, exist_ok=True)
        faa_all, fna_all = _run_prodigal(prodigal_bin, fasta_path, work_dir)
        aa = _read_prodigal_fasta(faa_all)
        nt = _read_prodigal_fasta(fna_all)
        for gene_id, meta in aa.items():
            genes_by_contig.setdefault(str(meta["contig"]), []).append((gene_id, meta))

    flank_domains: dict[str, list[dict[str, Any]]] = {}
    if evidence_extend and genes_by_contig:
        flank_domains = apply_evidence_extension(
            rows=rows,
            genes_by_contig={
                contig: [
                    {
                        "locus_tag": gene_id,
                        "start": meta["start"],
                        "end": meta["end"],
                        "sequence": meta.get("sequence") or "",
                    }
                    for gene_id, meta in genes
                ]
                for contig, genes in genes_by_contig.items()
            },
            contig_lens=contig_lens,
            flank_bp=flank_bp,
            work_dir=out_dir / "_evidence_hmmscan",
            pfam_db=pfam_db,
            hmmer_bin=hmmer_bin,
            threads=hmmscan_threads,
        )

    # Display-only flank CDS: prodigal genes inside the extended span but not
    # overlapping the core region. Attached to the row (genomic coordinates);
    # the pipeline merges them into regions.cds_features with in_core=False so
    # the web detail page can draw the full extended locus. Pfam hits come from
    # the evidence-extension hmmscan of boundary-neighbouring CDS.
    from .pfam import classify_cds_by_domains

    for row in rows:
        contig = str(row["contig"])
        start = int(row["start"])
        end = int(row["end"])
        ext_start = int(row["ext_start"])
        ext_end = int(row["ext_end"])
        flank_cds: list[dict[str, Any]] = []
        for gene_id, meta in genes_by_contig.get(contig, []):
            gene_start = int(meta["start"])
            gene_end = int(meta["end"])
            if gene_start >= ext_end or gene_end <= ext_start:
                continue
            if gene_start < end and gene_end > start:
                continue  # overlaps the core region -> already in cds_features
            aa_seq = str(meta.get("sequence") or "")
            raw_hits = flank_domains.get(gene_id, [])
            domains = trim_flank_domains(raw_hits)
            flank_cds.append({
                "locus_tag": gene_id,
                "start": gene_start,
                "end": gene_end,
                "strand": 1 if int(meta["strand"]) == 1 else -1,
                "length_aa": len(aa_seq),
                "product": "hypothetical protein",
                "function_class": classify_cds_by_domains(raw_hits),
                "aa_sequence": aa_seq,
                "nt_sequence": str((nt.get(gene_id) or {}).get("sequence") or ""),
                "pfam_domains": domains,
            })
        flank_cds.sort(key=lambda cds: cds["start"])
        row["flank_cds"] = flank_cds

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
