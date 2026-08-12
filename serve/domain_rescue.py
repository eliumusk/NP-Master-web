from __future__ import annotations

import logging
import os
import subprocess
from collections import defaultdict
from pathlib import Path
from typing import Any

from .gff3 import CdsRecord, load_gff3_cds, write_cds_faa
from .pfam import parse_domtblout, scan_proteins

log = logging.getLogger(__name__)

TERPENE_TERMS = [
    "terpene", "terpene_syn", "terpene_syn_c", "t1ts", "trichodiene", "squalene", "phytoene", "lycopene",
    "prenyl", "polyprenyl", "isoprenoid", "ubia",
]
PKS_KS_TERMS = ["pks_ks", "ketoacyl", "ketosynth", "chal_sti_synt", "fae1_cut1_rppa"]
PKS_AT_TERMS = ["pks_at", "acyl_transf", "acyltransferase"]
PKS_ACP_TERMS = ["acp", "pp-binding", "phosphopantetheine"]
PKS_RISK_TERMS = ["fab", "fatty", "fas", "beta-ketoacyl-acp"]
NRPS_A_TERMS = ["amp-binding", "adenylation", "a-ox"]
NRPS_C_TERMS = ["condensation", "epimerase"]
NRPS_PCP_TERMS = ["pp-binding", "pcp", "thiolation", "phosphopantetheine"]
NRPS_TE_TERMS = ["thioesterase", "te_n"]
RIPP_TERMS = ["ycao", "lant", "lasso", "rre", "tomm", "thiopeptide"]
SACCHARIDE_TERMS = ["glycos", "sugar", "dtdp", "polysacc", "mgt"]

FLANK_BY_TYPE = {
    "Terpene": 15_000,
    "Polyketide": 30_000,
    "NRP": 30_000,
    "RiPP": 10_000,
    "Saccharide": 20_000,
}

FRAGMENT_MERGE_RULES = {
    "Terpene": {
        "merge_gap_bp": 1_000,
        "max_cluster_span_bp": 5_000,
        "max_fragment_aa": 350,
        "max_fragments": 3,
    },
    "Polyketide": {
        "merge_gap_bp": 1_000,
        "max_cluster_span_bp": 15_000,
        "max_fragment_aa": 900,
        "max_fragments": 8,
    },
    "NRP": {
        "merge_gap_bp": 1_000,
        "max_cluster_span_bp": 20_000,
        "max_fragment_aa": 1_200,
        "max_fragments": 10,
    },
}

RESCUE_HMM_TERMS = sorted(set(
    TERPENE_TERMS
    + PKS_KS_TERMS
    + PKS_AT_TERMS
    + PKS_ACP_TERMS
    + NRPS_A_TERMS
    + NRPS_C_TERMS
    + NRPS_PCP_TERMS
    + NRPS_TE_TERMS
    + RIPP_TERMS
    + SACCHARIDE_TERMS
))


def _strip_pfam_version(accession: str) -> str:
    return accession.split(".", 1)[0]


def _domain_text(domains: list[dict[str, Any]]) -> str:
    bits: list[str] = []
    for domain in domains:
        bits.append(str(domain.get("name") or ""))
        bits.append(_strip_pfam_version(str(domain.get("accession") or "")))
    return " ".join(bits).lower()


def _has_any(text: str, terms: list[str]) -> bool:
    text_l = text.lower()
    text_norm = text_l.replace("-", "_").replace(" ", "_")
    return any(term.lower() in text_l or term.lower().replace("-", "_").replace(" ", "_") in text_norm for term in terms)


def _pressed_hmm_files(hmm_path: Path) -> list[Path]:
    return [Path(str(hmm_path) + ext) for ext in (".h3f", ".h3i", ".h3m", ".h3p")]


def _record_matches_rescue_terms(record_lines: list[str]) -> bool:
    header_text = " ".join(
        line.strip()
        for line in record_lines
        if line.startswith(("NAME", "ACC", "DESC"))
    )
    return _has_any(header_text, RESCUE_HMM_TERMS)


