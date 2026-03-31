"""CLI commands for MLflow Skill Registry."""

import json
from pathlib import Path

import click


@click.group("skills")
def commands():
    """Manage skills in the MLflow Skill Registry."""


@commands.command("register")
@click.argument("source")
@click.option("--tag", "-t", multiple=True, help="Tag in key=value format.")
def register_cmd(source, tag):
    """Register skill(s) from a GitHub URL or local directory."""
    from mlflow.genai.skills import register_skill

    tags = {}
    for t in tag:
        if "=" not in t:
            raise click.BadParameter(f"Tag must be in key=value format: {t}")
        k, v = t.split("=", 1)
        tags[k] = v

    versions = register_skill(source=source, tags=tags or None)
    for sv in versions:
        click.echo(f"Registered: {sv.name} v{sv.version}")


@commands.command("list")
@click.option("--filter", "filter_string", default=None, help="Filter by name substring.")
@click.option("--max-results", default=100, type=int)
def list_cmd(filter_string, max_results):
    """List registered skills."""
    from mlflow.genai.skills import search_skills

    skills = search_skills(filter_string=filter_string, max_results=max_results)
    if not skills:
        click.echo("No skills registered.")
        return
    for s in skills:
        version_info = f" (latest: v{s.latest_version})" if s.latest_version else ""
        click.echo(f"  {s.name}{version_info} — {s.description or '(no description)'}")


@commands.command("load")
@click.argument("names", nargs=-1, required=True)
@click.option("--version", "-v", type=int, default=None, help="Specific version (applies to all skills).")
@click.option("--alias", "-a", default=None, help="Alias to resolve (applies to all skills).")
@click.option(
    "--scope",
    type=click.Choice(["global", "project"]),
    default="global",
    help="Installation scope.",
)
@click.option("--project-path", type=click.Path(), default=None, help="Project directory.")
def load_cmd(names, version, alias, scope, project_path):
    """Install one or more skills from the registry to the local filesystem.

    Omit --version to install the latest version of each skill.
    """
    from mlflow.genai.skills import install_skill

    pp = Path(project_path) if project_path else None
    for name in names:
        path = install_skill(
            name=name,
            version=version,
            alias=alias,
            scope=scope,
            project_path=pp,
        )
        click.echo(f"Installed {name} to {path}")


@commands.command("show")
@click.argument("name")
@click.option("--version", "-v", type=int, default=None)
def show_cmd(name, version):
    """Show details of a skill or skill version."""
    from mlflow.genai.skills import load_skill

    sv = load_skill(name, version=version)
    click.echo(f"Name: {sv.name}")
    click.echo(f"Version: {sv.version}")
    click.echo(f"Source: {sv.source or '(none)'}")
    click.echo(f"Description: {sv.description or '(none)'}")
    if sv.tags:
        click.echo(f"Tags: {json.dumps(sv.tags)}")
    if sv.aliases:
        click.echo(f"Aliases: {', '.join(sv.aliases)}")
