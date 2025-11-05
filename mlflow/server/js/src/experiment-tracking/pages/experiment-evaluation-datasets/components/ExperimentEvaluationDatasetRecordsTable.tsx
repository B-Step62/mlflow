import { useEffect, useMemo, useState } from 'react';
import { useGetDatasetRecords } from '../hooks/useGetDatasetRecords';
import { ColumnDef, flexRender, getCoreRowModel, useReactTable } from '@tanstack/react-table';
import { Empty, TableCell, TableHeader, TableRow, TableSkeletonRows, useDesignSystemTheme } from '@databricks/design-system';
import { Table } from '@databricks/design-system';
import { useIntl } from 'react-intl';
import { JsonCell } from './ExperimentEvaluationDatasetJsonCell';
import { ExperimentEvaluationDatasetRecordsToolbar } from './ExperimentEvaluationDatasetRecordsToolbar';
import { EvaluationDataset, EvaluationDatasetRecord } from '../types';
import { useInfiniteScrollFetch } from '../hooks/useInfiniteScrollFetch';

const INPUTS_COLUMN_ID = 'inputs';
const OUTPUTS_COLUMN_ID = 'outputs';
const EXPECTATIONS_COLUMN_ID = 'expectations';

// Render a single field value (stringify objects, handle nulls)
const FieldValueCell: ColumnDef<EvaluationDatasetRecord>['cell'] = ({ getValue }) => {
  const value = getValue<any>();
  if (value === null || value === undefined) return <span>-</span>;
  if (typeof value === 'object') return <span title={JSON.stringify(value)}>{JSON.stringify(value)}</span>;
  return <span title={String(value)}>{String(value)}</span>;
};

