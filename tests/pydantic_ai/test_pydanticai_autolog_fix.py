"""
Test to ensure pydantic_ai autolog doesn't try to patch non-existent Tool.run method
"""

from unittest.mock import patch

import pytest
from pydantic_ai import Tool

import mlflow
import mlflow.pydantic_ai


@pytest.fixture(autouse=True)
def clear_autolog_state():
    """Clear autolog state before each test"""
    from mlflow.utils.autologging_utils import AUTOLOGGING_INTEGRATIONS

    for key in AUTOLOGGING_INTEGRATIONS.keys():
        AUTOLOGGING_INTEGRATIONS[key].clear()
    mlflow.utils.import_hooks._post_import_hooks = {}


def test_autolog_does_not_patch_nonexistent_tool_run():
    """
    Test that autolog doesn't attempt to patch Tool.run which doesn't exist
    in pydantic_ai 0.7.x - after the fix, this should not cause any errors
    """
    # Verify Tool doesn't have a run method
    assert not hasattr(Tool, "run"), "Tool should not have a run method"

    # Capture logs to check NO error is logged
    with patch("mlflow.pydantic_ai._logger") as mock_logger:
        # Enable autolog
        mlflow.pydantic_ai.autolog(log_traces=True)

        # Check that NO error was logged about Tool.run
        error_calls = [
            call for call in mock_logger.error.call_args_list if "pydantic_ai.Tool.run" in str(call)
        ]
        assert len(error_calls) == 0, "Should NOT log any errors about Tool.run after fix"


def test_autolog_patches_valid_methods():
    """
    Test that autolog successfully patches methods that do exist
    """
    # Mock the safe_patch to track what gets patched
    with patch("mlflow.pydantic_ai.safe_patch") as mock_safe_patch:
        mlflow.pydantic_ai.autolog(log_traces=True)

        # Get all the method names that were attempted to be patched
        patched_methods = []
        for call in mock_safe_patch.call_args_list:
            if len(call[0]) >= 3:
                cls = call[0][1]
                method_name = call[0][2]
                patched_methods.append(f"{cls.__module__}.{cls.__name__}.{method_name}")

        # Tool.run should NOT be in the list of successfully patched methods
        # because it doesn't exist
        assert "pydantic_ai.tools.Tool.run" not in patched_methods

        # But other methods should be patched
        # Agent.run and run_sync should be patched

        agent_patches = [m for m in patched_methods if "Agent" in m]
        assert len(agent_patches) > 0, "Agent methods should be patched"


def test_autolog_configuration_without_tool_run():
    """
    Test that the autolog configuration should not include Tool.run
    """
    import inspect
    
    from mlflow.pydantic_ai import autolog

    # This test verifies the fix: Tool.run should be removed from the class_map
    # Get the source code of the autolog function
    source = inspect.getsource(autolog)

    # Check if Tool.run is mentioned in the configuration
    # After the fix, this should not be present
    if '"pydantic_ai.Tool": ["run"]' in source:
        pytest.fail(
            "autolog still tries to patch Tool.run - this needs to be removed from class_map"
        )
