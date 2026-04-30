from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

import httpx
from supabase import Client, create_client
from tenacity import (
    before_sleep_log,
    retry,
    retry_if_exception_type,
    stop_after_attempt,
    wait_exponential,
)

from .config import Settings

log = logging.getLogger(__name__)

# Transient network errors common when reaching Supabase from networks with
# probabilistic RST (GFW). httpx wraps OSError as TransportError; catch the
# raw OSError too as a safety net.
_TRANSIENT = (httpx.TransportError, ConnectionError, OSError)

_retry = retry(
    stop=stop_after_attempt(5),
    wait=wait_exponential(multiplier=1, min=1, max=10),
    retry=retry_if_exception_type(_TRANSIENT),
    before_sleep=before_sleep_log(log, logging.WARNING),
    reraise=True,
)


def make_client(settings: Settings) -> Client:
    return create_client(settings.supabase_url, settings.supabase_service_role_key)


@_retry
def claim_next_job(supa: Client, worker_id: str) -> dict[str, Any] | None:
    """Atomically claim one queued job. Returns the job row, or None.

    Uses a Postgres function `claim_next_job(worker_id text)` defined in the
    Supabase migration so the SELECT … FOR UPDATE SKIP LOCKED + UPDATE happens
    server-side."""
    res = supa.rpc("claim_next_job", {"worker": worker_id}).execute()
    rows = res.data or []
    return rows[0] if rows else None


@_retry
def heartbeat(supa: Client, job_id: str) -> None:
    supa.rpc("job_heartbeat", {"job": job_id}).execute()


@_retry
def update_job(supa: Client, job_id: str, **fields: Any) -> None:
    supa.table("jobs").update(fields).eq("id", job_id).execute()


def _opt_float(v: Any) -> float | None:
    if v is None or v == "":
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _opt_str(v: Any) -> str | None:
    if v is None:
        return None
    s = str(v).strip()
    return s if s else None


@_retry
def insert_regions(supa: Client, job_id: str, rows: list[dict[str, Any]]) -> None:
    if not rows:
        return
    payload = [
        {
            "job_id": job_id,
            "contig": r["contig"],
            "start_bp": int(r["start"]),
            "end_bp": int(r["end"]),
            "score": float(r["score"]),
            "bgc_type": _opt_str(r.get("v4_1_type")),
            "type_score": _opt_float(r.get("v4_1_type_score")),
        }
        for r in rows
    ]
    # Batch in chunks of 500 to keep request size sane.
    for i in range(0, len(payload), 500):
        supa.table("regions").insert(payload[i : i + 500]).execute()


@_retry
def download_object(supa: Client, bucket: str, key: str, dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    blob = supa.storage.from_(bucket).download(key)
    dest.write_bytes(blob)


@_retry
def upload_object(supa: Client, bucket: str, key: str, src: Path,
                  content_type: str = "application/octet-stream") -> None:
    body = src.read_bytes()
    # upsert=True so retries on the same job_id don't 409.
    supa.storage.from_(bucket).upload(
        key,
        body,
        {"content-type": content_type, "upsert": "true"},
    )


@_retry
def feature_cache_lookup(supa: Client, sha256: str) -> str | None:
    res = supa.table("feature_cache").select("features_path").eq("fasta_sha256", sha256).limit(1).execute()
    rows = res.data or []
    return rows[0]["features_path"] if rows else None


@_retry
def feature_cache_insert(supa: Client, sha256: str, features_path: str, byts: int) -> None:
    supa.table("feature_cache").upsert({
        "fasta_sha256": sha256,
        "features_path": features_path,
        "bytes": byts,
    }).execute()
