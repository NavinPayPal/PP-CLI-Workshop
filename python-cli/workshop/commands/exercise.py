"""
workshop/commands/exercise.py — brew

This is the STARTING STATE for the hands-on exercise.
It's a deliberately non-agent-friendly CLI that attendees will fix.

PROBLEMS TO FIX (each marked with a TODO):
  TODO-1  Add emit_prompt() before each prompt  -> dual-rendering contract
  TODO-2  Add is_agent() / NoopSpinner          -> agent detection
  TODO-3  Add FlowState persistence             -> resumable state machine
  TODO-4  Add emit_complete() on success        -> explicit signals

Run the broken version:
  workshop brew order

Test in agent mode (will hang on TODO-1):
  WORKSHOP_AGENT_MODE=1 workshop brew order

"""

import time
import click
from rich.console import Console
from rich import print as rprint
import questionary

console = Console()

SIZES = ["small", "medium", "large"]
SHOTS = ["1", "2", "3"]
MILKS = ["whole", "oat", "almond", "none"]

PRICE = {
    "small": 3.50, "medium": 4.00, "large": 4.50,
    "shot": 0.70,
    "oat": 0.60, "almond": 0.60, "whole": 0.00, "none": 0.00,
}


def build_receipt(size, shots, milk):
    base  = PRICE[size]
    extra = (int(shots) - 1) * PRICE["shot"]
    milk_ = PRICE.get(milk, 0)
    total = round(base + extra + milk_, 2)
    return {"size": size, "shots": int(shots), "milk": milk, "total": total}


@click.group()
def brew():
    """Barista 9000 coffee ordering (exercise)."""
    pass


@brew.command("order")
def brew_order():
    """Order a coffee from Barista 9000 (exercise -- needs agent instrumentation)."""
    console.rule("[bold cyan]☕  Barista 9000[/bold cyan]")

    # TODO-2: Add agent detection here.
    #   agent = is_agent()
    #   Use get_spinner() context manager instead of console.status()

    # STEP 1 -- size
    # TODO-1: emit a prompt event before the questionary call
    #   emit_prompt(type="select", step=1, of=4, field="size",
    #               message="What size?", choices=SIZES, default="medium")
    size = questionary.select(
        "What size?", choices=SIZES, default="medium"
    ).ask()
    if not size:
        return

    # TODO-3: persist step 1 to FlowState here
    #   state.set_step("step_1", size=size)

    # STEP 2 -- shots
    # TODO-1: emit prompt event for step 2
    shots = questionary.select(
        "How many shots?", choices=SHOTS, default="2"
    ).ask()
    if not shots:
        return

    # TODO-3: persist step 2

    # STEP 3 -- milk
    # TODO-1: emit prompt event for step 3
    milk = questionary.select(
        "Milk preference?", choices=MILKS, default="oat"
    ).ask()
    if not milk:
        return

    # TODO-3: persist step 3

    # STEP 4 -- confirm order
    receipt = build_receipt(size, shots, milk)
    summary = f"{receipt['size']} * {receipt['shots']} shot(s) * {receipt['milk']} milk -- ${receipt['total']:.2f}"

    # TODO-1: emit a confirm event here
    #   emit_confirm("place_coffee_order", severity="low", reversible=True)
    ok = questionary.confirm(f"Confirm order: {summary}?", default=True).ask()
    if not ok:
        rprint("[yellow]Order cancelled.[/yellow]")
        return

    # Processing spinner
    # TODO-2: replace console.status() with get_spinner()
    with console.status("Brewing your coffee..."):
        time.sleep(1.0)

    rprint(f"\n[green]Enjoy your {receipt['size']} coffee! Total: ${receipt['total']:.2f}[/green]\n")

    # TODO-4: emit emit_complete(["receipt-<timestamp>.json"], ["workshop quest play"])
    # TODO-3: call state.complete()
