from __future__ import annotations

import json
from pathlib import Path
from typing import Any

DATA_DIR = Path("/data")
SETTINGS_PATH = DATA_DIR / "settings.json"
RUNTIME_PATH = DATA_DIR / "runtime-config.json"


def ensure_data_dir() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)


def read_json(path: Path, default: dict[str, Any]) -> dict[str, Any]:
    if not path.exists():
        return default
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return default


def write_json(path: Path, value: dict[str, Any]) -> None:
    ensure_data_dir()
    path.write_text(json.dumps(value, indent=2), encoding="utf-8")
