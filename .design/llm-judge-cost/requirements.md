# LLM Judge Cost

Note: this design is all about `mlflow.genai.evaluate`.
https://mlflow.org/docs/latest/genai/eval-monitor/

## Requirements

- [ ] When users invoke LLM judge via MLflow's evaluation scorer (e.g., Correctness, Safety, Guidelines, make_judge) via `mlflow.genai.evaluate`, MLflow should capture and display the cost of the LLM judge call.
- [ ] LLM Judge cost and token counts should be available in the trace UI.
- [ ] Built-in LLM judges generates a trace.
- [ ] The trace ID will be shown in the assessment panel in the trace UI.
- [ ] The trace from judge calls should not be shown in the trace list of the evaluation UI.

Out-of-scope:
- The cost depends on LiteLLM, so we don't need to show the cost when LiteLLM is not installed in the user's environment.
- Custom scorers do not generate traces, so we don't need to show the cost and token counts for them, unless users enable tracing manually.

## Design

### Scorer handling
1. When MLflow invokes a scorer, wrap it with `mlflow.trace` to capture the trace.
  - We only do this for built-in scorers. For custom scorers, users can enable tracing manually.
2. After executing the scorer function, MLflow retrieves the trace by using `mlflow.get_last_active_trace_id(thread_local=True)` and `mlflow.get_trace(trace_id)`.
3. The new `extract_cost_from_judge_trace` utility function should retrieve the cost and token usage from the trace. It parses the spans and find LiteLLM spans, then extract the cost from the span (https://docs.litellm.ai/docs/completion/token_usage).
4. Also token count info should be available in TraceInfo trace_metadata.
5. MLflow logs the following info to the Feedback object returned from the judge.
  - Total cost
  - Total token counts
  - Trace ID

### UI
1. The assessment panel in the trace UI should display cost, token counts, and link to the trace (trace ID), as shown in the "LLM judge cost mock.png".
2. The trace id text should link to the corresponding trace in MLflow UI. It should open the new window such that the user can keep the original assessment open.
3. If there is no trace associated with the judge call, the "cost" tab should be hidden.
4. If the total token counts is available but the cost is unknown, it is often because LiteLLM is not installed. In that case, the cost part should show "$??", where user can hover to see the tooltip "LiteLLM is not installed. Cost is not available."

### How to avoid showing judge traces in the evaluation UI.
1. Currently, MLflow find list of traces to show in the "Evaluations" tab by using `mlflow.search_traces`, by passing `runId = ...` filter string.
2. This filter string will fetch all traces generated during the run. However, this is problematic when we create traces from judge calls. We need a way to filter them out.
   - The quick way is to filter them out in the UI. The assessment (Feedback) object can have a metadata like "mlflow.sourceRunId" that stores the run Id where the feedback is generated.
   - When the UI load the traces, it will look at the assessments attached to the trace. Filter them to those with the "mlflow.sourceRunId" value equals to the run ID, (and those without that metadata field for backward compatibility plus human feedback)
   - If the trace does not have any assessments after filtering, it will not be shown in the UI.

### Current Code Touchpoints
- `mlflow/genai/evaluation/harness.py::_compute_eval_scores` runs scorers and is the central hook for wrapping built-in scorers with `mlflow.trace`, retrieving traces via `mlflow.get_last_active_trace_id`, and enriching `Feedback` metadata after execution.
- `mlflow/genai/utils/trace_utils.py` hosts helper utilities for manipulating traces; this is an appropriate location for the proposed `extract_cost_from_judge_trace` helper and for updating aggregated token usage (`TraceMetadataKey.TOKEN_USAGE`).
- `mlflow/genai/judges/utils.py` and `mlflow/genai/judges/builtin.py` contain judge invocation logic (LiteLLM integration, trace-aware prompts). Any cost or token metadata surfaced by LiteLLM should be captured here and surfaced to downstream callers.
- `mlflow/genai/scorers/base.py::Scorer.run` normalizes scorer outputs; we may add built-in-specific handling here if wrapping logic lives closer to the scorer implementations.
- `mlflow/entities/assessment.py::Feedback` already propagates `AssessmentMetadataKey.SOURCE_RUN_ID` from metadata to the `run_id` field, aligning with the filtering approach that hides judge traces in the evaluation UI.
- Frontend trace filtering, rendering, and assessment display live in `mlflow/server/js/src/shared/web-shared/genai-traces-table/`. `useMlflowTraces` constructs the `search_traces` filter, and `TraceUtils.ts` converts traces into evaluation rows—the new cost/token UI elements and trace-link behavior should extend these utilities.

### Task Plan Checklist
1. [ ] Implement scorer tracing wrapper for built-in judges and capture resulting trace ID.
2. [ ] Build `extract_cost_from_judge_trace` to aggregate LiteLLM cost and token usage into trace metadata.
3. [ ] Enrich `Feedback` objects with total cost, token counts, and trace ID.
4. [ ] Update evaluation UI components to display cost/token data and trace links, including `$??` fallback and tab visibility rules.
5. [ ] Filter judge-generated traces out of the evaluation trace list using assessment metadata.
