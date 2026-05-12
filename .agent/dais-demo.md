# DAIS Demo — Agent Studio

Pull-first narrative with push as the human-in-the-loop rescue, MLflow tracing
as the closing payoff. ~6 minutes total. One scripted time-lapse cut, otherwise
continuous take.

**Target slot**: DAIS recorded segment. Aim for week-3 dry-run, week-4 final
take + framing.

---

## Recording arc

### Act 1 — Capture failure → seed a test (0:00–0:45)

**Setup**: Agent Studio open on the sample-agent experiment. Suite panel empty.

- User asks the docs Q&A agent: *"What's the latest MLflow Python release?"*
- Agent answers but links to `/docs/2.20.3/...` — clearly stale.
- User highlights the version number in the response → 💬 → freeform comment:
  *"don't link to non-latest docs"* → Save.
- Toast: **"Test added to regression suite"** (auto-add flow).
- Cut to Tests panel: 1 test case, judge-style criterion.

**Message**: feedback in plain English → executable test, automatic.

### Act 2 — Build a suite from real use (0:45–1:45)

- Quick montage / time-lapse of 5–6 more turns. Each: agent answers, user
  comments, suite count ticks up.
- Final state: Tests panel shows **8 test cases**.
- *(Optional, 5 sec)* Hover the Export icon → modal shows a runnable
  `test_regression.py`. Tagline: *"drop into CI today."* Close.

**Message**: the suite isn't manually authored — it's a residue of usage.

### Act 3 — Run + auto-fix at scale (1:45–3:30)

- Click **Run regression suite**. Navigator scrolls through cases.
  **5 fail, 3 pass.** Suite ends red.
- Cut to Tasks panel: 5 in_progress issues stacked up.
- Camera moves to a new control: **"Auto-fix pool"** toggle. Off → On.
- Activity feed (new pool-level panel) starts streaming:

  ```
  · Worker dispatched for iss-a01 (auto-fix · attempt 1/2)
  · Worker for iss-a01 → reading docs.py
  · Worker for iss-a02 dispatched
  · Worker for iss-a01 → editing docs.py:42
  · Worker for iss-a01 → re-running test → PASS → accepted
  · ...
  ```

- **Time-lapse cut** (only edit in the recording): "5 minutes later."
- Suite count: **7 passing, 1 still failing, 0 retrying**.

**Message**: a pool of agents picks up failures and resolves them. The user
did not push anything.

### Act 4 — Human-in-the-loop, two flavours (3:30–4:45)

**Flavour 1 — review and accept.** Click one of the auto-fixed issues. Drawer:

- Activity thread with Claude's turns (live-poll ~2s).
- Diff block showing the actual code change.
- Accept → issue → done. Connection picker shows the new agent available.

**Flavour 2 — pool gave up, human steps in.** Click the remaining red issue.

- Verdict banner: "Failed assertion: docs link version contains '2.21.0'."
  (Claude tried twice, auto-fix-exhausted.)
- Click **"Fix it with Claude Code"** (push, manual dispatch).
- Activity thread streams live turns. ~30s of visible work.
- Worker reports ready → "New agent version" toast.
- Switch ConnectionPicker → re-run the original failing question → green.
- Accept.

**Message**: AI handles the easy fixes; the human is in the loop for the
hard ones, with the same affordances.

### Act 5 — Trace + close (4:45–5:30)

- Right pane: Tests + Tasks + **Trace** sections visible.
- Click the trace pane: most recent worker's MLflow trace. Span tree
  includes `worker.turn` spans — Claude's reasoning, each `claude.message`
  call, each `agent.invoke` call.
- Brief pause on a `judge.evaluate` span showing the test verdict.
- Cut back to suite panel: **all green**.
- Tagline overlay: *"The agent maintains itself. MLflow keeps the receipts."*

**Message**: this is part of MLflow's tracing story. Every fix is
observable, replayable, auditable.

---

## Gap analysis

