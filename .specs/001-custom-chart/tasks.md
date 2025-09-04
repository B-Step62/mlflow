# Tasks: Natural Language Custom Chart Generation

**Input**: Design documents from `/.specs/001-custom-chart/`
**Prerequisites**: plan.md, research.md, data-model.md, contracts/, quickstart.md

## Strategy
Frontend-first development with mock responses, backend implementation after UI is working, save/load deferred to later phases.

## Path Conventions
- **Backend**: MLflow server extensions in `mlflow/server/`
- **Frontend**: React components in `mlflow/server/js/src/experiment-tracking/components/`
- **Tests**: `tests/` for backend, `mlflow/server/js/src/` for frontend tests

## Phase 1: Setup
- [ ] T001 Create frontend component structure in `mlflow/server/js/src/experiment-tracking/components/custom-charts/`

## Phase 2: Frontend Implementation (Frontend First)

### Core Frontend Components
- [ ] T002 [P] CustomChartGenerator component with text input and generate button in `mlflow/server/js/src/experiment-tracking/components/custom-charts/CustomChartGenerator.tsx`
- [ ] T003 [P] CustomChartDisplay component with Plotly integration in `mlflow/server/js/src/experiment-tracking/components/custom-charts/CustomChartDisplay.tsx`
- [ ] T004 [P] SecurityWarningModal component for code execution warning in `mlflow/server/js/src/experiment-tracking/components/custom-charts/SecurityWarningModal.tsx`
- [ ] T005 [P] GeneratedChartContainer component for safe code execution in `mlflow/server/js/src/experiment-tracking/components/custom-charts/GeneratedChartContainer.tsx`

### Frontend Hooks and Utils
- [ ] T006 [P] useCustomChartGeneration hook with mock responses in `mlflow/server/js/src/experiment-tracking/components/run-page/hooks/useCustomChartGeneration.ts`
- [ ] T007 [P] useCustomChartPolling hook for status updates in `mlflow/server/js/src/experiment-tracking/components/run-page/hooks/useCustomChartPolling.ts`
- [ ] T008 ChartApiUtils service with mock implementations in `mlflow/server/js/src/common/utils/ChartApiUtils.ts`

### UI Integration
- [ ] T009 Integrate CustomChartGenerator into RunViewMetricCharts in `mlflow/server/js/src/experiment-tracking/components/run-page/RunViewMetricCharts.tsx`
- [ ] T010 Add custom charts section to Model Metrics page navigation
- [ ] T011 Implement loading states and error handling in chart generation UI

## Phase 3: Frontend Tests (After Components Exist)
### Frontend Contract Tests
- [ ] T012 [P] Contract test for chart generation UI component in `mlflow/server/js/src/experiment-tracking/components/custom-charts/CustomChartGenerator.test.tsx`
- [ ] T013 [P] Contract test for chart display component in `mlflow/server/js/src/experiment-tracking/components/custom-charts/CustomChartDisplay.test.tsx`
- [ ] T014 [P] Contract test for security warning modal in `mlflow/server/js/src/experiment-tracking/components/custom-charts/SecurityWarningModal.test.tsx`

### UI Functionality Tests (Playwright MCP)
- [ ] T015 [P] Playwright test: Custom chart generator form interaction and validation
- [ ] T016 [P] Playwright test: Chart generation flow with mock backend responses
- [ ] T017 [P] Playwright test: Security warning modal acceptance workflow
- [ ] T018 [P] Playwright test: Chart display and interaction with generated visualizations

## Phase 4: Backend Mock Implementation

### Mock API Endpoints (Return Static Responses)
- [ ] T019 Add LiteLLM dependency to `pyproject.toml`
- [ ] T020 [P] Mock POST /charts/generate endpoint in `mlflow/server/handlers.py`
- [ ] T021 [P] Mock GET /charts/status/{request_id} endpoint in `mlflow/server/handlers.py`
- [ ] T022 [P] Mock chart generation service returning sample React code in `mlflow/server/charts/chart_generator.py`
- [ ] T023 [P] ChartRequest model in `mlflow/server/charts/chart_models.py`
- [ ] T024 Request validation and error handling for chart endpoints

### Backend Contract Tests (Mock Phase)
- [ ] T025 [P] Contract test POST /api/2.0/mlflow/charts/generate in `tests/server/test_chart_generation_api.py`
- [ ] T026 [P] Contract test GET /api/2.0/mlflow/charts/status/{request_id} in `tests/server/test_chart_status_api.py`
- [ ] T027 [P] Contract test POST /api/2.0/mlflow/charts/save in `tests/server/test_chart_save_api.py`
- [ ] T028 [P] Contract test GET /api/2.0/mlflow/charts/list/{experiment_id} in `tests/server/test_chart_list_api.py`

### Integration Tests (Now that components exist)
- [ ] T029 [P] Integration test: complete chart generation flow with mock LLM in `tests/integration/test_chart_generation_flow.py`
- [ ] T030 [P] Integration test: UI chart display with mock response in `mlflow/server/js/src/experiment-tracking/components/custom-charts/integration.test.tsx`

## Phase 5: LLM Integration (Replace Mock)

### System Prompt Engineering
- [ ] T031 [P] SystemPromptBuilder class in `mlflow/server/charts/system_prompt_builder.py`
- [ ] T032 [P] MLflow API documentation templates in `mlflow/server/charts/templates/`
- [ ] T033 [P] Component templates and patterns in `mlflow/server/charts/templates/`
- [ ] T034 [P] Code validation rules in `mlflow/server/charts/code_validator.py`

