# Implementation Plan: Natural Language Custom Chart Generation

**Branch**: `001-custom-chart` | **Date**: 2025-09-04 | **Spec**: `/.specs/001-custom-chart/spec.md`
**Input**: Feature specification from `/.specs/001-custom-chart/spec.md`

## Execution Flow (/plan command scope)
```
1. Load feature spec from Input path
   → If not found: ERROR "No feature spec at {path}"
2. Fill Technical Context (scan for NEEDS CLARIFICATION)
   → Detect Project Type from context (web=frontend+backend, mobile=app+api)
   → Set Structure Decision based on project type
3. Evaluate Constitution Check section below
   → If violations exist: Document in Complexity Tracking
   → If no justification possible: ERROR "Simplify approach first"
   → Update Progress Tracking: Initial Constitution Check
4. Execute Phase 0 → research.md
   → If NEEDS CLARIFICATION remain: ERROR "Resolve unknowns"
5. Execute Phase 1 → contracts, data-model.md, quickstart.md, agent-specific template file (e.g., `CLAUDE.md` for Claude Code, `.github/copilot-instructions.md` for GitHub Copilot, or `GEMINI.md` for Gemini CLI).
6. Re-evaluate Constitution Check section
   → If new violations: Refactor design, return to Phase 1
   → Update Progress Tracking: Post-Design Constitution Check
7. Plan Phase 2 → Describe task generation approach (DO NOT create tasks.md)
8. STOP - Ready for /tasks command
```

**IMPORTANT**: The /plan command STOPS at step 7. Phases 2-4 are executed by other commands:
- Phase 2: /tasks command creates tasks.md
- Phase 3-4: Implementation execution (manual or via tools)

## Summary
Implement a natural language interface for creating custom charts in MLflow UI. Users can describe desired visualizations in plain text, and the system will leverage LLM to generate appropriate chart code using Plotly, fetch data via MLflow REST APIs, and render the visualization in the browser. The feature includes chart persistence as artifacts and security warnings for loaded custom code.

## Technical Context
**Language/Version**: Python 3.10+ (backend), TypeScript/React (frontend)
**Primary Dependencies**: LiteLLM (LLM SDK), Plotly (charting), Flask/FastAPI (backend), React (frontend)
**Storage**: SQL backend (PostgreSQL/MySQL/SQLite), MLflow Artifact Store
**Testing**: pytest (backend), Jest/React Testing Library (frontend)
**Target Platform**: MLflow tracking server with SQL backend
**Project Type**: web - MLflow UI feature with backend API
**Performance Goals**: Chart generation within 5 minutes
**Constraints**: Must work with existing MLflow REST API patterns, a security warning for custom JS execution
**Scale/Scope**: Support all MLflow users, integrate with existing Model Metrics page

## Constitution Check
*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

**Simplicity**:
- Projects: 2 (backend API extensions, frontend UI components)
- Using framework directly? Yes - Flask/FastAPI, React components
- Single data model? Yes - ChartRequest, GeneratedChart entities
- Avoiding patterns? Yes - direct API calls, no unnecessary abstractions

**Architecture**:
- EVERY feature as library? Yes - chart_generation module
- Libraries listed: 
  - mlflow.chart_generation - Core chart generation logic
  - mlflow.llm_integration - LLM interaction via LiteLLM
- CLI per library: mlflow charts generate --prompt "..." --run-id "..."  
- Library docs: Yes - API documentation and user guide

**Testing (NON-NEGOTIABLE)**:
- RED-GREEN-Refactor cycle enforced? Yes - tests written first
- Git commits show tests before implementation? Yes
- Order: Contract→Integration→E2E→Unit strictly followed? Yes
- Real dependencies used? Yes - real SQL DB, actual LLM calls in integration tests
- Integration tests for: new libraries, contract changes, shared schemas? Yes
- FORBIDDEN: Implementation before test, skipping RED phase

**Observability**:
- Structured logging included? Yes - for LLM calls, chart generation
- Frontend logs → backend? Yes - error reporting to backend
- Error context sufficient? Yes - request ID, user context, LLM response

**Versioning**:
- Version number assigned? Follow MLflow versioning
- BUILD increments on every change? Yes
- Breaking changes handled? Backward compatible API design

