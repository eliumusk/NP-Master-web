"""Unit tests for cluster-level MIBiG similarity aggregation.

Regression guard for the "similarity always >=50%" bug: the UI similarity must
be a gene-content score, not the max single-protein identity.
"""
from __future__ import annotations

from serve.mibig import _aggregate_blast_hits

META = {
    "BGC0000001|005": {"bgc_id": "BGC0000001", "product": "NRPS"},
    "BGC0000001|006": {"bgc_id": "BGC0000001", "product": "NRPS"},
    "BGC0000002|010": {"bgc_id": "BGC0000002", "product": "PKS"},
}


def _hit(qseq: str, sseq: str, pident: float) -> str:
    return f"{qseq}\t{sseq}\t{pident}\t1e-30\t300\t300\t300\t500"


def test_single_conserved_gene_scores_low() -> None:
    # 4 query CDSs, only one hits a MIBiG bgc — even at 90% identity the
    # cluster-level similarity must stay well below 50%.
    hits = [_hit("R1|000", "BGC0000001|005", 90.0)]
    out = _aggregate_blast_hits(hits, META, {}, {"R1": 4}, top_k=3)
    hit = out["R1"][0]
    assert hit["identity"] == 0.9
    assert hit["similarity"] == round(0.9 / 4, 4)
    assert hit["genes_matched"] == 1
    assert hit["genes_total"] == 4


def test_full_coverage_scores_one() -> None:
    hits = [
        _hit("R1|000", "BGC0000001|005", 100.0),
        _hit("R1|001", "BGC0000001|006", 100.0),
    ]
    out = _aggregate_blast_hits(hits, META, {}, {"R1": 2}, top_k=3)
    assert out["R1"][0]["similarity"] == 1.0


def test_best_hit_per_query_cds_wins() -> None:
    hits = [
        _hit("R1|000", "BGC0000001|005", 60.0),
        _hit("R1|000", "BGC0000001|006", 40.0),
    ]
    out = _aggregate_blast_hits(hits, META, {}, {"R1": 2}, top_k=3)
    hit = out["R1"][0]
    assert hit["genes_matched"] == 1
    assert hit["similarity"] == round(0.6 / 2, 4)
    assert hit["query_cds"] == "R1|000"


def test_ranking_prefers_gene_content_over_single_identity() -> None:
    # bgc2: one 90% hit; bgc1: three 50% hits out of 4 CDSs.
    hits = [
        _hit("R1|000", "BGC0000002|010", 90.0),
        _hit("R1|000", "BGC0000001|005", 50.0),
        _hit("R1|001", "BGC0000001|006", 50.0),
        _hit("R1|002", "BGC0000001|005", 50.0),
    ]
    out = _aggregate_blast_hits(hits, META, {}, {"R1": 4}, top_k=3)
    ranked = out["R1"]
    assert ranked[0]["bgc_id"] == "BGC0000001"
    assert ranked[0]["similarity"] == round(1.5 / 4, 4)
    assert ranked[1]["bgc_id"] == "BGC0000002"
    assert ranked[1]["similarity"] == round(0.9 / 4, 4)
