import { useCallback, useState } from 'react';

import { useDesignSystemTheme } from '@databricks/design-system';
import { InsightQueryBanner } from '../../../pages/experiment-insights/components/InsightQueryBanner';
import { shouldEnableTracesV3View, isExperimentEvalResultsMonitoringUIEnabled } from '../../../../common/utils/FeatureUtils';
import { TracesV3View } from './traces-v3/TracesV3View';
import { useGetExperimentQuery } from '../../../hooks/useExperimentQuery';
import { TraceInsightsLaunchModal } from './TraceInsightsLaunchModal';

export const ExperimentViewTraces = ({ experimentIds }: { experimentIds: string[] }) => {
  const { theme } = useDesignSystemTheme();
  const [insightPrompt, setInsightPrompt] = useState('');
  const [insightModalVisible, setInsightModalVisible] = useState(true);

  const handleInsightSubmit = useCallback((value: string) => {
    const trimmed = value.trim();
    if (!trimmed) {
      return;
    }
    setInsightPrompt(trimmed);
    setInsightModalVisible(true);
  }, []);

  const handleCloseModal = useCallback(() => setInsightModalVisible(false), []);

  return (
    <div
      css={{
        minHeight: 225, // This is the exact height for displaying a minimum five rows and table header
        display: 'flex',
        flexDirection: 'column',
        gap: theme.spacing.sm,
        flex: 1,
        overflow: 'hidden',
      }}
    >
      <InsightQueryBanner
        placeholder={'What Insight do you want to find from your traces? E.g. "What kind of questions are users asking?"'}
        ariaLabel="Create a new Insight"
        size="compact"
        onSubmit={handleInsightSubmit}
      />
      <TracesComponent experimentIds={experimentIds} />
      <TraceInsightsLaunchModal
        visible={insightModalVisible}
        initialPrompt={insightPrompt}
        onCancel={handleCloseModal}
      />
    </div>
  );
};

const TracesComponent = ({
  experimentIds,
}: {
  experimentIds: string[];
}) => {
  // A cache-only query to get the loading state
  const { loading: isLoadingExperiment } = useGetExperimentQuery({
    experimentId: experimentIds[0],
    options: {
      fetchPolicy: 'cache-only',
    },
  });

  // Legacy traces view no longer supported for insights wiring; always use V3
  if (!(shouldEnableTracesV3View() || isExperimentEvalResultsMonitoringUIEnabled())) {
    return null;
  }
  return (
    <TracesV3View
      experimentIds={experimentIds}
      isLoadingExperiment={isLoadingExperiment}
    />
  );
};
