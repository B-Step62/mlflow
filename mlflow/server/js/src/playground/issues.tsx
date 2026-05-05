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

// --- API helpers -------------------------------------------------------------

export const fetchIssue = async (issueId: string): Promise<IssueDetail> => {
  const response = await fetch(getAjaxUrl(`ajax-api/3.0/mlflow/playground/issues/${encodeURIComponent(issueId)}`), {
    headers: getDefaultHeaders(document.cookie),
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch issue (${response.status}): ${await response.text()}`);
  }
  return (await response.json()) as IssueDetail;
};

export const runIssueTest = async (issueId: string): Promise<RunTestVerdict> => {
  const response = await fetch(
    getAjaxUrl(`ajax-api/3.0/mlflow/playground/issues/${encodeURIComponent(issueId)}/run-test`),
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...getDefaultHeaders(document.cookie),
      },
      body: JSON.stringify({}),
    },
  );
  if (!response.ok) {
    throw new Error(`Test run failed (${response.status}): ${await response.text()}`);
  }
  return (await response.json()) as RunTestVerdict;
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
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [verdict, setVerdict] = useState<RunTestVerdict | null>(null);

  useEffect(() => {
    if (!visible || !issueId) {
      setIssue(null);
      setLoadError(null);
      setVerdict(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    fetchIssue(issueId)
      .then((data) => {
        if (cancelled) return;
        setIssue(data);
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
              </div>
            </>
          )}
        </div>
      </Drawer.Content>
    </Drawer.Root>
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
