import invariant from 'invariant';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useSearchParams } from '../../../common/utils/RoutingUtils';
import { useDesignSystemTheme } from '@databricks/design-system';
import AiLogoUrl from './components/ai-logo.svg';
import { InsightQueryBanner } from './components/InsightQueryBanner';
import { useExperimentInsightsRuns } from './hooks/useExperimentInsightsRuns';
import { InsightReportsTable } from './components/InsightReportsTable';
import ExperimentInsightDetailsPage from './ExperimentInsightDetailsPage';

const SELECTED_INSIGHT_QUERY_PARAM = 'selectedInsightId';

const ExperimentInsightsPage = () => {
  const { experimentId } = useParams();
  invariant(experimentId, 'Experiment ID must be defined');

  const { theme } = useDesignSystemTheme();
  const { runs, loading } = useExperimentInsightsRuns({ experimentId });
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedInsightId = searchParams.get(SELECTED_INSIGHT_QUERY_PARAM) ?? undefined;

  const openInsightDetails = (insightId?: string) => {
    setSearchParams((params) => {
      if (!insightId) {
        params.delete(SELECTED_INSIGHT_QUERY_PARAM);
      } else {
        params.set(SELECTED_INSIGHT_QUERY_PARAM, insightId);
      }
      return params;
    });
  };

  const handleCreateInsight = useCallback(() => {
    // TODO(ML-INSIGHTS): Wire up to actual create insight flow once backend is ready.
    // For now this serves as an entry point in the UI so users know where to start.
    // eslint-disable-next-line no-console
    console.warn('Create Insight action is not yet implemented');
  }, []);

  return (
    <div
      data-testid="experiment-insights-page"
      css={{
        flex: 1,
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        padding: theme.spacing.lg,
      }}
    >
      <div
        css={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          minHeight: 0,
          overflow: 'hidden',
          gap: theme.spacing.lg,
        }}
      >
        {!selectedInsightId && (
          <>
            <InsightReportsTable runs={runs} loading={loading} onSelect={(runUuid) => openInsightDetails(runUuid)} onCreateInsight={handleCreateInsight} />
          </>
        )}
        {selectedInsightId && (
          <div css={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
            <ExperimentInsightDetailsPage experimentId={experimentId!} insightId={selectedInsightId} />
          </div>
        )}
      </div>
    </div>
  );
};

export default ExperimentInsightsPage;
