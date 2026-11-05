from types import SimpleNamespace

import httpx

from backend import client


class FakeRpc:
    def __init__(self, rows, failures=0):
        self.rows = rows
        self.failures = failures
        self.calls = []

    def execute(self):
        if self.failures:
            self.failures -= 1
            raise httpx.TransportError("response lost after commit")
        return SimpleNamespace(data=self.rows)


class FakeSupabase:
    def __init__(self, rpc):
        self.rpc_impl = rpc
        self.requests = []

    def rpc(self, name, params):
        self.requests.append((name, params))
        return self.rpc_impl


def test_claim_retry_reuses_the_same_token(monkeypatch):
    monkeypatch.setattr("tenacity.nap.time.sleep", lambda _seconds: None)
    row = {"id": "job-1", "claim_token": "token"}
    rpc = FakeRpc([row], failures=1)
    supa = FakeSupabase(rpc)

    assert client.claim_next_job(supa, "worker-1") == row

    tokens = [params["token"] for _name, params in supa.requests]
    assert len(tokens) == 2
    assert tokens[0] == tokens[1]


def test_separate_claims_use_different_tokens():
    rpc = FakeRpc([])
    supa = FakeSupabase(rpc)

    assert client.claim_next_job(supa, "worker-1") is None
    assert client.claim_next_job(supa, "worker-1") is None

    tokens = [params["token"] for _name, params in supa.requests]
    assert tokens[0] != tokens[1]


def test_heartbeat_is_scoped_to_the_claim_token():
    rpc = FakeRpc(None)
    supa = FakeSupabase(rpc)

    client.heartbeat(supa, "job-1", "claim-1")

    assert supa.requests == [
        ("job_heartbeat", {"job": "job-1", "token": "claim-1"})
    ]


def test_worker_lock_rejects_a_second_worker(tmp_path):
    import pytest
    from backend import worker

    settings = SimpleNamespace(npmaster_cache_dir=tmp_path)
    lock = worker._acquire_worker_lock(settings)
    try:
        with pytest.raises(RuntimeError, match="another worker is already running"):
            worker._acquire_worker_lock(settings)
    finally:
        lock.close()


def test_client_initialization_failure_fails_only_the_job(monkeypatch):
    from backend import worker

    updates = []
    monkeypatch.setattr(
        worker,
        "make_client",
        lambda _settings: (_ for _ in ()).throw(FileNotFoundError("missing CA file")),
    )
    monkeypatch.setattr(
        worker,
        "update_job",
        lambda _supa, job_id, **fields: updates.append((job_id, fields)),
    )
    monkeypatch.setattr(worker, "notify_job_finished", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(
        worker,
        "run_job",
        lambda *_args: (_ for _ in ()).throw(AssertionError("pipeline must not start")),
    )

    worker._process_one_job(object(), SimpleNamespace(), {"id": "job-1", "claim_token": "claim-1"})

    assert len(updates) == 1
    assert updates[0][0] == "job-1"
    assert updates[0][1]["status"] == "failed"
    assert "missing CA file" in updates[0][1]["error"]
