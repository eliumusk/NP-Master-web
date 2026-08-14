"""Resident GPU model daemon: one process per GPU holding Evo2 + U-Net.

Started by serve.model_pool (one per configured GPU) with:

    python -m serve.model_daemon --gpu <i> --dir <daemon_root> --ckpt <unet_ckpt>

The daemon pins itself to CUDA_VISIBLE_DEVICES=<i>, loads Evo2-7B (truncated
to blocks.20.mlp.l3, with the 4096→128 projection) and the per-token U-Net
ckpt, writes a `ready` marker, then loops over a file-based task protocol:

  <dir>/gpu<i>/inbox/<id>.json     task requests (atomically claimed via rename)
  <dir>/gpu<i>/outbox/<id>.json    results {id, status, detail, seconds}
  <dir>/gpu<i>/heartbeat           mtime refreshed by a background thread
  <dir>/gpu<i>/daemon.pid          daemon pid
  <dir>/gpu<i>/daemon.log          log file

Task kinds:
  extract_per_token: {fasta, metadata_csv, window_ids_txt, out_dir, stem,
                      window, stride} — reproduces the sliced mode of
                      scripts/extract/extract_evo2_per_token_features.py,
                      writing <stem>.partNNNN.npy + _windows.csv shards.
  infer_unet:        {features_dir, stems, out_dir, batch} — iter_shards +
                      score_stem from scripts/inference/evo2_per_token/
                      infer_shards.py, writing <stem>.probs.npz/.coords.csv.

A task failure writes status="error" and the daemon keeps serving. Fatal CUDA
errors (OOM / illegal access / device assert) exit the process so the pool can
restart it.
"""
from __future__ import annotations

import argparse
import csv
import importlib.util
import json
import logging
import os
import sys
import threading
import time
import traceback
from pathlib import Path

log = logging.getLogger("model_daemon")

# Locked extraction config (mirrors scripts/extract/extract_evo2_per_token_features.py)
LAYER = "blocks.20.mlp.l3"
D_REDUCED = 128
DOWNSAMPLE_K = 8
PROJ_SEED = 0xE2E2
FLUSH_EVERY = 1000

FATAL_CUDA_MARKERS = (
    "CUDA out of memory",
    "illegal memory access",
    "CUDA error",
    "device-side assert",
)


