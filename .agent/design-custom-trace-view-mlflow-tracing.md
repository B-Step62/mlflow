# MLflow Tracing — Custom Trace View (Skeleton)

## Overview

- Summary: Add "custom trace view" to the Trace modal — a saved frontend view consisting of (1) span filtering configuration and (2) filtering/visibility of span inputs, outputs, and attributes. Users can apply a saved view from the Trace modal header. MLflow persists and reuses the chosen view across traces in the same experiment.

## User Stories / Personas

As a developer debugging agent quality issues, I save a view that hides verbose spans and shows particular types of spans and a subset of attributes.

## UX Design

- Entry points
  - Trace modal header: "Saved Views" dropdown (Apply/Create/Update/Delete). TODO
  - Empty state when no views exist: CTA to create a new view. TODO
- Interactions
  - Create new view from current filters/visibility by clicking the "Create New View" button in the Trace modal header. TODO
  - Update existing view with current configuration. TODO
  - Delete with confirmation. TODO
  - Last‑applied view auto‑applied when opening another trace in the same experiment (configurable). TODO
- Visuals / Wireframes
  - Header control, create/update dialog, delete confirm. TODO (link to mocks)
- Accessibility & i18n
  - Keyboard navigation, ARIA labels, truncation behavior, localization. TODO

## Configuration Model (Saved View)

```jsonc
// Draft schema — evolve during implementation
{
  "id": "string",              // server‑generated
  "name": "string",            // user‑visible
  "experiment_id": "string",   // experiment ID
  "definition": {
    "spans": {            // predicate combined via AND unless specified
      "span_types": ["LLM|CHAIN|AGENT|TOOL|CHAT_MODEL|RETRIEVER|PARSER|EMBEDDING|RERANKER|MEMORY|UNKNOWN"],
      "span_name_pattern": "",
      "show_all_spans": boolean,
      "show_exceptions": boolean,
    },
    "fields": {
      "inputs": { "keys": ["field1.child1[0].grandchild1....", "field2.child2.grandchild2...."] },
      "outputs": { "keys": ["field1.child1.grandchild1....", "field2[0].child2.grandchild2...."] },
      "attributes": { "keys": ["field1.child1.grandchild1....", "field2.child2.grandchild2...."] },
    }
  }
}
```

## Persistence Semantics

- Last‑applied behavior
  - When user selects a view in experiment X, opening any other trace in X auto‑applies that view. TODO
- Storage location
  - Server‑side persistence in SQL backend. No support required for file store.
- Conflict resolution
  - If a view is updated/deleted while modal is open, define refresh/invalid state. TODO

## API Design (Draft)

- REST endpoints (server)
  - `GET /api/2.0/traces/views?scope=<type,id>` → list views. TODO
  - `POST /api/2.0/traces/views` → create view. TODO
  - `PUT /api/2.0/traces/views/{id}` → update view. TODO
  - `DELETE /api/2.0/traces/views/{id}` → delete view. TODO
  - `PUT /api/2.0/traces/views/{id}:default` → set default for scope. TODO
- Client SDK additions
  - Python/JS clients to manage trace views. TODO
- Request/Response examples
  - Provide canonical JSON examples for each route. TODO
- AuthZ / RBAC
  - View ownership; read vs. write; scope‑level sharing. TODO

## Frontend Architecture

State management is handled by the Trace modal itself.

## Backend / Storage

- Data model
  - New table/collection `trace_saved_views` keyed by `(id, experiment_id)`.
- Migrations
  - Alembic/DB migration plan for MLflow server (if applicable).