def _build_rescue_hmm_db(*, pfam_db: Path, hmmer_bin: Path, work_dir: Path) -> Path:
    """Create a small Pfam subset for rescue seeding instead of scanning all Pfam.

    The full Pfam-A scan over every CDS in a fungal genome is slow. Rescue only
    needs class-defining core domains, so we cache a pressed subset next to the
    Pfam database when possible and reuse it across jobs.
    """
    cache_dir = pfam_db.parent if os.access(pfam_db.parent, os.W_OK) else work_dir
    subset = cache_dir / "BGC-Master-rescue-core.v2.hmm"
    pressed = _pressed_hmm_files(subset)
    if subset.exists() and all(p.exists() for p in pressed) and subset.stat().st_mtime >= pfam_db.stat().st_mtime:
        return subset

    cache_dir.mkdir(parents=True, exist_ok=True)
    tmp_subset = cache_dir / f"{subset.name}.tmp.{os.getpid()}"
    n_records = 0
    n_kept = 0
    record: list[str] = []
    with open(pfam_db, errors="replace") as in_handle, open(tmp_subset, "w") as out_handle:
        for line in in_handle:
            record.append(line)
            if line.startswith("//"):
                n_records += 1
                if _record_matches_rescue_terms(record):
                    out_handle.writelines(record)
                    n_kept += 1
                record = []
    if n_kept == 0:
        tmp_subset.unlink(missing_ok=True)
        log.warning("domain_rescue: no rescue HMMs matched; falling back to full Pfam")
        return pfam_db

    os.replace(tmp_subset, subset)
    for path in pressed:
        path.unlink(missing_ok=True)

    hmmpress = hmmer_bin.with_name("hmmpress")
    if hmmpress.exists():
        proc = subprocess.run([str(hmmpress), "-f", str(subset)], capture_output=True, text=True)
        if proc.returncode != 0:
            log.warning("domain_rescue: hmmpress failed for rescue subset; falling back to full Pfam: %s", proc.stderr[-1000:])
            return pfam_db
    else:
        log.warning("domain_rescue: hmmpress not found next to %s; falling back to full Pfam", hmmer_bin)
        return pfam_db

    log.info("domain_rescue: cached %d/%d Pfam HMMs in %s", n_kept, n_records, subset)
    return subset


def _domain_names(domains: list[dict[str, Any]]) -> str:
    names = []
    for domain in domains:
        name = str(domain.get("name") or "")
        acc = _strip_pfam_version(str(domain.get("accession") or ""))
        if name or acc:
            names.append(f"{name}({acc})" if acc else name)
    return ";".join(names)


def _seed_from_domain_text(
    text: str,
    *,
    length_aa: int,
    nearby_small: bool,
    allow_length_shortcut: bool = True,
    allow_ripp: bool = True,
) -> dict[str, Any] | None:
    if not text:
        return None

    if _has_any(text, TERPENE_TERMS):
        return {"seed_type": "Terpene", "seed_rule": "terpene_core_domain", "strength": "strong"}

    has_ks = _has_any(text, PKS_KS_TERMS)
    has_at = _has_any(text, PKS_AT_TERMS)
    has_acp = _has_any(text, PKS_ACP_TERMS)
    fas_risk = _has_any(text, PKS_RISK_TERMS)
    pks_length_support = allow_length_shortcut and length_aa >= 1000
    if has_ks and (has_at or has_acp or pks_length_support) and not fas_risk:
        return {"seed_type": "Polyketide", "seed_rule": "pks_core_domain_combo", "strength": "strong"}

    has_a = _has_any(text, NRPS_A_TERMS)
    has_c = _has_any(text, NRPS_C_TERMS)
    has_pcp = _has_any(text, NRPS_PCP_TERMS)
    has_te = _has_any(text, NRPS_TE_TERMS)
    nrps_length_support = allow_length_shortcut and length_aa >= 800
    if has_a and has_pcp and (has_c or has_te or nrps_length_support):
        return {"seed_type": "NRP", "seed_rule": "nrps_core_domain_combo", "strength": "strong"}

    if allow_ripp and _has_any(text, RIPP_TERMS) and nearby_small:
        return {"seed_type": "RiPP", "seed_rule": "ripp_modification_plus_small_orf", "strength": "strong"}

    return None


