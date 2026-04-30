from __future__ import annotations

import logging
import os
import time

log = logging.getLogger(__name__)


def _visible_device_index() -> int:
    cv = os.environ.get("CUDA_VISIBLE_DEVICES", "")
    if cv == "":
        return 0
    first = cv.split(",")[0].strip()
    if not first.isdigit():
        return 0
    return int(first)


def free_gb() -> float:
    """Return free VRAM in GB on the device the worker will use.

    Uses pynvml; raises ImportError if NVML isn't available."""
    import pynvml

    pynvml.nvmlInit()
    try:
        idx = _visible_device_index()
        handle = pynvml.nvmlDeviceGetHandleByIndex(idx)
        info = pynvml.nvmlDeviceGetMemoryInfo(handle)
        return info.free / (1024 ** 3)
    finally:
        pynvml.nvmlShutdown()


def wait_for_gpu(min_free_gb: float, timeout_sec: int, poll_sec: int) -> bool:
    """Block until free VRAM >= min_free_gb, or timeout. Returns True on success."""
    deadline = time.time() + timeout_sec
    while True:
        try:
            f = free_gb()
        except Exception as e:  # NVML missing / driver glitch
            log.warning("gpu_guard: NVML query failed (%s); proceeding without check", e)
            return True
        if f >= min_free_gb:
            return True
        remaining = deadline - time.time()
        if remaining <= 0:
            log.warning("gpu_guard: timed out waiting for %.1f GB (last free=%.1f GB)", min_free_gb, f)
            return False
        log.info("gpu_guard: free=%.1f GB < %.1f GB; sleeping %ds (timeout in %ds)",
                 f, min_free_gb, poll_sec, int(remaining))
        time.sleep(min(poll_sec, max(1, int(remaining))))
