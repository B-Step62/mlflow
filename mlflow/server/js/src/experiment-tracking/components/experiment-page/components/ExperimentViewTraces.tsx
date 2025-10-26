import { useDesignSystemTheme } from '@databricks/design-system';
import { InsightQueryBanner } from '../../../pages/experiment-insights/components/InsightQueryBanner';
import { TracesView } from '../../traces/TracesView';
import {
  shouldEnableTracesV3View,
  isExperimentEvalResultsMonitoringUIEnabled,
} from '../../../../common/utils/FeatureUtils';
import { TracesV3View } from './traces-v3/TracesV3View';
import { useGetExperimentQuery } from '../../../hooks/useExperimentQuery';

export const ExperimentViewTraces = ({ experimentIds }: { experimentIds: string[] }) => {
  const { theme } = useDesignSystemTheme();
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
      />
      <TracesComponent experimentIds={experimentIds} />
    </div>
  );
};

const TracesComponent = ({ experimentIds }: { experimentIds: string[] }) => {
  // A cache-only query to get the loading state
  const { loading: isLoadingExperiment } = useGetExperimentQuery({
    experimentId: experimentIds[0],
    options: {
      fetchPolicy: 'cache-only',
    },
  });

  if (shouldEnableTracesV3View() || isExperimentEvalResultsMonitoringUIEnabled()) {
    return <TracesV3View experimentIds={experimentIds} isLoadingExperiment={isLoadingExperiment} />;
  }
  return <TracesView experimentIds={experimentIds} />;
};
