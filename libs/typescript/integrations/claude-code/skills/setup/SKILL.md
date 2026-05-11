---
description: Configure MLflow tracing for Claude Code in this project or for the current user.
disable-model-invocation: true
---

# MLflow Tracing Setup

Use this skill only when the user explicitly asks to configure MLflow tracing.

You must not invent your own setup wizard, option picker, or tracking URI menu.
Do not present made-up choices like `http://localhost:3000`.
Do not simulate configuration steps in natural language when the bundled CLI can do them.

The source of truth for setup is the bundled CLI command:

```bash
mlflow-claude-code setup
```

Rules:

1. Determine scope.
Prefer project scope unless the user explicitly asks for user-wide configuration.

2. Accept only real tracking URI forms.
Valid values are:
- `http://localhost:5000` for the default local MLflow server
- any arbitrary `http://...` or `https://...` URL
- `databricks`
- `databricks://<profile>`

3. Accept either:
- an experiment ID
- an experiment name

4. If the user already provided all required values, run the CLI non-interactively.
Use one of these forms:

```bash
mlflow-claude-code setup --non-interactive --project --tracking-uri "<uri>" --experiment-id "<id>"
```

```bash
mlflow-claude-code setup --non-interactive --project --tracking-uri "<uri>" --experiment-name "<name>"
```

If the user asked for user-wide configuration, replace `--project` with `--user`.

5. If the user did not provide all required values, do not invent your own questionnaire.
Run the interactive CLI instead:

```bash
mlflow-claude-code setup --project
```

or:

```bash
mlflow-claude-code setup --user
```

6. After the CLI finishes, summarize the resulting configuration and next steps.
