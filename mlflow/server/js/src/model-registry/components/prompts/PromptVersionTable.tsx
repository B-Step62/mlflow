import {
  Empty,
  Pagination,
  PlusIcon,
  Table,
  TableCell,
  TableHeader,
  TableRow,
  TableRowSelectCell,
  useDesignSystemTheme,
} from '@databricks/design-system';
import {
  ColumnDef,
  PaginationState,
  SortingState,
  flexRender,
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from '@tanstack/react-table';
import { KeyValueEntity, PromptEntity, PromptVersionInfoEntity } from '../../../experiment-tracking/types';
import { useMemo, useState } from 'react';
import { FormattedMessage, useIntl } from 'react-intl';
import { Link } from '../../../common/utils/RoutingUtils';
import { ModelRegistryRoutes } from '../../routes';
import Utils from '../../../common/utils/Utils';
import { KeyValueTagsEditorCell } from '../../../common/components/KeyValueTagsEditorCell';
import { Interpolation, Theme } from '@emotion/react';
import { truncateToFirstLineWithMaxLength } from '../../../common/utils/StringUtils';

type PromptVersionTableProps = {
  promptName: string;
  promptVersions?: PromptVersionInfoEntity[];
  promptEntity?: PromptEntity;
};

type PromptVersionColumnDef = ColumnDef<PromptVersionInfoEntity> & {
  meta?: { styles?: Interpolation<Theme>; multiline?: boolean; className?: string };
};

enum COLUMN_IDS {
  VERSION = 'VERSION',
  DESCRIPTION = 'DESCRIPTION',
  TEMPLATE_TEXT = 'TEMPLATE_TEXT',
  CREATION_TIMESTAMP = 'CREATION_TIMESTAMP',
  TAGS = 'TAGS',
}

export const PromptVersionTable = ({
  promptName,
  promptVersions,
  promptEntity,
}: PromptVersionTableProps) => {
  const { theme } = useDesignSystemTheme();
  const intl = useIntl();

  const allTagsList: KeyValueEntity[] = promptVersions?.map((promptVersion) => promptVersion?.tags || []).flat() || [];

  // Extract keys, remove duplicates and sort the
  const allTagsKeys = Array.from(new Set(allTagsList.map(({ key }) => key))).sort()

  const [pagination, setPagination] = useState<PaginationState>({
    pageSize: 10,
    pageIndex: 0,
  });

  const tableColumns = useMemo(() => {
    const columns: PromptVersionColumnDef[] = []
    columns.push(
      {
        id: COLUMN_IDS.VERSION,
        enableSorting: false,
        header: intl.formatMessage({
          defaultMessage: 'Version',
          description: 'Column title text for prompt version in prompt version table',
        }),
        meta: { className: 'prompt-version' },
        accessorKey: 'version',
        cell: ({ getValue }) => (
          <FormattedMessage
            defaultMessage="<link>Version {versionNumber}</link>"
            description="Link to prompt version in the prompt version table"
            values={{
              link: (chunks) => (
                <Link to={ModelRegistryRoutes.getPromptVersionPageRoute(promptName, String(getValue()))}>{chunks}</Link>
              ),
              versionNumber: getValue(),
            }}
          />
        ),
      },
      {
        id: COLUMN_IDS.CREATION_TIMESTAMP,
        enableSorting: true,
        meta: { styles: { minWidth: 200 } },
        header: intl.formatMessage({
          defaultMessage: 'Registered at',
          description: 'Column title text for created at timestamp in model version table',
        }),
        accessorKey: 'creation_timestamp',
        cell: ({ getValue }) => Utils.formatTimestamp(getValue()),
      },
    );


    columns.push(
      {
        id: COLUMN_IDS.TAGS,
        enableSorting: false,
        header: intl.formatMessage({
          defaultMessage: 'Tags',
          description: 'Column title text for PROMPT version tags in model version table',
        }),
        meta: { styles: { flex: 2 } },
        accessorKey: 'tags',
        cell: ({ getValue, row: { original } }) => {
          return (
            <KeyValueTagsEditorCell
              tags={getValue() as KeyValueEntity[]}
              onAddEdit={() => {}}
            />
          );
        },
      },
    );
    columns.push({
      id: COLUMN_IDS.DESCRIPTION,
      enableSorting: false,
      header: intl.formatMessage({
        defaultMessage: 'Description',
        description: 'Column title text for description in model version table',
      }),
      meta: { styles: { flex: 2 } },
      accessorKey: 'description',
      cell: ({ getValue }) => truncateToFirstLineWithMaxLength(getValue(), 32),
    });
    return columns;
  }, [theme, intl, promptName]);

  const [sorting, setSorting] = useState<SortingState>([{ id: COLUMN_IDS.CREATION_TIMESTAMP, desc: true }]);

  const table = useReactTable<PromptVersionInfoEntity>({
    data: promptVersions || [],
    columns: tableColumns,
    state: {
      pagination,
      sorting,
    },
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getRowId: ({ version }) => version,
    onSortingChange: setSorting,
  });

  const isEmpty = () => table.getRowModel().rows.length === 0;

  const paginationComponent = (
    <Pagination
      componentId="codegen_mlflow_app_src_model-registry_components_modelversiontable.tsx_403"
      currentPageIndex={pagination.pageIndex + 1}
      numTotal={(promptVersions || []).length}
      onChange={(page, pageSize) => {
        setPagination({
          pageSize: pageSize || pagination.pageSize,
          pageIndex: page - 1,
        });
      }}
      pageSize={pagination.pageSize}
    />
  );

  const emptyComponent = (
    <Empty
      description={
        <FormattedMessage
          defaultMessage="No models versions are registered yet. <link>Learn more</link> about how to
          register a model version."
          description="Message text when no model versions are registered"
        />
      }
      image={<PlusIcon />}
    />
  );

  return (
    <>
      <Table
        data-testid="prompt-list-table"
        pagination={paginationComponent}
        scrollable
        empty={isEmpty() ? emptyComponent : undefined}
        someRowsSelected={table.getIsSomeRowsSelected() || table.getIsAllRowsSelected()}
      >
        <TableRow isHeader>
          <TableRowSelectCell
            componentId="codegen_mlflow_app_src_model-registry_components_modelversiontable.tsx_450"
            checked={table.getIsAllRowsSelected()}
            indeterminate={table.getIsSomeRowsSelected()}
            onChange={table.getToggleAllRowsSelectedHandler()}
          />
          {table.getLeafHeaders().map((header) => (
            <TableHeader
              componentId="codegen_mlflow_app_src_model-registry_components_modelversiontable.tsx_458"
              multiline={false}
              key={header.id}
              sortable={header.column.getCanSort()}
              sortDirection={header.column.getIsSorted() || 'none'}
              onToggleSort={header.column.getToggleSortingHandler()}
              css={(header.column.columnDef as PromptVersionColumnDef).meta?.styles}
            >
              {flexRender(header.column.columnDef.header, header.getContext())}
            </TableHeader>
          ))}
        </TableRow>
        {table.getRowModel().rows.map((row) => (
          <TableRow
            key={row.id}
            css={{
              '.table-row-select-cell': {
                alignItems: 'flex-start',
              },
            }}
          >
            <TableRowSelectCell
              componentId="codegen_mlflow_app_src_model-registry_components_modelversiontable.tsx_477"
              checked={row.getIsSelected()}
              onChange={row.getToggleSelectedHandler()}
            />
            {row.getAllCells().map((cell) => (
              <TableCell
                className={(cell.column.columnDef as PromptVersionColumnDef).meta?.className}
                multiline={(cell.column.columnDef as PromptVersionColumnDef).meta?.multiline}
                key={cell.id}
                css={(cell.column.columnDef as PromptVersionColumnDef).meta?.styles}
              >
                {flexRender(cell.column.columnDef.cell, cell.getContext())}
              </TableCell>
            ))}
          </TableRow>
        ))}
      </Table>
    </>
  );
};