## Project Structure

### Documentation (this feature)
```
specs/[###-feature]/
├── plan.md              # This file (/plan command output)
├── research.md          # Phase 0 output (/plan command)
├── data-model.md        # Phase 1 output (/plan command)
├── quickstart.md        # Phase 1 output (/plan command)
├── contracts/           # Phase 1 output (/plan command)
└── tasks.md             # Phase 2 output (/tasks command - NOT created by /plan)
```

### Source Code (repository root)
```
# Option 1: Single project (DEFAULT)
src/
├── models/
├── services/
├── cli/
└── lib/

tests/
├── contract/
├── integration/
└── unit/

# Option 2: Web application (when "frontend" + "backend" detected)
backend/
├── src/
│   ├── models/
│   ├── services/
│   └── api/
└── tests/

frontend/
├── src/
│   ├── components/
│   ├── pages/
│   └── services/
└── tests/

# Option 3: Mobile + API (when "iOS/Android" detected)
api/
└── [same as backend above]

ios/ or android/
└── [platform-specific structure]
```

**Structure Decision**: Option 2 (Web application) - Frontend React components + Backend API extensions

## LLM System Prompt Design

### System Prompt Structure

The LLM must generate React components that work seamlessly with MLflow's architecture. The system prompt should include:

#### 1. **MLflow Frontend Patterns**
```typescript
// Required imports and component structure
import { useDesignSystemTheme } from '@databricks/design-system';
import { LazyPlot } from 'path/to/LazyPlot';
import { getJson } from 'common/utils/FetchUtils';

// Standard React functional component with hooks
const GeneratedChart = ({ runUuid, experimentId }) => {
  const { theme } = useDesignSystemTheme();
  // Component logic...
};
```

#### 2. **Available API Endpoints**
```javascript
// Get run metrics
getJson({ relativeUrl: `ajax-api/2.0/mlflow/runs/get`, data: { run_uuid: runUuid }})

// Get metric history  
getJson({ relativeUrl: `ajax-api/2.0/mlflow/metrics/get-history`, data: { 
  run_uuid: runUuid, 
  metric_key: 'accuracy' 
}})

// Search runs in experiment
getJson({ relativeUrl: `ajax-api/2.0/mlflow/runs/search`, data: {
  experiment_ids: [experimentId],
  filter: 'metrics.accuracy > 0.5'
}})

// Get experiment details
getJson({ relativeUrl: `ajax-api/2.0/mlflow/experiments/get`, data: { experiment_id: experimentId }})
```

#### 3. **Data Structures**
```typescript
// Metric entity structure
type MetricEntity = {
  key: string;
  value: number;
  timestamp: number;
  step: number;
};

// Run data structure  
type RunData = {
  info: {
    run_uuid: string;
    run_name: string;
    status: 'RUNNING' | 'FINISHED' | 'FAILED';
    start_time: number;
    end_time: number;
  };
  data: {
    metrics: MetricEntity[];
    params: KeyValueEntity[];
    tags: KeyValueEntity[];
  };
};
```

#### 4. **Plotly Configuration Templates**
```typescript
// Standard MLflow chart layout
const createPlotlyLayout = (theme) => ({
  margin: { l: 50, r: 50, b: 50, t: 50 },
  paper_bgcolor: theme.colors.backgroundPrimary,
  plot_bgcolor: theme.colors.backgroundPrimary,
  font: { color: theme.colors.textPrimary, size: 12 },
  xaxis: { 
    gridcolor: theme.colors.border,
    title: { font: { size: 14 } }
  },
  yaxis: { 
    gridcolor: theme.colors.border,
    title: { font: { size: 14 } }
  },
  showlegend: true,
  legend: { 
    bgcolor: 'transparent',
    font: { color: theme.colors.textPrimary }
  }
});

// Standard trace configuration
const createTrace = (data, name, color) => ({
  x: data.map(d => d.step),
  y: data.map(d => d.value), 
  type: 'scatter',
  mode: 'lines+markers',
  name: name,
  line: { color: color },
  marker: { size: 6 }
});
```

