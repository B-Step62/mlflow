/**
 * Issue detail panel + ``[I fixed this]`` flow (Epic 6, YUK-24/25).
 *
 * Reachable from a dispatched feedback card's "Dispatched ✓ → mlf-iss-XX"
 * link. Shows the Issue body, source trace id, generated test summary,
 * and a single mutating action: hit the user's agent with the test row,
 * evaluate the response, and on green transition the Issue to ``done``.
 */

import { useCallback, useEffect, useState } from 'react';

import { Alert, Button, Drawer, Spinner, Tag, Typography, useDesignSystemTheme } from '@databricks/design-system';

import {
  getAjaxUrl,
  getDefaultHeaders,
} from '../shared/web-shared/model-trace-explorer/ModelTraceExplorer.request.utils';

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
};

export type TestCaseRow = {
  messages: { role: string; content: string }[];
  test_spec: { strategy?: string; assertions?: string[]; judge_prompt?: string; [k: string]: unknown };
  expected_response?: string | null;
  tags: Record<string, string>;
};

// --- API helpers -------------------------------------------------------------

export const fetchIssues = async (
  experimentId: string,
  state?: string,
): Promise<IssueDetail[]> => {
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
  lines.push(`# Fix MLflow Agent Playground Issue ${issue.issue_id}`);
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
  lines.push('## Verify');
  lines.push('```bash');
  lines.push(`mlflow agent test run --issue ${issue.issue_id}`);
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

// --- Drawer -----------------------------------------------------------------

const STATUS_TAG_COLOR = {
  todo: 'default',
  in_progress: 'indigo',
  review: 'lemon',
  done: 'lime',
  rejected: 'coral',
} as const satisfies Record<string, 'default' | 'indigo' | 'lemon' | 'lime' | 'coral'>;

export const IssueDetailDrawer = ({
  issueId,
  visible,
  onClose,
  onIssueUpdated,
}: {
  issueId: string | null;
  visible: boolean;
  onClose: () => void;
  onIssueUpdated?: (issue: IssueDetail) => void;
}) => {
  const { theme } = useDesignSystemTheme();
  const [issue, setIssue] = useState<IssueDetail | null>(null);
  const [testCase, setTestCase] = useState<TestCaseRow | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [verdict, setVerdict] = useState<RunTestVerdict | null>(null);

  useEffect(() => {
    if (!visible || !issueId) {
      setIssue(null);
      setTestCase(null);
      setLoadError(null);
      setVerdict(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    // Fetch issue and test case in parallel; a missing test case (404) is
    // expected for issues whose generation hasn't completed yet.
    Promise.all([fetchIssue(issueId), fetchIssueTestCase(issueId).catch(() => null)])
      .then(([issueData, testCaseData]) => {
        if (cancelled) return;
        setIssue(issueData);
        setTestCase(testCaseData);
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

  const onRunTest = useCallback(async () => {
    if (!issueId) return;
    setRunning(true);
    setVerdict(null);
    try {
      const result = await runIssueTest(issueId);
      setVerdict(result);
      // Refresh the issue so the status reflects any transition.
      const refreshed = await fetchIssue(issueId);
      setIssue(refreshed);
      onIssueUpdated?.(refreshed);
    } catch (e) {
      setVerdict({
        passed: false,
        reasons: [e instanceof Error ? e.message : String(e)],
        strategy: 'error',
        judge_reasoning: null,
        issue_status: issue?.status ?? 'unknown',
        agent_response_text: '',
        agent_tool_calls: [],
      });
    } finally {
      setRunning(false);
    }
  }, [issueId, issue?.status, onIssueUpdated]);

  return (
    <Drawer.Root open={visible} onOpenChange={(open) => !open && onClose()}>
      <Drawer.Content
        componentId="mlflow.playground.issue-detail.drawer"
        title={issue ? `Issue ${issue.issue_id}` : 'Issue'}
        width="640px"
      >
        <div
          css={{
            display: 'flex',
            flexDirection: 'column',
            gap: theme.spacing.md,
            padding: theme.spacing.md,
            height: '100%',
            overflowY: 'auto',
          }}
        >
          {loading && (
            <div css={{ display: 'flex', justifyContent: 'center', padding: theme.spacing.lg }}>
              <Spinner />
            </div>
          )}
          {loadError && <Alert componentId="mlflow.playground.issue-detail.error" type="error" message={loadError} />}
          {issue && (
            <>
              <div css={{ display: 'flex', alignItems: 'center', gap: theme.spacing.sm }}>
                <Tag
                  componentId="mlflow.playground.issue-detail.status"
                  color={
                    (STATUS_TAG_COLOR as Record<string, 'default' | 'indigo' | 'lemon' | 'lime' | 'coral'>)[
                      issue.status
                    ] ?? 'default'
                  }
                >
                  {issue.status}
                </Tag>
                <Typography.Text css={{ fontWeight: 600 }}>{issue.name}</Typography.Text>
              </div>
              <div>
                <Typography.Text color="secondary" size="sm">
                  Description
                </Typography.Text>
                <Typography.Paragraph>{issue.description}</Typography.Paragraph>
              </div>
              <div
                css={{
                  display: 'grid',
                  gridTemplateColumns: 'auto 1fr',
                  columnGap: theme.spacing.md,
                  rowGap: theme.spacing.xs,
                  fontFamily: 'monospace',
                  fontSize: theme.typography.fontSizeSm,
                }}
              >
                {issue.source_trace_id && (
                  <>
                    <Typography.Text color="secondary">trace</Typography.Text>
                    <Typography.Text>{issue.source_trace_id}</Typography.Text>
                  </>
                )}
                {issue.source_feedback_id && (
                  <>
                    <Typography.Text color="secondary">feedback</Typography.Text>
                    <Typography.Text>{issue.source_feedback_id}</Typography.Text>
                  </>
                )}
                {issue.test_case_id && (
                  <>
                    <Typography.Text color="secondary">test_case</Typography.Text>
                    <Typography.Text>{issue.test_case_id}</Typography.Text>
                  </>
                )}
                {issue.assignee && (
                  <>
                    <Typography.Text color="secondary">assignee</Typography.Text>
                    <Typography.Text>{issue.assignee}</Typography.Text>
                  </>
                )}
              </div>

              <TestCasePanel testCase={testCase} />

              <div
                css={{
                  borderTop: `1px solid ${theme.colors.border}`,
                  paddingTop: theme.spacing.md,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: theme.spacing.sm,
                }}
              >
                <Typography.Text css={{ fontWeight: 600 }}>Run the regression test</Typography.Text>
                <Typography.Text color="secondary" size="sm">
                  Replays this Issue's test against the local agent. On a pass, the Issue auto-transitions to{' '}
                  <code>done</code>.
                </Typography.Text>
                <div>
                  <Button
                    componentId="mlflow.playground.issue-detail.run-test"
                    type="primary"
                    onClick={onRunTest}
                    disabled={running || issue.status === 'done' || issue.status === 'rejected'}
                  >
                    {running ? 'Running…' : 'I fixed this — run test'}
                  </Button>
                </div>
                {verdict && <VerdictView verdict={verdict} />}
                {verdict && !verdict.passed && (
                  <div
                    css={{
                      borderTop: `1px solid ${theme.colors.border}`,
                      paddingTop: theme.spacing.sm,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: theme.spacing.xs,
                    }}
                  >
                    <Typography.Text size="sm" color="secondary">
                      Need a hand fixing this? Copy a ready-made prompt and paste it into a local Claude Code session —
                      it includes the test spec, the conversation prefix, and what just failed.
                    </Typography.Text>
                    <CopyFixPromptButton issue={issue} testCase={testCase} verdict={verdict} />
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </Drawer.Content>
    </Drawer.Root>
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
