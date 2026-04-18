class Skill:
    """Represents a registered skill in the MLflow Skill Registry.

    A skill is a named, versionable unit of procedural knowledge — instructions,
    scripts, and reference materials that teach AI agents how to perform tasks.
    Skills follow the `Agent Skills <https://agentskills.io>`_ open standard.

    Args:
        name: Unique skill name. Must match ``[a-zA-Z0-9_.-]+``.
        description: Human-readable description of what the skill does and when to use it.
            Parsed from the SKILL.md frontmatter at registration time.
        creation_timestamp: Milliseconds since epoch when the skill was first registered.
        last_updated_timestamp: Milliseconds since epoch when the skill was last modified
            (new version registered, tag changed, etc.).
        latest_version: The highest version number among all versions of this skill.
        aliases: Named pointers to specific versions (e.g. "champion" → v3).
            Aliases allow stable references that can be re-pointed without changing
            downstream install commands.
        tags: Key-value metadata on the skill itself (not on individual versions).
            Use for categorization — e.g. ``team=platform``, ``domain=code-review``.
    """

    def __init__(
        self,
        name: str,
        description: str | None = None,
        creation_timestamp: int | None = None,
        last_updated_timestamp: int | None = None,
        latest_version: int | None = None,
        aliases: list["SkillAlias"] | None = None,
        tags: dict[str, str] | None = None,
    ):
        self._name = name
        self._description = description
        self._creation_timestamp = creation_timestamp
        self._last_updated_timestamp = last_updated_timestamp
        self._latest_version = latest_version
        self._aliases = aliases or []
        self._tags = tags or {}

    @property
    def name(self) -> str:
        return self._name

    @property
    def description(self) -> str | None:
        return self._description

    @property
    def creation_timestamp(self) -> int | None:
        return self._creation_timestamp

    @property
    def last_updated_timestamp(self) -> int | None:
        return self._last_updated_timestamp

    @property
    def latest_version(self) -> int | None:
        return self._latest_version

    @property
    def aliases(self) -> list["SkillAlias"]:
        return list(self._aliases)

    @property
    def tags(self) -> dict[str, str]:
        return self._tags.copy()

    def __eq__(self, other) -> bool:
        if not isinstance(other, Skill):
            return False
        return self.name == other.name and self.description == other.description

    def __repr__(self) -> str:
        return f"<Skill: name='{self.name}', description='{self.description}'>"


class SkillAlias:
    """A named pointer from an alias string to a specific skill version number.

    Args:
        name: The skill name this alias belongs to.
        alias: The alias string (e.g. "champion", "staging").
        version: The version number this alias points to.
    """

    def __init__(self, name: str, alias: str, version: int):
        self._name = name
        self._alias = alias
        self._version = version

    @property
    def name(self) -> str:
        return self._name

    @property
    def alias(self) -> str:
        return self._alias

    @property
    def version(self) -> int:
        return self._version

    def __eq__(self, other) -> bool:
        if not isinstance(other, SkillAlias):
            return False
        return (
            self.name == other.name
            and self.alias == other.alias
            and self.version == other.version
        )

    def __repr__(self) -> str:
        return f"<SkillAlias: name='{self.name}', alias='{self.alias}', version={self.version}>"
