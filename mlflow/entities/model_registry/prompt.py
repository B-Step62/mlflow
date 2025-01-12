from __future__ import annotations

from dataclasses import dataclass
import re
from typing import Optional, Union

from mlflow.entities.model_registry.model_version import ModelVersion
from mlflow.entities.model_registry.model_version_tag import ModelVersionTag



# A special tag in RegisteredModel to indicate that it is a prompt
IS_PROMPT_TAG_KEY = "mlflow.prompt.is_prompt"
# A special tag in ModelVersion to store the prompt text
PROMPT_TEXT_TAG_KEY = "mlflow.prompt.text"

# Alias type
PromptVersionTag = ModelVersionTag

@dataclass
class Prompt(ModelVersion):
    """
    Prompt is a subclass of ModelVersion. It represents a prompt in the model registry.
    """
    def __init__(
        self,
        name: str,
        version: int,
        template_text: str,
        description: Optional[str] = None,
        creation_timestamp: Optional[int] = None,
        tags: Optional[dict[str, str]] = None,
    ):
        # Store template text as a tag
        tags = tags or {}

        if not PROMPT_TEXT_TAG_KEY in tags:
            tags[PROMPT_TEXT_TAG_KEY] = template_text

        super().__init__(
            name=name,
            version=version,
            creation_timestamp=creation_timestamp,
            description=description,
            tags=[ModelVersionTag(key=key, value=value) for key, value in tags.items()],
        )

    @property
    def tags(self) -> dict[str, str]:
        """
        Return the tags of the prompt as a dictionary.
        """
        # Remove the prompt text tag as it is internal
        return {key: value for key, value in self._tags.items() if key != PROMPT_TEXT_TAG_KEY}

    @tags.setter
    def tags(self, tags: dict[str, str]):
        """
        Set the tags of the prompt.
        """
        self._tags = {
            **tags,
            PROMPT_TEXT_TAG_KEY: self.template_text,
        }

    @classmethod
    def from_model_version(cls, model_version: ModelVersion) -> Prompt:
        """
        Create a Prompt object from a ModelVersion object.
        """
        if not PROMPT_TEXT_TAG_KEY in model_version.tags:
            raise ValueError("ModelVersion object does not contain prompt text.")

        return cls(
            name=model_version.name,
            version=model_version.version,
            template_text=model_version.tags[PROMPT_TEXT_TAG_KEY],
            description=model_version.description,
            creation_timestamp=model_version.creation_timestamp,
            tags=model_version.tags,
        )

    @property
    def template_text(self) -> str:
        """
        Return the template text of the prompt.
        """
        return self._tags[PROMPT_TEXT_TAG_KEY]

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

        return self.template_text.format(**kwargs)
