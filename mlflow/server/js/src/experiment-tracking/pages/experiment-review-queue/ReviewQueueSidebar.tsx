import { useState } from 'react';

import {
  Button,
  GearIcon,
  PlusIcon,
  SegmentedControlButton,
  SegmentedControlGroup,
  Table,
  TableCell,
  TableHeader,
  TableRow,
  Typography,
  useDesignSystemTheme,
} from '@databricks/design-system';
import { useQueries } from '@databricks/web-shared/query-client';
import { FormattedMessage, useIntl } from 'react-intl';

import { useIsAuthAvailable } from '../../../account/hooks';
import { buildReviewQueueItemsQuery } from './hooks/useListReviewQueueItemsQuery';
import { displayUser } from './hooks/useReviewer';
import { canInspectQueue, isQueueOwner } from './queuePermissions';
import type { ReviewQueueItem, ReviewQueue } from './types';

const CID = 'mlflow.experiment-review-queue.sidebar';

// Fixed widths so the owner and "To do" columns line up across rows.
const OWNER_COL_WIDTH = 120;
const COUNT_COL_WIDTH = 72;

type SortKey = 'name' | 'owner' | 'todo';
type SortDir = 'asc' | 'desc';

/**
 * Left panel of the Review tab: a flat, sortable list of the reviewer's visible
 * queues with each queue's owner and to-do count. Visibility is decided
 * server-side; queues that can't be opened are greyed (the detail-tier gate), and
 * the "My queues" filter narrows to owned queues. Per-queue actions live in the
 * right pane, not here.
 */
