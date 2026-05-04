from pathlib import Path

from mlflow.claude_code.repo_inspect import (
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
    f = _write(tmp_path / "agent.py", "def respond_to(messages):\n    return messages[-1]\n")
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