#### 5. **Error Handling Patterns**
```typescript
// Standard error handling
const [data, setData] = useState(null);
const [loading, setLoading] = useState(true);
const [error, setError] = useState(null);

useEffect(() => {
  getJson({ relativeUrl: 'ajax-api/2.0/mlflow/runs/get', data: { run_uuid: runUuid }})
    .then(response => {
      if (!response.run?.data?.metrics) {
        throw new Error('No metrics found for this run');
      }
      setData(response.run);
    })
    .catch(err => setError(err.message))
    .finally(() => setLoading(false));
}, [runUuid]);

if (loading) return <div>Loading chart...</div>;
if (error) return <div>Error: {error}</div>;
```

#### 6. **Theme Integration Requirements**
```typescript
// Always use theme colors - never hardcoded colors
const { theme } = useDesignSystemTheme();

// Color palette for multiple series
const getSeriesColor = (index) => {
  const colors = [
    theme.colors.primary,
    theme.colors.lime,
    theme.colors.orange, 
    theme.colors.purple,
    theme.colors.cyan
  ];
  return colors[index % colors.length];
};

// Responsive sizing
const containerStyle = {
  width: '100%',
  height: '400px',
  padding: theme.spacing.md,
  backgroundColor: theme.colors.backgroundSecondary,
  border: `1px solid ${theme.colors.border}`
};
```

### Prompt Engineering Strategy

#### **Complete System Prompt Template:**
```
You are a MLflow chart code generator. Generate React components that fetch MLflow data and create Plotly visualizations.

REQUIREMENTS:
1. Use ONLY the provided MLflow API endpoints
2. Follow the exact component structure template
3. Handle loading states and errors properly  
4. Use theme colors and spacing - no hardcoded values
5. Generate complete, self-contained components
6. Include proper TypeScript types

AVAILABLE APIs:
[Include full API documentation with examples]

REQUIRED IMPORTS:
import React, { useState, useEffect } from 'react';
import { useDesignSystemTheme } from '@databricks/design-system';
import { LazyPlot } from '../LazyPlot';
import { getJson } from '../../../common/utils/FetchUtils';

COMPONENT TEMPLATE:
[Include complete working template]

DATA STRUCTURES:
[Include complete type definitions]

PLOTLY CONFIG:
[Include themed layout and trace templates]

USER REQUEST: {user_prompt}
AVAILABLE METRICS: {available_metrics}
RUN CONTEXT: {run_uuid: "...", experiment_id: "..."}

Generate a complete React component that satisfies the user request.
```

## Architecture Design

### System Overview
```
┌─────────────────────────────────────────────────────────────────┐
│                    MLflow UI (React)                           │
├─────────────────────────────────────────────────────────────────┤
│  Model Metrics Page                                             │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │ Custom Chart Component                                      │ │
│  │ ┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐ │ │
│  │ │ Text Input      │ │ Generate Button │ │ Saved Charts    │ │ │
│  │ └─────────────────┘ └─────────────────┘ │ Dropdown        │ │ │
│  │                                         └─────────────────┘ │ │
│  │ ┌─────────────────────────────────────────────────────────┐ │ │
│  │ │ Chart Display Area (Plotly Container)                  │ │ │
│  │ └─────────────────────────────────────────────────────────┘ │ │
│  └─────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
                                    │
                              REST API Calls
                                    │
┌─────────────────────────────────────────────────────────────────┐
│                MLflow Tracking Server (Python)                 │
├─────────────────────────────────────────────────────────────────┤
│  Chart Generation Service                                       │
│  ┌─────────────────┐ ┌─────────────────┐ ┌─────────────────────┐│
│  │ Request Handler │ │ LLM Integration │ │ Chart Storage       ││
│  │                 │ │ (LiteLLM)       │ │ Service             ││
│  └─────────────────┘ └─────────────────┘ └─────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
                                    │
                           ┌────────┴────────┐
                           │                 │
┌─────────────────────────────┐  ┌─────────────────────────────┐
│     SQL Database            │  │     Artifact Store          │
│ ┌─────────────────────────┐ │  │ ┌─────────────────────────┐ │
│ │ chart_requests          │ │  │ │ experiment_charts/      │ │
│ │ generated_charts        │ │  │ │ └─ chart_id.js          │ │
│ └─────────────────────────┘ │  │ └─────────────────────────┘ │
└─────────────────────────────┘  └─────────────────────────────┘
```