def _seed_for_cds(cds: CdsRecord, domains: list[dict[str, Any]], nearby_small: bool) -> dict[str, Any] | None:
    return _seed_from_domain_text(
        _domain_text(domains),
        length_aa=cds.length_aa,
        nearby_small=nearby_small,
    )


def _seed_from_domain_text_for_class(seed_type: str, text: str) -> dict[str, Any] | None:
    if seed_type == "Terpene" and _has_any(text, TERPENE_TERMS):
        return {"seed_type": "Terpene", "seed_rule": "terpene_core_domain", "strength": "strong"}

    if seed_type == "Polyketide":
        has_ks = _has_any(text, PKS_KS_TERMS)
        has_at = _has_any(text, PKS_AT_TERMS)
        has_acp = _has_any(text, PKS_ACP_TERMS)
        fas_risk = _has_any(text, PKS_RISK_TERMS)
        if has_ks and (has_at or has_acp) and not fas_risk:
            return {"seed_type": "Polyketide", "seed_rule": "pks_core_domain_combo", "strength": "strong"}

    if seed_type == "NRP":
        has_a = _has_any(text, NRPS_A_TERMS)
        has_c = _has_any(text, NRPS_C_TERMS)
        has_pcp = _has_any(text, NRPS_PCP_TERMS)
        has_te = _has_any(text, NRPS_TE_TERMS)
        if has_a and has_pcp and (has_c or has_te):
            return {"seed_type": "NRP", "seed_rule": "nrps_core_domain_combo", "strength": "strong"}

    return None


def _small_cds_nearby(by_contig: dict[str, list[CdsRecord]], cds: CdsRecord, radius: int = 10_000) -> bool:
    for other in by_contig.get(cds.contig, []):
        if other.length_aa > 120:
            continue
        if other.end < cds.start - radius or other.start > cds.end + radius:
            continue
        return True
    return False


def _fragment_candidate_classes(domains: list[dict[str, Any]]) -> list[str]:
    text = _domain_text(domains)
    classes: list[str] = []
    if _has_any(text, TERPENE_TERMS):
        classes.append("Terpene")
    if _has_any(text, PKS_KS_TERMS + PKS_AT_TERMS + PKS_ACP_TERMS) and not _has_any(text, PKS_RISK_TERMS):
        classes.append("Polyketide")
    if _has_any(text, NRPS_A_TERMS + NRPS_C_TERMS + NRPS_PCP_TERMS + NRPS_TE_TERMS):
        classes.append("NRP")
    return classes


def _combined_domain_text(cluster: list[CdsRecord], domains_by_locus: dict[str, list[dict[str, Any]]]) -> str:
    bits: list[str] = []
    for cds in cluster:
        bits.append(_domain_text(domains_by_locus.get(cds.locus_tag, [])))
    return " ".join(bit for bit in bits if bit)


def _collect_adjacent_fragments(
    *,
    cds: CdsRecord,
    by_contig: dict[str, list[CdsRecord]],
    seed_type: str,
    domains_by_locus: dict[str, list[dict[str, Any]]],
    merge_gap_bp: int,
    max_cluster_span_bp: int,
    max_fragment_aa: int,
    max_fragments: int,
) -> list[CdsRecord]:
    if cds.length_aa > max_fragment_aa:
        return [cds]
    items = by_contig.get(cds.contig, [])
    idx = next((i for i, item in enumerate(items) if item.locus_tag == cds.locus_tag), None)
    if idx is None:
        return [cds]

    cluster = [cds]
    # Extend left/right through short same-strand ORFs that look like possible gene-prediction fragments.
    j = idx - 1
    while j >= 0 and len(cluster) < max_fragments:
        other = items[j]
        gap = cluster[0].start - other.end
        span = max(x.end for x in cluster + [other]) - min(x.start for x in cluster + [other])
        if other.strand != cds.strand or gap < 0 or gap > merge_gap_bp or span > max_cluster_span_bp:
            break
        if other.length_aa > max_fragment_aa:
            break
        other_classes = _fragment_candidate_classes(domains_by_locus.get(other.locus_tag, []))
        if other_classes and seed_type not in other_classes:
            break
        cluster.insert(0, other)
        j -= 1

    j = idx + 1
    while j < len(items) and len(cluster) < max_fragments:
        other = items[j]
        gap = other.start - cluster[-1].end
        span = max(x.end for x in cluster + [other]) - min(x.start for x in cluster + [other])
        if other.strand != cds.strand or gap < 0 or gap > merge_gap_bp or span > max_cluster_span_bp:
            break
        if other.length_aa > max_fragment_aa:
            break
        other_classes = _fragment_candidate_classes(domains_by_locus.get(other.locus_tag, []))
        if other_classes and seed_type not in other_classes:
            break
        cluster.append(other)
        j += 1

    return sorted(cluster, key=lambda x: x.start)


