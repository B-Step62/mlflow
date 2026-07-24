import { DatasetSourceTypes, type DatasetSummary, type RunDatasetWithTags } from '../types';

export function datasetSummariesEqual(summary1: DatasetSummary, summary2: DatasetSummary): boolean {
  return (
    summary1.digest === summary2.digest && summary1.name === summary2.name && summary1.context === summary2.context
  );
}

export function getDatasetSourceUrl(datasetWithTags: RunDatasetWithTags): string | null {
  const { dataset } = datasetWithTags;

  try {
    const parsed = JSON.parse(dataset.source);

    switch (dataset.sourceType) {
      case DatasetSourceTypes.HTTP:
      case DatasetSourceTypes.EXTERNAL:
        return parsed.url ?? null;
      case DatasetSourceTypes.S3:
        return parsed.uri ?? null;
      case DatasetSourceTypes.HUGGING_FACE:
        return parsed.path ? `https://huggingface.co/datasets/${parsed.path}` : null;
      case DatasetSourceTypes.LOCAL:
        return parsed.uri ?? null;
      default:
        return null;
    }
  } catch {
    return null;
  }
}

export function getEvaluationDatasetIdFromDatasetSource(source?: string): string | undefined {
  if (!source) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(source);
    return typeof parsed?.dataset_id === 'string' && parsed.dataset_id ? parsed.dataset_id : undefined;
  } catch {
    return undefined;
  }
}

export function getEvaluationDatasetId(datasetWithTags?: RunDatasetWithTags): string | undefined {
  return getEvaluationDatasetIdFromDatasetSource(datasetWithTags?.dataset.source);
}
