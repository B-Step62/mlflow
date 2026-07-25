import invariant from 'invariant';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useExperimentEvaluationRunsData } from '../../components/experiment-page/hooks/useExperimentEvaluationRunsData';
import { ExperimentEvaluationRunsPageWrapper } from './ExperimentEvaluationRunsPageWrapper';
import { ExperimentEvaluationRunsTable } from './ExperimentEvaluationRunsTable';
import type { RowSelectionState } from '@tanstack/react-table';
import { useNavigate, useParams, useSearchParams } from '../../../common/utils/RoutingUtils';
import { Button, DatabaseIcon, SparkleIcon, Typography, useDesignSystemTheme } from '@databricks/design-system';
import { RunViewEvaluationsTab } from '../../components/evaluations/RunViewEvaluationsTab';
import { ExperimentEvaluationRunsTableControls } from './ExperimentEvaluationRunsTableControls';
import evalRunsEmptyImg from '@mlflow/mlflow/src/common/static/eval-runs-empty.svg';
import Utils from '@mlflow/mlflow/src/common/utils/Utils';
import { keyBy, mapValues, xor } from 'lodash';
import {
  EVAL_RUNS_TABLE_BASE_SELECTION_STATE,
  EvalRunsTableKeyedColumnPrefix,
} from './ExperimentEvaluationRunsTable.constants';
import { invalidateMlflowSearchTracesCache } from '@databricks/web-shared/genai-traces-table';
import { useQueryClient } from '@databricks/web-shared/query-client';
import { FormattedMessage, useIntl } from 'react-intl';
import {
  useSelectedRunUuid,
  SELECTED_RUN_UUID_QUERY_PARAM,
} from '../../components/evaluations/hooks/useSelectedRunUuid';
import {
  useCompareToRunUuid,
  COMPARE_TO_RUN_UUID_QUERY_PARAM,
} from '../../components/evaluations/hooks/useCompareToRunUuid';
import { EvalRunsEmptyStateCard } from './EvalRunsEmptyStateCard';
import { isUserFacingTag } from '../../../common/utils/TagUtils';
import {
  createEvalRunsTableKeyedColumnKey,
  parseEvalRunsTableKeyedColumnKey,
} from './ExperimentEvaluationRunsTable.utils';
import { ExperimentEvaluationRunsPageMode } from './hooks/useExperimentEvaluationRunsPageMode';
import { ExperimentEvaluationRunsRowVisibilityProvider } from './hooks/useExperimentEvaluationRunsRowVisibility';
import { useAssistant, useRegisterSelectedIds } from '@mlflow/mlflow/src/assistant';
import { ExperimentEvaluationRunsSummaryCharts } from './ExperimentEvaluationRunsSummaryCharts';
import { useHeaderVisibility } from '../experiment-page-tabs/ExperimentPageHeaderVisibilityContext';
import type { RunDatasetWithTags, RunEntity } from '../../types';
import { getAiGradientBorderStyle } from '../../../shared/web-shared/design-system/aiGradientBorderStyle';
import { CreateEvaluationDatasetModal } from '../experiment-evaluation-datasets/components/CreateEvaluationDatasetModal';
import { useGetScheduledScorers } from '../experiment-scorers/hooks/useGetScheduledScorers';
import type { ScheduledScorer } from '../experiment-scorers/types';
import { formatCostUSD } from '@databricks/web-shared/model-trace-explorer';
import { getEvaluationDatasetId } from '../../utils/DatasetUtils';
import Routes from '../../routes';
import { ExperimentPageTabName } from '../../constants';

const getLearnMoreLink = () => {
  return 'https://mlflow.org/docs/latest/genai/eval-monitor/quickstart/';
};

const getRunInputDataset = (run?: RunEntity) => run?.inputs?.datasetInputs?.[0];

const getDatasetDisplayName = (datasetWithTags: RunDatasetWithTags) =>
  datasetWithTags.dataset.name || datasetWithTags.dataset.digest;

const normalizeMetadataKey = (key: string) => key.toLowerCase().replace(/[^a-z0-9]/g, '');

const getRunMetricByExactKeys = (run: RunEntity, exactKeys: string[]) => {
  const normalizedExactKeys = new Set(exactKeys.map(normalizeMetadataKey));
  return run.data.metrics?.find(
    ({ key, value }) => normalizedExactKeys.has(normalizeMetadataKey(key)) && Number.isFinite(Number(value)),
  );
};

const getRunMetricByPattern = (run: RunEntity, pattern: RegExp) => {
  return run.data.metrics?.find(({ key, value }) => pattern.test(key) && Number.isFinite(Number(value)));
};

