---
description: Configure MLflow tracing for Claude Code in this project or for the current user.
disable-model-invocation: true
---

# MLflow Tracing Setup

Use this skill only when the user explicitly asks to configure MLflow tracing.

1. Determine the scope.
Prefer project scope unless the user explicitly asks for user-wide configuration.

2. Gather the required configuration.
You need:
- a tracking URI: `http://...`, `https://...`, `databricks`, or `databricks://<profile>`
- either an experiment ID or an experiment name

3. Once you have enough information, run one of these commands:

```bash
mlflow-claude-code setup --non-interactive --project --tracking-uri "<uri>" --experiment-id "<id>"
```

```bash
mlflow-claude-code setup --non-interactive --project --tracking-uri "<uri>" --experiment-name "<name>"
```

If the user asked for user-wide configuration, replace `--project` with `--user`.

4. Summarize the resulting configuration and the next steps.

5. If the user already provided all required values in one message, do not ask follow-up questions before running the command.
