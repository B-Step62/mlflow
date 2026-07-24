import { isNil } from 'lodash';
import React, { useCallback } from 'react';

import {
  Typography,
  useDesignSystemTheme,
  TableFilterLayout,
  Tooltip,
  Spinner,
  WarningIcon,
  Button,
  RefreshIcon,
  ToggleButton,
  SegmentedControlButton,
  SegmentedControlGroup,
} from '@databricks/design-system';
import { FormattedMessage, useIntl } from '@databricks/i18n';

import { GenAITracesTableActions } from './GenAITracesTableActions';
import { GenAiTracesTableFilter } from './GenAiTracesTableFilter';
import { GenAiTracesTableSearchInput } from './GenAiTracesTableSearchInput';
import { EvaluationsOverviewColumnSelectorGrouped } from './components/EvaluationsOverviewColumnSelectorGrouped';
import { EvaluationsOverviewSortDropdown } from './components/EvaluationsOverviewSortDropdown';
import { DetectIssuesButton } from './components/DetectIssuesButton';
import type {
  EvaluationsOverviewTableSort,
  TraceActions,
  AssessmentInfo,
  TracesTableColumn,
  TableFilter,
  TableFilterOptions,
  TraceTablePageSource,
} from './types';
import { shouldEnableSessionGrouping, shouldEnableTagGrouping } from './utils/FeatureUtils';
import { shouldEnableIssueDetection } from '../../../common/utils/FeatureUtils';
import type { ModelTraceInfoV3 } from '../model-trace-explorer/ModelTrace.types';

interface CountInfo {
  currentCount?: number;
  totalCount: number;
  maxAllowedCount: number;
  logCountLoading: boolean;
}

const ROW_HEIGHT_COMPACT = 'compact';
const ROW_HEIGHT_EXPANDED = 'expanded';
const COMPACT_TEXT_CELL_MAX_LINES = 1;
const EXPANDED_TEXT_CELL_MAX_LINES = 5;
const ROW_HEIGHT_ICON_STROKE_WIDTH = 1.25;

const CompactRowsIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true" focusable="false">
    <path d="M4 3H12" stroke="currentColor" strokeWidth={ROW_HEIGHT_ICON_STROKE_WIDTH} strokeLinecap="round" />
    <path d="M4 13H12" stroke="currentColor" strokeWidth={ROW_HEIGHT_ICON_STROKE_WIDTH} strokeLinecap="round" />
    <path d="M8 5V8.5" stroke="currentColor" strokeWidth={ROW_HEIGHT_ICON_STROKE_WIDTH} strokeLinecap="round" />
    <path
      d="M5.5 6.5L8 9L10.5 6.5"
      stroke="currentColor"
      strokeWidth={ROW_HEIGHT_ICON_STROKE_WIDTH}
      strokeLinecap="round"
    />
    <path d="M8 11V7.5" stroke="currentColor" strokeWidth={ROW_HEIGHT_ICON_STROKE_WIDTH} strokeLinecap="round" />
    <path
      d="M5.5 9.5L8 7L10.5 9.5"
      stroke="currentColor"
      strokeWidth={ROW_HEIGHT_ICON_STROKE_WIDTH}
      strokeLinecap="round"
    />
  </svg>
);

const ExpandedRowsIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true" focusable="false">
    <path d="M4 3H12" stroke="currentColor" strokeWidth={ROW_HEIGHT_ICON_STROKE_WIDTH} strokeLinecap="round" />
    <path d="M4 13H12" stroke="currentColor" strokeWidth={ROW_HEIGHT_ICON_STROKE_WIDTH} strokeLinecap="round" />
    <path d="M8 8V4.5" stroke="currentColor" strokeWidth={ROW_HEIGHT_ICON_STROKE_WIDTH} strokeLinecap="round" />
    <path
      d="M5.5 6.5L8 4L10.5 6.5"
      stroke="currentColor"
      strokeWidth={ROW_HEIGHT_ICON_STROKE_WIDTH}
      strokeLinecap="round"
    />
    <path d="M8 8V11.5" stroke="currentColor" strokeWidth={ROW_HEIGHT_ICON_STROKE_WIDTH} strokeLinecap="round" />
    <path
      d="M5.5 9.5L8 12L10.5 9.5"
      stroke="currentColor"
      strokeWidth={ROW_HEIGHT_ICON_STROKE_WIDTH}
      strokeLinecap="round"
    />
  </svg>
);

interface GenAITracesTableToolbarProps {
  // Component for detect issues button
  pageSource?: TraceTablePageSource;

  // Experiment metadata
  experimentId?: string;

  // Table metadata
  allColumns: TracesTableColumn[];
  assessmentInfos: AssessmentInfo[];

  // Table data
  traceInfos: ModelTraceInfoV3[] | undefined;

  // Filters
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  filters: TableFilter[];
  setFilters: (newFilters: TableFilter[] | undefined, replace?: boolean) => void;
  tableSort: EvaluationsOverviewTableSort | undefined;
  setTableSort: (sort: EvaluationsOverviewTableSort | undefined) => void;
  hideSortDropdown?: boolean;
  selectedColumns: TracesTableColumn[];
  toggleColumns: (newColumns: TracesTableColumn[]) => void;
  setSelectedColumns: (nextSelected: TracesTableColumn[]) => void;

