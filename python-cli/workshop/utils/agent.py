"""
workshop/utils/agent.py — Core utilities for agentic CLI patterns (Python)

WORKSHOP PATTERN LIBRARY
Three patterns covered in Section 01:
  1. is_agent()      — detect agent context
  2. emit_event()    — structured stderr output (dual-rendering contract)
  3. FlowState       — resumable state machine
"""

import json
import os
import sys
import time
import uuid
import re
from contextlib import contextmanager
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

# ── 1. AGENT DETECTION ──────────────────────────────────────────────────────

def is_agent() -> bool:
    """
    Returns True if the CLI is running inside an agent context.

    Detection order:
      1. CLAUDE_CODE_AGENT / CODEX_AGENT env vars (set by major agent runners)
      2. sys.stdout.isatty() == False  (piped / tool-call subprocess)
      3. WORKSHOP_AGENT_MODE           (local test override)
    """
    if os.environ.get("CLAUDE_CODE_AGENT"):  return True
    if os.environ.get("CODEX_AGENT"):        return True
    if os.environ.get("GEMINI_AGENT"):       return True
    if not sys.stdout.isatty():              return True
    if os.environ.get("WORKSHOP_AGENT_MODE"): return True
    return False


# ── 2. STRUCTURED STDERR OUTPUT ─────────────────────────────────────────────

def _strip_ansi(text: str) -> str:
    """Remove ANSI escape codes from a string."""
    return re.sub(r"\x1b\[[0-9;]*[mGKHF]", "", text)


def emit_event(envelope: dict) -> None:
    """
    Emit a structured event on stderr for agent consumption.
    Values are ANSI-stripped before writing to ensure clean JSON.
    Events are newline-delimited JSON (NDJSON) — one event per line.
    """
    def _clean(obj):
        if isinstance(obj, str):  return _strip_ansi(obj)
        if isinstance(obj, dict): return {k: _clean(v) for k, v in obj.items()}
        if isinstance(obj, list): return [_clean(v) for v in obj]
        return obj

    sys.stderr.write(json.dumps(_clean(envelope)) + "\n")
    sys.stderr.flush()


def emit_prompt(
    *,
    type: str,
    step: int,
    of: int,
    field: str,
    message: str,
    choices: list[str] | None = None,
    default: Any = None,
    resumable: bool = True,
) -> None:
    """Emit a prompt event before showing an interactive prompt."""
    emit_event({
        "event": "prompt",
        "type": type,
        "step": step,
        "of": of,
        "field": field,
        "message": message,
        **({"choices": choices} if choices else {}),
        **({"default": default} if default is not None else {}),
        "resumable": resumable,
    })


def emit_progress(message: str, pct: int | None = None) -> None:
    emit_event({"event": "progress", "message": message,
                **({"pct": pct} if pct is not None else {})})


def emit_error(code: str, message: str, recoverable: bool = True, **kwargs) -> None:
    emit_event({"event": "error", "code": code, "message": message,
                "recoverable": recoverable, **kwargs})


def emit_complete(outputs: list[str] = (), next_steps: list[str] = ()) -> None:
    emit_event({"event": "complete", "outputs": list(outputs),
                "next_steps": list(next_steps)})


def emit_confirm(action: str, severity: str = "medium",
                 reversible: bool = True, requires_phrase: str | None = None) -> None:
    emit_event({
        "event": "confirm", "action": action,
        "severity": severity, "reversible": reversible,
        **({"requires_phrase": requires_phrase} if requires_phrase else {}),
    })


# ── 3. NOOP SPINNER ─────────────────────────────────────────────────────────

class NoopSpinner:
    """
    Spinner replacement for agent context.
    Same interface as rich.console.status but emits progress events to stderr.
    """
    def __init__(self, text: str = ""):
        self.text = text

    def __enter__(self):
        emit_progress(self.text)
        return self

    def __exit__(self, *_):
        pass

    def update(self, text: str):
        self.text = text
        emit_progress(text)

    def succeed(self, text: str = ""):
        emit_event({"event": "progress", "status": "success", "message": text or self.text})

    def fail(self, text: str = ""):
        emit_event({"event": "progress", "status": "failure", "message": text or self.text})


