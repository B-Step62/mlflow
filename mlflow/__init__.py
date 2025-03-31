"""
The ``mlflow`` module provides a high-level "fluent" API for starting and managing MLflow runs.
For example:

.. code:: python

    import mlflow

    mlflow.start_run()
    mlflow.log_param("my", "param")
    mlflow.log_metric("score", 100)
    mlflow.end_run()

You can also use the context manager syntax like this:

.. code:: python

    with mlflow.start_run() as run:
        mlflow.log_param("my", "param")
        mlflow.log_metric("score", 100)

which automatically terminates the run at the end of the ``with`` block.

The fluent tracking API is not currently threadsafe. Any concurrent callers to the tracking API must
implement mutual exclusion manually.

For a lower level API, see the :py:mod:`mlflow.client` module.
"""

import contextlib
import importlib
from typing import TYPE_CHECKING

from mlflow.version import VERSION

__version__ = VERSION

import mlflow.mismatch

# `check_version_mismatch` must be called here before importing any other modules
with contextlib.suppress(Exception):
    mlflow.mismatch._check_version_mismatch()

from mlflow.environment_variables import MLFLOW_CONFIGURE_LOGGING
from mlflow.utils.lazy_load import LazyLoader
from mlflow.utils.logging_utils import _configure_mlflow_loggers
from mlflow.exceptions import MlflowException


# Lazy load
artifacts = LazyLoader("mlflow.artifacts", globals(), "mlflow.artifacts")
client = LazyLoader("mlflow.client", globals(), "mlflow.client")
config = LazyLoader("mlflow.config", globals(), "mlflow.config")
data = LazyLoader("mlflow.data", globals(), "mlflow.data")
exceptions = LazyLoader("mlflow.exceptions", globals(), "mlflow.exceptions")
models = LazyLoader("mlflow.models", globals(), "mlflow.models")
projects = LazyLoader("mlflow.projects", globals(), "mlflow.projects")
tracking = LazyLoader("mlflow.tracking", globals(), "mlflow.tracking")
tracing = LazyLoader("mlflow.tracing", globals(), "mlflow.tracing")


# Lazily load mlflow flavors to avoid excessive dependencies.
anthropic = LazyLoader("mlflow.anthropic", globals(), "mlflow.anthropic")
autogen = LazyLoader("mlflow.autogen", globals(), "mlflow.autogen")
bedrock = LazyLoader("mlflow.bedrock", globals(), "mlflow.bedrock")
catboost = LazyLoader("mlflow.catboost", globals(), "mlflow.catboost")
crewai = LazyLoader("mlflow.crewai", globals(), "mlflow.crewai")
diviner = LazyLoader("mlflow.diviner", globals(), "mlflow.diviner")
dspy = LazyLoader("mlflow.dspy", globals(), "mlflow.dspy")
gemini = LazyLoader("mlflow.gemini", globals(), "mlflow.gemini")
groq = LazyLoader("mlflow.groq", globals(), "mlflow.groq")
johnsnowlabs = LazyLoader("mlflow.johnsnowlabs", globals(), "mlflow.johnsnowlabs")
keras = LazyLoader("mlflow.keras", globals(), "mlflow.keras")
langchain = LazyLoader("mlflow.langchain", globals(), "mlflow.langchain")
lightgbm = LazyLoader("mlflow.lightgbm", globals(), "mlflow.lightgbm")
litellm = LazyLoader("mlflow.litellm", globals(), "mlflow.litellm")
llama_index = LazyLoader("mlflow.llama_index", globals(), "mlflow.llama_index")
llm = LazyLoader("mlflow.llm", globals(), "mlflow.llm")
metrics = LazyLoader("mlflow.metrics", globals(), "mlflow.metrics")
mistral = LazyLoader("mlflow.mistral", globals(), "mlflow.mistral")
onnx = LazyLoader("mlflow.onnx", globals(), "mlflow.onnx")
openai = LazyLoader("mlflow.openai", globals(), "mlflow.openai")
paddle = LazyLoader("mlflow.paddle", globals(), "mlflow.paddle")
pmdarima = LazyLoader("mlflow.pmdarima", globals(), "mlflow.pmdarima")
promptflow = LazyLoader("mlflow.promptflow", globals(), "mlflow.promptflow")
prophet = LazyLoader("mlflow.prophet", globals(), "mlflow.prophet")
pyfunc = LazyLoader("mlflow.pyfunc", globals(), "mlflow.pyfunc")
pyspark = LazyLoader("mlflow.pyspark", globals(), "mlflow.pyspark")
pytorch = LazyLoader("mlflow.pytorch", globals(), "mlflow.pytorch")
rfunc = LazyLoader("mlflow.rfunc", globals(), "mlflow.rfunc")
sentence_transformers = LazyLoader(
    "mlflow.sentence_transformers",
    globals(),
    "mlflow.sentence_transformers",
)
shap = LazyLoader("mlflow.shap", globals(), "mlflow.shap")
sklearn = LazyLoader("mlflow.sklearn", globals(), "mlflow.sklearn")
spacy = LazyLoader("mlflow.spacy", globals(), "mlflow.spacy")
spark = LazyLoader("mlflow.spark", globals(), "mlflow.spark")
statsmodels = LazyLoader("mlflow.statsmodels", globals(), "mlflow.statsmodels")
tensorflow = LazyLoader("mlflow.tensorflow", globals(), "mlflow.tensorflow")
# TxtAI integration is defined at https://github.com/neuml/mlflow-txtai
txtai = LazyLoader("mlflow.txtai", globals(), "mlflow_txtai")
transformers = LazyLoader("mlflow.transformers", globals(), "mlflow.transformers")
xgboost = LazyLoader("mlflow.xgboost", globals(), "mlflow.xgboost")

