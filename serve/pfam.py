"""Pfam domain annotation for region CDS proteins via HMMER hmmscan.

Workflow at job time:
  regions.gbk (from serve.genbank) → extract all CDS proteins as a multi-FASTA
  → hmmscan --domtblout against Pfam-A.hmm
  → parse the per-domain table
  → group hits by query (locus_tag)
  → assign each CDS a function_class based on its dominant Pfam family

Output: dict[region_name -> list of CDS feature dicts], one entry per CDS:
  {locus_tag, start, end, strand, length_aa, product, function_class,
   pfam_domains: [{name, accession, e_value, bitscore, env_start, env_end}]}

Designed to live next to serve/mibig.py — same query-extraction pattern, same
"non-fatal if it fails" contract from the worker pipeline.
"""
from __future__ import annotations

import csv
import logging
import re
import shutil
import subprocess
from collections import defaultdict
from pathlib import Path

log = logging.getLogger(__name__)


# ── Pfam → function class mapping ──────────────────────────────────────────
# Curated from antiSMASH 8 rule prefixes + common BGC literature. These names
# match Pfam family `name` (the short symbol, NOT the accession). Lowercased
# for case-insensitive lookup.
#
# Categories follow antiSMASH legend conventions:
#   core_biosynthetic       — backbone-synthesis enzymes (NRPS / PKS / RiPP / terpene)
#   additional_biosynthetic — tailoring (P450, methyltransferase, glycosyltransferase, halogenase…)
#   transport               — efflux / import (MFS / ABC / RND)
#   regulatory              — TFs (LuxR / TetR / GntR / sigma factors)
#   resistance              — beta-lactamase, aminoglyc-N, etc.
#   other                   — unmatched / hypothetical
#
# Higher-priority categories override lower when a CDS has multiple domain hits.

_CORE: set[str] = {
    # NRPS
    "amp-binding", "amp_binding", "condensation", "epimerase", "thioesterase",
    "te_n", "pp-binding", "phosphopantetheine", "nad_binding_4",
    # PKS
    "ks", "ketosynth", "kr", "ketoreductase", "dh", "dehydratase",
    "er", "enoylreductase", "acpsynthase", "acp_pks",
    "pks_kr", "pks_ks", "pks_at", "pks_dh", "pks_er", "pks_acp", "pks_te",
    "transferase_1",
    "fae1_cut1_rppa",  # type III PKS
    "chal_sti_synt",   # type III PKS
    # Terpene
    "terpene_cyclase", "trichodiene_synth", "squalene_cyclas", "prenyltransf",
    "polyprenyl_synt", "isoprenoid_bios",
    # RiPP
    "lant_dehydr_n", "lant_dehydr_c", "lant_dehyd", "yczc",
    "tigrfam_lasso", "lasso_rre",
    "thiopep_phix", "tfua_n", "thiopeptide",
    "sublancin", "subtilisin",
    "linaclotide_lp", "lantibiotic_a",
    # Saccharide
    "glycos_transf_1", "glycos_transf_2", "glyco_tranf_2_3",
    # Aminoacyl
    "aminotran_1_2", "aminotran_3", "aminotran_5", "dhdpsynthase",
}

_ADDITIONAL: set[str] = {
    # P450
    "p450",
    # Methyltransferases
    "methyltransf_25", "methyltransf_11", "methyltransf_2", "methyltransf_31",
    "ubie_methyltran", "rfk_arg",
    # Halogenases
    "trp_halogenase",
    # SAM radical
    "radical_sam",
    # Oxidoreductases
    "fad_binding_4", "fmn_dh", "fmo-like",
    "2og-feii_oxy", "luciferase_lik",
    # Reductases
    "adh_n", "adh_zinc_n", "adh_short",
    # Acyl transferase
    "acyl_transf_1",
    # Hydrolases
    "abhydrolase_1", "abhydrolase_3", "abhydrolase_6",
    # Glycosyl
    "glycosyl_hydro_1", "glyco_hydro_3", "glyco_hydro_28",
    # Sugar
    "sugar_tr",
    # Reductive
    "fer4_8", "fer4_4",
}

_TRANSPORT: set[str] = {
    "mfs_1", "mfs_3", "mfs_2",                 # MFS family
    "abc_tran", "abc2_membrane", "bpd_transp_1",
    "abc_membrane", "abc_membrane_2",
    "rnd_permease", "acrb_n", "rnd_efflux",
    "mate", "drug_resistance",
    "secretin",
    "ompa", "porin_1",
}

