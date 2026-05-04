from pathlib import Path
from unittest.mock import patch

from mlflow.claude_code.repo_inspect import (
    _gather_repo_files,
    _parse_claude_response,
    detect_with_claude,
    find_function_def_line,
    inspect_file,
    inspect_repo,
    scaffold_autolog,
    scaffold_decorator,
)


def _write(path: Path, content: str) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")
    return path


def test_detect_candidate_by_name(tmp_path: Path):
    f = _write(tmp_path / "agent.py", "def chat(req):\n    return 'hi'\n")
    result = inspect_file(f)
    assert result is not None
    assert len(result.candidates) == 1
    assert result.candidates[0].function_name == "chat"
    assert not result.has_invoke_decorator


def test_detect_candidate_by_param(tmp_path: Path):
    f = _write(
        tmp_path / "agent.py", "def respond_to(messages):\n    return messages[-1]\n"
    )
    result = inspect_file(f)
    assert len(result.candidates) == 1
    assert result.candidates[0].function_name == "respond_to"


def test_detect_existing_invoke_decorator(tmp_path: Path):
    src = (
        "from mlflow.genai.agent_server import invoke\n\n"
        "@invoke()\n"
        "def chat(req):\n"
        "    return 'hi'\n"
    )
    f = _write(tmp_path / "agent.py", src)
    result = inspect_file(f)
    assert result.has_invoke_decorator is True
    assert result.candidates == []


def test_detect_framework_imports(tmp_path: Path):
    f = _write(
        tmp_path / "agent.py",
        "from langchain_core.messages import HumanMessage\n\ndef chat(req):\n    pass\n",
    )
    result = inspect_file(f)
    assert "langchain" in result.frameworks
    assert "langchain" not in result.autologged_frameworks


def test_detect_existing_autolog_call(tmp_path: Path):
    src = (
        "import mlflow\n"
        "import langchain\n\n"
        "mlflow.langchain.autolog()\n\n"
        "def chat(req):\n"
        "    pass\n"
    )
    f = _write(tmp_path / "agent.py", src)
    result = inspect_file(f)
    assert "langchain" in result.autologged_frameworks


def test_inspect_repo_skips_dirs(tmp_path: Path):
    _write(tmp_path / ".venv" / "lib" / "fake.py", "def chat(x): pass\n")
    _write(tmp_path / "node_modules" / "deep" / "x.py", "def chat(x): pass\n")
    _write(tmp_path / "agent.py", "def chat(req): pass\n")
    inspection = inspect_repo(tmp_path)
    files = [f.file.name for f in inspection.files]
    assert files == ["agent.py"]


def test_scaffold_decorator_writes_backup_and_patches(tmp_path: Path):
    src = "def chat(req):\n    return 'hi'\n"
    f = _write(tmp_path / "agent.py", src)
    inspection = inspect_file(f)
    assert len(inspection.candidates) == 1

    patched = scaffold_decorator(inspection.candidates[0])
    assert patched is True

    new_src = f.read_text()
    assert "from mlflow.genai.agent_server import invoke" in new_src
    assert "@invoke()" in new_src
    backup = f.with_suffix(".py.bak")
    assert backup.exists()
    assert backup.read_text() == src


def test_scaffold_decorator_idempotent(tmp_path: Path):
    src = "def chat(req):\n    return 'hi'\n"
    f = _write(tmp_path / "agent.py", src)
    candidate = inspect_file(f).candidates[0]

    assert scaffold_decorator(candidate) is True
    # Re-inspecting a patched file should report no candidates and has_invoke_decorator
    re_inspection = inspect_file(f)
    assert re_inspection.has_invoke_decorator is True
    assert re_inspection.candidates == []


def test_scaffold_autolog_adds_call_and_import(tmp_path: Path):
    src = "from langchain_core.messages import HumanMessage\n\ndef chat(req):\n    return req\n"
    f = _write(tmp_path / "agent.py", src)
    inspection = inspect_file(f)
    assert "langchain" in inspection.frameworks
    assert "langchain" not in inspection.autologged_frameworks

    patched = scaffold_autolog(inspection, "langchain")
    assert patched is True
    new_src = f.read_text()
    assert "import mlflow" in new_src
    assert "mlflow.langchain.autolog()" in new_src


def test_scaffold_autolog_idempotent(tmp_path: Path):
    src = (
        "import mlflow\n"
        "from langchain_core.messages import HumanMessage\n\n"
        "mlflow.langchain.autolog()\n\n"
        "def chat(req):\n"
        "    return req\n"
    )
    f = _write(tmp_path / "agent.py", src)
    inspection = inspect_file(f)
    assert "langchain" in inspection.autologged_frameworks
    # Don't even attempt — the autolog_targets() call in the wizard filters this out
    # but a direct call should still no-op:
    patched = scaffold_autolog(inspection, "langchain")
    assert patched is False


