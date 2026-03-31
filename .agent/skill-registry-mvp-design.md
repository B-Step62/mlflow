# Skill Registry MVP — Design Document

**Author**: Yuki Watanabe  
**Date**: 2026-03-31  
**Branch**: `skill-registry-mvp`  
**Deadline**: April 3rd, 2026  

---

## 1. Overview

MLflow needs a Skill Registry to version-manage "agent skills" — callable tools, workflow steps, and coding assistants defined by SKILL.md manifest files. The MVP enables users to:

1. **Register** skills from GitHub repos or local directories
2. **Browse** registered skills in the MLflow UI
3. **Install** skills to Claude Code with version tracking
4. **Connect** installed skills to MLflow traces

**Namespace**: `mlflow.genai.register_skill()`, `mlflow.genai.load_skill()`, etc.  
**Architecture**: Dedicated database tables (not reusing Model Registry).

---

## 2. Skill ↔ Trace Connection

### 2.1 The Problem

Skills are installed locally (e.g., `~/.claude/skills/copilot/SKILL.md`). Once installed, the link to MLflow registry metadata (version, source, etc.) is lost. When Claude Code uses a skill, the trace captures only the skill name — not which version or where it came from.

### 2.2 How Claude Code Traces Capture Skills Today

From `mlflow/claude_code/tracing.py`, the Claude Code transcript contains three entries per skill invocation:

**1. Tool use** (assistant message):
```json
{
  "type": "tool_use",
  "id": "toolu_abc123",
  "name": "Skill",
  "input": {"skill": "copilot"}
}
```

**2. Tool result** (user message):
```json
{
  "type": "user",
  "toolUseResult": {"success": true, "commandName": "copilot"},
  "message": {
    "content": [{"type": "tool_result", "tool_use_id": "toolu_abc123", "content": "Launching skill: copilot"}]
  }
}
```

**3. Skill content injection** (user message — full SKILL.md body injected into LLM context):
```json
{
  "type": "user",
  "message": {
    "content": [{"type": "text", "text": "Base directory for this skill: /path\n\n# Copilot\n\n..."}]
  }
}
```

Current tracing creates a span `tool_Skill` with attributes `tool_name: "Skill"` and `tool_id`. The actual skill name (`"copilot"`) is buried in the input dict. No version or registry info is captured.

### 2.3 Solution: Metadata Sidecar + Tracing Enhancement

**Step 1: Embed metadata at install time**

When `mlflow.genai.install_skill()` writes skill files to `.claude/skills/{name}/`, it also writes a metadata sidecar:

```
~/.claude/skills/copilot/
├── SKILL.md              # Original skill content
├── .mlflow_skill_info    # JSON metadata sidecar
└── scripts/              # (other skill files)
```

`.mlflow_skill_info` contents:
```json
{
  "name": "copilot",
  "version": 3,
  "source": "https://github.com/mlflow/skills",
  "tracking_uri": "http://localhost:5000",
  "installed_at": "2026-03-31T10:00:00Z"
}
```

**Step 2: Enhance tracing to read sidecar**

In `mlflow/claude_code/tracing.py` `_create_llm_and_tool_spans()` (~line 466), when a tool span has `name == "Skill"`:

1. Extract skill name from `tool_use["input"]["skill"]`
2. Search for `.mlflow_skill_info` in:
   - `~/.claude/skills/{skill_name}/`  (global)
   - `.claude/skills/{skill_name}/`  (project-level)
3. If found, enrich span attributes:
   ```python
   attributes = {
       "tool_name": "Skill",
       "skill_name": "copilot",
       "skill_version": 3,
       "skill_source": "https://github.com/mlflow/skills",
   }
   ```
4. Rename span from `tool_Skill` to `tool_Skill:copilot`

**Why this works:**
- **No runtime dependency** — skills work offline, sidecar is just metadata
- **Transparent** — doesn't modify the skill itself
- **Survives reinstall** — each `install_skill()` updates the sidecar
- **Handles unregistered skills** — skills without `.mlflow_skill_info` trace normally, just without version info

---

## 3. Database Schema

### 3.1 `registered_skills` — one row per skill name

| Column | Type | Notes |
|--------|------|-------|
| `name` | VARCHAR(255) | PK, skill name from SKILL.md |
| `description` | TEXT | From SKILL.md front matter |
| `creation_timestamp` | BIGINT | millis since epoch |
| `last_updated_timestamp` | BIGINT | millis since epoch |

### 3.2 `skill_versions` — one row per version

| Column | Type | Notes |
|--------|------|-------|
| `name` | VARCHAR(255) | FK → registered_skills(name), CASCADE |
| `version` | INTEGER | auto-incremented per skill |
| `source` | TEXT | GitHub URL or local path |
| `description` | TEXT | version-specific |
| `manifest_content` | TEXT | full SKILL.md content |
| `run_id` | VARCHAR(32) | MLflow run for artifact storage |
| `creation_timestamp` | BIGINT | millis since epoch |
| **PK** | `(name, version)` | |

### 3.3 `skill_version_tags`

