from __future__ import annotations

import threading


_gpu_stage = threading.Lock()
_feature_guard = threading.Lock()
_feature_locks: dict[str, threading.Lock] = {}


def gpu_stage_lock() -> threading.Lock:
    return _gpu_stage


def feature_lock(sha256: str) -> threading.Lock:
    with _feature_guard:
        return _feature_locks.setdefault(sha256, threading.Lock())
