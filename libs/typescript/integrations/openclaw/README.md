# @mlflow/openclaw

MLflow Tracing integration for [OpenClaw](https://github.com/openclaw-ai/openclaw), the popular open-source AI agent framework.

This plugin automatically traces OpenClaw agent executions in MLflow, capturing LLM calls, tool invocations, and sub-agent spans in a hierarchical trace structure.

## Installation

```bash
npm install @mlflow/openclaw @mlflow/core
```

## Usage

Add the plugin to your OpenClaw configuration:

```typescript
import { MLflowTracingPlugin } from '@mlflow/openclaw';

export default {
  plugins: [MLflowTracingPlugin],
};
```

Set the required environment variables:

```bash
export MLFLOW_TRACKING_URI=http://localhost:5000
export MLFLOW_EXPERIMENT_ID=<your-experiment-id>
```

Run your OpenClaw agent normally — tracing happens automatically.

## What Gets Traced

The plugin creates a span hierarchy for each agent session:

```
AGENT (openclaw_agent)              ← root span
├── LLM (llm_call)                  ← each LLM interaction
├── TOOL (tool_<name>)              ← each tool invocation
├── AGENT (subagent_<label>)        ← sub-agent executions
└── ...
```

### Event → Span Mapping

| OpenClaw Event      | MLflow Span Type | Description                        |
| ------------------- | ---------------- | ---------------------------------- |
| `llm_input`         | AGENT + LLM      | Creates root span (if new) + LLM   |
| `llm_output`        | LLM              | Ends LLM span with response        |
| `tool_start`        | TOOL             | Creates child TOOL span             |
| `tool_end`          | TOOL             | Ends TOOL span with result/error    |
| `subagent_spawning` | AGENT            | Creates child AGENT span            |
| `subagent_ended`    | AGENT            | Ends sub-agent span                 |
| `model.usage`       | _(metadata)_     | Accumulates token usage             |
| `agent_end`         | AGENT            | Ends root span, flushes trace       |

## Configuration

| Environment Variable        | Description                          | Required |
| --------------------------- | ------------------------------------ | -------- |
| `MLFLOW_TRACKING_URI`       | MLflow server URL                    | Yes      |
| `MLFLOW_EXPERIMENT_ID`      | MLflow experiment ID                 | Yes      |
| `MLFLOW_OPENCLAW_DEBUG`     | Set to `true` for debug logging      | No       |

## Development

```bash
# Build
npm run build

# Test
npm test

# Lint
npm run lint
```