if TYPE_CHECKING:
    # Do not move this block above the lazy-loaded modules above.
    # All the lazy-loaded modules above must be imported here for code completion to work in IDEs.
    from mlflow import (  # noqa: F401
        anthropic,
        autogen,
        bedrock,
        catboost,
        crewai,
        diviner,
        dspy,
        gemini,
        groq,
        johnsnowlabs,
        keras,
        langchain,
        lightgbm,
        litellm,
        llama_index,
        llm,
        metrics,
        mistral,
        onnx,
        openai,
        paddle,
        pmdarima,
        promptflow,
        prophet,
        pyfunc,
        pyspark,
        pytorch,
        rfunc,
        sentence_transformers,
        shap,
        sklearn,
        spacy,
        spark,
        statsmodels,
        tensorflow,
        transformers,
        xgboost,
    )

if MLFLOW_CONFIGURE_LOGGING.get() is True:
    _configure_mlflow_loggers(root_module_name=__name__)

MlflowClient = lazy_load = LazyLoader("mlflow.client", globals(), "mlflow.client.MlflowClient")

# For backward compatibility, we expose the following functions and classes at the top level in
# addition to `mlflow.config`.

__all__ = []

def safe_import_functions(base_module: str, functions: list[str]):
    """Import functions from a module and add them to the exported functions list."""
    for function in functions:
        try:
            globals()[function] = getattr(importlib.import_module(base_module), function)
            __all__.append(function)
        except ImportError:
            pass


safe_import_functions(
    base_module="mlflow.config",
    functions=[
        "disable_system_metrics_logging",
        "enable_system_metrics_logging",
        "get_registry_uri",
        "get_tracking_uri",
        "is_tracking_uri_set",
        "set_registry_uri",
        "set_system_metrics_node_id",
        "set_system_metrics_samples_before_logging",
        "set_system_metrics_sampling_interval",
        "set_tracking_uri",
    ]
)

safe_import_functions(
    base_module="mlflow.models",
    functions=["evaluate"],
)

safe_import_functions(
    base_module="mlflow.models.evaluation.validation",
    functions=["validate_evaluation_results"],
)

safe_import_functions(
    base_module="mlflow.projects",
    functions=["run"],
)

safe_import_functions(
    base_module="mlflow.tracing.assessment",
    functions=[
        "delete_expectation",
        "delete_feedback",
        "log_expectation",
        "log_feedback",
        "update_expectation",
        "update_feedback",
    ],
)

safe_import_functions(
    base_module="mlflow.tracing.fluent",
    functions=[
        "add_trace",
        "get_current_active_span",
        "get_last_active_trace",
        "get_trace",
        "log_trace",
        "search_traces",
        "start_span",
        "trace",
        "update_current_trace",
    ]
)

safe_import_functions(
    base_module="mlflow.tracking._model_registry.fluent",
    functions=[
        "delete_prompt",
        "delete_prompt_alias",
        "load_prompt",
        "register_model",
        "register_prompt",
        "search_model_versions",
        "search_registered_models",
        "set_prompt_alias",
    ]
)

safe_import_functions(
    base_module="mlflow.tracking.fluent",
    functions=[
        "ActiveRun",
        "active_run",
        "autolog",
        "create_experiment",
        "create_external_model",
        "delete_experiment",
        "delete_logged_model_tag",
        "delete_run",
        "delete_tag",
        "end_run",
        "finalize_logged_model",
        "flush_artifact_async_logging",
        "flush_async_logging",
        "flush_trace_async_logging",
        "get_artifact_uri",
        "get_experiment",
        "get_experiment_by_name",
        "get_logged_model",
        "get_parent_run",
        "get_run",
        "last_active_run",
        "last_logged_model",
        "load_table",
        "log_artifact",
        "log_artifacts",
        "log_dict",
        "log_figure",
        "log_image",
        "log_input",
        "log_inputs",
        "log_metric",
        "log_metrics",
        "log_param",
        "log_params",
        "log_table",
        "log_text",
        "search_experiments",
        "search_logged_models",
        "search_runs",
        "set_experiment",
        "set_experiment_tag",
        "set_experiment_tags",
        "set_logged_model_tags",
        "set_tag",
        "set_tags",
        "start_run",
    ],
)

safe_import_functions(
    base_module="mlflow.tracking.multimedia",
    functions=["Image"],
)

safe_import_functions(
    base_module="mlflow.utils.credentials",
    functions=["login"],
)

safe_import_functions(
    base_module="mlflow.utils.doctor",
    functions=["doctor"],
)

# `mlflow.gateway` depends on optional dependencies such as pydantic, psutil, and has version
# restrictions for dependencies. Importing this module fails if they are not installed or
# if invalid versions of these required packages are installed.
with contextlib.suppress(Exception):
    from mlflow import gateway  # noqa: F401

    __all__.append("gateway")
