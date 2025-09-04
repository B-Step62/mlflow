# Feature Specification: Natural Language Custom Chart Generation

**Feature Branch**: `001-custom-chart`
**Created**: 2025-09-04
**Status**: Draft
**Input**: User description: "I want to add a feature in MLflow that where we allow users to define a custom chart via natural language (using LLM) on MLflow UI, which queries metrics and artifacts. For example, the \"Model metrics\" page will have a text box where users can type like \"Plot BLUE score transition per step for both training and validation in one graph.\", then MLflow will run LLM query in backend to create a custom ReAct component (or javascript) to render it (it can use framework like Plotly and fetch data using MLflow's REST API), and return it to frontend."

## Execution Flow (main)
```
1. Parse user description from Input
   → If empty: ERROR "No feature description provided"
2. Extract key concepts from description
   → Identify: actors (MLflow users), actions (create charts via text), data (metrics, artifacts), constraints (natural language)
3. For each unclear aspect:
   → Mark with [NEEDS CLARIFICATION: specific question]
4. Fill User Scenarios & Testing section
   → If no clear user flow: ERROR "Cannot determine user scenarios"
5. Generate Functional Requirements
   → Each requirement must be testable
   → Mark ambiguous requirements
6. Identify Key Entities (if data involved)
7. Run Review Checklist
   → If any [NEEDS CLARIFICATION]: WARN "Spec has uncertainties"
   → If implementation details found: ERROR "Remove tech details"
8. Return: SUCCESS (spec ready for planning)
```

---

## ⚡ Quick Guidelines
- ✅ Focus on WHAT users need and WHY
- ❌ Avoid HOW to implement (no tech stack, APIs, code structure)
- 👥 Written for business stakeholders, not developers

### Section Requirements
- **Mandatory sections**: Must be completed for every feature
- **Optional sections**: Include only when relevant to the feature
- When a section doesn't apply, remove it entirely (don't leave as "N/A")

### For AI Generation
When creating this spec from a user prompt:
1. **Mark all ambiguities**: Use [NEEDS CLARIFICATION: specific question] for any assumption you'd need to make
2. **Don't guess**: If the prompt doesn't specify something (e.g., "login system" without auth method), mark it
3. **Think like a tester**: Every vague requirement should fail the "testable and unambiguous" checklist item
4. **Common underspecified areas**:
   - User types and permissions
   - Data retention/deletion policies  
   - Performance targets and scale
   - Error handling behaviors
   - Integration requirements
   - Security/compliance needs

---

## User Scenarios & Testing *(mandatory)*

### Primary User Story
As an MLflow user analyzing model performance, I want to create custom visualizations by describing what I want to see in natural language, so that I can quickly explore and present metrics and artifacts without writing code or manually configuring charts.

### Acceptance Scenarios
1. **Given** a user is on the Model Metrics page with logged metrics available, **When** they type "Plot BLEU score transition per step for both training and validation in one graph" in the natural language input field, **Then** the system generates and displays a line chart showing both training and validation BLEU scores over steps.
2. **When** a user has entered a natural language chart request, **Then** MLflow frontend logic will invoke LLM query in backend to generate the chart, and return the chart to frontend. The LLM model and API key should be specified in the tracking server start up as environment variables.
3. **When** user specified LLM model, it should be a format of "<model_provider>:/<model_name>", e.g., "anthropic/claude-3-5-sonnet", following the other part of MLflow.
4. **When** frontend logic invoke LLM query in backend, it should use LLM SDK like LiteLLM to invoke the LLM model. The system prompt should include available MLflow REST APIs, the data format, and other details required to generate the chart code.
5. **When** frontend logic submit the request to backend and until the chart is generated, it should show a loading indicator. The frontend should periodically check the status of the request. The backend should expose a REST API to get the 6tatus of the request.
7. The chart logic should use a flexible, simple, and popular library like Plotly.
8. **Given** a user requests a chart for metrics that don't exist, **When** the system processes the request, **Then** the user receives a clear message explaining which metrics are not available.
9. **Given** a user has generated a custom chart, **When** they want to save or share it, **Then** it should be saved as a special artifact in the run, loaded from the artifact store when the run is loaded next time.
10. **When** the saved chart is loaded, **Then** it should display a security warning message that it will run a custom javascript code to render the chart. It may render the full source code of the chart if user wants to.

### Edge Cases
- What happens when the natural language request is ambiguous or unclear?
  -> It should display a clear message to the user to refine the request with recommendations.
