from __future__ import annotations

from dataclasses import dataclass
import re
from typing import Any, Optional, Union

import yaml
from mlflow.entities.model_registry._model_registry_entity import _ModelRegistryEntity


@dataclass
class Prompt(_ModelRegistryEntity):
    name: str
    version: int
    template_text: str
    description: Optional[str] = None
    created_at: Optional[int] = None
    tags: Optional[list[PromptTag]] = None


    @property
    def variables(self) -> set[str]:
        """
        Return a list of variables in the template text.

        The value must be enclosed in curly braces, e.g. {variable}.
        """
        if hasattr(self, "_variables"):
            return self._variables

        pattern = r"\{\{([a-zA-Z0-9_]+)\}\}"
        variables = re.findall(pattern, self.template_text)
        self._variables = set(variables)
        return self._variables


    def format(self,
               allow_partial: bool = False,
               **kwargs) -> Union[Prompt, str]:
        """
        Format the template text with the given keyword arguments.

        By default, it raises an error if there are missing variables. If `allow_partial` is True, it allow missing variables and returns a Prompt object with the partially formatted template text.
        """
        input_keys = set(kwargs.keys())
        missing_keys = self.variables - input_keys

        if missing_keys and not allow_partial:
            raise ValueError(f"Missing variables: {missing_keys}. To partially format the prompt, set `allow_partial=True`.")

        formatted_text = self._format_text(kwargs, missing_keys)
        if not missing_keys:
            return formatted_text

        return Prompt(
            name=self.name,
            version=self.version,
            template_text=formatted_text,
            description=self.description,
            created_at=self.created_at,
            tags=self.tags,
        )


    @classmethod
    def from_yaml(cls, yaml_path: str):
        """
        Load a prompt from a YAML file.
        """
        with open(yaml_path, "r") as f:
            data = yaml.safe_load(f)

        return cls(
            name=data["name"],
            version=data["version"],
            template_text=data["template_text"],
            description=data.get("description"),
            created_at=data.get("created_at"),
            tags=[PromptTag(key=k, value=v) for k, v in data.get("tags", {}).items()],
        )

    def to_yaml(self, yaml_path: str):
        """
        Save a prompt to a YAML file.
        """
        data = {
            "name": self.name,
            "version": self.version,
            "template_text": self.template_text,
            "description": self.description,
            "created_at": self.created_at,
            "tags": {tag.key: tag.value for tag in self.tags or []},
        }

        with open(yaml_path, "w") as f:
            yaml.safe_dump(data, f)

@dataclass
class PromptTag(_ModelRegistryEntity):
    key: str
    value: str