# Flask-to-FastAPI Migration -- Master TODO

**Overall difficulty:** MEDIUM | **Estimated effort:** 1-2 weeks (focused work with AI assistance)

## Revised Strategy (based on actual velocity)

The migration is mostly mechanical refactoring. With abstractions already in place (M0), each remaining milestone is hours-to-days, not weeks. Revised estimate accounts for:
- Uniform shape of handlers (protobuf-driven, already use RequestContext abstraction)
- Test infrastructure is mostly .data→.content, .json→.json() mechanical changes
- FastAPI equivalents for security/middleware already exist

## Plugin Compatibility Decision

**Keep legacy `mlflow.app` Flask plugins working forever** via lazy Flask import + WSGIMiddleware wrap. Flask is **removed from MLflow's required deps** but becomes a transitive dep of any plugin package that uses it (e.g., `mlflow-oidc-auth`).

**What this achieves:**
- `pip install mlflow` → zero Flask installed
- `pip install mlflow mlflow-oidc-auth` → Flask arrives via oidc-auth's own deps
- Third-party Flask plugins (oidc-auth, etc.) work unchanged after migration
- ~50 LOC compat shim only activates when `--app-name <flask-plugin>` is used

---

## Current Hybrid State (Already Done)

> The migration is not starting from zero. Several components are already FastAPI-native and should be treated as **out of scope** for this migration plan.

### Already FastAPI-native (no migration needed)
| Component | Router/File | Notes |
|---|---|---|
| OTel ingest (`/v1/traces`) | `otel_router` in `mlflow/server/otel_api.py` | Registered in `fastapi_app.py:87` |
| Job execution (`/ajax-api/3.0/jobs`) | `job_api_router` in `mlflow/server/job_api.py` | Registered in `fastapi_app.py:89` |
| DB-backed gateway (`/gateway/`) | `gateway_router` in `mlflow/server/gateway_api.py` | Async endpoints, registered in `fastapi_app.py:93` |
| Assistant (`/ajax-api/3.0/mlflow/assistant`) | `assistant_router` in `mlflow/server/assistant/api.py` | Registered in `fastapi_app.py:97` |
| Scoring server | `mlflow/pyfunc/scoring_server/__init__.py` | Separate FastAPI app, not part of tracking server |
| Agent server | `mlflow/genai/agent_server/server.py` | Separate FastAPI app |
| Standalone AI Gateway | `mlflow/gateway/app.py` | Separate FastAPI app (`GatewayAPI`) |

### Already has FastAPI equivalents (needs consolidation, not new work)
| Component | Flask version | FastAPI version |
|---|---|---|
| Security middleware | `mlflow/server/security.py` | `mlflow/server/fastapi_security.py` |
| Workspace middleware | `workspace_helpers.py` (before/teardown hooks) | `fastapi_app.py:38` (async middleware) |
| Auth permission middleware | `auth/__init__.py:3412` (`_before_request`) | `auth/__init__.py:3107` (`add_fastapi_permission_middleware`) |

### What still needs migration (the scope of this plan)
- **All routes in `handlers.py`** -- protobuf-generated tracking/registry/artifact/webhook endpoints (~90+ handlers)
- **All explicit routes in `__init__.py`** -- health, version, artifact serving, metrics, static files (~15 routes)
- **Auth routes** -- user management, permissions (~40 routes via `add_url_rule`)
- **Auth middleware generalization** -- `_find_fastapi_validator` only covers 4 hard-coded prefixes; must become generic before Flask routes are removed
- **Test infrastructure** -- 54 files using Flask `test_client()` (8 already use FastAPI `TestClient`)
- **Flask dependency removal** -- Flask, Flask-CORS, Flask-WTF, prometheus_flask_exporter

---

## Performance Testing Strategy

> Performance testing runs at 3 points: before we start (baseline), after the biggest migration phase (checkpoint), and at the end (final gate). The same benchmark script is used throughout so numbers are directly comparable.

### Benchmark Script (`benchmarks/flask_to_fastapi_perf.py`)

Create a reusable benchmark script that measures these workloads against a running MLflow server:

| Workload | What it measures | Target |
|---|---|---|
| **Throughput: search_runs** | `POST /api/2.0/mlflow/runs/search` with 1000 runs in store, 100 sequential requests | requests/sec |
| **Throughput: get_metric_history_bulk** | `GET /ajax-api/2.0/mlflow/metrics/get-history-bulk` with 50 run IDs x 500 data points | requests/sec |
| **Throughput: log_batch** | `POST /api/2.0/mlflow/runs/log-batch` with 100 metrics + 50 params per call, 100 sequential requests | requests/sec |
| **Latency: create_experiment + start_run + log + end** | Full experiment lifecycle, single request, measure p50/p95/p99 over 200 iterations | milliseconds |
| **Artifact download** | `GET /get-artifact` for a 100MB file | throughput (MB/s) |
| **Artifact upload** | `POST /ajax-api/2.0/mlflow/upload-artifact` for a 100MB file | throughput (MB/s) |
| **Concurrency** | 50 concurrent `search_runs` requests via `asyncio`/`aiohttp` | requests/sec, error rate |
| **Memory** | RSS of server process before and after 1000 requests | delta MB (leak detection) |

### When to Run

| Timing | Milestone | Purpose | Acceptable Regression |
|---|---|---|---|
| **Baseline** | Before Milestone 0 | Establish Flask numbers | N/A -- this IS the reference |
| **Checkpoint** | After Milestone 2 (all handlers migrated) | Catch regressions from handler migration | < 10% on throughput, < 20% on p99 latency |
| **Final Gate** | After Milestone 7 (Flask removed) | Confirm no regression in production config | < 5% on throughput, < 10% on p99 latency |

### How to Run

```bash
# 1. Start server (use same config each time: SQLite backend, local artifacts, single worker)
MLFLOW_BACKEND_STORE_URI=sqlite:///perf_test.db \
MLFLOW_ARTIFACTS_DESTINATION=./perf_artifacts \
uv run mlflow server --host 127.0.0.1 --port 5000 --workers 1

# 2. Seed data (first run only)
uv run python benchmarks/flask_to_fastapi_perf.py seed

# 3. Run benchmarks
uv run python benchmarks/flask_to_fastapi_perf.py run --output results_milestone_X.json

# 4. Compare against baseline
uv run python benchmarks/flask_to_fastapi_perf.py compare results_baseline.json results_milestone_X.json
```