const getMetricValue = (metric?: { value: number }) => {
  const value = Number(metric?.value);
  return Number.isFinite(value) ? value : undefined;
};

const getRunCostValue = (run: RunEntity) =>
  getMetricValue(
    getRunMetricByExactKeys(run, ['total_cost_usd', 'total_cost', 'cost_usd', 'cost']) ??
      getRunMetricByPattern(run, /(^|[._/\s-])(total[._/\s-]?)?cost([._/\s-]?usd)?($|[._/\s-])/i) ??
      getRunMetricByPattern(run, /price/i),
  );

const getRunTokenValue = (run: RunEntity) => {
  const exactTotal = getMetricValue(getRunMetricByExactKeys(run, ['total_tokens', 'token_count', 'tokens']));
  if (exactTotal !== undefined) {
    return exactTotal;
  }

  const inputTokens = getMetricValue(getRunMetricByExactKeys(run, ['input_tokens', 'prompt_tokens']));
  const outputTokens = getMetricValue(getRunMetricByExactKeys(run, ['output_tokens', 'completion_tokens']));
  if (inputTokens !== undefined || outputTokens !== undefined) {
    return (inputTokens ?? 0) + (outputTokens ?? 0);
  }
  return getMetricValue(getRunMetricByPattern(run, /token/i));
};

const getRunTraceCountValue = (run: RunEntity) =>
  getMetricValue(
    getRunMetricByExactKeys(run, [
      'trace_count',
      'total_traces',
      'total_traces_analyzed',
      'num_traces',
      'record_count',
      'row_count',
      'num_records',
      'num_samples',
    ]) ?? getRunMetricByPattern(run, /(^|[._/\s-])(trace|record|row|sample)s?([._/\s-]?count)?($|[._/\s-])/i),
  );

const sumDefinedValues = (values: Array<number | undefined>) => {
  const definedValues = values.filter((value): value is number => value !== undefined);
  if (definedValues.length === 0) {
    return undefined;
  }
  return definedValues.reduce((sum, value) => sum + value, 0);
};

const getRunDurationMs = (run: RunEntity) => {
  if (!Number(run.info.startTime) || !Number(run.info.endTime)) {
    return undefined;
  }
  return Number(run.info.endTime) - Number(run.info.startTime);
};

const getRegisteredScorerNamesForRuns = (runs: RunEntity[], scheduledScorers: ScheduledScorer[]) => {
  if (!runs.length || !scheduledScorers.length) {
    return [];
  }

  const metricKeys = runs.flatMap((run) => run.data.metrics?.map((metric) => metric.key) ?? []);
  const scorerNames = new Set<string>();
  for (const scorer of scheduledScorers) {
    const normalizedScorerName = normalizeMetadataKey(scorer.name);
    if (metricKeys.some((metricKey) => normalizeMetadataKey(metricKey).includes(normalizedScorerName))) {
      scorerNames.add(scorer.name);
    }
  }
  return Array.from(scorerNames);
};

type EvaluationRunMetadataItem = {
  key: string;
  content: ReactNode;
};

const EvaluationRunMetadataText = ({ children, maxWidth }: { children: ReactNode; maxWidth?: number | string }) => (
  <Typography.Text
    color="secondary"
    size="sm"
    css={{
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
      maxWidth,
    }}
  >
    {children}
  </Typography.Text>
);

const CreateEvaluationRunDatasetButton = ({ experimentId }: { experimentId: string }) => {
  const [isCreateDatasetModalOpen, setIsCreateDatasetModalOpen] = useState(false);

  return (
    <>
      <Button
        componentId="mlflow.eval-runs.selected-run.create-dataset-button"
        icon={<DatabaseIcon />}
        size="small"
        onClick={() => setIsCreateDatasetModalOpen(true)}
      >
        <FormattedMessage
          defaultMessage="Create dataset"
          description="Button label to create an evaluation dataset from the evaluation run header"
        />
      </Button>
      <CreateEvaluationDatasetModal
        visible={isCreateDatasetModalOpen}
        experimentId={experimentId}
        onCancel={() => setIsCreateDatasetModalOpen(false)}
      />
    </>
  );
};

