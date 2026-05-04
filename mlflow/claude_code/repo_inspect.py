"""Repo inspection and `@invoke` / autolog scaffolding for the Agent Playground."""

import ast
import re
import shutil
from dataclasses import dataclass, field
from pathlib import Path

AGENT_FUNC_NAMES = frozenset({
    "chat",
    "invoke",
    "run",
    "predict",
    "agent",
    "ask",
    "complete",
    "respond",
    "call",
})
AGENT_PARAM_NAMES = frozenset({
    "messages",
    "message",
    "query",
    "prompt",
    "request",
    "req",
    "input",
    "inputs",
})

FRAMEWORK_IMPORT_PATTERNS = {
    "langchain": ("langchain", "langchain_core", "langchain_community"),
    "langgraph": ("langgraph",),
    "openai": ("openai",),
    "anthropic": ("anthropic",),
    "llama_index": ("llama_index",),
    "dspy": ("dspy",),
    "crewai": ("crewai",),
    "autogen": ("autogen", "autogen_agentchat", "autogen_core"),
}

SKIP_DIRS = frozenset({
    ".venv",
    "venv",
    "node_modules",
    ".git",
    "__pycache__",
    "dist",
    "build",
    ".tox",
})
SKIP_DIR_PREFIXES = (".",)  # also skip dot-dirs like .pytest_cache


@dataclass
class FunctionCandidate:
    file: Path
    function_name: str
    line_no: int


@dataclass
class FileInspection:
    file: Path
    has_invoke_decorator: bool
    candidates: list[FunctionCandidate] = field(default_factory=list)
    frameworks: set[str] = field(default_factory=set)
    autologged_frameworks: set[str] = field(default_factory=set)


@dataclass
class RepoInspection:
    repo_dir: Path
    files: list[FileInspection] = field(default_factory=list)

    @property
    def decorator_candidates(self) -> list[FunctionCandidate]:
        return [c for f in self.files for c in f.candidates if not f.has_invoke_decorator]

    def autolog_targets(self) -> list[tuple[FileInspection, str]]:
        return [
            (f, fw) for f in self.files for fw in f.frameworks if fw not in f.autologged_frameworks
        ]


def _should_skip(rel_path: Path) -> bool:
    for part in rel_path.parts:
        if part in SKIP_DIRS or any(part.startswith(p) and part != "." for p in SKIP_DIR_PREFIXES):
            return True
    return False


def _detect_frameworks(tree: ast.Module) -> set[str]:
    found: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                for fw, prefixes in FRAMEWORK_IMPORT_PATTERNS.items():
                    if any(alias.name == p or alias.name.startswith(p + ".") for p in prefixes):
                        found.add(fw)
        elif isinstance(node, ast.ImportFrom) and node.module:
            for fw, prefixes in FRAMEWORK_IMPORT_PATTERNS.items():
                if any(node.module == p or node.module.startswith(p + ".") for p in prefixes):
                    found.add(fw)
    return found


def _has_invoke_decorator(node: ast.FunctionDef | ast.AsyncFunctionDef) -> bool:
    for d in node.decorator_list:
        target = d.func if isinstance(d, ast.Call) else d
        if isinstance(target, ast.Name) and target.id in ("invoke", "stream"):
            return True
        if isinstance(target, ast.Attribute) and target.attr in ("invoke", "stream"):
            return True
    return False


def _is_candidate_function(node: ast.FunctionDef | ast.AsyncFunctionDef) -> bool:
    if node.name in AGENT_FUNC_NAMES:
        return True
    arg_names = {a.arg for a in node.args.args}
    return bool(arg_names & AGENT_PARAM_NAMES)


def _autologged_frameworks(tree: ast.Module) -> set[str]:
    found: set[str] = set()
    for node in tree.body:
        if isinstance(node, ast.Expr) and isinstance(node.value, ast.Call):
            call = node.value
            if (
                isinstance(call.func, ast.Attribute)
                and call.func.attr == "autolog"
                and isinstance(call.func.value, ast.Attribute)
                and call.func.value.attr in FRAMEWORK_IMPORT_PATTERNS
            ):
                found.add(call.func.value.attr)
    return found


def inspect_file(path: Path) -> FileInspection | None:
    try:
        source = path.read_text(encoding="utf-8")
        tree = ast.parse(source, filename=str(path))
    except (SyntaxError, UnicodeDecodeError, OSError):
        return None

    candidates: list[FunctionCandidate] = []
    has_invoke = False
    for node in tree.body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            if _has_invoke_decorator(node):
                has_invoke = True
            elif _is_candidate_function(node):
                candidates.append(
                    FunctionCandidate(file=path, function_name=node.name, line_no=node.lineno)
                )

    return FileInspection(
        file=path,
        has_invoke_decorator=has_invoke,
        candidates=candidates,
        frameworks=_detect_frameworks(tree),
        autologged_frameworks=_autologged_frameworks(tree),
    )


def inspect_repo(repo_dir: Path) -> RepoInspection:
    inspection = RepoInspection(repo_dir=repo_dir)
    for py_file in sorted(repo_dir.rglob("*.py")):
        rel = py_file.relative_to(repo_dir)
        if _should_skip(rel):
            continue
        result = inspect_file(py_file)
        if result is None:
            continue
        if result.candidates or result.frameworks or result.has_invoke_decorator:
            inspection.files.append(result)
    return inspection


def _last_import_index(lines: list[str]) -> int:
    last = -1
    for i, line in enumerate(lines):
        stripped = line.strip()
        if stripped.startswith(("import ", "from ")) and not stripped.startswith("#"):
            last = i
    return last


def _backup(path: Path) -> Path:
    backup_path = path.with_suffix(path.suffix + ".bak")
    if not backup_path.exists():
        shutil.copy2(path, backup_path)
    return backup_path


def scaffold_decorator(candidate: FunctionCandidate) -> bool:
    source = candidate.file.read_text(encoding="utf-8")
    tree = ast.parse(source)
    for node in tree.body:
        if (
            isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
            and node.name == candidate.function_name
            and _has_invoke_decorator(node)
        ):
            return False

    lines = source.splitlines(keepends=True)
    def_line_idx = candidate.line_no - 1
    if def_line_idx >= len(lines):
        return False
    indent_match = re.match(r"^(\s*)", lines[def_line_idx])
    indent = indent_match.group(1) if indent_match else ""

    _backup(candidate.file)

    lines.insert(def_line_idx, f"{indent}@invoke()\n")

    if "from mlflow.genai.agent_server import invoke" not in source:
        last_import = _last_import_index(lines)
        insert_at = last_import + 1 if last_import >= 0 else 0
        lines.insert(insert_at, "from mlflow.genai.agent_server import invoke\n")

    candidate.file.write_text("".join(lines), encoding="utf-8")
    return True


def scaffold_autolog(file_inspection: FileInspection, framework: str) -> bool:
    source = file_inspection.file.read_text(encoding="utf-8")
    tree = ast.parse(source)
    if framework in _autologged_frameworks(tree):
        return False

    lines = source.splitlines(keepends=True)
    _backup(file_inspection.file)

    last_import = _last_import_index(lines)
    insert_at = last_import + 1 if last_import >= 0 else 0

    extra: list[str] = []
    if not re.search(r"^\s*import mlflow\b", source, re.MULTILINE):
        extra.append("import mlflow\n")
    extra.append("\n")
    extra.append(f"mlflow.{framework}.autolog()\n")

    for offset, line in enumerate(extra):
        lines.insert(insert_at + offset, line)

    file_inspection.file.write_text("".join(lines), encoding="utf-8")
    return True
