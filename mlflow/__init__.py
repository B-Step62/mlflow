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
from typing import TYPE_CHECKING

from mlflow.version import VERSION, is_mlflow_skinny_installed

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

# For backward compatibility, we expose the following functions and classes at the top level in
# addition to `mlflow.config`.

# Only import following modules if the full mlflow/mlflow-skinny is installed

# Check if the `mlflow` package is installed

assert is_mlflow_skinny_installed() is False

from mlflow.tracing.api import (
    add_trace,
    get_current_active_span,
    get_last_active_trace_id,
    get_trace,
    log_trace,
    search_traces,
    start_span,
    trace,
    update_current_trace,
    start_detached_span
)
from mlflow.tracing.assessment import (
    delete_expectation,
    delete_feedback,
    log_expectation,
    log_feedback,
    update_expectation,
    update_feedback,
)
from mlflow.tracking import (
    set_tracking_uri,
    get_tracking_uri,
    is_tracking_uri_set,
)
from mlflow.tracking.fluent import flush_trace_async_logging
from mlflow.tracking.fluent import set_experiment


# These are minimal set of APIs to be exposed via `mlflow-trace` package.
# APIs listed here must not depend on dependencies that are not part of `mlflow-trace` package.
__all__ = [
    "MlflowException",
    "autolog",
    # Minimal tracking APIs required for tracing core functionality
    "get_tracking_uri",
    "is_tracking_uri_set",
    "set_experiment",
    "set_tracking_uri",
    # Tracing APIs
    "flush_trace_async_logging",
    "get_last_active_trace",
    "get_last_active_trace_id",
    "get_current_active_span",
    "start_span",
    "trace",
    "add_trace",
    "get_trace",
    "search_traces",
    "log_trace",
    "update_current_trace",
    "start_detached_span",
    # Assessment APIs
    "delete_expectation",
    "delete_feedback",
    "log_expectation",
    "log_feedback",
    "update_expectation",
    "update_feedback",
]

if is_mlflow_skinny_installed():
    from mlflow.client import MlflowClient

    # For backward compatibility, we expose the following functions and classes at the top level in
    # addition to `mlflow.config`.
    from mlflow.config import (
        disable_system_metrics_logging,
        enable_system_metrics_logging,
        get_registry_uri,
        set_registry_uri,
        set_system_metrics_node_id,
        set_system_metrics_samples_before_logging,
        set_system_metrics_sampling_interval,
    )
    from mlflow.exceptions import MlflowException
    from mlflow.models import evaluate
    from mlflow.models.evaluation.validation import validate_evaluation_results
    from mlflow.projects import run
    from mlflow.tracking._model_registry.fluent import (
        delete_prompt,
        delete_prompt_alias,
        load_prompt,
        register_model,
        register_prompt,
        search_model_versions,
        search_registered_models,
        set_prompt_alias,
    )
    from mlflow.tracking.fluent import (
        ActiveRun,
        active_run,
        create_experiment,
        delete_experiment,
        delete_run,
        delete_tag,
        end_run,
        flush_artifact_async_logging,
        flush_async_logging,
        get_artifact_uri,
        get_experiment,
        get_experiment_by_name,
        get_parent_run,
        get_run,
        last_active_run,
        load_table,
        log_artifact,
        log_artifacts,
        log_dict,
        log_figure,
        log_image,
        log_input,
        log_metric,
        log_metrics,
        log_param,
        log_params,
        log_table,
        log_text,
        search_experiments,
        search_runs,
        set_experiment_tag,
        set_experiment_tags,
        set_tag,
        set_tags,
        start_run,
    )
    from mlflow.tracking.multimedia import Image
    from mlflow.utils.async_logging.run_operations import RunOperations  # noqa: F401
    from mlflow.utils.credentials import login
    from mlflow.utils.doctor import doctor

    __all__.extend([
        "ActiveRun",
        "MlflowClient",
        "active_run",
        "create_experiment",
        "delete_experiment",
        "delete_run",
        "delete_tag",
        "disable_system_metrics_logging",
        "doctor",
        "enable_system_metrics_logging",
        "end_run",
        "evaluate",
        "flush_async_logging",
        "flush_artifact_async_logging",
        "get_artifact_uri",
        "get_experiment",
        "get_experiment_by_name",
        "get_parent_run",
        "get_registry_uri",
        "get_run",
        "is_tracking_uri_set",
        "last_active_run",
        "load_table",
        "log_artifact",
        "log_artifacts",
        "log_dict",
        "log_figure",
        "log_image",
        "log_input",
        "log_metric",
        "log_metrics",
        "log_param",
        "log_params",
        "log_table",
        "log_text",
        "login",
        "pyfunc",
        "register_model",
        "run",
        "search_experiments",
        "search_model_versions",
        "search_registered_models",
        "search_runs",
        "set_experiment_tag",
        "set_experiment_tags",
        "set_registry_uri",
        "set_system_metrics_node_id",
        "set_system_metrics_samples_before_logging",
        "set_system_metrics_sampling_interval",
        "set_tag",
        "set_tags",
        "start_run",
        "validate_evaluation_results",
        "Image",
        # Prompt Registry APIs
        "delete_prompt",
        "load_prompt",
        "register_prompt",
        "set_prompt_alias",
        "delete_prompt_alias",
    ])


# `mlflow.gateway` depends on optional dependencies such as pydantic, psutil, and has version
# restrictions for dependencies. Importing this module fails if they are not installed or
# if invalid versions of these required packages are installed.
with contextlib.suppress(Exception):
    from mlflow import gateway  # noqa: F401

    __all__.append("gateway")
