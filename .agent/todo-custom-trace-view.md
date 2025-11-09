**Custom Trace View — Checklist TODOs**

**Guiding Notes**
- Start with frontend only using hard-coded mock view configs.
- Defer CRUD UI for views to a later phase.
- Keep server/API work out of v0; add clean seams for future integration.

**Phase 1 — Apply Views (Mocked)**
- [x] Introduce `mockSavedViews` constant in frontend (scoped per experiment for now).
- [x] Add header control `Select View` dropdown in Trace modal using mock data.
- [x] Implement `applySavedView(view)` to update span filters in store/selectors.
- [x] Implement visibility application for inputs/outputs/attributes.
- [ ] Apply optional columns/sort if present in view definition.
- [x] Ensure span tree/list honors filter predicates (hide or de-emphasize per UX decision).
- [x] Ensure IO/attribute panels honor visibility rules.
- [x] Persist last-applied view per experiment in `localStorage` (`mlflow:traceView:<experimentId>`).
- [x] Add empty-state when no views exist (mock array empty).

**Phase 2 — CRUD UI (Local Only)**
- [ ] Add the CRUD UI for views.
   - When user clicks the "Select View" button, a modal should be opened (overlay)
   - The modal should show
     - A title "Select View"
     - A list of views as a drop down menu.
       - It should include all the views and "+ Create New View" option at the bottom.
     - "Apply" button at the top right of the modal, as well as close button.
     - The edit UI for the view.
       - The edit UI should include the following fields:
         - Name
         - Description
         - Span types to show (dropdown with checkbox, same as the span filter dropdown)
         - Field filter for each span type. Each span type should be shown as a box with the following fields:
             - Inputs
             - Outputs
             - Attribute
           - Filter keys for each field is shown as a list of text inputs (editable) with a trash can icon to remove the field.
           - It should have a "+" button to add a new key.
         - Other options as checkbox:
           - Show parents
           - Show exceptions
           - Show root span
         - It should have a "Save" button at the top right of the modal.
      - The modal should be closed when the "Save" button is clicked, while the view is applied to the trace.
      - During edit, the trace display should be live-updated to show the changes.

**Phase 3 — Backend Integration**
- [ ] Introduce client adapter interface; default to local no-op implementation.
- [ ] Wire list/create/update/delete/set-default to REST client when available.
- [ ] Add optimistic UI flow with error toasts and rollback.
- [ ] Handle AuthZ (owner-only edits), 404 (missing), 409 (conflict) cases.