def _fragment_cluster_for_seed(
    *,
    cds: CdsRecord,
    seed: dict[str, Any] | None,
    domains: list[dict[str, Any]],
    domains_by_locus: dict[str, list[dict[str, Any]]],
    by_contig: dict[str, list[CdsRecord]],
) -> tuple[list[CdsRecord], dict[str, Any] | None]:
    """Join adjacent same-strand fragments when the merged domains fit a core enzyme.

    TransDecoder sometimes reports one fungal core enzyme as two nearby ORFs.
    The merge is class-aware and limited to core-enzyme classes where a single
    biological enzyme is commonly represented by one CDS: terpene, PKS, and NRPS.
    """
    classes = _fragment_candidate_classes(domains)
    if seed and seed.get("seed_type") in FRAGMENT_MERGE_RULES:
        classes.insert(0, str(seed["seed_type"]))
    classes = list(dict.fromkeys(classes))
    if not classes:
        return [cds], seed

    for seed_type in classes:
        rule = FRAGMENT_MERGE_RULES.get(seed_type)
        if rule is None:
            continue
        cluster = _collect_adjacent_fragments(
            cds=cds,
            by_contig=by_contig,
            seed_type=seed_type,
            domains_by_locus=domains_by_locus,
            merge_gap_bp=int(rule["merge_gap_bp"]),
            max_cluster_span_bp=int(rule["max_cluster_span_bp"]),
            max_fragment_aa=int(rule["max_fragment_aa"]),
            max_fragments=int(rule["max_fragments"]),
        )
        if len(cluster) < 2:
            continue
        merged_seed = _seed_from_domain_text_for_class(
            seed_type,
            _combined_domain_text(cluster, domains_by_locus),
        )
        if merged_seed:
            return cluster, merged_seed

    return [cds], seed


def _make_seed(
    cds: CdsRecord,
    seed: dict[str, Any],
    domains: list[dict[str, Any]],
    contig_len: int,
    *,
    cluster: list[CdsRecord] | None = None,
    domains_by_locus: dict[str, list[dict[str, Any]]] | None = None,
) -> dict[str, Any]:
    seed_type = str(seed["seed_type"])
    flank = FLANK_BY_TYPE.get(seed_type, 20_000)
    members = cluster or [cds]
    core_start = min(item.start for item in members)
    core_end = max(item.end for item in members)
    component_cds = ";".join(item.locus_tag for item in members)
    core_enzyme_id = "+".join(item.locus_tag for item in members)
    seed_rule = str(seed["seed_rule"])
    if len(members) > 1:
        seed_rule = f"{seed_rule};core_fragment_merge"
    if domains_by_locus is not None:
        domain_text = ";".join(
            text for text in (_domain_names(domains_by_locus.get(item.locus_tag, [])) for item in members)
            if text
        )
    else:
        domain_text = _domain_names(domains)
    row = {
        "genome": "",
        "contig": cds.contig,
        "start": max(0, core_start - flank),
        "end": min(contig_len, core_end + flank) if contig_len else core_end + flank,
        "score": 1.0,
        "type": "domain_rescue",
        "proposal_source": "domain_rescued",
        "domain_rescue": True,
        "model_score": 0.0,
        "seed_type": seed_type,
        "seed_rule": seed_rule,
        "seed_strength": seed.get("strength", "strong"),
        "seed_core_start": core_start,
        "seed_core_end": core_end,
        "seed_genes": component_cds,
        "seed_domains": domain_text,
        "core_enzyme_id": core_enzyme_id,
        "core_enzyme_status": "assembly_error_tolerant_reconstructed" if len(members) > 1 else "native_cds",
        "core_enzyme_component_cds": component_cds,
        "core_fragment_count": len(members),
        "core_reconstruction_rule": (
            "adjacent_same_strand_class_aware_fragment_stitch"
            if len(members) > 1 else "none"
        ),
    }
    if len(members) > 1:
        row["seed_fragment_groups"] = ";".join(item.locus_tag for item in members)
        row["core_reconstruction_note"] = (
            "Component CDS fragments are stitched in post-processing to tolerate "
            "assembly or gene-model breaks; treat the sequence as a reconstructed "
            "core-enzyme candidate unless independently validated."
        )
    else:
        row["core_reconstruction_note"] = ""
    return row


