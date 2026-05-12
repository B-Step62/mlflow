/**
 * Regression-suite tests panel — lives in the playground's right pane next
 * to Feedback. Hosts the [Run regression suite] trigger, in-progress strip
 * (when a run is active), recent-runs list, and entry points to the past-
 * runs / browse-suite drawers. Server SSE endpoint and the actual run loop
 * land in a follow-up (YUK-45).
 */

import { useCallback, useEffect, useState } from 'react';

import {
  Alert,
  Button,
  CheckCircleFillIcon,
  CheckIcon,
  Checkbox,
  ClockIcon,
  CloseSmallIcon,
  CodeIcon,
  CopyIcon,
  DownloadIcon,
  Drawer,
  GearIcon,
  Input,
  Modal,
  NewWindowIcon,
  PencilIcon,
  PlayIcon,
  Spinner,
  Tooltip,
  TrashIcon,
  Typography,
  VisibleIcon,
  XCircleFillIcon,
  useDesignSystemTheme,
} from '@databricks/design-system';

import {
  getAjaxUrl,
  getDefaultHeaders,
} from '../shared/web-shared/model-trace-explorer/ModelTraceExplorer.request.utils';
import type { AgentConnection } from './connections';
import type { IssueDetail } from './issues';

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
  failingTests,
  workersByIssueId,
  onOpenIssue,
  onDispatchSelected,
  onCopyFixPrompt,
  onRerunSelected,
  onDeleteSelected,
  onRunSuite,
  onCasesChanged,
  onSelectRun,
}: {
  experimentId: string | undefined;
  testCount: number;
  recentRuns: RegressionRunSummary[];
  inProgress?: { current: number; total: number; passed: number; failed: number };
  canRun: boolean;
  // Issues whose test the agent currently fails (status in todo / in_progress).
  // Rendered as a "Failing on current agent" triage list so reviewers can
  // pick which to fix next without leaving the playground.
  failingTests?: IssueDetail[];
  // Maps `issue_id -> AgentConnection` for issues that currently have a
  // worker. Overlays the per-row icon: pending = spinner, ready = "Preview"
  // (eye). Folds in what used to be the separate "Tasks" accordion.
  workersByIssueId?: Map<string, AgentConnection>;
  onOpenIssue?: (issueId: string) => void;
  // Selection-bar handlers wired into the failing-tests triage list. All
  // receive the set of selected issue ids.
  // - `onDispatchSelected` is the primary action: fires a Claude Code
  //   worker per selected issue via the dispatch endpoint.
  // - `onCopyFixPrompt` is the manual-flow escape hatch: copies a
  //   combined fix prompt to the clipboard for hand-driving Claude.
  onDispatchSelected?: (issueIds: string[]) => void | Promise<void>;
  onCopyFixPrompt?: (issueIds: string[]) => void | Promise<void>;
  onRerunSelected?: (issueIds: string[]) => void | Promise<void>;
  onDeleteSelected?: (issueIds: string[]) => void | Promise<void>;
  onRunSuite: () => void;
  // Called whenever the drawer mutates the suite (delete a case today;
  // edits later). Parent uses this to reload its case count so the
  // panel header stays in sync without polling.
  onCasesChanged?: () => void;
  // Clicking a recent-run row calls this with the run id; parent fetches
  // the snapshot and rehydrates the navigator. Optional so callers that
  // only want display can omit it.
  onSelectRun?: (runId: string) => void;
}) => {
  const { theme } = useDesignSystemTheme();
  const disabled = !canRun || testCount === 0;

  const [browseSuiteOpen, setBrowseSuiteOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [recentRunsOpen, setRecentRunsOpen] = useState(false);
  // Selection-bar state lives here so the bar can render in place of the
  // [Run regression suite] controls when any are selected (overlay UX).
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [busyAction, setBusyAction] = useState<null | 'dispatch' | 'copy' | 'rerun' | 'delete'>(null);
  // Prune selections that disappear from the underlying list (issue
  // transitioned to done, test case deleted, etc.) so the count stays
  // honest.
  const visibleIds = new Set((failingTests ?? []).map((t) => t.issue_id));
  const cleanSelected = new Set([...selectedIds].filter((id) => visibleIds.has(id)));
  if (cleanSelected.size !== selectedIds.size) {
    setSelectedIds(cleanSelected);
  }
  const toggleSelection = (issueId: string) =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(issueId)) next.delete(issueId);
      else next.add(issueId);
      return next;
    });
  const selectedArray = [...cleanSelected];
  const runSelectionAction = async (
    kind: 'dispatch' | 'copy' | 'rerun' | 'delete',
    handler?: (ids: string[]) => void | Promise<void>,
  ) => {
    if (!handler || selectedArray.length === 0) return;
    setBusyAction(kind);
    try {
      await handler(selectedArray);
    } finally {
      setBusyAction(null);
    }
    if (kind === 'rerun' || kind === 'delete') {
      setSelectedIds(new Set());
    }
  };
  const hasSelection = cleanSelected.size > 0;

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
        {hasSelection ? (
          <div
            css={{
              display: 'flex',
              alignItems: 'center',
              gap: theme.spacing.xs,
              padding: theme.spacing.xs,
              borderRadius: theme.borders.borderRadiusMd,
              backgroundColor: theme.colors.backgroundSecondary,
              border: `1px solid ${theme.colors.actionPrimaryBackgroundDefault}`,
              flexWrap: 'wrap',
            }}
          >
            <Typography.Text size="sm" css={{ fontWeight: 600, paddingLeft: theme.spacing.xs }}>
              {cleanSelected.size} selected
            </Typography.Text>
            <span css={{ flex: 1 }} />
            <Button
              componentId="mlflow.playground.regression.failing.fix-dispatch"
              size="small"
              type="primary"
              loading={busyAction === 'dispatch'}
              disabled={busyAction !== null || !onDispatchSelected}
              onClick={() => void runSelectionAction('dispatch', onDispatchSelected)}
            >
              {busyAction === 'dispatch' ? 'Dispatching…' : `Fix with Claude Code (${cleanSelected.size})`}
            </Button>
            <Tooltip
              componentId="mlflow.playground.regression.failing.fix-copy.tooltip"
              content="Copy combined fix prompt to clipboard (manual fix flow)"
            >
              <Button
                componentId="mlflow.playground.regression.failing.fix-copy"
                size="small"
                icon={<CopyIcon />}
                aria-label="Copy combined fix prompt"
                loading={busyAction === 'copy'}
                disabled={busyAction !== null || !onCopyFixPrompt}
                onClick={() => void runSelectionAction('copy', onCopyFixPrompt)}
              />
            </Tooltip>
            <Tooltip componentId="mlflow.playground.regression.failing.rerun.tooltip" content="Re-run selected tests">
              <Button
                componentId="mlflow.playground.regression.failing.rerun"
                size="small"
                icon={<PlayIcon />}
                aria-label="Re-run selected tests"
                loading={busyAction === 'rerun'}
                disabled={busyAction !== null || !onRerunSelected}
                onClick={() => void runSelectionAction('rerun', onRerunSelected)}
              />
            </Tooltip>
            <Tooltip componentId="mlflow.playground.regression.failing.delete.tooltip" content="Delete selected tests">
              <Button
                componentId="mlflow.playground.regression.failing.delete"
                size="small"
                danger
                icon={<TrashIcon />}
                aria-label="Delete selected tests"
                loading={busyAction === 'delete'}
                disabled={busyAction !== null || !onDeleteSelected}
                onClick={() => void runSelectionAction('delete', onDeleteSelected)}
              />
            </Tooltip>
            <Tooltip componentId="mlflow.playground.regression.failing.clear.tooltip" content="Clear selection">
              <Button
                componentId="mlflow.playground.regression.failing.clear"
                size="small"
                type="tertiary"
                icon={<CloseSmallIcon />}
                aria-label="Clear selection"
                onClick={() => setSelectedIds(new Set())}
              />
            </Tooltip>
          </div>
        ) : (
          <div css={{ display: 'flex', flexDirection: 'column', gap: theme.spacing.sm }}>
            <div css={{ display: 'flex', alignItems: 'center', gap: theme.spacing.sm }}>
              <Typography.Text size="sm" color="secondary" css={{ flex: 1, minWidth: 0 }}>
                {testCount > 0
                  ? `Suite contains ${testCount} test ${testCount === 1 ? 'case' : 'cases'}.`
                  : (failingTests?.length ?? 0) > 0
                    ? '' // Failing-tests list tells the story; don't contradict it.
                    : 'No test cases yet — dispatch feedback to generate the first one.'}
              </Typography.Text>
              <Tooltip componentId="mlflow.playground.regression.export.tooltip" content="Export as pytest script">
                <Button
                  componentId="mlflow.playground.regression.export"
                  size="small"
                  icon={<CodeIcon />}
                  aria-label="Export tests as pytest script"
                  onClick={() => setExportOpen(true)}
                  disabled={!experimentId || testCount === 0}
                />
              </Tooltip>
              <Tooltip componentId="mlflow.playground.regression.browse-suite.tooltip" content="Browse / manage suite">
                <Button
                  componentId="mlflow.playground.regression.browse-suite"
                  size="small"
                  icon={<GearIcon />}
                  aria-label="Browse / manage suite"
                  onClick={() => setBrowseSuiteOpen(true)}
                  disabled={!experimentId}
                />
              </Tooltip>
              <Tooltip
                componentId="mlflow.playground.regression.recent-runs.tooltip"
                content={recentRunsOpen ? 'Hide recent runs' : 'Show recent runs'}
              >
                <Button
                  componentId="mlflow.playground.regression.recent-runs"
                  size="small"
                  icon={<ClockIcon />}
                  aria-label="Toggle recent runs"
                  onClick={() => setRecentRunsOpen((v) => !v)}
                />
              </Tooltip>
            </div>
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
        )}

        {inProgress && (
          <ProgressStrip
            current={inProgress.current}
            total={inProgress.total}
            passed={inProgress.passed}
            failed={inProgress.failed}
          />
        )}

        <FailingTestsList
          tests={failingTests ?? []}
          workersByIssueId={workersByIssueId}
          selectedIds={cleanSelected}
          onToggleSelection={toggleSelection}
          onOpenIssue={onOpenIssue}
        />

        {recentRunsOpen && (
          <div css={{ display: 'flex', flexDirection: 'column', gap: theme.spacing.xs }}>
            <Typography.Text size="sm" color="secondary" css={{ fontWeight: 600 }}>
              Recent runs
            </Typography.Text>
            {recentRuns.length === 0 ? (
              <Typography.Text size="sm" color="secondary">
                No runs yet.
              </Typography.Text>
            ) : (
              recentRuns.map((run) => (
                <RecentRunRow key={run.parent_run_id} run={run} experimentId={experimentId} onSelectRun={onSelectRun} />
              ))
            )}
          </div>
        )}
      </div>

      <BrowseSuiteDrawer
        open={browseSuiteOpen}
        onClose={() => setBrowseSuiteOpen(false)}
        onCasesChanged={onCasesChanged}
        experimentId={experimentId}
      />

      {exportOpen && experimentId && (
        <ExportTestsModal experimentId={experimentId} onClose={() => setExportOpen(false)} />
      )}
    </>
  );
};

