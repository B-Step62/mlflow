import {
  Button,
  ChevronDownIcon,
  ColumnsIcon,
  DialogCombobox,
  DialogComboboxContent,
  DialogComboboxCustomButtonTriggerWrapper,
  DialogComboboxOptionList,
  DialogComboboxOptionListCheckboxItem,
  DialogComboboxOptionListSelectItem,
  DialogComboboxSectionHeader,
  Spacer,
  useDesignSystemTheme,
} from '@databricks/design-system';
import { FormattedMessage, useIntl } from 'react-intl';
import { type RecordColumnId } from '../utils/constants';

interface DatasetRecordsColumnSelectorProps {
  visibleColumns: RecordColumnId[];
  onToggleColumn: (column: RecordColumnId) => void;
  onResetToDefaults: () => void;
}

interface ColumnOption {
  id: RecordColumnId;
  label: React.ReactNode;
}

// Adding a column to `RecordColumnId` triggers a TypeScript exhaustiveness check on this array.
const COLUMN_OPTIONS: ReadonlyArray<ColumnOption> = [
  {
    id: 'dataset_record_id',
    label: (
      <FormattedMessage
        defaultMessage="Record ID"
        description="Column selector label for the dataset record id column"
      />
    ),
  },
  {
    id: 'inputs',
    label: <FormattedMessage defaultMessage="Inputs" description="Column selector label for the inputs column" />,
  },
  {
    id: 'expectations',
    label: (
      <FormattedMessage defaultMessage="Expectations" description="Column selector label for the expectations column" />
    ),
  },
  {
    id: 'create_time',
    label: <FormattedMessage defaultMessage="Created" description="Column selector label for the create-time column" />,
  },
  {
    id: 'created_by',
    label: (
      <FormattedMessage defaultMessage="Created by" description="Column selector label for the created-by column" />
    ),
  },
  {
    id: 'source',
    label: <FormattedMessage defaultMessage="Source" description="Column selector label for the source column" />,
  },
  {
    id: 'last_updated',
    label: (
      <FormattedMessage defaultMessage="Last updated" description="Column selector label for the last-updated column" />
    ),
  },
  {
    id: 'last_updated_by',
    label: (
      <FormattedMessage
        defaultMessage="Last updated by"
        description="Column selector label for the last-updated-by column"
      />
    ),
  },
  {
    id: 'tags',
    label: <FormattedMessage defaultMessage="Tags" description="Column selector label for the tags column" />,
  },
];

export const DatasetRecordsColumnSelector = ({
  visibleColumns,
  onToggleColumn,
  onResetToDefaults,
}: DatasetRecordsColumnSelectorProps) => {
  const intl = useIntl();
  const { theme } = useDesignSystemTheme();
  const isVisible = (column: RecordColumnId) => visibleColumns.includes(column);

  return (
    <DialogCombobox
      componentId="mlflow.eval-datasets-v2.records.column-selector"
      value={visibleColumns}
      label={intl.formatMessage({
        defaultMessage: 'Columns',
        description: 'Label for the V2 dataset records table column selector',
      })}
      multiSelect
    >
      <DialogComboboxCustomButtonTriggerWrapper>
        <Button
          componentId="mlflow.eval-datasets-v2.records.column-selector.trigger"
          endIcon={<ChevronDownIcon />}
          aria-label={intl.formatMessage({
            defaultMessage: 'Select visible columns',
            description: 'Aria label for the column-selector dropdown trigger on the V2 dataset records page',
          })}
        >
          <span css={{ display: 'inline-flex', alignItems: 'center', gap: theme.spacing.sm }}>
            <ColumnsIcon />
            <FormattedMessage
              defaultMessage="Columns"
              description="Column-selector trigger label on the V2 dataset records page"
            />
            <span
              css={{
                color: theme.colors.textSecondary,
                fontSize: theme.typography.fontSizeSm,
                lineHeight: theme.typography.lineHeightSm,
              }}
            >
              {visibleColumns.length}
            </span>
          </span>
        </Button>
      </DialogComboboxCustomButtonTriggerWrapper>
      <DialogComboboxContent>
        <DialogComboboxOptionList>
          <Spacer size="xs" />
          <DialogComboboxSectionHeader>
            <FormattedMessage
              defaultMessage="Record columns"
              description="Section header for dataset record columns in the column selector"
            />
          </DialogComboboxSectionHeader>
          {COLUMN_OPTIONS.map(({ id, label }) => (
            <DialogComboboxOptionListCheckboxItem
              key={id}
              value={id}
              checked={isVisible(id)}
              onChange={() => onToggleColumn(id)}
            >
              {label}
            </DialogComboboxOptionListCheckboxItem>
          ))}
          <Spacer size="xs" />
          <DialogComboboxOptionListSelectItem
            value="__reset_to_defaults__"
            checked={false}
            onChange={onResetToDefaults}
          >
            <FormattedMessage
              defaultMessage="Reset to defaults"
              description="Menu item that resets the dataset records column visibility AND widths to defaults"
            />
          </DialogComboboxOptionListSelectItem>
        </DialogComboboxOptionList>
      </DialogComboboxContent>
    </DialogCombobox>
  );
};