def _merge_text_list(left: Any, right: Any, *, sep: str = ";") -> str:
    values: list[str] = []
    for raw in (left, right):
        for item in str(raw or "").split(sep):
            item = item.strip()
            if item and item not in values:
                values.append(item)
    return sep.join(values)


def _merge_fragment_groups(left: Any, right: Any) -> str:
    groups: list[str] = []
    for raw in (left, right):
        for group in str(raw or "").split("|"):
            items = _merge_text_list(group, "", sep=";")
            if items and items not in groups:
                groups.append(items)
    return "|".join(groups)


def _merge_seed_rows(seed_rows: list[dict[str, Any]], *, merge_gap_bp: int = 5_000) -> list[dict[str, Any]]:
    if not seed_rows:
        return []
    rows = sorted(seed_rows, key=lambda r: (str(r["contig"]), str(r.get("seed_type") or ""), int(r["start"]), int(r["end"])))
    merged: list[dict[str, Any]] = []
    for row in rows:
        if not merged:
            merged.append(dict(row))
            continue
        last = merged[-1]
        same_group = str(last["contig"]) == str(row["contig"]) and str(last.get("seed_type")) == str(row.get("seed_type"))
        if same_group and int(row["start"]) <= int(last["end"]) + merge_gap_bp:
            last["start"] = min(int(last["start"]), int(row["start"]))
            last["end"] = max(int(last["end"]), int(row["end"]))
            last["seed_core_start"] = min(int(last["seed_core_start"]), int(row["seed_core_start"]))
            last["seed_core_end"] = max(int(last["seed_core_end"]), int(row["seed_core_end"]))
            last["seed_genes"] = _merge_text_list(last.get("seed_genes"), row.get("seed_genes"), sep=";")
            last["seed_domains"] = _merge_text_list(last.get("seed_domains"), row.get("seed_domains"), sep=";")
            last["seed_fragment_groups"] = _merge_fragment_groups(
                last.get("seed_fragment_groups"),
                row.get("seed_fragment_groups"),
            )
            last["core_enzyme_id"] = _merge_text_list(last.get("core_enzyme_id"), row.get("core_enzyme_id"), sep=";")
            last["core_enzyme_component_cds"] = _merge_text_list(
                last.get("core_enzyme_component_cds"),
                row.get("core_enzyme_component_cds"),
                sep=";",
            )
            last["core_enzyme_status"] = _merge_text_list(
                last.get("core_enzyme_status"),
                row.get("core_enzyme_status"),
                sep=";",
            )
            last["core_reconstruction_rule"] = _merge_text_list(
                last.get("core_reconstruction_rule"),
                row.get("core_reconstruction_rule"),
                sep=";",
            )
            last["core_reconstruction_note"] = _merge_text_list(
                last.get("core_reconstruction_note"),
                row.get("core_reconstruction_note"),
                sep=" | ",
            )
            try:
                last["core_fragment_count"] = max(
                    int(last.get("core_fragment_count") or 0),
                    int(row.get("core_fragment_count") or 0),
                )
            except ValueError:
                last["core_fragment_count"] = row.get("core_fragment_count") or last.get("core_fragment_count") or ""
            if str(row.get("seed_rule") or "") not in str(last.get("seed_rule") or ""):
                last["seed_rule"] = _merge_text_list(last.get("seed_rule"), row.get("seed_rule"), sep=";")
        else:
            merged.append(dict(row))
    return merged


