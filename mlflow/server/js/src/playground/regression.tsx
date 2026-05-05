/**
 * Regression-suite tests panel — lives in the playground's right pane next
 * to Feedback. Hosts the [Run regression suite] trigger, in-progress strip
 * (when a run is active), and a list of recent runs. Server SSE endpoint
 * + recent-runs fetch land in a follow-up — for now this is the structural
 * shell so the layout work isn't blocked on the backend.
 */

import { Button, Typography, useDesignSystemTheme } from '@databricks/design-system';

export type RegressionRunSummary = {
  parent_run_id: string;
  agent_git_sha?: string;
  pass_count: number;
  fail_count: number;
  total_count: number;
  pass_rate: number;
  started_at: number;
  ended_at?: number;
};

export const RegressionTestsPanel = ({
  experimentId,
  testCount,
  recentRuns,
  inProgress,
  canRun,
  onRunSuite,
}: {
  experimentId: string | undefined;
  testCount: number;
  recentRuns: RegressionRunSummary[];
  inProgress?: { current: number; total: number; passed: number; failed: number };
  canRun: boolean;
  onRunSuite: () => void;
}) => {
  const { theme } = useDesignSystemTheme();
  const disabled = !canRun || testCount === 0;

  return (
    <div
      css={{
        display: 'flex',
        flexDirection: 'column',
        gap: theme.spacing.md,
        padding: theme.spacing.md,
        height: '100%',
        overflow: 'auto',
      }}
    >
      <div css={{ display: 'flex', flexDirection: 'column', gap: theme.spacing.sm }}>
        <Typography.Text size="sm" color="secondary">
          {testCount === 0
            ? 'No test cases yet — dispatch feedback to generate the first one.'
            : `Suite contains ${testCount} test ${testCount === 1 ? 'case' : 'cases'}.`}
        </Typography.Text>
        <Button
          componentId="mlflow.playground.regression.run-all"
          type="primary"
          onClick={onRunSuite}
          disabled={disabled}
          loading={Boolean(inProgress)}
        >
          {inProgress ? `Running ${inProgress.current}/${inProgress.total}…` : 'Run regression suite'}
        </Button>
      </div>

      {inProgress && (
        <ProgressStrip
          current={inProgress.current}
          total={inProgress.total}
          passed={inProgress.passed}
          failed={inProgress.failed}
        />
      )}

      <div css={{ display: 'flex', flexDirection: 'column', gap: theme.spacing.xs }}>
        <Typography.Text size="sm" color="secondary" css={{ fontWeight: 600 }}>
          Recent runs
        </Typography.Text>
        {recentRuns.length === 0 ? (
          <Typography.Text size="sm" color="secondary">
            No runs yet.
          </Typography.Text>
        ) : (
          recentRuns.map((run) => <RecentRunRow key={run.parent_run_id} run={run} experimentId={experimentId} />)
        )}
      </div>

      <div css={{ display: 'flex', gap: theme.spacing.md, marginTop: 'auto' }}>
        {experimentId && (
          <Typography.Link
            componentId="mlflow.playground.regression.past-runs"
            href={`/#/experiments/${experimentId}/evaluation-runs?run_kind=regression_suite`}
            target="_blank"
            rel="noreferrer"
          >
            Past runs →
          </Typography.Link>
        )}
        {experimentId && (
          <Typography.Link
            componentId="mlflow.playground.regression.browse-suite"
            href={`/#/experiments/${experimentId}/datasets`}
            target="_blank"
            rel="noreferrer"
          >
            Browse suite →
          </Typography.Link>
        )}
      </div>
    </div>
  );
};

const ProgressStrip = ({
  current,
  total,
  passed,
  failed,
}: {
  current: number;
  total: number;
  passed: number;
  failed: number;
}) => {
  const { theme } = useDesignSystemTheme();
  const pct = total > 0 ? Math.round((current / total) * 100) : 0;
  return (
    <div
      css={{
        display: 'flex',
        flexDirection: 'column',
        gap: theme.spacing.xs,
        padding: theme.spacing.sm,
        borderRadius: theme.borders.borderRadiusMd,
        backgroundColor: theme.colors.backgroundSecondary,
      }}
    >
      <div
        css={{
          height: 6,
          borderRadius: 3,
          backgroundColor: theme.colors.border,
          overflow: 'hidden',
        }}
      >
        <div css={{ width: `${pct}%`, height: '100%', backgroundColor: theme.colors.blue500 }} />
      </div>
      <div css={{ display: 'flex', justifyContent: 'space-between' }}>
        <Typography.Text size="sm" color="secondary">
          {current} / {total}
        </Typography.Text>
        <Typography.Text size="sm" color="secondary">
          {passed} ✓ &nbsp; {failed} ✗
        </Typography.Text>
      </div>
    </div>
  );
};

const RecentRunRow = ({ run, experimentId }: { run: RegressionRunSummary; experimentId: string | undefined }) => {
  const { theme } = useDesignSystemTheme();
  const allPassed = run.fail_count === 0;
  const ts = new Date(run.started_at).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
  const href = experimentId ? `/#/experiments/${experimentId}/runs/${run.parent_run_id}` : undefined;
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      css={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: theme.spacing.sm,
        padding: `${theme.spacing.xs}px ${theme.spacing.sm}px`,
        borderRadius: theme.borders.borderRadiusMd,
        border: `1px solid ${theme.colors.border}`,
        textDecoration: 'none',
        color: 'inherit',
        ':hover': { backgroundColor: theme.colors.backgroundSecondary },
      }}
    >
      <div css={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <Typography.Text size="sm">
          {ts}
          {run.agent_git_sha && (
            <Typography.Text size="sm" color="secondary" css={{ marginLeft: theme.spacing.xs }}>
              @ {run.agent_git_sha.slice(0, 7)}
            </Typography.Text>
          )}
        </Typography.Text>
      </div>
      <Typography.Text size="sm" color={allPassed ? 'success' : 'warning'}>
        {run.pass_count}/{run.total_count} {allPassed ? '✓' : '⚠'}
      </Typography.Text>
    </a>
  );
};
