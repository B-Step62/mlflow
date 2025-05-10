import importlib

import pytest

import mlflow
from mlflow.environment_variables import MLFLOW_ENABLE_ASYNC_TRACE_LOGGING
from mlflow.tracing.config import configure, get_config, reset_config


@pytest.fixture(autouse=True)
def reset_config_fixture():
    yield
    reset_config()


@pytest.mark.parametrize("async_logging_env_var", [True, False])
def test_config_default_values(async_logging_env_var, monkeypatch):
    monkeypatch.setenv(MLFLOW_ENABLE_ASYNC_TRACE_LOGGING.name, str(async_logging_env_var))

    # Reload the module to reflect the environment variable change
    importlib.reload(mlflow.tracing.config)

    assert get_config().wait_for_logging is not async_logging_env_var
    assert get_config().display_on_notebook is True


def test_configure_global():
    configure(
        wait_for_logging=True,
        display_on_notebook=False,
    )
    assert get_config().wait_for_logging is True
    assert get_config().display_on_notebook is False

    # Updating config value.
    # Only specified value should be updated, other values should remain the same.
    configure(wait_for_logging=False)
    assert get_config().wait_for_logging is False
    assert get_config().display_on_notebook is False

    # Updating with context manager.
    with configure(wait_for_logging=True):
        assert get_config().wait_for_logging is True
        assert get_config().display_on_notebook is False

    assert get_config().wait_for_logging is False
    assert get_config().display_on_notebook is False

    # Reset to default
    reset_config()
    assert get_config().wait_for_logging is False
    assert get_config().display_on_notebook is True