@contextmanager
def get_spinner(text: str = ""):
    """Context manager — rich spinner for humans, NoopSpinner for agents."""
    if is_agent():
        sp = NoopSpinner(text)
        with sp:
            yield sp
    else:
        from rich.console import Console
        from rich.status import Status
        console = Console(stderr=False)
        with console.status(text) as status:
            # Wrap to match our interface
            status.succeed = lambda t="": console.print(f"[green]✓[/green] {t or text}")
            status.fail    = lambda t="": console.print(f"[red]✗[/red] {t or text}")
            yield status


# ── 4. FLOW STATE (RESUMABLE STATE MACHINE) ──────────────────────────────────

STATE_DIR = Path.home() / ".paypal-workshop" / "state"


@dataclass
class _State:
    flow_id: str
    flow_name: str
    started_at: str
    completed_steps: list[str] = field(default_factory=list)
    current_step: str | None = None
    data: dict = field(default_factory=dict)


class FlowState:
    """
    Persists step results to disk so flows can be resumed.

    Usage:
        state = FlowState("my-command")
        await state.load()                          # check for existing state
        state.set_step("step_1", bread="sourdough") # persist after each step
        state.complete()                            # clean up on success
    """

    def __init__(self, flow_name: str):
        self.flow_name = flow_name
        self.path = STATE_DIR / f"{flow_name}.json"
        self._state: _State | None = None

    def load(self) -> "_State | None":
        """Load existing state from disk. Returns state or None."""
        try:
            raw = json.loads(self.path.read_text())
            self._state = _State(**raw)
            return self._state
        except Exception:
            return None

    def init(self, **initial_data) -> "_State":
        """Initialise a new flow — creates state file with a unique flow_id."""
        STATE_DIR.mkdir(parents=True, exist_ok=True)
        self._state = _State(
            flow_id=uuid.uuid4().hex[:6],
            flow_name=self.flow_name,
            started_at=datetime.now(timezone.utc).isoformat(),
            data=initial_data,
        )
        self._write()
        emit_event({"event": "flow_started", "flow_id": self._state.flow_id,
                    "flow_name": self.flow_name})
        return self._state

    def set_step(self, step_name: str, **data) -> None:
        """Persist a completed step and its answer."""
        if not self._state:
            self.init()
        self._state.current_step = step_name
        if step_name not in self._state.completed_steps:
            self._state.completed_steps.append(step_name)
        self._state.data.update(data)
        self._write()
        emit_event({"event": "step_complete", "step": step_name,
                    "flow_id": self._state.flow_id})

    def complete(self, outputs: list[str] = ()) -> None:
        """Mark the flow complete and delete the state file."""
        emit_event({"event": "flow_complete",
                    "flow_id": self._state.flow_id if self._state else None,
                    "outputs": list(outputs)})
        try:
            self.path.unlink(missing_ok=True)
        except Exception:
            pass
        self._state = None

    def has_resumable_state(self) -> bool:
        return self.path.exists()

    def get(self, key: str, default=None):
        return self._state.data.get(key, default) if self._state else default

    def _write(self):
        STATE_DIR.mkdir(parents=True, exist_ok=True)
        self.path.write_text(json.dumps(asdict(self._state), indent=2))


# ── 5. PROMPT TIMEOUT ───────────────────────────────────────────────────────

import threading

class PromptTimeoutError(Exception):
    pass


def with_timeout(fn, timeout_s: float, field: str = "unknown"):
    """
    Run fn() with a timeout. On timeout, emits a timeout event and raises.
    Use for wrapping blocking prompt calls in agent mode.
    """
    result = [None]
    exc    = [None]

    def _run():
        try:
            result[0] = fn()
        except Exception as e:
            exc[0] = e

    t = threading.Thread(target=_run, daemon=True)
    t.start()
    t.join(timeout_s)
    if t.is_alive():
        emit_event({"event": "timeout", "field": field,
                    "timeout_s": timeout_s, "exit_code": 124})
        raise PromptTimeoutError(f"Prompt '{field}' timed out after {timeout_s}s")
    if exc[0]:
        raise exc[0]
    return result[0]
