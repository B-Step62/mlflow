# MLflow Typescript SDK - Claude Code

Seamlessly integrate [MLflow Tracing](https://github.com/mlflow/mlflow/tree/main/libs/typescript) with [Claude Code](https://docs.claude.com/en/docs/claude-code/overview) to automatically trace your Claude Code coding-agent conversations, including user prompts, assistant responses, tool usage, sub-agent invocations, and token consumption (with prompt-cache breakdown).

| Package                    | NPM                                                                                                                                            | Description                                        |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| [@mlflow/claude-code](./)  | [![npm package](https://img.shields.io/npm/v/%40mlflow%2Fclaude-code?style=flat-square)](https://www.npmjs.com/package/@mlflow/claude-code)    | Auto-instrumentation integration for Claude Code.  |

## Installation

```bash
npm install @mlflow/claude-code
```

The package ships as a Claude Code plugin (it includes a `.claude-plugin/plugin.json` manifest and a bundled `Stop` hook in `bundle/stop.js`). Claude Code discovers and registers the plugin automatically once the package is installed.

Requires Node.js 18+.

## Quickstart

Start MLflow Tracking Server if you don't have one already:

```bash
pip install mlflow
mlflow server --backend-store-uri sqlite:///mlruns.db --port 5000
```

Self-hosting MLflow server requires Python 3.10 or higher. If you don't have one, you can also use [managed MLflow service](https://mlflow.org/#get-started) for free to get started quickly.

Configure tracing via environment variables before launching Claude Code:

```bash
export MLFLOW_CLAUDE_TRACING_ENABLED=true
export MLFLOW_TRACKING_URI=http://localhost:5000
export MLFLOW_EXPERIMENT_ID=<experiment-id>
```

Then use Claude Code normally:

```bash
claude
```

When a conversation ends, the `Stop` hook reads the session transcript and produces an MLflow trace with:

- An `AGENT` root span for the conversation
- `LLM` child spans for each Claude API call (with input messages, output, and token usage)
- `TOOL` child spans for each tool invocation (with arguments and results)
- Nested `AGENT` spans for sub-agent (`Task` tool) executions

## Configuration

| Variable                         | Required | Description                                                                                  |
| -------------------------------- | -------- | -------------------------------------------------------------------------------------------- |
| `MLFLOW_CLAUDE_TRACING_ENABLED`  | Yes      | Set to `true` (or `1` / `yes`) to enable the tracing hook. Anything else disables it.        |
| `MLFLOW_TRACKING_URI`            | Yes      | MLflow tracking server URI (e.g. `http://localhost:5000` or `databricks`).                   |
| `MLFLOW_EXPERIMENT_ID`           | Yes      | MLflow experiment ID that traces will be logged to.                                          |

## Documentation 📘

Official documentation for MLflow Typescript SDK can be found [here](https://mlflow.org/docs/latest/genai/tracing/quickstart).

## License

This project is licensed under the [Apache License 2.0](https://github.com/mlflow/mlflow/blob/master/LICENSE.txt).