  // Actions
  traceActions?: TraceActions;

  // Stats
  countInfo: CountInfo;

  // Table filter options
  tableFilterOptions: TableFilterOptions;

  // Loading state
  isMetadataLoading?: boolean;

  // Error state
  metadataError?: Error | null;

  // whether or not the toolbar show show additional search options only
  // available in the new APIs. this param is somewhat confusingly named
  // in OSS, since the "new APIs" still use the v3 prefixes
  usesV4APIs?: boolean;
  onRefresh?: () => void;
  isRefreshing?: boolean;

  // Session grouping
  isGroupedBySession?: boolean;
  forceGroupBySession?: boolean;
  hideGroupBySessionToggle?: boolean;
  onToggleSessionGrouping?: () => void;

  // Request/response row height
  textCellMaxLines?: number;
  setTextCellMaxLines?: (maxLines: number) => void;

  // Issue detection
  onDetectIssues?: () => void;

  // Additional elements to render in the toolbar
  addons?: React.ReactNode;
}

export const GenAITracesTableToolbar: React.FC<React.PropsWithChildren<GenAITracesTableToolbarProps>> = React.memo(
  // eslint-disable-next-line react-component-name/react-component-name -- TODO(FEINF-4716)
  (props: GenAITracesTableToolbarProps) => {
    const {
      pageSource = 'experiment-traces',
      searchQuery,
      setSearchQuery,
      filters,
      setFilters,
      tableSort,
      setTableSort,
      hideSortDropdown,
      selectedColumns,
      toggleColumns,
      setSelectedColumns,
      assessmentInfos,
      experimentId,
      traceInfos,
      tableFilterOptions,
      traceActions,
      allColumns,
      countInfo,
      isMetadataLoading,
      usesV4APIs,
      metadataError,
      onRefresh,
      isRefreshing,
      isGroupedBySession,
      forceGroupBySession,
      hideGroupBySessionToggle,
      onToggleSessionGrouping,
      textCellMaxLines,
      setTextCellMaxLines,
      onDetectIssues,
      addons,
    } = props;
    const { theme } = useDesignSystemTheme();
    const intl = useIntl();

    const onSortChange = useCallback(
      (sortOption, orderByAsc) => {
        setTableSort({ key: sortOption.key, type: sortOption.type, asc: orderByAsc });
      },
      [setTableSort],
    );

    // When using V4 APIs, we want users to be able to change filters while the traces are being loaded or there is an error
    const shouldDisplayErrorState = Boolean(metadataError && !usesV4APIs);
    const shouldDisplayLoadingState = isMetadataLoading && !usesV4APIs;

    return (
      <div
        css={{
          display: 'flex',
          width: '100%',
          alignItems: 'flex-end',
          gap: theme.spacing.sm,
          paddingBottom: `${theme.spacing.xs}px`,
        }}
      >
        <TableFilterLayout
          css={{
            marginBottom: 0,
            flex: 1,
          }}
        >
          <GenAiTracesTableSearchInput searchQuery={searchQuery} setSearchQuery={setSearchQuery} />
          <GenAiTracesTableFilter
            filters={filters}
            setFilters={setFilters}
            assessmentInfos={assessmentInfos}
            experimentId={experimentId}
            tableFilterOptions={tableFilterOptions}
            allColumns={allColumns}
            isLoading={shouldDisplayLoadingState}
            isError={shouldDisplayErrorState}
            usesV4APIs={usesV4APIs}
          />
          {!hideSortDropdown && (
            <EvaluationsOverviewSortDropdown
              tableSort={tableSort}
              columns={selectedColumns}
              onChange={onSortChange}
              enableGrouping={shouldEnableTagGrouping()}
              isLoading={shouldDisplayLoadingState}
              isError={shouldDisplayErrorState}
            />
          )}

          <EvaluationsOverviewColumnSelectorGrouped
            columns={allColumns}
            selectedColumns={selectedColumns}
            toggleColumns={toggleColumns}
            setSelectedColumns={setSelectedColumns}
            isLoading={shouldDisplayLoadingState}
            isError={shouldDisplayErrorState}
          />
          {!isNil(textCellMaxLines) && setTextCellMaxLines && (
            <RowHeightToggle textCellMaxLines={textCellMaxLines} setTextCellMaxLines={setTextCellMaxLines} />
          )}
          {traceActions && experimentId && (
            <GenAITracesTableActions
              experimentId={experimentId}
              traceActions={traceActions}
              traceInfos={traceInfos}
              // prettier-ignore
            />
          )}
          {shouldEnableSessionGrouping() &&
            onToggleSessionGrouping &&
            !forceGroupBySession &&
            !hideGroupBySessionToggle && (
              <Tooltip
                componentId="mlflow.traces-table.group-by-session-button.tooltip"
                content={intl.formatMessage({
                  defaultMessage: 'Toggle session grouping',
                  description: 'Tooltip for the group by session button in the traces table toolbar',
                })}
              >
                <ToggleButton
                  componentId="mlflow.traces-table.group-by-session-button"
                  onPressedChange={onToggleSessionGrouping}
                  pressed={isGroupedBySession}
                  aria-label={intl.formatMessage({
                    defaultMessage: 'Toggle session grouping',
                    description: 'Aria label for the group by session button in the traces table toolbar',
                  })}
                >
                  <FormattedMessage
                    defaultMessage="Group by session"
                    description="Label for the group by session button in the traces table toolbar"
                  />
                </ToggleButton>
              </Tooltip>
            )}
          {shouldEnableIssueDetection() && onDetectIssues && (
            <DetectIssuesButton
              componentId={
                pageSource === 'experiment-traces'
                  ? 'mlflow.traces-table.detect-issues-button'
                  : pageSource === 'chat-sessions'
                    ? 'mlflow.chat-sessions.detect-issues-button'
                    : 'mlflow.run-view-traces.detect-issues-button'
              }
              onClick={onDetectIssues}
            />
          )}
          {onRefresh && (
            <Tooltip
              componentId="mlflow.traces-table.refresh-button.tooltip"
              content={intl.formatMessage({
                defaultMessage: 'Refresh traces',
                description: 'Tooltip for the refresh traces button in the traces table toolbar',
              })}
            >
              <Button
                componentId="mlflow.traces-table.refresh-button"
                icon={<RefreshIcon />}
                onClick={onRefresh}
                loading={isRefreshing}
                aria-label={intl.formatMessage({
                  defaultMessage: 'Refresh traces',
                  description: 'Aria label for the refresh traces button in the traces table toolbar',
                })}
              />
            </Tooltip>
          )}
          {addons}
        </TableFilterLayout>
        <SampledInfoBadge countInfo={countInfo} />
      </div>
    );
  },
);