| Column | Type | Notes |
|--------|------|-------|
| `name` | VARCHAR(255) | |
| `version` | INTEGER | |
| `key` | VARCHAR(255) | |
| `value` | VARCHAR(5000) | |
| **PK** | `(name, version, key)` | |
| **FK** | `(name, version)` → skill_versions, CASCADE | |

### 3.4 `skill_aliases` — e.g., "champion" → version 3

| Column | Type | Notes |
|--------|------|-------|
| `name` | VARCHAR(255) | FK → registered_skills(name), CASCADE |
| `alias` | VARCHAR(255) | |
| `version` | INTEGER | target version |
| **PK** | `(name, alias)` | |

### 3.5 Artifact Storage

Skill bundles (SKILL.md + scripts/ + associated files) are stored as MLflow run artifacts. For each skill version, a hidden run is created in a system experiment (`_mlflow_skill_artifacts`), and the skill directory is logged as artifacts. The `run_id` on `skill_versions` enables `MlflowClient().download_artifacts(run_id, ...)` for retrieval.

---

## 4. SDK API

All under `mlflow.genai`:

```python
# Register
mlflow.genai.register_skill(source: str, tags: dict | None = None) -> list[SkillVersion]

# Load / Search
mlflow.genai.load_skill(name: str, version: int | None = None, alias: str | None = None) -> SkillVersion
mlflow.genai.search_skills(filter_string: str | None = None, max_results: int = 100) -> list[Skill]

# Tags
mlflow.genai.set_skill_tag(name: str, version: int, key: str, value: str) -> None
mlflow.genai.delete_skill_tag(name: str, version: int, key: str) -> None

# Aliases
mlflow.genai.set_skill_alias(name: str, alias: str, version: int) -> None
mlflow.genai.delete_skill_alias(name: str, alias: str) -> None

# Delete
mlflow.genai.delete_skill(name: str) -> None
mlflow.genai.delete_skill_version(name: str, version: int) -> None

# Install to Claude Code
mlflow.genai.install_skill(
    name: str,
    version: int | None = None,
    alias: str | None = None,
    scope: Literal["global", "project"] = "global",
    project_path: Path | None = None,
) -> Path
```

### 4.1 `register_skill()` Flow

1. If `source` is a GitHub URL → `fetch_from_github()` downloads repo tarball to tempdir
2. If local path → use directly
3. Find all SKILL.md files via `_find_skill_directories()`
4. For each skill directory:
   a. Parse SKILL.md front matter → extract `name`, `description`
   b. Create hidden MLflow run (in system experiment `_mlflow_skill_artifacts`), log skill directory as artifacts
   c. Create or get `RegisteredSkill` via `MlflowClient().create_skill()`
   d. Create `SkillVersion` with auto-incremented version number
5. Return list of `SkillVersion` objects

### 4.2 `install_skill()` Flow

1. Call `load_skill()` → resolve version/alias → `SkillVersion`
2. Download artifacts via `MlflowClient().download_artifacts(run_id, ...)`
3. Determine destination:
   - `scope="global"` → `~/.claude/skills/{name}/`
   - `scope="project"` → `{project_path}/.claude/skills/{name}/`
4. Copy files to destination
5. Write `.mlflow_skill_info` sidecar: `{name, version, source, tracking_uri, installed_at}`
6. Return destination path

---

## 5. Entity Classes

### `mlflow/entities/skill.py`
```python
class Skill:
    name: str
    description: str | None
    creation_timestamp: int | None
    last_updated_timestamp: int | None
    latest_version: int | None
    aliases: list[SkillAlias] | None
```

### `mlflow/entities/skill_version.py`
```python
class SkillVersion:
    name: str
    version: int
    source: str | None
    description: str | None
    manifest_content: str | None
    run_id: str | None
    creation_timestamp: int | None
    tags: dict[str, str]
    aliases: list[str]
```

---

## 6. REST API

FastAPI router at `/ajax-api/3.0/mlflow/skills/`:

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/register` | Register from GitHub URL / local path |
| `GET` | `/` | List/search skills |
| `GET` | `/{name}` | Get skill details + versions |
| `DELETE` | `/{name}` | Delete skill (and all versions) |
| `GET` | `/{name}/versions/{version}` | Get specific version |
| `DELETE` | `/{name}/versions/{version}` | Delete version |
| `POST` | `/{name}/versions/{version}/tags` | Set tag |
| `DELETE` | `/{name}/versions/{version}/tags/{key}` | Delete tag |
| `POST` | `/{name}/aliases` | Set alias |
| `DELETE` | `/{name}/aliases/{alias}` | Delete alias |

---

## 7. CLI

```bash
mlflow skills register <source>           # GitHub URL or local path
mlflow skills list                         # List registered skills
mlflow skills load <name> [options]        # Install skill to Claude Code
  --version, -v INT
  --alias, -a TEXT
  --scope [global|project]
  --project-path PATH
