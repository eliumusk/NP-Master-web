from __future__ import annotations

import argparse
import json
import logging
import os
import re
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import TYPE_CHECKING, Any
from zoneinfo import ZoneInfo

import httpx

from . import model_pool

if TYPE_CHECKING:
    from .config import Settings

log = logging.getLogger("ops_monitor")
PROGRESS_RE = re.compile(
    r"(?P<ts>\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}),\d+ INFO progress "
    r"n=(?P<n>\d+) fwd_s=[0-9.]+ rate=(?P<rate>[0-9.]+) win/s"
)
TASK_START_RE = re.compile(r"INFO task (?P<id>[0-9a-f]+) kind=(?P<kind>\w+) start")
ACTIVE_STATUSES = ("awaiting_upload", "queued", "running")


def parse_timestamp(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def iso_seconds(value: str | None, now: datetime) -> float | None:
    parsed = parse_timestamp(value)
    if parsed is None:
        return None
    return max(0.0, (now - parsed).total_seconds())


def public_job(job: dict[str, Any], now: datetime) -> dict[str, Any]:
    return {
        "id": job["id"],
        "title": job.get("title") or "",
        "status": job["status"],
        "created_at": job.get("created_at"),
        "started_at": job.get("started_at"),
        "finished_at": job.get("finished_at"),
        "last_heartbeat": job.get("last_heartbeat"),
        "log_tail": job.get("log_tail") or "",
        "error": (job.get("error") or "")[:500],
        "n_genomes": job.get("n_genomes") or 0,
        "n_regions": job.get("n_regions") or 0,
        "age_seconds": iso_seconds(job.get("created_at"), now),
        "running_seconds": iso_seconds(job.get("started_at"), now),
        "heartbeat_age_seconds": iso_seconds(job.get("last_heartbeat"), now),
    }


def summarize_jobs(jobs: list[dict[str, Any]], now: datetime) -> dict[str, Any]:
    active = [public_job(job, now) for job in jobs if job.get("status") in ACTIVE_STATUSES]
    queued = sorted((job for job in active if job["status"] == "queued"), key=lambda job: job["created_at"] or "")
    running = [job for job in active if job["status"] == "running"]
    awaiting = [job for job in active if job["status"] == "awaiting_upload"]
    cutoff = now - timedelta(hours=24)
    finished = []
    for job in jobs:
        finished_at = parse_timestamp(job.get("finished_at"))
        if finished_at is None or finished_at < cutoff:
            continue
        row = public_job(job, now)
        started_at = parse_timestamp(job.get("started_at"))
        row["duration_seconds"] = max(0.0, (finished_at - started_at).total_seconds()) if started_at else None
        finished.append(row)
    done = [job for job in finished if job["status"] == "done"]
    failed = [job for job in finished if job["status"] == "failed"]
    durations = [job["duration_seconds"] for job in done if job["duration_seconds"] is not None]
    return {
        "counts": {
            "awaiting_upload": len(awaiting),
            "queued": len(queued),
            "running": len(running),
            "done_24h": len(done),
            "failed_24h": len(failed),
        },
        "oldest_queued_seconds": queued[0]["age_seconds"] if queued else None,
        "queued": queued,
        "running": running,
        "awaiting_upload": awaiting,
        "failed_24h": failed,
        "average_done_duration_seconds": sum(durations) / len(durations) if durations else None,
        "done_per_hour_24h": len(done) / 24,
    }


def load_jobs(supa: Any, now: datetime) -> list[dict[str, Any]]:
    fields = "id,title,status,created_at,started_at,finished_at,last_heartbeat,log_tail,error,n_genomes,n_regions"
    active = (
        supa.table("jobs").select(fields).in_("status", list(ACTIVE_STATUSES))
        .order("created_at").limit(500).execute().data or []
    )
    recent = (
        supa.table("jobs").select(fields)
        .gte("finished_at", (now - timedelta(hours=24)).isoformat())
        .order("finished_at", desc=True).limit(500).execute().data or []
    )
    return list({job["id"]: job for job in [*active, *recent]}.values())


def worker_processes() -> list[int]:
    pids = []
    for entry in Path("/proc").iterdir():
        if not entry.name.isdigit():
            continue
        try:
            args = (entry / "cmdline").read_bytes().split(b"\0")
        except OSError:
            continue
        if b"serve.worker" in args:
            pids.append(int(entry.name))
    return sorted(pids)


def read_last_progress(path: Path, now: datetime, max_age_sec: int = 90) -> dict[str, Any] | None:
    try:
        with path.open("rb") as fh:
            fh.seek(0, os.SEEK_END)
            size = fh.tell()
            fh.seek(max(0, size - 262144))
            text = fh.read().decode("utf-8", "replace")
    except OSError:
        return None
    starts = list(TASK_START_RE.finditer(text))
    if not starts or starts[-1].group("kind") != "extract_per_token":
        return None
    start = starts[-1]
    if re.search(rf"INFO task {start.group('id')} (?:ok in|failed:)", text[start.end():]):
        return None
    matches = list(PROGRESS_RE.finditer(text, start.end()))
    if not matches:
        return None
    match = matches[-1]
    timestamp = datetime.strptime(match.group("ts"), "%Y-%m-%d %H:%M:%S").replace(tzinfo=timezone.utc)
    age = max(0.0, (now - timestamp).total_seconds())
    if age > max_age_sec:
        return None
    return {"windows_done": int(match.group("n")), "win_per_sec": float(match.group("rate")), "age_seconds": age}


def gpu_stats() -> dict[int, dict[str, Any]]:
    try:
        import pynvml

        pynvml.nvmlInit()
        try:
            stats = {}
            for index in range(pynvml.nvmlDeviceGetCount()):
                handle = pynvml.nvmlDeviceGetHandleByIndex(index)
                memory = pynvml.nvmlDeviceGetMemoryInfo(handle)
                utilization = pynvml.nvmlDeviceGetUtilizationRates(handle)
                stats[index] = {
                    "memory_used_mib": round(memory.used / 1024**2),
                    "memory_total_mib": round(memory.total / 1024**2),
                    "utilization_percent": utilization.gpu,
                    "temperature_c": pynvml.nvmlDeviceGetTemperature(handle, pynvml.NVML_TEMPERATURE_GPU),
                }
            return stats
        finally:
            pynvml.nvmlShutdown()
    except Exception as exc:
        log.warning("NVML metrics unavailable: %s", exc)
        return {}


def collect_local_metrics(settings: Settings, now: datetime) -> dict[str, Any]:
    root = model_pool.daemon_root(settings)
    stats = gpu_stats()
    models = []
    for gpu in model_pool.configured_gpus(settings):
        healthy, reason = model_pool._daemon_health(root, gpu, settings.model_daemon_ready_staleness_sec)
        progress = read_last_progress(root / f"gpu{gpu}" / "daemon.log", now)
        models.append({
            "gpu": gpu,
            "healthy": healthy,
            "reason": reason,
            "progress": progress,
            **stats.get(gpu, {}),
        })
    rates = [model["progress"]["win_per_sec"] for model in models if model["progress"]]
    return {
        "worker": {"process_alive": bool(worker_processes()), "pids": worker_processes()},
        "models": models,
        "model_healthy_count": sum(model["healthy"] for model in models),
        "model_configured_count": len(models),
        "total_win_per_sec": sum(rates) if rates else 0.0,
    }


def collect_metrics(supa: Any, settings: Settings, now: datetime | None = None) -> dict[str, Any]:
    now = now or datetime.now(timezone.utc)
    metrics = {
        "schema_version": 1,
        "collected_at": now.isoformat(),
        "supabase": {"ok": True, "error": ""},
        **collect_local_metrics(settings, now),
    }
    try:
        metrics["jobs"] = summarize_jobs(load_jobs(supa, now), now)
    except Exception as exc:
        metrics["supabase"] = {"ok": False, "error": str(exc)[:500]}
        metrics["jobs"] = None
    return metrics


def active_alerts(metrics: dict[str, Any], settings: Settings) -> dict[str, str]:
    alerts = {}
    if not metrics["supabase"]["ok"]:
        alerts["supabase"] = f"Supabase 采集失败：{metrics['supabase']['error']}"
    if not metrics["worker"]["process_alive"]:
        alerts["worker_process"] = "本地 serve.worker 进程不存在"
    for model in metrics["models"]:
        if not model["healthy"]:
            alerts[f"model_gpu_{model['gpu']}"] = f"GPU {model['gpu']} 模型不健康：{model['reason']}"
    jobs = metrics.get("jobs")
    if not jobs:
        return alerts
    if jobs["counts"]["queued"] > settings.feishu_queue_alert_threshold:
        alerts["queue_backlog"] = (
            f"排队任务 {jobs['counts']['queued']} 个，超过阈值 {settings.feishu_queue_alert_threshold}"
        )
    for job in jobs["running"]:
        age = job.get("heartbeat_age_seconds")
        if age is None or age > settings.ops_worker_heartbeat_staleness_sec:
            alerts[f"job_heartbeat_{job['id']}"] = f"运行任务 {job['id'][:8]} 心跳过期：{job['log_tail']}"
    return alerts


def summary_text(metrics: dict[str, Any]) -> str:
    jobs = metrics.get("jobs")
    job_text = "任务数据不可用"
    if jobs:
        counts = jobs["counts"]
        current = f"，当前阶段：{jobs['running'][0]['log_tail']}" if jobs["running"] else ""
        job_text = (
            f"排队 {counts['queued']}，等待上传 {counts['awaiting_upload']}，运行 {counts['running']}；"
            f"近 24 小时完成 {counts['done_24h']}，失败 {counts['failed_24h']}{current}"
        )
    return (
        f"{job_text}\n模型 {metrics['model_healthy_count']}/{metrics['model_configured_count']} 健康；"
        f"当前提取速度 {metrics['total_win_per_sec']:.2f} windows/s\n"
        f"采集时间：{metrics['collected_at']}"
    )


def build_notifications(
    metrics: dict[str, Any], state: dict[str, Any], settings: Settings, now: datetime
) -> tuple[list[dict[str, str]], dict[str, Any]]:
    previous = state.get("active_alerts", {})
    current = active_alerts(metrics, settings)
    notifications = []
    active_state = {}
    for key, detail in current.items():
        last_sent = float(previous.get(key, {}).get("last_sent", 0))
        if key not in previous or now.timestamp() - last_sent >= settings.feishu_alert_cooldown_sec:
            notifications.append({"title": "Genomine 后台告警", "level": "red", "text": detail})
        active_state[key] = {"last_sent": max(last_sent, now.timestamp())}
    for key in previous:
        if key not in current:
            notifications.append({"title": "Genomine 后台恢复", "level": "green", "text": f"已恢复：{key}"})
    notified_failures = set(state.get("notified_failures", []))
    jobs = metrics.get("jobs")
    if jobs:
        for job in jobs["failed_24h"]:
            if job["id"] not in notified_failures:
                notifications.append({
                    "title": "Genomine 任务失败",
                    "level": "red",
                    "text": f"任务 {job['id'][:8]}：{job['error'] or '未提供错误详情'}",
                })
                notified_failures.add(job["id"])
    shanghai = now.astimezone(ZoneInfo("Asia/Shanghai"))
    daily_date = shanghai.date().isoformat()
    if shanghai.strftime("%H:%M") >= settings.feishu_daily_summary_time and state.get("daily_summary_date") != daily_date:
        notifications.append({"title": "Genomine 每日后台汇总", "level": "blue", "text": summary_text(metrics)})
    new_state = {
        "active_alerts": active_state,
        "notified_failures": sorted(notified_failures)[-500:],
        "daily_summary_date": daily_date if any(n["title"] == "Genomine 每日后台汇总" for n in notifications) else state.get("daily_summary_date", ""),
    }
    return notifications, new_state


class FeishuClient:
    def __init__(self, settings: Settings):
        self.app_id = settings.feishu_app_id
        self.app_secret = settings.feishu_app_secret
        self.chat_id = settings.feishu_chat_id
        self._token = ""
        self._token_expires = 0.0

    @property
    def configured(self) -> bool:
        return bool(self.app_id and self.app_secret and self.chat_id)

    def tenant_token(self) -> str:
        if self._token and time.time() < self._token_expires:
            return self._token
        response = httpx.post(
            "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal",
            json={"app_id": self.app_id, "app_secret": self.app_secret}, timeout=15,
        )
        response.raise_for_status()
        payload = response.json()
        if payload.get("code") != 0:
            raise RuntimeError(f"Feishu token error: {payload.get('msg')}")
        self._token = payload["tenant_access_token"]
        self._token_expires = time.time() + int(payload.get("expire", 7200)) - 300
        return self._token

    def send(self, title: str, text: str, level: str = "blue") -> None:
        card = {
            "config": {"wide_screen_mode": True},
            "header": {"title": {"tag": "plain_text", "content": title}, "template": level},
            "elements": [{"tag": "div", "text": {"tag": "lark_md", "content": text}}],
        }
        response = httpx.post(
            "https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=chat_id",
            headers={"Authorization": f"Bearer {self.tenant_token()}"},
            json={"receive_id": self.chat_id, "msg_type": "interactive", "content": json.dumps(card, ensure_ascii=False)},
            timeout=15,
        )
        response.raise_for_status()
        payload = response.json()
        if payload.get("code") != 0:
            raise RuntimeError(f"Feishu send error: {payload.get('msg')}")


def state_path(settings: Settings) -> Path:
    return settings.npmaster_cache_dir / "ops" / "feishu_monitor_state.json"


def load_state(path: Path) -> dict[str, Any]:
    try:
        return json.loads(path.read_text())
    except (OSError, ValueError):
        return {}


def save_state(path: Path, state: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(state, ensure_ascii=False, indent=2))
    os.replace(temporary, path)


def publish_snapshot(supa: Any, settings: Settings, metrics: dict[str, Any]) -> None:
    supa.table("ops_snapshots").upsert({
        "source": settings.worker_id,
        "metrics": metrics,
        "updated_at": metrics["collected_at"],
    }).execute()


def run_iteration(supa: Any, settings: Settings, feishu: FeishuClient, dry_run: bool) -> dict[str, Any]:
    now = datetime.now(timezone.utc)
    metrics = collect_metrics(supa, settings, now)
    path = state_path(settings)
    state = load_state(path)
    notifications, new_state = build_notifications(metrics, state, settings, now)
    if dry_run:
        print(json.dumps({"metrics": metrics, "notifications": notifications}, ensure_ascii=False, indent=2))
        return metrics
    if metrics["supabase"]["ok"]:
        publish_snapshot(supa, settings, metrics)
    for notification in notifications:
        if feishu.configured:
            feishu.send(**notification)
        else:
            log.info("Feishu not configured; notification: %s", notification)
    save_state(path, new_state)
    log.info("snapshot published; %s", summary_text(metrics).replace("\n", " | "))
    return metrics


def main() -> int:
    from .client import make_client
    from .config import get_settings

    parser = argparse.ArgumentParser()
    parser.add_argument("--once", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--log-level", default="INFO")
    args = parser.parse_args()
    logging.basicConfig(level=args.log_level, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    settings = get_settings()
    supa = make_client(settings)
    feishu = FeishuClient(settings)
    while True:
        try:
            run_iteration(supa, settings, feishu, args.dry_run)
        except Exception:
            log.exception("monitor iteration failed")
        if args.once:
            return 0
        time.sleep(settings.ops_monitor_interval_sec)


if __name__ == "__main__":
    raise SystemExit(main())
