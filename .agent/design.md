# Insight MVP Design (Draft)

## Problem Statement
Teams reviewing conversational traces struggle to synthesize large batches into themes and actionable insights. Today they must read each trace manually, summarize findings offline, and maintain tribal knowledge about trending topics. We need an in-product workflow that automates summarization, clustering, and surfacing of trace-level insights so product and support teams can react quickly.

## Goals
- Provide a repeatable "Insight" job that processes a selected set of traces and produces summaries and hierarchical clusters aligned to a user-provided instruction.
- Capture outputs inside MLflow so that traces, runs, and downstream consumers can reference and audit the results.
- Offer an integrated UI in the new Insight tab (see mocks) to browse generated insights, inspect clusters, and dive into trace-level summaries.
- Reduce friction to start an Insight job from either the dedicated Insights surface or directly from the Traces list.

## Non-Goals (MVP)
- Automatic scheduling or recurring insight generation.
- Fine-grained permission management beyond existing MLflow run access controls.
- Persisting cluster data in a dedicated backend table (handled via run tags for MVP).
- Editing or re-running insight summaries inline after job completion (treat runs as immutable artifacts).

## User Roles & Entry Points

Entry points today:
1. **Insights tab** → `Create Insight` button opens a modal (mock: `mocks/insight-creation-modal.png`).
2. **Traces tab** → select traces → `Actions` → `Generate Insights`, which opens the same modal with the selected trace IDs and instruction prefilled.

## High-Level Workflow
1. User opens the creation modal and provides:
   - Instruction prompt (e.g., "What kind of questions are users asking?").
   - Trace scope (manual selection, saved filter, or current selection).
   - Optional metadata (Insight name, description).
2. Frontend triggers `create-insight` job request to backend service.
3. Backend materializes a new MLflow Run representing the Insight job.
4. Insight job runs the pipeline:
   1. Retrieve target traces and instruction.
   2. For each trace, generate a summary text.
   3. Cluster trace summaries hierarchically.
   4. Persist per-trace artifacts (summary, cluster assignments) and run-level cluster metadata.
5. Job completion emits status updates to the UI; Insight tab refreshes to show the new entry.
6. Users navigate to the Insight details page (mock: `mocks/insight-details.png`) to browse clusters, explore summaries, and pivot back to individual traces.

## Insight Job Lifecycle & Logging
- **Run Creation**: create a dedicated MLflow Run whose name defaults to the chosen Insight name.
  - All input traces will be linked to the run via `mlflow.link_traces_to_run` API.
  - Example run: http://localhost:3000/#/experiments/1/runs/7a88cfaaa5e04014a45967d3ae3dad53
- **Per-trace logging**: log an Assessment artifact with reserved name on each trace.
  - Log `summary` output (string) capturing the generated trace-level synopsis.
  - Log cluster membership under tag `mlflow.insights.cluster_id`.
- **Run-level cluster data**: for MVP, store serialized cluster hierarchy (e.g., JSON) and derived metrics in an artifact (`mlflow_insights_cluster_details.json`). This replaces a future dedicated backend entity.
- **Status tracking**: update run status (`RUNNING` → `FINISHED`/`FAILED`) and optionally log intermediate events for progress UI.


## Frontend Surfaces
- **Insight tab overview** (`mocks/insight-table.png`): list Insights with key stats (run status, instruction, number of traces, last updated). Supports filtering and sorting.
- **Insight details** (`mocks/insight-details.png` + `mocks/insight-traces.png`):
  - Summary panel with instruction, generated overview, run metadata.
  - Cluster hierarchy visualization: expandable groups showing titles and counts.
  - Trace table segmented by cluster. When user clicks the leaf cluster, the new sidebar will be
- **Creation modal** (`mocks/insight-creation-modal.png`): wizard-like form capturing instruction, trace scope, naming. Shows validation errors and estimated cost/duration if available.

## Backend Components
- **Insight Service API**: REST/gRPC endpoint to create and fetch Insights, wrapping MLflow run interactions.
- **Insight Job Runner**: orchestrates summary generation, clustering, and logging. Leverages existing inference infrastructure (LLM provider) configured with guardrails.
- **Trace Store Adapter**: fetches trace content/metadata given selection or filters.
- **Assessment Logger**: reusable helper to write Assessment artifacts and tags to traces.
- **Notification/Webhook (optional)**: enqueue async event when job completes for UI refresh.

## Open Questions
- How do we handle very large trace selections? Need batching and async pagination for the job.
- Do we allow users to edit or delete an Insight run, and what is the lifecycle of associated trace tags?
- What guardrails or validation do we require on the user-provided instruction prompt?
- How will we migrate from run tags to a dedicated cluster backend entity without breaking references?
- Should we expose cost/latency estimates before job submission?

## Risks & Mitigations
- **LLM summarization quality**: incorporate evaluation or human-in-loop review for critical flows; consider storing prompt and model version for auditing.
- **Run tag storage limits**: cluster structures may exceed tag size limits; we may need to split into multiple tags or use artifacts.
- **Trace tagging side effects**: cluster tags on traces might collide with future metadata; ensure namespace isolation (`mlflow.insights.*`).
- **Performance**: summarizing many traces may exceed timeout; execute asynchronously with progress updates and chunked processing.

## Next Steps
1. Create a prototype for the insight page in the frontend, using the run data, traces, tags stored in run ID 7a88cfaaa5e04014a45967d3ae3dad53 (http://localhost:3000/#/experiments/1/runs/7a88cfaaa5e04014a45967d3ae3dad53).
