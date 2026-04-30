from __future__ import annotations

import os
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=os.environ.get("SERVE_ENV_FILE", "serve/.env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    supabase_url: str = Field(alias="SUPABASE_URL")
    supabase_service_role_key: str = Field(alias="SUPABASE_SERVICE_ROLE_KEY")

    worker_id: str = Field(default="local-dev", alias="WORKER_ID")

    npmaster_repo_root: Path = Field(
        default=Path("/data/muskliu/npmaster"), alias="NPMASTER_REPO_ROOT"
    )
    npmaster_cache_dir: Path = Field(
        default=Path("/data/muskliu/npmaster/cache/web"), alias="NPMASTER_CACHE_DIR"
    )
    python_bin: Path = Field(
        default=Path("/root/miniconda3/envs/bgc/bin/python"), alias="PYTHON_BIN"
    )

    model_unet_ckpt: Path = Field(alias="MODEL_UNET_CKPT")
    lr_type_ckpt_dir: Path = Field(
        default=Path("/data/muskliu/npmaster/data/evo2_lr_multiscale/type_lr"),
        alias="LR_TYPE_CKPT_DIR",
    )
    default_threshold: float = Field(default=0.50, alias="DEFAULT_THRESHOLD")
    default_min_len_bp: int = Field(default=2000, alias="DEFAULT_MIN_LEN_BP")
    upsample_k: int = Field(default=8, alias="UPSAMPLE_K")
    extract_window: int = Field(default=8192, alias="EXTRACT_WINDOW")
    extract_stride: int = Field(default=2048, alias="EXTRACT_STRIDE")

    gpu_min_free_gb: float = Field(default=20.0, alias="GPU_MIN_FREE_GB")
    gpu_wait_timeout_sec: int = Field(default=1800, alias="GPU_WAIT_TIMEOUT_SEC")
    gpu_poll_sec: int = Field(default=30, alias="GPU_POLL_SEC")

    max_fasta_bytes: int = Field(default=10 * 1024 * 1024, alias="MAX_FASTA_BYTES")
    poll_interval_sec: int = Field(default=5, alias="POLL_INTERVAL_SEC")
    heartbeat_sec: int = Field(default=10, alias="HEARTBEAT_SEC")

    fasta_bucket: str = Field(default="fasta-uploads", alias="FASTA_BUCKET")
    results_bucket: str = Field(default="results", alias="RESULTS_BUCKET")


_cached: Settings | None = None


def get_settings() -> Settings:
    global _cached
    if _cached is None:
        _cached = Settings()  # type: ignore[call-arg]
    return _cached