### Baseline Capture
- [ ] Write `benchmarks/flask_to_fastapi_perf.py` with seed, run, and compare subcommands
- [ ] Run baseline on current Flask server (Gunicorn, 1 worker) -> save as `results_baseline_flask.json`
- [ ] Run baseline on current hybrid server (Uvicorn default, WSGIMiddleware) -> save as `results_baseline_uvicorn.json`
- [ ] Document hardware/OS used for baseline (results are only comparable on same machine)

### Checkpoint (After Milestone 2)
- [ ] Run benchmark -> save as `results_milestone_2.json`
- [ ] Compare against baseline: flag any workload with >10% throughput regression
- [ ] If regression found: profile with `py-spy` or `cProfile` to identify hotspot before proceeding
- [ ] Specifically watch artifact upload/download -- streaming changes are the highest risk for perf regression

### Final Gate (After Milestone 7)
- [ ] Run benchmark -> save as `results_milestone_7.json`
- [ ] Compare against baseline: all workloads within 5% throughput
- [ ] Run 10-minute sustained load test (50 concurrent users) -> verify no memory leak (RSS growth < 50MB)
- [ ] Compare Uvicorn (async) vs baseline: document any improvements from async (especially concurrent workloads)

---

## Open Design Decisions

> These must be resolved before starting Milestone 1. Document the decision in this section once made.

### Decision 1: Sync vs Async Handlers

Flask handlers are all synchronous. When moved to FastAPI, there are two options:

**Option A: Keep handlers sync (recommended for migration)**
- FastAPI runs sync handlers in a threadpool automatically (`run_in_executor`)
- Zero changes to handler business logic or SQLAlchemy session management
- No risk of introducing async-related bugs (forgotten `await`, event loop blocking)
- Can convert hot paths to async later as an optimization

**Option B: Convert handlers to async**
- Better performance for I/O-bound handlers (artifact streaming, gateway proxy)
- Requires async SQLAlchemy (`AsyncSession`) or careful session management
- Much larger scope -- touches every handler function signature + every store call
- High risk of subtle concurrency bugs

**Decision:** `[ ] A (sync)` / `[ ] B (async)` / `[ ] Hybrid (sync by default, async for streaming endpoints)`

### Decision 2: Gunicorn/Waitress End-of-Life

Gunicorn serves the Flask app directly (`mlflow.server:app`). After Flask removal:

**Option A: Drop Gunicorn/Waitress entirely**
- Simplifies codebase, Uvicorn is already the default
- Breaking change for users who depend on `--gunicorn-opts`

**Option B: Keep Gunicorn with Uvicorn workers**
- `gunicorn -k uvicorn.workers.UvicornWorker mlflow.server.fastapi_app:app`
- Maintains multi-worker process management that some deployments rely on

**Decision:** `[ ] A (drop)` / `[ ] B (keep with Uvicorn workers)`

### Decision 3: Static Prefix Handling

All routes use `_add_static_prefix()` / `STATIC_PREFIX_ENV_VAR` to support reverse proxy deployments (e.g., behind `/mlflow/`). FastAPI needs equivalent handling:

**Option A: FastAPI `root_path` parameter**
- FastAPI/Starlette natively supports `root_path` for ASGI servers behind proxies
- More standard than custom prefix manipulation

**Option B: Replicate `_add_static_prefix()` for FastAPI routes**
- Direct port, minimal behavioral change
- Non-standard, but proven to work

**Decision:** `[ ] A (root_path)` / `[ ] B (replicate prefix logic)`

---

## Rollback Strategy

> Each milestone must be individually revertable without losing work from other milestones.

### During Dual-Registration (Milestones 1-2)
- Both Flask and FastAPI routes are registered simultaneously
- A feature flag (`MLFLOW_USE_FASTAPI_ROUTES=true/false`) controls which routes take precedence
- Default: FastAPI routes enabled. If regression detected, set to `false` to fall back to Flask
- WSGIMiddleware catch-all remains in place as safety net until Milestone 7

