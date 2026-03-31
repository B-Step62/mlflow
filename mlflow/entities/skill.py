class Skill:
    """Represents a registered skill in the MLflow Skill Registry."""

    def __init__(
        self,
        name: str,
        description: str | None = None,
        creation_timestamp: int | None = None,
        last_updated_timestamp: int | None = None,
        latest_version: int | None = None,
        aliases: list["SkillAlias"] | None = None,
    ):
        self._name = name
        self._description = description
        self._creation_timestamp = creation_timestamp
        self._last_updated_timestamp = last_updated_timestamp
        self._latest_version = latest_version
        self._aliases = aliases or []

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

    def __eq__(self, other) -> bool:
        if not isinstance(other, Skill):
            return False
        return self.name == other.name and self.description == other.description

    def __repr__(self) -> str:
        return f"<Skill: name='{self.name}', description='{self.description}'>"


class SkillAlias:
    """Represents an alias pointing to a specific skill version."""

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
