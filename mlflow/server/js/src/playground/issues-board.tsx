/**
 * Kanban-style Issues board (full-width tab on the experiment page side-nav).
 *
 * Groups every Issue in the experiment into the five state-machine columns
 * (`todo`, `in_progress`, `review`, `done`, `rejected`). Cards are read-only
 * here — clicking one opens the existing ``IssueDetailDrawer``, which is the
 * surface that drives transitions / re-runs.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  Alert,
  Button,
  CheckCircleIcon,
  CircleOffIcon,
  CircleOutlineIcon,
  Empty,
  LoopIcon,
  RefreshIcon,
  Spinner,
  Typography,
  VisibleIcon,
  useDesignSystemTheme,
} from '@databricks/design-system';

import { fetchIssues, type IssueDetail } from './issues';

const COLUMN_ORDER = ['todo', 'in_progress', 'review', 'done', 'rejected'] as const;
type ColumnStatus = (typeof COLUMN_ORDER)[number];

const COLUMN_LABEL: Record<ColumnStatus, string> = {
  todo: 'To do',
  in_progress: 'In progress',
  review: 'Review',
  done: 'Done',
  rejected: 'Rejected',
};

// Icon components are forward-ref shapes typed against `IconProps` from the
// design system; let TS infer the record value type so the strict prop shape
// doesn't get widened to something incompatible.
const COLUMN_ICON = {
  todo: CircleOutlineIcon,
  in_progress: LoopIcon,
  review: VisibleIcon,
  done: CheckCircleIcon,
  rejected: CircleOffIcon,
} satisfies Record<ColumnStatus, unknown>;

const formatRelativeTime = (timestampMs?: number): string => {
  if (!timestampMs) return '';
  const diffSec = (Date.now() - timestampMs) / 1000;
  if (diffSec < 60) return 'just now';
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86_400) return `${Math.floor(diffSec / 3600)}h ago`;
  return `${Math.floor(diffSec / 86_400)}d ago`;
};

const shortenId = (issueId: string): string => {
  // Compact display for the top-left of each card. ``iss-f2c123abc...`` →
  // ``iss-f2c``; the full id is still visible in the detail drawer.
  const stripped = issueId.startsWith('iss-') ? issueId.slice(4) : issueId;
  return `iss-${stripped.slice(0, 3)}`;
};

const STATUS_ICON_COLOR: Record<ColumnStatus, (theme: any) => string> = {
  todo: (t) => t.colors.textSecondary,
  in_progress: (t) => t.colors.blue500,
  review: (t) => t.colors.yellow500,
  done: (t) => t.colors.green500,
  rejected: (t) => t.colors.red500,
};

const resolveStatus = (status: string): ColumnStatus =>
  (COLUMN_ORDER as readonly string[]).includes(status) ? (status as ColumnStatus) : 'todo';

const IssueCard = ({
  issue,
  experimentId,
  onClick,
}: {
  issue: IssueDetail;
  experimentId: string;
  onClick: () => void;
}) => {
  const { theme } = useDesignSystemTheme();
  const status = resolveStatus(issue.status);
  const StatusIcon = COLUMN_ICON[status];
  // Issue.assignee that looks like `conn-...` is a worker (Epic 8); used to
  // surface the kanban-side deeplink + the in-progress robot indicator.
  const hasWorker = !!issue.assignee?.startsWith('conn-');
  const playgroundHref =
    status === 'review' && hasWorker && experimentId
      ? `/experiments/${encodeURIComponent(experimentId)}/playground?activate_for_issue=${encodeURIComponent(issue.issue_id)}`
      : null;
  return (
    <button
      type="button"
      onClick={onClick}
      css={{
        textAlign: 'left',
        display: 'flex',
        flexDirection: 'column',
        gap: theme.spacing.xs,
        padding: theme.spacing.sm,
        minHeight: 96,
        borderRadius: theme.borders.borderRadiusMd,
        border: `1px solid ${theme.colors.borderDecorative}`,
        backgroundColor: theme.colors.backgroundPrimary,
        cursor: 'pointer',
        width: '100%',
        ':hover': {
          backgroundColor: theme.colors.actionTertiaryBackgroundHover,
        },
      }}
    >
      <Typography.Text size="sm" color="secondary" css={{ fontFamily: 'monospace' }}>
        {shortenId(issue.issue_id)}
      </Typography.Text>
      <div css={{ display: 'flex', alignItems: 'flex-start', gap: theme.spacing.xs }}>
        <span css={{ color: STATUS_ICON_COLOR[status](theme), display: 'inline-flex', paddingTop: 2 }}>
          <StatusIcon />
        </span>
        <Typography.Text css={{ fontWeight: 600 }}>{issue.name || '(untitled issue)'}</Typography.Text>
      </div>
      {(issue.assignee || issue.last_updated_timestamp) && (
        <div css={{ display: 'flex', alignItems: 'center', gap: theme.spacing.xs, flexWrap: 'wrap' }}>
          {issue.assignee && (
            <Typography.Text size="sm" color="secondary">
              {issue.assignee}
            </Typography.Text>
          )}
          {issue.assignee && issue.last_updated_timestamp && (
            <Typography.Text size="sm" color="secondary">
              ·
            </Typography.Text>
          )}
          {issue.last_updated_timestamp && (
            <Typography.Text size="sm" color="secondary">
              {formatRelativeTime(issue.last_updated_timestamp)}
            </Typography.Text>
          )}
        </div>
      )}
      {playgroundHref && (
        <a
          href={playgroundHref}
          onClick={(e) => e.stopPropagation()}
          css={{
            alignSelf: 'flex-start',
            color: theme.colors.actionPrimaryTextDefault,
            fontSize: theme.typography.fontSizeSm,
            textDecoration: 'none',
            ':hover': { textDecoration: 'underline' },
          }}
        >
          ↗ Test in playground
        </a>
      )}
      {status === 'in_progress' && hasWorker && (
        <Typography.Text size="sm" color="secondary">
          Worker iterating…
        </Typography.Text>
      )}
    </button>
  );
};

export const IssuesBoardPanel = ({
  experimentId,
  onOpenIssue,
  refreshKey,
}: {
  experimentId: string;
  onOpenIssue: (issueId: string) => void;
  // Bumped externally (e.g. when a drawer closes after a transition) to force
  // a re-fetch without unmounting the panel.
  refreshKey?: number;
}) => {
  const { theme } = useDesignSystemTheme();
  const [issues, setIssues] = useState<IssueDetail[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchIssues(experimentId)
      .then((rows) => {
        if (!cancelled) setIssues(rows);
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
  }, [experimentId, reloadTick, refreshKey]);

  const onRefresh = useCallback(() => setReloadTick((n) => n + 1), []);

  const columns = useMemo(() => {
    const grouped: Record<ColumnStatus, IssueDetail[]> = {
      todo: [],
      in_progress: [],
      review: [],
      done: [],
      rejected: [],
    };
    for (const issue of issues) {
      grouped[resolveStatus(issue.status)].push(issue);
    }
    for (const key of COLUMN_ORDER) {
      grouped[key].sort((a, b) => (b.last_updated_timestamp ?? 0) - (a.last_updated_timestamp ?? 0));
    }
    return grouped;
  }, [issues]);

  return (
    <section
      css={{
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
        flex: 1,
        gap: theme.spacing.md,
      }}
    >
      <div
        css={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: theme.spacing.md,
        }}
      >
        <div css={{ display: 'flex', flexDirection: 'column' }}>
          <Typography.Title level={4} css={{ margin: 0 }}>
            Issues
          </Typography.Title>
          <Typography.Text color="secondary" size="sm">
            {issues.length} issue{issues.length === 1 ? '' : 's'} in this experiment. Click a card to open its detail
            drawer.
          </Typography.Text>
        </div>
        <Button
          componentId="mlflow.playground.issue-board.refresh"
          icon={<RefreshIcon />}
          onClick={onRefresh}
          disabled={loading}
        >
          Refresh
        </Button>
      </div>

      {error && (
        <Alert
          componentId="mlflow.playground.issue-board.error"
          type="error"
          message={error}
          closable
          onClose={() => setError(null)}
        />
      )}

      {loading && issues.length === 0 ? (
        <div
          css={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: 240,
          }}
        >
          <Spinner />
        </div>
      ) : issues.length === 0 ? (
        <div
          css={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: 320,
            width: '100%',
            '& > div': {
              height: '100%',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              alignItems: 'center',
            },
          }}
        >
          <Empty
            description={
              'No issues yet. Annotate an assistant turn from the playground and dispatch the feedback to create one.'
            }
          />
        </div>
      ) : (
        <div
          css={{
            display: 'grid',
            gridTemplateColumns: `repeat(${COLUMN_ORDER.length}, minmax(330px, 1fr))`,
            gap: theme.spacing.md,
            flex: 1,
            minHeight: 0,
            overflowX: 'auto',
          }}
        >
          {COLUMN_ORDER.map((status) => {
            const cards = columns[status];
            const ColumnIcon = COLUMN_ICON[status];
            return (
              <div
                key={status}
                css={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: theme.spacing.sm,
                  paddingTop: theme.spacing.md,
                  paddingBottom: theme.spacing.md,
                  borderRadius: theme.borders.borderRadiusMd,
                  backgroundColor: theme.colors.backgroundSecondary,
                  minHeight: 0,
                }}
              >
                <div
                  css={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: theme.spacing.sm,
                    paddingLeft: theme.spacing.md,
                    paddingRight: theme.spacing.md,
                    paddingBottom: theme.spacing.xs,
                  }}
                >
                  <span css={{ color: STATUS_ICON_COLOR[status](theme), display: 'inline-flex' }}>
                    <ColumnIcon />
                  </span>
                  <Typography.Text css={{ fontWeight: 600 }}>{COLUMN_LABEL[status]}</Typography.Text>
                  <Typography.Text color="secondary">{cards.length}</Typography.Text>
                </div>
                <div
                  css={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: theme.spacing.sm,
                    paddingLeft: theme.spacing.sm,
                    paddingRight: theme.spacing.sm,
                    overflowY: 'auto',
                    minHeight: 0,
                    flex: 1,
                  }}
                >
                  {cards.length === 0 ? (
                    <Typography.Text size="sm" color="secondary" css={{ padding: theme.spacing.sm }}>
                      No issues
                    </Typography.Text>
                  ) : (
                    cards.map((issue) => (
                      <IssueCard
                        key={issue.issue_id}
                        issue={issue}
                        experimentId={experimentId}
                        onClick={() => onOpenIssue(issue.issue_id)}
                      />
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
};
