"""Private implementation of ``@mlflow.assertions`` and the pytest plugin.

Public surface: ``mlflow.assertions`` (the decorator) and the ``verify``
pytest fixture (auto-registered via ``pyproject.toml`` entry point).
"""

from mlflow._assertions.decorator import assertions

__all__ = ["assertions"]
