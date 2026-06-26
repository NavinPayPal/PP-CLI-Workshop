"""
workshop/utils/config.py — workshop configuration

Priority for LEADERBOARD_URL:
  1. LEADERBOARD_URL env var
  2. ~/.paypal-workshop/config.json
  3. http://localhost:3002 (default)
"""

import json
import os
from pathlib import Path
from typing import Any

CONFIG_DIR  = Path.home() / ".paypal-workshop"
CONFIG_FILE = CONFIG_DIR / "config.json"


def read_config() -> dict:
    try:
        return json.loads(CONFIG_FILE.read_text())
    except Exception:
        return {}


def write_config(data: dict) -> None:
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    existing = read_config()
    CONFIG_FILE.write_text(json.dumps({**existing, **data}, indent=2))


def get_leaderboard_url() -> str:
    if url := os.environ.get("LEADERBOARD_URL"):
        return url.rstrip("/")
    if url := read_config().get("leaderboard_url"):
        return url.rstrip("/")
    return "http://localhost:3002"


def ping_leaderboard(url: str | None = None) -> dict:
    """Test whether the leaderboard is reachable. Returns result dict."""
    import httpx, time
    url = (url or get_leaderboard_url()).rstrip("/")
    start = time.monotonic()
    try:
        r = httpx.get(f"{url}/health", timeout=4.0)
        return {"ok": r.is_success, "url": url,
                "latency_ms": int((time.monotonic() - start) * 1000),
                **r.json()}
    except Exception as e:
        return {"ok": False, "url": url,
                "latency_ms": int((time.monotonic() - start) * 1000),
                "error": str(e)}
