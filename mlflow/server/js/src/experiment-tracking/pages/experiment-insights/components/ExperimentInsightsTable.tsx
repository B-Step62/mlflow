import {
  Button,
  Empty,
  LegacyTooltip,
  Table,
  TableCell,
  TableHeader,
  TableRow,
  TableSkeletonRows,
  Tag,
  Typography,
  useDesignSystemTheme,
  DropdownMenu,
  TableRowAction,
  ColumnsIcon,
  ListBorderIcon,
} from '@databricks/design-system';
import type { Interpolation, Theme } from '@emotion/react';
import type { ColumnDef } from '@tanstack/react-table';
import { flexRender, getCoreRowModel, useReactTable } from '@tanstack/react-table';
import { useMemo, type MouseEvent } from 'react';
import { FormattedMessage } from 'react-intl';
import { Link } from '../../../../common/utils/RoutingUtils';
import Routes from '../../../routes';
import { RunStatusIcon } from '../../../components/RunStatusIcon';
import type { RunEntity } from '../../../types';
import Utils from '../../../../common/utils/Utils';
import {
  INSIGHT_FILTERS_TAG,
  INSIGHT_OVERVIEW_TAG,
  INSIGHT_PROMPT_TAG,
  INSIGHT_TRACE_COUNT_TAG,
  parseInsightFiltersTag,
  toTagValueMap,
} from '../utils';

export interface ExperimentInsightsTableProps {
  runs: RunEntity[];
  loading?: boolean;
  selectedRunUuid?: string;
  onSelect: (runUuid: string) => void;
  onCreateInsight?: () => void;
  // UI enhancements
  filterText?: string;
  sortBy?: 'createdAtDesc' | 'createdAtAsc' | 'nameAsc' | 'nameDesc' | 'traceCountDesc' | 'traceCountAsc';
  hiddenColumns?: string[];
  toggleHiddenColumn?: (columnId: string) => void;
}

type InsightRow = {
  run: RunEntity;
  runUuid: string;
  experimentId: string;
  status?: string;
  name: string;
  instruction?: string;
  overview?: string;
  traceCountLabel: string;
  traceCount?: number | null;
  createdAtLabel: string;
  filters: string[];
};

type InsightsColumnDef = ColumnDef<InsightRow> & {
  meta?: { styles?: Interpolation<Theme> };
};

const buildRow = (run: RunEntity): InsightRow => {
  const tags = toTagValueMap(run.data?.tags ?? []);
  const instruction = tags[INSIGHT_PROMPT_TAG];
  const overview = tags[INSIGHT_OVERVIEW_TAG];
  const traceCountRaw = tags[INSIGHT_TRACE_COUNT_TAG];
  const traceCountLabel =
    typeof traceCountRaw === 'string' && traceCountRaw.trim().length > 0
      ? Number.isNaN(Number(traceCountRaw))
        ? traceCountRaw
        : Number(traceCountRaw).toLocaleString()
      : '—';
  const traceCount =
    typeof traceCountRaw === 'string' && traceCountRaw.trim().length > 0 && !Number.isNaN(Number(traceCountRaw))
      ? Number(traceCountRaw)
      : null;
  const createdAtLabel = run.info.startTime ? Utils.formatTimestamp(run.info.startTime) : '—';
  const filters = parseInsightFiltersTag(tags[INSIGHT_FILTERS_TAG]);

  return {
    run,
    runUuid: run.info.runUuid,
    experimentId: run.info.experimentId,
    status: run.info.status,
    name: run.info.runName || run.info.runUuid,
    instruction,
    overview,
    traceCountLabel,
    traceCount,
    createdAtLabel,
    filters,
  };
};