### After Security/Auth Migration (Milestones 3-4)
- These are harder to revert because they remove Flask middleware
- **Gate:** Do NOT start Milestone 3 until Milestone 2 has been in production for at least 1 release cycle with no reported issues
- Keep `security.py` and `workspace_helpers.py` Flask code behind `if` guards (don't delete files until Milestone 7)

### Plugin API (Milestone 5)
- The WSGIMiddleware shim for v1 plugins IS the rollback -- it stays until the next major version
- If critical issues: revert to Flask-only plugin loading

---

## Milestone Dependencies

```
M0 (refactor) ──> M1 (route gen) ──> M1.5 (auth generalization) ──> M2 (migrate handlers)
                                                                          │
                                                    ┌─────────────────────┼─────────────────────┐
                                                    v                     v                     v
                                              M3 (security)        M4 (auth routes)      M5 (plugins)
                                                    │                     │                     │
                                                    └─────────┬──────────┘─────────────────────┘
                                                              v
                                                    M6 (tests) ──> M7 (remove Flask)
```

- **M0 -> M1 -> M1.5 -> M2**: Strictly sequential. M1.5 (auth generalization) is a **hard gate** -- no Flask route removal in M2 until FastAPI auth covers all routes.
- **M3, M4, M5**: Can run in parallel after M2 (independent concerns)
- **M3 does NOT delete Flask security code** -- only verifies FastAPI parity. Actual deletion deferred to M7 because Gunicorn/Waitress still serve the Flask app directly with its middleware.
- **M6**: Can start during M3-M5 (migrate tests as domains become FastAPI-native), but must finish after M3-M5
- **M7**: Blocked on ALL previous milestones + Decision 2 (Gunicorn/Waitress EOL)

---

## Milestone 0: Preparatory Refactoring (4-6 weeks)

> Goal: Decouple handler business logic from Flask without changing external behavior. Every PR is independently mergeable.

### 0a. Framework-agnostic request abstraction
- [ ] Create `mlflow/server/request_context.py` with `RequestContext` dataclass (`method`, `args`, `json_body`, `headers`, `stream`, `path`, `view_args`, `content_type`)
- [ ] Implement `from_flask_request(flask_request) -> RequestContext`
- [ ] Implement `from_fastapi_request(fastapi_request, body) -> RequestContext`
- [ ] Refactor `_get_request_message()` (`handlers.py:896`) to accept `RequestContext` instead of `flask.Request`
- [ ] Refactor `_get_normalized_request_json()` to use `RequestContext`
- [ ] Refactor `_get_validated_flask_request_json()` to use `RequestContext`
- [ ] Refactor `_validate_content_type()` to use `RequestContext`

### 0b. Framework-agnostic response helpers
- [ ] Create `mlflow/server/response_utils.py` with `make_json_response()`, `make_proto_response()`, `make_error_response()`
- [ ] Replace ~80 direct `Response()` constructions in `handlers.py`
- [ ] Replace ~20 `jsonify()` calls in `handlers.py`
- [ ] Replace `send_file()` calls (lines 998, 3862) with abstraction
- [ ] Replace `current_app.response_class()` streaming (line 3266) with abstraction
- [ ] Create FastAPI-compatible `catch_mlflow_exception` equivalent -- the current decorator (`handlers.py`) catches `MlflowException` and builds a Flask `Response`; the new version must return a FastAPI-compatible response or raise `HTTPException`. This wraps nearly every handler so it's on the critical path.

### 0c. Eliminate direct `flask.request` global access
- [ ] Audit all ~37 direct `request.*` accesses in handler functions (not via `_get_request_message`)
- [ ] Refactor `serve_get_metric_history_bulk()` -- uses `request.args`
- [ ] Refactor `serve_get_trace_artifact()` -- uses `request.args`
- [ ] Refactor `serve_upload_artifact()` -- uses `request.stream`, `request.content_length`
- [ ] Refactor `serve_gateway_proxy()` -- uses `request.method`, `request.path`, `request.data`, `request.json`
- [ ] Refactor `_graphql()` -- uses `request.method`, `request.get_json`, `request.args`
- [ ] Refactor `_generate_demo()` -- uses `request.get_json`
- [ ] Refactor `_list_supported_models()` -- uses `request.args`
- [ ] Refactor all remaining handlers with direct `request` access

### 0d. Split `handlers.py` (6,585 lines) into domain modules
- [ ] Create `mlflow/server/handlers/` package
- [ ] Extract `handlers/experiments.py` (~10 handlers)
- [ ] Extract `handlers/runs.py` (~10 handlers)
- [ ] Extract `handlers/artifacts.py` (~15 handlers)
- [ ] Extract `handlers/model_registry.py` (~15 handlers)
- [ ] Extract `handlers/traces.py` (~20 handlers)
- [ ] Extract `handlers/gateway.py` (~20 handlers)
- [ ] Extract `handlers/logged_models.py` (~8 handlers)
- [ ] Extract `handlers/scorers.py` (~5 handlers)
- [ ] Extract `handlers/webhooks.py` (~6 handlers)
- [ ] Extract `handlers/workspaces.py` (~5 handlers)
- [ ] Extract `handlers/datasets.py` (~10 handlers)
- [ ] Extract `handlers/route_generation.py` (`get_endpoints`, `get_service_endpoints`, `HANDLERS` map, path utilities)
- [ ] Keep old `handlers.py` as a re-export shim for backward compatibility
- [ ] Verify all imports from tests and auth still work

### 0 -- Test Plan

**Principle:** This phase must be a pure refactor -- zero behavioral changes. Every test that passed before must pass after with identical results.

#### Automated Tests
- [ ] `uv run pytest tests/server/test_handlers.py` -- all handler tests pass unchanged
- [ ] `uv run pytest tests/server/test_workspace_endpoints.py` -- workspace routing unchanged
- [ ] `uv run pytest tests/tracking/test_rest_tracking.py` -- full integration test suite
- [ ] `uv run pytest tests/server/test_security.py` -- security middleware unaffected
- [ ] `uv run pre-commit run --all-files` -- linting/formatting clean

#### Unit Tests for New Abstractions
- [ ] Test `RequestContext.from_flask_request()` round-trips correctly: verify `method`, `args`, `json_body`, `headers`, `path` match the original Flask request
- [ ] Test `RequestContext.from_fastapi_request()` produces identical `RequestContext` for equivalent HTTP requests
- [ ] Test `make_json_response()` / `make_proto_response()` / `make_error_response()` produce identical HTTP status codes, headers, and bodies as the old inline `Response()` / `jsonify()` calls
- [ ] Test that the re-export shim (`handlers.py`) still exposes all public names: `from mlflow.server.handlers import get_endpoints, HANDLERS, ...` works

#### Manual Smoke Tests
- [ ] Start server: `uv run mlflow server` -- UI loads at `http://localhost:5000`
- [ ] Create experiment via Python client: `mlflow.create_experiment("test")` -- succeeds
- [ ] Log a run with metrics/params/artifacts -- all recorded correctly
- [ ] Query `/api/2.0/mlflow/experiments/search` via curl -- returns valid JSON
- [ ] Query `/health` and `/version` -- return expected values

---

## Milestone 1: FastAPI Route Generation System (2-3 weeks)

> Goal: Create native FastAPI route registration that mirrors the protobuf-driven approach.

### 1a. FastAPI route registration from protobuf descriptors
- [ ] Create `mlflow/server/fastapi_handlers.py` (or `handlers/fastapi_route_generation.py`)
- [ ] Implement `get_fastapi_service_endpoints(service, get_handler) -> APIRouter` analogous to `get_service_endpoints()`
- [ ] Skip `_convert_path_parameter_to_flask_format()` -- FastAPI uses `{param}` natively
- [ ] Support multiple API version prefixes (`/api/2.0/`, `/ajax-api/2.0/`, `/api/3.0/`)
- [ ] Handle `STATIC_PREFIX_ENV_VAR` / `_add_static_prefix()` -- decide whether to use FastAPI `root_path` or replicate prefix logic (see Decision 3 above), then implement for all FastAPI route registration
- [ ] Create dual-mode handler wrappers: `flask_handler(func)` and `fastapi_handler(func)` using `RequestContext`
- [ ] Add feature flag `MLFLOW_USE_FASTAPI_ROUTES` (default: `true`) to toggle between Flask and FastAPI route precedence during migration (see Rollback Strategy)

### 1b. Migrate explicit routes from `__init__.py`
- [ ] `/health` -> FastAPI router
- [ ] `/version` -> FastAPI router
- [ ] `/get-artifact` -> FastAPI router
- [ ] `/model-versions/get-artifact` -> FastAPI router
- [ ] `/ajax-api/2.0/mlflow/metrics/get-history-bulk` -> FastAPI router
- [ ] `/ajax-api/2.0/mlflow/metrics/get-history-bulk-interval` -> FastAPI router
- [ ] `/ajax-api/2.0/mlflow/experiments/search-datasets` -> FastAPI router
- [ ] `/ajax-api/2.0/mlflow/runs/create-promptlab-run` -> FastAPI router
- [ ] `/ajax-api/2.0/mlflow/gateway-proxy` -> FastAPI router
- [ ] `/ajax-api/2.0/mlflow/upload-artifact` -> FastAPI router
- [ ] `/ajax-api/2.0/mlflow/get-trace-artifact` + v3 variant -> FastAPI router
- [ ] `/ajax-api/3.0/mlflow/logged-models/.../artifacts/files` -> FastAPI router
- [ ] `/ajax-api/3.0/mlflow/ui-telemetry` (GET + POST) -> FastAPI router
- [ ] `/static-files/<path>` -> FastAPI router (use `StaticFiles` mount)
- [ ] `/` (serve index.html) -> FastAPI router

### 1 -- Test Plan

**Principle:** Dual registration -- both Flask and FastAPI routes serve the same endpoints. Responses must be byte-for-byte identical (status code, headers, body structure).

#### Automated Tests
- [ ] `uv run pytest tests/server/` -- existing tests still pass against Flask routes
- [ ] For each migrated explicit route, add a parameterized test that hits both Flask and FastAPI paths and asserts identical responses:
  - `GET /health` -> 200, body `"OK"`
  - `GET /version` -> 200, body matches `mlflow.__version__`
  - `GET /get-artifact?run_id=...&path=...` -> same artifact bytes
  - `GET /static-files/main.js` -> same static file with correct `Cache-Control`
  - `GET /` -> serves `index.html`
  - `GET /ajax-api/2.0/mlflow/metrics/get-history-bulk?run_ids=...` -> same JSON shape
  - `POST /ajax-api/2.0/mlflow/experiments/search-datasets` -> same JSON shape
  - `GET /ajax-api/3.0/mlflow/ui-telemetry` -> same response
  - `POST /ajax-api/3.0/mlflow/ui-telemetry` -> same response

#### Route Generation Tests
- [ ] Test `get_fastapi_service_endpoints()` produces the same set of (path, method) pairs as `get_service_endpoints()` for each protobuf service (MlflowService, ModelRegistryService, MlflowArtifactsService, WebhookService)
- [ ] Test that `{param}` path parameters in FastAPI match the `<param>` Flask equivalents
- [ ] Test that all API version prefixes (`/api/2.0/`, `/ajax-api/2.0/`, `/api/3.0/`, `/ajax-api/3.0/`) are generated

#### Manual Smoke Tests
- [ ] Start server with Uvicorn (default): verify `/health`, `/version`, and UI load
- [ ] Start server with `--gunicorn-opts ""`: verify same endpoints still work via Flask
- [ ] Use MLflow Python client to run a basic experiment workflow -- no regressions

---

## Milestone 1.5: Generalize FastAPI Auth Middleware (1-2 weeks)

> **HARD GATE:** No Flask route removal in Milestone 2 may proceed until this is complete. Without this, migrated routes would bypass Flask's `_before_request` auth hook and be unprotected under `--app-name basic-auth`.

### Problem
`_find_fastapi_validator()` in `auth/__init__.py:3078` only covers 4 hard-coded prefixes (`/gateway/`, `/v1/traces`, `/ajax-api/3.0/jobs`, `/ajax-api/3.0/mlflow/assistant`). When Flask routes move to FastAPI, they bypass Flask's `_before_request` auth hook. The FastAPI middleware must cover ALL routes, not just the current 4.

### Tasks
- [ ] Refactor `_find_fastapi_validator()` to be generic: look up the route's permission validator using the same logic as Flask's `_before_request` / `_find_validator()` (which uses `request.path`, `request.method`, `request.view_args`)
- [ ] The FastAPI middleware must handle all the same cases as `_before_request`: unprotected routes, custom `authorization_function`, admin bypass, per-resource permission checks
- [ ] Ensure the refactored middleware covers the full set of protobuf-generated paths (`/api/2.0/mlflow/...`, `/ajax-api/2.0/mlflow/...`, etc.), not just the 4 currently hard-coded prefixes
- [ ] Handle `view_args` equivalent: FastAPI path parameters (e.g., `/experiments/{experiment_id}`) must be extracted and passed to validators the same way Flask's `request.view_args` does

### 1.5 -- Test Plan

**Principle:** Auth coverage must be proven for every route before and after migration. An unprotected endpoint is a security vulnerability.

#### Coverage Verification
- [ ] Write a test that enumerates ALL registered FastAPI routes and asserts each has a corresponding validator in the auth middleware (no route left unprotected)
- [ ] For each protobuf service (MlflowService, ModelRegistryService, MlflowArtifactsService, WebhookService), test that an unauthenticated request returns 401 when `--app-name basic-auth` is active
- [ ] Test that a user with `READ` permission cannot call a write endpoint (e.g., `POST /api/2.0/mlflow/experiments/create`)
- [ ] Test that admin users can access all endpoints
- [ ] Test that public endpoints (`/health`, `/version`, `/signup`) remain accessible without auth

#### Backward Compatibility
- [ ] Existing Flask `_before_request` auth still works for any routes still on Flask (during dual-registration)
- [ ] The 4 currently hard-coded FastAPI paths still work correctly after refactoring
- [ ] `uv run pytest tests/server/auth/` passes

---

## Milestone 2: Migrate Core Protobuf Handlers (6-8 weeks)

> Goal: Convert all protobuf-based handlers to run natively in FastAPI, one domain at a time. For each domain: register FastAPI routes alongside Flask, add TestClient tests, then remove Flask registration.

### 2a. Experiments
- [ ] Convert experiment handlers to use `RequestContext`
- [ ] Register on FastAPI `APIRouter`
- [ ] Add FastAPI `TestClient` tests
- [ ] Remove Flask route registration for experiments

### 2b. Runs
- [ ] Convert run handlers to use `RequestContext`
- [ ] Register on FastAPI `APIRouter`
- [ ] Add FastAPI `TestClient` tests
- [ ] Remove Flask route registration for runs

### 2c. Model Registry
- [ ] Convert model registry handlers to use `RequestContext`
- [ ] Register on FastAPI `APIRouter`
- [ ] Add FastAPI `TestClient` tests
- [ ] Remove Flask route registration for model registry

### 2d. Datasets
- [ ] Convert dataset handlers to use `RequestContext`
- [ ] Register on FastAPI `APIRouter`
- [ ] Add FastAPI `TestClient` tests
- [ ] Remove Flask route registration for datasets

### 2e. Traces
- [ ] Convert trace handlers (V2 + V3 APIs) to use `RequestContext`
- [ ] Register on FastAPI `APIRouter`
- [ ] Add FastAPI `TestClient` tests
- [ ] Remove Flask route registration for traces

### 2f. Logged Models
- [ ] Convert logged model handlers to use `RequestContext`
- [ ] Register on FastAPI `APIRouter`
- [ ] Add FastAPI `TestClient` tests
- [ ] Remove Flask route registration for logged models

### 2g. Scorers
- [ ] Convert scorer handlers to use `RequestContext`
- [ ] Register on FastAPI `APIRouter`
- [ ] Add FastAPI `TestClient` tests
- [ ] Remove Flask route registration for scorers

### 2h. Webhooks
- [ ] Convert webhook handlers to use `RequestContext`
- [ ] Register on FastAPI `APIRouter`
- [ ] Add FastAPI `TestClient` tests
- [ ] Remove Flask route registration for webhooks

### 2i. Workspaces
- [ ] Convert workspace handlers to use `RequestContext`
- [ ] Register on FastAPI `APIRouter`
- [ ] Add FastAPI `TestClient` tests
- [ ] Remove Flask route registration for workspaces

### 2j. Artifacts (HARDEST)
- [ ] Replace `flask.send_file()` with `fastapi.responses.FileResponse` / `StreamingResponse`
- [ ] Replace `request.stream.read()` with FastAPI async stream
- [ ] Replace `current_app.response_class(generator)` with `StreamingResponse(generator)`
- [ ] Handle multipart upload/download
- [ ] Register on FastAPI `APIRouter`
- [ ] Add FastAPI `TestClient` tests
- [ ] Remove Flask route registration for artifacts

### 2k. Gateway Handlers (in handlers.py)
- [ ] Convert gateway proxy handler
- [ ] Convert provider/model discovery handlers
- [ ] Register on FastAPI `APIRouter`
- [ ] Remove Flask route registration

### 2l. GraphQL
- [ ] Convert `_graphql()` handler to FastAPI
- [ ] Register on FastAPI `APIRouter`
- [ ] Remove Flask route registration

### 2m. Distributed Tracing Context Extraction
- [ ] `mlflow/tracing/distributed/__init__.py` conditionally imports Flask to extract trace context from incoming Flask requests (`flask.request.headers`)
- [ ] Add FastAPI/Starlette equivalent: extract `traceparent` header from `starlette.requests.Request`
- [ ] Ensure both Flask and FastAPI paths work during dual-registration period
- [ ] Add test in `tests/tracing/test_distributed.py` that validates trace propagation via FastAPI server

### 2 -- Test Plan

**Principle:** Each domain is migrated and tested independently. After each sub-milestone (2a-2l), run the domain's tests AND the full integration suite to catch cross-domain regressions.

#### Per-Domain Test Checklist (repeat for each 2a-2l)
- [ ] All existing handler unit tests pass against the new FastAPI route (swap fixture from Flask `test_client` to FastAPI `TestClient`)
- [ ] Request parsing: verify query params, JSON body, path params, headers are parsed identically
- [ ] Response format: verify JSON structure, status codes, error formats match exactly
- [ ] Error handling: verify `MlflowException` maps to the same HTTP status codes (400, 404, 500, etc.)
- [ ] The `catch_mlflow_exception` decorator behavior is preserved in FastAPI context

#### Domain-Specific Tests

**Experiments/Runs/Model Registry (2a-2c):**
- [ ] CRUD lifecycle: create -> get -> update -> delete -> verify 404 on deleted
- [ ] Search with pagination: `page_token`, `max_results` work correctly
- [ ] Protobuf serialization: response bodies deserialize correctly with the Python client

**Artifacts (2j -- highest risk):**
- [ ] Small file upload/download round-trip: content and MIME type preserved
- [ ] Large file streaming: upload 100MB+ file via `request.stream`, verify no memory spike
- [ ] `send_file` replacement: `FileResponse` sets correct `Content-Disposition`, `Content-Type`
- [ ] `StreamingResponse` for artifact listing: chunked transfer works
- [ ] Multipart upload: verify `Content-Length` validation (>10MB rejection at line 2157)
- [ ] Concurrent artifact downloads: no file handle leaks

**Traces (2e):**
- [ ] V2 and V3 API paths both resolve correctly
- [ ] Trace artifact retrieval: binary content served correctly

**GraphQL (2l):**
- [ ] GET with query param: `?query={experiments{...}}` works
- [ ] POST with JSON body: `{"query": "..."}` works
- [ ] Error responses: GraphQL errors returned in correct format

#### Integration Tests
- [ ] `uv run pytest tests/tracking/test_rest_tracking.py` -- full REST tracking integration
- [ ] `uv run pytest tests/server/test_handlers.py` -- all handler tests
- [ ] End-to-end via Python client:
  - [ ] `mlflow.create_experiment()` -> `mlflow.start_run()` -> `mlflow.log_metric()` -> `mlflow.log_artifact()` -> `mlflow.search_runs()` -> verify all data
  - [ ] `mlflow.register_model()` -> `mlflow.search_registered_models()` -> verify
- [ ] Verify no Flask routes remain: instrument WSGIMiddleware to log if any request falls through to Flask -- should be zero after all domains migrated

#### Performance Checkpoint
- [ ] Run `benchmarks/flask_to_fastapi_perf.py run` -> save as `results_milestone_2.json`
- [ ] Run `benchmarks/flask_to_fastapi_perf.py compare results_baseline_uvicorn.json results_milestone_2.json`
- [ ] All workloads within 10% throughput of baseline
- [ ] If artifact upload/download regressed: profile the `StreamingResponse` path before proceeding

---

## Milestone 3: Security & Middleware Consolidation (2-3 weeks)

> Goal: Verify FastAPI security middleware has full parity with Flask, replace Prometheus exporter, and prepare for eventual Flask middleware deletion. **Flask security code is NOT deleted here** because Gunicorn/Waitress still serve the Flask app directly with its own middleware (`__init__.py:77-80`). Actual deletion is deferred to Milestone 7.

### 3a. Verify FastAPI security parity
- [ ] Audit `mlflow/server/fastapi_security.py` against `security.py` -- confirm every Flask hook has an equivalent FastAPI middleware (CORS, host validation, security headers, cross-origin blocking)
- [ ] Add parameterized tests that run the same security assertions against both Flask and FastAPI paths, proving identical behavior
- [ ] Document any gaps and fix them in `fastapi_security.py`
- [ ] **Do NOT delete `security.py` or `flask-cors` yet** -- still needed for `--gunicorn-opts` / `--waitress-opts` codepaths

### 3b. Consolidate workspace middleware
- [ ] Verify FastAPI workspace middleware in `fastapi_app.py:38` handles all cases that Flask hooks do
- [ ] Add `if` guard to Flask workspace hooks: only register `app.before_request` / `app.teardown_request` when NOT running under Uvicorn (they're redundant when FastAPI middleware handles it)
- [ ] **Do NOT delete Flask workspace hooks yet** -- still needed for Gunicorn/Waitress

### 3c. Replace Prometheus exporter
- [ ] Evaluate `prometheus-fastapi-instrumentator` or `starlette-exporter` as replacement
- [ ] Implement FastAPI-native metrics collection alongside existing Flask exporter
- [ ] When running under Uvicorn: use FastAPI exporter. When running under Gunicorn: keep Flask exporter.
- [ ] Verify `/metrics` endpoint works under both Uvicorn and Gunicorn

### 3 -- Test Plan

**Principle:** Security middleware is critical infrastructure. Test both positive (allowed requests work) and negative (blocked requests fail) cases.

#### CORS Tests
- [ ] Preflight `OPTIONS` request with allowed origin -> 200 with `Access-Control-Allow-Origin`
- [ ] Preflight `OPTIONS` request with disallowed origin -> no CORS headers
- [ ] Simple GET from allowed origin -> `Access-Control-Allow-Origin` header present
- [ ] State-changing POST from cross-origin without proper headers -> blocked (403)
- [ ] `supports_credentials=True` -> `Access-Control-Allow-Credentials: true` present

#### Host Validation Tests
- [ ] Request with `Host: localhost:5000` -> allowed
- [ ] Request with `Host: 127.0.0.1:5000` -> allowed
- [ ] Request with `Host: evil.com` -> blocked (DNS rebinding protection)
- [ ] Request with no Host header -> appropriate handling

#### Security Headers Tests
- [ ] Every response includes `X-Content-Type-Options: nosniff`
- [ ] Every response includes correct `X-Frame-Options` (based on config)
- [ ] No regressions on existing security header tests in `test_security.py`

#### Workspace Context Tests
- [ ] Request with `X-MLflow-Workspace` header -> workspace resolved and propagated to store layer
- [ ] Request without workspace header -> default workspace used
- [ ] Invalid workspace header -> appropriate error response
- [ ] Workspace context cleared after request completes (no leaking between requests)
- [ ] Concurrent requests with different workspaces -> correct isolation

#### Prometheus Tests
- [ ] `PROMETHEUS_EXPORTER_ENV_VAR` set -> `/metrics` endpoint returns Prometheus-formatted data
- [ ] Request count metrics increment correctly
- [ ] `/health` and `/version` excluded from metrics (as configured)
- [ ] Metrics work under Uvicorn (not just Gunicorn)

#### Dual-Server Verification
- [ ] Start with `uv run mlflow server` (Uvicorn) -- run all security/CORS/workspace tests against it
- [ ] Start with `uv run mlflow server --gunicorn-opts ""` (Gunicorn) -- run same tests, verify Flask middleware still active
- [ ] Both must produce identical security behavior

#### Automated Test Suites
- [ ] `uv run pytest tests/server/test_security.py` passes
- [ ] `uv run pytest tests/server/test_security_integration.py` passes
- [ ] `uv run pytest tests/server/test_workspace_middleware.py` passes
- [ ] `uv run pytest tests/server/test_prometheus_exporter.py` passes

---

## Milestone 4: Auth Plugin Migration (3-4 weeks)

> Goal: Convert `mlflow.server.auth` from Flask app factory to FastAPI router/middleware.

### 4a. Extract auth business logic from Flask
- [ ] Replace `request.authorization` with manual `Authorization` header parsing
- [ ] Replace `request.path`, `request.method`, `request.view_args` with framework-agnostic equivalents
- [ ] Replace `make_response()` / `make_basic_auth_response()` / `make_forbidden_response()` with response helpers
- [ ] Replace `werkzeug.security.check_password_hash` / `generate_password_hash` with `passlib` or `bcrypt`
- [ ] Replace `werkzeug.datastructures.Authorization` with manual parsing

### 4b. Convert auth routes to FastAPI
- [ ] Create FastAPI `APIRouter` for auth endpoints
- [ ] Migrate ~40 `app.add_url_rule()` calls to router decorators
- [ ] Migrate user management routes (CRUD)
- [ ] Migrate permission routes (experiment, model, scorer, gateway permissions)

### 4c. Migrate signup form
- [ ] Replace `render_template_string()` with Jinja2 + `HTMLResponse`
- [ ] Replace Flask-WTF `CSRFProtect` with manual CSRF token implementation
- [ ] Remove `flask-wtf` dependency

### 4d. Consolidate auth middleware
- [ ] Make `add_fastapi_permission_middleware()` (already exists at line 3107) the sole auth middleware
- [ ] Remove Flask `_before_request` / `_after_request` auth hooks
- [ ] Update `create_app()` to return FastAPI app only (remove Flask branch)

### 4 -- Test Plan

**Principle:** Auth is security-critical. Test the full matrix of (user role) x (resource type) x (permission level) and verify no permission bypass.

#### Authentication Tests
- [ ] Unauthenticated request to protected endpoint -> 401 with `WWW-Authenticate: Basic` header
- [ ] Valid Basic Auth credentials -> request proceeds
- [ ] Invalid password -> 401
- [ ] Non-existent user -> 401
- [ ] Password hashing: verify `passlib`/`bcrypt` replacement produces same hash verification as old `werkzeug.security`

#### Authorization / Permission Tests
- [ ] Admin user can access all endpoints
- [ ] Non-admin user with `READ` permission on experiment -> can read but not write
- [ ] Non-admin user with `MANAGE` permission -> can update permissions for others
- [ ] Non-admin user with `NO_PERMISSIONS` -> 403 on all resource operations
- [ ] Permission checks for all resource types: experiments, registered models, scorers, gateway secrets, gateway endpoints
- [ ] Default permission for new resources follows configured default

#### User Management Tests
- [ ] `POST /users` (create user) -> user created, password hashed
- [ ] `GET /users` (list users) -> returns all users (admin only)
- [ ] `PATCH /users` (update password) -> password updated, old password invalidated
- [ ] `PATCH /users` (update admin status) -> admin flag toggled
- [ ] `DELETE /users` -> user deleted, subsequent auth fails

#### Signup Form Tests
- [ ] `GET /signup` -> returns HTML form (verify Jinja2 renders correctly)
- [ ] `POST /signup` with valid CSRF token -> user created, redirected
- [ ] `POST /signup` without CSRF token -> 403 (CSRF protection works)
- [ ] `POST /signup` with expired CSRF token -> 403

#### Middleware Integration Tests
- [ ] `add_fastapi_permission_middleware()` intercepts ALL routes (not just a subset)
- [ ] Auth middleware runs BEFORE business logic handlers
- [ ] Auth middleware does NOT block `/health`, `/version`, `/signup` (public endpoints)

#### Automated Test Suites
- [ ] `uv run pytest tests/server/auth/` passes (all auth unit tests)
- [ ] Manual: start server with `mlflow server --app-name basic-auth`, create user via signup page, log experiment, verify permission enforcement

---

## Milestone 5: Plugin System Migration (2-3 weeks)

> Goal: New plugin API that is FastAPI-native with backward compatibility shim. **This is a breaking change for third-party plugins.**

### Current state (important context)
The auth plugin's `create_app()` (`auth/__init__.py:3415-3420`) already handles the uvicorn case: when `_MLFLOW_SGI_NAME == "uvicorn"`, it wraps the Flask app in FastAPI via `create_fastapi_app()` and adds FastAPI permission middleware. But the test plugin (`tests/resources/mlflow-test-plugin/`) does NOT do this -- it returns a raw Flask app with `@app.route` and `@app.before_request`. Under uvicorn, this Flask app is served via `WSGIMiddleware` implicitly (because `_run_server` passes the factory to uvicorn which calls it). This needs explicit documentation and testing.

### 5a. Document current legacy plugin behavior on Uvicorn
- [ ] Audit and document what happens today when a legacy `mlflow.app` Flask plugin is used with `mlflow server` (uvicorn default): Flask app factory is called, uvicorn loads it, Flask routes work via WSGI -- but FastAPI-native routes (OTel, jobs, gateway, assistant) are NOT available because the plugin returns a raw Flask app, not the FastAPI wrapper
- [ ] Decide: should legacy plugins on uvicorn automatically get wrapped in `create_fastapi_app()`? Or is losing FastAPI-native routes acceptable?
- [ ] Add integration test: `mlflow server --app-name test-plugin` under uvicorn -- verify plugin routes work, document which FastAPI-native routes are available

### 5b. Design new plugin API
- [ ] Define `mlflow.app.v2` entry point: `create_app(app: FastAPI) -> FastAPI`
- [ ] Document the new plugin contract
- [ ] Ensure v2 plugins receive the FastAPI app that already has all native routers (OTel, jobs, gateway, assistant) included

### 5c. Implement backward compatibility
- [ ] When `mlflow.app` (v1) plugin detected, wrap Flask result in `WSGIMiddleware`, mount on a FastAPI app that includes native routers, emit deprecation warning
- [ ] When `mlflow.app.v2` plugin detected, use directly
- [ ] Update `_find_app()` in `__init__.py` to support both entry points

### 5c. Migrate built-in plugins
- [ ] Migrate `basic-auth` plugin to `mlflow.app.v2` entry point
- [ ] Update test plugin at `tests/resources/mlflow-test-plugin/`

### 5d. Update documentation
- [ ] Document migration guide for third-party plugin authors
- [ ] Add deprecation timeline: `mlflow.app` removed in next major version

### 5 -- Test Plan

**Principle:** Plugin API is a public contract. Must verify backward compatibility AND the new API works.

#### New Plugin API (v2) Tests
- [ ] A minimal `mlflow.app.v2` plugin that adds a FastAPI route: `GET /custom` -> 200
- [ ] Plugin can add FastAPI middleware (e.g., custom header injection) -> middleware runs on all requests
- [ ] Plugin can include a FastAPI `APIRouter` with multiple routes
- [ ] Plugin receives the FastAPI app instance and can inspect `app.routes`

#### Backward Compatibility (v1) Tests
- [ ] Existing Flask plugin (test plugin at `tests/resources/mlflow-test-plugin/`) still loads and works
- [ ] Flask plugin's `@app.route("/custom/endpoint")` responds correctly when accessed
- [ ] Flask plugin's `@app.before_request` hook fires on requests
- [ ] Deprecation warning is emitted when a v1 plugin is loaded (captured via `pytest.warns(FutureWarning)`)
- [ ] Both v1 and v2 plugins can coexist (if different names)

#### Edge Cases
- [ ] Missing plugin name -> clear error message (`MlflowException`)
- [ ] Plugin raises exception during `create_app()` -> server fails with clear error, not silent corruption
- [ ] `mlflow server --app-name basic-auth` works with the migrated v2 basic-auth plugin

#### Automated Test Suites
- [ ] `uv run pytest tests/` with test plugin installed (via `pip install -e tests/resources/mlflow-test-plugin/`)
- [ ] Integration test: start server with `--app-name` for both v1 and v2 plugins, hit custom endpoints

---

## Milestone 6: Test Infrastructure Migration (2-3 weeks)

> Goal: Migrate all tests from Flask `test_client()` to FastAPI `TestClient`.

### 6a. Update central fixtures
- [ ] Replace `mlflow_app_client` fixture in `tests/server/conftest.py` to use FastAPI `TestClient`
- [ ] Replace `test_app` fixture to use FastAPI
- [ ] Replace `werkzeug.test.Client` usages in `test_security.py`

### 6b. Migrate test files (54 files using Flask test client)
- [ ] `tests/server/test_handlers.py` (~40 usages)
- [ ] `tests/server/test_workspace_endpoints.py`
- [ ] `tests/server/test_workspace_middleware.py`
- [ ] `tests/server/test_security.py`
- [ ] `tests/server/test_security_integration.py`
- [ ] `tests/server/test_prometheus_exporter.py`
- [ ] `tests/tracking/test_rest_tracking.py`
- [ ] `tests/tracing/test_distributed.py`
- [ ] `tests/tracing/fixtures/flask_tracing_server.py` -> FastAPI equivalent
- [ ] All remaining test files (mechanical: `.data` -> `.content`, `.json` -> `.json()`)

### 6c. Update integration test utilities
- [ ] Update `tests/tracking/integration_test_utils.py` to default to Uvicorn/FastAPI
- [ ] Remove Flask `flask run` codepath from `_init_server()`

### 6 -- Test Plan

**Principle:** Test infrastructure migration is mechanical but must not silently change what's being tested. Verify test *behavior* is identical, not just that tests pass.

#### Migration Correctness
- [ ] For each migrated test file, verify test count is identical before and after (no tests accidentally dropped)
- [ ] Spot-check 5-10 tests: compare response objects to confirm `.content` (FastAPI) returns the same bytes as `.data` (Flask)
- [ ] Spot-check `.json()` (method, FastAPI) returns same dict as `.json` (property, Flask)
- [ ] Verify `response.status_code` works identically (both frameworks use int)
- [ ] Verify header access: `response.headers["Content-Type"]` works the same

#### Fixture Tests
- [ ] `mlflow_app_client` fixture returns a Starlette `TestClient` wrapping the FastAPI app
- [ ] `TestClient` correctly resolves routes that were previously Flask-only
- [ ] `TestClient` propagates headers (e.g., workspace header, auth header) correctly

#### Integration Test Utilities
- [ ] `_init_server()` in `integration_test_utils.py` starts Uvicorn by default
- [ ] `_await_server_up_or_die()` still correctly detects server readiness
- [ ] `ServerThread` class works with Uvicorn
- [ ] `tests/tracing/fixtures/flask_tracing_server.py` -> new `fastapi_tracing_server.py` handles distributed trace context extraction identically

#### Completeness Check
- [ ] `grep -r "from flask" tests/` returns zero results (excluding backward-compat plugin tests)
- [ ] `grep -r "test_client()" tests/` returns zero results
- [ ] `grep -r "werkzeug.test" tests/` returns zero results

#### Automated Test Suites
- [ ] `uv run pytest tests/server/` -- all pass
- [ ] `uv run pytest tests/tracking/` -- all pass
- [ ] `uv run pytest tests/tracing/` -- all pass
- [ ] `uv run pytest tests/webhooks/` -- all pass

---

## Milestone 7: Flask Removal -- Final Cut (1-2 weeks)

> Goal: Remove Flask as a dependency entirely.

### 7a. Remove Flask dependency
- [ ] Remove `Flask` from `pyproject.toml`
- [ ] Remove `Flask-CORS` from `pyproject.toml`
- [ ] Remove `Flask-WTF` from optional/auth dependencies
- [ ] Remove `werkzeug` explicit references (transitive via Flask)

### 7b. Clean up server code (includes deferred deletions from M3)
- [ ] Remove Flask `app` object from `mlflow/server/__init__.py`
- [ ] Remove `WSGIMiddleware` mount from `mlflow/server/fastapi_app.py`
- [ ] Remove `IS_FLASK_V1` version check
- [ ] Remove `MLFLOW_FLASK_SERVER_SECRET_KEY` environment variable support
- [ ] Remove Flask import from `mlflow/tracing/distributed/__init__.py` (FastAPI path added in M2m; now delete the Flask branch)
- [ ] Clean up re-export shim in `handlers.py` if still present
- [ ] **Deferred from M3:** Delete `mlflow/server/security.py` (Flask-CORS, Flask before/after hooks)
- [ ] **Deferred from M3:** Delete Flask workspace hooks from `workspace_helpers.py` (`workspace_before_request_handler`, `workspace_teardown_request_handler`)
- [ ] **Deferred from M3:** Remove `flask-cors` from `pyproject.toml`
- [ ] **Deferred from M3:** Remove `prometheus_flask_exporter` (replace with FastAPI exporter from M3c)

### 7c. Deprecate/remove WSGI server support
- [ ] Decide: remove Gunicorn/Waitress support, or make them serve FastAPI via ASGI-to-WSGI adapter?
- [ ] If removing: drop `gunicorn` and `waitress` from dependencies
- [ ] If keeping: implement adapter and update `_build_gunicorn_command()` / `_build_waitress_command()`

### 7d. Enable FastAPI documentation
- [ ] Re-enable `docs_url`, `redoc_url`, `openapi_url` in `fastapi_app.py` (currently `None`)
- [ ] Optionally generate Pydantic models from protobuf for OpenAPI schema

### 7e. User-Facing Documentation and Changelog
- [ ] Changelog entry: Flask removed, FastAPI is now the sole web framework
- [ ] Changelog entry: `MLFLOW_FLASK_SERVER_SECRET_KEY` env var removed (document replacement if any)
- [ ] Changelog entry: `--gunicorn-opts` / `--waitress-opts` deprecated or removed (document alternative)
- [ ] Changelog entry: `mlflow.app` plugin entry point deprecated in favor of `mlflow.app.v2`
- [ ] Update deployment docs (Docker, Kubernetes, systemd) if they reference Gunicorn/Flask config
- [ ] Update CLAUDE.md references to Flask if any remain
- [ ] Migration guide for users who customized Flask config (secret key, Gunicorn workers, etc.)

### 7 -- Test Plan

**Principle:** Final gate. Must prove Flask is fully gone and nothing is broken. This is the most comprehensive test pass.

#### Dependency Verification
- [ ] `grep -r "from flask" mlflow/` returns zero results
- [ ] `grep -r "import flask" mlflow/` returns zero results
- [ ] `grep -r "from werkzeug" mlflow/` returns zero results (except if keeping `werkzeug` for other reasons)
- [ ] `grep -r "flask" pyproject.toml` returns zero results in `[project.dependencies]`
- [ ] `uv pip show flask` -> package not installed (verify it's not a transitive dep)
- [ ] `python -c "import flask"` -> `ModuleNotFoundError` (in the venv)

#### Full Test Suite
- [ ] `uv run pytest tests/` -- entire test suite passes (not just server tests)
- [ ] `uv run pre-commit run --all-files` -- clean

#### End-to-End Smoke Tests (Manual)
- [ ] **Server startup:** `uv run mlflow server` -> starts on Uvicorn, logs show no warnings
- [ ] **UI:** Browse to `http://localhost:5000` -> React UI loads, can navigate experiments/runs
- [ ] **Experiment lifecycle:**
  - `mlflow.create_experiment("migration-test")` -> experiment created
  - `mlflow.start_run()` -> run created
  - `mlflow.log_param("key", "value")` -> param recorded
  - `mlflow.log_metric("acc", 0.95)` -> metric recorded
  - `mlflow.log_artifact("some_file.txt")` -> artifact uploaded and downloadable
  - `mlflow.search_runs()` -> returns the run with correct data
- [ ] **Model registry:**
  - `mlflow.register_model()` -> model version created
  - `mlflow.search_registered_models()` -> returns the model
- [ ] **Auth:** `mlflow server --app-name basic-auth` -> signup page renders, login works, permissions enforced
- [ ] **Static files:** CSS/JS bundles load with correct cache headers
- [ ] **API docs:** `/docs` (Swagger UI) and `/redoc` serve OpenAPI documentation (if enabled)

#### Performance Final Gate
- [ ] Run `benchmarks/flask_to_fastapi_perf.py run` -> save as `results_milestone_7.json`
- [ ] Run `benchmarks/flask_to_fastapi_perf.py compare results_baseline_uvicorn.json results_milestone_7.json`
- [ ] All workloads within 5% throughput of baseline
- [ ] 10-minute sustained load test (50 concurrent users) -> RSS growth < 50MB (no memory leak)
- [ ] Document any improvements from async (especially concurrent workloads) for the migration retrospective

#### Backward Compatibility
- [ ] MLflow Python client (current version) works against the new server without changes
- [ ] MLflow Python client (previous major version) works against the new server (API contract preserved)
- [ ] REST API: all documented endpoints return the same JSON schema as before (spot-check 10 endpoints)