const formatRelativeTime = (timestampMs?: number): string => {
  if (!timestampMs) return '';
  const diffSec = (Date.now() - timestampMs) / 1000;
  if (diffSec < 60) return 'just now';
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86_400) return `${Math.floor(diffSec / 3600)}h ago`;
  return `${Math.floor(diffSec / 86_400)}d ago`;
};

const FailingTestsList = ({
  tests,
  workersByIssueId,
  selectedIds,
  onToggleSelection,
  onOpenIssue,
}: {
  tests: IssueDetail[];
  workersByIssueId?: Map<string, AgentConnection>;
  selectedIds: Set<string>;
  onToggleSelection: (issueId: string) => void;
  onOpenIssue?: (issueId: string) => void;
}) => {
  const { theme } = useDesignSystemTheme();

  return (
    <div css={{ display: 'flex', flexDirection: 'column', gap: theme.spacing.xs }}>
      <Typography.Text size="sm" color="secondary" css={{ fontWeight: 600 }}>
        Tests on current agent ({tests.length})
      </Typography.Text>
      {tests.length === 0 ? (
        <Typography.Text size="sm" color="secondary">
          No tests yet.
        </Typography.Text>
      ) : (
        <div css={{ display: 'flex', flexDirection: 'column', gap: theme.spacing.xs }}>
          {tests.map((test) => {
            const isSelected = selectedIds.has(test.issue_id);
            // Per-row verdict, with the worker overlay folded in (replaces
            // the old separate "Tasks" accordion):
            //   - worker.status === 'pending'  → spinner   (worker iterating)
            //   - worker.status === 'ready'    → eye icon  (preview ready)
            //   - test.status === 'done'       → green check
            //   - test.status in
            //     ('in_progress','review')      → spinner   (human/CI in flight)
            //   - otherwise                    → red X     (failing)
            // Worker state takes precedence over the test status so the
            // reviewer sees "this is being fixed" the moment dispatch fires,
            // before any test re-run actually moves the underlying issue.
            const worker = workersByIssueId?.get(test.issue_id);
            const workerPending = worker?.status === 'pending';
            const workerReady = worker?.status === 'ready';
            const passed = test.status === 'done';
            const issueInProgress = test.status === 'in_progress' || test.status === 'review';
            const inProgress = workerPending || (issueInProgress && !workerReady);
            const previewReady = workerReady && !passed;
            const iconColor = passed
              ? theme.colors.green500
              : previewReady
                ? theme.colors.blue500
                : inProgress
                  ? theme.colors.blue500
                  : theme.colors.red500;
            const verdictLabel = passed
              ? 'Passed'
              : previewReady
                ? 'Preview ready'
                : inProgress
                  ? 'Fix in progress'
                  : 'Failing';
            return (
              <div
                key={test.issue_id}
                data-selected={isSelected ? 'true' : undefined}
                role={onOpenIssue ? 'button' : undefined}
                tabIndex={onOpenIssue ? 0 : undefined}
                onClick={() => onOpenIssue?.(test.issue_id)}
                onKeyDown={(e) => {
                  if ((e.key === 'Enter' || e.key === ' ') && onOpenIssue) {
                    e.preventDefault();
                    onOpenIssue(test.issue_id);
                  }
                }}
                css={{
                  border: `1px solid ${isSelected ? theme.colors.actionPrimaryBackgroundDefault : theme.colors.border}`,
                  borderRadius: theme.borders.borderRadiusMd,
                  padding: theme.spacing.sm,
                  cursor: onOpenIssue ? 'pointer' : 'default',
                  display: 'flex',
                  alignItems: 'center',
                  gap: theme.spacing.sm,
                  backgroundColor: isSelected ? theme.colors.backgroundSecondary : 'transparent',
                  ':hover': onOpenIssue ? { backgroundColor: theme.colors.backgroundSecondary } : undefined,
                  // Crossfade verdict icon ↔ checkbox. Both layers are
                  // `pointer-events: none` so the wrapper's onClick is the
                  // single source of truth — antd Checkbox would otherwise
                  // fire its own onChange on the same click as the wrapper,
                  // leaving selection unchanged.
                  '& .row-verdict-icon, & .row-checkbox': {
                    transition: 'opacity 150ms',
                    pointerEvents: 'none',
                    display: 'inline-flex',
                  },
                  '& .row-verdict-icon': {
                    color: iconColor,
                    transitionProperty: 'opacity, color',
                  },
                  '& .row-checkbox': {
                    opacity: 0,
                  },
                  '&:hover .row-verdict-icon, &[data-selected="true"] .row-verdict-icon': {
                    opacity: 0,
                  },
                  '&:hover .row-checkbox, &[data-selected="true"] .row-checkbox': {
                    opacity: 1,
                  },
                }}
              >
                <span
                  css={{
                    position: 'relative',
                    width: 16,
                    height: 16,
                    flexShrink: 0,
                  }}
                  // Toggling selection shouldn't also open the drawer.
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleSelection(test.issue_id);
                  }}
                >
                  <span
                    className="row-verdict-icon"
                    css={{
                      position: 'absolute',
                      inset: 0,
                      // Spinner ships its own sizing; clip to the same 16x16
                      // slot so it doesn't push the row layout when it kicks in.
                      '& > *': inProgress ? { width: 16, height: 16 } : undefined,
                    }}
                    aria-label={verdictLabel}
                  >
                    {passed ? (
                      <CheckCircleFillIcon />
                    ) : previewReady ? (
                      <VisibleIcon />
                    ) : inProgress ? (
                      <Spinner size="small" />
                    ) : (
                      <XCircleFillIcon />
                    )}
                  </span>
                  <span
                    className="row-checkbox"
                    css={{ position: 'absolute', inset: 0 }}
                    aria-label={isSelected ? 'Deselect test' : 'Select test'}
                  >
                    {/* `onChange` is a no-op because the wrapper's onClick owns
                        toggling; the Checkbox container has `pointer-events: none`
                        via CSS so this handler should never fire anyway. Antd
                        still requires the prop for the controlled-state contract. */}
                    <Checkbox
                      componentId="mlflow.playground.regression.failing.row-checkbox"
                      isChecked={isSelected}
                      onChange={() => {}}
                    />
                  </span>
                </span>
                <Typography.Text
                  css={{
                    flex: 1,
                    fontWeight: 600,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                  title={test.name || test.issue_id}
                >
                  {test.name || '(untitled issue)'}
                </Typography.Text>
                {previewReady && (
                  <Typography.Text
                    size="sm"
                    css={{
                      flexShrink: 0,
                      color: theme.colors.blue500,
                      fontWeight: 600,
                    }}
                  >
                    Preview
                  </Typography.Text>
                )}
                <Typography.Text size="sm" color="secondary" css={{ flexShrink: 0 }}>
                  {formatRelativeTime(test.last_updated_timestamp ?? test.created_timestamp)}
                </Typography.Text>
              </div>
            );
          })}
        </div>
      )}
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

// --- Export-as-pytest modal -------------------------------------------------
// Fetches a generated pytest file from the export endpoint and surfaces it in
// a copy-/download-friendly modal. Pure presentation — the LLM generation
// happens server-side in `mlflow/playground/test_export.py`.

type ExportResponse = {
  language: 'python';
  filename: string;
  code: string;
};

const exportRegressionSuite = async (experimentId: string): Promise<ExportResponse> => {
  const response = await fetch(
    getAjaxUrl(
      `ajax-api/3.0/mlflow/playground/regression-suite/export?experiment_id=${encodeURIComponent(
        experimentId,
      )}&language=python`,
    ),
    { headers: getDefaultHeaders(document.cookie) },
  );
  if (!response.ok) {
    throw new Error(`Export failed (${response.status}): ${await response.text()}`);
  }
  return (await response.json()) as ExportResponse;
};

const ExportTestsModal = ({ experimentId, onClose }: { experimentId: string; onClose: () => void }) => {
  const { theme } = useDesignSystemTheme();
  const [data, setData] = useState<ExportResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    exportRegressionSuite(experimentId)
      .then((d) => {
        if (!cancelled) setData(d);
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
  }, [experimentId]);

  const onCopy = useCallback(() => {
    if (!data) return;
    void navigator.clipboard.writeText(data.code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [data]);

  const onDownload = useCallback(() => {
    if (!data) return;
    const blob = new Blob([data.code], { type: 'text/x-python' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = data.filename || 'test_regression.py';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }, [data]);

  return (
    <Modal
      visible
      title="Export regression suite as pytest"
      componentId="mlflow.playground.regression.export.modal"
      onCancel={onClose}
      size="wide"
      verticalSizing="maxed_out"
      footer={
        <div css={{ display: 'flex', gap: theme.spacing.sm, justifyContent: 'flex-end' }}>
          <Button componentId="mlflow.playground.regression.export.close" onClick={onClose}>
            Close
          </Button>
          <Button
            componentId="mlflow.playground.regression.export.copy"
            icon={copied ? <CheckIcon /> : <CopyIcon />}
            onClick={onCopy}
            disabled={!data}
          >
            {copied ? 'Copied' : 'Copy'}
          </Button>
          <Button
            componentId="mlflow.playground.regression.export.download"
            type="primary"
            icon={<DownloadIcon />}
            onClick={onDownload}
            disabled={!data}
          >
            Download {data?.filename ?? 'test_regression.py'}
          </Button>
        </div>
      }
    >
      {loading && (
        <div
          css={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: theme.spacing.lg,
            gap: theme.spacing.sm,
          }}
        >
          <Spinner />
          <Typography.Text color="secondary">Asking the LLM to assemble your test file…</Typography.Text>
        </div>
      )}
      {error && (
        <Alert componentId="mlflow.playground.regression.export.error" type="error" message={error} closable={false} />
      )}
      {data && (
        <pre
          css={{
            margin: 0,
            padding: theme.spacing.md,
            backgroundColor: theme.colors.backgroundSecondary,
            borderRadius: theme.borders.borderRadiusMd,
            fontFamily: 'monospace',
            fontSize: theme.typography.fontSizeSm,
            lineHeight: 1.5,
            overflow: 'auto',
            maxHeight: '60vh',
            whiteSpace: 'pre',
          }}
        >
          {data.code}
        </pre>
      )}
    </Modal>
  );
};

const RecentRunRow = ({
  run,
  experimentId,
  onSelectRun,
}: {
  run: RegressionRunSummary;
  experimentId: string | undefined;
  onSelectRun?: (runId: string) => void;
}) => {
  const { theme } = useDesignSystemTheme();
  const allPassed = run.fail_count === 0;
  const ts = new Date(run.started_at).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
  // Click rehydrates the in-cockpit batch navigator from the persisted JSON
  // artifact. The "open run page in new tab" escape hatch hangs off the
  // dedicated icon button so the row click stays unambiguous.
  const handleClick = () => onSelectRun?.(run.parent_run_id);
  const runHref = experimentId ? `/#/experiments/${experimentId}/runs/${run.parent_run_id}` : undefined;
  return (
    <div
      role={onSelectRun ? 'button' : undefined}
      tabIndex={onSelectRun ? 0 : undefined}
      onClick={onSelectRun ? handleClick : undefined}
      onKeyDown={
        onSelectRun
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                handleClick();
              }
            }
          : undefined
      }
      css={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: theme.spacing.sm,
        padding: `${theme.spacing.xs}px ${theme.spacing.sm}px`,
        borderRadius: theme.borders.borderRadiusMd,
        border: `1px solid ${theme.colors.border}`,
        cursor: onSelectRun ? 'pointer' : 'default',
        ':hover': onSelectRun ? { backgroundColor: theme.colors.backgroundSecondary } : undefined,
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
      <div css={{ display: 'flex', alignItems: 'center', gap: theme.spacing.sm }}>
        <Typography.Text size="sm" color={allPassed ? 'success' : 'warning'}>
          {run.pass_count}/{run.total_count} {allPassed ? '✓' : '⚠'}
        </Typography.Text>
        {runHref && (
          <Tooltip
            componentId="mlflow.playground.regression.recent-run.open-run.tooltip"
            content="Open MLflow run in new tab"
          >
            <Button
              componentId="mlflow.playground.regression.recent-run.open-run"
              size="small"
              icon={<NewWindowIcon />}
              aria-label="Open MLflow run"
              onClick={(e) => {
                e.stopPropagation();
                window.open(runHref, '_blank', 'noreferrer');
              }}
            />
          </Tooltip>
        )}
      </div>
    </div>
  );
};

// --- Drawer ------------------------------------------------------------------
//
// The Browse-suite drawer pairs an in-place compact view (live data fetched
// against the same MLflow APIs the standalone pages use) with an "Open in
// new window" escape hatch for the full experience. The fetched data is
// the minimal slice needed for at-a-glance triage; the user pops the full
// page when they need filters / column controls / compare flows.

export type RegressionCase = {
  test_case_id?: string;
  rationale_summary: string;
  input_question: string;
  conversation_prefix: { role: string; content: string }[];
  strategy?: 'assertion' | 'judge';
  assertion?: {
    must_contain?: string[];
    must_not_contain?: string[];
    must_call_tool?: string[];
    must_not_call_tool?: string[];
  };
  judge?: { criteria: string; expected_response?: string | null };
  expected_response?: string | null;
  issue_id?: string;
  source_trace_id?: string;
  promoted: boolean;
};

export type AssertionUpdate = {
  must_contain?: string[];
  must_not_contain?: string[];
  must_call_tool?: string[];
  must_not_call_tool?: string[];
};

export type JudgeUpdate = {
  criteria: string;
  expected_response?: string | null;
};

/** Edit one test case in place. Server preserves test_case_id + tags;
 * any field passed as `undefined` keeps its current value. */
export const updateRegressionCase = async (
  experimentId: string,
  testCaseId: string,
  payload: { question?: string; assertion?: AssertionUpdate; judge?: JudgeUpdate },
): Promise<void> => {
  const response = await fetch(
    getAjaxUrl(`ajax-api/3.0/mlflow/playground/regression-suite/cases/${encodeURIComponent(testCaseId)}`),
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...getDefaultHeaders(document.cookie) },
      body: JSON.stringify({ experiment_id: experimentId, ...payload }),
    },
  );
  if (!response.ok) {
    throw new Error(`Update failed (${response.status}): ${await response.text()}`);
  }
};

/**
 * Fetch the recent regression-suite runs for an experiment. Newest first.
 * Backed server-side by `MlflowClient.search_runs` filtered by the
 * `playground.run_kind` tag — this is the cross-session source of truth
 * for the panel's "Recent runs" section (replaces the old in-session
 * component-state list).
 */
export const fetchRegressionRuns = async (experimentId: string, limit = 10): Promise<RegressionRunSummary[]> => {
  const response = await fetch(
    getAjaxUrl(
      `ajax-api/3.0/mlflow/playground/regression-suite/runs?experiment_id=${encodeURIComponent(experimentId)}&limit=${limit}`,
    ),
    { headers: getDefaultHeaders(document.cookie) },
  );
  if (!response.ok) {
    throw new Error(`List runs failed (${response.status}): ${await response.text()}`);
  }
  const body = (await response.json()) as { runs?: RegressionRunRow[] };
  return (body.runs ?? []).map((r) => ({
    parent_run_id: r.run_id,
    agent_git_sha: r.agent_git_sha || undefined,
    pass_count: r.pass_count,
    fail_count: r.fail_count,
    total_count: r.total_count,
    pass_rate: r.pass_rate,
    started_at: r.started_at,
    ended_at: r.ended_at,
  }));
};

type RegressionRunRow = {
  run_id: string;
  started_at: number;
  ended_at?: number;
  pass_count: number;
  fail_count: number;
  total_count: number;
  pass_rate: number;
  agent_git_sha?: string;
};

export type RegressionRunSnapshot = {
  kind: 'regression_suite';
  run_id: string;
  experiment_id: string;
  started_at_ms: number;
  ended_at_ms: number;
  summary: { pass_count: number; fail_count: number; total_count: number; pass_rate: number };
  conversations: Array<{
    row_id: string;
    label: string;
    messages: { role: string; content: string }[];
    status: 'pending' | 'streaming' | 'done' | 'failed';
    trace_id?: string;
    error?: string;
    verdicts: Array<{
      test_case_id?: string;
      issue_id?: string;
      rationale_summary?: string;
      passed: boolean;
      reasons: string[];
      strategy: string;
    }>;
  }>;
};

/**
 * Fetch the persisted JSON snapshot of a finished regression-suite run.
 * The cockpit feeds this into `setBatchRun(...)` to rehydrate the paged
 * navigator + verdict banners exactly as they were when the run finished.
 */
export const fetchRegressionRunSnapshot = async (
  experimentId: string,
  runId: string,
): Promise<RegressionRunSnapshot> => {
  const response = await fetch(
    getAjaxUrl(
      `ajax-api/3.0/mlflow/playground/regression-suite/runs/${encodeURIComponent(runId)}/snapshot?experiment_id=${encodeURIComponent(experimentId)}`,
    ),
    { headers: getDefaultHeaders(document.cookie) },
  );
  if (!response.ok) {
    throw new Error(`Snapshot fetch failed (${response.status}): ${await response.text()}`);
  }
  return (await response.json()) as RegressionRunSnapshot;
};

/** Remove a single test case from the regression suite. Idempotent. */
export const deleteRegressionCase = async (experimentId: string, testCaseId: string): Promise<void> => {
  const response = await fetch(
    getAjaxUrl(
      `ajax-api/3.0/mlflow/playground/regression-suite/cases/${encodeURIComponent(testCaseId)}?experiment_id=${encodeURIComponent(experimentId)}`,
    ),
    {
      method: 'DELETE',
      headers: getDefaultHeaders(document.cookie),
    },
  );
  if (!response.ok) {
    throw new Error(`Delete failed (${response.status}): ${await response.text()}`);
  }
};

/**
 * Fetch the cockpit-shaped regression-suite cases for an experiment. Used
 * by the Browse-suite drawer (renders one row per case) and by the
 * `[Run regression suite]` batch flow (one slot per case in the
 * BatchRunState).
 */
export const fetchRegressionCases = async (experimentId: string): Promise<RegressionCase[]> => {
  const response = await fetch(
    getAjaxUrl(
      `ajax-api/3.0/mlflow/playground/regression-suite/cases?experiment_id=${encodeURIComponent(experimentId)}`,
    ),
    { headers: getDefaultHeaders(document.cookie) },
  );
  if (!response.ok) {
    throw new Error(`Load failed (${response.status}): ${await response.text()}`);
  }
  const body = (await response.json()) as { cases?: RegressionCase[] };
  return body.cases ?? [];
};

const BrowseSuiteDrawer = ({
  open,
  onClose,
  experimentId,
  onCasesChanged,
}: {
  open: boolean;
  onClose: () => void;
  experimentId: string | undefined;
  onCasesChanged?: () => void;
}) => {
  const { theme } = useDesignSystemTheme();
  const [cases, setCases] = useState<RegressionCase[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reloadCases = useCallback(async () => {
    if (!experimentId) return;
    try {
      const fresh = await fetchRegressionCases(experimentId);
      setCases(fresh);
      onCasesChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [experimentId, onCasesChanged]);

  useEffect(() => {
    if (!open || !experimentId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchRegressionCases(experimentId)
      .then((cases) => {
        if (!cancelled) setCases(cases);
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

  const fullUrl = experimentId ? `/#/experiments/${experimentId}/datasets?name=regression_suite_${experimentId}` : '#';

  return (
    <Drawer.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <Drawer.Content
        componentId="mlflow.playground.regression.browse-suite.drawer"
        title="Regression suite"
        width="720px"
      >
        <div css={{ display: 'flex', flexDirection: 'column', gap: theme.spacing.md, height: '100%' }}>
          <div css={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Typography.Text color="secondary">
              {loading ? 'Loading…' : `${cases.length} test ${cases.length === 1 ? 'case' : 'cases'}`}
            </Typography.Text>
            <Tooltip
              componentId="mlflow.playground.regression.browse-suite.open-window.tooltip"
              content="Open raw dataset view in new window"
            >
              <Button
                componentId="mlflow.playground.regression.browse-suite.open-window"
                icon={<NewWindowIcon />}
                onClick={() => window.open(fullUrl, '_blank', 'noopener,noreferrer')}
                disabled={!experimentId}
                aria-label="Open raw dataset view in new window"
              />
            </Tooltip>
          </div>

          {loading && (
            <div css={{ display: 'flex', justifyContent: 'center', padding: theme.spacing.lg }}>
              <Spinner />
            </div>
          )}
          {error && <Typography.Text color="error">{error}</Typography.Text>}
          {!loading && !error && cases.length === 0 && (
            <Typography.Text color="secondary">
              No test cases yet — dispatch feedback to generate the first one.
            </Typography.Text>
          )}
          {!loading && !error && cases.length > 0 && (
            <div css={{ display: 'flex', flexDirection: 'column', gap: theme.spacing.xs, overflow: 'auto' }}>
              {cases.map((tc, idx) => (
                <RegressionCaseRow
                  key={tc.test_case_id ?? `case-${idx}`}
                  case_={tc}
                  experimentId={experimentId}
                  onSaved={reloadCases}
                  onDelete={
                    experimentId && tc.test_case_id
                      ? async () => {
                          const idToDelete = tc.test_case_id as string;
                          // Optimistic remove so the row disappears immediately;
                          // restore it if the request fails.
                          setCases((prev) => prev.filter((c) => c.test_case_id !== idToDelete));
                          try {
                            await deleteRegressionCase(experimentId, idToDelete);
                            onCasesChanged?.();
                          } catch (e) {
                            setError(e instanceof Error ? e.message : String(e));
                            // Reload from the server to reconcile.
                            try {
                              const fresh = await fetchRegressionCases(experimentId);
                              setCases(fresh);
                            } catch {
                              /* surfaced via the error banner */
                            }
                          }
                        }
                      : undefined
                  }
                />
              ))}
            </div>
          )}
        </div>
      </Drawer.Content>
    </Drawer.Root>
  );
};

/**
 * One row per regression test case. Reads as a sentence: the question on
 * top, then one or more "Answer must <verb> <object>" lines below. The
 * verb is highlighted so it's scannable in a list of many cases. Object
 * style depends on what it is — short string values render as code-style
 * chips, prose criteria render as italic text, expected responses render
 * as preformatted text.
 */
const RegressionCaseRow = ({
  case_,
  experimentId,
  onSaved,
  onDelete,
}: {
  case_: RegressionCase;
  experimentId: string | undefined;
  onSaved?: () => void | Promise<void>;
  onDelete?: () => void;
}) => {
  const { theme } = useDesignSystemTheme();
  const sentences = buildAssertionSentences(case_);
  const [editing, setEditing] = useState(false);
  const canEdit = Boolean(experimentId && case_.test_case_id);

  return (
    <div
      css={{
        display: 'flex',
        flexDirection: 'column',
        gap: theme.spacing.xs,
        padding: theme.spacing.sm,
        borderRadius: theme.borders.borderRadiusMd,
        border: `1px solid ${editing ? theme.colors.actionPrimaryBackgroundDefault : theme.colors.border}`,
        backgroundColor: theme.colors.backgroundPrimary,
      }}
    >
      <div css={{ display: 'flex', alignItems: 'flex-start', gap: theme.spacing.xs }}>
        <Typography.Text css={{ whiteSpace: 'pre-wrap', flex: 1, minWidth: 0 }}>
          {case_.input_question || <em>(no user message in prefix)</em>}
        </Typography.Text>
        {canEdit && (
          <Tooltip
            componentId="mlflow.playground.regression.case-row.edit.tooltip"
            content={editing ? 'Cancel edit' : 'Edit test case'}
          >
            <Button
              componentId="mlflow.playground.regression.case-row.edit"
              size="small"
              icon={<PencilIcon />}
              aria-label={editing ? 'Cancel edit' : 'Edit test case'}
              onClick={() => setEditing((v) => !v)}
            />
          </Tooltip>
        )}
        {onDelete && (
          <Tooltip componentId="mlflow.playground.regression.case-row.delete.tooltip" content="Remove from suite">
            <Button
              componentId="mlflow.playground.regression.case-row.delete"
              size="small"
              icon={<TrashIcon />}
              aria-label="Remove from suite"
              onClick={onDelete}
            />
          </Tooltip>
        )}
      </div>
      {!editing &&
        (sentences.length === 0 ? (
          <Typography.Text size="sm" color="secondary">
            (no conditions — likely malformed spec)
          </Typography.Text>
        ) : (
          <div css={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {sentences.map((s, i) => (
              <AssertionSentence key={i} sentence={s} />
            ))}
          </div>
        ))}
      {editing && experimentId && case_.test_case_id && (
        <CaseEditor
          case_={case_}
          experimentId={experimentId}
          onCancel={() => setEditing(false)}
          onSaved={async () => {
            setEditing(false);
            await onSaved?.();
          }}
        />
      )}
    </div>
  );
};

type AssertionSentence = {
  verb: string;
  // Either a list of short values (rendered as code chips) or a single
  // prose object (criteria, expected response).
  values?: string[];
  prose?: string;
};

function buildAssertionSentences(case_: RegressionCase): AssertionSentence[] {
  const out: AssertionSentence[] = [];
  if (case_.strategy === 'assertion' && case_.assertion) {
    const a = case_.assertion;
    if (a.must_contain?.length) out.push({ verb: 'contain', values: a.must_contain });
    if (a.must_not_contain?.length) out.push({ verb: 'not contain', values: a.must_not_contain });
    if (a.must_call_tool?.length) out.push({ verb: 'call tool', values: a.must_call_tool });
    if (a.must_not_call_tool?.length) out.push({ verb: 'not call tool', values: a.must_not_call_tool });
  }
  if (case_.strategy === 'judge' && case_.judge) {
    if (case_.judge.criteria) out.push({ verb: 'follow', prose: case_.judge.criteria });
    if (case_.judge.expected_response) out.push({ verb: 'match', prose: case_.judge.expected_response });
  }
  // expected_response can also live at the top level (older rows) — show it
  // even if the judge object isn't present.
  if (case_.expected_response && !out.some((s) => s.verb === 'match' && s.prose === case_.expected_response)) {
    out.push({ verb: 'match', prose: case_.expected_response });
  }
  return out;
}

const AssertionSentence = ({ sentence }: { sentence: AssertionSentence }) => {
  const { theme } = useDesignSystemTheme();
  return (
    <div css={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: theme.spacing.xs }}>
      <Typography.Text size="sm" color="secondary">
        Answer must
      </Typography.Text>
      <Typography.Text size="sm" css={{ fontWeight: 600 }}>
        {sentence.verb}
      </Typography.Text>
      {sentence.values && (
        <div css={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {sentence.values.map((v, i) => (
            <code
              key={`${v}-${i}`}
              css={{
                fontSize: theme.typography.fontSizeSm,
                padding: `1px 6px`,
                borderRadius: theme.borders.borderRadiusSm,
                backgroundColor: theme.colors.backgroundSecondary,
              }}
            >
              {v}
            </code>
          ))}
        </div>
      )}
      {sentence.prose && (
        <Typography.Text size="sm" css={{ fontStyle: 'italic' }}>
          “{sentence.prose}”
        </Typography.Text>
      )}
    </div>
  );
};

/**
 * Inline editor for one regression test case. Renders directly inside the
 * test-case row when the user clicks the pencil — no modal, no drawer
 * stack. Strategy is fixed at the case's current value (assertion /
 * judge) — switching strategies isn't supported here; delete the case
 * and re-dispatch from feedback if you need that. Within the current
 * strategy you can edit:
 *
 *   - The user-visible question (rewrites the last user message in the
 *     conversation prefix).
 *   - For assertion: each of the four keyword lists.
 *   - For judge: the criteria and expected response.
 *
 * Changes are atomic from the cockpit's POV: the server does delete-then-
 * insert preserving test_case_id + tags so external lineage links don't
 * break.
 */
const CaseEditor = ({
  case_,
  experimentId,
  onCancel,
  onSaved,
}: {
  case_: RegressionCase;
  experimentId: string;
  onCancel: () => void;
  onSaved: () => void | Promise<void>;
}) => {
  const { theme } = useDesignSystemTheme();
  const [question, setQuestion] = useState(case_.input_question);
  const [mustContain, setMustContain] = useState<string[]>(case_.assertion?.must_contain ?? []);
  const [mustNotContain, setMustNotContain] = useState<string[]>(case_.assertion?.must_not_contain ?? []);
  const [mustCallTool, setMustCallTool] = useState<string[]>(case_.assertion?.must_call_tool ?? []);
  const [mustNotCallTool, setMustNotCallTool] = useState<string[]>(case_.assertion?.must_not_call_tool ?? []);
  const [judgeCriteria, setJudgeCriteria] = useState(case_.judge?.criteria ?? '');
  const [judgeExpected, setJudgeExpected] = useState(case_.judge?.expected_response ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSave = async () => {
    if (!case_.test_case_id) return;
    setSaving(true);
    setError(null);
    try {
      const payload: { question?: string; assertion?: AssertionUpdate; judge?: JudgeUpdate } = {
        question,
      };
      if (case_.strategy === 'assertion') {
        payload.assertion = {
          must_contain: mustContain,
          must_not_contain: mustNotContain,
          must_call_tool: mustCallTool,
          must_not_call_tool: mustNotCallTool,
        };
      } else if (case_.strategy === 'judge') {
        payload.judge = {
          criteria: judgeCriteria,
          expected_response: judgeExpected || null,
        };
      }
      await updateRegressionCase(experimentId, case_.test_case_id as string, payload);
      await onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      css={{
        display: 'flex',
        flexDirection: 'column',
        gap: theme.spacing.sm,
        marginTop: theme.spacing.xs,
        paddingTop: theme.spacing.sm,
        borderTop: `1px dashed ${theme.colors.border}`,
      }}
    >
      <div css={{ display: 'flex', flexDirection: 'column', gap: theme.spacing.xs }}>
        <Typography.Text size="sm" color="secondary" css={{ fontWeight: 600 }}>
          Question
        </Typography.Text>
        <Input.TextArea
          componentId="mlflow.playground.regression.edit-case.question"
          value={question}
          autoSize={{ minRows: 2, maxRows: 6 }}
          onChange={(e) => setQuestion(e.target.value)}
        />
      </div>

      {case_.strategy === 'assertion' && (
        <div css={{ display: 'flex', flexDirection: 'column', gap: theme.spacing.sm }}>
          <ChipListEditor label="Answer must contain" values={mustContain} onChange={setMustContain} />
          <ChipListEditor label="Answer must NOT contain" values={mustNotContain} onChange={setMustNotContain} />
          <ChipListEditor label="Answer must call tool" values={mustCallTool} onChange={setMustCallTool} />
          <ChipListEditor label="Answer must NOT call tool" values={mustNotCallTool} onChange={setMustNotCallTool} />
        </div>
      )}

      {case_.strategy === 'judge' && (
        <div css={{ display: 'flex', flexDirection: 'column', gap: theme.spacing.sm }}>
          <div css={{ display: 'flex', flexDirection: 'column', gap: theme.spacing.xs }}>
            <Typography.Text size="sm" color="secondary" css={{ fontWeight: 600 }}>
              Judge criteria
            </Typography.Text>
            <Input.TextArea
              componentId="mlflow.playground.regression.edit-case.criteria"
              value={judgeCriteria}
              autoSize={{ minRows: 2, maxRows: 6 }}
              onChange={(e) => setJudgeCriteria(e.target.value)}
            />
          </div>
          <div css={{ display: 'flex', flexDirection: 'column', gap: theme.spacing.xs }}>
            <Typography.Text size="sm" color="secondary" css={{ fontWeight: 600 }}>
              Expected response (optional)
            </Typography.Text>
            <Input.TextArea
              componentId="mlflow.playground.regression.edit-case.expected"
              value={judgeExpected}
              autoSize={{ minRows: 2, maxRows: 6 }}
              onChange={(e) => setJudgeExpected(e.target.value)}
            />
          </div>
        </div>
      )}

      {error && <Typography.Text color="error">{error}</Typography.Text>}

      <div css={{ display: 'flex', justifyContent: 'flex-end', gap: theme.spacing.sm }}>
        <Button componentId="mlflow.playground.regression.edit-case.cancel" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
        <Button
          componentId="mlflow.playground.regression.edit-case.save"
          type="primary"
          loading={saving}
          onClick={onSave}
        >
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </div>
  );
};

const ChipListEditor = ({
  label,
  values,
  onChange,
}: {
  label: string;
  values: string[];
  onChange: (next: string[]) => void;
}) => {
  const { theme } = useDesignSystemTheme();
  const [draft, setDraft] = useState('');
  const add = () => {
    const trimmed = draft.trim();
    if (!trimmed) return;
    onChange([...values, trimmed]);
    setDraft('');
  };
  const remove = (idx: number) => onChange(values.filter((_, i) => i !== idx));
  return (
    <div css={{ display: 'flex', flexDirection: 'column', gap: theme.spacing.xs }}>
      <Typography.Text size="sm" color="secondary" css={{ fontWeight: 600 }}>
        {label}
      </Typography.Text>
      {values.length > 0 && (
        <div css={{ display: 'flex', flexWrap: 'wrap', gap: theme.spacing.xs }}>
          {values.map((v, i) => (
            <span
              key={`${v}-${i}`}
              css={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 2,
                padding: `2px ${theme.spacing.xs}px`,
                borderRadius: theme.borders.borderRadiusSm,
                backgroundColor: theme.colors.backgroundSecondary,
                fontFamily: 'monospace',
                fontSize: theme.typography.fontSizeSm,
              }}
            >
              {v}
              <button
                type="button"
                aria-label={`Remove ${v}`}
                onClick={() => remove(i)}
                css={{
                  background: 'none',
                  border: 'none',
                  padding: 0,
                  cursor: 'pointer',
                  display: 'inline-flex',
                  color: theme.colors.textSecondary,
                  ':hover': { color: theme.colors.textPrimary },
                }}
              >
                <CloseSmallIcon />
              </button>
            </span>
          ))}
        </div>
      )}
      <div css={{ display: 'flex', gap: theme.spacing.xs }}>
        <Input
          componentId={`mlflow.playground.regression.edit-case.chip-input.${label}`}
          value={draft}
          placeholder="Add a value…"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            }
          }}
          css={{ flex: 1 }}
        />
        <Button
          componentId={`mlflow.playground.regression.edit-case.chip-add.${label}`}
          onClick={add}
          disabled={!draft.trim()}
        >
          Add
        </Button>
      </div>
    </div>
  );
};
