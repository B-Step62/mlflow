/**
 * Issues board tab on the experiment page side-nav.
 *
 * Renders the kanban defined in the playground module so the same component
 * (and its `IssueDetailDrawer`) is the single place where issue UI lives.
 *
 * Supports `?issue=<id>` as a deeplink — the playground's failing-tests
 * list opens the kanban in a new tab with that param when the user clicks
 * the external-link icon on a row, and this page auto-opens the
 * matching drawer on mount.
 */

import { useEffect, useRef, useState } from 'react';

import { useParams, useSearchParams } from '../../../common/utils/RoutingUtils';
import ErrorUtils from '../../../common/utils/ErrorUtils';
import { withErrorBoundary } from '../../../common/utils/withErrorBoundary';
import { IssueDetailDrawer } from '../../../playground/issues';
import { IssuesBoardPanel } from '../../../playground/issues-board';

const ExperimentIssuesPageImpl = () => {
  const { experimentId } = useParams<{ experimentId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const [openIssueId, setOpenIssueId] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  // Honor `?issue=<id>` once on mount, then strip the param so a refresh
  // doesn't re-open the drawer after the user closes it.
  const deeplinkHandledRef = useRef(false);
  useEffect(() => {
    if (deeplinkHandledRef.current) return;
    const target = searchParams.get('issue');
    if (!target) return;
    deeplinkHandledRef.current = true;
    setOpenIssueId(target);
    const next = new URLSearchParams(searchParams);
    next.delete('issue');
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  return (
    <>
      <IssuesBoardPanel experimentId={experimentId ?? ''} onOpenIssue={setOpenIssueId} refreshKey={refreshKey} />
      <IssueDetailDrawer
        issueId={openIssueId}
        visible={!!openIssueId}
        onClose={() => setOpenIssueId(null)}
        onIssueUpdated={() => setRefreshKey((n) => n + 1)}
        experimentId={experimentId}
        onNavigate={setOpenIssueId}
      />
    </>
  );
};

export default withErrorBoundary(ErrorUtils.mlflowServices.EXPERIMENTS, ExperimentIssuesPageImpl);
