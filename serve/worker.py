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
        self._stop = threading.Event()

    def run(self) -> None:
        while not self._stop.wait(self.interval_sec):
            try:
                heartbeat(self.supa, self.job_id)
            except Exception as e:  # network blip; keep going
                log.warning("heartbeat failed: %s", e)

    def stop(self) -> None:
        self._stop.set()


def _process_one_job(supa, settings, job: dict) -> None:
    job_id = job["id"]
    log.info("claimed job %s sha=%s threshold=%s", job_id, job["fasta_sha256"][:8], job["threshold"])
    hb = Heartbeater(supa, job_id, settings.heartbeat_sec)
    hb.start()
    try:
        result = run_job(supa, settings, job)
        update_job(
            supa,
            job_id,
            status="done",
            finished_at="now()",
            error=None,
            log_tail=f"done; {result['n_regions']} regions",
            result_csv_path=result["result_csv_path"],
            result_bed_path=result["result_bed_path"],
            result_fai_path=result["result_fai_path"],
            result_fasta_path=result["result_fasta_path"],
        )
        log.info("job %s done (%d regions)", job_id, result["n_regions"])
    except GpuBusyTimeout as e:
        update_job(supa, job_id, status="failed", finished_at="now()", error=f"gpu busy timeout: {e}")
        log.warning("job %s aborted: %s", job_id, e)
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