def _add_saccharide_cluster_seeds(
    *,
    seeds: list[dict[str, Any]],
    records: list[CdsRecord],
    domains_by_locus: dict[str, list[dict[str, Any]]],
    contig_lengths: dict[str, int],
) -> None:
    by_contig: dict[str, list[CdsRecord]] = defaultdict(list)
    for cds in records:
        if _has_any(_domain_text(domains_by_locus.get(cds.locus_tag, [])), SACCHARIDE_TERMS):
            by_contig[cds.contig].append(cds)
    for contig, items in by_contig.items():
        items.sort(key=lambda x: x.start)
        for i, cds in enumerate(items):
            cluster = [cds]
            j = i + 1
            while j < len(items) and items[j].start - cds.start <= 20_000:
                cluster.append(items[j])
                j += 1
            if len(cluster) < 3:
                continue
            start = min(x.start for x in cluster)
            end = max(x.end for x in cluster)
            contig_len = contig_lengths.get(contig, 0)
            flank = FLANK_BY_TYPE["Saccharide"]
            seeds.append({
                "genome": "",
                "contig": contig,
                "start": max(0, start - flank),
                "end": min(contig_len, end + flank) if contig_len else end + flank,
                "score": 1.0,
                "type": "domain_rescue",
                "proposal_source": "domain_rescued",
                "domain_rescue": True,
                "model_score": 0.0,
                "seed_type": "Saccharide",
                "seed_rule": "saccharide_multi_gene_domain_cluster",
                "seed_strength": "medium",
                "seed_core_start": start,
                "seed_core_end": end,
                "seed_genes": ";".join(x.locus_tag for x in cluster),
                "seed_domains": ";".join(_domain_names(domains_by_locus.get(x.locus_tag, [])) for x in cluster),
            })
            break


def propose_domain_rescued_regions(
    *,
    fasta_path: Path,
    gff3_path: Path,
    pfam_db: Path,
    hmmer_bin: Path,
    work_dir: Path,
    genome_name: str,
    threads: int = 8,
    e_cutoff: float = 1e-5,
    translation_table: int = 1,
) -> list[dict[str, Any]]:
    """Propose BGC regions from strong CDS/Pfam seed-domain evidence.

    This complements the DNA model and is intentionally conservative: short
    terpene/RiPP clusters can be rescued by strong domains, while PKS/NRPS need
    multi-domain support to reduce primary-metabolism false positives. Split
    core-enzyme fragments are merged only for terpene, PKS, and NRPS.
    """
    from .extended import read_fasta

    work_dir.mkdir(parents=True, exist_ok=True)
    contig_lengths = {name: len(seq) for name, seq in read_fasta(fasta_path).items()}
    records, by_contig, stats = load_gff3_cds(
        fasta_path=fasta_path,
        gff3_path=gff3_path,
        translation_table=translation_table,
    )
    log.info("domain_rescue: translated %d CDS from %s", stats["gff_translated_cds"], gff3_path.name)
    if not records:
        return []

    faa = work_dir / "all_gff3_cds.faa"
    tbl = work_dir / "all_gff3_cds.pfam.domtbl"
    write_cds_faa(records, faa)
    rescue_db = _build_rescue_hmm_db(pfam_db=pfam_db, hmmer_bin=hmmer_bin, work_dir=work_dir)
    n_hits = scan_proteins(faa_path=faa, pfam_db=rescue_db, out_tbl=tbl, hmmer_bin=hmmer_bin, threads=threads, e_cutoff=e_cutoff)
    log.info("domain_rescue: %d Pfam domain hits across %d CDS", n_hits, len(records))
    domains_by_locus = parse_domtblout(tbl)

    seeds: list[dict[str, Any]] = []
    seen_fragment_groups: list[tuple[str, str, set[str]]] = []
    for cds in records:
        domains = domains_by_locus.get(cds.locus_tag, [])
        seed = _seed_for_cds(cds, domains, _small_cds_nearby(by_contig, cds))
        if seed is None and not _fragment_candidate_classes(domains):
            continue
        cluster, seed = _fragment_cluster_for_seed(
            cds=cds,
            seed=seed,
            domains=domains,
            domains_by_locus=domains_by_locus,
            by_contig=by_contig,
        )
        if seed is None:
            continue
        if len(cluster) > 1:
            loci = {item.locus_tag for item in cluster}
            group_key = (cds.contig, str(seed.get("seed_type") or ""))
            if any(contig == group_key[0] and seed_type == group_key[1] and loci & seen for contig, seed_type, seen in seen_fragment_groups):
                continue
            seen_fragment_groups.append((group_key[0], group_key[1], loci))
        row = _make_seed(
            cds,
            seed,
            domains,
            contig_lengths.get(cds.contig, 0),
            cluster=cluster,
            domains_by_locus=domains_by_locus,
        )
        row["genome"] = genome_name
        seeds.append(row)

    _add_saccharide_cluster_seeds(seeds=seeds, records=records, domains_by_locus=domains_by_locus, contig_lengths=contig_lengths)
    merged = _merge_seed_rows(seeds)
    for i, row in enumerate(merged, start=1):
        row["genome"] = genome_name
        row["bgc_id"] = f"BGC_D{i:04d}"
    log.info("domain_rescue: %d seed rows merged into %d rescued regions", len(seeds), len(merged))
    return merged


