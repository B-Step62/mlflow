class SkillVersion:
    """Represents a specific version of a skill in the MLflow Skill Registry.

    Each time a skill is registered (or re-registered), a new immutable version
    is created. Versions are auto-incremented integers starting from 1.

    Args:
        name: The skill name this version belongs to.
        version: Auto-incremented version number (1, 2, 3, ...).
        source: The source from which this version was registered — a GitHub URL
            or local directory path. Recorded for provenance.
        description: Version-specific description. Typically parsed from the
            SKILL.md frontmatter at registration time.
        artifact_location: URI pointing to the stored skill bundle in MLflow's
            artifact store (e.g. ``mlflow-artifacts:/skills/my-skill/3``).
            Used by ``install_skill_from_registry`` to download the bundle.
        creation_timestamp: Milliseconds since epoch when this version was created.
        tags: Key-value metadata on this specific version. Includes both user-set
            tags and system tags (prefixed with ``mlflow.skill.``), such as
            ``mlflow.skill.commit_hash`` and ``mlflow.skill.artifact_location``.
        aliases: List of alias names currently pointing to this version
            (e.g. ``["champion"]``).
        created_by: Username of the person who registered this version.
    """

    def __init__(
        self,
        name: str,
        version: int,
        source: str | None = None,
        description: str | None = None,
        artifact_location: str | None = None,
        creation_timestamp: int | None = None,
        tags: dict[str, str] | None = None,
        aliases: list[str] | None = None,
        created_by: str | None = None,
    ):
        self._name = name
        self._version = version
        self._source = source
        self._description = description
        self._artifact_location = artifact_location
        self._creation_timestamp = creation_timestamp
        self._tags = tags or {}
        self._aliases = aliases or []
        self._created_by = created_by

    @property
    def name(self) -> str:
        return self._name

    @property
    def version(self) -> int:
        return self._version

    @property
    def source(self) -> str | None:
        return self._source

    @property
    def description(self) -> str | None:
        return self._description

    @property
    def artifact_location(self) -> str | None:
        return self._artifact_location

    @property
    def creation_timestamp(self) -> int | None:
        return self._creation_timestamp

    @property
    def tags(self) -> dict[str, str]:
        return self._tags.copy()

    @property
    def aliases(self) -> list[str]:
        return list(self._aliases)

    @property
    def created_by(self) -> str | None:
        return self._created_by

    def __eq__(self, other) -> bool:
        if not isinstance(other, SkillVersion):
            return False
        return self.name == other.name and self.version == other.version

    def __repr__(self) -> str:
        return (
            f"<SkillVersion: name='{self.name}', version={self.version}, "
            f"source='{self.source}'>"
        )
