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
}: ExperimentInsightsTableProps) => {
  const { theme } = useDesignSystemTheme();

  const rows = useMemo(() => runs.map((run) => buildRow(run)), [runs]);

  const columns = useMemo<InsightsColumnDef[]>(
    () => [
      {
        id: 'status',
        header: (
          <FormattedMessage defaultMessage="Status" description="Experiment insights table status column header" />
        ),
        accessorKey: 'status',
        cell: ({ row }) => (
          <div css={{ display: 'flex', alignItems: 'center', gap: theme.spacing.xs }}>
            <RunStatusIcon status={row.original.status || ''} />
          </div>
        ),
        meta: { styles: { width: 60, maxWidth: 60 } },
      },
      {
        id: 'name',
        header: <FormattedMessage defaultMessage="Name" description="Experiment insights table name header" />,
        accessorKey: 'name',
        cell: ({ row }) => (
          <Link to={Routes.getRunPageRoute(row.original.experimentId, row.original.runUuid)}>
            {row.original.name}
          </Link>
        ),
        meta: { styles: { minWidth: 200, flex: 1 } },
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
        meta: { styles: { minWidth: 240, flex: 2 } },
      },
      {
        id: 'traceCount',
        header: (
          <FormattedMessage defaultMessage="Trace Count" description="Experiment insights trace count header" />
        ),
        accessorKey: 'traceCountLabel',
        cell: ({ row }) => <Typography.Text>{row.original.traceCountLabel}</Typography.Text>,
        meta: { styles: { width: 140 } },
      },
      {
        id: 'createdAt',
        header: (
          <FormattedMessage defaultMessage="Time Created" description="Experiment insights created at header" />
        ),
        accessorKey: 'createdAtLabel',
        cell: ({ row }) => <Typography.Text>{row.original.createdAtLabel}</Typography.Text>,
        meta: { styles: { width: 200 } },
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
        meta: { styles: { minWidth: 160, flex: 1 } },
      },
    ],
    [theme.spacing.xs],
  );

  const table = useReactTable({
    data: rows,
    columns,
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
    <div css={{ display: 'flex', flexDirection: 'column', gap: theme.spacing.md }}>
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
