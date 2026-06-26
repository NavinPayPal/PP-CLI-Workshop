"""workshop/commands/checkin.py — report task completion to the live leaderboard."""

import click
import httpx
from rich import print as rprint

from workshop.utils.agent import is_agent, emit_event, emit_error, emit_complete
from workshop.utils.prompts import agent_text, agent_select
from workshop.utils.config import get_leaderboard_url, read_config

VALID_TASKS = [
    {"id": "todo_1",            "label": "TODO-1 — Add emit_prompt()"},
    {"id": "todo_2",            "label": "TODO-2 — Add is_agent() + NoopSpinner"},
    {"id": "todo_3",            "label": "TODO-3 — Add FlowState"},
    {"id": "todo_4",            "label": "TODO-4 — Add emit_complete()"},
    {"id": "eval_pass",         "label": "Evals ✓ — 7/7 tests passing"},
    {"id": "quest_scaffold",    "label": "quest:scaffold — game scaffolded"},
    {"id": "quest_leaderboard", "label": "quest:leaderboard — lb scaffolded"},
    {"id": "quest_play",        "label": "quest:play — played a round"},
]


def _post_checkin(name: str, task: str, source: str = "manual") -> dict | None:
    url = get_leaderboard_url()
    try:
        r = httpx.post(f"{url}/api/checkin",
                       json={"name": name, "task": task, "source": source},
                       timeout=4.0)
        return r.json()
    except Exception:
        return None


def _post_batch(name: str, tasks: list[str], source: str = "eval") -> dict | None:
    url = get_leaderboard_url()
    try:
        r = httpx.post(f"{url}/api/checkin/batch",
                       json={"name": name, "tasks": tasks, "source": source},
                       timeout=4.0)
        return r.json()
    except Exception:
        return None


@click.group()
def checkin():
    """Check in completed tasks to the live leaderboard."""
    pass


@checkin.command("task")
@click.option("--name",  default=None, help="Your name")
@click.option("--task",  default=None, help="Task ID to check in")
@click.option("--batch", default=None, help="Comma-separated task IDs for batch checkin")
@click.option("--source", default="manual", help="Source: manual | eval | cli")
def checkin_task(name, task, batch, source):
    """Report a completed task to the live leaderboard."""
    agent = is_agent()
    cfg = read_config()

    # Use saved name from config if not provided
    if not name:
        name = cfg.get("workshop_name")
    if not name:
        name = agent_text(
            message="Your name", default="Attendee",
            step=1, of=2, field="name",
        )
    if not name:
        return

    # Batch mode
    if batch:
        tasks = [t.strip() for t in batch.split(",") if t.strip()]
        result = _post_batch(name, tasks, source)
        if result:
            emit_event({"event": "batch_checkin_result", "name": name,
                        "tasks": tasks, "score": result.get("score"),
                        "new_tasks": result.get("new_tasks", [])})
            if not agent:
                rprint(f"[green]✓ Checked in {len(tasks)} tasks for {name} "
                       f"({result.get('score', '?')} pts)[/green]")
        else:
            _lb_unavailable(agent)
        emit_complete([], [])
        return

    # Single task
    if not task:
        task = agent_select(
            message="Which task did you complete?",
            choices=[t["id"] for t in VALID_TASKS],
            default="todo_1",
            step=2, of=2, field="task",
        )
    if not task:
        return

    result = _post_checkin(name, task, source)
    if result:
        emit_event({"event": "checkin_result", "name": name, "task": task,
                    "score": result.get("score"),
                    "total_tasks": result.get("total_tasks")})
        if not agent:
            rprint(f"[green]✓ Checked in: {task} for {name} "
                   f"({result.get('score', '?')} pts)[/green]")
    else:
        _lb_unavailable(agent)
    emit_complete([], [])


def _lb_unavailable(agent: bool):
    emit_error("LEADERBOARD_UNAVAILABLE",
               "Leaderboard not running. Start: cd leaderboard && node server.js", False)
    if not agent:
        rprint("[yellow]Leaderboard not running — checkin not recorded.[/yellow]")
        rprint("[dim]Start it: cd leaderboard && node server.js[/dim]")