def _load_module(name: str, path: Path):
    """Load a stand-alone script as a module by file path."""
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise ImportError(f"cannot load {name} from {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class ModelDaemon:
    def __init__(self, gpu: int, root: Path, ckpt: Path, repo_root: Path):
        self.gpu = gpu
        self.gpu_dir = root / f"gpu{gpu}"
        self.ckpt_path = ckpt
        self.repo_root = repo_root
        self.inbox = self.gpu_dir / "inbox"
        self.outbox = self.gpu_dir / "outbox"
        self.heartbeat_path = self.gpu_dir / "heartbeat"
        self._stop = threading.Event()
        self.evo2 = None
        self.unet = None
        self.torch = None
        self.R = None
        self.extract_mod = None
        self.infer_mod = None

    # ---- model loading --------------------------------------------------

    def load_models(self) -> float:
        """Load Evo2 (truncated) + projection + U-Net. Returns load seconds."""
        t0 = time.time()
        sys.path.insert(0, str(self.repo_root / "src"))
        os.environ.setdefault("HF_HUB_CACHE", "/data/public_models/hub")
        os.environ.setdefault("HF_HUB_OFFLINE", "1")

        import torch

        self.torch = torch
        from evo2 import Evo2
        from evo2_lr.extract import truncate_blocks_to_layer

        log.info("loading Evo2-7b on gpu%d ...", self.gpu)
        t_evo = time.time()
        self.evo2 = Evo2("evo2_7b")
        log.info("Evo2 loaded in %.1fs; truncating to %s", time.time() - t_evo, LAYER)
        info = truncate_blocks_to_layer(self.evo2, LAYER)
        log.info("truncate: %s", info)

        self.extract_mod = _load_module(
            "extract_evo2_per_token_features",
            self.repo_root / "scripts/extract/extract_evo2_per_token_features.py",
        )
        self.R = self.extract_mod.build_projection(4096, D_REDUCED, PROJ_SEED, "cuda", torch)

        self.infer_mod = _load_module(
            "infer_shards",
            self.repo_root / "scripts/inference/evo2_per_token/infer_shards.py",
        )
        log.info("loading U-Net ckpt %s", self.ckpt_path)
        ckpt = torch.load(self.ckpt_path, map_location="cpu", weights_only=False)
        cfg = ckpt["args"]
        model_type = ckpt.get("model_type", cfg.get("model", "pertoken"))
        model_kwargs: dict = {"d_in": cfg["d_reduced"], "hidden": cfg["hidden"]}
        if model_type == "pertoken":
            model_kwargs["dilations"] = tuple(cfg["dilations"])
        self.unet = self.infer_mod.build_model(model_type, **model_kwargs)
        self.unet.load_state_dict(ckpt["model"])
        self.unet.eval().cuda()
        log.info("U-Net (%s) loaded", model_type)
        return time.time() - t0

    # ---- task handlers ---------------------------------------------------

    def run_extract(self, task: dict) -> dict:
        """Reproduce the extract script's sliced mode with the resident Evo2."""
        em = self.extract_mod
        torch = self.torch
        fasta = Path(task["fasta"])
        metadata_csv = Path(task["metadata_csv"])
        window_ids_txt = Path(task["window_ids_txt"])
        out_dir = Path(task["out_dir"])
        out_dir.mkdir(parents=True, exist_ok=True)
        stem = task["stem"]
        window = int(task["window"])
        flush_every = int(task.get("flush_every", FLUSH_EVERY))

        keep = set(window_ids_txt.read_text().split())
        rows: list[dict] = []
        with open(metadata_csv) as fh:
            for row in csv.DictReader(fh):
                if row["window_id"] in keep:
                    rows.append(row)
        log.info("extract: %d windows for stem=%s from %s", len(rows), stem, fasta.name)
        contigs = {cid: seq for cid, seq in em.read_fna(fasta)}

        buffer_emb: list = []
        buffer_meta: list[dict] = []
        shard_idx = 0
        shard_files: list[dict] = []
        n_done = 0
        n_failed = 0
        fwd_s = 0.0
        t_loop = time.time()

        def _flush() -> None:
            nonlocal buffer_emb, buffer_meta, shard_idx
            npy, csv_p = em.flush_shard(buffer_emb, buffer_meta, shard_idx, out_dir, stem)
            shard_files.append({"npy": str(npy), "csv": str(csv_p), "n": len(buffer_emb)})
            log.info("flushed shard %d (%d windows) -> %s", shard_idx, len(buffer_emb), npy.name)
            buffer_emb, buffer_meta = [], []
            shard_idx += 1

        for row in rows:
            cid = row["contig_id"]
            if cid not in contigs:
                log.warning("missing contig %s; skip window %s", cid, row["window_id"])
                n_failed += 1
                continue
            seq = contigs[cid]
            start = int(row["window_start"])
            end = int(row["window_end"])
            sub = seq[start:end]
            clean_len = sum(1 for c in sub if c in "ATCG")
            if len(sub) < window:
                sub = sub + ("N" * (window - len(sub)))
            toks = self.evo2.tokenizer.tokenize(em.clean_for_tokenizer(sub))
            input_ids = torch.tensor([toks], dtype=torch.int, device="cuda")
            tf = time.time()
            try:
                arr = em.run_forward(self.evo2, input_ids, LAYER, self.R, DOWNSAMPLE_K, torch)
            except Exception as exc:
                if any(m in str(exc) for m in FATAL_CUDA_MARKERS):
                    raise  # CUDA context is gone; let the task fail fatally
                log.warning("window %s forward failed: %s", row["window_id"], exc)
                n_failed += 1
                continue
            fwd_s += time.time() - tf
            buffer_emb.append(arr)
            buffer_meta.append({
                "window_id": row["window_id"],
                "contig": cid,
                "start": start,
                "end": end,
                "clean_len": clean_len,
            })
            n_done += 1
            if n_done % 50 == 0:
                log.info("progress n=%d fwd_s=%.1f rate=%.3f win/s",
                         n_done, fwd_s, n_done / max(1e-9, time.time() - t_loop))
            if len(buffer_emb) >= flush_every:
                _flush()
        if buffer_emb:
            _flush()
        if rows and n_done == 0:
            raise RuntimeError(f"all {len(rows)} windows failed (last errors in daemon log)")
        manifest = {
            "stem": stem,
            "source": "daemon_sliced",
            "window": window,
            "stride": int(task["stride"]),
            "layer": LAYER,
            "d_reduced": D_REDUCED,
            "downsample": DOWNSAMPLE_K,
            "proj_seed": PROJ_SEED,
            "n_windows": n_done,
            "n_failed": n_failed,
            "shard_files": shard_files,
            "forward_seconds": round(fwd_s, 3),
            "loop_seconds": round(time.time() - t_loop, 3),
        }
        (out_dir / f"{stem}.manifest.json").write_text(json.dumps(manifest, indent=2))
        return {"n_windows": n_done, "n_failed": n_failed, "n_shards": len(shard_files),
                "forward_seconds": round(fwd_s, 3)}

    def run_infer(self, task: dict) -> dict:
        """Score stems with the resident U-Net (iter_shards + score_stem)."""
        im = self.infer_mod
        features_dir = Path(task["features_dir"])
        out_dir = Path(task["out_dir"])
        out_dir.mkdir(parents=True, exist_ok=True)
        stems = list(task["stems"])
        batch = int(task.get("batch", 32))
        groups = list(im.iter_shards(features_dir, stems))
        if not groups:
            raise RuntimeError(f"no per-part windows CSVs in {features_dir}")
        total = 0
        scored: list[str] = []
        for stem, shards in groups:
            out_npz = out_dir / f"{stem}.probs.npz"
            out_csv = out_dir / f"{stem}.coords.csv"
            n = im.score_stem(self.unet, shards, out_npz, out_csv, batch)
            total += n
            scored.append(stem)
            log.info("[%s] scored %d windows -> %s", stem, n, out_npz.name)
        return {"n_windows": total, "stems": scored}

    # ---- main loop --------------------------------------------------------

    def _heartbeat_loop(self) -> None:
        while not self._stop.wait(2.0):
            try:
                self.heartbeat_path.touch()
            except OSError:
                pass

    def _handle_claimed(self, claimed: Path) -> None:
        task_id = claimed.name[: -len(".json.claimed")]
        try:
            task = json.loads(claimed.read_text())
        except Exception as exc:
            log.error("unreadable task file %s: %s", claimed, exc)
            claimed.unlink(missing_ok=True)
            return
        task_id = str(task.get("id") or task_id)
        kind = task.get("kind")
        t0 = time.time()
        log.info("task %s kind=%s start", task_id, kind)
        fatal = False
        try:
            if kind == "extract_per_token":
                detail = self.run_extract(task)
            elif kind == "infer_unet":
                detail = self.run_infer(task)
            else:
                raise ValueError(f"unknown task kind: {kind}")
            result = {"id": task_id, "status": "ok", "detail": detail,
                      "seconds": round(time.time() - t0, 3)}
            log.info("task %s ok in %.1fs: %s", task_id, time.time() - t0, detail)
        except Exception as exc:
            tb = traceback.format_exc()
            fatal = any(m in str(exc) or m in tb for m in FATAL_CUDA_MARKERS)
            result = {"id": task_id, "status": "error",
                      "detail": f"{type(exc).__name__}: {exc}\n{tb[-1800:]}",
                      "seconds": round(time.time() - t0, 3)}
            log.error("task %s failed: %s", task_id, exc)
        tmp = self.outbox / f"{task_id}.json.tmp"
        tmp.write_text(json.dumps(result))
        os.rename(tmp, self.outbox / f"{task_id}.json")
        claimed.unlink(missing_ok=True)
        if fatal:
            log.error("fatal CUDA error; exiting so the pool can restart this daemon")
            sys.exit(2)

    def serve_forever(self) -> None:
        self.inbox.mkdir(parents=True, exist_ok=True)
        self.outbox.mkdir(parents=True, exist_ok=True)
        threading.Thread(target=self._heartbeat_loop, daemon=True).start()
        log.info("daemon gpu%d ready; watching %s", self.gpu, self.inbox)
        while True:
            try:
                self.heartbeat_path.touch()
            except OSError:
                pass
            for task_file in sorted(self.inbox.glob("*.json")):
                claimed = task_file.with_name(task_file.name + ".claimed")
                try:
                    os.rename(task_file, claimed)
                except OSError:
                    continue  # claimed by someone else or vanished
                self._handle_claimed(claimed)
            time.sleep(0.5)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--gpu", type=int, required=True)
    ap.add_argument("--dir", type=Path, required=True, help="daemon root dir")
    ap.add_argument("--ckpt", type=Path, required=True, help="U-Net checkpoint")
    ap.add_argument("--repo-root", type=Path, default=Path("/data/muskliu/npmaster"),
                    help="npmaster research repo root (for src/ + scripts/)")
    args = ap.parse_args()

    # Pin the GPU before torch is ever imported (torch import happens lazily
    # inside load_models).
    os.environ["CUDA_VISIBLE_DEVICES"] = str(args.gpu)

    gpu_dir = args.dir / f"gpu{args.gpu}"
    gpu_dir.mkdir(parents=True, exist_ok=True)
    (gpu_dir / "inbox").mkdir(exist_ok=True)
    (gpu_dir / "outbox").mkdir(exist_ok=True)
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
        handlers=[logging.FileHandler(gpu_dir / "daemon.log")],
    )

    (gpu_dir / "daemon.pid").write_text(str(os.getpid()))
    daemon = ModelDaemon(args.gpu, args.dir, args.ckpt, args.repo_root)
    load_s = daemon.load_models()
    (gpu_dir / "ready").write_text(json.dumps({
        "pid": os.getpid(),
        "gpu": args.gpu,
        "ckpt": str(args.ckpt),
        "load_seconds": round(load_s, 3),
        "time": time.time(),
    }))
    log.info("models loaded in %.1fs", load_s)
    daemon.serve_forever()
    return 0


if __name__ == "__main__":
    sys.exit(main())
