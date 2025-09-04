# Data Model: Natural Language Custom Chart Generation

## Entity Definitions

### ChartRequest
Represents a user's natural language request for chart generation. This entity tracks both the request and its processing status/result to maintain state across async operations.

**Fields**:
- `request_id`: string (UUID) - Unique identifier for the request
- `user_id`: string - User making the request (from MLflow auth context)
- `prompt`: string - Natural language description of desired chart
- `run_id`: string (optional) - Associated MLflow run
- `experiment_id`: string (optional) - Associated MLflow experiment
- `status`: enum["pending", "processing", "completed", "failed"] - Request processing status (needed for async polling)
- `created_at`: timestamp - When request was created
- `updated_at`: timestamp - Last status update
- `error_message`: string (optional) - Error details if failed
- `result`: JSON (optional) - Generated chart code and config when completed

**Validation Rules**:
- prompt: Required, 1-1000 characters
- run_id OR experiment_id must be provided
- status transitions: pending → processing → completed/failed

### GeneratedChart
Represents a successfully generated chart saved at experiment level.

**Fields**:
- `chart_id`: string (UUID) - Unique identifier
- `request_id`: string - Link to originating request
- `experiment_id`: string - MLflow experiment where chart is saved
- `name`: string - User-friendly chart name
- `artifact_uri`: string - Location in artifact store
- `chart_code`: text - Generated JavaScript/React code
- `created_at`: timestamp - Generation timestamp
- `created_by`: string - User who generated

**Validation Rules**:
- name: Required, 1-100 characters, alphanumeric + spaces
- chart_code: Required, valid JavaScript
- experiment_id: Required, must exist
- artifact_uri: Must follow MLflow artifact URI pattern


## Relationships

```
ChartRequest (1) ——→ (0..1) GeneratedChart
    ↓
    └── A request may produce zero (if failed) or one chart

User (*) ——→ (*) ChartRequest
    ↓
    └── Users can make multiple requests

Experiment (1) ——→ (*) GeneratedChart
    ↓
    └── An experiment can have multiple saved charts

Run (*) ——→ (*) GeneratedChart
    ↓
    └── Charts can be used across multiple runs in the same experiment
```

## State Transitions

### ChartRequest Status Flow
```
[Created] → pending
    ↓
[LLM Processing] → processing
    ↓
[Success] → completed
    OR
[Failure] → failed
```

### Chart Lifecycle
```
[Generated] → saved as artifact
    ↓
[Loaded] → security warning shown
    ↓
[Approved] → executed in browser
    ↓
[Rendered] → displayed to user
```

## Database Schema (SQL)

```sql
-- Chart requests table
CREATE TABLE chart_requests (
    request_id VARCHAR(36) PRIMARY KEY,
    user_id VARCHAR(255) NOT NULL,
    prompt TEXT NOT NULL,
    run_id VARCHAR(36),
    experiment_id VARCHAR(36),
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    error_message TEXT,
    result JSON,
    INDEX idx_user_id (user_id),
    INDEX idx_run_id (run_id),
    INDEX idx_status (status),
    INDEX idx_created_at (created_at),
    CONSTRAINT chk_status CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
    CONSTRAINT chk_run_or_exp CHECK (run_id IS NOT NULL OR experiment_id IS NOT NULL)
);

-- Generated charts table  
CREATE TABLE generated_charts (
    chart_id VARCHAR(36) PRIMARY KEY,
    request_id VARCHAR(36) NOT NULL,
    experiment_id VARCHAR(36) NOT NULL,
    name VARCHAR(100) NOT NULL,
    artifact_uri TEXT NOT NULL,
    chart_code TEXT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_by VARCHAR(255) NOT NULL,
    FOREIGN KEY (request_id) REFERENCES chart_requests(request_id),
    INDEX idx_experiment_id (experiment_id),
    INDEX idx_created_by (created_by),
    INDEX idx_name (name)
);

```

## API Request/Response Models

### GenerateChartRequest
```json
{
  "prompt": "string",
  "run_id": "string (optional)",
  "experiment_id": "string (optional)"
}
```

### GenerateChartResponse
```json
{
  "request_id": "string",
  "status": "pending"
}
```

### ChartStatusResponse
```json
{
  "request_id": "string",
  "status": "pending|processing|completed|failed",
  "result": {
    "chart_code": "string",
  },
  "error_message": "string (optional)"
}
```

### SaveChartRequest
```json
{
  "chart_code": "string",
  "experiment_id": "string",
  "name": "string",
}
```

### SaveChartResponse
```json
{
  "chart_id": "string",
  "artifact_uri": "string"
}
```

### ListChartsResponse
```json
{
  "charts": [
    {
      "chart_id": "string",
      "name": "string",
      "artifact_uri": "string",
      "created_at": "timestamp",
      "created_by": "string"
    }
  ]
}
```

## Data Access Patterns

### Common Queries
1. Get pending requests for processing
2. Get user's recent chart requests
3. Get all charts for a specific experiment
4. Update request status

### Performance Considerations
- Index on status for queue processing
- Index on run_id for chart listing
- Index on created_at for recent requests
- Pagination for large result sets

## Security Considerations

### Data Privacy
- User can only see their own requests
- Charts inherit run/experiment permissions
- Execution logs visible only to chart owner

### Input Validation
- Sanitize prompts to prevent injection
- Validate chart code is valid JavaScript
- Limit prompt length to prevent abuse
- Rate limit by user_id

### Audit Trail
- Log all chart generations
- Track who created each chart
- Retain logs per MLflow retention policy