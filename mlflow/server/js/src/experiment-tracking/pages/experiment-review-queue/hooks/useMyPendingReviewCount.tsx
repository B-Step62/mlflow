import { useQueries } from '@databricks/web-shared/query-client';

import type { ReviewQueueItem } from '../types';
import { buildReviewQueueItemsQuery } from './useListReviewQueueItemsQuery';
import { useListReviewQueuesQuery } from './useListReviewQueuesQuery';

/**
 * Total PENDING review items across the experiment's visible review queues.
 *
 * Drives the sidenav "Review" unread-count badge. Frontend-only and derived from
 * the existing review-queue APIs (one queue list + one item fetch per queue,
 * deduped by React Query's cache). `enabled` gates the fetches so only the
 * sidenav section that actually contains the Review item pays for them.
 */
export const useMyPendingReviewCount = (experimentId: string, enabled: boolean): number => {
  const { reviewQueues } = useListReviewQueuesQuery({ experimentId, enabled });
  const itemQueries = useQueries({
    queries: (enabled ? reviewQueues : []).map((q) => ({
      ...buildReviewQueueItemsQuery({ queueId: q.queue_id }),
      enabled: Boolean(q.queue_id),
    })),
  });
  let total = 0;
  itemQueries.forEach((result) => {
    if (result && !result.isLoading && result.data) {
      const items = (result.data.items ?? []) as ReviewQueueItem[];
      total += items.filter((i) => i.status === 'PENDING').length;
    }
  });
  return total;
};
