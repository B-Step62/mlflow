"""
Configuration module for MLflow tracing.
"""

import sys
from dataclasses import dataclass
from typing import Optional

from mlflow.environment_variables import MLFLOW_ENABLE_ASYNC_TRACE_LOGGING


@dataclass
class MlflowTracingConfig:
    """
    Configuration class for MLflow tracing behavior.

    This class holds configuration settings that control how MLflow tracing behaves.
    The settings are applied globally unless used as a context manager.

    Attributes:
        wait_for_logging: If True, traces will be logged synchronously and the function
            will block. Default is False.
        _record_current_config: Only used for internal initialization. If True, the current
            global config will be recorded and used to restore the config when the context
            manager is exited. Setting False when initializing global config for the first
            time to avoid circular dependency.
    """

    def __init__(
        self,
        wait_for_logging: Optional[bool] = None,
        display_on_notebook: bool = True,
        _record_current_config: bool = True,
    ):
        if _record_current_config:
            self._old_config = _ACTIVE_TRACING_CONFIG

        self.wait_for_logging = wait_for_logging or not MLFLOW_ENABLE_ASYNC_TRACE_LOGGING.get()
        self.display_on_notebook = display_on_notebook

    def to_dict(self):
        return {
            "wait_for_logging": self.wait_for_logging,
            "display_on_notebook": self.display_on_notebook,
        }

    def __enter__(self):
        # Save the current global config
        global _ACTIVE_TRACING_CONFIG
        _ACTIVE_TRACING_CONFIG = self
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        # Restore the previous global config
        global _ACTIVE_TRACING_CONFIG
        _ACTIVE_TRACING_CONFIG = self._old_config
        self._old_config = None


# Global configuration instance. Default to the environment variable.
_ACTIVE_TRACING_CONFIG = MlflowTracingConfig(_record_current_config=False)


def configure(
    wait_for_logging: Optional[bool] = None,
    display_on_notebook: Optional[bool] = None,
) -> MlflowTracingConfig:
    """
    Configure MLflow tracing behavior.

    This function can be used either as a regular function call to set global configuration,
    or as a context manager to temporarily override configuration settings.

    Args:
        wait_for_logging: If True, traces will be logged synchronously, and the traced
            function execution will block until the trace is logged. Default is False.
        display_on_notebook: If True, the MLflow Trace UI will be displayed in notebook
            output cells. The display is on by default, and the Trace UI will show up
            when any of the following operations are executed:

            * On trace completion (i.e. whenever a trace is exported)
            * When calling the :py:func:`mlflow.search_traces` fluent API
            * When calling the :py:meth:`mlflow.client.MlflowClient.get_trace`
            or :py:meth:`mlflow.client.MlflowClient.search_traces` client APIs

    Returns:
        A :py:class:`MlflowTracingConfig` object that can be used as a context manager.

    Example:

        .. code-block:: python

            # Make trace logging synchronous globally
            mlflow.tracing.configure(sync_logging=True)

            # Temporarily make trace logging asynchronous within this block
            with mlflow.tracing.configure(sync_logging=False):
                # Traces are logged asynchronously here
                with mlflow.start_span("my_span"):
                    pass

            # Outside the block, traces are logged with previous configuration

            # Reset the configuration to the default value.
            mlflow.tracing.reset_config()
    """
    global _ACTIVE_TRACING_CONFIG
    from mlflow.tracing.config import _ACTIVE_TRACING_CONFIG

    # Only mutate the config if the value is not None
    config_update = {}
    if wait_for_logging is not None:
        config_update["wait_for_logging"] = wait_for_logging
    if display_on_notebook is not None:
        config_update["display_on_notebook"] = display_on_notebook

    config = MlflowTracingConfig(
        **{
            **_ACTIVE_TRACING_CONFIG.to_dict(),
            **config_update,
        }
    )

    # If not used as context manager, set as global config
    frame = sys._getframe(1)
    if frame.f_code.co_name != "__enter__":
        _ACTIVE_TRACING_CONFIG = config

    return config


def get_config() -> MlflowTracingConfig:
    """
    Get the current MLflow tracing configuration.

    Returns:
        The current :py:class:`MlflowTracingConfig` object.
    """
    return _ACTIVE_TRACING_CONFIG


def reset_config() -> MlflowTracingConfig:
    """
    Reset the MLflow tracing configuration to the default value.

    Returns:
        The reset :py:class:`MlflowTracingConfig` object.
    """
    global _ACTIVE_TRACING_CONFIG

    default_config = MlflowTracingConfig(_record_current_config=False)
    _ACTIVE_TRACING_CONFIG = default_config
    return default_config