def _overlap_bp(a: dict[str, Any], b: dict[str, Any]) -> int:
    if str(a.get("contig")) != str(b.get("contig")):
        return 0
    return max(0, min(int(a["end"]), int(b["end"])) - max(int(a["start"]), int(b["start"])))


def merge_model_and_domain_rows(model_rows: list[dict[str, Any]], domain_rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Merge domain-rescued proposals with model proposals.

    Existing model BGC IDs are preserved. Non-overlapping domain-rescued regions
    keep BGC_Dxxxx IDs so downstream users can see they came from rescue.
    """
    out = []
    for row in model_rows:
        r = dict(row)
        r.setdefault("proposal_source", "model_only")
        r.setdefault("domain_rescue", False)
        r.setdefault("model_score", r.get("score"))
        out.append(r)

    n_model_rows = len(out)
    for domain in domain_rows:
        hit_index = None
        for idx, row in enumerate(out[:n_model_rows]):
            if _overlap_bp(row, domain) > 0:
                hit_index = idx
                break
        if hit_index is None:
            out.append(dict(domain))
            continue
        row = out[hit_index]
        row["proposal_source"] = "model_domain_consensus"
        row["domain_rescue"] = True
        row["seed_type"] = domain.get("seed_type") or row.get("seed_type") or ""
        row["seed_rule"] = domain.get("seed_rule") or row.get("seed_rule") or ""
        row["seed_strength"] = domain.get("seed_strength") or row.get("seed_strength") or ""
        row["seed_core_start"] = domain.get("seed_core_start")
        row["seed_core_end"] = domain.get("seed_core_end")
        row["seed_genes"] = domain.get("seed_genes") or ""
        row["seed_fragment_groups"] = domain.get("seed_fragment_groups") or ""
        row["seed_domains"] = domain.get("seed_domains") or ""
        row["core_enzyme_id"] = domain.get("core_enzyme_id") or ""
        row["core_enzyme_status"] = domain.get("core_enzyme_status") or ""
        row["core_enzyme_component_cds"] = domain.get("core_enzyme_component_cds") or ""
        row["core_fragment_count"] = domain.get("core_fragment_count") or ""
        row["core_reconstruction_rule"] = domain.get("core_reconstruction_rule") or ""
        row["core_reconstruction_note"] = domain.get("core_reconstruction_note") or ""

    return sorted(out, key=lambda r: (str(r.get("contig")), int(r.get("start") or 0), int(r.get("end") or 0), str(r.get("bgc_id"))))
