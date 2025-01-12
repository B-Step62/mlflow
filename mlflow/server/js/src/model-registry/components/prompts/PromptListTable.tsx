import {
  SearchIcon,
  Table,
  TableCell,
  TableHeader,
  TableRow,
  LegacyTooltip,
  Empty,
  PlusIcon,
  TableSkeletonRows,
  WarningIcon,
} from '@databricks/design-system';
import { Interpolation, Theme } from '@emotion/react';
import { ColumnDef, flexRender, getCoreRowModel, SortingState, useReactTable } from '@tanstack/react-table';
import { useMemo } from 'react';
import { FormattedMessage, useIntl } from 'react-intl';
import { Link } from '../../../common/utils/RoutingUtils';
import { PromptListTagsCell, PromptsListVersionLinkCell } from './PromptTableCellRenderers';
import Utils from '../../../common/utils/Utils';
import type { KeyValueEntity, PromptEntity, PromptVersionInfoEntity } from '../../../experiment-tracking/types';
import { ModelRegistryRoutes } from '../../routes';
import { useNextModelsUIContext } from '../../hooks/useNextModelsUI';


enum ColumnKeys {
  NAME = 'name',
  DESCRIPTION = 'description',
  LATEST_VERSION = 'latest_version',
  LAST_MODIFIED = 'timestamp',
  TAGS = 'tags',
}

export interface PromptListTableProps {
  promptsData: PromptEntity[];
  pagination: React.ReactElement;
  orderByKey: string;
  orderByAsc: boolean;
  isLoading: boolean;
  error?: Error;
  isFiltered: boolean;
  onSortChange: (params: { orderByKey: string; orderByAsc: boolean }) => void;
}

type EnrichedPromptEntity = PromptEntity;
type PromptsColumnDef = ColumnDef<EnrichedPromptEntity> & {
  // Our experiments column definition houses style definitions in the metadata field
  meta?: { styles?: Interpolation<Theme> };
};

