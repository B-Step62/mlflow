/**
 * Issue detail panel + ``[I fixed this]`` flow (Epic 6, YUK-24/25).
 *
 * Reachable from a dispatched feedback card's "Dispatched ✓ → mlf-iss-XX"
 * link. Shows the Issue body, source trace id, generated test summary,
 * and a single mutating action: hit the user's agent with the test row,
 * evaluate the response, and on green transition the Issue to ``done``.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  Alert,
  BeakerIcon,
  Button,
  ChevronDownIcon,
  ChevronUpIcon,
  Drawer,
  DropdownMenu,
  LinkIcon,
  Modal,
  RobotIcon,
  SparkleIcon,
  Spinner,
  Tag,
  Typography,
  UserIcon,
  useDesignSystemTheme,
} from '@databricks/design-system';

import { GenAIMarkdownRenderer } from '../shared/web-shared/genai-markdown-renderer/GenAIMarkdownRenderer';
import {
  getAjaxUrl,
  getDefaultHeaders,
} from '../shared/web-shared/model-trace-explorer/ModelTraceExplorer.request.utils';
import { useConnections, type AgentConnection } from './connections';

// Build a hash-router URL for a trace detail page given an experiment id.
const _traceUrl = (experimentId: string, traceId: string): string =>
  `#/experiments/${encodeURIComponent(experimentId)}/traces/${encodeURIComponent(traceId)}`;

const _datasetsUrl = (experimentId: string): string =>
  `#/experiments/${encodeURIComponent(experimentId)}/datasets`;

// Truncate an MLflow ID for display so the rail stays scannable. Keeps the
// type prefix (e.g. ``tr-`` / ``d-`` / ``iss-``) plus 10 characters of the
// id body and appends an ellipsis. The full id is still available via the
// link href and `title` tooltip.
const _truncateId = (id: string): string => {
  if (!id) return '';
  const dashIdx = id.indexOf('-');
  if (dashIdx === -1 || dashIdx > 5) {
    return id.length > 10 ? `${id.slice(0, 10)}…` : id;
  }
  const prefix = id.slice(0, dashIdx + 1);
  const rest = id.slice(dashIdx + 1);
  if (rest.length <= 10) return id;
  return `${prefix}${rest.slice(0, 10)}…`;
};

// --- Types -------------------------------------------------------------------

export type IssueDetail = {
  issue_id: string;
  experiment_id: string;
  name: string;
  description: string;
  status: string;
  source_trace_id?: string;
  source_feedback_id?: string;
  test_case_id?: string;
  assignee?: string;
  created_timestamp?: number;
  last_updated_timestamp?: number;
};

export type RunTestVerdict = {
  passed: boolean;
  reasons: string[];
  strategy: string;
  judge_reasoning?: string | null;
  issue_status: string;
  agent_response_text: string;
  agent_tool_calls: string[];
  // Trace produced by the test run's agent invocation. Surfaced in the
  // playground's Live Trace pane so the user can inspect spans without
  // leaving the playground.
  trace_id?: string | null;
};

export type TestCaseRow = {
  messages: { role: string; content: string }[];
  test_spec: { strategy?: string; assertions?: string[]; judge_prompt?: string; [k: string]: unknown };
  expected_response?: string | null;
  tags: Record<string, string>;
};

// --- API helpers -------------------------------------------------------------

export type DispatchWorkerResponse = {
  connection_id: string;
  worktree_path: string;
  branch: string;
  base_commit: string;
  base_branch: string;
  // True when the server returned an existing pending/ready connection
  // for this issue rather than creating a new worktree. Lets the UI
  // distinguish "queued a new worker" from "already running."
  reused: boolean;
};

export const dispatchWorker = async (issueId: string): Promise<DispatchWorkerResponse> => {
  const response = await fetch(
    getAjaxUrl(`ajax-api/3.0/mlflow/playground/issues/${encodeURIComponent(issueId)}/dispatch-worker`),
    {
      method: 'POST',
      headers: getDefaultHeaders(document.cookie),
    },
  );
  if (!response.ok) {
    throw new Error(`Failed to dispatch worker (${response.status}): ${await response.text()}`);
  }
  return (await response.json()) as DispatchWorkerResponse;
};

const _connectionAction = async (
  connectionId: string,
  action: 'accept' | 'rework' | 'discard',
  body?: Record<string, unknown>,
): Promise<unknown> => {
  const response = await fetch(
    getAjaxUrl(`ajax-api/3.0/mlflow/playground/agent-connections/${encodeURIComponent(connectionId)}/${action}`),
    {
      method: 'POST',
      headers: { ...getDefaultHeaders(document.cookie), 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    },
  );
  if (!response.ok) {
    throw new Error(`${action} failed (${response.status}): ${await response.text()}`);
  }
  return response.json();
};

export const acceptWorker = (connectionId: string) =>
  _connectionAction(connectionId, 'accept') as Promise<{
    merge_commit: string;
    issue_id: string;
    issue_status: string;
  }>;

export const reworkWorker = (connectionId: string, feedback: string) =>
  _connectionAction(connectionId, 'rework', { feedback });

export const discardWorker = (connectionId: string) => _connectionAction(connectionId, 'discard');

export const fetchIssues = async (experimentId: string, state?: string): Promise<IssueDetail[]> => {
  const params = new URLSearchParams({ experiment_id: experimentId });
  if (state) params.set('state', state);
  const response = await fetch(getAjaxUrl(`ajax-api/3.0/mlflow/playground/issues?${params}`), {
    headers: getDefaultHeaders(document.cookie),
  });
  if (!response.ok) {
    throw new Error(`Failed to list issues (${response.status}): ${await response.text()}`);
  }
  const body = (await response.json()) as { issues?: IssueDetail[] };
  return body.issues ?? [];
};

export const fetchIssue = async (issueId: string): Promise<IssueDetail> => {
  const response = await fetch(getAjaxUrl(`ajax-api/3.0/mlflow/playground/issues/${encodeURIComponent(issueId)}`), {
    headers: getDefaultHeaders(document.cookie),
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch issue (${response.status}): ${await response.text()}`);
  }
  return (await response.json()) as IssueDetail;
};

export const fetchIssueTestCase = async (issueId: string): Promise<TestCaseRow | null> => {
  const response = await fetch(
    getAjaxUrl(`ajax-api/3.0/mlflow/playground/issues/${encodeURIComponent(issueId)}/test-case`),
    { headers: getDefaultHeaders(document.cookie) },
  );
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`Failed to fetch test case (${response.status}): ${await response.text()}`);
  }
  return (await response.json()) as TestCaseRow;
};

export type IssueCommentEntry = {
  comment_id: string;
  issue_id: string;
  author: string;
  body: string;
  kind: string;
  created_timestamp: number;
};

export const fetchIssueComments = async (issueId: string): Promise<IssueCommentEntry[]> => {
  const response = await fetch(
    getAjaxUrl(`ajax-api/3.0/mlflow/playground/issues/${encodeURIComponent(issueId)}/comments`),
    { headers: getDefaultHeaders(document.cookie) },
  );
  if (!response.ok) {
    throw new Error(`Failed to fetch comments (${response.status}): ${await response.text()}`);
  }
  const body = (await response.json()) as { comments?: IssueCommentEntry[] };
  return body.comments ?? [];
};

export const postIssueComment = async (issueId: string, body: string): Promise<IssueCommentEntry> => {
  const response = await fetch(
    getAjaxUrl(`ajax-api/3.0/mlflow/playground/issues/${encodeURIComponent(issueId)}/comments`),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getDefaultHeaders(document.cookie) },
      body: JSON.stringify({ body, author: 'user', kind: 'comment' }),
    },
  );
  if (!response.ok) {
    throw new Error(`Failed to post comment (${response.status}): ${await response.text()}`);
  }
  return (await response.json()) as IssueCommentEntry;
};

/** Transition an Issue to `rejected` — used by the Tests panel's
 *  selection-bar "Delete" action so reviewers can triage away tests they
 *  don't want to fix. */
