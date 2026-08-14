from __future__ import annotations

import argparse
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


class Heartbeater(threading.Thread):
    def __init__(self, supa, job_id: str, interval_sec: int):
        super().__init__(daemon=True)
        self.supa = supa
        self.job_id = job_id
        self.interval_sec = interval_sec
        self._stop_event = threading.Event()

    def run(self) -> None:
        while not self._stop_event.wait(self.interval_sec):
            try:
                heartbeat(self.supa, self.job_id)
            except Exception as e:  # network blip; keep going
                log.warning("heartbeat failed: %s", e)

    def stop(self) -> None:
        self._stop_event.set()


def _process_one_job(supa, settings, job: dict) -> None:
    job_id = job["id"]
    log.info("claimed job %s genomes=%s threshold=%s", job_id, job.get("n_genomes"), job.get("threshold"))
    hb = Heartbeater(supa, job_id, settings.heartbeat_sec)
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
    supa = make_client(settings)
    log.info("worker %s starting; repo=%s cache=%s", settings.worker_id, settings.npmaster_repo_root, settings.npmaster_cache_dir)

    if settings.model_daemon_enabled:
        try:
            from . import model_pool

            n_healthy = model_pool.ensure_daemons(settings)
            log.info("model daemon pool: %d/%d daemons healthy",
                     n_healthy, len(model_pool.configured_gpus(settings)))
        except Exception as e:
            log.warning("model daemon pool setup failed (%s); jobs will use the cold-start path", e)

    _install_signal_handlers()

    while not _shutdown.is_set():
        try:
            job = claim_next_job(supa, settings.worker_id)
        except Exception as e:
            log.warning("claim_next_job failed: %s", e)
            time.sleep(min(30, settings.poll_interval_sec * 4))
            continue

        if job is None:
            if args.once:
                log.info("--once: no job available, exiting")
                return 0
            time.sleep(settings.poll_interval_sec)
            continue

        _process_one_job(supa, settings, job)

        if args.once:
            return 0

    log.info("graceful shutdown complete")
    return 0


if __name__ == "__main__":
    sys.exit(main())
