/**
 * Issues board tab on the experiment page side-nav.
 *
 * Renders the kanban defined in the playground module so the same component
 * (and its `IssueDetailDrawer`) is the single place where issue UI lives.
 */

import { useState } from 'react';

import { useParams } from '../../../common/utils/RoutingUtils';
import ErrorUtils from '../../../common/utils/ErrorUtils';
import { withErrorBoundary } from '../../../common/utils/withErrorBoundary';
import { IssueDetailDrawer } from '../../../playground/issues';
import { IssuesBoardPanel } from '../../../playground/issues-board';

const ExperimentIssuesPageImpl = () => {
  const { experimentId } = useParams<{ experimentId: string }>();
  const [openIssueId, setOpenIssueId] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  return (
    <>
      <IssuesBoardPanel
        experimentId={experimentId ?? ''}
        onOpenIssue={setOpenIssueId}
        refreshKey={refreshKey}
      />
      <IssueDetailDrawer
        issueId={openIssueId}
        visible={!!openIssueId}
        onClose={() => setOpenIssueId(null)}
        onIssueUpdated={() => setRefreshKey((n) => n + 1)}
        experimentId={experimentId}
      />
    </>
  );
};

export default withErrorBoundary(ErrorUtils.mlflowServices.EXPERIMENTS, ExperimentIssuesPageImpl);
