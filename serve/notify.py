"""Best-effort job-completion email via Resend.

Activated by setting RESEND_API_KEY in serve/.env. Only registered users
(job.user_id present) with notify_email=true on the job row are emailed;
anonymous jobs never trigger mail. All failures are logged and swallowed —
notification must never break a job.
"""
from __future__ import annotations

import logging
from typing import Any

import httpx

from .config import Settings

log = logging.getLogger(__name__)


def notify_job_finished(
    supa: Any,
    settings: Settings,
    job: dict[str, Any],
    *,
    ok: bool,
    detail: str,
) -> None:
    try:
        _notify(supa, settings, job, ok=ok, detail=detail)
    except Exception as e:  # noqa: BLE001 — notification must not break the worker
        log.warning("notify skipped for job %s: %s", job.get("id"), e)


def _notify(supa: Any, settings: Settings, job: dict[str, Any], *, ok: bool, detail: str) -> None:
    if not settings.resend_api_key:
        return
    if not job.get("notify_email", True):
        return
    user_id = job.get("user_id")
    if not user_id:
        return

    resp = supa.table("profiles").select("email").eq("id", user_id).limit(1).execute()
    rows = resp.data or []
    email = rows[0].get("email") if rows else ""
    if not email:
        return

    job_id = str(job["id"])
    title = job.get("title") or job_id
    url = f"{settings.site_base_url}/jobs/{job_id}"
    if ok:
        subject = f"[BGCMaster] 任务完成 / Job finished: {title}"
        text = (
            f"你的任务「{title}」已完成。\n{detail}\n查看结果：{url}\n\n"
            f"Your job \"{title}\" has finished.\n{detail}\nResults: {url}\n"
        )
    else:
        subject = f"[BGCMaster] 任务失败 / Job failed: {title}"
        text = (
            f"你的任务「{title}」未能完成。\n原因：{detail[:500]}\n任务页：{url}\n\n"
            f"Your job \"{title}\" failed.\nReason: {detail[:500]}\nJob: {url}\n"
        )

    r = httpx.post(
        "https://api.resend.com/emails",
        headers={"Authorization": f"Bearer {settings.resend_api_key}"},
        json={"from": settings.email_from, "to": [email], "subject": subject, "text": text},
        timeout=15,
    )
    r.raise_for_status()
    log.info("notified %s for job %s (ok=%s)", email, job_id, ok)
