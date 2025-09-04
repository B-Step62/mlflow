# Research & Analysis: Natural Language Custom Chart Generation

## Executive Summary
This document consolidates research findings for implementing natural language chart generation in MLflow. Key decisions include using LiteLLM for LLM integration, Plotly for visualization, and extending existing MLflow REST API patterns.

## Technology Decisions

### 1. LLM Integration
**Decision**: LiteLLM SDK
**Rationale**: 
- Unified interface for multiple LLM providers (OpenAI, Anthropic, Google, etc.)
- Already used in MLflow for other LLM features
- Supports streaming responses and error handling
- Simple configuration via environment variables

**Alternatives Considered**:
- Direct provider SDKs: More complex, requires multiple implementations
- LangChain: Heavier dependency, more complex for simple use case
- Custom implementation: Unnecessary reinvention

### 2. Chart Visualization Library
**Decision**: Plotly.js
**Rationale**:
- Already used in MLflow UI for existing charts
- Supports interactive visualizations
- Can be serialized/deserialized as JSON
- Works well with React components
- Extensive chart type support

**Alternatives Considered**:
- D3.js: More complex, requires more custom code
- Chart.js: Less feature-rich for scientific visualizations
- Vega-Lite: Less familiar to MLflow contributors

### 3. Frontend-Backend Communication
**Decision**: REST API following MLflow patterns
**Rationale**:
- Consistent with existing MLflow architecture
- Well-established patterns for authentication/authorization
- Easy to test and document
- Supports async operations with polling

**Alternatives Considered**:
- WebSockets: Overkill for this use case
- GraphQL: Inconsistent with rest of MLflow
- Server-Sent Events: Not needed for simple request-response

### 4. Chart Code Generation Strategy
**Decision**: Generate self-contained JavaScript/React components
**Rationale**:
- Can be executed safely in sandboxed environment
- Portable and saveable as artifacts
- Can include data fetching logic
- Easy to review source code

**Alternatives Considered**:
- Server-side rendering: Less flexible, harder to save/share
- Python code generation: Would require server execution
- JSON configuration only: Too limiting for complex visualizations

### 5. Security Model
**Decision**: Sandbox execution with explicit user consent
**Rationale**:
- Users must acknowledge custom code execution
- Source code viewable before execution
- Runs in browser sandbox, limited access
- Similar to Jupyter notebook security model

**Alternatives Considered**:
- Server-side validation only: Too restrictive
- No restrictions: Security risk
- Static analysis: Complex and imperfect

## API Design Research

### Existing MLflow REST API Patterns
- Endpoints follow `/api/2.0/mlflow/<resource>/<action>` pattern
- Use POST for actions, GET for queries
- Return JSON with standard error format
- Support pagination for large results

### Proposed New Endpoints
1. `POST /api/2.0/mlflow/charts/generate`
   - Request: `{prompt: string, run_id: string, experiment_id?: string}`
   - Response: `{request_id: string}`

2. `GET /api/2.0/mlflow/charts/status/<request_id>`
   - Response: `{status: "pending"|"completed"|"failed", result?: {...}}`

3. `POST /api/2.0/mlflow/charts/save`
   - Request: `{chart_code: string, run_id: string, name: string}`
   - Response: `{artifact_uri: string}`

4. `GET /api/2.0/mlflow/charts/list/<run_id>`
   - Response: `{charts: [{name, uri, created_at}]}`

## LLM Prompt Engineering Research

### System Prompt Components
1. Available MLflow REST API documentation
2. Data schema for metrics and artifacts
3. Plotly.js API reference
4. Example chart implementations
5. Security constraints and best practices

### Prompt Template Structure
```
You are a code generator for MLflow visualizations.
Available APIs: [API documentation]
Available data: [metrics, artifacts schema]
User request: [natural language prompt]
Generate a self-contained React component that fetches data and renders a Plotly chart.
```

### Error Handling Strategies
- Validate data availability before generation
- Provide helpful error messages for ambiguous requests
- Suggest alternatives when requested chart type doesn't match data
- Include error boundaries in generated components

## Performance Considerations

### LLM Response Time
- Average: 5-15 seconds for chart generation
- Can use streaming for perceived performance
- Cache common patterns for faster response

### Data Fetching Optimization
- Limit default data points (e.g., last 1000)
- Support data aggregation for large datasets
- Use pagination for artifact listings

### Frontend Rendering
- Lazy load Plotly.js if not already loaded
- Use React.memo for chart components
- Virtual scrolling for multiple charts

## Integration Points

### With Existing MLflow UI
- Add text input to Model Metrics page
- Integrate with existing chart display area
- Use existing authentication/authorization
- Follow existing UI patterns and themes

### With MLflow Backend
- Extend tracking server with new endpoints
- Use existing database models where possible
- Integrate with artifact storage
- Follow existing logging patterns

## Dependencies and Compatibility

### Python Backend
- LiteLLM: ^1.0.0
- Existing MLflow dependencies sufficient

### JavaScript Frontend  
- Plotly.js: Already included
- No new major dependencies needed

### Environment Variables
- `MLFLOW_LLM_ENGINE_MODEL`: Provider and model identifier, e.g., "openai:/gpt-5-mini"
- `OPENAI_API_KEY`: API key for LLM provider.

## Risks and Mitigations

### Risk 1: LLM generates incorrect or harmful code
**Mitigation**: Sandbox execution, user review, rate limiting

### Risk 2: High LLM API costs
**Mitigation**: Rate limiting, caching, user quotas

### Risk 3: Poor chart quality from ambiguous prompts
**Mitigation**: Prompt templates, examples, error messages with suggestions

### Risk 4: Performance issues with large datasets
**Mitigation**: Data sampling, aggregation, pagination

## Conclusion
All technical decisions align with existing MLflow patterns and architecture. The approach prioritizes security, user experience, and maintainability while leveraging proven technologies already familiar to the MLflow ecosystem.