### Component Architecture

#### Frontend Components
```
mlflow/server/js/src/experiment-tracking/components/
├── run-page/
│   ├── RunViewCustomCharts.tsx       # Main custom charts section
│   └── hooks/
│       ├── useCustomChartGeneration.ts  # LLM chart generation
│       ├── useCustomChartStorage.ts     # Experiment-level storage
│       └── useCustomChartPolling.ts     # Status polling
├── custom-charts/
│   ├── CustomChartGenerator.tsx      # Text input + generation
│   ├── CustomChartDisplay.tsx        # Plotly chart renderer  
│   ├── SavedChartsDropdown.tsx       # Chart selection UI
│   ├── SecurityWarningModal.tsx      # Code execution warning
│   └── GeneratedChartContainer.tsx   # Chart execution sandbox
└── modals/
    ├── SaveCustomChartModal.tsx      # Save chart dialog
    └── ViewChartCodeModal.tsx        # Code inspection modal
```

#### Backend Services
```
mlflow/server/
├── handlers.py                       # Extend existing handlers
│   └── + add chart generation endpoints
├── fastapi_app.py                    # Extend existing FastAPI routes
│   └── + add /charts/* routes
├── charts/                           # New module
│   ├── __init__.py
│   ├── chart_generator.py            # LLM integration + prompt builder
│   ├── chart_storage.py              # Experiment artifact operations
│   ├── chart_models.py               # Pydantic models
│   ├── system_prompt_builder.py      # Builds context-aware prompts
│   └── code_validator.py             # Validates generated components
└── js/src/common/utils/
    └── ChartApiUtils.ts              # Frontend API client
```

### Backend LLM Integration

#### **System Prompt Builder**
```python
class SystemPromptBuilder:
    def __init__(self, experiment_id: str, run_uuid: str = None):
        self.experiment_id = experiment_id
        self.run_uuid = run_uuid
        
    def build_prompt(self, user_request: str) -> str:
        # 1. Get available metrics for context
        available_metrics = self._get_experiment_metrics()
        
        # 2. Get run/experiment metadata
        context = self._build_context()
        
        # 3. Load MLflow API documentation
        api_docs = self._load_api_documentation()
        
        # 4. Load component templates
        templates = self._load_component_templates()
        
        # 5. Assemble complete prompt
        return self._assemble_prompt(
            user_request, available_metrics, context, api_docs, templates
        )
    
    def _get_experiment_metrics(self) -> List[str]:
        """Get all metric keys used in the experiment"""
        # Query tracking store for unique metric keys
        
    def _build_context(self) -> dict:
        """Build run/experiment context for the LLM"""
        return {
            'experiment_id': self.experiment_id,
            'run_uuid': self.run_uuid,
            'available_endpoints': self._get_api_endpoints(),
            'theme_colors': self._get_theme_specification(),
            'data_structures': self._get_type_definitions()
        }
```

#### **Code Validator**
```python
class GeneratedCodeValidator:
    def validate_component(self, code: str) -> ValidationResult:
        """Validate generated React component"""
        issues = []
        
        # 1. Check required imports
        if 'useDesignSystemTheme' not in code:
            issues.append("Missing required theme import")
            
        # 2. Check API usage
        if 'getJson' not in code:
            issues.append("No data fetching detected")
            
        # 3. Check hardcoded values
        if re.search(r'#[0-9a-f]{6}|rgb\(', code):
            issues.append("Contains hardcoded colors")
            
        # 4. Check component structure  
        if 'useState' not in code or 'useEffect' not in code:
            issues.append("Missing React hooks")
            
        # 5. Validate JavaScript syntax
        try:
            # Use esprima or similar to parse JS/TS
            self._validate_syntax(code)
        except SyntaxError as e:
            issues.append(f"Syntax error: {e}")
            
        return ValidationResult(
            valid=len(issues) == 0,
            issues=issues,
            code=code
        )
```

