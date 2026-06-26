"""
workshop/utils/prompts.py — agent-aware prompt wrappers

Human mode:  questionary (beautiful interactive prompts)
Agent mode:  plain sys.stdin readline — no arrow keys, no TTY needed
"""

import sys
from typing import Any

from .agent import is_agent, emit_prompt, with_timeout


def _read_line(timeout_s: float = 15.0, field: str = "unknown") -> str:
    return with_timeout(lambda: sys.stdin.readline().rstrip("\n"), timeout_s, field)


def agent_select(
    *,
    message: str,
    choices: list[str],
    default: str | None = None,
    step: int,
    of: int,
    field: str,
) -> str:
    """
    Select from a list of choices.
    Human: questionary interactive selector.
    Agent: reads a plain text choice value from stdin.
    """
    emit_prompt(type="select", step=step, of=of, field=field,
                message=message, choices=choices, default=default)

    if is_agent():
        ans = _read_line(field=field).strip()
        return ans if ans in choices else (default or choices[0])

    import questionary
    return questionary.select(message, choices=choices, default=default).ask()


def agent_text(
    *,
    message: str,
    default: str = "",
    step: int,
    of: int,
    field: str,
) -> str:
    """
    Free-text input.
    Human: questionary text prompt.
    Agent: reads a plain text line from stdin.
    """
    emit_prompt(type="input", step=step, of=of, field=field,
                message=message, default=default)

    if is_agent():
        ans = _read_line(field=field).strip()
        return ans or default

    import questionary
    result = questionary.text(message, default=default).ask()
    return result or default


def agent_confirm(
    *,
    message: str,
    default: bool = True,
    step: int,
    of: int,
    field: str,
) -> bool:
    """
    Yes/no confirmation.
    Human: questionary confirm prompt.
    Agent: reads 'y'/'n'/'true'/'false' from stdin.
    """
    emit_prompt(type="confirm", step=step, of=of, field=field,
                message=message, default=default)

    if is_agent():
        ans = _read_line(field=field).strip().lower()
        if ans in ("y", "yes", "true"):  return True
        if ans in ("n", "no", "false"):  return False
        return default

    import questionary
    result = questionary.confirm(message, default=default).ask()
    return result if result is not None else default
