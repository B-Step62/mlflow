import invariant from 'invariant';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useExperimentEvaluationRunsData } from '../../components/experiment-page/hooks/useExperimentEvaluationRunsData';
import { ExperimentEvaluationRunsPageWrapper } from './ExperimentEvaluationRunsPageWrapper';
import { ExperimentEvaluationRunsTable } from './ExperimentEvaluationRunsTable';
import type { RowSelectionState } from '@tanstack/react-table';
import { useParams, useSearchParams } from '../../../common/utils/RoutingUtils';
import { Typography, useDesignSystemTheme } from '@databricks/design-system';
import { RunViewEvaluationsTab } from '../../components/evaluations/RunViewEvaluationsTab';
import { ExperimentEvaluationRunsTableControls } from './ExperimentEvaluationRunsTableControls';
import evalRunsEmptyImg from '@mlflow/mlflow/src/common/static/eval-runs-empty.svg';
import Utils from '@mlflow/mlflow/src/common/utils/Utils';
import type { DatasetWithRunType } from '../../components/experiment-page/components/runs/ExperimentViewDatasetDrawer';
import { ExperimentViewDatasetDrawer } from '../../components/experiment-page/components/runs/ExperimentViewDatasetDrawer';
import { keyBy, mapValues, xor } from 'lodash';
import {
  EVAL_RUNS_TABLE_BASE_SELECTION_STATE,
  EvalRunsTableKeyedColumnPrefix,
} from './ExperimentEvaluationRunsTable.constants';
import { invalidateMlflowSearchTracesCache } from '@databricks/web-shared/genai-traces-table';
import { useQueryClient } from '@databricks/web-shared/query-client';
import { FormattedMessage } from 'react-intl';
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
import { useRegisterSelectedIds } from '@mlflow/mlflow/src/assistant';
import { ExperimentEvaluationRunsSummaryCharts } from './ExperimentEvaluationRunsSummaryCharts';
import { useHeaderVisibility } from '../experiment-page-tabs/ExperimentPageHeaderVisibilityContext';

const getLearnMoreLink = () => {
  return 'https://mlflow.org/docs/latest/genai/eval-monitor/quickstart/';
};

const ExperimentEvaluationRunsPageImpl = () => {
  const { experimentId } = useParams();
  const { theme } = useDesignSystemTheme();
  const { setBreadcrumbChild } = useHeaderVisibility();
  const [searchFilter, setSearchFilter] = useState('');
  const [selectedDatasetWithRun, setSelectedDatasetWithRun] = useState<DatasetWithRunType>();
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
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
      setSelectedDatasetWithRun={setSelectedDatasetWithRun}
      setIsDrawerOpen={setIsDrawerOpen}
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

  const comparisonRunUuids =
    selectedRunUuidsFromCheckbox.length >= 2
      ? selectedRunUuidsFromCheckbox
      : [selectedRunUuid, compareToRunUuid].filter((uuid): uuid is string => Boolean(uuid));
  const primaryComparisonRunUuid =
    selectedRunUuid && comparisonRunUuids.includes(selectedRunUuid) ? selectedRunUuid : comparisonRunUuids[0];

  const selectedRun = useMemo(() => runs?.find((run) => run.info.runUuid === selectedRunUuid), [runs, selectedRunUuid]);
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
    return () => setBreadcrumbChild(undefined);
  }, [breadcrumbChild, setBreadcrumbChild]);

  if (isComparisonMode && primaryComparisonRunUuid) {
    return (
      <ExperimentEvaluationRunsRowVisibilityProvider>
        <div css={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: '0px', gap: theme.spacing.sm }}>
          <ExperimentEvaluationRunsSummaryCharts runs={runs ?? []} selectedRunUuids={comparisonRunUuids} />
          <div css={{ display: 'flex', flex: 1, minHeight: '0px', overflow: 'hidden' }}>
            {renderActiveTab(primaryComparisonRunUuid)}
          </div>
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
        {selectedDatasetWithRun && (
          <ExperimentViewDatasetDrawer
            isOpen={isDrawerOpen}
            setIsOpen={setIsDrawerOpen}
            selectedDatasetWithRun={selectedDatasetWithRun}
            setSelectedDatasetWithRun={setSelectedDatasetWithRun}
          />
        )}
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
