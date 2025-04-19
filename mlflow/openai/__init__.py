from mlflow.openai._openai_autolog import autolog
from mlflow.openai.constants import FLAVOR_NAME
from mlflow.version import IS_MLFLOW_SKINNY_INSTALLED

__all__ = ["autolog", "FLAVOR_NAME"]

# Import model logging APIs only if mlflow-skinny is installed,
# i.e., skip if only mlflow-trace package is installed.
if IS_MLFLOW_SKINNY_INSTALLED:
    from mlflow.openai.model import (
        load_model,
        log_model,
        save_model,
        _load_pyfunc,
        _OpenAIEnvVar,
    )

    __all__ += [
        "load_model",
        "log_model",
        "save_model",
        "_load_pyfunc",
        _OpenAIEnvVar,
    ]
