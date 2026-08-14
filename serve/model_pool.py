"""Worker-side client for the resident GPU model daemon pool.

Manages one serve.model_daemon process per configured GPU and dispatches
tasks through a file protocol under <cache>/model_daemons/gpu<i>/:

  ensure_daemons(settings)  — (re)start missing/dead daemons, wait for ready
  available(settings)       — at least one healthy daemon
  healthy_gpus(settings)    — list of healthy GPU indices
  run_tasks(settings, ...)  — submit tasks to inboxes, collect outbox results
  stop_daemons(...)         — SIGTERM all daemons (debug helper)

Healthy = pid alive (and not a zombie) + ready marker + heartbeat fresher than
settings.model_daemon_ready_staleness_sec.

Pure stdlib: safe to import in the worker process (no torch/numpy).
"""
from __future__ import annotations

import json
import logging
import os
import signal
import subprocess
import time
import uuid
from pathlib import Path

log = logging.getLogger(__name__)

MAX_RESTARTS_PER_HOUR = 3
RESTART_WINDOW_SEC = 3600


def daemon_root(settings) -> Path:
    return settings.npmaster_cache_dir / "model_daemons"


def configured_gpus(settings) -> list[int]:
    return [int(x.strip()) for x in settings.model_daemon_gpus.split(",") if x.strip()]


def _gpu_dir(root: Path, gpu: int) -> Path:
    return root / f"gpu{gpu}"


def _pid_alive(pid: int) -> bool:
    """True if pid exists and is not a zombie."""
    try:
        with open(f"/proc/{pid}/stat") as fh:
            if fh.read().rpartition(")")[2].split()[0] == "Z":
                return False
    except OSError:
        return False
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    except OSError:
        return False
    return True


def _daemon_health(root: Path, gpu: int, staleness_sec: int) -> tuple[bool, str]:
    d = _gpu_dir(root, gpu)
    pid_file = d / "daemon.pid"
    if not pid_file.exists():
        return False, "no pid file"
    try:
        pid = int(pid_file.read_text().strip())
    except ValueError:
        return False, "bad pid file"
    if not _pid_alive(pid):
        return False, f"pid {pid} dead"
    if not (d / "ready").exists():
        return False, "not ready"
    hb = d / "heartbeat"
    if not hb.exists():
        return False, "no heartbeat"
    age = time.time() - hb.stat().st_mtime
    if age > staleness_sec:
        return False, f"heartbeat stale ({age:.0f}s)"
    return True, "ok"


def healthy_gpus(settings) -> list[int]:
    root = daemon_root(settings)
    return [
        gpu for gpu in configured_gpus(settings)
        if _daemon_health(root, gpu, settings.model_daemon_ready_staleness_sec)[0]
    ]


def healthy_gpu_count(settings) -> int:
    return len(healthy_gpus(settings))


def available(settings) -> bool:
    return healthy_gpu_count(settings) >= 1


# ---- restart bookkeeping ---------------------------------------------------


def _restart_state_path(root: Path, gpu: int) -> Path:
    return _gpu_dir(root, gpu) / "restart_state.json"


def _read_restarts(root: Path, gpu: int) -> list[float]:
    try:
        state = json.loads(_restart_state_path(root, gpu).read_text())
        return [float(ts) for ts in state.get("restarts", [])]
    except (OSError, ValueError):
        return []


def _restart_allowed(root: Path, gpu: int) -> bool:
    recent = [ts for ts in _read_restarts(root, gpu) if time.time() - ts < RESTART_WINDOW_SEC]
    return len(recent) < MAX_RESTARTS_PER_HOUR


def _record_restart(root: Path, gpu: int) -> None:
    recent = [ts for ts in _read_restarts(root, gpu) if time.time() - ts < RESTART_WINDOW_SEC]
    recent.append(time.time())
    try:
        _restart_state_path(root, gpu).write_text(json.dumps({"gpu": gpu, "restarts": recent}))
    except OSError as exc:
        log.warning("could not record restart state for gpu%d: %s", gpu, exc)


# ---- daemon lifecycle -------------------------------------------------------


def _spawn_daemon(settings, root: Path, gpu: int) -> int:
    serve_repo_root = Path(__file__).resolve().parent.parent
    env = os.environ.copy()
    env["PYTHONPATH"] = str(serve_repo_root) + (
        os.pathsep + env["PYTHONPATH"] if env.get("PYTHONPATH") else ""
    )
    env["CUDA_VISIBLE_DEVICES"] = str(gpu)
    env.setdefault("HF_HUB_CACHE", "/data/public_models/hub")
    env.setdefault("HF_HUB_OFFLINE", "1")
    env_root = settings.python_bin.parent.parent
    candidates = list(env_root.glob("lib/python*/site-packages/torch/lib"))
    if candidates:
        existing = env.get("LD_LIBRARY_PATH", "")
        env["LD_LIBRARY_PATH"] = f"{candidates[0]}:{existing}" if existing else str(candidates[0])

    gpu_dir = _gpu_dir(root, gpu)
    gpu_dir.mkdir(parents=True, exist_ok=True)
    for name in ("ready", "heartbeat"):
        try:
            (gpu_dir / name).unlink()
        except OSError:
            pass
    cmd = [
        str(settings.python_bin), "-m", "serve.model_daemon",
        "--gpu", str(gpu),
        "--dir", str(root),
        "--ckpt", str(settings.model_unet_ckpt),
        "--repo-root", str(settings.npmaster_repo_root),
    ]
    log.info("spawning daemon gpu%d: %s", gpu, " ".join(cmd))
    with open(gpu_dir / "daemon.log", "a") as log_file:
        proc = subprocess.Popen(
            cmd,
            stdout=log_file,
            stderr=subprocess.STDOUT,
            env=env,
            cwd=str(serve_repo_root),
            start_new_session=True,
        )
    (gpu_dir / "daemon.pid").write_text(str(proc.pid))
    _record_restart(root, gpu)
    return proc.pid


