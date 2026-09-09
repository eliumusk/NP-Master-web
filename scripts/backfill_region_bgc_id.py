#!/usr/bin/env python3
"""Backfill regions.bgc_id from each done job's regions.csv artifact.

Migration 0007 added the column; jobs processed before it have NULL, which
makes the web UI's positional ids (BGC_0001…) impossible to cross-reference
with downloaded Excel/CSV artifacts. This script maps pipeline ids onto
existing rows, matched on (job_id, genome_name, contig, start_bp, end_bp).

Idempotent: only rows with bgc_id IS NULL are read/updated. Safe to re-run.

Usage (from the repo root):
    .venv-serve/bin/python scripts/backfill_region_bgc_id.py            # all jobs missing ids
    .venv-serve/bin/python scripts/backfill_region_bgc_id.py <job_id>…  # specific jobs
"""
from __future__ import annotations

import csv
import io
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from serve.client import make_client
from serve.config import get_settings


def _job_ids(supa, argv: list[str]) -> list[str]:
    if argv:
        return argv
    res = supa.table("regions").select("job_id").is_("bgc_id", "null").execute()
    return sorted({row["job_id"] for row in res.data or []})


def _csv_keys(supa, bucket: str, job_id: str):
    """Job-level merged CSV first, then per-genome CSVs (storage folders have id=None)."""
    yield f"{job_id}/regions.csv"
    for entry in supa.storage.from_(bucket).list(job_id) or []:
        if entry.get("id") is None and entry.get("name"):
            yield f"{job_id}/{entry['name']}/regions.csv"


def _bgc_map_from_csv(text: str) -> dict[tuple, str]:
    out = {}
    for row in csv.DictReader(io.StringIO(text)):
        key = (row["genome"], row["contig"], int(row["start"]), int(row["end"]))
        out[key] = row["bgc_id"]
    return out


def backfill_job(supa, bucket: str, job_id: str) -> tuple[int, int]:
    maps: dict[tuple, str] = {}
    for key in _csv_keys(supa, bucket, job_id):
        try:
            data = supa.storage.from_(bucket).download(key)
        except Exception:
            continue
        maps.update(_bgc_map_from_csv(data.decode()))
    if not maps:
        print(f"{job_id}: no regions.csv artifact found, skipped")
        return 0, 0
    res = (
        supa.table("regions")
        .select("id,genome_name,contig,start_bp,end_bp")
        .eq("job_id", job_id)
        .is_("bgc_id", "null")
        .execute()
    )
    updated, missed = 0, 0
    for region in res.data or []:
        key = (region["genome_name"], region["contig"], region["start_bp"], region["end_bp"])
        bgc_id = maps.get(key)
        if not bgc_id:
            missed += 1
            continue
        supa.table("regions").update({"bgc_id": bgc_id}).eq("id", region["id"]).execute()
        updated += 1
    return updated, missed


def main() -> None:
    settings = get_settings()
    supa = make_client(settings)
    for job_id in _job_ids(supa, sys.argv[1:]):
        updated, missed = backfill_job(supa, settings.results_bucket, job_id)
        print(f"{job_id}: updated={updated} missed={missed}")


if __name__ == "__main__":
    main()
