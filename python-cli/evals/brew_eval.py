#!/usr/bin/env python3
"""
evals/brew_eval.py

Eval suite for the Python brew command (Barista 9000).
Mirrors the Node.js eval harness -- same tests, same leaderboard reporting.

Run:
  python evals/brew_eval.py
  WORKSHOP_NAME="Alice" python evals/brew_eval.py
"""

import json
import os
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from workshop.utils.config import get_leaderboard_url, read_config

LEADERBOARD_URL = os.environ.get("LEADERBOARD_URL") or get_leaderboard_url()
_cfg            = read_config()
WORKSHOP_NAME   = os.environ.get("WORKSHOP_NAME") or _cfg.get("workshop_name")

_workshop_root = str(Path(__file__).parent.parent)
CLI = [
    sys.executable, "-u", "-c",
    f"import sys; sys.path.insert(0, {_workshop_root!r}); "
    "from workshop.main import cli; cli()",
]


# ── CLI Agent Simulator ───────────────────────────────────────────────────────

class CliAgentSim:
    def __init__(self, strategy: str = "use-defaults", timeout_s: float = 12.0,
                 verbose: bool = False):
        self.strategy  = strategy
        self.timeout_s = timeout_s
        self.verbose   = verbose

    def run(self, command: list[str], env: dict | None = None) -> "SimResult":
        import subprocess
        state_dir = Path.home() / ".paypal-workshop" / "state"
        if state_dir.exists():
            for f in state_dir.glob("*.json"):
                f.unlink(missing_ok=True)

        merged_env = {**os.environ, "WORKSHOP_AGENT_MODE": "1",
                      "PYTHONUNBUFFERED": "1", **(env or {})}

        # Phase 1: discover prompts
        try:
            result = subprocess.run(
                command, input="\n" * 12, capture_output=True,
                env=merged_env, text=True, timeout=self.timeout_s,
            )
        except subprocess.TimeoutExpired:
            return SimResult(exit_code=None, events=[], stdout="", hung=True)

        all_events: list[dict] = []
        for line in result.stderr.splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                all_events.append(json.loads(line))
            except json.JSONDecodeError:
                pass

        prompt_events = [e for e in all_events if e.get("event") == "prompt"]
        if not prompt_events:
            return SimResult(exit_code=result.returncode, events=all_events,
                             stdout=result.stdout, hung=False)

        # Phase 2: re-run with correct answers
        if state_dir.exists():
            for f in state_dir.glob("*.json"):
                f.unlink(missing_ok=True)

        answers = [self._pick_answer(p) for p in prompt_events]
        stdin_answers = "\n".join(answers) + "\n"

        try:
            result2 = subprocess.run(
                command, input=stdin_answers, capture_output=True,
                env=merged_env, text=True, timeout=self.timeout_s,
            )
        except subprocess.TimeoutExpired:
            return SimResult(exit_code=None, events=all_events, stdout="", hung=True)

        final_events: list[dict] = []
        for line in result2.stderr.splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                final_events.append(json.loads(line))
            except json.JSONDecodeError:
                pass

        return SimResult(exit_code=result2.returncode, events=final_events,
                         stdout=result2.stdout, hung=False)

    def _pick_answer(self, evt: dict) -> str:
        choices = evt.get("choices", [])
        default = evt.get("default")
        if self.strategy == "use-defaults":
            return str(default) if default is not None else (choices[0] if choices else "")
        if self.strategy == "use-first":
            return choices[0] if choices else (str(default) if default is not None else "")
        if self.strategy == "random":
            import random as _r
            if choices:
                return _r.choice(choices)
            if evt.get("type") == "confirm":
                return _r.choice(["y", "n"])
            return str(default) if default is not None else "random-input"
        return str(default) if default is not None else ""


class SimResult:
    def __init__(self, exit_code, events, stdout, hung):
        self.exit_code = exit_code
        self.events    = events
        self.stdout    = stdout
        self.hung      = hung

    def events_of_type(self, t: str) -> list[dict]:
        return [e for e in self.events if e.get("event") == t]

    def contains_event(self, matcher: dict) -> bool:
        return any(all(e.get(k) == v for k, v in matcher.items()) for e in self.events)


# ── Eval runner ───────────────────────────────────────────────────────────────

