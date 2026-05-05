/**
 * Regression-suite tests panel — lives in the playground's right pane next
 * to Feedback. Hosts the [Run regression suite] trigger, in-progress strip
 * (when a run is active), recent-runs list, and entry points to the past-
 * runs / browse-suite drawers. Server SSE endpoint and the actual run loop
 * land in a follow-up (YUK-45).
 */

import { useEffect, useState } from 'react';

import {
  Button,
  Drawer,
  NewWindowIcon,
  Spinner,
  Typography,
  useDesignSystemTheme,
} from '@databricks/design-system';

import {
  getAjaxUrl,
  getDefaultHeaders,
} from '../shared/web-shared/model-trace-explorer/ModelTraceExplorer.request.utils';

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

  const [pastRunsOpen, setPastRunsOpen] = useState(false);
  const [browseSuiteOpen, setBrowseSuiteOpen] = useState(false);

  return (
    <>
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
          <Button
            componentId="mlflow.playground.regression.past-runs"
            type="link"
            onClick={() => setPastRunsOpen(true)}
            disabled={!experimentId}
          >
            Past runs →
          </Button>
          <Button
            componentId="mlflow.playground.regression.browse-suite"
            type="link"
            onClick={() => setBrowseSuiteOpen(true)}
            disabled={!experimentId}
          >
            Browse suite →
          </Button>
        </div>
      </div>

      <PastRunsDrawer
        open={pastRunsOpen}
        onClose={() => setPastRunsOpen(false)}
        experimentId={experimentId}
      />
      <BrowseSuiteDrawer
        open={browseSuiteOpen}
        onClose={() => setBrowseSuiteOpen(false)}
        experimentId={experimentId}
      />
    </>
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

// --- Drawers -----------------------------------------------------------------
//
// Each drawer pairs an in-place compact view (live data fetched against
// the same MLflow APIs the standalone pages use) with an "Open in new
// window" escape hatch for the full experience. The fetched data is the
// minimal slice needed for at-a-glance triage; the user pops the full
// page when they need filters / column controls / compare flows.

type RegressionRunRow = {
  info?: { run_id?: string; start_time?: number; status?: string };
  data?: {
    metrics?: { key: string; value: number }[];
    tags?: { key: string; value: string }[];
  };
};

const PastRunsDrawer = ({
  open,
  onClose,
  experimentId,
}: {
  open: boolean;
  onClose: () => void;
  experimentId: string | undefined;
}) => {
  const { theme } = useDesignSystemTheme();
  const [runs, setRuns] = useState<RegressionRunRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !experimentId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(getAjaxUrl('ajax-api/2.0/mlflow/runs/search'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getDefaultHeaders(document.cookie) },
      body: JSON.stringify({
        experiment_ids: [experimentId],
        filter: `tags."playground.run_kind" = "regression_suite"`,
        max_results: 50,
        order_by: ['attributes.start_time DESC'],
      }),
    })
      .then(async (r) => {
        if (!r.ok) throw new Error(`Search runs failed (${r.status})`);
        return r.json();
      })
      .then((data) => {
        if (!cancelled) setRuns(data.runs ?? []);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, experimentId]);

  const fullUrl = experimentId
    ? `/#/experiments/${experimentId}/evaluation-runs?run_kind=regression_suite`
    : '#';

  return (
    <Drawer.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <Drawer.Content
        componentId="mlflow.playground.regression.past-runs.drawer"
        title="Past regression runs"
        width="640px"
      >
        <div css={{ display: 'flex', flexDirection: 'column', gap: theme.spacing.md, height: '100%' }}>
          <div css={{ display: 'flex', justifyContent: 'flex-end' }}>
            <Button
              componentId="mlflow.playground.regression.past-runs.open-window"
              icon={<NewWindowIcon />}
              onClick={() => window.open(fullUrl, '_blank', 'noopener,noreferrer')}
              disabled={!experimentId}
            >
              Open in new window
            </Button>
          </div>

          {loading && (
            <div css={{ display: 'flex', justifyContent: 'center', padding: theme.spacing.lg }}>
              <Spinner />
            </div>
          )}
          {error && <Typography.Text color="error">{error}</Typography.Text>}
          {!loading && !error && runs.length === 0 && (
            <Typography.Text color="secondary">No regression runs yet.</Typography.Text>
          )}
          {!loading && !error && runs.length > 0 && (
            <div css={{ display: 'flex', flexDirection: 'column', gap: theme.spacing.xs, overflow: 'auto' }}>
              {runs.map((run) => (
                <PastRunRow key={run.info?.run_id ?? Math.random()} run={run} experimentId={experimentId} />
              ))}
            </div>
          )}
        </div>
      </Drawer.Content>
    </Drawer.Root>
  );
};

