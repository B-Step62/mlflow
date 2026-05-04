from pathlib import Path
from unittest.mock import patch

from mlflow.claude_code.repo_inspect import INSTRUMENT_PROMPT, instrument_with_claude


def test_instrument_with_claude_returns_none_when_claude_missing(tmp_path: Path):
    with patch("mlflow.claude_code.repo_inspect.shutil.which", return_value=None):
        assert instrument_with_claude(tmp_path) is None


def test_instrument_with_claude_invokes_subprocess_in_repo_dir(tmp_path: Path):
    class FakeResult:
        returncode = 0

    with (
        patch(
            "mlflow.claude_code.repo_inspect.shutil.which",
            return_value="/usr/bin/claude",
        ),
        patch(
            "mlflow.claude_code.repo_inspect.subprocess.run",
            return_value=FakeResult(),
        ) as mock_run,
    ):
        rc = instrument_with_claude(tmp_path)

    assert rc == 0
    mock_run.assert_called_once()
    args, kwargs = mock_run.call_args
    cmd = args[0]
    assert cmd[0] == "claude"
    assert cmd[1] == "-p"
    assert cmd[2] == INSTRUMENT_PROMPT
    assert kwargs["cwd"] == tmp_path
    assert kwargs["check"] is False


def test_instrument_with_claude_returns_none_on_timeout(tmp_path: Path):
    import subprocess as sp

    with (
        patch(
            "mlflow.claude_code.repo_inspect.shutil.which",
            return_value="/usr/bin/claude",
        ),
        patch(
            "mlflow.claude_code.repo_inspect.subprocess.run",
            side_effect=sp.TimeoutExpired(cmd="claude", timeout=600),
        ),
    ):
        assert instrument_with_claude(tmp_path) is None


def test_instrument_with_claude_returns_none_on_os_error(tmp_path: Path):
    with (
        patch(
            "mlflow.claude_code.repo_inspect.shutil.which",
            return_value="/usr/bin/claude",
        ),
        patch(
            "mlflow.claude_code.repo_inspect.subprocess.run",
            side_effect=OSError("boom"),
        ),
    ):
        assert instrument_with_claude(tmp_path) is None


def test_instrument_with_claude_propagates_nonzero_exit(tmp_path: Path):
    class FakeResult:
        returncode = 2

    with (
        patch(
            "mlflow.claude_code.repo_inspect.shutil.which",
            return_value="/usr/bin/claude",
        ),
        patch(
            "mlflow.claude_code.repo_inspect.subprocess.run",
            return_value=FakeResult(),
        ),
    ):
        assert instrument_with_claude(tmp_path) == 2


def test_instrument_prompt_mentions_key_concepts():
    # The Playground-specific bits (@invoke + entrypoint @mlflow.trace) must be
    # explicit because no public skill covers them. Tracing details are delegated
    # to the `instrumenting-with-mlflow-tracing` skill.
    assert "@invoke" in INSTRUMENT_PROMPT
    assert "@mlflow.trace" in INSTRUMENT_PROMPT
    assert "instrumenting-with-mlflow-tracing" in INSTRUMENT_PROMPT
