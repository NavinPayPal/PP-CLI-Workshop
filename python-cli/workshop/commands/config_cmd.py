"""workshop/commands/config_cmd.py — set the leaderboard URL once."""

import click
from rich import print as rprint
from rich.console import Console

from workshop.utils.agent import is_agent, emit_event, emit_error
from workshop.utils.prompts import agent_text
from workshop.utils.config import (
    get_leaderboard_url, ping_leaderboard, write_config, read_config, CONFIG_FILE,
)

console = Console()


@click.group()
def config():
    """Workshop configuration commands."""
    pass


@config.command("set")
@click.option("--url",  default=None, help="Leaderboard URL, e.g. https://abc123.ngrok.io")
@click.option("--name", default=None, help="Your workshop name (saved for checkins)")
@click.option("--ping", is_flag=True,  help="Test connectivity to current leaderboard URL")
@click.option("--show", is_flag=True,  help="Print current config")
def config_set(url, name, ping, show):
    """Set the leaderboard URL — run once at workshop start."""
    agent = is_agent()

    # ── --show ──────────────────────────────────────────────────
    if show:
        cfg = read_config()
        resolved = get_leaderboard_url()
        if agent:
            emit_event({"event": "config", "config": cfg,
                        "resolved_url": resolved, "config_file": str(CONFIG_FILE)})
        else:
            rprint(f"\n  [dim]Config file:[/dim] {CONFIG_FILE}")
            rprint(f"  [dim]Leaderboard:[/dim] [cyan]{resolved}[/cyan]")
            if cfg.get("workshop_name"):
                rprint(f"  [dim]Name:       [/dim] {cfg['workshop_name']}")
            rprint("")
        return

    # ── --ping ──────────────────────────────────────────────────
    if ping:
        target = get_leaderboard_url()
        if not agent:
            console.print(f"  [dim]Pinging {target} ...[/dim] ", end="")
        result = ping_leaderboard(target)
        if result["ok"]:
            emit_event({"event": "ping_ok", "url": target,
                        "latency_ms": result["latency_ms"],
                        "attendees": result.get("attendees", 0)})
            if not agent:
                rprint(f"[green]✓ reachable[/green] [dim]({result['latency_ms']}ms)[/dim]")
        else:
            emit_error("LEADERBOARD_UNREACHABLE",
                       f"Cannot reach {target} — {result.get('error', 'check URL')}", False)
            if not agent:
                rprint("[red]✗ unreachable[/red]")
                rprint("\n  [yellow]Possible fixes:[/yellow]")
                rprint("  [dim]• Check the ngrok URL from the presenter[/dim]")
                rprint("  [dim]• Run: workshop config set --url <url>[/dim]")
                rprint("  [dim]• Or locally: cd leaderboard && node server.js[/dim]\n")
        return

    # ── Set URL ─────────────────────────────────────────────────
    if not url:
        url = agent_text(
            message="Leaderboard URL (from presenter or http://localhost:3002)",
            default="http://localhost:3002",
            step=1, of=2, field="leaderboard_url",
        )
    if not url:
        return

    url = url.strip().rstrip("/")
    if "ngrok" in url and not url.startswith("http"):
        url = "https://" + url

    if not name:
        name = agent_text(
            message="Your name (used for leaderboard checkins)",
            default="", step=2, of=2, field="workshop_name",
        )

    # Ping to verify
    if not agent:
        console.print(f"\n  [dim]Verifying {url} ...[/dim] ", end="")
    result = ping_leaderboard(url)

    cfg_data = {"leaderboard_url": url}
    if name:
        cfg_data["workshop_name"] = name
    write_config(cfg_data)

    if result["ok"]:
        emit_event({"event": "config_saved", "leaderboard_url": url,
                    "workshop_name": name or None, "ping_ok": True})
        if not agent:
            rprint("[green]✓[/green]")
            rprint(f"\n  [green]Config saved![/green]")
            rprint(f"  [dim]URL: [/dim][cyan]{url}[/cyan]")
            if name:
                rprint(f"  [dim]Name:[/dim] {name}")
            rprint("  [dim]All workshop commands will now use this URL automatically.[/dim]\n")
    else:
        emit_event({"event": "config_saved", "leaderboard_url": url,
                    "workshop_name": name or None, "ping_ok": False,
                    "warning": "URL saved but ping failed"})
        if not agent:
            rprint("[yellow]⚠ saved (not verified)[/yellow]")
            rprint("  [dim]Run --ping to recheck when the server is up.[/dim]\n")
