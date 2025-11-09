**Custom Trace View — Checklist TODOs**

**Guiding Notes**
- Start with frontend only using hard-coded mock view configs.
- Defer CRUD UI for views to a later phase.
- Keep server/API work out of v0; add clean seams for future integration.

**Phase 1 — Apply Views (Mocked)**
- [x] Introduce `mockSavedViews` constant in frontend (scoped per experiment for now).
- [x] Add header control `Saved View` dropdown in Trace modal using mock data.
- [x] Implement `applySavedView(view)` to update span filters in store/selectors.
- [x] Implement visibility application for inputs/outputs/attributes.
- [ ] Apply optional columns/sort if present in view definition.
- [x] Ensure span tree/list honors filter predicates (hide or de-emphasize per UX decision).
- [x] Ensure IO/attribute panels honor visibility rules.
- [x] Persist last-applied view per experiment in `localStorage` (`mlflow:traceView:<experimentId>`).
- [x] Add empty-state when no views exist (mock array empty).

**Phase 2 — CRUD UI (Local Only)**
- [ ] The CRUD UI 
- [ ] Validate name uniqueness within experiment scope; friendly errors.
- [ ] Add non-destructive migration path for stored views (`version` field).

**Phase 3 — Backend Integration**
- [ ] Introduce client adapter interface; default to local no-op implementation.
- [ ] Wire list/create/update/delete/set-default to REST client when available.
- [ ] Add optimistic UI flow with error toasts and rollback.
- [ ] Handle AuthZ (owner-only edits), 404 (missing), 409 (conflict) cases.