export const ExperimentEvaluationDatasetRecordsTable = ({ dataset }: { dataset: EvaluationDataset }) => {
  const intl = useIntl();
  const datasetId = dataset.dataset_id;
  const { theme } = useDesignSystemTheme();

  const [rowSize, setRowSize] = useState<'sm' | 'md' | 'lg'>('sm');
  const [columnVisibility, setColumnVisibility] = useState<Record<string, boolean>>({
    [INPUTS_COLUMN_ID]: true,
    [OUTPUTS_COLUMN_ID]: false,
    [EXPECTATIONS_COLUMN_ID]: true,
  });

  const {
    data: datasetRecords,
    isLoading,
    isFetching,
    error,
    fetchNextPage,
    hasNextPage,
  } = useGetDatasetRecords({
    datasetId: datasetId ?? '',
    enabled: !!datasetId,
  });

  const fetchMoreOnBottomReached = useInfiniteScrollFetch({
    isFetching,
    hasNextPage: hasNextPage ?? false,
    fetchNextPage,
  });

  // Build dynamic columns: expand inputs/expectations keys into sub-columns
  const dynamicColumns = useMemo(() => {
    const records = datasetRecords ?? [];
    const inputKeys = new Set<string>();
    const expectationKeys = new Set<string>();

    for (const rec of records) {
      if ((rec as any).inputs && typeof (rec as any).inputs === 'object') {
        Object.keys(rec.inputs).forEach((k) => inputKeys.add(k));
      }
      if ((rec as any).expectations && typeof (rec as any).expectations === 'object') {
        Object.keys(rec.expectations).forEach((k) => expectationKeys.add(k));
      }
    }

    // Inputs: group with keys or single column if no keys
    const inputColumns: ColumnDef<EvaluationDatasetRecord, any> =
      inputKeys.size > 0
        ? {
            id: INPUTS_COLUMN_ID,
            header: `Inputs (${inputKeys.size} ${inputKeys.size === 1 ? 'column' : 'columns'})`,
            columns: Array.from(inputKeys)
              .sort()
              .map((key) => ({
                id: `${INPUTS_COLUMN_ID}.${key}`,
                header: key,
                accessorFn: (row: EvaluationDatasetRecord) => (row as any).inputs?.[key],
                cell: JsonCell,
              })),
          }
        : {
            id: INPUTS_COLUMN_ID,
            header: 'Inputs',
            accessorFn: (row: EvaluationDatasetRecord) => (row as any).inputs,
            cell: JsonCell,
          };

    // Expectations: group with keys or single column if no keys
    const expectationsColumns: ColumnDef<EvaluationDatasetRecord, any> =
      expectationKeys.size > 0
        ? {
            id: EXPECTATIONS_COLUMN_ID,
            header: `Expectations (${expectationKeys.size} ${expectationKeys.size === 1 ? 'column' : 'columns'})`,
            columns: Array.from(expectationKeys)
              .sort()
              .map((key, index) => ({
                id: `${EXPECTATIONS_COLUMN_ID}.${key}`,
                header: key,
                accessorFn: (row: EvaluationDatasetRecord) => (row as any).expectations?.[key],
                cell: JsonCell,
                meta: { section: 'expectations', isFirstLeaf: index === 0 },
              })),
          }
        : {
            id: EXPECTATIONS_COLUMN_ID,
            header: 'Expectations',
            accessorFn: (row: EvaluationDatasetRecord) => (row as any).expectations,
            cell: JsonCell,
            meta: { section: 'expectations', isFirstLeaf: true },
          };

    // Outputs as a group with second header label "output"
    const outputsCol: ColumnDef<EvaluationDatasetRecord, any> = {
      id: OUTPUTS_COLUMN_ID,
      header: 'Outputs',
      columns: [
        {
          id: `${OUTPUTS_COLUMN_ID}.output`,
          header: 'output',
          accessorFn: (row: EvaluationDatasetRecord) => (row as any).outputs,
          cell: JsonCell,
          meta: { section: 'outputs', isFirstLeaf: true },
        },
      ],
    };

    // Order: Inputs group, Outputs, Expectations group
    return [inputColumns, outputsCol, expectationsColumns] as ColumnDef<EvaluationDatasetRecord, any>[];
  }, [datasetRecords]);

  // Flat leaf columns for column selector UI
  const flatLeafColumns = useMemo(() => {
    const collectLeaves = (cols: ColumnDef<EvaluationDatasetRecord, any>[]): ColumnDef<EvaluationDatasetRecord, any>[] => {
      const acc: ColumnDef<EvaluationDatasetRecord, any>[] = [];
      cols.forEach((c) => {
        // @ts-expect-error columns is allowed by react-table
        if (c.columns && Array.isArray(c.columns)) acc.push(...collectLeaves(c.columns));
        else acc.push(c);
      });
      return acc;
    };
    return collectLeaves(dynamicColumns);
  }, [dynamicColumns]);

  const table = useReactTable({
    columns: dynamicColumns,
    data: datasetRecords ?? [],
    getCoreRowModel: getCoreRowModel(),
    getRowId: (row) => row.dataset_record_id,
    enableColumnResizing: false,
    meta: { rowSize },
    state: {
      columnVisibility,
    },
  });

  // Ensure new dynamic columns become visible by default
  useEffect(() => {
    const nextState: Record<string, boolean> = { ...columnVisibility };
    flatLeafColumns.forEach((col) => {
      const id = col.id as string;
      if (!(id in nextState)) {
        nextState[id] = true;
      }
    });
    if (JSON.stringify(nextState) !== JSON.stringify(columnVisibility)) {
      setColumnVisibility(nextState);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flatLeafColumns]);

  return (
    <div
      css={{
        flex: 1,
        minHeight: 0,
        position: 'relative',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <ExperimentEvaluationDatasetRecordsToolbar
        dataset={dataset}
        datasetRecords={datasetRecords ?? []}
        columns={flatLeafColumns}
        columnVisibility={columnVisibility}
        setColumnVisibility={setColumnVisibility}
        rowSize={rowSize}
        setRowSize={setRowSize}
      />
      <Table
        css={{ flex: 1 }}
        empty={
          !isLoading && table.getRowModel().rows.length === 0 ? (
            <Empty
              description={intl.formatMessage({
                defaultMessage: 'No records found',
                description: 'Empty state for the evaluation dataset records table',
              })}
            />
          ) : undefined
        }
        scrollable
        onScroll={(e) => fetchMoreOnBottomReached(e.currentTarget as HTMLDivElement)}
      >
        {table.getHeaderGroups().map((headerGroup, depth) => (
          <TableRow isHeader key={headerGroup.id}>
            {headerGroup.headers.map((header) => {
              const colId = String(header.column.id);
              const isTopSectionHeader = depth === 0 && (colId === OUTPUTS_COLUMN_ID || colId === EXPECTATIONS_COLUMN_ID);
              const meta = (header.column.columnDef as any)?.meta || {};
              const isFirstLeaf = depth > 0 && meta?.isFirstLeaf && (meta?.section === 'outputs' || meta?.section === 'expectations');
              const isSectionBoundary = isTopSectionHeader || isFirstLeaf;
              return (
              <TableHeader
                key={header.id}
                componentId={`mlflow.eval-dataset-records.${header.column.id}-header`}
                header={header}
                column={header.column}
                css={{
                  position: 'sticky',
                  top: depth * 32,
                  zIndex: 1,
                  ...(depth > 0 && { color: theme.colors.textSecondary, fontWeight: 400 }),
                  ...(isSectionBoundary && { borderLeft: `1px solid ${theme.colors.border}` }),
                }}
              >
                {!header.isPlaceholder && (
                  depth > 0 ? (
                    <span css={{ fontWeight: 400 }}>{flexRender(header.column.columnDef.header, header.getContext())}</span>
                  ) : (
                    flexRender(header.column.columnDef.header, header.getContext())
                  )
                )}
              </TableHeader>
              );})}
          </TableRow>
        ))}
        {table.getRowModel().rows.map((row) => (
          <TableRow key={row.id}>
            {row.getVisibleCells().map((cell) => {
              const meta = (cell.column.columnDef as any)?.meta || {};
              const isSectionBoundary = meta?.isFirstLeaf && (meta?.section === 'outputs' || meta?.section === 'expectations');
              return (
                <TableCell key={cell.id} css={isSectionBoundary ? { borderLeft: `1px solid ${theme.colors.border}` } : undefined}>
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </TableCell>
              );
            })}
          </TableRow>
        ))}
        {(isLoading || isFetching) && <TableSkeletonRows table={table} />}
      </Table>
    </div>
  );
};
