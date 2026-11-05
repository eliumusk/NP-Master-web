from __future__ import annotations

import argparse
import fcntl
import json
import logging
import os
import signal
import sys
import threading
import time
import traceback

from .client import claim_next_job, heartbeat, make_client, update_job
from .config import get_settings
from .notify import notify_job_finished
from .pipeline import GpuBusyTimeout, PipelineError, run_job

log = logging.getLogger(__name__)

_shutdown = threading.Event()


def _install_signal_handlers() -> None:
    def _handler(signum, frame):
        log.warning("received signal %d; will shut down after current job", signum)
        _shutdown.set()

    signal.signal(signal.SIGTERM, _handler)
    signal.signal(signal.SIGINT, _handler)


def _acquire_worker_lock(settings):
    path = settings.npmaster_cache_dir / "worker.lock"
    path.parent.mkdir(parents=True, exist_ok=True)
    handle = path.open("a+")
    try:
        fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError as exc:
        handle.close()
        raise RuntimeError(f"another worker is already running (lock: {path})") from exc
    handle.seek(0)
    handle.truncate()
    handle.write(str(os.getpid()))
    handle.flush()
    return handle


class Heartbeater(threading.Thread):
    def __init__(self, supa, job_id: str, claim_token: str, interval_sec: int):
        super().__init__(daemon=True)
        self.supa = supa
        self.job_id = job_id
        self.claim_token = claim_token
        self.interval_sec = interval_sec
        self._stop_event = threading.Event()

    def run(self) -> None:
        while not self._stop_event.wait(self.interval_sec):
            try:
                heartbeat(self.supa, self.job_id, self.claim_token)
            except Exception as e:  # network blip; keep going
                log.warning("heartbeat failed: %s", e)

    def stop(self) -> None:
        self._stop_event.set()


def _process_one_job(supa, settings, job: dict) -> None:
    job_id = job["id"]
    try:
        supa = make_client(settings)
    except Exception as e:
        update_job(
            supa,
            job_id,
            status="failed",
            finished_at="now()",
            error=f"Worker 初始化失败：{e}"[:2000],
            log_tail=traceback.format_exc()[-2000:],
        )
        log.exception("job %s worker client initialization failed", job_id)
        notify_job_finished(supa, settings, job, ok=False, detail=f"Worker 初始化失败：{e}")
        return

    log.info("claimed job %s genomes=%s threshold=%s", job_id, job.get("n_genomes"), job.get("threshold"))
    hb = Heartbeater(supa, job_id, job["claim_token"], settings.heartbeat_sec)
    hb.start()
    try:
        result = run_job(supa, settings, job)
        update_fields = {
            "status": "done",
            "finished_at": "now()",
            "error": None,
            "n_regions": result["n_regions"],
            "n_safe": result["n_safe"],
            "log_tail": f"完成：{result['n_regions']} 个候选区域，{result['n_safe']} 个安全通过",
            "result_regions_path": result["result_regions_path"],
            "result_zip_path": result["result_zip_path"],
        }
        update_job(supa, job_id, **update_fields)
        log.info("job %s done (%d regions, %d safe pass)", job_id, result["n_regions"], result["n_safe"])
        notify_job_finished(
            supa, settings, job, ok=True,
            detail=f"{result['n_regions']} 个候选区域 / regions，{result['n_safe']} 个安全通过 / safe pass",
        )
    except GpuBusyTimeout as e:
        update_job(supa, job_id, status="failed", finished_at="now()", error=f"GPU 等待超时：{e}")
        log.warning("job %s aborted: %s", job_id, e)
        notify_job_finished(supa, settings, job, ok=False, detail=str(e))
    except PipelineError as e:
        tb = traceback.format_exc()
        update_job(
            supa,
            job_id,
            status="failed",
            finished_at="now()",
            error=str(e)[:2000],
            log_tail=tb[-2000:],
        )
        log.error("job %s pipeline failed: %s", job_id, e)
        notify_job_finished(supa, settings, job, ok=False, detail=str(e))
    except Exception as e:
        tb = traceback.format_exc()
        update_job(
            supa,
            job_id,
            status="failed",
            finished_at="now()",
            error=f"unexpected: {e}"[:2000],
            log_tail=tb[-2000:],
        )
        log.exception("job %s unexpected failure", job_id)
        notify_job_finished(supa, settings, job, ok=False, detail=f"unexpected: {e}")
    finally:
        hb.stop()
        hb.join(timeout=5)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--once", action="store_true",
                    help="claim and run one job, then exit (for smoke testing)")
    ap.add_argument("--log-level", default="INFO")
    args = ap.parse_args()

    logging.basicConfig(
        level=args.log_level,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )

    try:
        os.nice(10)
    except OSError:
        pass

    settings = get_settings()
    _worker_lock = _acquire_worker_lock(settings)
    supa = make_client(settings)
    log.info(
        "worker %s starting; pid=%d repo=%s cache=%s",
        settings.worker_id, os.getpid(), settings.npmaster_repo_root, settings.npmaster_cache_dir,
    )

    if settings.model_daemon_enabled:
        try:
            from . import model_pool

            n_healthy = model_pool.ensure_daemons(settings)
            log.info("model daemon pool: %d/%d daemons healthy",
                     n_healthy, len(model_pool.configured_gpus(settings)))
        except Exception as e:
            log.warning("model daemon pool setup failed (%s); jobs will use the cold-start path", e)

    _install_signal_handlers()

    if args.once:
        while not _shutdown.is_set():
            try:
                job = claim_next_job(supa, settings.worker_id)
            except Exception as e:
                log.warning("claim_next_job failed: %s", e)
                time.sleep(min(30, settings.poll_interval_sec * 4))
                continue
            if job is None:
                log.info("--once: no job available, exiting")
                return 0
            _process_one_job(supa, settings, job)
            return 0
        return 0

    from concurrent.futures import FIRST_COMPLETED, ThreadPoolExecutor, wait

    max_jobs = max(1, settings.worker_max_jobs)
    pending = set()
    with ThreadPoolExecutor(max_workers=max_jobs) as pool:
        while pending or not _shutdown.is_set():
            claim_failed = False
            while not _shutdown.is_set() and len(pending) < max_jobs:
                try:
                    job = claim_next_job(supa, settings.worker_id)
                except Exception as e:
                    claim_failed = True
                    log.warning("claim_next_job failed: %s", e)
                    break
                if job is None:
                    break
                log.info("scheduling job %s (%d/%d active)", job["id"], len(pending) + 1, max_jobs)
                pending.add(pool.submit(_process_one_job, supa, settings, job))

            if not pending:
                if _shutdown.is_set():
                    break
                time.sleep(min(30, settings.poll_interval_sec * 4) if claim_failed else settings.poll_interval_sec)
                continue

            done, _ = wait(pending, timeout=settings.poll_interval_sec, return_when=FIRST_COMPLETED)
            pending.difference_update(done)
            for future in done:
                try:
                    future.result()
                except Exception as e:
                    log.exception("job future escaped its error handler: %s", e)

    log.info("graceful shutdown complete")
    return 0


if __name__ == "__main__":
    sys.exit(main())
