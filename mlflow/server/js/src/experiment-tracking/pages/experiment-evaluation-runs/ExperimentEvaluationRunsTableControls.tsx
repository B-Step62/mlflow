import {
  useDesignSystemTheme,
  Button,
  ChevronDownIcon,
  ColumnsIcon,
  DialogCombobox,
  DialogComboboxContent,
  DialogComboboxCustomButtonTriggerWrapper,
  DialogComboboxOptionList,
  DialogComboboxOptionListCheckboxItem,
  DialogComboboxOptionListSelectItem,
  FilterIcon,
  PlusMinusSquareIcon,
  DialogComboboxSectionHeader,
  Spacer,
  Tooltip,
  XCircleFillIcon,
} from '@databricks/design-system';
import type { RowSelectionState } from '@tanstack/react-table';
import { FormattedMessage, useIntl } from 'react-intl';
import type { RunEntity } from '../../types';
import { Fragment, useCallback, useMemo } from 'react';
import type { EvalRunsTableColumnId } from './ExperimentEvaluationRunsTable.constants';
import {
  EVAL_RUNS_COLUMN_LABELS,
  EVAL_RUNS_COLUMN_TYPE_LABELS,
  EVAL_RUNS_UNSELECTABLE_COLUMNS,
  EvalRunsTableKeyedColumnPrefix,
} from './ExperimentEvaluationRunsTable.constants';
import { parseEvalRunsTableKeyedColumnKey } from './ExperimentEvaluationRunsTable.utils';
import { groupBy } from 'lodash';
import { ExperimentEvaluationRunsTableActions } from './ExperimentEvaluationRunsTableActions';
import {
  MLFLOW_RUN_TYPE_TAG,
  MLFLOW_RUN_TYPE_VALUE_ISSUE_DETECTION,
  MLFLOW_RUN_TYPE_VALUE_TEST,
} from '../../constants';

const ALL_RUNS_FILTER_VALUE = '__all__';

const RUN_FILTER_OPTIONS = [
  {
    value: ALL_RUNS_FILTER_VALUE,
    filter: '',
    label: <FormattedMessage defaultMessage="All runs" description="Filter option for all evaluation runs" />,
  },
  {
    value: "attributes.status = 'FINISHED'",
    filter: "attributes.status = 'FINISHED'",
    label: <FormattedMessage defaultMessage="Finished" description="Filter option for finished evaluation runs" />,
  },
  {
    value: "attributes.status = 'FAILED'",
    filter: "attributes.status = 'FAILED'",
    label: <FormattedMessage defaultMessage="Failed" description="Filter option for failed evaluation runs" />,
  },
  {
    value: "attributes.status = 'RUNNING'",
    filter: "attributes.status = 'RUNNING'",
    label: <FormattedMessage defaultMessage="Running" description="Filter option for running evaluation runs" />,
  },
  {
    value: `tags.\`${MLFLOW_RUN_TYPE_TAG}\` = '${MLFLOW_RUN_TYPE_VALUE_TEST}'`,
    filter: `tags.\`${MLFLOW_RUN_TYPE_TAG}\` = '${MLFLOW_RUN_TYPE_VALUE_TEST}'`,
    label: <FormattedMessage defaultMessage="Test runs" description="Filter option for test evaluation runs" />,
  },
  {
    value: `tags.\`${MLFLOW_RUN_TYPE_TAG}\` = '${MLFLOW_RUN_TYPE_VALUE_ISSUE_DETECTION}'`,
    filter: `tags.\`${MLFLOW_RUN_TYPE_TAG}\` = '${MLFLOW_RUN_TYPE_VALUE_ISSUE_DETECTION}'`,
    label: (
      <FormattedMessage
        defaultMessage="Issue detection"
        description="Filter option for issue-detection evaluation runs"
      />
    ),
  },
];

