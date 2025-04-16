"""
The ``mlflow.tracking`` module provides a Python CRUD interface to MLflow experiments
and runs. This is a lower level API that directly translates to MLflow
`REST API <../rest-api.html>`_ calls.
For a higher level API for managing an "active run", use the :py:mod:`mlflow` module.
"""

from mlflow.version import is_mlflow_skinny_installed
from mlflow.tracking._tracking_service.utils import (
    _get_store,
    get_tracking_uri,
    is_tracking_uri_set,
    set_tracking_uri,
)

__all__ = [
    "get_tracking_uri",
    "set_tracking_uri",
    "is_tracking_uri_set",
    "_get_store",
]

if is_mlflow_skinny_installed():
    from mlflow.tracking._model_registry.utils import (
        get_registry_uri,
        set_registry_uri,
    )
    from mlflow.tracking._tracking_service.utils import (
        _get_artifact_repo,
    )
    from mlflow.tracking.client import MlflowClient

    __all__.extend([
        "get_registry_uri",
        "set_registry_uri",
        "_get_artifact_repo",
        "MlflowClient",
    ])