from __future__ import annotations

import re
from contextlib import ExitStack
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .extended import (
    _read_prodigal_fasta,
    _run_prodigal,
    collect_flank_candidates,
    wrap_fasta,
)
from .pfam import _extract_regions_proteins_with_meta, parse_domtblout, scan_proteins_parallel


@dataclass
class PfamBatch:
    domains_by_query: dict[str, list[dict[str, Any]]]
    core_tbl: Path
    prodigal_context: tuple[
        dict[str, dict[str, Any]],
        dict[str, dict[str, Any]],
        dict[str, list[tuple[str, dict[str, Any]]]],
    ] | None = None
    gff_context: tuple[list[Any], dict[str, list[Any]]] | None = None


def _split_domtbl(
    source: Path,
    destinations: list[tuple[Path, set[str], dict[str, list[str]]]],
) -> None:
    with ExitStack() as stack:
        src = stack.enter_context(open(source))
        outputs = [
            stack.enter_context(open(path, "w"))
            for path, _, _ in destinations
        ]
        for line in src:
            if line.startswith("#"):
                for out in outputs:
                    out.write(line)
                continue
            cols = line.rstrip("\n").split()
            if len(cols) < 4:
                continue
            alias = cols[3]
            for out, (_, query_ids, aliases) in zip(outputs, destinations):
                for query_id in aliases.get(alias, []):
                    if query_id in query_ids:
                        out.write(re.sub(
                            r"^(\s*\S+\s+\S+\s+\S+\s+)\S+",
                            lambda match: match.group(1) + query_id,
                            line,
                            count=1,
                        ))


def prepare_pfam_batch(
    *,
    fasta_path: Path,
    gff3_path: Path | None,
    rows: list[dict[str, Any]],
    regions_gbk: Path,
    results_dir: Path,
    pfam_db: Path,
    hmmer_bin: Path,
    prodigal_bin: Path,
    threads: int,
    scan_workers: int = 6,
) -> PfamBatch:
    pfam_work = results_dir / "_pfam_work"
    extended_dir = results_dir / "extended"
    evidence_work = extended_dir / "_evidence_hmmscan"
    pfam_work.mkdir(parents=True, exist_ok=True)
    evidence_work.mkdir(parents=True, exist_ok=True)

    core_faa = pfam_work / "region_cds.faa"
    core_meta = _extract_regions_proteins_with_meta(regions_gbk, core_faa)
    if not core_meta:
        raise RuntimeError("no core CDS proteins for combined Pfam scan")

    prodigal_context = None
    gff_context = None
    if gff3_path and gff3_path.exists():
        from .gff3 import load_gff3_cds

        records, by_contig, _stats = load_gff3_cds(
            fasta_path=fasta_path, gff3_path=gff3_path,
        )
        gff_context = (records, by_contig)
        genes_by_contig = {
            contig: [
                {
                    "locus_tag": cds.locus_tag,
                    "start": cds.start,
                    "end": cds.end,
                    "sequence": cds.aa_sequence,
                }
                for cds in records_for_contig
            ]
            for contig, records_for_contig in by_contig.items()
        }
    else:
        prodigal_work = extended_dir / "_prodigal"
        prodigal_work.mkdir(parents=True, exist_ok=True)
        faa_all, fna_all = _run_prodigal(prodigal_bin, fasta_path, prodigal_work)
        aa = _read_prodigal_fasta(faa_all)
        nt = _read_prodigal_fasta(fna_all)
        prodigal_genes: dict[str, list[tuple[str, dict[str, Any]]]] = {}
        for gene_id, meta in aa.items():
            prodigal_genes.setdefault(str(meta["contig"]), []).append((gene_id, meta))
        prodigal_context = (aa, nt, prodigal_genes)
        genes_by_contig = {
            contig: [
                {
                    "locus_tag": gene_id,
                    "start": meta["start"],
                    "end": meta["end"],
                    "sequence": meta.get("sequence") or "",
                }
                for gene_id, meta in genes
            ]
            for contig, genes in prodigal_genes.items()
        }

    candidates = collect_flank_candidates(rows=rows, genes_by_contig=genes_by_contig)
    flank_faa = evidence_work / "flank_candidates.faa"
    with open(flank_faa, "w") as handle:
        for tag, gene in candidates.items():
            handle.write(f">{tag}\n{wrap_fasta(str(gene['sequence']))}\n")

    core_sequences = {
        key: str(meta["aa_sequence"])
        for key, meta in core_meta.items()
    }
    flank_sequences = {
        key: str(gene["sequence"])
        for key, gene in candidates.items()
    }
    aliases: dict[str, list[str]] = {}
    used_aliases: set[str] = set()
    combined_faa = pfam_work / "combined_cds.faa"
    with open(combined_faa, "w") as handle:
        for query_id, sequence in [*core_sequences.items(), *flank_sequences.items()]:
            alias = query_id
            suffix = 1
            while alias in used_aliases:
                alias = f"{query_id}__batch_{suffix}"
                suffix += 1
            used_aliases.add(alias)
            aliases.setdefault(alias, []).append(query_id)
            handle.write(f">{alias}\n{wrap_fasta(sequence)}\n")

    combined_tbl = pfam_work / "combined_pfam_hits.domtbl"
    scan_proteins_parallel(
        faa_path=combined_faa,
        pfam_db=pfam_db,
        out_tbl=combined_tbl,
        hmmer_bin=hmmer_bin,
        threads=threads,
        workers=scan_workers,
    )
    domains_by_alias = parse_domtblout(combined_tbl)
    domains_by_query: dict[str, list[dict[str, Any]]] = {}
    for alias, hits in domains_by_alias.items():
        for query_id in aliases.get(alias, []):
            domains_by_query[query_id] = hits

    core_tbl = pfam_work / "pfam_hits.domtbl"
    flank_tbl = evidence_work / "flank_candidates.domtbl"
    _split_domtbl(
        combined_tbl,
        [
            (core_tbl, set(core_sequences), aliases),
            (flank_tbl, set(flank_sequences), aliases),
        ],
    )
    return PfamBatch(
        domains_by_query=domains_by_query,
        core_tbl=core_tbl,
        prodigal_context=prodigal_context,
        gff_context=gff_context,
    )