```

---

## 8. Frontend

### 8.1 Routing

Add to `routes.ts`:
- `skillsPage = 'mlflow.skills'` → `/skills`
- `skillDetailsPage = 'mlflow.skills.details'` → `/skills/:skillName`

Add to `MlflowSidebar.tsx`: Skills nav item (after Prompts).

### 8.2 Pages

**`SkillsPage.tsx`** — List view:
- Header with "Skills" title
- Search filter input
- Table: skill name, description, latest version, tags, creation time
- "Register skill" button → modal with GitHub URL input
- Pagination

**`SkillsDetailsPage.tsx`** — Detail view:
- Breadcrumb back to skills list
- Skill name + description
- Versions table: version, description, tags, aliases, timestamp
- SKILL.md content preview (rendered markdown)
- Tag and alias management
- Delete actions

### 8.3 API Client

Calls `/ajax-api/3.0/mlflow/skills/*` endpoints (not Model Registry endpoints).

---

## 9. Files to Create

| File | Purpose |
|------|---------|
| `mlflow/genai/skills/__init__.py` | Public SDK API |
| `mlflow/genai/skills/constants.py` | Tag constants, name rules |
| `mlflow/genai/skills/skill_parser.py` | SKILL.md parsing + GitHub fetch |
| `mlflow/entities/skill.py` | Skill entity |
| `mlflow/entities/skill_version.py` | SkillVersion entity |
| `mlflow/store/db_migrations/versions/*_add_skill_registry_tables.py` | Alembic migration |
| `mlflow/server/skills/__init__.py` | Package init |
| `mlflow/server/skills/api.py` | FastAPI router |
| `mlflow/genai/skills/cli.py` | CLI commands |
| `mlflow/server/js/src/.../pages/skills/types.ts` | TypeScript interfaces |
| `mlflow/server/js/src/.../pages/skills/api.ts` | API client |
| `mlflow/server/js/src/.../pages/skills/utils.ts` | Constants |
| `mlflow/server/js/src/.../pages/skills/SkillsPage.tsx` | List page |
| `mlflow/server/js/src/.../pages/skills/SkillsDetailsPage.tsx` | Detail page |
| `mlflow/server/js/src/.../pages/skills/hooks/*.tsx` | React Query hooks |
| `mlflow/server/js/src/.../pages/skills/components/*.tsx` | UI components |

## 10. Files to Modify

| File | Change |
|------|--------|
| `mlflow/store/tracking/dbmodels/models.py` | Add 4 SQL model classes |
| `mlflow/store/tracking/abstract_store.py` | Add abstract skill CRUD methods |
| `mlflow/store/tracking/sqlalchemy_store.py` | Implement skill CRUD methods |
| `mlflow/tracking/_tracking_service/client.py` | Add skill delegation methods |
| `mlflow/tracking/client.py` | Add public MlflowClient skill methods |
| `mlflow/genai/__init__.py` | Export skill functions |
| `mlflow/server/fastapi_app.py` | `include_router(skills_router)` |
| `mlflow/cli/__init__.py` | `cli.add_command(skills.cli.commands)` |
| `mlflow/claude_code/tracing.py` | Enhance Skill tool spans with sidecar metadata |
| `mlflow/server/js/src/.../routes.ts` | Add skill page routes |
| `mlflow/server/js/src/.../route-defs.ts` | Add skill route definitions |
| `mlflow/server/js/src/common/components/MlflowSidebar.tsx` | Add Skills nav item |

---

## 11. Implementation Schedule

### Day 1 — Backend: Schema + Store + SDK
1. Entity classes
2. SQLAlchemy models
3. Alembic migration
4. Abstract store + SQLAlchemy store
5. Tracking service client + MlflowClient
6. `mlflow/genai/skills/` module
7. Export from `mlflow/genai/__init__.py`
8. Unit tests

### Day 2 — REST API + CLI + Tracing
1. FastAPI router + Pydantic models
2. Register router in app
3. CLI commands + register in main CLI
4. Enhance Claude Code tracing for skill metadata
5. Integration tests

### Day 3 — Frontend + Polish
1. Routes + sidebar
2. Skills pages + components
3. API client + React Query hooks
4. End-to-end testing

---

## 12. Verification

### Unit Tests
```bash
uv run pytest tests/genai/skills/test_skill_parser.py
uv run pytest tests/genai/skills/test_skills.py
uv run pytest tests/store/tracking/test_sqlalchemy_store_skills.py
```

### Manual E2E
```bash
# Start dev server
nohup uv run bash dev/run-dev-server.sh > /tmp/mlflow-dev-server.log 2>&1 &

# Register from GitHub
python -c "
import mlflow.genai
versions = mlflow.genai.register_skill('https://github.com/mlflow/skills')
for v in versions: print(f'{v.name} v{v.version}')
"

# Load + install
python -c "
import mlflow.genai
skill = mlflow.genai.load_skill('copilot')
print(skill.manifest_content)
path = mlflow.genai.install_skill('copilot', scope='global')
print(f'Installed to {path}')
# Verify sidecar
import json
print(json.load(open(path / '.mlflow_skill_info')))
"

# CLI
mlflow skills register https://github.com/mlflow/skills
mlflow skills list
mlflow skills load copilot --scope global

# UI: http://localhost:3000/skills
```

### Frontend
```bash
pushd mlflow/server/js && yarn lint && yarn type-check && yarn test Skills; popd
```