### LLM Service
- [ ] T035 ChartGeneratorService with LiteLLM integration in `mlflow/server/charts/chart_generator.py`
- [ ] T036 Context-aware prompt building with experiment metrics
- [ ] T037 Generated code validation and error recovery
- [ ] T038 Rate limiting and error handling for LLM requests

## Phase 6: Polish and Testing (Before Database)

### Unit Tests
- [ ] T039 [P] Unit tests for SystemPromptBuilder in `tests/server/charts/test_system_prompt_builder.py`
- [ ] T040 [P] Unit tests for ChartGeneratorService in `tests/server/charts/test_chart_generator.py`
- [ ] T041 [P] Unit tests for code validator in `tests/server/charts/test_code_validator.py`
- [ ] T042 [P] Unit tests for frontend hooks in `mlflow/server/js/src/experiment-tracking/components/run-page/hooks/`

### Performance and Security
- [ ] T043 Performance tests for chart generation (<5 minutes)
- [ ] T044 Security audit of code execution sandbox
- [ ] T045 Rate limiting tests and abuse prevention
- [ ] T046 Memory and resource usage tests

### End-to-End Testing (Playwright MCP)
- [ ] T047 [P] Playwright test: Complete chart generation workflow with real LLM integration
- [ ] T048 [P] Playwright test: Error handling and recovery scenarios
- [ ] T049 [P] Playwright test: Performance and responsiveness under load
- [ ] T050 [P] Playwright test: Cross-browser compatibility for chart rendering

### Documentation and Examples
- [ ] T051 [P] Update quickstart.md with working examples
- [ ] T052 [P] API documentation in `docs/` 
- [ ] T053 [P] Error message documentation and troubleshooting
- [ ] T054 Example chart templates and prompt patterns

## Phase 7: Database Layer (After Polish and Testing)

### Data Models
- [ ] T055 [P] ChartRequest entity in `mlflow/server/charts/chart_models.py`
- [ ] T056 Database schema migration for chart_requests table in `mlflow/store/db_migrations/`
- [ ] T057 Chart request CRUD operations in `mlflow/server/charts/chart_storage.py`

## Phase 8: Chart Persistence (Final Phase)

### Save/Load Infrastructure  
- [ ] T058 [P] GeneratedChart entity and database schema in `mlflow/server/charts/chart_models.py`
- [ ] T059 [P] Chart artifact storage integration in `mlflow/server/charts/chart_storage.py`
- [ ] T060 [P] SavedChartsDropdown component in `mlflow/server/js/src/experiment-tracking/components/custom-charts/SavedChartsDropdown.tsx`
- [ ] T061 [P] Chart save/load API endpoints in `mlflow/server/handlers.py`

### UI for Saved Charts
- [ ] T062 [P] SaveCustomChartModal component in `mlflow/server/js/src/experiment-tracking/components/modals/SaveCustomChartModal.tsx`
- [ ] T063 [P] ViewChartCodeModal component in `mlflow/server/js/src/experiment-tracking/components/modals/ViewChartCodeModal.tsx`
- [ ] T064 useCustomChartStorage hook in `mlflow/server/js/src/experiment-tracking/components/run-page/hooks/useCustomChartStorage.ts`
- [ ] T065 Integrate saved charts UI with chart generation workflow

## Dependencies

### Critical Path
- Setup (T001) before everything
- Frontend implementation (T002-T011) FIRST
- Frontend tests (T012-T018) after frontend components exist
- Backend mock implementation (T019-T024) after frontend is working
- Backend tests (T025-T028) with mock implementation
- Integration tests (T029-T030) after both frontend and backend mocks exist
- LLM integration (T031-T038) to replace mocks
- Polish and testing (T039-T054) before database
- Database layer (T055-T057) after core functionality is polished
- Chart persistence (T058-T065) final phase

### Parallel Opportunities
- Frontend and backend mock development can happen in parallel after T030
- Component tests (T012-T014) can run together
- Playwright UI tests (T015-T018) can run together
- API contract tests (T025-T028) can run together  
- Individual components (T002-T005) can be built in parallel
- Unit tests (T039-T042) can be written in parallel
- End-to-end Playwright tests (T047-T050) can run together

### Deferred Dependencies
- Save/load features (T058-T065) depend on core functionality
- Polish phase (T039-T054) depends on complete implementation

## Parallel Execution Examples

### Phase 3 - Frontend Tests Together
```bash
# Launch contract tests in parallel
Task: "Contract test for chart generation UI component in CustomChartGenerator.test.tsx"
Task: "Contract test for chart display component in CustomChartDisplay.test.tsx" 
Task: "Contract test for security warning modal in SecurityWarningModal.test.tsx"
```

### Phase 2 - Frontend Components
```bash
# Build core components in parallel
Task: "CustomChartGenerator component with text input in CustomChartGenerator.tsx"
Task: "CustomChartDisplay component with Plotly in CustomChartDisplay.tsx"
Task: "SecurityWarningModal component in SecurityWarningModal.tsx"
Task: "useCustomChartGeneration hook in useCustomChartGeneration.ts"
```

## Validation Checklist

- [x] All API endpoints have contract tests
- [x] All entities have model creation tasks  
- [x] All tests come before implementation
- [x] Frontend developed with mocks before backend
- [x] Save/load functionality deferred to later phases
- [x] Parallel tasks use different files
- [x] Each task specifies exact file path
- [x] TDD approach: failing tests before implementation

## Notes

- **Mock-first approach**: Frontend uses static mock responses initially
- **Iterative testing**: Each component has tests that must fail first
- **Deferred complexity**: Save/load features added after core functionality works
- **Security focus**: Code execution warnings and validation throughout
- **Performance monitoring**: Chart generation time limits enforced