const EvaluationRunHeaderMetadata = ({
  experimentId,
  runs,
  selectedRun,
  selectedRunDataset,
  selectedRunDatasetDisplayName,
  registeredScorerNames,
  onOpenDataset,
  showComparisonMetadata,
}: {
  experimentId: string;
  runs: RunEntity[];
  selectedRun?: RunEntity;
  selectedRunDataset?: RunDatasetWithTags;
  selectedRunDatasetDisplayName?: string;
  registeredScorerNames: string[];
  onOpenDataset: () => void;
  showComparisonMetadata: boolean;
}) => {
  const { theme } = useDesignSystemTheme();
  const intl = useIntl();

  const totalCost = sumDefinedValues(runs.map(getRunCostValue));
  const totalTokens = sumDefinedValues(runs.map(getRunTokenValue));
  const totalTraceCount = sumDefinedValues(runs.map(getRunTraceCountValue));
  const totalDurationMs = sumDefinedValues(runs.map(getRunDurationMs));
  const createdAt = selectedRun?.info.startTime ? Utils.formatTimestamp(selectedRun.info.startTime, intl) : undefined;

  if (!runs.length) {
    return null;
  }

  const metadataItems: EvaluationRunMetadataItem[] = [];

  if (showComparisonMetadata) {
    metadataItems.push({
      key: 'run-count',
      content: (
        <EvaluationRunMetadataText>
          <FormattedMessage
            defaultMessage="Runs: {count}"
            description="Run count in evaluation run header metadata"
            values={{ count: runs.length.toLocaleString() }}
          />
        </EvaluationRunMetadataText>
      ),
    });
  }

  if (!showComparisonMetadata) {
    if (selectedRunDataset && selectedRunDatasetDisplayName) {
      metadataItems.push({
        key: 'dataset',
        content: (
          <span
            css={{
              display: 'inline-flex',
              alignItems: 'baseline',
              minWidth: 0,
              maxWidth: 360,
              gap: theme.spacing.xs / 2,
            }}
          >
            <EvaluationRunMetadataText>
              <FormattedMessage
                defaultMessage="Dataset:"
                description="Label for the dataset in evaluation run header metadata"
              />
            </EvaluationRunMetadataText>
            <Typography.Link
              componentId="mlflow.eval-runs.header-metadata.dataset"
              onClick={onOpenDataset}
              title={selectedRunDatasetDisplayName}
              css={{
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                fontSize: theme.typography.fontSizeSm,
              }}
            >
              {selectedRunDatasetDisplayName}
            </Typography.Link>
          </span>
        ),
      });
    } else {
      metadataItems.push({
        key: 'create-dataset',
        content: <CreateEvaluationRunDatasetButton experimentId={experimentId} />,
      });
    }
  }

  if (createdAt) {
    metadataItems.push({
      key: 'created-at',
      content: (
        <EvaluationRunMetadataText>
          <FormattedMessage
            defaultMessage="Created: {createdAt}"
            description="Created timestamp in evaluation run header metadata"
            values={{ createdAt }}
          />
        </EvaluationRunMetadataText>
      ),
    });
  }

  if (totalTraceCount !== undefined) {
    metadataItems.push({
      key: 'trace-count',
      content: (
        <EvaluationRunMetadataText>
          <FormattedMessage
            defaultMessage="{count, plural, one {# trace} other {# traces}}"
            description="Trace count in evaluation run header metadata"
            values={{ count: Math.round(totalTraceCount) }}
          />
        </EvaluationRunMetadataText>
      ),
    });
  }

  if (registeredScorerNames.length > 0) {
    metadataItems.push({
      key: 'judge-count',
      content: (
        <EvaluationRunMetadataText>
          <FormattedMessage
            defaultMessage="{count, plural, one {# judge} other {# judges}}"
            description="Registered judge count in evaluation run header metadata"
            values={{ count: registeredScorerNames.length }}
          />
        </EvaluationRunMetadataText>
      ),
    });
  }

  if (totalDurationMs !== undefined) {
    metadataItems.push({
      key: 'duration',
      content: (
        <EvaluationRunMetadataText>
          <FormattedMessage
            defaultMessage="Duration: {duration}"
            description="Total duration in evaluation run header metadata"
            values={{ duration: Utils.formatDuration(totalDurationMs) }}
          />
        </EvaluationRunMetadataText>
      ),
    });
  }

  metadataItems.push({
    key: 'total-cost',
    content: (
      <EvaluationRunMetadataText>
        <FormattedMessage
          defaultMessage="Total cost: {cost}"
          description="Total cost in evaluation run header metadata"
          values={{ cost: formatCostUSD(totalCost ?? 0) }}
        />
      </EvaluationRunMetadataText>
    ),
  });

  if (totalTokens !== undefined) {
    metadataItems.push({
      key: 'total-tokens',
      content: (
        <EvaluationRunMetadataText>
          <FormattedMessage
            defaultMessage="Tokens: {tokens}"
            description="Total token count in evaluation run header metadata"
            values={{ tokens: Math.round(totalTokens).toLocaleString() }}
          />
        </EvaluationRunMetadataText>
      ),
    });
  }

  return (
    <div
      data-testid="evaluation-run-header-metadata"
      css={{
        display: 'flex',
        flexWrap: 'wrap',
        columnGap: theme.spacing.xs,
        rowGap: theme.spacing.xs / 2,
        alignItems: 'center',
        minWidth: 0,
        color: theme.colors.textSecondary,
      }}
    >
      {metadataItems.map((item, index) => (
        <span
          key={item.key}
          css={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: theme.spacing.xs,
            minWidth: 0,
            maxWidth: '100%',
          }}
        >
          {index > 0 && (
            <Typography.Text color="secondary" size="sm" aria-hidden>
              &middot;
            </Typography.Text>
          )}
          {item.content}
        </span>
      ))}
    </div>
  );
};