export const ExperimentEvaluationRunsTableControls = ({
  rowSelection,
  setRowSelection,
  refetchRuns,
  runs,
  searchFilter,
  setSearchFilter,
  selectedColumns,
  setSelectedColumns,
  onCompare,
  setIsComparisonMode,
}: {
  rowSelection: RowSelectionState;
  setRowSelection: (selection: RowSelectionState) => void;
  runs: RunEntity[];
  refetchRuns: () => void;
  searchFilter: string;
  setSearchFilter: (filter: string) => void;
  selectedColumns: { [key: string]: boolean };
  setSelectedColumns: (columns: { [key: string]: boolean }) => void;
  onCompare: (runUuids: string[]) => void;
  setIsComparisonMode: (isComparisonMode: boolean) => void;
}) => {
  const intl = useIntl();
  const { theme } = useDesignSystemTheme();

  const selectedRunUuids = Object.entries(rowSelection)
    .filter(([_, value]) => value)
    .map(([key]) => key);

  const columnPartitions = useMemo(
    () =>
      groupBy(
        Object.entries(selectedColumns),
        ([columnId]) =>
          parseEvalRunsTableKeyedColumnKey(columnId)?.columnType ?? EvalRunsTableKeyedColumnPrefix.ATTRIBUTE,
      ),
    [selectedColumns],
  );

  // Comparison isn't supported for regression-test runs (the per-test Result
  // column and test-case drawer are single-run concepts), so don't let a compare
  // be initiated when one is selected.
  const hasRegressionTestRunSelected = runs.some(
    (run) =>
      selectedRunUuids.includes(run.info.runUuid) &&
      (run.data?.tags ?? []).some((tag) => tag.key === MLFLOW_RUN_TYPE_TAG && tag.value === MLFLOW_RUN_TYPE_VALUE_TEST),
  );
  const isCompareEnabled = selectedRunUuids.length >= 2 && !hasRegressionTestRunSelected;
  const activeFilterOption =
    RUN_FILTER_OPTIONS.find((option) => option.filter === searchFilter) ?? RUN_FILTER_OPTIONS[0];
  const hasActiveFilter = Boolean(searchFilter);
  const selectedColumnCount = Object.values(selectedColumns).filter(Boolean).length;

  const handleCompareClick = useCallback(() => {
    if (selectedRunUuids.length >= 2) {
      onCompare(selectedRunUuids);
      setIsComparisonMode(true);
    }
  }, [selectedRunUuids, onCompare, setIsComparisonMode]);

  return (
    <div
      css={{
        display: 'flex',
        gap: theme.spacing.sm,
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'nowrap',
        minWidth: 0,
      }}
    >
      <div css={{ display: 'flex', gap: theme.spacing.sm, alignItems: 'center', minWidth: 0 }}>
        <DialogCombobox
          componentId="mlflow.eval-runs.filter-by"
          value={[searchFilter || ALL_RUNS_FILTER_VALUE]}
          label={
            <FormattedMessage defaultMessage="Filter by" description="Label for evaluation runs filter-by dropdown" />
          }
        >
          <DialogComboboxCustomButtonTriggerWrapper>
            <Button
              componentId="mlflow.eval-runs.filter-by-trigger"
              endIcon={<ChevronDownIcon />}
              css={{
                flexShrink: 0,
                border: hasActiveFilter ? `1px solid ${theme.colors.actionDefaultBorderFocus} !important` : undefined,
                backgroundColor: hasActiveFilter
                  ? `${theme.colors.actionDefaultBackgroundHover} !important`
                  : undefined,
              }}
            >
              <span css={{ display: 'inline-flex', alignItems: 'center', gap: theme.spacing.sm }}>
                <FilterIcon />
                {hasActiveFilter ? (
                  activeFilterOption.label
                ) : (
                  <FormattedMessage
                    defaultMessage="Filter by"
                    description="Button label for evaluation runs filter-by dropdown"
                  />
                )}
                {hasActiveFilter && (
                  <XCircleFillIcon
                    css={{
                      fontSize: 12,
                      cursor: 'pointer',
                      color: theme.colors.grey400,
                      '&:hover': {
                        color: theme.colors.grey600,
                      },
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                      e.preventDefault();
                      setSearchFilter('');
                    }}
                  />
                )}
              </span>
            </Button>
          </DialogComboboxCustomButtonTriggerWrapper>
          <DialogComboboxContent>
            <DialogComboboxOptionList>
              {RUN_FILTER_OPTIONS.map((option) => (
                <DialogComboboxOptionListSelectItem
                  key={option.value}
                  value={option.value}
                  checked={(searchFilter || ALL_RUNS_FILTER_VALUE) === option.value}
                  onChange={() => setSearchFilter(option.filter)}
                >
                  {option.label}
                </DialogComboboxOptionListSelectItem>
              ))}
            </DialogComboboxOptionList>
          </DialogComboboxContent>
        </DialogCombobox>
        <DialogCombobox componentId="mlflow.eval-runs.table-column-selector" label="Columns" multiSelect>
          <DialogComboboxCustomButtonTriggerWrapper>
            <Button
              componentId="mlflow.eval-runs.table-column-selector-trigger"
              endIcon={<ChevronDownIcon />}
              css={{ flexShrink: 0 }}
            >
              <span css={{ display: 'inline-flex', alignItems: 'center', gap: theme.spacing.sm }}>
                <ColumnsIcon />
                <FormattedMessage defaultMessage="Columns" description="Evaluation runs columns dropdown label" />
                <span
                  css={{
                    color: theme.colors.textSecondary,
                    fontSize: theme.typography.fontSizeSm,
                    lineHeight: theme.typography.lineHeightSm,
                  }}
                >
                  {selectedColumnCount}
                </span>
              </span>
            </Button>
          </DialogComboboxCustomButtonTriggerWrapper>
          <DialogComboboxContent>
            <DialogComboboxOptionList>
              {Object.entries(columnPartitions).map(([columnType, columns]) => {
                if (!columns.length) {
                  return null;
                }
                const headerLabelDescriptor =
                  EVAL_RUNS_COLUMN_TYPE_LABELS[columnType as EvalRunsTableKeyedColumnPrefix];
                return (
                  <Fragment key={columnType}>
                    <Spacer size="xs" />
                    <DialogComboboxSectionHeader>
                      {headerLabelDescriptor ? intl.formatMessage(headerLabelDescriptor) : columnType}
                    </DialogComboboxSectionHeader>
                    {columns.map(([column, selected]) => {
                      const labelDescriptorForKnownColumn = EVAL_RUNS_COLUMN_LABELS[column as EvalRunsTableColumnId];
                      const label = labelDescriptorForKnownColumn
                        ? intl.formatMessage(labelDescriptorForKnownColumn)
                        : (parseEvalRunsTableKeyedColumnKey(column)?.key ?? column);

                      if (EVAL_RUNS_UNSELECTABLE_COLUMNS.has(column)) {
                        return null;
                      }

                      return (
                        <DialogComboboxOptionListCheckboxItem
                          key={column}
                          value={column}
                          onChange={() => {
                            const newSelectedColumns = { ...selectedColumns };
                            newSelectedColumns[column] = !selected;
                            setSelectedColumns(newSelectedColumns);
                          }}
                          checked={selected}
                        >
                          {label}
                        </DialogComboboxOptionListCheckboxItem>
                      );
                    })}
                  </Fragment>
                );
              })}
            </DialogComboboxOptionList>
          </DialogComboboxContent>
        </DialogCombobox>
      </div>
      <div css={{ display: 'flex', gap: theme.spacing.sm, alignItems: 'center', flexShrink: 0 }}>
        <Tooltip
          componentId="mlflow.eval-runs.compare-button.tooltip"
          content={
            isCompareEnabled ? (
              <FormattedMessage
                defaultMessage="Compare selected runs"
                description="Tooltip for the compare button when enabled"
              />
            ) : selectedRunUuids.length === 0 ? (
              <FormattedMessage
                defaultMessage="Select runs"
                description="Tooltip for the compare button when no evaluation runs are selected"
              />
            ) : hasRegressionTestRunSelected ? (
              <FormattedMessage
                defaultMessage="Comparison isn't available for regression-test runs"
                description="Tooltip for the compare button when a regression-test run is selected"
              />
            ) : (
              <FormattedMessage
                defaultMessage="Select at least 2 runs"
                description="Tooltip for the compare button when fewer than two evaluation runs are selected"
              />
            )
          }
        >
          <Button
            componentId="mlflow.eval-runs.compare-button"
            onClick={handleCompareClick}
            disabled={!isCompareEnabled}
            icon={<PlusMinusSquareIcon />}
          >
            <FormattedMessage defaultMessage="Compare" description="Compare runs button label" />
          </Button>
        </Tooltip>

        <ExperimentEvaluationRunsTableActions
          rowSelection={rowSelection}
          setRowSelection={setRowSelection}
          refetchRuns={refetchRuns}
        />
      </div>
    </div>
  );
};
