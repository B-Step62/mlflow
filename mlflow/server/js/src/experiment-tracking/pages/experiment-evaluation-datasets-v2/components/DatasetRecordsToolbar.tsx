import { type RefObject } from 'react';
import {
  Button,
  Input,
  type InputRef,
  PlusIcon,
  SearchIcon,
  SegmentedControlButton,
  SegmentedControlGroup,
  TrashIcon,
  useDesignSystemTheme,
} from '@databricks/design-system';
import { FormattedMessage, useIntl } from 'react-intl';

export const DATASET_RECORD_COMPACT_TEXT_CELL_MAX_LINES = 1;
export const DATASET_RECORD_EXPANDED_TEXT_CELL_MAX_LINES = 5;

const ROW_HEIGHT_COMPACT = 'compact';
const ROW_HEIGHT_EXPANDED = 'expanded';
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

export const DatasetRecordsRowHeightToggle = ({
  textCellMaxLines,
  setTextCellMaxLines,
}: {
  textCellMaxLines: number;
  setTextCellMaxLines: (maxLines: number) => void;
}) => {
  const intl = useIntl();
  const value =
    textCellMaxLines > DATASET_RECORD_COMPACT_TEXT_CELL_MAX_LINES ? ROW_HEIGHT_EXPANDED : ROW_HEIGHT_COMPACT;
  const compactRowsLabel = intl.formatMessage({
    defaultMessage: 'Compact rows',
    description: 'Aria label for compact row height in the V2 dataset records table',
  });
  const expandedRowsLabel = intl.formatMessage({
    defaultMessage: 'Expanded rows',
    description: 'Aria label for expanded row height in the V2 dataset records table',
  });

  return (
    <SegmentedControlGroup
      name="mlflow-dataset-records-row-height"
      componentId="mlflow.eval-datasets-v2.records.row-height-toggle"
      value={value}
      onChange={(event) => {
        setTextCellMaxLines(
          event.target.value === ROW_HEIGHT_EXPANDED
            ? DATASET_RECORD_EXPANDED_TEXT_CELL_MAX_LINES
            : DATASET_RECORD_COMPACT_TEXT_CELL_MAX_LINES,
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

export interface DatasetRecordsToolbarProps {
  /** Local search input value. Owned by the controller's `useDebouncedSearchInput`. */
  searchInputValue: string;
  onSearchInputChange: (next: string) => void;
  onSearchClear: () => void;
  onRefresh: () => void;
  isRefreshing: boolean;
  /** Timestamp (ms) of the last successful records fetch — drives the refresh tooltip. */
  lastRefreshTime: number | undefined;
  onAddRecord: () => void;
  /** Slot for additional toolbar controls (column selector, etc.). */
  trailingControls?: React.ReactNode;
  /** Forwarded to the search Input so callers can focus it (e.g. via the "/" hotkey). */
  searchInputRef?: RefObject<InputRef>;
  /** Number of currently bulk-selected rows. When > 0, the inline selection group appears. */
  selectionCount: number;
  /** Invoked from the inline "Delete" action when rows are selected. */
  onBulkDelete: () => void;
  /** Invoked from the inline "Clear selection" action when rows are selected. */
  onBulkClear: () => void;
}

export const DatasetRecordsToolbar = ({
  searchInputValue,
  onSearchInputChange,
  onSearchClear,
  onRefresh,
  isRefreshing,
  lastRefreshTime,
  onAddRecord,
  trailingControls,
  searchInputRef,
  selectionCount,
  onBulkDelete,
  onBulkClear,
}: DatasetRecordsToolbarProps) => {
  const intl = useIntl();
  const { theme } = useDesignSystemTheme();
  const hasSelection = selectionCount > 0;

  return (
    <div
      css={{
        display: 'flex',
        alignItems: 'center',
        gap: theme.spacing.sm,
      }}
    >
      <Input
        ref={searchInputRef}
        componentId="mlflow.eval-datasets-v2.records.search"
        prefix={<SearchIcon />}
        allowClear
        value={searchInputValue}
        placeholder={intl.formatMessage({
          defaultMessage: 'Search inputs, expectations…',
          description: 'Placeholder for the search input on the V2 dataset records page',
        })}
        aria-label={intl.formatMessage({
          defaultMessage: 'Search records by inputs or expectations',
          description:
            'Aria label for the search input on the V2 dataset records page (placeholder is not a label per WCAG 1.3.1)',
        })}
        onChange={(e) => onSearchInputChange(e.target.value)}
        onClear={onSearchClear}
        css={{ maxWidth: 360 }}
      />
      {trailingControls}
      {hasSelection && (
        <div
          role="region"
          aria-label={intl.formatMessage({
            defaultMessage: 'Selected records',
            description: 'Aria label for the inline bulk-selection group on the V2 dataset records toolbar',
          })}
          css={{ display: 'flex', alignItems: 'center', gap: theme.spacing.sm }}
        >
          <Button
            componentId="mlflow.eval-datasets-v2.records.selection-toolbar.delete"
            icon={<TrashIcon />}
            type="primary"
            danger
            onClick={onBulkDelete}
            // The visible "Delete (N)" label changes as the user toggles rows;
            // `aria-live` here replaces the removed "N records selected" text
            // so assistive tech still announces the count update.
            aria-live="polite"
            aria-atomic="true"
          >
            <FormattedMessage
              defaultMessage="Delete ({count})"
              description="Delete button in the V2 dataset records inline bulk-selection group"
              values={{ count: selectionCount }}
            />
          </Button>
          <Button
            componentId="mlflow.eval-datasets-v2.records.selection-toolbar.clear"
            type="tertiary"
            onClick={onBulkClear}
          >
            <FormattedMessage
              defaultMessage="Clear selection"
              description="Clear-selection button in the V2 dataset records inline bulk-selection group"
            />
          </Button>
        </div>
      )}
      <div css={{ flex: 1 }} />
      <Button
        componentId="mlflow.eval-datasets-v2.records.add-record"
        type="primary"
        icon={<PlusIcon />}
        onClick={onAddRecord}
      >
        {intl.formatMessage({
          defaultMessage: 'Add record',
          description: 'Primary button text for adding a new dataset record on the V2 dataset records page',
        })}
      </Button>
    </div>
  );
};