const ExperimentEvaluationRunsPageImpl = () => {
  const { experimentId } = useParams();
  const { theme } = useDesignSystemTheme();
  const intl = useIntl();
  const navigate = useNavigate();
  const { openPanel, prefillPrompt } = useAssistant();
  const {
    setBreadcrumbChild,
    setHeaderActionsHidden,
    setTitleOverride,
    setTitleAdjacent,
    setTitleMetadata,
    setActionSlot,
  } = useHeaderVisibility();
  const [searchFilter, setSearchFilter] = useState('');
  const [selectedColumns, setSelectedColumns] = useState<{ [key: string]: boolean }>(
    EVAL_RUNS_TABLE_BASE_SELECTION_STATE,
  );

  const queryClient = useQueryClient();
  const [isComparisonMode, setIsComparisonMode] = useState(false);

  const [selectedRunUuid, setSelectedRunUuid] = useSelectedRunUuid();
  const [compareToRunUuid, setCompareToRunUuid] = useCompareToRunUuid();
  const [, setSearchParams] = useSearchParams();

  invariant(experimentId, 'Experiment ID must be defined');

  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  useRegisterSelectedIds('selectedRunIds', rowSelection);

  const {
    data: runs,
    isLoading,
    isFetching,
    fetchNextPage,
    hasNextPage,
    refetch,
  } = useExperimentEvaluationRunsData({
    experimentId,
    enabled: true,
    filter: searchFilter,
  });

  const refetchAll = useCallback(() => {
    refetch();
    invalidateMlflowSearchTracesCache({ queryClient });
  }, [refetch, queryClient]);

  const runUuids = useMemo(() => runs?.map((run) => run.info.runUuid) ?? [], [runs]);

  // Get selected run UUIDs from checkbox selection
  const selectedRunUuidsFromCheckbox = useMemo(
    () =>
      Object.entries(rowSelection)
        .filter(([_, value]) => value)
        .map(([key]) => key),
    [rowSelection],
  );

  // On mount, if URL has selectedRunUuid (and optionally compareToRunUuid), initialize rowSelection.
  const hasInitializedFromUrl = useRef(false);
  useEffect(() => {
    // Only run initialization once when runs are loaded
    if (hasInitializedFromUrl.current || !runs?.length) {
      return;
    }
    hasInitializedFromUrl.current = true;

    // If URL has selectedRunUuid, initialize rowSelection
    if (selectedRunUuid && runUuids.includes(selectedRunUuid)) {
      const initialSelection: RowSelectionState = { [selectedRunUuid]: true };
      // Also include compareToRunUuid if present in URL
      if (compareToRunUuid && runUuids.includes(compareToRunUuid)) {
        initialSelection[compareToRunUuid] = true;
        // Only enter comparison mode if BOTH runs are in URL (active comparison)
        setIsComparisonMode(true);
      }
      setRowSelection(initialSelection);
    }
  }, [selectedRunUuid, compareToRunUuid, runs, runUuids, setIsComparisonMode]);

  // Sync URL params from checkbox selection when in comparison mode.
  useEffect(() => {
    if (!isComparisonMode) {
      return;
    }

    if (selectedRunUuidsFromCheckbox.length < 2) {
      setIsComparisonMode(false);
      setCompareToRunUuid(undefined);
      return;
    }

    const primaryRunUuid =
      selectedRunUuid && selectedRunUuidsFromCheckbox.includes(selectedRunUuid)
        ? selectedRunUuid
        : selectedRunUuidsFromCheckbox[0];
    const secondaryRunUuid = selectedRunUuidsFromCheckbox.find((uuid) => uuid !== primaryRunUuid);

    if (primaryRunUuid && primaryRunUuid !== selectedRunUuid) {
      setSelectedRunUuid(primaryRunUuid);
    }
    if (secondaryRunUuid && secondaryRunUuid !== compareToRunUuid) {
      setCompareToRunUuid(secondaryRunUuid);
    }
  }, [
    isComparisonMode,
    selectedRunUuidsFromCheckbox,
    selectedRunUuid,
    compareToRunUuid,
    setSelectedRunUuid,
    setCompareToRunUuid,
    setIsComparisonMode,
  ]);

  /**
   * Generate a list of unique data columns based on runs' metrics, params, and tags.
   */
  const uniqueColumns = useMemo(() => {
    const metricKeys: Set<string> = new Set();
    const paramKeys: Set<string> = new Set();
    const tagKeys: Set<string> = new Set();
    // Using for-of to avoid costlier functions and iterators
    for (const run of runs ?? []) {
      for (const metric of run.data.metrics ?? []) {
        metricKeys.add(metric.key);
      }
      for (const param of run.data.params ?? []) {
        paramKeys.add(param.key);
      }
      for (const tag of run.data.tags ?? []) {
        if (isUserFacingTag(tag.key)) {
          tagKeys.add(tag.key);
        }
      }
    }
    return [
      ...Array.from(metricKeys).map((key) =>
        createEvalRunsTableKeyedColumnKey(EvalRunsTableKeyedColumnPrefix.METRIC, key),
      ),
      ...Array.from(paramKeys).map((key) =>
        createEvalRunsTableKeyedColumnKey(EvalRunsTableKeyedColumnPrefix.PARAM, key),
      ),
      ...Array.from(tagKeys).map((key) => createEvalRunsTableKeyedColumnKey(EvalRunsTableKeyedColumnPrefix.TAG, key)),
    ];
  }, [runs]);

  const baseColumns = useMemo(() => Object.keys(EVAL_RUNS_TABLE_BASE_SELECTION_STATE), []);
  const existingColumns = useMemo(
    () => Object.keys(selectedColumns).filter((column) => !baseColumns.includes(column)),
    [baseColumns, selectedColumns],
  );
  const columnDifference = useMemo(() => xor(existingColumns, uniqueColumns), [existingColumns, uniqueColumns]);
  // if there is a difference between the existing column state and
  // the unique metrics (e.g. the user performed a search and the
  // list of available metrics changed), reset the selected columns
  // to the default state to avoid displaying columns that don't exist
  if (columnDifference.length > 0) {
    setSelectedColumns({
      ...EVAL_RUNS_TABLE_BASE_SELECTION_STATE,
      ...mapValues(
        keyBy(uniqueColumns),
        (_, column) => parseEvalRunsTableKeyedColumnKey(column)?.columnType !== EvalRunsTableKeyedColumnPrefix.PARAM,
      ),
    });
  }

  const isEmpty = runUuids.length === 0 && !searchFilter && !isLoading;

  const handleCompare = useCallback(
    (runUuidsToCompare: string[]) => {
      const [runUuid1, runUuid2] = runUuidsToCompare;
      if (!runUuid1 || !runUuid2) {
        return;
      }
      // Set both URL params atomically to avoid race conditions
      setSearchParams(
        (params) => {
          params.set(SELECTED_RUN_UUID_QUERY_PARAM, runUuid1);
          params.set(COMPARE_TO_RUN_UUID_QUERY_PARAM, runUuid2);
          return params;
        },
        { replace: true },
      );
      setIsComparisonMode(true);
    },
    [setSearchParams],
  );

  const renderActiveTab = (selectedRunUuid: string) => {
    const selectedRun = runs?.find((run) => run.info.runUuid === selectedRunUuid);
    // Keyed by tag key so RunViewEvaluationsTab can detect regression-test runs
    // (mlflow.runType=test) and switch the result view accordingly.
    const selectedRunTags = keyBy(selectedRun?.data?.tags ?? [], 'key');
    return (
      <RunViewEvaluationsTab
        experimentId={experimentId}
        runUuid={selectedRunUuid}
        runTags={selectedRunTags}
        runDisplayName={Utils.getRunDisplayName(selectedRun?.info, selectedRunUuid)}
        setCurrentRunUuid={setSelectedRunUuid}
        hideCompareSelector
      />
    );
  };

  const tableContainerRef = useRef<HTMLDivElement>(null);
  const offsetFromBottomToFetchMore = 100;
  const fetchMoreOnBottomReached = useCallback(
    (containerRefElement?: HTMLDivElement | null) => {
      if (containerRefElement) {
        const { scrollHeight, scrollTop, clientHeight } = containerRefElement;
        if (scrollHeight - scrollTop - clientHeight < offsetFromBottomToFetchMore && !isFetching && hasNextPage) {
          fetchNextPage();
        }
      }
    },
    [fetchNextPage, isFetching, hasNextPage],
  );

  // a check on mount and after a fetch to see if the table is already scrolled to the bottom and immediately needs to fetch more data
  useEffect(() => {
    fetchMoreOnBottomReached(tableContainerRef.current);
  }, [fetchMoreOnBottomReached]);

  const renderTableControls = () => (
    <ExperimentEvaluationRunsTableControls
      runs={runs ?? []}
      refetchRuns={refetchAll}
      searchFilter={searchFilter}
      setSearchFilter={setSearchFilter}
      rowSelection={rowSelection}
      setRowSelection={setRowSelection}
      selectedColumns={selectedColumns}
      setSelectedColumns={setSelectedColumns}
      onCompare={handleCompare}
      setIsComparisonMode={setIsComparisonMode}
    />
  );

  const renderTable = () => (
    <ExperimentEvaluationRunsTable
      data={runs ?? []}
      uniqueColumns={uniqueColumns}
      selectedColumns={selectedColumns}
      selectedRunUuid={selectedRunUuid}
      setSelectedRunUuid={(runUuid: string) => {
        // Update both params atomically to avoid race conditions
        // where separate setSearchParams calls overwrite each other
        setSearchParams(
          (params) => {
            params.set(SELECTED_RUN_UUID_QUERY_PARAM, runUuid);
            params.delete(COMPARE_TO_RUN_UUID_QUERY_PARAM);
            return params;
          },
          { replace: true },
        );
        setIsComparisonMode(false);
      }}
      isLoading={isLoading}
      hasNextPage={hasNextPage ?? false}
      rowSelection={rowSelection}
      setRowSelection={setRowSelection}
      viewMode={ExperimentEvaluationRunsPageMode.TRACES}
      onScroll={(e) => fetchMoreOnBottomReached(e.currentTarget)}
      ref={tableContainerRef}
      isGrouped={false}
      enableImprovedComparison={false}
    />
  );

  const renderEmptyState = () => (
    <div
      css={{
        display: 'flex',
        flex: 1,
        flexDirection: 'column',
        overflow: 'auto',
        // Always reserve the scrollbar gutter so the horizontally-centered content doesn't
        // shift left/right when a taller tab adds (or a shorter tab removes) the scrollbar.
        scrollbarGutter: 'stable',
      }}
    >
      <div
        css={{
          // Top-anchored (not vertically centered): the AgentActionCard below changes height
          // when its active tab switches, and centering would re-center the whole block —
          // making the title and image above visibly jump. Anchoring to the top keeps them
          // put and stays scrollable when the content overflows.
          margin: '0 auto',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          // Pin to a definite width (the card's own maxWidth) instead of shrink-to-fit. With
          // `margin: 0 auto` a flex column hugs its widest child, so switching to a wide tab
          // (e.g. the non-wrapping Python snippet) would widen the whole block and resize the
          // card. A fixed width keeps it stable; wide tab content scrolls within the card.
          width: '100%',
          maxWidth: 720,
          padding: `${theme.spacing.lg * 2}px ${theme.spacing.md}px ${theme.spacing.lg * 4}px`,
        }}
      >
        <div
          css={{ maxWidth: 520, display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}
        >
          <Typography.Title level={3} color="secondary" css={{ marginTop: 0, marginBottom: theme.spacing.xs }}>
            <FormattedMessage
              defaultMessage="Evaluate and improve the quality, cost, latency of your GenAI app"
              description="Title of the empty state for the evaluation runs page"
            />
          </Typography.Title>
          <Typography.Paragraph color="secondary" css={{ marginBottom: theme.spacing.md }}>
            <FormattedMessage
              defaultMessage="Create evaluation datasets in order to iteratively evaluate and improve your app. Run evaluations to check that your fixes are working, and compare quality between app / prompt versions. {learnMoreLink}"
              description="Description of the empty state for the evaluation runs page"
              values={{
                learnMoreLink: (
                  <Typography.Link
                    componentId="mlflow.eval-runs.empty-state.learn-more-link"
                    href={getLearnMoreLink()}
                    css={{ whiteSpace: 'nowrap' }}
                    openInNewTab
                  >
                    <FormattedMessage
                      defaultMessage="Learn more"
                      description="Link text to learn more about evaluation runs"
                    />
                  </Typography.Link>
                ),
              }}
            />
          </Typography.Paragraph>
        </div>
        <img css={{ maxWidth: '100%', maxHeight: 160 }} src={evalRunsEmptyImg} alt="No runs found" />
        <div css={{ width: '100%', marginTop: theme.spacing.lg }}>
          <EvalRunsEmptyStateCard experimentId={experimentId} />
        </div>
      </div>
    </div>
  );

  const comparisonRunUuids = useMemo(
    () =>
      selectedRunUuidsFromCheckbox.length >= 2
        ? selectedRunUuidsFromCheckbox
        : [selectedRunUuid, compareToRunUuid].filter((uuid): uuid is string => Boolean(uuid)),
    [compareToRunUuid, selectedRunUuid, selectedRunUuidsFromCheckbox],
  );
  const primaryComparisonRunUuid =
    selectedRunUuid && comparisonRunUuids.includes(selectedRunUuid) ? selectedRunUuid : comparisonRunUuids[0];

  const selectedRun = useMemo(() => runs?.find((run) => run.info.runUuid === selectedRunUuid), [runs, selectedRunUuid]);
  const selectedRunDisplayName = selectedRunUuid
    ? Utils.getRunDisplayName(selectedRun?.info, selectedRunUuid)
    : undefined;
  const { data: scheduledScorersData } = useGetScheduledScorers(experimentId, {
    enabled: Boolean(selectedRunUuid || isComparisonMode),
  });
  const selectedRunDataset = getRunInputDataset(selectedRun);
  const selectedRunDatasetDisplayName = selectedRunDataset ? getDatasetDisplayName(selectedRunDataset) : undefined;
  const selectedRunEvaluationDatasetId = getEvaluationDatasetId(selectedRunDataset);
  const openSelectedRunDataset = useCallback(() => {
    if (selectedRunEvaluationDatasetId) {
      navigate(Routes.getExperimentPageDatasetDetailRoute(experimentId, selectedRunEvaluationDatasetId));
      return;
    }

    navigate(Routes.getExperimentPageTabRoute(experimentId, ExperimentPageTabName.Datasets));
  }, [experimentId, navigate, selectedRunEvaluationDatasetId]);
  const headerTitle = useMemo(() => {
    if (isComparisonMode && comparisonRunUuids.length >= 2) {
      return (
        <FormattedMessage
          defaultMessage="Compare {numRuns, plural, one {# run} other {# runs}}"
          description="Header title for the evaluation runs comparison view"
          values={{ numRuns: comparisonRunUuids.length }}
        />
      );
    }
    return selectedRunDisplayName;
  }, [comparisonRunUuids.length, isComparisonMode, selectedRunDisplayName]);
  const headerMetadataRuns = useMemo(() => {
    if (isComparisonMode && comparisonRunUuids.length >= 2) {
      return comparisonRunUuids
        .map((runUuid) => runs?.find((run) => run.info.runUuid === runUuid))
        .filter((run): run is RunEntity => Boolean(run));
    }
    return selectedRun ? [selectedRun] : [];
  }, [comparisonRunUuids, isComparisonMode, runs, selectedRun]);
  const registeredScorerNames = useMemo(
    () => getRegisteredScorerNamesForRuns(headerMetadataRuns, scheduledScorersData?.scheduledScorers ?? []),
    [headerMetadataRuns, scheduledScorersData?.scheduledScorers],
  );
  const headerTitleMetadata = useMemo(() => {
    if (!headerMetadataRuns.length) {
      return undefined;
    }

    return (
      <EvaluationRunHeaderMetadata
        experimentId={experimentId}
        runs={headerMetadataRuns}
        selectedRun={selectedRun}
        selectedRunDataset={selectedRunDataset}
        selectedRunDatasetDisplayName={selectedRunDatasetDisplayName}
        registeredScorerNames={registeredScorerNames}
        onOpenDataset={openSelectedRunDataset}
        showComparisonMetadata={isComparisonMode && comparisonRunUuids.length >= 2}
      />
    );
  }, [
    experimentId,
    headerMetadataRuns,
    isComparisonMode,
    comparisonRunUuids.length,
    openSelectedRunDataset,
    registeredScorerNames,
    selectedRun,
    selectedRunDataset,
    selectedRunDatasetDisplayName,
  ]);
  const analyzeResultPrompt = useMemo(() => {
    if (isComparisonMode && comparisonRunUuids.length >= 2) {
      return intl.formatMessage(
        {
          defaultMessage:
            'Analyze these evaluation runs and summarize the most important quality, latency, token, and cost differences: {runUuids}',
          description: 'Prompt seeded into the assistant for analyzing compared evaluation runs',
        },
        { runUuids: comparisonRunUuids.join(', ') },
      );
    }
    if (selectedRunUuid && selectedRunDisplayName) {
      return intl.formatMessage(
        {
          defaultMessage:
            'Analyze evaluation run "{runName}" ({runUuid}) and summarize quality issues, failing assessments, latency, token usage, and cost.',
          description: 'Prompt seeded into the assistant for analyzing a selected evaluation run',
        },
        { runName: selectedRunDisplayName, runUuid: selectedRunUuid },
      );
    }
    return undefined;
  }, [comparisonRunUuids, intl, isComparisonMode, selectedRunDisplayName, selectedRunUuid]);
  const handleAnalyzeResult = useCallback(() => {
    if (!analyzeResultPrompt) {
      return;
    }
    openPanel();
    prefillPrompt(analyzeResultPrompt);
  }, [analyzeResultPrompt, openPanel, prefillPrompt]);
  const headerActionSlot = useMemo(() => {
    if (!analyzeResultPrompt) {
      return undefined;
    }
    return (
      <Button
        componentId="mlflow.eval-runs.analyze-result-button"
        icon={<SparkleIcon color="ai" />}
        onClick={handleAnalyzeResult}
        css={getAiGradientBorderStyle(theme)}
      >
        <FormattedMessage
          defaultMessage="Analyze result"
          description="Button label for AI-assisted evaluation result analysis"
        />
      </Button>
    );
  }, [analyzeResultPrompt, handleAnalyzeResult, theme]);
  const breadcrumbChild = useMemo(() => {
    if (isComparisonMode && comparisonRunUuids.length >= 2) {
      return (
        <FormattedMessage
          defaultMessage="Compare {numRuns, plural, one {# run} other {# runs}}"
          description="Breadcrumb nav item for the evaluation runs comparison view"
          values={{ numRuns: comparisonRunUuids.length }}
        />
      );
    }
    if (selectedRunUuid) {
      return Utils.getRunDisplayName(selectedRun?.info, selectedRunUuid);
    }
    return undefined;
  }, [comparisonRunUuids.length, isComparisonMode, selectedRun, selectedRunUuid]);

  useEffect(() => {
    setBreadcrumbChild(breadcrumbChild);
    setHeaderActionsHidden(Boolean(headerActionSlot));
    setTitleOverride(headerTitle);
    setTitleAdjacent(undefined);
    setTitleMetadata(headerTitleMetadata);
    setActionSlot(headerActionSlot);
    return () => {
      setBreadcrumbChild(undefined);
      setHeaderActionsHidden(false);
      setTitleOverride(undefined);
      setTitleAdjacent(undefined);
      setTitleMetadata(undefined);
      setActionSlot(undefined);
    };
  }, [
    breadcrumbChild,
    headerActionSlot,
    headerTitle,
    headerTitleMetadata,
    setActionSlot,
    setBreadcrumbChild,
    setHeaderActionsHidden,
    setTitleAdjacent,
    setTitleMetadata,
    setTitleOverride,
  ]);

  if (isComparisonMode && primaryComparisonRunUuid) {
    return (
      <ExperimentEvaluationRunsRowVisibilityProvider>
        <div css={{ display: 'flex', flex: 1, minHeight: '0px', overflow: 'hidden' }}>
          {renderActiveTab(primaryComparisonRunUuid)}
        </div>
      </ExperimentEvaluationRunsRowVisibilityProvider>
    );
  }

  if (selectedRunUuid) {
    return (
      <ExperimentEvaluationRunsRowVisibilityProvider>
        <div css={{ display: 'flex', flex: 1, minHeight: '0px', overflow: 'hidden' }}>
          {renderActiveTab(selectedRunUuid)}
        </div>
      </ExperimentEvaluationRunsRowVisibilityProvider>
    );
  }

  return (
    <ExperimentEvaluationRunsRowVisibilityProvider>
      <div css={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: '0px' }}>
        <div
          css={{
            display: 'flex',
            flexDirection: 'column',
            gap: theme.spacing.sm,
            flex: 1,
            minHeight: '0px',
            overflow: 'hidden',
          }}
        >
          {!isEmpty && (
            <ExperimentEvaluationRunsSummaryCharts runs={runs ?? []} selectedRunUuids={selectedRunUuidsFromCheckbox} />
          )}
          {renderTableControls()}
          {isEmpty ? renderEmptyState() : renderTable()}
        </div>
      </div>
    </ExperimentEvaluationRunsRowVisibilityProvider>
  );
};

const ExperimentEvaluationRunsPage = () => (
  <ExperimentEvaluationRunsPageWrapper>
    <ExperimentEvaluationRunsPageImpl />
  </ExperimentEvaluationRunsPageWrapper>
);

export default ExperimentEvaluationRunsPage;