export const rejectIssue = async (issueId: string): Promise<void> => {
  const response = await fetch(
    getAjaxUrl(`ajax-api/3.0/mlflow/playground/issues/${encodeURIComponent(issueId)}/reject`),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getDefaultHeaders(document.cookie) },
    },
  );
  if (!response.ok) {
    throw new Error(`Reject failed (${response.status}): ${await response.text()}`);
  }
};

/** Manually move an Issue to a new playground state. The server validates
 *  the transition (e.g. `done -> todo` is rejected as 400), so callers
 *  should surface any error message rather than retrying blindly. */
export const transitionIssue = async (
  issueId: string,
  status: 'todo' | 'in_progress' | 'review' | 'done' | 'rejected',
): Promise<IssueDetail> => {
  const response = await fetch(
    getAjaxUrl(`ajax-api/3.0/mlflow/playground/issues/${encodeURIComponent(issueId)}/transition`),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getDefaultHeaders(document.cookie) },
      body: JSON.stringify({ status }),
    },
  );
  if (!response.ok) {
    throw new Error(`Transition failed (${response.status}): ${await response.text()}`);
  }
  return (await response.json()) as IssueDetail;
};

export type EvaluateExistingVerdict = {
  passed: boolean;
  reasons: string[];
  strategy: string;
  judge_reasoning?: string | null;
};

/**
 * Evaluate the issue's test spec against an already-produced agent response
 * (no agent invocation, no MLflow run created). Used by the feedback save
 * flow to pre-grade the test the moment it's generated, so we can surface a
 * "Fix it" CTA without waiting for the user to click "Run test".
 */
export const evaluateExistingAgentResponse = async (
  issueId: string,
  agentResponseText: string,
  agentToolCalls: string[],
): Promise<EvaluateExistingVerdict> => {
  const response = await fetch(
    getAjaxUrl(`ajax-api/3.0/mlflow/playground/issues/${encodeURIComponent(issueId)}/evaluate-existing-response`),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getDefaultHeaders(document.cookie) },
      body: JSON.stringify({
        agent_response_text: agentResponseText,
        agent_tool_calls: agentToolCalls,
      }),
    },
  );
  if (!response.ok) {
    throw new Error(`Pre-grade failed (${response.status}): ${await response.text()}`);
  }
  return (await response.json()) as EvaluateExistingVerdict;
};

export type RunTestProgress = {
  stage: 'loading' | 'replaying' | 'evaluating';
  message: string;
};

/**
 * Stream the regression test run as Server-Sent Events.
 *
 * Yields stage-level milestones (`loading` → `replaying` → `evaluating`) via
 * `onProgress`, then resolves with the final verdict. On any server-emitted
 * `error` event the promise rejects with an Error whose message includes the
 * stage that failed.
 *
 * Server format: each event is a `data: {json}\n\n` line where `json.type` is
 * one of `"progress"` | `"verdict"` | `"error"`. We deliberately don't use
 * EventSource because it would require the playground UI to know the absolute
 * URL up-front (it can't take cookies/headers cleanly), and the existing chat
 * stream already uses fetch + ReadableStream the same way.
 */