#### **Chart Generator Service**
```python
class ChartGeneratorService:
    def __init__(self):
        self.llm_client = LiteLLM()
        self.prompt_builder = SystemPromptBuilder
        self.validator = GeneratedCodeValidator()
    
    async def generate_chart(self, request: ChartGenerationRequest) -> str:
        # 1. Build context-aware system prompt
        prompt_builder = self.prompt_builder(
            request.experiment_id, 
            request.run_uuid
        )
        system_prompt = prompt_builder.build_prompt(request.user_prompt)
        
        # 2. Generate code with LLM
        response = await self.llm_client.acomplete(
            model=os.getenv('MLFLOW_LLM_ENGINE_MODEL', 'openai:/gpt-4'),
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": request.user_prompt}
            ],
            temperature=0.1,  # Low temperature for consistent code
            max_tokens=2000
        )
        
        generated_code = response.choices[0].message.content
        
        # 3. Validate generated code
        validation = self.validator.validate_component(generated_code)
        if not validation.valid:
            # Attempt to fix common issues or regenerate
            raise ChartGenerationError(f"Validation failed: {validation.issues}")
            
        # 4. Test compilation (optional)
        if self._should_test_compilation():
            await self._test_component_compilation(generated_code)
            
        return generated_code
```

### Data Flow

#### Chart Generation Flow
```
1. User Input
   └─> Frontend: CustomChartGenerator
       └─> POST /api/2.0/mlflow/charts/generate
           └─> Backend: ChartRequestHandler
               └─> ChartGenerator.generate_chart()
                   ├─> LiteLLM API call
                   ├─> Parse LLM response
                   ├─> Validate generated code
                   └─> Store result in database
               └─> Return request_id
           └─> Frontend: Start polling
               └─> GET /api/2.0/mlflow/charts/status/{id}
                   └─> Return chart when ready
```

#### Chart Persistence Flow
```
1. Save Chart
   └─> POST /api/2.0/mlflow/charts/save
       └─> Store chart code in artifact store
       └─> Save metadata in database
       └─> Return chart_id and artifact_uri

2. Load Chart
   └─> GET /api/2.0/mlflow/charts/list/{experiment_id}
       └─> Return available charts
   └─> User selects chart
       └─> GET /api/2.0/mlflow/charts/{chart_id}
           └─> Return chart code and metadata
       └─> SecurityWarningDialog displays
       └─> User approves → Execute chart in browser
```

### Integration Points

#### With Existing MLflow UI
- **Location**: New section in `RunViewMetricCharts` component
- **Integration**: Extends existing runs-charts infrastructure
- **Styling**: Uses `@databricks/design-system` components
- **State Management**: Integrates with existing Redux store and React Query
- **Charting**: Leverages existing Plotly integration in LazyPlot.tsx

#### With MLflow Backend
- **Authentication**: Uses existing MLflow tracking server auth
- **Authorization**: Respects existing experiment permissions
- **Database**: Adds new tables to existing tracking store schema
- **Artifacts**: Uses existing MLflow artifact store APIs
- **API Pattern**: Follows existing `/api/2.0/mlflow/*` REST patterns

#### With External Services
- **LLM Provider**: Configured via environment variables
- **Rate Limiting**: Implements standard rate limiting patterns
- **Error Handling**: Follows MLflow error response format

### Security Architecture

#### Code Execution Safety
```
Generated JavaScript
    ↓
Browser Sandbox
    ├─> Limited DOM access
    ├─> No file system access
    ├─> No network access (except MLflow APIs)
    └─> User consent required
```

#### Authentication/Authorization
- **Chart Generation**: Requires valid MLflow session
- **Chart Storage**: User can only save to experiments they can write to
- **Chart Loading**: User can only load charts from experiments they can read
- **Cross-Experiment**: Charts not shared between different experiments

### Performance Design

#### LLM Integration
- **Async Processing**: Chart generation runs asynchronously
- **Polling Strategy**: Frontend polls status every 2 seconds
- **Timeout Handling**: 5-minute timeout with user notification
- **Rate Limiting**: Max 5 requests per user per minute

#### Chart Rendering
- **Lazy Loading**: Plotly.js loaded only when needed
- **Data Limits**: Automatically sample large datasets to 1000 points
- **Memory Management**: Clean up chart instances when unmounting
- **Caching**: Cache chart metadata, not generated code