_REGULATORY: set[str] = {
    "luxr_c", "luxr",
    "tetr_n", "tetr_c", "tetr",
    "gntr",
    "marr",
    "merr",
    "araC",
    "sigma70_r2", "sigma70_r4", "sigma_factor", "sigma54",
    "two_component_re", "trans_reg_c", "response_reg",
    "his_kinase", "hatpase_c",
    "hth_1", "hth_3", "hth_8", "hth_lacI",
    "iclr",
    "padr",
}

_RESISTANCE: set[str] = {
    "beta-lactamase", "blactamase",
    "antibiot_phspho",
    "aminoglyc_phosp",
    "phospho_tcpr",
    "tetra_resist", "tet_n", "tet_resist",
    "macrolide_glyco",
    "vana", "vans", "vanr",
    "abc_efflux",
    "qac_e",
}


def _lookup_class(domain_name: str) -> str | None:
    """Match by normalized lowercase domain name."""
    n = domain_name.lower()
    if n in _CORE:        return "core_biosynthetic"
    if n in _ADDITIONAL:  return "additional_biosynthetic"
    if n in _TRANSPORT:   return "transport"
    if n in _REGULATORY:  return "regulatory"
    if n in _RESISTANCE:  return "resistance"
    return None


_CLASS_PRIORITY = [
    "core_biosynthetic",
    "additional_biosynthetic",
    "regulatory",
    "transport",
    "resistance",
    "other",
]


def classify_cds_by_domains(domains: list[dict]) -> str:
    """Pick the highest-priority class across a CDS's domain set."""
    best = "other"
    best_rank = _CLASS_PRIORITY.index(best)
    for d in domains:
        cls = _lookup_class(d.get("name", ""))
        if cls is None:
            continue
        rank = _CLASS_PRIORITY.index(cls)
        if rank < best_rank:
            best, best_rank = cls, rank
    return best


# ── HMMER subprocess wrapper ─────────────────────────────────────────────

def scan_proteins(*, faa_path: Path, pfam_db: Path, out_tbl: Path,
                  hmmer_bin: Path, threads: int = 8,
                  e_cutoff: float = 1e-5) -> int:
    """One hmmscan call. Returns number of significant per-domain hits."""
    out_tbl.parent.mkdir(parents=True, exist_ok=True)
    cmd = [
        str(hmmer_bin),
        "--domtblout", str(out_tbl),
        "-E", str(e_cutoff),
        "--cpu", str(threads),
        "--noali",
        str(pfam_db),
        str(faa_path),
    ]
    log.info("hmmscan: %d threads, db=%s", threads, pfam_db.name)
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        raise RuntimeError(f"hmmscan failed:\n{proc.stderr[-2000:]}")
    # Count significant rows in the domtblout (lines not starting with #).
    with open(out_tbl) as fh:
        n = sum(1 for line in fh if line and not line.startswith("#"))
    return n


# ── domtblout parser ─────────────────────────────────────────────────────

# Per-domain table layout from `hmmscan --domtblout` (fixed-column whitespace):
# 0: target_name  1: target_acc  2: tlen  3: query_name  4: query_acc  5: qlen
# 6: full_e_value 7: full_score  8: full_bias
# 9: dom_idx 10: dom_total 11: c_evalue 12: i_evalue 13: dom_score 14: dom_bias
# 15: hmm_from 16: hmm_to 17: ali_from 18: ali_to 19: env_from 20: env_to
# 21: acc 22..: target description (free text)

def parse_domtblout(tbl_path: Path) -> dict[str, list[dict]]:
    """{query_name -> [domain_hit, ...]} ordered by env_from ascending."""
    by_query: dict[str, list[dict]] = defaultdict(list)
    with open(tbl_path) as fh:
        for line in fh:
            if not line or line.startswith("#"):
                continue
            cols = re.split(r"\s+", line.strip(), maxsplit=22)
            if len(cols) < 22:
                continue
            try:
                hit = {
                    "name":      cols[0],
                    "accession": cols[1],
                    "e_value":   float(cols[12]),     # i-evalue (independent E-value)
                    "bitscore":  float(cols[13]),
                    "hmm_start": int(cols[15]),
                    "hmm_end":   int(cols[16]),
                    "env_start": int(cols[19]),
                    "env_end":   int(cols[20]),
                }
            except (ValueError, IndexError):
                continue
            by_query[cols[3]].append(hit)
    # Order by env_start so the domain "chain" reads N→C.
    for q in by_query:
        by_query[q].sort(key=lambda d: d["env_start"])
    return by_query


# ── End-to-end region-level annotator ────────────────────────────────────