- How does system handle requests for metrics that partially exist (e.g., training data exists but not validation)?
  -> It should display a clear message to the user to refine the request with recommendations.
- What happens when the user requests a chart type that doesn't match the data (e.g., pie chart for time series)?
  -> It should display a clear message to the user to refine the request with recommendations.
- How does the system handle very large datasets that could make charts unreadable?
  -> It should display a clear message to the user to refine the request with recommendations.
- What happens when multiple users try to generate charts simultaneously?
  -> We don't consider this in P0.
- How does the system handle requests in supported languages - English only or multilingual?
  -> English is must. Others are optional, but I believe LLM handles non-English well.

## Requirements *(mandatory)*

### Functional Requirements
- **FR-001**: System MUST provide a text input field on the Model Metrics page where users can enter natural language descriptions of desired charts
- **FR-002**: System MUST interpret natural language requests and identify the requested metrics, artifacts, chart types, and visualization parameters
- **FR-003**: System MUST generate appropriate visualizations based on the natural language input and available data
- **FR-004**: System MUST display generated charts directly in the UI without requiring page refresh
- **FR-005**: System MUST provide clear error messages when requested data is unavailable or the request cannot be processed, with recommendations to refine the request
- **FR-006**: System MUST support common chart types including line charts, bar charts, scatter plots, and other visualization types appropriate for the data
- **FR-007**: System MUST handle requests for both metrics and artifacts data
- **FR-008**: System MUST validate that generated visualizations are appropriate for the data type (numerical, categorical, time-series)
- **FR-009**: Users MUST be able to modify their natural language request and regenerate the chart
- **FR-010**: System MUST save generated charts as artifacts in the run, allowing them to be loaded when the run is accessed later
- **FR-011**: System MUST display a loading indicator while processing chart generation requests
- **FR-012**: System MUST handle authentication and authorization to ensure users can only visualize data they have access to
- **FR-013**: Generated charts MUST be interactive with standard visualization capabilities
- **FR-014**: System MUST support combining multiple metrics/artifacts in a single visualization when requested
- **FR-015**: System MUST handle chart generation for very large datasets appropriately, providing clear messages when data needs to be refined
- **FR-016**: System MUST display a security warning when loading saved charts, informing users that custom code will be executed
- **FR-017**: System MUST allow users to view the source code of saved charts before execution
- **FR-018**: System MUST support chart generation model configuration through environment variables at server startup
- **FR-019**: System MUST provide status checking capability for in-progress chart generation requests
- **FR-020**: System MUST handle ambiguous or unclear natural language requests with clear feedback and recommendations
- **FR-021**: System MUST support English language requests as a minimum requirement
- **FR-022**: System MUST handle partial data availability scenarios with appropriate user messaging

### Key Entities *(include if feature involves data)*
- **Chart Request**: Natural language text describing the desired visualization, associated user, timestamp
- **Generated Chart**: The visualization created from a request, including chart configuration, data sources used, rendering information
- **Metrics Data**: Time-series or scalar metrics logged in MLflow experiments that can be visualized
- **Artifacts Data**: Files and data stored as MLflow artifacts that can be included in visualizations
- **Chart Generation Session**: Context maintaining the conversation/interaction history for iterative chart refinement

---

## Review & Acceptance Checklist
*GATE: Automated checks run during main() execution*

### Content Quality
- [x] Focused on user value and business needs
- [x] All mandatory sections completed

### Requirement Completeness
- [x] No [NEEDS CLARIFICATION] markers remain
- [x] Requirements are testable and unambiguous
- [x] Success criteria are measurable
- [x] Scope is clearly bounded
- [x] Dependencies and assumptions identified

---

## Execution Status
*Updated by main() during processing*

- [x] User description parsed
- [x] Key concepts extracted
- [x] Ambiguities marked
- [x] User scenarios defined
- [x] Requirements generated
- [x] Entities identified
- [ ] Review checklist passed (contains implementation details)

---

## Areas Requiring Clarification

The following aspects need to be clarified before implementation can begin:

1. **Performance Requirements**:
   - Expected response time for chart generation (5 seconds? 30 seconds?)
   - Maximum data points that can be visualized before performance degrades
   - Rate limiting requirements per user/session to prevent abuse

2. **Concurrent Usage**:
   - How should the system handle multiple users generating charts simultaneously?
   - Resource allocation and queuing strategies for concurrent requests

3. **Chart Type Support**:
   - Specific chart types to be supported beyond line, bar, and scatter plots
   - Custom or specialized visualization types for ML-specific metrics