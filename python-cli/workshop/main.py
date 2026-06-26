"""workshop/main.py -- CLI entry point."""

import click

from workshop.commands.exercise import brew
from workshop.commands.exercise_check import brew_check
from workshop.commands.config_cmd import config
from workshop.commands.checkin import checkin


@click.group()
@click.version_option("1.0.0")
def cli():
    """AI Engineer SF -- Agentic CLI Workshop (Python)"""
    pass


# -- Register command groups ---------------------------------------------------
cli.add_command(brew,          name="brew")
cli.add_command(brew_check, name="brew-check")
cli.add_command(config,        name="config")
cli.add_command(checkin,       name="checkin")