def _extract_regions_proteins_with_meta(regions_gbk: Path, out_faa: Path) -> dict[str, dict]:
    """Walk regions.gbk, extract every CDS as a protein FASTA, and return
    metadata. Each entry includes the actual amino-acid AND nucleotide
    sequence so the frontend can offer copy-to-clipboard.

    Header convention matches serve.mibig: ">{regionId}|{cdsIdx:03d}".
    """
    from Bio import SeqIO
    from Bio.Seq import Seq

    out_faa.parent.mkdir(parents=True, exist_ok=True)
    meta: dict[str, dict] = {}
    with open(out_faa, "w") as fout:
        for rec in SeqIO.parse(regions_gbk, "genbank"):
            region_seq = str(rec.seq)
            for i, feat in enumerate(rec.features):
                if feat.type != "CDS":
                    continue
                aa = (feat.qualifiers.get("translation") or [""])[0]
                if not aa or len(aa) < 30:
                    continue
                locus_tag = (feat.qualifiers.get("locus_tag") or [f"{rec.id}_CDS_{i:03d}"])[0]
                product = (feat.qualifiers.get("product") or [""])[0]
                start = int(feat.location.start)
                end = int(feat.location.end)
                strand = int(feat.location.strand or 1)
                # Nucleotide sequence (already strand-corrected: take region_seq slice
                # then reverse-complement when strand is negative).
                nt = region_seq[start:end]
                if strand == -1 and nt:
                    nt = str(Seq(nt).reverse_complement())
                key = f"{rec.id}|{i:03d}"
                fout.write(f">{key}\n{aa}\n")
                meta[key] = {
                    "region_id":   rec.id,
                    "locus_tag":   locus_tag,
                    "start":       start,
                    "end":         end,
                    "strand":      strand,
                    "product":     product or "hypothetical protein",
                    "length_aa":   len(aa),
                    "aa_sequence": aa,
                    "nt_sequence": nt,
                }
    return meta


def annotate_regions_gbk(*, regions_gbk: Path, pfam_db: Path, work_dir: Path,
                         hmmer_bin: Path, threads: int = 8,
                         e_cutoff: float = 1e-5,
                         max_domains_per_cds: int = 6) -> dict[str, list[dict]]:
    """Top-level entry. Returns {region_id: [cds_feature_dict, ...]}.

    Each cds_feature_dict has the shape stored in regions.cds_features JSONB.
    Failed scans propagate as RuntimeError; the caller (pipeline) wraps in
    try/except so a failure is non-fatal."""
    work_dir.mkdir(parents=True, exist_ok=True)

    faa = work_dir / "region_cds.faa"
    cds_meta = _extract_regions_proteins_with_meta(regions_gbk, faa)
    if not cds_meta:
        log.info("pfam.annotate: no query CDS in %s", regions_gbk.name)
        return {}

    tbl = work_dir / "pfam_hits.domtbl"
    n = scan_proteins(faa_path=faa, pfam_db=pfam_db, out_tbl=tbl,
                      hmmer_bin=hmmer_bin, threads=threads, e_cutoff=e_cutoff)
    log.info("pfam.annotate: %d significant per-domain hits across %d CDS",
             n, len(cds_meta))

    domains_by_query = parse_domtblout(tbl)

    by_region: dict[str, list[dict]] = defaultdict(list)
    for key, m in cds_meta.items():
        domains = domains_by_query.get(key, [])
        # Trim very long domain lists to keep JSON small (top by bitscore).
        domains_trim = sorted(domains, key=lambda d: -d["bitscore"])[:max_domains_per_cds]
        # Re-order for display by env_start (N→C).
        domains_trim.sort(key=lambda d: d["env_start"])
        cds_feature = {
            "locus_tag":      m["locus_tag"],
            "start":          m["start"],
            "end":            m["end"],
            "strand":         m["strand"],
            "length_aa":      m["length_aa"],
            "product":        m["product"],
            "function_class": classify_cds_by_domains(domains),
            "aa_sequence":    m["aa_sequence"],
            "nt_sequence":    m["nt_sequence"],
            "pfam_domains":   [{
                "name":      d["name"],
                "accession": d["accession"],
                "e_value":   d["e_value"],
                "bitscore":  d["bitscore"],
                "env_start": d["env_start"],
                "env_end":   d["env_end"],
            } for d in domains_trim],
        }
        by_region[m["region_id"]].append(cds_feature)

    # Sort each region's CDS list by genomic start.
    for region_id in by_region:
        by_region[region_id].sort(key=lambda c: c["start"])

    return dict(by_region)
