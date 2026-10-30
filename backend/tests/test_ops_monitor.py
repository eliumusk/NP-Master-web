from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace

from backend.ops_monitor import (
    active_alerts,
    build_notifications,
    read_last_progress,
    summarize_jobs,
)

NOW = datetime(2026, 10, 30, 12, 0, tzinfo=timezone.utc)


def settings(**overrides):
    values = {
        "feishu_queue_alert_threshold": 2,
        "ops_worker_heartbeat_staleness_sec": 120,
        "feishu_alert_cooldown_sec": 3600,
        "feishu_daily_summary_time": "23:59",
    }
    values.update(overrides)
    return SimpleNamespace(**values)


def iso(value: datetime) -> str:
    return value.isoformat()


def job(job_id: str, status: str, **overrides):
    values = {
        "id": job_id,
        "title": "test",
        "status": status,
        "created_at": iso(NOW - timedelta(minutes=10)),
        "started_at": None,
        "finished_at": None,
        "last_heartbeat": None,
        "log_tail": "",
        "error": None,
        "n_genomes": 1,
        "n_regions": 0,
    }
    values.update(overrides)
    return values


def test_summarize_jobs_counts_queue_and_recent_throughput():
    jobs = [
        job("queued-old", "queued", created_at=iso(NOW - timedelta(minutes=30))),
        job("queued-new", "queued"),
        job("running", "running", started_at=iso(NOW - timedelta(minutes=5)), last_heartbeat=iso(NOW)),
        job("done", "done", started_at=iso(NOW - timedelta(hours=2)), finished_at=iso(NOW - timedelta(hours=1))),
        job("failed", "failed", finished_at=iso(NOW - timedelta(minutes=20)), error="boom"),
        job("old-done", "done", finished_at=iso(NOW - timedelta(days=2))),
    ]
    summary = summarize_jobs(jobs, NOW)
    assert summary["counts"] == {
        "awaiting_upload": 0,
        "queued": 2,
        "running": 1,
        "done_24h": 1,
        "failed_24h": 1,
    }
    assert summary["oldest_queued_seconds"] == 1800
    assert summary["average_done_duration_seconds"] == 3600
    assert summary["failed_24h"][0]["error"] == "boom"


def test_read_last_progress_ignores_stale_history(tmp_path: Path):
    path = tmp_path / "daemon.log"
    path.write_text(
        "2026-10-30 11:59:00,000 INFO task abc123 kind=extract_per_token start\n"
        "2026-10-30 11:59:45,000 INFO progress n=50 fwd_s=25.0 rate=1.950 win/s\n"
    )
    progress = read_last_progress(path, NOW)
    assert progress is not None
    assert progress["windows_done"] == 50
    assert progress["win_per_sec"] == 1.95
    assert read_last_progress(path, NOW + timedelta(minutes=2)) is None


def test_read_last_progress_ignores_completed_extraction(tmp_path: Path):
    path = tmp_path / "daemon.log"
    path.write_text(
        "2026-10-30 11:59:00,000 INFO task abc123 kind=extract_per_token start\n"
        "2026-10-30 11:59:45,000 INFO progress n=50 fwd_s=25.0 rate=1.950 win/s\n"
        "2026-10-30 11:59:50,000 INFO task abc123 ok in 50.0s: {}\n"
    )
    assert read_last_progress(path, NOW) is None


def metrics_for_alerts():
    return {
        "supabase": {"ok": True, "error": ""},
        "worker": {"process_alive": True},
        "models": [{"gpu": 0, "healthy": True, "reason": "ok"}],
        "jobs": {
            "counts": {"queued": 0},
            "running": [],
            "failed_24h": [],
        },
    }


def test_alerts_cover_worker_model_queue_and_heartbeat():
    metrics = metrics_for_alerts()
    metrics["worker"]["process_alive"] = False
    metrics["models"][0] = {"gpu": 0, "healthy": False, "reason": "heartbeat stale"}
    metrics["jobs"]["counts"]["queued"] = 3
    metrics["jobs"]["running"] = [{
        "id": "12345678-abcd",
        "heartbeat_age_seconds": 180,
        "log_tail": "提取 Evo2 特征",
    }]
    alerts = active_alerts(metrics, settings())
    assert set(alerts) == {"worker_process", "model_gpu_0", "queue_backlog", "job_heartbeat_12345678-abcd"}


def test_notifications_deduplicate_alerts_and_send_recovery():
    metrics = metrics_for_alerts()
    metrics["worker"]["process_alive"] = False
    notifications, state = build_notifications(metrics, {}, settings(), NOW)
    assert [item["title"] for item in notifications] == ["Genomine 后台告警"]

    notifications, state = build_notifications(metrics, state, settings(), NOW + timedelta(seconds=30))
    assert notifications == []

    metrics["worker"]["process_alive"] = True
    notifications, state = build_notifications(metrics, state, settings(), NOW + timedelta(seconds=60))
    assert [item["title"] for item in notifications] == ["Genomine 后台恢复"]
    assert state["active_alerts"] == {}


def test_failed_job_notified_only_once():
    metrics = metrics_for_alerts()
    metrics["jobs"]["failed_24h"] = [{"id": "failed-job", "error": "bad input"}]
    notifications, state = build_notifications(metrics, {}, settings(), NOW)
    assert len(notifications) == 1
    assert notifications[0]["title"] == "Genomine 任务失败"
    notifications, _ = build_notifications(metrics, state, settings(), NOW + timedelta(seconds=30))
    assert notifications == []


def test_supabase_failure_is_alerted():
    metrics = metrics_for_alerts()
    metrics["supabase"] = {"ok": False, "error": "HTTP 402"}
    metrics["jobs"] = None
    alerts = active_alerts(metrics, settings())
    assert alerts["supabase"] == "Supabase 采集失败：HTTP 402"