| Capability | State | Owner | Effort |
| --- | --- | --- | --- |
| Auto-add on feedback save | ✅ shipped (`agent-playground`) | — | — |
| Freeform feedback popover (no aspect / expected) | ✅ shipped | — | — |
| Pytest export from regression suite | ✅ shipped on `demo-0507` (needs merge) | — | — |
| Pytest export cache | ✅ shipped on `demo-0507` | — | — |
| Push dispatch ("Send to worker") | ✅ shipped | — | — |
| Push: Cancel during pending | ❌ missing | push-polish | 20 min |
| Push: Failed-state Discard | ❌ missing | push-polish | 10 min |
| Push: relabel "Send to worker" → "Fix it with Claude Code" | ❌ cosmetic | push-polish | 5 min |
| Comment poll cadence (5s → 2s during pending) | ❌ poll feels slow | push-polish | 10 min |
| `dispatchWorker` endpoint idempotency | ❌ returns 409 on dup | push-polish (pull prereq) | 15 min |
| MLflow tracing of worker's Claude session | ❌ hooks not installed in worker worktree | observability | 10 min |
| Pull: auto-fix pool poller | ❌ to build | pull-mvp | ~2 d |
| Pull: policy storage (per-experiment YAML) | ❌ to build | pull-mvp | ~0.5 d |
| Pull: concurrency semaphore + per-issue retry budget | ❌ to build | pull-mvp | ~1 d |
| Pull UI: "Auto-fix pool" toggle | ❌ to build | pull-ui | ~0.5 d |
| Pull UI: pool-level activity feed | ❌ to build | pull-ui | ~1 d |
| Pull UI: issue badge ("auto-fix in progress" / "exhausted") | ❌ to build | pull-ui | ~0.5 d |
| Sample agent w/ ≥8 fixable failure modes | ⚠️ author | sample-tune | ~1 d |
| Pull success rate ≥ ~75% on the demo suite | ⚠️ tune | sample-tune | ~0.5–1 d |
| DAIS UI rename ("Studio") | ✅ shipped on `demo-0507` | — | — |
| Branch reconcile: merge `demo-0507` → `agent-playground` | ❌ todo | merge | ~30 min |

**Buckets:**

- **push-polish** (~1 hr 5 min): the six small items above. Lands first; makes
  the existing flow camera-worthy and unblocks pull (idempotency).
- **observability** (~10 min): install Claude Code's existing tracing hooks
  into the worker worktree's `.claude/settings.json` (via
  `mlflow.claude_code.hooks.setup_hooks_config` +
  `setup_environment_config`). Claude's own hook mechanism emits a span
  per turn / tool call / stop. Zero code in `worker.py` — config only.
  Gives Act 5 real turn-by-turn data rather than a coarse wrapper.
- **pull-mvp** (backend ~3.5 d): poller + policy + concurrency. Cuts the
  load-bearing risk of Act 3.
- **pull-ui** (~2 d): toggle, activity feed, badges. The camera surface for
  Act 3.
- **sample-tune** (~1.5–2 d): author the demo failure set against the actual
  worker prompt. Highest-risk because it gates the pull success rate.

---

## Build plan (weeks)

### Week 1 — Push polish + observability + branch hygiene

1. **Branch reconcile**: merge `demo-0507` (Studio rename + export +
   freeform popover) into `agent-playground`. Cut new `dais-demo` branch.
2. **push-polish bucket** (1 hr): Cancel during pending, failed-state
   Discard, relabel, poll cadence, idempotency, manual end-to-end test.
3. **observability bucket** (10 min): install Claude Code's hooks into the
   worker worktree's `.claude/settings.json` so Claude emits a span per turn
   automatically. No `worker.py` code changes.
4. **First dry run**: record the push half of the arc (Acts 1, 2, 4-flavour-2,
   5). Validates the camera flow before pull lands.

**Exit criterion**: push half of demo arc records cleanly in one take.

### Week 2 — Pull MVP (backend)

1. **Policy schema**: single per-experiment YAML in artifact store.
   ```yaml
   auto_fix:
     enabled: false
     triggers:
       - on_status: todo
         labels: [auto_fix_eligible]
     max_concurrent_workers: 3
     max_retries_per_issue: 2
   ```
2. **Poller**: daemon thread on the playground server, 30s sweep. Reads
   policy, picks eligible issues, calls existing `dispatchWorker(issue_id)`.