const PastRunRow = ({ run, experimentId }: { run: RegressionRunRow; experimentId: string | undefined }) => {
  const { theme } = useDesignSystemTheme();
  const runId = run.info?.run_id;
  const startTime = run.info?.start_time;
  const ts = startTime
    ? new Date(startTime).toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '—';
  const metrics = Object.fromEntries((run.data?.metrics ?? []).map((m) => [m.key, m.value]));
  const tags = Object.fromEntries((run.data?.tags ?? []).map((t) => [t.key, t.value]));
  const passRate = metrics['pass_rate'];
  const passCount = metrics['pass_count'];
  const failCount = metrics['fail_count'];
  const total = (passCount ?? 0) + (failCount ?? 0);
  const allPassed = (failCount ?? 0) === 0;
  const sha = tags['agent_git_sha'];
  const href = experimentId && runId ? `/#/experiments/${experimentId}/runs/${runId}` : undefined;

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
        padding: theme.spacing.sm,
        borderRadius: theme.borders.borderRadiusMd,
        border: `1px solid ${theme.colors.border}`,
        textDecoration: 'none',
        color: 'inherit',
        ':hover': { backgroundColor: theme.colors.backgroundSecondary },
      }}
    >
      <div css={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <Typography.Text>{ts}</Typography.Text>
        {sha && (
          <Typography.Text size="sm" color="secondary" css={{ fontFamily: 'monospace' }}>
            @ {sha.slice(0, 7)}
          </Typography.Text>
        )}
      </div>
      <Typography.Text color={allPassed ? 'success' : 'warning'}>
        {passCount ?? 0}/{total || '?'} {allPassed ? '✓' : '⚠'}
        {passRate != null && (
          <Typography.Text size="sm" color="secondary" css={{ marginLeft: theme.spacing.xs }}>
            {Math.round(passRate * 100)}%
          </Typography.Text>
        )}
      </Typography.Text>
    </a>
  );
};

const BrowseSuiteDrawer = ({
  open,
  onClose,
  experimentId,
}: {
  open: boolean;
  onClose: () => void;
  experimentId: string | undefined;
}) => {
  const { theme } = useDesignSystemTheme();
  const fullUrl = experimentId
    ? `/#/experiments/${experimentId}/datasets?name=regression_suite_${experimentId}`
    : '#';

  // The suite is an EvaluationDataset; embedding the row table requires the
  // dataset records API which expects pagination / column-resolving. For
  // first cut we surface a clean entry point + reuse of the existing
  // dataset detail page via "Open in new window". Real embedded row table
  // is a YUK-45 follow-up.
  return (
    <Drawer.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <Drawer.Content
        componentId="mlflow.playground.regression.browse-suite.drawer"
        title="Regression suite"
        width="640px"
      >
        <div css={{ display: 'flex', flexDirection: 'column', gap: theme.spacing.md, height: '100%' }}>
          <div css={{ display: 'flex', justifyContent: 'flex-end' }}>
            <Button
              componentId="mlflow.playground.regression.browse-suite.open-window"
              icon={<NewWindowIcon />}
              onClick={() => window.open(fullUrl, '_blank', 'noopener,noreferrer')}
              disabled={!experimentId}
            >
              Open in new window
            </Button>
          </div>

          <Typography.Text color="secondary">
            Inline row browser is coming as part of YUK-45. For now, click <em>Open in new window</em> above to view
            and edit the suite on the EvaluationDataset detail page.
          </Typography.Text>
        </div>
      </Drawer.Content>
    </Drawer.Root>
  );
};
