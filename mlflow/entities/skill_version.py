class SkillVersion:
    """Represents a specific version of a skill in the MLflow Skill Registry."""

    def __init__(
        self,
        name: str,
        version: int,
        source: str | None = None,
        description: str | None = None,
        manifest_content: str | None = None,
        artifact_location: str | None = None,
        creation_timestamp: int | None = None,
        tags: dict[str, str] | None = None,
        aliases: list[str] | None = None,
    ):
        self._name = name
        self._version = version
        self._source = source
        self._description = description
        self._manifest_content = manifest_content
        self._artifact_location = artifact_location
        self._creation_timestamp = creation_timestamp
        self._tags = tags or {}
        self._aliases = aliases or []

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
    def manifest_content(self) -> str | None:
        return self._manifest_content

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

    def __eq__(self, other) -> bool:
        if not isinstance(other, SkillVersion):
            return False
        return self.name == other.name and self.version == other.version

    def __repr__(self) -> str:
        return (
            f"<SkillVersion: name='{self.name}', version={self.version}, "
            f"source='{self.source}'>"
        )
