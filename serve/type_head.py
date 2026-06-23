from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Any

BGC_TYPES = ["Alkaloid", "Terpene", "NRP", "Polyketide", "RiPP", "Saccharide", "Other"]


def _strip_pfam_version(accession: str) -> str:
    return accession.split(".", 1)[0].strip()


def domain_accessions_for_cds(cds_list: list[dict[str, Any]]) -> list[str]:
    accessions: list[str] = []
    for cds in cds_list:
        for domain in cds.get("pfam_domains") or []:
            acc = str(domain.get("accession") or "").strip()
            if acc:
                accessions.append(_strip_pfam_version(acc))
    return accessions


@lru_cache(maxsize=4)
def _load_bundle(path: str) -> dict[str, Any]:
    import joblib

    return joblib.load(path)


def _predict_proba(model: Any, x: Any, n_classes: int) -> Any:
    import numpy as np

    raw = model.predict_proba(x)
    out = np.zeros((x.shape[0], n_classes), dtype=np.float32)
    per_label = raw if isinstance(raw, list) else [raw]
    model_classes = model.classes_
    if not isinstance(model_classes, list):
        model_classes = [model_classes]
    for j, probs in enumerate(per_label):
        classes_j = [int(c) for c in model_classes[j]]
        if 1 in classes_j:
            out[:, j] = probs[:, classes_j.index(1)]
    return out


def predict_region_types(
    *,
    type_head_path: Path,
    cds_by_region: dict[str, list[dict[str, Any]]],
    region_ids: list[str],
) -> dict[str, dict[str, Any]]:
    """Predict BGC product classes from Pfam accessions using the RF head."""
    import numpy as np

    bundle = _load_bundle(str(type_head_path))
    classes = [str(c) for c in bundle.get("classes") or BGC_TYPES]
    vocab = [str(v) for v in bundle["vocab"]]
    vocab_index = {v: i for i, v in enumerate(vocab)}
    binary = bool(bundle.get("binary_features", False))

    rows = np.zeros((len(region_ids), len(vocab)), dtype=np.float32)
    for i, region_id in enumerate(region_ids):
        for acc in domain_accessions_for_cds(cds_by_region.get(region_id, [])):
            j = vocab_index.get(acc)
            if j is not None:
                rows[i, j] += 1.0
    if binary:
        rows = (rows > 0).astype(np.float32)

    probs = _predict_proba(bundle["model"], rows, len(classes))
    out: dict[str, dict[str, Any]] = {}
    for i, region_id in enumerate(region_ids):
        scores = {classes[j]: float(probs[i, j]) for j in range(len(classes))}
        ranked = sorted(scores.items(), key=lambda kv: kv[1], reverse=True)
        top_type, top_score = ranked[0] if ranked else ("Other", 0.0)
        top2_type, top2_score = ranked[1] if len(ranked) > 1 else ("", 0.0)
        out[region_id] = {
            "type": top_type,
            "score": top_score,
            "top2_type": top2_type,
            "top2_score": top2_score,
            "scores": scores,
            "scores_text": ";".join(f"{k}={v:.3f}" for k, v in scores.items()),
        }
    return out