def run_evals():
    passed = 0
    failed = 0
    passed_tasks: set[str] = set()

    TASK_MAP = {
        "baseline: brew hangs without agent instrumentation": None,
        "mission-1: use-defaults completes without hanging":   "mission_1",
        "mission-1: prompt events emitted on stderr":          "mission_1",
        "mission-1: all prompt events have required fields":   "mission_1",
        "mission-2: state resumes after interrupt":            "mission_2",
        "mission-3: flags shortcut skips all prompts":         "mission_3",
        "mission-3: emits a complete event":                   "mission_3",
    }

    def test(name: str, fn):
        nonlocal passed, failed
        print(f"  {name} ... ", end="", flush=True)
        try:
            fn()
            print("pass")
            passed += 1
            task_id = TASK_MAP.get(name)
            if task_id:
                passed_tasks.add(task_id)
        except AssertionError as e:
            print(f"FAIL -- {e}")
            failed += 1

    # ── Baseline ─────────────────────────────────────────────────────────────
    print("\n-- Baseline (broken brew) ------------------------------------------")
    print("   Expected: hangs without Mission 1 instrumentation\n")

    def test_baseline():
        sim = CliAgentSim(strategy="use-defaults", timeout_s=5.0)
        r = sim.run(CLI + ["brew", "order"])
        assert len(r.events_of_type("prompt")) == 0, \
            "Expected 0 prompt events (no agent instrumentation)"

    test("baseline: brew hangs without agent instrumentation", test_baseline)

    # ── Mission 1 ─────────────────────────────────────────────────────────────
    print("\n-- Mission 1 -- Make it speak --------------------------------------")
    print("   Expected: prompt events on stderr, no more freezing\n")

    def test_m1_completes():
        sim = CliAgentSim(strategy="use-defaults", timeout_s=12.0)
        r = sim.run(CLI + ["brew-check", "order-check"])
        assert not r.hung,       "CLI hung -- add emit_prompt() before each prompt"
        assert r.exit_code == 0, f"Expected exit 0, got {r.exit_code}"

    def test_m1_prompt_events():
        sim = CliAgentSim(strategy="use-defaults", timeout_s=12.0)
        r = sim.run(CLI + ["brew-check", "order-check"])
        prompts = r.events_of_type("prompt")
        assert len(prompts) >= 3, f"Expected >=3 prompt events, got {len(prompts)}"

    def test_m1_prompt_fields():
        sim = CliAgentSim(strategy="use-defaults", timeout_s=12.0)
        r = sim.run(CLI + ["brew-check", "order-check"])
        for p in r.events_of_type("prompt"):
            assert p.get("field"),   f"Prompt missing 'field': {p}"
            assert p.get("type"),    f"Prompt missing 'type': {p}"
            assert p.get("step"),    f"Prompt missing 'step': {p}"
            assert p.get("choices"), f"Prompt missing 'choices': {p}"

    test("mission-1: use-defaults completes without hanging", test_m1_completes)
    test("mission-1: prompt events emitted on stderr",        test_m1_prompt_events)
    test("mission-1: all prompt events have required fields", test_m1_prompt_fields)

    # ── Mission 2 ─────────────────────────────────────────────────────────────
    print("\n-- Mission 2 -- Make it remember -----------------------------------")
    print("   Expected: interrupt mid-order, re-run, it continues\n")

    def test_m2_resume():
        import subprocess
        # Seed partial state
        subprocess.run([
            sys.executable, "-u", "-c",
            f"import sys; sys.path.insert(0, {_workshop_root!r}); "
            "import os; os.environ['WORKSHOP_AGENT_MODE']='1'; "
            "from workshop.utils.agent import FlowState; "
            "s = FlowState('brew'); s.init(); "
            "s.set_step('step_1', size='medium'); s.set_step('step_2', shots='2')"
        ], capture_output=True, text=True)

        sim = CliAgentSim(strategy="use-defaults", timeout_s=12.0)
        r = sim.run(CLI + ["brew-check", "order-check"])
        assert not r.hung, "CLI hung during resume test"
        assert (
            r.contains_event({"event": "flow_resume_available"}) or
            r.contains_event({"event": "complete"})
        ), "Expected flow_resume_available or complete event"

    test("mission-2: state resumes after interrupt", test_m2_resume)

    # ── Mission 3 ─────────────────────────────────────────────────────────────
    print("\n-- Mission 3 -- Make it finish -------------------------------------")
    print("   Expected: flags bypass all prompts, complete event on exit\n")

    def test_m3_flags():
        sim = CliAgentSim(strategy="use-defaults", timeout_s=10.0)
        r = sim.run(CLI + ["brew-check", "order-check",
                            "--size", "large", "--shots", "2", "--milk", "oat"])
        assert not r.hung,       "CLI hung even with flags"
        assert r.exit_code == 0, f"Expected exit 0, got {r.exit_code}"
        core = [p for p in r.events_of_type("prompt") if p.get("field") in ("size","shots","milk")]
        assert len(core) == 0,   f"Flags should skip prompts, got {len(core)} prompt(s)"

    def test_m3_complete():
        sim = CliAgentSim(strategy="use-defaults", timeout_s=12.0)
        r = sim.run(CLI + ["brew-check", "order-check"])
        assert r.contains_event({"event": "complete"}), "Missing complete event"

    test("mission-3: flags shortcut skips all prompts", test_m3_flags)
    test("mission-3: emits a complete event",            test_m3_complete)

    # ── Summary ───────────────────────────────────────────────────────────────
    print(f"\n  Results: {passed} passed, {failed} failed")

    if failed == 0 and passed >= 7:
        passed_tasks.add("eval_pass")
        print("  All tests pass!")

    if passed_tasks and WORKSHOP_NAME:
        _report_to_leaderboard(list(passed_tasks))
    elif WORKSHOP_NAME:
        print("\n  No missions to report yet -- keep going!")
    else:
        print('\n  Tip: set WORKSHOP_NAME="Your Name" to auto-report to the leaderboard.')

    print()
    sys.exit(1 if failed > 0 else 0)


def _report_to_leaderboard(tasks: list[str]):
    try:
        import httpx
        httpx.post(f"{LEADERBOARD_URL}/api/checkin/batch",
                   json={"name": WORKSHOP_NAME, "tasks": tasks, "source": "eval"},
                   timeout=4.0)
        print(f"\n  Reported {len(tasks)} task(s) to leaderboard for {WORKSHOP_NAME}")
    except Exception:
        print("\n  (Leaderboard not running -- checkin skipped.)")


if __name__ == "__main__":
    run_evals()