3. **Concurrency control**: count in-flight worker connections; refuse to
   dispatch when at cap.
4. **Retry budget**: per-issue counter; after `max_retries_per_issue`,
   transition issue to `auto_fix_exhausted` (new state or a tag — pick one).
5. **CLI**: `mlflow agent policy set --auto-fix-enabled` for week-3 UI to
   call into. CLI-first so backend is testable before UI lands.
6. **Sample-tune (parallel)**: author 8–10 failure modes in the sample
   agent. Run the worker against each, measure success rate, iterate on the
   worker prompt.

**Exit criterion**: `mlflow agent policy set --enabled` + manual issue
creation results in the poller dispatching workers, with success rate
≥ ~75% on the authored failure set.

### Week 3 — Pull UI

1. **Auto-fix pool toggle**: prominent control at the top of the Tests
   panel (or a new "Pool" header). Reads/writes `auto_fix.enabled`.
2. **Pool activity feed**: new panel below Tests showing
   `worker_events` — dispatches, accepts, discards, exhausted markers.
   Distinguishes pool dispatches from manual ones.
3. **Issue badges**: per-issue chip in the Tasks panel showing "auto-fix
   in progress" / "auto-fix exhausted" / "manual" / "human reviewing".
4. **Failure-mode taxonomy** (cosmetic): make the activity feed read
   nicely on camera — emojis + short noun phrases per event type.
5. **Second dry-run**: full arc end-to-end. Capture take.

**Exit criterion**: full demo arc records in one take + one time-lapse cut.

### Week 4 — Recording + polish

1. **Multiple takes**. Re-tune the sample agent / worker prompt if takes
   are weak.
2. **Framing copy** for the segment (slides, voiceover script).
3. **MLflow trace deep-link** verified to work mid-recording.
4. **Final cut**, send.

---

## Risks + mitigations

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| Sample-agent failure modes too hard for Claude to fix → pull success rate < 50% | Medium | High — kills Act 3 narrative | Week 2 sample-tune day. Pick syntactic / mechanical failures (version numbers, missing kwargs, lint-style) not deep reasoning bugs. |
| Worker hangs on camera with no Cancel | Low (after push-polish) | Medium — recoverable via UI now | Cancel during pending in push-polish bucket. |
| Activity feed feels slow at 5s poll | Medium | Low — recording cosmetic | Drop poll to 2s during pending state, 5s when idle. |
| Pull UI not camera-ready by week 3 | Medium | Medium | G3 fallback (per build plan): pre-record Act 3 as a 30s clip; live demo wraps push only. |
| `_run_claude` MLflow tracing leaks tokens or breaks if MLflow tracking URI is misconfigured in the worktree | Low | Low — observability is a closing flourish | Wrap span in `try/except` so it can't kill the worker. |
| Branch reconcile (demo-0507 → agent-playground) has subtle conflicts | Medium | Low — just dev friction | Pull `agent-playground` first, rebase or merge with care, run full type-check + pytest before pushing. |

---

## Decision gates (from earlier discussion)

| Gate | When | Question | Fallback |
| --- | --- | --- | --- |
| **G1** | End of week 1 | Does push half of arc record cleanly? | None — push is the substrate, can't drop |
| **G2** | End of week 2 | Does pull backend dispatch correctly with ≥75% success on sample? | Demo push-only with pull as future-direction slide |
| **G3** | End of week 3 | Is pull UI camera-ready? | Pre-record Act 3 as 30s clip, demo push live |

---

## Open questions to revisit

- Branding: "Studio" rename is in trial on `demo-0507` UI only. Decision to
  promote (route + CLI + docs) deferred until post-DAIS.
- Pull policy: "labels: [auto_fix_eligible]" — do we want all `todo` issues
  auto-fix-eligible by default, or require explicit opt-in per issue? Default
  opt-in makes the demo simpler; opt-out per issue is safer for real usage.
  Pick one for the demo, file the other as follow-up.
- Worker prompt: today is generic-Claude. Eventually we may want specialized
  prompts (tone, hallucination, tool-call). Out of DAIS scope; flag as future
  work in the closing slide.
