from __future__ import annotations

import math
from collections import Counter
from typing import Any

BGC_TYPES = ["Alkaloid", "Terpene", "NRP", "Polyketide", "RiPP", "Saccharide", "Other"]

PKS_KS_TERMS = ["ketoacyl-synt", "ketosynthase", "pks_ks", "ks domain", " beta-ketoacyl", "fabf", "type iii pks", "chal_sti_synt"]
PKS_AT_TERMS = ["acyl_transf_1", "acyltransferase", "pks_at", "malonyl-coa:acp transacylase"]
PKS_ACP_TERMS = ["pp-binding", "acyl carrier", " acp", "acp_", "phosphopantetheine"]
PKS_REDUCING_TERMS = ["pks_kr", " kr", "ketoreductase", "dehydratase", "pks_dh", "enoyl", "pks_er", "thioesterase"]
TYPEII_PKS_TERMS = ["t2pks", "t2ks", "chain length factor", "clf", "act_ks", "type ii"]
FAS_RISK_TERMS = ["fatty acid", "fabf", "fabh", "fabd", "fabg", "fabl", "t2fas", "beta-ketoacyl-acp"]

NRPS_A_TERMS = ["amp-binding", "adenylation", "a_domain", "a domain", "acyl-coa synthetase"]
NRPS_C_TERMS = ["condensation", "condens", "c_domain", "c domain"]
NRPS_PCP_TERMS = ["pp-binding", "pcp", "peptidyl carrier", "thiolation"]
NRPS_TE_TERMS = ["thioesterase", " te domain"]

RIPP_TERMS = ["ycao", "lanc_like", "lanth", "tomm", "microcin", "thiostrepton", "ripp", "radical sam", "lap_dehydr"]
TERPENE_TERMS = ["terpene", "prenyltransferase", "squalene", "phytoene", "lycopene", "isoprenoid", "hopene", "cyclase"]
SACCHARIDE_TERMS = ["glycosyl", "glyco_transf", "sugar", "polysacc", "dtdp", "mgt", "sacch"]
TAILORING_TERMS = ["p450", "methyltransferase", "oxidoreductase", "monooxygenase", "dioxygenase", "dehydrogenase", "aminotransferase", "halogenase", "glycosyltransferase", "radical sam", "reductase", "hydroxylase", "cyclase"]
TRANSPORT_TERMS = ["transporter", "abc", "efflux", "mate", "permease", "export"]
REGULATORY_TERMS = ["regulator", "transcription", "response regulator", "luxr", "tetr", "lysr", "hth"]
PRIMARY_RISK_TERMS = ["ribosomal protein", "dna polymerase", "rna polymerase", "trna", "rrna", "housekeeping", "central metabolism"]

TIER_RANK = {
    "Tier1": 1,
    "Tier2": 2,
    "Tier3": 3,
    "Tier4": 4,
    "Tier5": 5,
}


def parse_type_scores(raw: str | None) -> dict[str, float]:
    scores: dict[str, float] = {}
    if not raw:
        return scores
    for part in str(raw).split(";"):
        if "=" not in part:
            continue
        key, value = part.split("=", 1)
        try:
            scores[key.strip()] = float(value)
        except ValueError:
            continue
    return scores


def type_stats(row: dict[str, Any]) -> dict[str, Any]:
    scores = row.get("type_scores")
    if not isinstance(scores, dict):
        scores = parse_type_scores(row.get("v4_1_type_scores") or row.get("type_scores_text"))
    if scores:
        ranked = sorted(((str(k), float(v)) for k, v in scores.items()), key=lambda kv: kv[1], reverse=True)
        top_type, top_score = ranked[0]
        top2_type, top2_score = ranked[1] if len(ranked) > 1 else ("", math.nan)
        margin = top_score - top2_score if len(ranked) > 1 else math.nan
        n_high = sum(v >= 0.5 for _, v in ranked)
    else:
        top_type = str(row.get("v4_1_type") or row.get("bgc_type") or row.get("type") or "Other")
        top_score = _float_or_nan(row.get("v4_1_type_score") or row.get("type_score"))
        top2_type = str(row.get("v4_1_type_top2") or "")
        top2_score = math.nan
        margin = math.nan
        n_high = 0

    if math.isnan(margin):
        confidence = "unknown"
    elif margin < 0.10:
        confidence = "low"
    elif margin < 0.20:
        confidence = "medium"
    else:
        confidence = "high"

    return {
        "model_top_type": top_type,
        "model_top_score": top_score,
        "model_top2_type": top2_type,
        "model_top2_score": top2_score,
        "type_margin": margin,
        "type_confidence": confidence,
        "n_type_scores_ge_0_5": n_high,
    }