def test_inspect_repo_invariants_for_inspection_view(tmp_path: Path):
    _write(
        tmp_path / "a.py",
        "from mlflow.genai.agent_server import invoke\n\n@invoke()\ndef chat(req): pass\n",
    )
    _write(tmp_path / "b.py", "def chat(req): pass\n")
    _write(tmp_path / "c.py", "import langchain\n\ndef helper(): pass\n")
    inspection = inspect_repo(tmp_path)
    # Decorator candidates exclude already-decorated files entirely
    cand_files = sorted(c.file.name for c in inspection.decorator_candidates)
    assert cand_files == ["b.py"]
    # Autolog targets identify framework imports without an autolog call
    targets = inspection.autolog_targets()
    target_files = sorted(t[0].file.name for t in targets)
    assert target_files == ["c.py"]


def test_find_function_def_line(tmp_path: Path):
    f = _write(tmp_path / "agent.py", "import os\n\n\ndef chat(req):\n    return req\n")
    assert find_function_def_line(f, "chat") == 4
    assert find_function_def_line(f, "missing") is None


def test_parse_claude_response_valid(tmp_path: Path):
    _write(tmp_path / "agent.py", "def chat(messages): pass\n")
    result = _parse_claude_response(
        '{"file": "agent.py", "function": "chat", "framework": "openai"}', tmp_path
    )
    assert result is not None
    assert result.entrypoint_function == "chat"
    assert result.framework == "openai"
    assert result.entrypoint_file == (tmp_path / "agent.py").resolve()


def test_parse_claude_response_extracts_json_from_prose(tmp_path: Path):
    _write(tmp_path / "agent.py", "def chat(messages): pass\n")
    result = _parse_claude_response(
        'Here is the answer:\n{"file": "agent.py", "function": "chat", "framework": null}\nDone.',
        tmp_path,
    )
    assert result is not None and result.framework is None


def test_parse_claude_response_error_sentinel_returns_none(tmp_path: Path):
    assert _parse_claude_response('{"error": "no clear entrypoint"}', tmp_path) is None


def test_parse_claude_response_unknown_framework_nulled(tmp_path: Path):
    _write(tmp_path / "agent.py", "def chat(messages): pass\n")
    result = _parse_claude_response(
        '{"file": "agent.py", "function": "chat", "framework": "made-up-framework"}',
        tmp_path,
    )
    assert result is not None and result.framework is None


def test_parse_claude_response_missing_file_returns_none(tmp_path: Path):
    result = _parse_claude_response(
        '{"file": "nope.py", "function": "chat", "framework": "openai"}', tmp_path
    )
    assert result is None


def test_gather_repo_files_skips_skip_dirs(tmp_path: Path):
    _write(tmp_path / "agent.py", "x = 1\n")
    _write(tmp_path / ".venv" / "lib" / "fake.py", "x = 2\n")
    _write(tmp_path / "node_modules" / "deep.py", "x = 3\n")
    files = _gather_repo_files(tmp_path, max_bytes=10_000)
    rels = [str(rel) for rel, _ in files]
    assert rels == ["agent.py"]


def test_detect_with_claude_returns_none_when_claude_missing(tmp_path: Path):
    _write(tmp_path / "agent.py", "def chat(messages): pass\n")
    with patch("mlflow.claude_code.repo_inspect.shutil.which", return_value=None):
        assert detect_with_claude(tmp_path) is None


def test_detect_with_claude_end_to_end_with_mocked_subprocess(tmp_path: Path):
    _write(tmp_path / "agent.py", "def chat(messages): pass\n")

    class FakeResult:
        returncode = 0
        stdout = '{"file": "agent.py", "function": "chat", "framework": "openai"}'
        stderr = ""

    with (
        patch(
            "mlflow.claude_code.repo_inspect.shutil.which",
            return_value="/usr/bin/claude",
        ),
        patch(
            "mlflow.claude_code.repo_inspect.subprocess.run", return_value=FakeResult()
        ) as mock_run,
    ):
        result = detect_with_claude(tmp_path)
    assert result is not None
    assert result.entrypoint_function == "chat"
    assert result.framework == "openai"
    mock_run.assert_called_once()


def test_detect_with_claude_returns_none_on_subprocess_error(tmp_path: Path):
    import subprocess as sp

    _write(tmp_path / "agent.py", "def chat(messages): pass\n")
    with (
        patch(
            "mlflow.claude_code.repo_inspect.shutil.which",
            return_value="/usr/bin/claude",
        ),
        patch(
            "mlflow.claude_code.repo_inspect.subprocess.run",
            side_effect=sp.TimeoutExpired(cmd="claude", timeout=90),
        ),
    ):
        assert detect_with_claude(tmp_path) is None