export const ReviewQueueSidebar = ({
  queues,
  selectedQueueId,
  canManage,
  canEdit,
  canCreateQueue,
  reviewer,
  onSelect,
  onNewQueue,
  onManageQuestions,
}: {
  queues: ReviewQueue[];
  selectedQueueId: string | undefined;
  canManage: boolean;
  canEdit: boolean;
  canCreateQueue: boolean;
  reviewer: string;
  onSelect: (queueId: string) => void;
  onNewQueue: () => void;
  onManageQuestions: () => void;
}) => {
  const { theme } = useDesignSystemTheme();
  const intl = useIntl();
  const authAvailable = useIsAuthAvailable();
  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [mineOnly, setMineOnly] = useState(false);

  // Owner is only meaningful on an auth server; the filter only helps users who
  // can see queues they don't own (i.e. editors).
  const showOwner = authAvailable;
  const showFilter = authAvailable && canEdit;
  const noAccessHint = intl.formatMessage({
    defaultMessage: "You don't have access to this queue.",
    description: 'Review queue sidebar: tooltip for a queue the reviewer cannot open',
  });

  const inspectable = (q: ReviewQueue) => canInspectQueue(q, reviewer, canManage, canEdit);

  // One pending-count fetch per inspectable queue (shares the right pane's cache).
  // Non-inspectable queues are skipped (their item list would 403) and show blank.
  const traceQueries = useQueries({
    queries: queues.map((q) => ({
      ...buildReviewQueueItemsQuery({ queueId: q.queue_id }),
      enabled: Boolean(q.queue_id) && inspectable(q),
    })),
  });
  const pendingByQueueId = new Map<string, number>();
  queues.forEach((q, idx) => {
    const result = traceQueries[idx];
    if (result && !result.isLoading && result.data) {
      const items = (result.data.items ?? []) as ReviewQueueItem[];
      pendingByQueueId.set(q.queue_id, items.filter((i) => i.status === 'PENDING').length);
    }
  });

  const labelOf = (q: ReviewQueue) => (q.queue_type === 'USER' ? displayUser(q.name, intl) : q.name);
  const ownerOf = (q: ReviewQueue) => q.created_by ?? '';

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  const dirMul = sortDir === 'asc' ? 1 : -1;
  const byLabel = (a: ReviewQueue, b: ReviewQueue) =>
    labelOf(a).localeCompare(labelOf(b), undefined, { sensitivity: 'base' });
  const compare = (a: ReviewQueue, b: ReviewQueue): number => {
    if (sortKey === 'todo') {
      const pa = pendingByQueueId.get(a.queue_id);
      const pb = pendingByQueueId.get(b.queue_id);
      // Unknown counts (loading or not inspectable) always sort last.
      if (pa == null && pb == null) return byLabel(a, b);
      if (pa == null) return 1;
      if (pb == null) return -1;
      return pa !== pb ? dirMul * (pa - pb) : byLabel(a, b);
    }
    const va = sortKey === 'owner' ? ownerOf(a) : labelOf(a);
    const vb = sortKey === 'owner' ? ownerOf(b) : labelOf(b);
    const d = va.localeCompare(vb, undefined, { sensitivity: 'base' });
    return d !== 0 ? dirMul * d : byLabel(a, b);
  };

  // Ignore a stale `mineOnly` once the filter is hidden (can't get stuck filtered),
  // and always keep the selected queue visible even when it isn't owned.
  const effectiveMineOnly = showFilter && mineOnly;
  const visible = (
    effectiveMineOnly ? queues.filter((q) => isQueueOwner(q, reviewer) || q.queue_id === selectedQueueId) : queues
  )
    .slice()
    .sort(compare);

  return (
    <div
      css={{
        display: 'flex',
        flexDirection: 'column',
        gap: theme.spacing.md,
        height: '100%',
        minHeight: 0,
        paddingRight: theme.spacing.sm,
        overflow: 'auto',
      }}
    >
      {(canManage || canCreateQueue) && (
        <div css={{ display: 'flex', alignItems: 'center', gap: theme.spacing.xs, flexWrap: 'wrap' }}>
          {/* Managing questions needs MANAGE; creating a queue only needs EDIT. */}
          {canManage && (
            <Button componentId={`${CID}.manage-questions`} icon={<GearIcon />} onClick={onManageQuestions}>
              <FormattedMessage
                defaultMessage="Manage questions"
                description="Review queue sidebar: manage-questions button"
              />
            </Button>
          )}
          {canCreateQueue && (
            <Button componentId={`${CID}.new-queue`} icon={<PlusIcon />} onClick={onNewQueue}>
              <FormattedMessage defaultMessage="New queue" description="Review queue: create-queue button" />
            </Button>
          )}
        </div>
      )}

      {showFilter && queues.length > 0 && (
        <SegmentedControlGroup
          name="review-queue-owner-filter"
          componentId={`${CID}.owner-filter`}
          size="small"
          value={mineOnly ? 'mine' : 'all'}
          onChange={(e) => setMineOnly(e.target.value === 'mine')}
        >
          <SegmentedControlButton value="all">
            <FormattedMessage defaultMessage="All queues" description="Review queue sidebar: show-all-queues filter" />
          </SegmentedControlButton>
          <SegmentedControlButton value="mine">
            <FormattedMessage
              defaultMessage="My queues"
              description="Review queue sidebar: show-only-owned-queues filter"
            />
          </SegmentedControlButton>
        </SegmentedControlGroup>
      )}

      {queues.length > 0 && (
        <div css={{ minHeight: 0, overflow: 'auto' }}>
          <Table>
            <TableRow isHeader>
              <TableHeader
                componentId={`${CID}.queue-header`}
                sortable
                sortDirection={sortKey === 'name' ? sortDir : 'none'}
                onToggleSort={() => toggleSort('name')}
                css={{ flex: 1, minWidth: 0 }}
              >
                <FormattedMessage defaultMessage="Queue" description="Review queue sidebar: queue-name column" />
              </TableHeader>
              {showOwner && (
                <TableHeader
                  componentId={`${CID}.owner-header`}
                  sortable
                  sortDirection={sortKey === 'owner' ? sortDir : 'none'}
                  onToggleSort={() => toggleSort('owner')}
                  css={{ flex: `0 0 ${OWNER_COL_WIDTH}px` }}
                >
                  <FormattedMessage defaultMessage="Owner" description="Review queue sidebar: queue-owner column" />
                </TableHeader>
              )}
              <TableHeader
                componentId={`${CID}.todo-header`}
                sortable
                sortDirection={sortKey === 'todo' ? sortDir : 'none'}
                onToggleSort={() => toggleSort('todo')}
                css={{ flex: `0 0 ${COUNT_COL_WIDTH}px`, justifyContent: 'flex-end' }}
              >
                <FormattedMessage
                  defaultMessage="To do"
                  description="Review queue sidebar: still-to-review count column"
                />
              </TableHeader>
            </TableRow>
            {visible.map((queue) => {
              const queueInspectable = inspectable(queue);
              const selected = queue.queue_id === selectedQueueId;
              const pending = pendingByQueueId.get(queue.queue_id);
              return (
                <TableRow
                  key={queue.queue_id}
                  data-testid={`${CID}.row-${queue.queue_id}`}
                  aria-disabled={queueInspectable ? undefined : true}
                  aria-selected={selected}
                  title={queueInspectable ? undefined : noAccessHint}
                  tabIndex={queueInspectable ? 0 : undefined}
                  onClick={queueInspectable ? () => onSelect(queue.queue_id) : undefined}
                  onKeyDown={
                    queueInspectable
                      ? (e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            onSelect(queue.queue_id);
                          }
                        }
                      : undefined
                  }
                  css={{
                    cursor: queueInspectable ? 'pointer' : 'default',
                    opacity: queueInspectable ? 1 : 0.5,
                    backgroundColor: selected ? theme.colors.actionDefaultBackgroundPress : undefined,
                    '&:hover': queueInspectable
                      ? { backgroundColor: selected ? undefined : theme.colors.actionDefaultBackgroundHover }
                      : undefined,
                  }}
                >
                  <TableCell css={{ flex: 1, minWidth: 0 }}>
                    <Typography.Text bold={selected} ellipsis>
                      {labelOf(queue)}
                    </Typography.Text>
                  </TableCell>
                  {showOwner && (
                    <TableCell css={{ flex: `0 0 ${OWNER_COL_WIDTH}px`, minWidth: 0 }}>
                      <Typography.Text color="secondary" ellipsis>
                        {ownerOf(queue)}
                      </Typography.Text>
                    </TableCell>
                  )}
                  <TableCell css={{ flex: `0 0 ${COUNT_COL_WIDTH}px`, justifyContent: 'flex-end' }}>
                    <Typography.Text color="secondary">{pending == null ? '' : pending}</Typography.Text>
                  </TableCell>
                </TableRow>
              );
            })}
          </Table>
        </div>
      )}

      {visible.length === 0 && effectiveMineOnly && queues.length > 0 && (
        <Typography.Text color="secondary" css={{ paddingLeft: theme.spacing.sm }}>
          <FormattedMessage
            defaultMessage="You don't own any queues yet."
            description="Review queue sidebar: empty state for the My-queues filter"
          />
        </Typography.Text>
      )}
    </div>
  );
};
