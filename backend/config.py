from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]


def _load_env_file(path: Path) -> None:
    if not path.is_file():
        return
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key:
            os.environ.setdefault(key, value)


_load_env_file(PROJECT_ROOT / ".env")

DATA_DIR = Path(os.getenv("FRAMEFOUNDRY_DATA_DIR", PROJECT_ROOT / "data")).resolve()
DATABASE_PATH = Path(
    os.getenv("FRAMEFOUNDRY_DATABASE_PATH", DATA_DIR / "framefoundry.db")
).resolve()
OUTPUT_DIR = Path(
    os.getenv("FRAMEFOUNDRY_OUTPUT_DIR", DATA_DIR / "outputs")
).resolve()
UPLOAD_DIR = Path(
    os.getenv("FRAMEFOUNDRY_UPLOAD_DIR", DATA_DIR / "uploads")
).resolve()
REAL_JOB_TIMEOUT_SECONDS = int(
    os.getenv("FRAMEFOUNDRY_REAL_JOB_TIMEOUT_SECONDS", "3600")
)
MAX_REFERENCE_BYTES = int(os.getenv("FRAMEFOUNDRY_MAX_REFERENCE_BYTES", "20971520"))


@dataclass(frozen=True)
class NodeConfig:
    id: str
    name: str
    role: str
    base_url: str
    probe_path: str = "/system_stats"


def _node_url(key: str, default_port: int) -> str:
    return os.getenv(
        f"FRAMEFOUNDRY_{key.upper()}_URL", f"http://127.0.0.1:{default_port}"
    ).rstrip("/")


NODES = (
    NodeConfig("ltx", "LTX 2.3", "视频实验", _node_url("ltx", 8188)),
    NodeConfig("h3", "MiniMax H3", "核心生成", _node_url("h3", 8189)),
    NodeConfig("seedvr", "SeedVR2", "超分增强", _node_url("seedvr", 8190)),
    NodeConfig(
        "ntsc",
        "ntsc-rs",
        "模拟电视",
        _node_url("ntsc", 8191),
        probe_path="/",
    ),
    NodeConfig(
        "music",
        "Music 3",
        "音乐生成",
        _node_url("music", 8192),
        probe_path="/",
    ),
)


def prepare_directories() -> None:
    for directory in (DATA_DIR, OUTPUT_DIR, UPLOAD_DIR):
        directory.mkdir(parents=True, exist_ok=True)