export const runIssueTest = async (
  issueId: string,
  onProgress?: (progress: RunTestProgress) => void,
): Promise<RunTestVerdict> => {
  const response = await fetch(
    getAjaxUrl(`ajax-api/3.0/mlflow/playground/issues/${encodeURIComponent(issueId)}/run-test/stream`),
    { headers: getDefaultHeaders(document.cookie) },
  );
  if (!response.ok || !response.body) {
    throw new Error(`Test run failed (${response.status}): ${await response.text()}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let verdict: RunTestVerdict | null = null;

  // Pull `data: {json}\n\n` frames out of the buffer; the `\n\n` separator is
  // the SSE message boundary.
  const drainFrames = (input: string): { remaining: string; events: string[] } => {
    const events: string[] = [];
    let remaining = input;
    while (true) {
      const idx = remaining.indexOf('\n\n');
      if (idx < 0) break;
      events.push(remaining.slice(0, idx));
      remaining = remaining.slice(idx + 2);
    }
    return { remaining, events };
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const { remaining, events } = drainFrames(buffer);
    buffer = remaining;
    for (const frame of events) {
      const line = frame
        .split('\n')
        .find((l) => l.startsWith('data:'))
        ?.slice('data:'.length)
        .trim();
      if (!line) continue;
      const event = JSON.parse(line) as
        | { type: 'progress'; stage: RunTestProgress['stage']; message: string }
        | ({ type: 'verdict' } & RunTestVerdict)
        | { type: 'error'; stage: string; detail: string };
      if (event.type === 'progress') {
        onProgress?.({ stage: event.stage, message: event.message });
      } else if (event.type === 'verdict') {
        const { type: _t, ...rest } = event;
        verdict = rest as RunTestVerdict;
      } else if (event.type === 'error') {
        throw new Error(`[${event.stage}] ${event.detail}`);
      }
    }
  }

  if (!verdict) {
    throw new Error('Test run ended without a verdict event.');
  }
  return verdict;
};

// --- Fix-prompt builder ------------------------------------------------------

/**
 * Build a markdown prompt the user can paste into a local Claude Code session
 * to fix the failing test. Includes the goal, the conversation, the test spec
 * (so Claude sees the assertions / judge criteria), and the verdict's specific
 * failures (so Claude knows exactly what to address). Closes with the verify
 * command the user runs locally to confirm the fix.
 */
export const buildFixPrompt = (
  issue: IssueDetail,
  testCase: TestCaseRow | null,
  verdict: RunTestVerdict | null,
): string => {
  const lines: string[] = [];
  lines.push(`# Fix MLflow Agent Studio Issue ${issue.issue_id}`);
  lines.push('');
  lines.push(`**Title:** ${issue.name}`);
  if (issue.source_trace_id) {
    lines.push(`**Trace:** \`${issue.source_trace_id}\``);
  }
  if (issue.test_case_id) {
    lines.push(`**Test case:** \`${issue.test_case_id}\``);
  }
  lines.push('');
  lines.push('## What went wrong');
  lines.push(issue.description.trim() || '(no rationale recorded)');
  lines.push('');

  if (verdict) {
    lines.push(`## Latest test verdict (${verdict.strategy})`);
    lines.push(verdict.passed ? 'PASS' : 'FAIL');
    for (const reason of verdict.reasons) {
      lines.push(`- ${reason}`);
    }
    if (verdict.judge_reasoning) {
      lines.push('');
      lines.push(`Judge reasoning: ${verdict.judge_reasoning}`);
    }
    if (verdict.agent_response_text) {
      lines.push('');
      lines.push('### What the agent said this run');
      lines.push('```');
      lines.push(verdict.agent_response_text);
      lines.push('```');
    }
    if (verdict.agent_tool_calls.length > 0) {
      lines.push(`Tool calls observed: ${verdict.agent_tool_calls.join(', ')}`);
    }
    lines.push('');
  }

  if (testCase) {
    lines.push('## Test spec the agent must satisfy');
    lines.push('```json');
    lines.push(JSON.stringify(testCase.test_spec, null, 2));
    lines.push('```');
    if (testCase.expected_response) {
      lines.push('');
      lines.push(`Expected response (reference): ${testCase.expected_response}`);
    }
    lines.push('');
    lines.push('## Conversation prefix to replay');
    lines.push('```json');
    lines.push(JSON.stringify(testCase.messages, null, 2));
    lines.push('```');
    lines.push('');
  }

  lines.push('## Your job');
  lines.push(
    'Find and fix the agent code in this repo so that re-running the test below passes. ' +
      'Touch only the agent under development; do NOT modify the test row itself ' +
      '(MLflow regenerates it from the original feedback if you delete it).',
  );
  lines.push('');
  lines.push('## Solution space - explore beyond system-prompt tweaks');
  lines.push(
    'A system-prompt hack is the laziest fix and often the most brittle. Before ' +
      'defaulting to it, weigh these alternatives and pick the one that actually ' +
      'addresses the root cause. Multiple options can be combined.',
  );
  lines.push('');
  lines.push(
    '- **Tooling / retrieval**: add or fix a tool (web search, doc lookup, API call) ' +
      'so the agent grounds its answer in real data instead of guessing.',
  );
  lines.push(
    '- **Tool selection / routing**: adjust which tools are exposed, their descriptions, ' +
      "or the model's tool-calling logic so the right tool fires for this kind of question.",
  );
  lines.push(
    '- **Model / provider**: try a stronger model (or different provider) if the current ' +
      'one consistently fails the criterion.',
  );
  lines.push(
    "- **Output formatting / post-processing**: transform the model's raw response " +
      '(e.g. enforce markdown, add citations, strip boilerplate) outside the prompt.',
  );
  lines.push(
    '- **Control flow**: add a verification / self-check step, a retry-with-feedback ' +
      'loop, or a structured-output schema.',
  );
  lines.push(
    '- **Retrieval corpus**: change what is searched (domains, filters, freshness) or ' +
      'how results are ranked / filtered.',
  );
  lines.push(
    '- **System prompt**: only after the above do not fit. When you do edit the prompt, ' +
      'change the *rule* not the *symptom* - "answer with citations" is durable; ' +
      '"do not say X" is brittle.',
  );
  lines.push('');
  lines.push('## Environment');
  lines.push(
    "**Critical:** always run the verify command via `uv run` so it uses the project's " +
      'pinned MLflow + agent dependencies - invoking `mlflow` directly picks up whatever ' +
      'is on PATH and silently diverges from the env the agent itself runs in. Also set ' +
      '`MLFLOW_TRACKING_URI=http://localhost:5000` so the command talks to the running ' +
      'playground server rather than a worktree-local sqlite; without it, ' +
      '`mlflow agent test run` will not find the issue / test case and will exit with an ' +
      'unrelated error.',
  );
  lines.push('');
  lines.push('## Verify');
  lines.push('```bash');
  lines.push(`MLFLOW_TRACKING_URI=http://localhost:5000 uv run mlflow agent test run --issue ${issue.issue_id}`);
  lines.push('```');
  lines.push('Exit code 0 = pass. Iterate until it passes, then return to the playground and click "I fixed this".');
  return lines.join('\n');
};

const CopyFixPromptButton = ({
  issue,
  testCase,
  verdict,
}: {
  issue: IssueDetail;
  testCase: TestCaseRow | null;
  verdict: RunTestVerdict | null;
}) => {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onCopy = useCallback(async () => {
    const prompt = buildFixPrompt(issue, testCase, verdict);
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
      setError(null);
      setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [issue, testCase, verdict]);

  return (
    <div css={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <Button
        componentId="mlflow.playground.issue-detail.copy-fix-prompt"
        type="tertiary"
        size="small"
        onClick={onCopy}
      >
        {copied ? '✓ Copied — paste into Claude Code' : '📋 Copy fix prompt for Claude Code'}
      </Button>
      {error && (
        <Typography.Text size="sm" color="error">
          Could not copy to clipboard: {error}
        </Typography.Text>
      )}
    </div>
  );
};

// --- Worker review actions (Epic 8 / YUK-55) --------------------------------

const WorkerReviewActions = ({
  worker,
  issue,
  experimentId,
  onChange,
}: {
  worker: AgentConnection;
  issue: IssueDetail;
  experimentId: string;
  onChange: () => void;
}) => {
  const { theme } = useDesignSystemTheme();
  const [busy, setBusy] = useState<null | 'accept' | 'rework' | 'discard'>(null);
  const [error, setError] = useState<string | null>(null);
  const [reworkFeedback, setReworkFeedback] = useState('');
  const [reworkOpen, setReworkOpen] = useState(false);

  // The app uses createHashRouter, so client routes live under #/...; a path-style
  // href would do a full document navigation and 404 against the FastAPI server.
  const playgroundHref = `#/experiments/${encodeURIComponent(experimentId)}/playground?activate_for_issue=${encodeURIComponent(
    issue.issue_id,
  )}`;

  const onAccept = useCallback(async () => {
    setBusy('accept');
    setError(null);
    try {
      await acceptWorker(worker.connection_id);
      onChange();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }, [worker.connection_id, onChange]);

  const onDiscard = useCallback(async () => {
    setBusy('discard');
    setError(null);
    try {
      await discardWorker(worker.connection_id);
      onChange();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }, [worker.connection_id, onChange]);

  const onRework = useCallback(async () => {
    if (!reworkFeedback.trim()) {
      setError('Provide feedback for the rework.');
      return;
    }
    setBusy('rework');
    setError(null);
    try {
      await reworkWorker(worker.connection_id, reworkFeedback);
      setReworkOpen(false);
      setReworkFeedback('');
      onChange();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }, [worker.connection_id, reworkFeedback, onChange]);

  return (
    <div
      css={{
        borderTop: `1px solid ${theme.colors.border}`,
        paddingTop: theme.spacing.md,
        display: 'flex',
        flexDirection: 'column',
        gap: theme.spacing.sm,
      }}
    >
      <Typography.Text css={{ fontWeight: 600 }}>Worker ready for review</Typography.Text>
      <Typography.Text color="secondary" size="sm">
        {worker.name} (<code>{worker.branch}</code>) is up. Test it in the playground, then accept to merge into the
        base agent branch, rework with feedback, or discard.
      </Typography.Text>
      <div css={{ display: 'flex', flexWrap: 'wrap', gap: theme.spacing.sm }}>
        <Button componentId="mlflow.playground.issue-detail.test-in-playground" type="primary" href={playgroundHref}>
          Test in playground →
        </Button>
        <Button componentId="mlflow.playground.issue-detail.accept-worker" onClick={onAccept} disabled={busy !== null}>
          {busy === 'accept' ? 'Accepting…' : 'Accept'}
        </Button>
        <Button
          componentId="mlflow.playground.issue-detail.rework-worker"
          onClick={() => setReworkOpen((open) => !open)}
          disabled={busy !== null}
        >
          Rework…
        </Button>
        <Button
          componentId="mlflow.playground.issue-detail.discard-worker"
          danger
          onClick={onDiscard}
          disabled={busy !== null}
        >
          {busy === 'discard' ? 'Discarding…' : 'Discard'}
        </Button>
      </div>
      {reworkOpen && (
        <div css={{ display: 'flex', flexDirection: 'column', gap: theme.spacing.xs }}>
          <textarea
            value={reworkFeedback}
            onChange={(e) => setReworkFeedback(e.target.value)}
            rows={3}
            placeholder="What should the next attempt do differently?"
            css={{
              fontFamily: 'inherit',
              fontSize: theme.typography.fontSizeBase,
              padding: theme.spacing.sm,
              borderRadius: theme.borders.borderRadiusSm,
              border: `1px solid ${theme.colors.border}`,
            }}
          />
          <div>
            <Button
              componentId="mlflow.playground.issue-detail.rework-worker-submit"
              type="primary"
              onClick={onRework}
              disabled={busy !== null}
            >
              {busy === 'rework' ? 'Sending…' : 'Send rework'}
            </Button>
          </div>
        </div>
      )}
      {error && (
        <Alert
          componentId="mlflow.playground.issue-detail.worker-action-error"
          type="error"
          message={error}
          closable
          onClose={() => setError(null)}
        />
      )}
    </div>
  );
};

// --- Worker section (Epic 8 / YUK-54) ---------------------------------------

const findWorkerConnection = (issueId: string | null, connections: AgentConnection[]): AgentConnection | null => {
  if (!issueId) return null;
  // Prefer ready, then pending, then failed — newest within each bucket.
  const candidates = connections.filter((c) => c.source_issue_id === issueId);
  const order = ['ready', 'pending', 'failed', 'dead'];
  candidates.sort((a, b) => {
    const ai = order.indexOf(a.status);
    const bi = order.indexOf(b.status);
    if (ai !== bi) return ai - bi;
    return b.created_at_ms - a.created_at_ms;
  });
  return candidates[0] ?? null;
};

const WorkerSection = ({
  issue,
  experimentId,
  onDispatched,
}: {
  issue: IssueDetail;
  experimentId: string;
  onDispatched: () => void;
}) => {
  const { theme } = useDesignSystemTheme();
  const { connections } = useConnections();
  const worker = useMemo(() => findWorkerConnection(issue.issue_id, connections), [issue.issue_id, connections]);
  const [dispatching, setDispatching] = useState(false);
  const [dispatchError, setDispatchError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);

  const onDispatchWorker = useCallback(async () => {
    setDispatching(true);
    setDispatchError(null);
    try {
      await dispatchWorker(issue.issue_id);
      onDispatched();
    } catch (e) {
      setDispatchError(e instanceof Error ? e.message : String(e));
    } finally {
      setDispatching(false);
    }
  }, [issue.issue_id, onDispatched]);

  const onCancelWorker = useCallback(async () => {
    if (!worker) return;
    setCancelling(true);
    setCancelError(null);
    try {
      await discardWorker(worker.connection_id);
      onDispatched();
    } catch (e) {
      setCancelError(e instanceof Error ? e.message : String(e));
    } finally {
      setCancelling(false);
    }
  }, [worker, onDispatched]);

  // Status `todo` with no worker yet → show dispatch button.
  if (issue.status === 'todo' && !worker) {
    return (
      <div
        css={{
          borderTop: `1px solid ${theme.colors.border}`,
          paddingTop: theme.spacing.md,
          display: 'flex',
          flexDirection: 'column',
          gap: theme.spacing.sm,
        }}
      >
        <Typography.Text css={{ fontWeight: 600 }}>Fix it with Claude Code</Typography.Text>
        <Typography.Text color="secondary" size="sm">
          Dispatches a local Claude Code session into an isolated worktree, iterates on the regression test until green,
          then connects the fixed agent here for you to test. Experimental — your code stays on disk in{' '}
          <code>.mlflow-worktrees/</code> until you accept or discard.
        </Typography.Text>
        <div>
          <Button
            componentId="mlflow.playground.issue-detail.dispatch-worker"
            type="primary"
            onClick={onDispatchWorker}
            disabled={dispatching}
          >
            {dispatching ? 'Dispatching…' : 'Fix it with Claude Code'}
          </Button>
        </div>
        {dispatchError && (
          <Alert
            componentId="mlflow.playground.issue-detail.dispatch-error"
            type="error"
            message={dispatchError}
            closable
            onClose={() => setDispatchError(null)}
          />
        )}
      </div>
    );
  }

  // Worker pending — iteration in progress. Cancel mid-flight via the same
  // `discardWorker` endpoint the ready / failed paths use; backend SIGTERMs
  // the Claude subprocess and cleans up the worktree.
  if (worker && worker.status === 'pending') {
    return (
      <div
        css={{
          borderTop: `1px solid ${theme.colors.border}`,
          paddingTop: theme.spacing.md,
          display: 'flex',
          flexDirection: 'column',
          gap: theme.spacing.sm,
        }}
      >
        <div css={{ display: 'flex', alignItems: 'center', gap: theme.spacing.sm }}>
          <Spinner size="small" />
          <div css={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
            <Typography.Text css={{ fontWeight: 600 }}>Worker iterating…</Typography.Text>
            <Typography.Text color="secondary" size="sm">
              {worker.name} (<code>{worker.branch}</code>). Test runs locally; the connection will flip to ready once
              the test goes green.
            </Typography.Text>
          </div>
          <Button
            componentId="mlflow.playground.issue-detail.cancel-worker"
            size="small"
            onClick={onCancelWorker}
            disabled={cancelling}
          >
            {cancelling ? 'Cancelling…' : 'Cancel'}
          </Button>
        </div>
        {cancelError && (
          <Alert
            componentId="mlflow.playground.issue-detail.cancel-error"
            type="error"
            message={cancelError}
            closable
            onClose={() => setCancelError(null)}
          />
        )}
      </div>
    );
  }

  // Worker ready — surface the deeplink + accept/rework/discard actions.
  if (worker && worker.status === 'ready') {
    return <WorkerReviewActions worker={worker} issue={issue} experimentId={experimentId} onChange={onDispatched} />;
  }

  // Worker failed — give the user a Discard button to clear it so they can
  // re-dispatch or fall back to the manual fix flow without refreshing.
  if (worker && worker.status === 'failed') {
    return (
      <div
        css={{
          borderTop: `1px solid ${theme.colors.border}`,
          paddingTop: theme.spacing.md,
          display: 'flex',
          flexDirection: 'column',
          gap: theme.spacing.sm,
        }}
      >
        <Typography.Text css={{ fontWeight: 600, color: theme.colors.red600 }}>Worker failed</Typography.Text>
        <Typography.Text color="secondary" size="sm">
          {worker.status_message ?? 'Claude could not get the test green.'}
        </Typography.Text>
        <div css={{ display: 'flex', gap: theme.spacing.xs }}>
          <Button
            componentId="mlflow.playground.issue-detail.failed-discard"
            onClick={onCancelWorker}
            disabled={cancelling}
          >
            {cancelling ? 'Discarding…' : 'Discard worker'}
          </Button>
        </div>
        {cancelError && (
          <Alert
            componentId="mlflow.playground.issue-detail.failed-discard-error"
            type="error"
            message={cancelError}
            closable
            onClose={() => setCancelError(null)}
          />
        )}
      </div>
    );
  }

  return null;
};

// --- Comments thread (Linear-style) ----------------------------------------

const formatRelativeTime = (ts: number): string => {
  const seconds = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
};

const IssueComments = ({ issueId }: { issueId: string }) => {
  const { theme } = useDesignSystemTheme();
  const [comments, setComments] = useState<IssueCommentEntry[]>([]);
  const [draft, setDraft] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Detect whether a worker for this issue is currently pending — if so,
  // tighten the comment poll so Claude's turns appear in near-real-time
  // on the activity thread (matters for the DAIS demo recording where the
  // user is watching the thread stream).
  const { connections } = useConnections();
  const isWorkerPending = useMemo(
    () => connections.some((c) => c.source_issue_id === issueId && c.status === 'pending'),
    [connections, issueId],
  );
  const pollIntervalMs = isWorkerPending ? 2000 : 5000;

  const refresh = useCallback(async () => {
    try {
      const next = await fetchIssueComments(issueId);
      setComments(next);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [issueId]);

  useEffect(() => {
    void refresh();
    const id = window.setInterval(() => void refresh(), pollIntervalMs);
    return () => window.clearInterval(id);
  }, [refresh, pollIntervalMs]);

  const onSubmit = useCallback(async () => {
    const body = draft.trim();
    if (!body) return;
    setSubmitting(true);
    try {
      await postIssueComment(issueId, body);
      setDraft('');
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  }, [draft, issueId, refresh]);

  // Show the most-recent 2 comments by default; "Show all" reveals the rest.
  const [expanded, setExpanded] = useState(false);
  const COLLAPSED_COUNT = 2;
  const collapsedHidden = Math.max(0, comments.length - COLLAPSED_COUNT);
  const visibleComments = expanded ? comments : comments.slice(-COLLAPSED_COUNT);

  return (
    <div
      css={{
        borderTop: `1px solid ${theme.colors.border}`,
        paddingTop: theme.spacing.md,
        display: 'flex',
        flexDirection: 'column',
        gap: theme.spacing.sm,
      }}
    >
      <Typography.Text css={{ fontWeight: 600 }}>Activity</Typography.Text>
      {error && (
        <Alert
          componentId="mlflow.playground.issue-detail.comments-error"
          type="error"
          message={error}
          closable
          onClose={() => setError(null)}
        />
      )}
      {comments.length === 0 && (
        <Typography.Text color="secondary" size="sm">
          No activity yet.
        </Typography.Text>
      )}
      {/* Collapse toggle, shown only when we're hiding older comments. */}
      {!expanded && collapsedHidden > 0 && (
        <Button
          componentId="mlflow.issue-detail.activity-expand"
          type="link"
          onClick={() => setExpanded(true)}
          css={{ alignSelf: 'flex-start', paddingLeft: 0 }}
        >
          {`Show ${collapsedHidden} older comment${collapsedHidden === 1 ? '' : 's'}`}
        </Button>
      )}
      {expanded && comments.length > COLLAPSED_COUNT && (
        <Button
          componentId="mlflow.issue-detail.activity-collapse"
          type="link"
          onClick={() => setExpanded(false)}
          css={{ alignSelf: 'flex-start', paddingLeft: 0 }}
        >
          Collapse
        </Button>
      )}
      <div css={{ display: 'flex', flexDirection: 'column' }}>
        {visibleComments.map((c, i) => {
          const isLast = i === visibleComments.length - 1;
          return (
            <div
              key={c.comment_id}
              css={{
                position: 'relative',
                display: 'flex',
                gap: theme.spacing.sm,
                paddingBottom: isLast ? 0 : theme.spacing.md,
                // Vertical connecting line between consecutive avatars. The
                // line starts just below the avatar (28px = 24px avatar + 4px
                // gap) and extends to the next row, mirroring Linear / Jira
                // activity feeds.
                ...(!isLast && {
                  '::before': {
                    content: '""',
                    position: 'absolute',
                    left: 11,
                    top: 28,
                    bottom: 0,
                    width: 1,
                    backgroundColor: theme.colors.border,
                  },
                }),
              }}
            >
              <ActivityIcon author={c.author} kind={c.kind} />
              <div css={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0, flex: 1 }}>
                <div css={{ display: 'flex', gap: theme.spacing.xs, alignItems: 'baseline' }}>
                  <Typography.Text css={{ fontWeight: 600 }} size="sm">
                    {c.author}
                  </Typography.Text>
                  <Typography.Text color="secondary" size="sm">
                    · {formatRelativeTime(c.created_timestamp)}
                  </Typography.Text>
                </div>
                <pre
                  css={{
                    margin: 0,
                    fontFamily: 'inherit',
                    fontSize: theme.typography.fontSizeBase,
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                    color: c.kind === 'system' ? theme.colors.textSecondary : theme.colors.textPrimary,
                  }}
                >
                  {c.body}
                </pre>
              </div>
            </div>
          );
        })}
      </div>
      <div css={{ display: 'flex', flexDirection: 'column', gap: theme.spacing.xs, marginTop: theme.spacing.sm }}>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={3}
          placeholder="Leave a comment…"
          css={{
            fontFamily: 'inherit',
            fontSize: theme.typography.fontSizeBase,
            padding: theme.spacing.sm,
            borderRadius: theme.borders.borderRadiusSm,
            border: `1px solid ${theme.colors.border}`,
          }}
        />
        <div>
          <Button
            componentId="mlflow.playground.issue-detail.comment-submit"
            type="primary"
            onClick={onSubmit}
            disabled={submitting || !draft.trim()}
          >
            {submitting ? 'Posting…' : 'Comment'}
          </Button>
        </div>
      </div>
    </div>
  );
};

// --- Drawer -----------------------------------------------------------------

const STATUS_TAG_COLOR = {
  todo: 'default',
  in_progress: 'indigo',
  review: 'lemon',
  done: 'lime',
  rejected: 'coral',
} as const satisfies Record<string, 'default' | 'indigo' | 'lemon' | 'lime' | 'coral'>;

// Playground state-machine — keep in lockstep with
// `mlflow/entities/issue.py::_PLAYGROUND_TRANSITIONS`. The graph is fully
// connected between playground states so the dropdown can rewind a card
// (e.g. done → in_progress) or revive a rejected one — only self-loops
// and edges touching legacy `pending` / `resolved` are illegal.
type PlaygroundStatus = 'todo' | 'in_progress' | 'review' | 'done' | 'rejected';

const PLAYGROUND_STATUSES: readonly PlaygroundStatus[] = [
  'todo',
  'in_progress',
  'review',
  'done',
  'rejected',
];

const STATUS_TRANSITIONS: Record<PlaygroundStatus, PlaygroundStatus[]> = Object.fromEntries(
  PLAYGROUND_STATUSES.map((s) => [s, PLAYGROUND_STATUSES.filter((t) => t !== s)]),
) as Record<PlaygroundStatus, PlaygroundStatus[]>;

const STATUS_LABEL: Record<PlaygroundStatus, string> = {
  todo: 'Todo',
  in_progress: 'In progress',
  review: 'Review',
  done: 'Done',
  rejected: 'Rejected',
};

const isPlaygroundStatus = (s: string): s is PlaygroundStatus =>
  s === 'todo' || s === 'in_progress' || s === 'review' || s === 'done' || s === 'rejected';

const IssueStatusDropdown = ({
  status,
  busy,
  onTransition,
}: {
  status: string;
  busy: boolean;
  onTransition: (next: PlaygroundStatus) => void;
}) => {
  const playgroundStatus = isPlaygroundStatus(status) ? status : null;
  const allowedNext = playgroundStatus ? STATUS_TRANSITIONS[playgroundStatus] : [];
  const tagColor =
    (STATUS_TAG_COLOR as Record<string, 'default' | 'indigo' | 'lemon' | 'lime' | 'coral'>)[status] ?? 'default';

  // Legacy detection states (`pending`/`resolved`) and terminal states
  // (`done`/`rejected`) get a static tag — the state machine has no
  // legal next move from there.
  if (!playgroundStatus || allowedNext.length === 0) {
    return (
      <Tag componentId="mlflow.playground.issue-detail.status" color={tagColor}>
        {status}
      </Tag>
    );
  }

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <Button componentId="mlflow.playground.issue-detail.status-dropdown" size="small" loading={busy}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Tag componentId="mlflow.playground.issue-detail.status" color={tagColor}>
              {status}
            </Tag>
            <ChevronDownIcon />
          </span>
        </Button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Content align="start">
        <DropdownMenu.Label>Move to…</DropdownMenu.Label>
        {allowedNext.map((next) => (
          <DropdownMenu.Item
            key={next}
            componentId={`mlflow.playground.issue-detail.status-dropdown.item-${next}`}
            onClick={() => onTransition(next)}
          >
            <Tag
              componentId={`mlflow.playground.issue-detail.status-dropdown.tag-${next}`}
              color={STATUS_TAG_COLOR[next]}
            >
              {next}
            </Tag>
            <span style={{ marginLeft: 8 }}>{STATUS_LABEL[next]}</span>
          </DropdownMenu.Item>
        ))}
      </DropdownMenu.Content>
    </DropdownMenu.Root>
  );
};

// --- Issue description parsing ----------------------------------------------
//
// Issues created by the failure-driven loop carry a machine-readable lineage
// block at the bottom of their description (see `mlflow.genai.issues`). We
// parse it out here so the right rail can render the structured fields and
// the left column can show only the human-readable body.

const _LINEAGE_MARKER = '<!-- mlflow.issue.lineage -->';

type IssueLineage = {
  member_feedback_ids?: string[];
  representative_trace_ids?: string[];
  confidence?: number;
  test_dataset_id?: string;
};

const _parseLineage = (description: string): IssueLineage => {
  if (!description.includes(_LINEAGE_MARKER)) return {};
  const match = description.match(/```json\s*(\{[\s\S]*?\})\s*```/);
  if (!match) return {};
  try {
    return JSON.parse(match[1]) as IssueLineage;
  } catch {
    return {};
  }
};

const _bodyWithoutLineage = (description: string): string => {
  if (!description.includes(_LINEAGE_MARKER)) return description;
  return description.split(_LINEAGE_MARKER)[0].trimEnd();
};

const _formatTimestamp = (ms: number | undefined): string => {
  if (!ms) return '—';
  return new Date(ms).toLocaleString();
};

// Renders one row in the Details rail. Keeps the label / value alignment
// consistent across both populated and empty values. Accepts an optional
// leading icon to make the rail scannable at a glance.
const DetailRow = ({
  label,
  icon,
  children,
}: {
  label: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) => {
  const { theme } = useDesignSystemTheme();
  return (
    <div css={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <div css={{ display: 'flex', alignItems: 'center', gap: theme.spacing.xs }}>
        {icon && (
          <span css={{ color: theme.colors.textSecondary, display: 'inline-flex' }}>{icon}</span>
        )}
        <Typography.Text color="secondary" size="sm">
          {label}
        </Typography.Text>
      </div>
      <div css={{ fontSize: theme.typography.fontSizeSm }}>{children}</div>
    </div>
  );
};

// Deterministic hue for an author so two people don't get the same avatar.
const _avatarHue = (name: string): number => {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
  return h;
};

const _isSystemActor = (author: string): boolean =>
  author.includes('.') || /verify|agent|claude|bot|mlflow|gpt|model/i.test(author);

const _authorInitials = (name: string): string => {
  const parts = name.replace(/[._-]+/g, ' ').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
};

const ActivityIcon = ({ author, kind }: { author: string; kind?: string }) => {
  const { theme } = useDesignSystemTheme();
  const sz = 24;
  if (kind === 'system' || _isSystemActor(author)) {
    return (
      <div
        css={{
          width: sz,
          height: sz,
          borderRadius: '50%',
          backgroundColor: theme.colors.backgroundSecondary,
          color: theme.colors.textSecondary,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          fontSize: 14,
        }}
      >
        <RobotIcon />
      </div>
    );
  }
  const hue = _avatarHue(author);
  return (
    <div
      css={{
        width: sz,
        height: sz,
        borderRadius: '50%',
        backgroundColor: `hsl(${hue}, 55%, 55%)`,
        color: 'white',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: 0.5,
      }}
    >
      {_authorInitials(author)}
    </div>
  );
};

export const IssueDetailDrawer = ({
  issueId,
  visible,
  onClose,
  onIssueUpdated,
  onNavigate,
}: {
  issueId: string | null;
  visible: boolean;
  onClose: () => void;
  onIssueUpdated?: (issue: IssueDetail) => void;
  // Reserved for future use (e.g. trace deeplinks). Accepted to preserve
  // existing call sites without forcing them to drop the prop.
  experimentId?: string;
  // Called when the user navigates to a sibling issue in the same column
  // via arrow keys or the header up/down buttons. Parent updates its
  // ``issueId`` state to the new id.
  onNavigate?: (issueId: string) => void;
}) => {
  const { theme } = useDesignSystemTheme();
  const [issue, setIssue] = useState<IssueDetail | null>(null);
  const [siblings, setSiblings] = useState<IssueDetail[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [transitioning, setTransitioning] = useState(false);
  const [transitionError, setTransitionError] = useState<string | null>(null);

  const onTransitionStatus = useCallback(
    async (next: PlaygroundStatus) => {
      if (!issueId) return;
      setTransitioning(true);
      setTransitionError(null);
      try {
        const updated = await transitionIssue(issueId, next);
        setIssue(updated);
        onIssueUpdated?.(updated);
      } catch (e) {
        setTransitionError(e instanceof Error ? e.message : String(e));
      } finally {
        setTransitioning(false);
      }
    },
    [issueId, onIssueUpdated],
  );

  useEffect(() => {
    if (!visible || !issueId) {
      setIssue(null);
      setLoadError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    fetchIssue(issueId)
      .then((issueData) => {
        if (cancelled) return;
        setIssue(issueData);
        setLoadError(null);
      })
      .catch((e) => {
        if (cancelled) return;
        setLoadError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [visible, issueId]);

  // Fetch the column siblings whenever the active issue's experiment changes,
  // so up/down navigation can target only issues in the same column. We
  // intentionally don't refetch on every status transition — the order is
  // stable enough for keyboard nav within a single session.
  const experimentForSiblings = issue?.experiment_id;
  useEffect(() => {
    if (!visible || !experimentForSiblings) return;
    let cancelled = false;
    fetchIssues(experimentForSiblings)
      .then((all) => {
        if (!cancelled) setSiblings(all);
      })
      .catch(() => {
        // Navigation is a nicety; failing to load siblings is non-fatal.
        if (!cancelled) setSiblings([]);
      });
    return () => {
      cancelled = true;
    };
  }, [visible, experimentForSiblings]);

  const lineage = useMemo<IssueLineage>(() => (issue ? _parseLineage(issue.description) : {}), [issue]);
  const body = useMemo(() => (issue ? _bodyWithoutLineage(issue.description) : ''), [issue]);
  const representativeTraces = lineage.representative_trace_ids ?? [];
  const memberFeedbackIds = lineage.member_feedback_ids ?? [];

  // Compute prev / next issue in the same column. Mirrors the kanban sort
  // (last_updated_timestamp desc) so the keyboard order matches what the
  // user sees on the board.
  const issueStatus = issue?.status;
  const columnSorted = useMemo(() => {
    if (!issueStatus) return [] as IssueDetail[];
    return siblings
      .filter((s) => s.status === issueStatus)
      .sort((a, b) => (b.last_updated_timestamp ?? 0) - (a.last_updated_timestamp ?? 0));
  }, [siblings, issueStatus]);

  const currentIssueId = issue?.issue_id;
  const navIndex = useMemo(
    () => (currentIssueId ? columnSorted.findIndex((s) => s.issue_id === currentIssueId) : -1),
    [columnSorted, currentIssueId],
  );
  const prevId = navIndex > 0 ? columnSorted[navIndex - 1].issue_id : null;
  const nextId = navIndex >= 0 && navIndex < columnSorted.length - 1 ? columnSorted[navIndex + 1].issue_id : null;

  const goTo = useCallback(
    (target: string | null) => {
      if (!target || !onNavigate) return;
      onNavigate(target);
    },
    [onNavigate],
  );

  // Arrow-key navigation. Only fires when the modal is visible and focus
  // isn't inside an editable element (so typing in the comment textarea
  // doesn't accidentally jump issues).
  useEffect(() => {
    if (!visible) return undefined;
    const isEditable = (el: EventTarget | null) => {
      if (!(el instanceof HTMLElement)) return false;
      const tag = el.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable;
    };
    const onKey = (e: KeyboardEvent) => {
      if (isEditable(e.target)) return;
      if (e.key === 'ArrowDown' && nextId) {
        e.preventDefault();
        goTo(nextId);
      } else if (e.key === 'ArrowUp' && prevId) {
        e.preventDefault();
        goTo(prevId);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [visible, prevId, nextId, goTo]);

  return (
    <Modal
      visible={visible}
      onCancel={onClose}
      componentId="mlflow.issue-detail.modal"
      title={
        <div css={{ display: 'flex', alignItems: 'center', gap: theme.spacing.sm }}>
          <Typography.Text color="secondary" size="sm">
            ISSUE / <code title={issueId ?? ''}>{issueId ? _truncateId(issueId) : ''}</code>
          </Typography.Text>
          {columnSorted.length > 1 && (
            <>
              <Typography.Text color="secondary" size="sm">
                {navIndex >= 0 && issue
                  ? `${navIndex + 1} / ${columnSorted.length} in ${STATUS_LABEL[issue.status as PlaygroundStatus] ?? issue.status}`
                  : ''}
              </Typography.Text>
              <Button
                componentId="mlflow.issue-detail.nav-prev"
                size="small"
                icon={<ChevronUpIcon />}
                disabled={!prevId}
                onClick={() => goTo(prevId)}
                aria-label="Previous issue in column (↑)"
                title="Previous issue in column (↑)"
              />
              <Button
                componentId="mlflow.issue-detail.nav-next"
                size="small"
                icon={<ChevronDownIcon />}
                disabled={!nextId}
                onClick={() => goTo(nextId)}
                aria-label="Next issue in column (↓)"
                title="Next issue in column (↓)"
              />
            </>
          )}
        </div>
      }
      size="wide"
      verticalSizing="maxed_out"
      footer={null}
    >
      {loading && (
        <div css={{ display: 'flex', justifyContent: 'center', padding: theme.spacing.lg }}>
          <Spinner />
        </div>
      )}
      {loadError && (
        <Alert componentId="mlflow.issue-detail.error" type="error" message={loadError} />
      )}
      {issue && (
        <div
          css={{
            display: 'grid',
            // Jira-style: wider left column for content, narrower right rail.
            gridTemplateColumns: 'minmax(0, 1fr) 280px',
            columnGap: theme.spacing.lg,
            paddingTop: theme.spacing.md,
          }}
        >
          {/* ---- Left column: title, description (markdown), comments ---- */}
          <div css={{ display: 'flex', flexDirection: 'column', gap: theme.spacing.md, minWidth: 0 }}>
            <div css={{ display: 'flex', alignItems: 'center', gap: theme.spacing.sm, lineHeight: 1 }}>
              <SparkleIcon
                css={{
                  color: theme.colors.purple,
                  fontSize: 22,
                  flexShrink: 0,
                }}
                aria-hidden="true"
              />
              <Typography.Title level={3} css={{ margin: 0, lineHeight: 1.2 }}>
                {issue.name}
              </Typography.Title>
            </div>
            {transitionError && (
              <Alert
                componentId="mlflow.issue-detail.transition-error"
                type="error"
                message={transitionError}
                closable
                onClose={() => setTransitionError(null)}
              />
            )}

            {body ? (
              <div
                css={{
                  backgroundColor: theme.colors.backgroundSecondary,
                  border: `1px solid ${theme.colors.border}`,
                  borderRadius: theme.borders.borderRadiusSm,
                  padding: `${theme.spacing.sm}px ${theme.spacing.md}px`,
                }}
              >
                <GenAIMarkdownRenderer>{body}</GenAIMarkdownRenderer>
              </div>
            ) : (
              <Typography.Text color="secondary" size="sm">
                <em>(no description)</em>
              </Typography.Text>
            )}

            {/* IssueComments renders its own "Activity" heading + border. */}
            <IssueComments issueId={issue.issue_id} />
          </div>

          {/* ---- Right rail: details + linked artifacts ---- */}
          <div
            css={{
              display: 'flex',
              flexDirection: 'column',
              gap: theme.spacing.md,
              borderLeft: `1px solid ${theme.colors.border}`,
              paddingLeft: theme.spacing.lg,
              minWidth: 0,
            }}
          >
            <Typography.Text css={{ fontWeight: 600 }}>Details</Typography.Text>
            <DetailRow label="Status">
              <IssueStatusDropdown
                status={issue.status}
                busy={transitioning}
                onTransition={onTransitionStatus}
              />
            </DetailRow>
            {typeof lineage.confidence === 'number' && (
              <DetailRow
                label="Confidence"
                icon={<SparkleIcon />}
              >{`${Math.round(lineage.confidence * 100)}%`}</DetailRow>
            )}
            <DetailRow label="Reporter" icon={<UserIcon />}>
              {issue.assignee || '—'}
            </DetailRow>
            <DetailRow label="Created">{_formatTimestamp(issue.created_timestamp)}</DetailRow>
            <DetailRow label="Updated">{_formatTimestamp(issue.last_updated_timestamp)}</DetailRow>

            <div
              css={{
                borderTop: `1px solid ${theme.colors.border}`,
                paddingTop: theme.spacing.sm,
                display: 'flex',
                flexDirection: 'column',
                gap: theme.spacing.sm,
              }}
            >
              <div css={{ display: 'flex', alignItems: 'center', gap: theme.spacing.xs }}>
                <LinkIcon css={{ color: theme.colors.textSecondary }} />
                <Typography.Text css={{ fontWeight: 600 }}>Linked artifacts</Typography.Text>
              </div>
              {issue.source_trace_id && (
                <DetailRow label="Source trace">
                  <Typography.Link
                    componentId="mlflow.issue-detail.linked.source-trace"
                    href={_traceUrl(issue.experiment_id, issue.source_trace_id)}
                    openInNewTab
                    title={issue.source_trace_id}
                    css={{ fontFamily: 'monospace' }}
                  >
                    {_truncateId(issue.source_trace_id)}
                  </Typography.Link>
                </DetailRow>
              )}
              {representativeTraces.length > 0 && (
                <DetailRow label={`Representative traces (${representativeTraces.length})`}>
                  <div css={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    {representativeTraces.map((tid) => (
                      <Typography.Link
                        componentId="mlflow.issue-detail.linked.repr-trace"
                        key={tid}
                        href={_traceUrl(issue.experiment_id, tid)}
                        openInNewTab
                        title={tid}
                        css={{ fontFamily: 'monospace', fontSize: theme.typography.fontSizeSm }}
                      >
                        {_truncateId(tid)}
                      </Typography.Link>
                    ))}
                  </div>
                </DetailRow>
              )}
              {memberFeedbackIds.length > 0 && (
                <DetailRow label="Source feedback">{memberFeedbackIds.length} item(s)</DetailRow>
              )}
              {lineage.test_dataset_id && (
                <DetailRow label="Test dataset" icon={<BeakerIcon />}>
                  <Typography.Link
                    componentId="mlflow.issue-detail.linked.test-dataset"
                    href={_datasetsUrl(issue.experiment_id)}
                    openInNewTab
                    title={lineage.test_dataset_id}
                    css={{ fontFamily: 'monospace' }}
                  >
                    {_truncateId(lineage.test_dataset_id)}
                  </Typography.Link>
                </DetailRow>
              )}
              {issue.test_case_id && (
                <DetailRow label="Test case">
                  <code css={{ wordBreak: 'break-all' }}>{issue.test_case_id}</code>
                </DetailRow>
              )}
              {issue.source_feedback_id && (
                <DetailRow label="Source feedback id">
                  <code css={{ wordBreak: 'break-all' }}>{issue.source_feedback_id}</code>
                </DetailRow>
              )}
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
};

const TestCasePanel = ({ testCase }: { testCase: TestCaseRow | null }) => {
  const { theme } = useDesignSystemTheme();
  if (!testCase) {
    return (
      <div
        css={{
          borderTop: `1px solid ${theme.colors.border}`,
          paddingTop: theme.spacing.md,
        }}
      >
        <Typography.Text css={{ fontWeight: 600 }}>Test case</Typography.Text>
        <Typography.Text color="secondary" size="sm" css={{ display: 'block' }}>
          Not generated yet — the worker hasn't synthesized a regression case for this issue.
        </Typography.Text>
      </div>
    );
  }
  const strategy = testCase.test_spec.strategy ?? 'assertion';
  const assertions = Array.isArray(testCase.test_spec.assertions) ? (testCase.test_spec.assertions as string[]) : [];
  const judgePrompt = typeof testCase.test_spec.judge_prompt === 'string' ? testCase.test_spec.judge_prompt : '';
  return (
    <div
      css={{
        borderTop: `1px solid ${theme.colors.border}`,
        paddingTop: theme.spacing.md,
        display: 'flex',
        flexDirection: 'column',
        gap: theme.spacing.sm,
      }}
    >
      <div css={{ display: 'flex', alignItems: 'center', gap: theme.spacing.sm }}>
        <Typography.Text css={{ fontWeight: 600 }}>Test case</Typography.Text>
        <Tag componentId="mlflow.playground.issue-detail.test-strategy" color="indigo">
          {strategy}
        </Tag>
      </div>
      <div>
        <Typography.Text color="secondary" size="sm">
          Input ({testCase.messages.length} {testCase.messages.length === 1 ? 'message' : 'messages'})
        </Typography.Text>
        <div
          css={{
            display: 'flex',
            flexDirection: 'column',
            gap: theme.spacing.xs,
            marginTop: theme.spacing.xs,
          }}
        >
          {testCase.messages.map((msg, i) => (
            <div
              key={i}
              css={{
                border: `1px solid ${theme.colors.border}`,
                borderRadius: theme.borders.borderRadiusMd,
                padding: theme.spacing.sm,
                backgroundColor: msg.role === 'user' ? theme.colors.blue100 : theme.colors.backgroundSecondary,
              }}
            >
              <Typography.Text size="sm" color="secondary" css={{ display: 'block' }}>
                {msg.role}
              </Typography.Text>
              <Typography.Text css={{ whiteSpace: 'pre-wrap' }}>{msg.content}</Typography.Text>
            </div>
          ))}
        </div>
      </div>
      {strategy === 'assertion' && assertions.length > 0 && (
        <div>
          <Typography.Text color="secondary" size="sm">
            Assertions
          </Typography.Text>
          <ul css={{ marginTop: theme.spacing.xs, paddingLeft: theme.spacing.lg }}>
            {assertions.map((assertion, i) => (
              <li key={i}>
                <Typography.Text>{assertion}</Typography.Text>
              </li>
            ))}
          </ul>
        </div>
      )}
      {strategy === 'judge' && judgePrompt && (
        <div>
          <Typography.Text color="secondary" size="sm">
            Judge prompt
          </Typography.Text>
          <pre
            css={{
              whiteSpace: 'pre-wrap',
              fontFamily: 'monospace',
              fontSize: theme.typography.fontSizeSm,
              border: `1px solid ${theme.colors.border}`,
              borderRadius: theme.borders.borderRadiusMd,
              padding: theme.spacing.sm,
              marginTop: theme.spacing.xs,
              backgroundColor: theme.colors.backgroundSecondary,
            }}
          >
            {judgePrompt}
          </pre>
        </div>
      )}
      {testCase.expected_response && (
        <div>
          <Typography.Text color="secondary" size="sm">
            Expected response
          </Typography.Text>
          <Typography.Paragraph css={{ marginTop: theme.spacing.xs, whiteSpace: 'pre-wrap' }}>
            {testCase.expected_response}
          </Typography.Paragraph>
        </div>
      )}
    </div>
  );
};

const VerdictView = ({ verdict }: { verdict: RunTestVerdict }) => {
  const { theme } = useDesignSystemTheme();
  const palette = verdict.passed
    ? { fg: theme.colors.green600, bg: 'rgba(220,255,220,0.5)', border: theme.colors.green400 }
    : { fg: theme.colors.red600, bg: 'rgba(255,224,224,0.5)', border: theme.colors.red400 };
  return (
    <div
      css={{
        border: `1px solid ${palette.border}`,
        borderRadius: theme.borders.borderRadiusMd,
        padding: theme.spacing.sm,
        backgroundColor: palette.bg,
        color: palette.fg,
        display: 'flex',
        flexDirection: 'column',
        gap: theme.spacing.xs,
      }}
    >
      <Typography.Text css={{ color: palette.fg, fontWeight: 700 }}>
        {verdict.passed ? 'PASS' : 'FAIL'} · {verdict.strategy}
      </Typography.Text>
      {verdict.reasons.map((reason, i) => (
        <Typography.Text key={i} css={{ color: palette.fg }}>
          {verdict.passed ? '✔ ' : '✗ '} {reason}
        </Typography.Text>
      ))}
      {verdict.agent_response_text && (
        <details css={{ marginTop: theme.spacing.xs }}>
          <summary css={{ cursor: 'pointer' }}>agent response</summary>
          <pre
            css={{
              whiteSpace: 'pre-wrap',
              fontFamily: 'monospace',
              fontSize: theme.typography.fontSizeSm,
              marginTop: theme.spacing.xs,
            }}
          >
            {verdict.agent_response_text}
          </pre>
          {verdict.agent_tool_calls.length > 0 && (
            <Typography.Text size="sm">tool calls: {verdict.agent_tool_calls.join(', ')}</Typography.Text>
          )}
        </details>
      )}
    </div>
  );
};
