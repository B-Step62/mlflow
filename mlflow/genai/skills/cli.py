"""CLI commands for MLflow Skill Registry."""

import json
from pathlib import Path

import click


def _parse_skill_ref(ref: str) -> tuple[str, int | None, str | None]:
    """Parse a skill reference: ``name``, ``name/version``, or ``name@alias``."""
    if "/" in ref:
        match ref.rsplit("/", 1):
            case [name, ver] if ver.isdigit():
                return name, int(ver), None
            case _:
                raise click.BadParameter(
                    f"Invalid skill reference '{ref}'. Version must be an integer (e.g. my-skill/3)."
                )
    if "@" in ref:
        match ref.rsplit("@", 1):
            case [name, alias] if alias:
                return name, None, alias
            case _:
                raise click.BadParameter(
                    f"Invalid skill reference '{ref}'. Expected format: name@alias."
                )
    return ref, None, None


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
@click.argument("refs", nargs=-1, required=True)
@click.option(
    "--scope",
    type=click.Choice(["global", "project"]),
    default="global",
    help="Installation scope.",
)
@click.option("--project-path", type=click.Path(), default=None, help="Project directory.")
def load_cmd(refs, scope, project_path):
    """Install one or more skills from the registry.

    \b
    Each REF can be:
      name          install latest version
      name/3        install version 3
      name@alias    install the version pointed to by alias

    \b
    Examples:
      mlflow skills load my-skill
      mlflow skills load my-skill/3
      mlflow skills load my-skill@champion
      mlflow skills load skill-a skill-b/2 skill-c@prod
    """
    from mlflow.genai.skills import install_skill

    pp = Path(project_path) if project_path else None
    for ref in refs:
        name, version, alias = _parse_skill_ref(ref)
        path = install_skill(
            name=name,
            version=version,
            alias=alias,
            scope=scope,
            project_path=pp,
        )
        click.echo(f"Installed {name} to {path}")


@commands.command("show")
@click.argument("ref")
def show_cmd(ref):
    """Show details of a skill or skill version.

    \b
    REF can be:
      name          show latest version
      name/3        show version 3
      name@alias    show the version pointed to by alias
    """
    from mlflow.genai.skills import load_skill

    name, version, alias = _parse_skill_ref(ref)
    sv = load_skill(name, version=version, alias=alias)
    click.echo(f"Name: {sv.name}")
    click.echo(f"Version: {sv.version}")
    click.echo(f"Source: {sv.source or '(none)'}")
    click.echo(f"Description: {sv.description or '(none)'}")
    if sv.tags:
        click.echo(f"Tags: {json.dumps(sv.tags)}")
    if sv.aliases:
        click.echo(f"Aliases: {', '.join(sv.aliases)}")