export const PromptListTable = ({
  promptsData,
  orderByAsc,
  orderByKey,
  onSortChange,
  isLoading,
  error,
  isFiltered,
  pagination,
}: PromptListTableProps) => {
  const intl = useIntl();

  const enrichedPromptsData: EnrichedPromptEntity[] = promptsData.map((prompt) => {
    return prompt;
  });

  const tableColumns = useMemo(() => {
    const columns: PromptsColumnDef[] = [
      {
        id: ColumnKeys.NAME,
        enableSorting: true,
        header: intl.formatMessage({
          defaultMessage: 'Name',
          description: 'Column title for prompt name in the registered prompt page',
        }),
        accessorKey: 'name',
        cell: ({ getValue }) => (
          <Link to={ModelRegistryRoutes.getPromptPageRoute(String(getValue()))}>
            <LegacyTooltip title={getValue()}>{getValue()}</LegacyTooltip>
          </Link>
        ),
        meta: { styles: { minWidth: 200, flex: 1 } },
      },
      {
        id: ColumnKeys.LATEST_VERSION,
        enableSorting: false,

        header: intl.formatMessage({
          defaultMessage: 'Latest version',
          description: 'Column title for latest model version in the registered model page',
        }),
        accessorKey: 'latest_versions',
        cell: ({ getValue, row: { original } }) => {
          const { name } = original;
          const latestVersions = getValue() as PromptVersionInfoEntity[];
          const latestVersionNumber =
            (Boolean(latestVersions?.length) &&
              Math.max(...latestVersions.map((v) => parseInt(v.version, 10))).toString()) ||
            '';
          return <PromptsListVersionLinkCell name={name} versionNumber={latestVersionNumber} />;
        },
        meta: { styles: { maxWidth: 120 } },
      },
    ];

    columns.push(
      {
        id: ColumnKeys.LAST_MODIFIED,
        enableSorting: true,
        header: intl.formatMessage({
          defaultMessage: 'Last modified',
          description: 'Column title for last modified timestamp for a model in the registered model page',
        }),
        accessorKey: 'last_updated_timestamp',
        cell: ({ getValue }) => <span>{Utils.formatTimestamp(getValue())}</span>,
        meta: { styles: { flex: 1, maxWidth: 150 } },
      },
      {
        id: ColumnKeys.TAGS,
        header: intl.formatMessage({
          defaultMessage: 'Tags',
          description: 'Column title for model tags in the registered model page',
        }),
        enableSorting: false,
        accessorKey: 'tags',
        cell: ({ getValue }) => {
          return <PromptListTagsCell tags={getValue() as KeyValueEntity[]} />;
        },
      },
    );

    return columns;
  }, [
    // prettier-ignore
    intl,
  ]);

  const sorting: SortingState = [{ id: orderByKey, desc: !orderByAsc }];

  const setSorting = (stateUpdater: SortingState | ((state: SortingState) => SortingState)) => {
    const [newSortState] = typeof stateUpdater === 'function' ? stateUpdater(sorting) : stateUpdater;
    if (newSortState) {
      onSortChange({ orderByKey: newSortState.id, orderByAsc: !newSortState.desc });
    }
  };

  const noResultsDescription = (() => {
    return (
      <FormattedMessage
        defaultMessage="No results. Try using a different keyword or adjusting your filters."
        description="Models table > no results after filtering"
      />
    );
  })();
  const emptyComponent = error ? (
    <Empty
      image={<WarningIcon />}
      description={error.message}
      title={
        <FormattedMessage
          defaultMessage="Error fetching models"
          description="Workspace models page > Error empty state title"
        />
      }
    />
  ) : isFiltered ? (
    // Displayed when there is no results, but any filters have been applied
    <Empty description={noResultsDescription} image={<SearchIcon />} data-testid="model-list-no-results" />
  ) : (
    // Displayed when there is no results with no filters applied
    <Empty
      description={
        <FormattedMessage
          defaultMessage="No prompts registered yet."
          description="Models table > no models present yet"
        />
      }
      image={<PlusIcon />}
    />
  );

  const isEmpty = () => (!isLoading && table.getRowModel().rows.length === 0) || error;

  const table = useReactTable<EnrichedPromptEntity>({
    data: enrichedPromptsData,
    columns: tableColumns,
    state: {
      sorting,
    },
    getCoreRowModel: getCoreRowModel(),
    getRowId: ({ id }) => id,
    onSortingChange: setSorting,
  });

  return (
    <>
      <Table
        data-testid="prompt-list-table"
        pagination={pagination}
        scrollable
        empty={isEmpty() ? emptyComponent : undefined}
      >
        <TableRow isHeader>
          {table.getLeafHeaders().map((header) => (
            <TableHeader
              componentId="codegen_mlflow_app_src_model-registry_components_model-list_promptlisttable.tsx_412"
              ellipsis
              key={header.id}
              sortable={header.column.getCanSort()}
              sortDirection={header.column.getIsSorted() || 'none'}
              onToggleSort={() => {
                const [currentSortColumn] = sorting;
                const changingDirection = header.column.id === currentSortColumn.id;
                const sortDesc = changingDirection ? !currentSortColumn.desc : false;
                header.column.toggleSorting(sortDesc);
              }}
              css={(header.column.columnDef as PromptsColumnDef).meta?.styles}
            >
              {flexRender(header.column.columnDef.header, header.getContext())}
            </TableHeader>
          ))}
        </TableRow>
        {isLoading ? (
          <TableSkeletonRows table={table} />
        ) : (
          table.getRowModel().rows.map((row) => (
            <TableRow key={row.id}>
              {row.getAllCells().map((cell) => (
                <TableCell ellipsis key={cell.id} css={(cell.column.columnDef as PromptsColumnDef).meta?.styles}>
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </TableCell>
              ))}
            </TableRow>
          ))
        )}
      </Table>
    </>
  );
};
