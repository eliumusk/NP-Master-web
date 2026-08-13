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
    type_head_joblib: Path = Field(
        default=Path("/data/muskliu/npmaster/experiments/evo2_mibig_type/run_full/type_head.joblib"),
        alias="TYPE_HEAD_JOBLIB",
    )
    lr_type_ckpt_dir: Path = Field(
        default=Path("/data/muskliu/npmaster/data/evo2_lr_multiscale/type_lr"),
        alias="LR_TYPE_CKPT_DIR",
    )
    prodigal_bin: Path = Field(
        default=Path("/root/miniconda3/envs/bgc/bin/prodigal"),
        alias="PRODIGAL_BIN",
    )
    diamond_bin: Path = Field(
        default=Path("/root/miniconda3/envs/bgc/bin/diamond"),
        alias="DIAMOND_BIN",
    )
    mibig_dmnd_path: Path = Field(
        default=Path("/data/syh/NP-Master-web/data/mibig/mibig.dmnd"),
        alias="MIBIG_DMND_PATH",
    )
    mibig_meta_path: Path = Field(
        default=Path("/data/syh/NP-Master-web/data/mibig/mibig_meta.json"),
        alias="MIBIG_META_PATH",
    )
    hmmer_bin: Path = Field(
        default=Path("/root/miniconda3/envs/bgc/bin/hmmscan"),
        alias="HMMER_BIN",
    )
    pfam_db_path: Path = Field(
        default=Path("/data/syh/NP-Master-web/data/pfam/Pfam-A.hmm"),
        alias="PFAM_DB_PATH",
    )
    hmmer_threads: int = Field(default=48, alias="HMMER_THREADS")
    default_threshold: float = Field(default=0.95, alias="DEFAULT_THRESHOLD")
    default_extend_threshold: float = Field(default=0.80, alias="DEFAULT_EXTEND_THRESHOLD")
    default_min_support_windows: int = Field(default=3, alias="DEFAULT_MIN_SUPPORT_WINDOWS")
    default_min_len_bp: int = Field(default=2000, alias="DEFAULT_MIN_LEN_BP")
    default_safe_tier_min: str = Field(default="Tier2", alias="DEFAULT_SAFE_TIER_MIN")
    default_extend_flank_bp: int = Field(default=5000, alias="DEFAULT_EXTEND_FLANK_BP")
    upsample_k: int = Field(default=8, alias="UPSAMPLE_K")
    extract_window: int = Field(default=8192, alias="EXTRACT_WINDOW")
    extract_stride: int = Field(default=2048, alias="EXTRACT_STRIDE")
    # Multi-GPU parallel extract. Comma-separated list of ssh hosts that all
    # share /data via NFS. "localhost" runs locally. Each host contributes
    # `extract_gpus_per_host` workers (CUDA_VISIBLE_DEVICES=0..N-1).
    extract_hosts: str = Field(default="localhost,node8", alias="EXTRACT_HOSTS")
    extract_gpus_per_host: int = Field(default=8, alias="EXTRACT_GPUS_PER_HOST")
    use_precomputed_9g_probs: bool = Field(default=True, alias="USE_PRECOMPUTED_9G_PROBS")
    use_feature_cache: bool = Field(default=True, alias="USE_FEATURE_CACHE")

    gpu_min_free_gb: float = Field(default=20.0, alias="GPU_MIN_FREE_GB")
    gpu_wait_timeout_sec: int = Field(default=1800, alias="GPU_WAIT_TIMEOUT_SEC")
    gpu_poll_sec: int = Field(default=30, alias="GPU_POLL_SEC")

    max_fasta_bytes: int = Field(default=50 * 1024 * 1024, alias="MAX_FASTA_BYTES")
    poll_interval_sec: int = Field(default=5, alias="POLL_INTERVAL_SEC")
    heartbeat_sec: int = Field(default=10, alias="HEARTBEAT_SEC")

    fasta_bucket: str = Field(default="fasta-uploads", alias="FASTA_BUCKET")
    results_bucket: str = Field(default="results", alias="RESULTS_BUCKET")

    resend_api_key: str = Field(default="", alias="RESEND_API_KEY")
    email_from: str = Field(default="BGCMaster <noreply@bgcmaster.bio>", alias="EMAIL_FROM")
    site_base_url: str = Field(default="https://www.bgcmaster.bio", alias="SITE_BASE_URL")


_cached: Settings | None = None


def get_settings() -> Settings:
    global _cached
    if _cached is None:
        _cached = Settings()  # type: ignore[call-arg]
    return _cached