export const ExperimentInsightsTable = ({
  runs,
  loading,
  selectedRunUuid,
  onSelect,
  onCreateInsight,
  filterText,
  sortBy = 'createdAtDesc',
  hiddenColumns = [],
  toggleHiddenColumn,
}: ExperimentInsightsTableProps) => {
  const { theme } = useDesignSystemTheme();

  const rows = useMemo(() => {
    // Build base rows
    const base = runs.map((run) => buildRow(run));
    // Filter by simple substring across name, overview, instruction and filters
    const filtered = (filterText || '').trim()
      ? base.filter((r) => {
          const q = (filterText || '').toLowerCase();
          return (
            r.name.toLowerCase().includes(q) ||
            (r.instruction || '').toLowerCase().includes(q) ||
            (r.overview || '').toLowerCase().includes(q) ||
            r.filters.some((f) => f.toLowerCase().includes(q))
          );
        })
      : base;
    // Sort
    const sorted = [...filtered].sort((a, b) => {
      switch (sortBy) {
        case 'createdAtAsc':
          return (a.run.info.startTime || 0) - (b.run.info.startTime || 0);
        case 'nameAsc':
          return a.name.localeCompare(b.name);
        case 'nameDesc':
          return b.name.localeCompare(a.name);
        case 'traceCountAsc':
          return (a.traceCount ?? -Infinity) - (b.traceCount ?? -Infinity);
        case 'traceCountDesc':
          return (b.traceCount ?? -Infinity) - (a.traceCount ?? -Infinity);
        case 'createdAtDesc':
        default:
          return (b.run.info.startTime || 0) - (a.run.info.startTime || 0);
      }
    });
    return sorted;
  }, [runs, filterText, sortBy]);

  const columns = useMemo<InsightsColumnDef[]>(
    () => [
      {
        id: 'status',
        header: (
          <FormattedMessage defaultMessage="Status" description="Experiment insights table status column header" />
        ),
        accessorKey: 'status',
        cell: ({ row }) => (
          <div css={{ display: 'flex', alignItems: 'center', justifyContent: 'center'}}>
            <RunStatusIcon status={row.original.status || ''} />
          </div>
        ),
        meta: { styles: { width: 60, maxWidth: 60, alignItems: 'center' } },
      },
      {
        id: 'name',
        header: <FormattedMessage defaultMessage="Name" description="Experiment insights table name header" />,
        accessorKey: 'name',
        cell: ({ row }) => (
          <Link to={Routes.getRunPageRoute(row.original.experimentId, row.original.runUuid)} css={{ height: '100%' }}>
            {row.original.name}
          </Link>
        ),
        meta: { styles: { minWidth: 240, maxWidth: 240, alignItems: 'center' } },
      },
      {
        id: 'overview',
        header: <FormattedMessage defaultMessage="Overview" description="Experiment insights overview header" />,
        accessorKey: 'overview',
        cell: ({ row }) =>
          row.original.overview ? (
            <LegacyTooltip title={row.original.overview}>
              <Typography.Text ellipsis>{row.original.overview}</Typography.Text>
            </LegacyTooltip>
          ) : (
            <Typography.Text type="secondary">—</Typography.Text>
          ),
        meta: { styles: { alignItems: 'center' } },
      },
      {
        id: 'traceCount',
        header: (
          <FormattedMessage defaultMessage="Trace Count" description="Experiment insights trace count header" />
        ),
        accessorKey: 'traceCountLabel',
        cell: ({ row }) => (
          <div
            css={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: theme.spacing.xs,
              padding: `${theme.spacing.xs}px ${theme.spacing.xs}px`,
              backgroundColor: theme.colors.backgroundSecondary,
              borderRadius: theme.borders.borderRadiusSm,
            }}
          >
            <ListBorderIcon css={{ color: theme.colors.textSecondary, fontSize: 14 }} />
            <Typography.Text>{row.original.traceCountLabel}</Typography.Text>
          </div>
        ),
        meta: { styles: { width: 140, maxWidth: 140, alignItems: 'center' } },
      },
      {
        id: 'createdAt',
        header: (
          <FormattedMessage defaultMessage="Time Created" description="Experiment insights created at header" />
        ),
        accessorKey: 'createdAtLabel',
        cell: ({ row }) => <Typography.Text>{row.original.createdAtLabel}</Typography.Text>,
        meta: { styles: { width: 200, maxWidth: 200, alignItems: 'center' } },
      },
      {
        id: 'filters',
        header: <FormattedMessage defaultMessage="Filters" description="Experiment insights filters header" />,
        accessorKey: 'filters',
        cell: ({ row }) =>
          row.original.filters.length ? (
            <div css={{ display: 'flex', gap: theme.spacing.xs, flexWrap: 'wrap' }}>
              {row.original.filters.map((filter) => (
                <Tag key={filter}>{filter}</Tag>
              ))}
            </div>
          ) : (
            <Typography.Text type="secondary">—</Typography.Text>
          ),
        meta: { styles: { minWidth: 160, alignItems: 'center' } },
      },
      {
        id: 'rowActions',
        header: '',
        cell: ({ row }) => (
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <Button
                size="small"
                type="link"
                aria-label="More actions"
                onClick={(e: React.MouseEvent<HTMLButtonElement>) => e.stopPropagation()}
                css={{ fontSize: 18, lineHeight: 1, padding: 0 }}
              >
                ⋯
              </Button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Content align="end" onClick={(e) => e.stopPropagation()}>
              <DropdownMenu.Item disabled>Coming soon</DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Root>
        ),
        meta: { styles: { width: 56, maxWidth: 56, textAlign: 'right' as const, alignItems: 'center' } },
      },
    ],
    [theme.spacing.xs, theme.colors.backgroundSecondary, theme.colors.textSecondary, theme.borders.borderRadiusSm],
  );

  const table = useReactTable({
    data: rows,
    columns: columns.filter((c) => !hiddenColumns.includes(c.id as string)),
    getCoreRowModel: getCoreRowModel(),
    getRowId: (row) => row.runUuid,
  });

  const isEmpty = !loading && table.getRowModel().rows.length === 0;

  const emptyComponent = (
    <Empty
      description={
        <FormattedMessage
          defaultMessage="No insights yet"
          description="Experiment insights table empty state description"
        />
      }
    />
  );

  return (
    <div css={{ display: 'flex', flexDirection: 'column', gap: theme.spacing.md, height: '100%' }}>
      <Table scrollable empty={isEmpty ? emptyComponent : undefined}>
        <TableRow isHeader>
          {table.getLeafHeaders().map((header) => (
            <TableHeader
              componentId="experiment-insights-table-header"
              key={header.id}
              css={(header.column.columnDef as InsightsColumnDef).meta?.styles}
            >
              {flexRender(header.column.columnDef.header, header.getContext())}
            </TableHeader>
          ))}
          {toggleHiddenColumn && (
            <TableRowAction>
              <DropdownMenu.Root>
                <DropdownMenu.Trigger asChild>
                  <Button
                    componentId="experiment-insights-table.column_selector_dropdown"
                    icon={<ColumnsIcon />}
                    size="small"
                    aria-label="Select columns"
                  />
                </DropdownMenu.Trigger>
                <DropdownMenu.Content align="end">
                  {columns.map(({ id, header }) => (
                    <DropdownMenu.CheckboxItem
                      key={id as string}
                      componentId="experiment-insights-table.column_toggle_button"
                      checked={!hiddenColumns.includes(id as string)}
                      onClick={() => toggleHiddenColumn(id as string)}
                    >
                      <DropdownMenu.ItemIndicator />
                      {flexRender(header, { table } as any)}
                    </DropdownMenu.CheckboxItem>
                  ))}
                </DropdownMenu.Content>
              </DropdownMenu.Root>
            </TableRowAction>
          )}
        </TableRow>
        {loading ? (
          <TableSkeletonRows table={table} />
        ) : (
          table.getRowModel().rows.map((row) => (
            <TableRow
              key={row.id}
              onClick={() => onSelect(row.original.runUuid)}
              css={{
                cursor: 'pointer',
                backgroundColor:
                  row.original.runUuid === selectedRunUuid
                    ? theme.colors.primaryBackgroundHover
                    : theme.colors.backgroundPrimary,
                '&:hover': {
                  backgroundColor: theme.colors.primaryBackgroundHover,
                },
              }}
            >
              {row.getVisibleCells().map((cell) => (
                <TableCell key={cell.id} css={(cell.column.columnDef as InsightsColumnDef).meta?.styles}>
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </TableCell>
              ))}
            </TableRow>
          ))
        )}
      </Table>
    </div>
  );
};