def _float_or_nan(value: Any) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return math.nan


def text_for_cds(cds: dict[str, Any]) -> str:
    bits: list[str] = []
    for key in ("product", "function_class", "locus_tag"):
        if cds.get(key):
            bits.append(str(cds[key]))
    for domain in cds.get("pfam_domains") or []:
        for key in ("name", "accession", "description"):
            if domain.get(key):
                bits.append(str(domain[key]))
    return " ".join(bits).lower()


def has_any(text: str, terms: list[str]) -> bool:
    return any(term.lower() in text for term in terms)


def collect_evidence(cds_list: list[dict[str, Any]], mibig_hits: list[dict[str, Any]]) -> dict[str, Any]:
    ev: dict[str, Any] = Counter()
    cds_texts = [text_for_cds(cds) for cds in cds_list]
    ev["n_cds"] = len(cds_list)
    ev["max_cds_aa"] = max([int(cds.get("length_aa") or 0) for cds in cds_list] or [0])
    ev["n_long_cds_ge_1000aa"] = sum(1 for cds in cds_list if int(cds.get("length_aa") or 0) >= 1000)
    ev["n_small_cds_le_120aa"] = sum(1 for cds in cds_list if 0 < int(cds.get("length_aa") or 0) <= 120)
    ev["has_pks_ks"] = any(has_any(text, PKS_KS_TERMS) for text in cds_texts)
    ev["has_pks_at"] = any(has_any(text, PKS_AT_TERMS) for text in cds_texts)
    ev["has_pks_acp"] = any(has_any(text, PKS_ACP_TERMS) for text in cds_texts)
    ev["has_pks_reducing"] = any(has_any(text, PKS_REDUCING_TERMS) for text in cds_texts)
    ev["has_typeii_pks_signal"] = any(has_any(text, TYPEII_PKS_TERMS) for text in cds_texts)
    ev["has_fas_risk"] = any(has_any(text, FAS_RISK_TERMS) for text in cds_texts)
    ev["has_nrps_a"] = any(has_any(text, NRPS_A_TERMS) for text in cds_texts)
    ev["has_nrps_c"] = any(has_any(text, NRPS_C_TERMS) for text in cds_texts)
    ev["has_nrps_pcp"] = any(has_any(text, NRPS_PCP_TERMS) for text in cds_texts)
    ev["has_nrps_te"] = any(has_any(text, NRPS_TE_TERMS) for text in cds_texts)
    ev["has_ripp_mod"] = any(has_any(text, RIPP_TERMS) for text in cds_texts)
    ev["has_terpene_core"] = any(has_any(text, TERPENE_TERMS) for text in cds_texts)
    ev["has_saccharide_core"] = any(has_any(text, SACCHARIDE_TERMS) for text in cds_texts)
    ev["n_tailoring_cds"] = sum(1 for text in cds_texts if has_any(text, TAILORING_TERMS))
    ev["n_transport_cds"] = sum(1 for text in cds_texts if has_any(text, TRANSPORT_TERMS))
    ev["n_regulatory_cds"] = sum(1 for text in cds_texts if has_any(text, REGULATORY_TERMS))
    ev["n_primary_risk_cds"] = sum(1 for text in cds_texts if has_any(text, PRIMARY_RISK_TERMS))
    ev["n_core_signals"] = sum(bool(ev[key]) for key in [
        "has_pks_ks", "has_pks_at", "has_pks_acp", "has_nrps_a", "has_nrps_c",
        "has_nrps_pcp", "has_ripp_mod", "has_terpene_core", "has_saccharide_core",
    ])
    ev["n_mibig_hits"] = len(mibig_hits)

    max_identity = 0.0
    top_product = ""
    for hit in mibig_hits:
        identity = _float_or_nan(hit.get("identity"))
        if not math.isnan(identity) and identity > max_identity:
            max_identity = identity
            top_product = str(hit.get("product") or "")
    ev["max_mibig_identity"] = max_identity
    ev["top_mibig_product"] = top_product
    return dict(ev)