### Deployment Architecture

#### Development
```
mlflow server --dev
├─> Backend serves both API and React dev server
├─> Hot reloading for frontend changes
└─> SQLite for local development database
```

#### Production
```
MLflow Server
├─> Serves production React build
├─> PostgreSQL/MySQL for persistence
├─> Artifact store (S3/GCS/Azure/Local)
└─> LLM provider API integration
```

## Phase 0: Outline & Research
1. **Extract unknowns from Technical Context** above:
   - For each NEEDS CLARIFICATION → research task
   - For each dependency → best practices task
   - For each integration → patterns task

2. **Generate and dispatch research agents**:
   ```
   For each unknown in Technical Context:
     Task: "Research {unknown} for {feature context}"
   For each technology choice:
     Task: "Find best practices for {tech} in {domain}"
   ```

3. **Consolidate findings** in `research.md` using format:
   - Decision: [what was chosen]
   - Rationale: [why chosen]
   - Alternatives considered: [what else evaluated]

**Output**: research.md with all NEEDS CLARIFICATION resolved

## Phase 1: Design & Contracts
*Prerequisites: research.md complete*

1. **Extract entities from feature spec** → `data-model.md`:
   - Entity name, fields, relationships
   - Validation rules from requirements
   - State transitions if applicable

2. **Generate API contracts** from functional requirements:
   - For each user action → endpoint
   - Use standard REST/GraphQL patterns
   - Output OpenAPI/GraphQL schema to `/contracts/`

3. **Generate contract tests** from contracts:
   - One test file per endpoint
   - Assert request/response schemas
   - Tests must fail (no implementation yet)

4. **Extract test scenarios** from user stories:
   - Each story → integration test scenario
   - Quickstart test = story validation steps

5. **Update agent file incrementally** (O(1) operation):
   - Run `/.scripts/update-agent-context.sh [claude|gemini|copilot]` for your AI assistant
   - If exists: Add only NEW tech from current plan
   - Preserve manual additions between markers
   - Update recent changes (keep last 3)
   - Keep under 150 lines for token efficiency
   - Output to repository root

**Output**: data-model.md, /contracts/*, failing tests, quickstart.md, agent-specific file

## Phase 2: Task Planning Approach
*This section describes what the /tasks command will do - DO NOT execute during /plan*

**Task Generation Strategy**:
- Load `/.templates/tasks-template.md` as base
- Generate tasks from Phase 1 design docs (contracts, data model, quickstart)
- Each contract → contract test task [P]
- Each entity → model creation task [P] 
- Each user story → integration test task
- Implementation tasks to make tests pass

**Ordering Strategy**:
- TDD order: Tests before implementation 
- Dependency order: Models before services before UI
- Mark [P] for parallel execution (independent files)

**Estimated Output**: 25-30 numbered, ordered tasks in tasks.md

**IMPORTANT**: This phase is executed by the /tasks command, NOT by /plan

## Phase 3+: Future Implementation
*These phases are beyond the scope of the /plan command*

**Phase 3**: Task execution (/tasks command creates tasks.md)  
**Phase 4**: Implementation (execute tasks.md following constitutional principles)  
**Phase 5**: Validation (run tests, execute quickstart.md, performance validation)

## Complexity Tracking
*Fill ONLY if Constitution Check has violations that must be justified*

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| [e.g., 4th project] | [current need] | [why 3 projects insufficient] |
| [e.g., Repository pattern] | [specific problem] | [why direct DB access insufficient] |


## Progress Tracking
*This checklist is updated during execution flow*

**Phase Status**:
- [x] Phase 0: Research complete (/plan command)
- [x] Phase 1: Design complete (/plan command)
- [x] Phase 2: Task planning complete (/plan command - describe approach only)
- [ ] Phase 3: Tasks generated (/tasks command)
- [ ] Phase 4: Implementation complete
- [ ] Phase 5: Validation passed

**Gate Status**:
- [x] Initial Constitution Check: PASS
- [x] Post-Design Constitution Check: PASS
- [x] All NEEDS CLARIFICATION resolved
- [ ] Complexity deviations documented

---
*Based on Constitution v2.1.1 - See `/.memory/constitution.md`*