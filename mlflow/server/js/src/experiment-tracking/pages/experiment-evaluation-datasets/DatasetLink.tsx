import { useMemo } from 'react';
import { Link, useParams } from '@mlflow/mlflow/src/common/utils/RoutingUtils';
import Routes from '@mlflow/mlflow/src/experiment-tracking/routes';
import { getEvaluationDatasetIdFromDatasetSource } from '../../utils/DatasetUtils';

export const DatasetLink = ({
  dataset,
  children,
  className,
}: {
  dataset: {
    digest: string;
    name: string;
    profile: string;
    schema: string;
    source: string;
    sourceType: string;
  };
  children: React.ReactElement;
  className?: string;
}) => {
  const { experimentId } = useParams();
  const datasetId = useMemo(() => getEvaluationDatasetIdFromDatasetSource(dataset.source), [dataset.source]);

  // If the dataset ID is present, render a link to the dataset page
  if (datasetId && experimentId) {
    return (
      <Link
        componentId="mlflow.experiment_tracking.evaluation_datasets.dataset_link"
        to={Routes.getExperimentPageDatasetDetailRoute(experimentId, datasetId)}
        className={className}
      >
        {children}
      </Link>
    );
  }

  // If no link can be rendered, render the children without a link
  return children;
};