def mechanism_label(model_type: str, ev: dict[str, Any], type_confidence: str) -> str:
    low = type_confidence in {"low", "unknown"}
    if model_type == "Polyketide":
        if ev["has_pks_ks"] and ev["has_pks_at"] and ev["has_pks_acp"] and ev["max_cds_aa"] >= 1000:
            return "typeI_PKS_supported"
        if ev["has_typeii_pks_signal"] or (ev["has_pks_ks"] and not ev["has_pks_at"]):
            return "typeII_or_FAS_like_risk" if ev["has_fas_risk"] else "typeII_PKS_like"
        if ev["has_pks_ks"] or ev["has_pks_reducing"] or ev["has_pks_acp"]:
            return "partial_PKS_like"
        return "polyketide_embedding_only_ambiguous" if low else "polyketide_like_no_domain_support"
    if model_type == "NRP":
        if ev["has_nrps_a"] and ev["has_nrps_pcp"] and (ev["has_nrps_c"] or ev["has_nrps_te"]):
            return "NRPS_supported"
        if ev["has_nrps_a"] or ev["has_nrps_pcp"] or ev["has_nrps_c"]:
            return "partial_NRPS_like"
        return "NRP_embedding_only_ambiguous" if low else "NRP_like_no_domain_support"
    if model_type == "RiPP":
        if ev["has_ripp_mod"] and ev["n_small_cds_le_120aa"] >= 1:
            return "RiPP_supported"
        if ev["has_ripp_mod"]:
            return "RiPP_like_no_clear_precursor"
        return "RiPP_embedding_only_ambiguous" if low else "RiPP_like_no_domain_support"
    if model_type == "Terpene":
        if ev["has_terpene_core"]:
            return "terpene_supported"
        return "terpene_embedding_only_ambiguous" if low else "terpene_like_no_domain_support"
    if model_type == "Saccharide":
        if ev["has_saccharide_core"] and ev["n_tailoring_cds"] >= 1:
            return "saccharide_supported"
        return "saccharide_embedding_only_ambiguous" if low else "saccharide_like_no_domain_support"
    if model_type == "Alkaloid":
        return "alkaloid_like_tentative" if not low else "alkaloid_embedding_only_ambiguous"
    if model_type == "Other":
        if ev["n_core_signals"] or ev["n_tailoring_cds"] >= 2:
            return "other_biosynthetic_supported"
        return "other_embedding_only_ambiguous"
    return "untyped_bgc_like"


def evidence_tier(length_bp: int, at_edge: bool, ev: dict[str, Any], label: str, type_confidence: str) -> str:
    has_bio = (
        ev["n_core_signals"] >= 2
        or label.endswith("_supported")
        or ev["n_tailoring_cds"] >= 2
        or ev["max_mibig_identity"] >= 0.35
    )
    has_strong = ev["n_core_signals"] >= 3 or label.endswith("_supported") or ev["max_mibig_identity"] >= 0.70
    if length_bp < 3000 or ev["n_cds"] <= 2:
        return "Tier4_fragmentary_or_single_gene"
    if at_edge or length_bp < 5000:
        return "Tier4_fragmentary_or_contig_edge"
    if not has_bio:
        return "Tier5_embedding_only_or_likely_FP"
    if "FAS_like_risk" in label or ev["n_primary_risk_cds"] >= max(2, ev["n_cds"] // 2):
        return "Tier5_primary_metabolism_risk"
    if has_strong and type_confidence == "high":
        return "Tier1_known_like_high_confidence"
    if has_strong:
        return "Tier2_biosynthetic_supported"
    return "Tier3_novel_architecture_or_low_confidence"


def raw_safe_pass(tier: str, label: str) -> bool:
    if tier.startswith("Tier5") or tier.startswith("Tier4"):
        return False
    if "embedding_only" in label or "no_domain_support" in label:
        return False
    return True


def tier_rank(tier: str) -> int:
    for prefix, rank in TIER_RANK.items():
        if str(tier).startswith(prefix):
            return rank
    return 99


def annotate_region(
    *,
    row: dict[str, Any],
    cds_list: list[dict[str, Any]],
    mibig_hits: list[dict[str, Any]],
    contig_len: int,
    safe_tier_min: str,
) -> dict[str, Any]:
    start = int(row.get("start") or 0)
    end = int(row.get("end") or 0)
    length_bp = max(0, end - start)
    at_start = start <= 500
    at_end = bool(contig_len and contig_len - end <= 500)
    tstats = type_stats(row)
    ev = collect_evidence(cds_list, mibig_hits)
    label = mechanism_label(str(tstats["model_top_type"]), ev, str(tstats["type_confidence"]))
    tier = evidence_tier(length_bp, at_start or at_end, ev, label, str(tstats["type_confidence"]))
    min_rank = tier_rank(safe_tier_min)
    passes = raw_safe_pass(tier, label) and tier_rank(tier) <= min_rank
    return {
        "bgc_id": row.get("bgc_id"),
        "region_length_bp": length_bp,
        "contig_length_bp": contig_len,
        "at_contig_start": at_start,
        "at_contig_end": at_end,
        **{k: ("" if isinstance(v, float) and math.isnan(v) else v) for k, v in tstats.items()},
        **ev,
        "safe_type_label": label,
        "evidence_tier": tier,
        "safe_pass": passes,
    }
