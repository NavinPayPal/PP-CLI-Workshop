"""
workshop/commands/exercise_check.py -- brew-check

Fully instrumented reference. Compare with exercise.py to see all 4 TODO implementations.

Run (human):  workshop brew order-check
Run (agent):  WORKSHOP_AGENT_MODE=1 workshop brew order-check
Flags:        workshop brew order-check --size large --shots 2 --milk oat
"""

import time
import click
from rich import print as rprint
from rich.console import Console

from workshop.utils.agent import (
    is_agent, emit_confirm, emit_complete, get_spinner, FlowState, emit_event,
)
from workshop.utils.prompts import agent_select, agent_confirm

console = Console()

SIZES = ["small", "medium", "large"]
SHOTS = ["1", "2", "3"]
MILKS = ["whole", "oat", "almond", "none"]

PRICE = {
    "small": 3.50, "medium": 4.00, "large": 4.50,
    "shot": 0.70,
    "oat": 0.60, "almond": 0.60, "whole": 0.00, "none": 0.00,
}

TOTAL_STEPS = 4


def build_receipt(size, shots, milk):
    base  = PRICE[size]
    extra = (int(shots) - 1) * PRICE["shot"]
    milk_ = PRICE.get(milk, 0)
    total = round(base + extra + milk_, 2)
    return {"size": size, "shots": int(shots), "milk": milk, "total": total}


@click.group()
def brew_check():
    """Barista 9000 coffee ordering (reference)."""
    pass


@brew_check.command("order-check")
@click.option("--size",  default=None, help="Coffee size: small | medium | large")
@click.option("--shots", default=None, help="Espresso shots: 1 | 2 | 3")
@click.option("--milk",  default=None, help="Milk type: whole | oat | almond | none")
def brew_order_check(size, shots, milk):
    """Order a coffee -- fully instrumented reference implementation."""

    # TODO-2: agent detection
    agent = is_agent()

    # TODO-3: check for resumable state
    state = FlowState("brew")
    existing = state.load()

    if existing and existing.current_step:
        emit_event({
            "event": "flow_resume_available",
            "flow_name": "brew",
            "current_step": existing.current_step,
            "completed_steps": existing.completed_steps,
            "data": existing.data,
        })
        resume = agent_confirm(
            message="Resume your previous order?",
            step=0, of=TOTAL_STEPS, field="resume", default=True,
        )
        if not resume:
            state.init()
    else:
        state.init()

    if not agent:
        console.rule("[bold]☕  Barista 9000[/bold]")

    # STEP 1 -- size
    size = size or state.get("size")
    if not size:
        # TODO-1: emit_prompt before every prompt call (handled inside agent_select)
        size = agent_select(
            message="What size?",
            choices=SIZES, default="medium",
            step=1, of=TOTAL_STEPS, field="size",
        )
        if not size:
            rprint("[yellow]Order cancelled.[/yellow]")
            return
        # TODO-3: persist after each step
        state.set_step("step_1", size=size)

    # STEP 2 -- shots
    shots = shots or state.get("shots")
    if not shots:
        shots = agent_select(
            message="How many shots?",
            choices=SHOTS, default="2",
            step=2, of=TOTAL_STEPS, field="shots",
        )
        if not shots:
            rprint("[yellow]Order cancelled.[/yellow]")
            return
        state.set_step("step_2", shots=shots)

    # STEP 3 -- milk
    milk = milk or state.get("milk")
    if not milk:
        milk = agent_select(
            message="Milk preference?",
            choices=MILKS, default="oat",
            step=3, of=TOTAL_STEPS, field="milk",
        )
        if not milk:
            rprint("[yellow]Order cancelled.[/yellow]")
            return
        state.set_step("step_3", milk=milk)

    # STEP 4 -- confirm
    receipt = build_receipt(size, shots, milk)
    summary = f"{receipt['size']} * {receipt['shots']} shot(s) * {receipt['milk']} milk -- ${receipt['total']:.2f}"

    # TODO-1: emit confirm event before important confirms
    emit_confirm("place_coffee_order", severity="low", reversible=True)
    ok = agent_confirm(
        message=f"Confirm order: {summary}?",
        step=4, of=TOTAL_STEPS, field="confirm_order", default=True,
    )
    if not ok:
        rprint("[yellow]Order cancelled.[/yellow]")
        return

    # TODO-2: use get_spinner()
    with get_spinner("Brewing your coffee...") as sp:
        time.sleep(0.8)
        sp.succeed("Coffee ready!")

    import time as _t
    output_file = f"receipt-{int(_t.time() * 1000)}.json"

    if not agent:
        rprint(f"\n[green]Enjoy your {receipt['size']} coffee! Total: ${receipt['total']:.2f}[/green]\n")

    # TODO-4: emit completion signal
    emit_complete(
        outputs=[output_file],
        next_steps=["workshop quest play"],
    )

    # TODO-3: clean up state on success
    state.complete(outputs=[output_file])