def _wait_ready(root: Path, gpu: int, timeout_sec: int) -> bool:
    gpu_dir = _gpu_dir(root, gpu)
    deadline = time.time() + timeout_sec
    while time.time() < deadline:
        if (gpu_dir / "ready").exists():
            return True
        try:
            pid = int((gpu_dir / "daemon.pid").read_text().strip())
            if not _pid_alive(pid):
                log.warning("daemon gpu%d exited before ready; see %s", gpu, gpu_dir / "daemon.log")
                return False
        except (OSError, ValueError):
            return False
        time.sleep(2)
    return False


def ensure_daemons(settings) -> int:
    """Start/restart daemons for all configured GPUs. Returns healthy count."""
    root = daemon_root(settings)
    root.mkdir(parents=True, exist_ok=True)
    healthy = 0
    for gpu in configured_gpus(settings):
        ok, why = _daemon_health(root, gpu, settings.model_daemon_ready_staleness_sec)
        if ok:
            healthy += 1
            continue
        log.info("daemon gpu%d not healthy (%s)", gpu, why)
        if not _restart_allowed(root, gpu):
            log.warning("daemon gpu%d exceeded %d restarts/hour; leaving it down",
                        gpu, MAX_RESTARTS_PER_HOUR)
            continue
        try:
            _spawn_daemon(settings, root, gpu)
        except Exception as exc:
            log.warning("failed to spawn daemon gpu%d: %s", gpu, exc)
            continue
        if _wait_ready(root, gpu, settings.model_daemon_startup_timeout_sec):
            healthy += 1
        else:
            log.warning("daemon gpu%d not ready within %ds",
                        gpu, settings.model_daemon_startup_timeout_sec)
    log.info("model daemon pool: %d/%d healthy", healthy, len(configured_gpus(settings)))
    return healthy


def stop_daemons(root: Path) -> None:
    """SIGTERM every daemon with a pid file under root (debug helper)."""
    for gpu_dir in sorted(root.glob("gpu*")):
        pid_file = gpu_dir / "daemon.pid"
        if not pid_file.exists():
            continue
        try:
            pid = int(pid_file.read_text().strip())
        except ValueError:
            continue
        if not _pid_alive(pid):
            continue
        log.info("stopping daemon %s (pid %d)", gpu_dir.name, pid)
        try:
            os.kill(pid, signal.SIGTERM)
        except OSError:
            continue
        deadline = time.time() + 10
        while time.time() < deadline and _pid_alive(pid):
            time.sleep(0.5)
        if _pid_alive(pid):
            try:
                os.kill(pid, signal.SIGKILL)
            except OSError:
                pass
        for name in ("ready", "heartbeat", "daemon.pid"):
            try:
                (gpu_dir / name).unlink()
            except OSError:
                pass


# ---- task dispatch -----------------------------------------------------------


def run_tasks(settings, tasks: list[dict], timeout_sec: int | None = None,
              progress_cb=None) -> list[dict]:
    """Submit tasks to daemon inboxes and wait for outbox results.

    tasks: [{"kind": ..., "gpu": optional int, ...payload}]
    Returns a result dict per task, in the same order:
      {"status": "ok"|"error"|"timeout", "detail", "seconds", "gpu", "id"}
    """
    root = daemon_root(settings)
    timeout = timeout_sec or settings.model_daemon_task_timeout_sec
    healthy = healthy_gpus(settings)
    if not healthy:
        raise RuntimeError("no healthy model daemons")

    pending: dict[str, dict] = {}
    rr = 0
    for idx, task in enumerate(tasks):
        gpu = task.get("gpu")
        if gpu is None:
            gpu = healthy[rr % len(healthy)]
            rr += 1
        gpu = int(gpu)
        if gpu not in healthy:
            raise RuntimeError(f"task {idx}: requested gpu{gpu} is not healthy")
        task_id = uuid.uuid4().hex[:16]
        payload = {k: v for k, v in task.items() if k != "gpu"}
        payload["id"] = task_id
        gpu_dir = _gpu_dir(root, gpu)
        inbox = gpu_dir / "inbox"
        inbox.mkdir(parents=True, exist_ok=True)
        (gpu_dir / "outbox").mkdir(exist_ok=True)
        tmp = inbox / f"{task_id}.json.tmp"
        tmp.write_text(json.dumps(payload))
        os.rename(tmp, inbox / f"{task_id}.json")
        pending[task_id] = {
            "index": idx,
            "gpu": gpu,
            "result_path": gpu_dir / "outbox" / f"{task_id}.json",
        }

    results: list[dict | None] = [None] * len(tasks)
    deadline = time.time() + timeout
    while pending and time.time() < deadline:
        for task_id, info in list(pending.items()):
            rp = info["result_path"]
            if not rp.exists():
                continue
            try:
                res = json.loads(rp.read_text())
            except ValueError:
                continue  # partially read file; retry next poll
            results[info["index"]] = {
                "status": res.get("status", "error"),
                "detail": res.get("detail"),
                "seconds": res.get("seconds"),
                "gpu": info["gpu"],
                "id": task_id,
            }
            try:
                rp.unlink()
            except OSError:
                pass
            del pending[task_id]
            if progress_cb:
                progress_cb(len(tasks) - len(pending), len(tasks))
        if pending:
            time.sleep(0.5)
    for task_id, info in pending.items():
        results[info["index"]] = {
            "status": "timeout",
            "detail": f"no result within {timeout}s",
            "seconds": None,
            "gpu": info["gpu"],
            "id": task_id,
        }
    return [r for r in results if r is not None]