const RowHeightToggle = ({
  textCellMaxLines,
  setTextCellMaxLines,
}: {
  textCellMaxLines: number;
  setTextCellMaxLines: (maxLines: number) => void;
}) => {
  const intl = useIntl();
  const value = textCellMaxLines > COMPACT_TEXT_CELL_MAX_LINES ? ROW_HEIGHT_EXPANDED : ROW_HEIGHT_COMPACT;
  const compactRowsLabel = intl.formatMessage({
    defaultMessage: 'Compact rows',
    description: 'Aria label for compact row height in the traces table',
  });
  const expandedRowsLabel = intl.formatMessage({
    defaultMessage: 'Expanded rows',
    description: 'Aria label for expanded row height in the traces table',
  });

  return (
    <SegmentedControlGroup
      name="mlflow-traces-table-row-height"
      componentId="mlflow.traces-table.row-height-toggle"
      value={value}
      onChange={(event) => {
        setTextCellMaxLines(
          event.target.value === ROW_HEIGHT_EXPANDED ? EXPANDED_TEXT_CELL_MAX_LINES : COMPACT_TEXT_CELL_MAX_LINES,
        );
      }}
    >
      <SegmentedControlButton
        value={ROW_HEIGHT_COMPACT}
        icon={<CompactRowsIcon />}
        title={compactRowsLabel}
        aria-label={compactRowsLabel}
      />
      <SegmentedControlButton
        value={ROW_HEIGHT_EXPANDED}
        icon={<ExpandedRowsIcon />}
        title={expandedRowsLabel}
        aria-label={expandedRowsLabel}
      />
    </SegmentedControlGroup>
  );
};

const SampledInfoBadge = (props: { countInfo: CountInfo }) => {
  const { countInfo } = props;
  const intl = useIntl();
  const { theme } = useDesignSystemTheme();

  if (countInfo.logCountLoading || isNil(countInfo.currentCount)) {
    return <Spinner size="small" />;
  }

  return (
    <div
      css={{
        display: 'flex',
        alignItems: 'center',
        gap: theme.spacing.sm,
      }}
    >
      {countInfo.currentCount >= countInfo.maxAllowedCount && (
        <Tooltip
          componentId="mlflow.experiment_list_view.max_traces.tooltip"
          content={intl.formatMessage(
            {
              defaultMessage: 'Only the top {evalResultsCount} results are shown',
              description: 'Evaluation review > evaluations list > sample info tooltip',
            },
            {
              evalResultsCount: countInfo.maxAllowedCount,
            },
          )}
        >
          <WarningIcon color="warning" />
        </Tooltip>
      )}
      <Typography.Hint>
        {intl.formatMessage(
          {
            defaultMessage: '{numFilteredEvals} of {numEvals}',
            description: 'Text displayed when showing a filtered subset evaluations in the evaluation review page',
          },
          {
            // Sometimes the api returns more than the max allowed count. To avoid confusion, we show the max allowed count.
            numFilteredEvals:
              countInfo.currentCount >= countInfo.maxAllowedCount ? countInfo.maxAllowedCount : countInfo.currentCount,
            numEvals:
              countInfo.totalCount >= countInfo.maxAllowedCount
                ? `${countInfo.maxAllowedCount}+`
                : countInfo.totalCount,
          },
        )}
      </Typography.Hint>
    </div>
  );
};
