import { useCallback, useMemo, useRef, useState } from 'react';
import { useReactTable_unverifiedWithReact18 as useReactTable } from '@databricks/web-shared/react-table';
import type { CursorPaginationProps } from '@databricks/design-system';
import {
  CursorPagination,
  Table,
  TableCell,
  TableHeader,
  TableRow,
  TableSkeletonRows,
  Tooltip,
  Typography,
  useDesignSystemTheme,
} from '@databricks/design-system';
import type { CellContext, ColumnDef } from '@tanstack/react-table';
import { flexRender, getCoreRowModel } from '@tanstack/react-table';
import { useIntl } from 'react-intl';

import type { MCPServer } from '../types';
import MCPRegistryRoutes from '../routes';
import { MCPServersEmptyState } from './MCPRegistryEmptyState';
import { MCPServerIcon } from './MCPServerIcon';
import { MCPServerTags } from './MCPServerTags';
import { textEllipsisStyles } from '../styles';
import { Link } from '../../common/utils/RoutingUtils';
import Utils from '../../common/utils/Utils';

const coreRowModel = getCoreRowModel<MCPServer>();
const getRowId = (row: MCPServer) => row.name;

// Relative column widths, matching the flex-weighted layout of the AI Gateway
// endpoints table.
const COLUMN_FLEX: Record<string, number> = {
  name: 2,
  description: 3,
  endpoints: 2,
  latestVersion: 1,
  lastModified: 1,
  tags: 2,
};

const MCPServerNameCell = ({ getValue, row }: CellContext<MCPServer, unknown>) => {
  const { theme } = useDesignSystemTheme();
  const value = getValue() as string;
  return (
    <span css={{ display: 'flex', alignItems: 'center', gap: theme.spacing.xs }}>
      <MCPServerIcon icons={row.original.icons} name={value} />
      <Link
        componentId="mlflow.mcp_registry.table.name_link"
        to={MCPRegistryRoutes.getMCPServerDetailRoute(row.original.name)}
      >
        {value}
      </Link>
    </span>
  );
};

const MCPServerDescriptionCell = ({ getValue }: CellContext<MCPServer, unknown>) => {
  const value = getValue() as string | undefined;
  const ref = useRef<HTMLSpanElement>(null);
  const [isTruncated, setIsTruncated] = useState(false);

  const checkTruncation = useCallback(() => {
    if (ref.current) {
      setIsTruncated(ref.current.scrollWidth > ref.current.clientWidth);
    }
  }, []);

  if (!value) return '—';

  const content = (
    <span ref={ref} onMouseEnter={checkTruncation} css={{ display: 'block', ...textEllipsisStyles }}>
      {value}
    </span>
  );

  return isTruncated ? (
    <Tooltip content={value} componentId="mlflow.mcp_registry.table.description_tooltip">
      {content}
    </Tooltip>
  ) : (
    content
  );
};

const MCPServerTagsCell = ({ row: { original } }: CellContext<MCPServer, unknown>) => {
  return <MCPServerTags tags={original.tags || {}} />;
};

const MAX_VISIBLE_ENDPOINTS = 2;

const MCPServerEndpointsCell = ({ row: { original } }: CellContext<MCPServer, unknown>) => {
  const { theme } = useDesignSystemTheme();
  const endpoints = original.access_bindings ?? [];

  if (endpoints.length === 0) {
    return '—';
  }

  const visible = endpoints.slice(0, MAX_VISIBLE_ENDPOINTS);
  const hiddenCount = endpoints.length - visible.length;

  return (
    <div css={{ display: 'flex', flexDirection: 'column', gap: theme.spacing.xs / 2, minWidth: 0 }}>
      {visible.map((binding) => (
        <Tooltip
          key={binding.binding_id}
          content={binding.endpoint_url}
          componentId="mlflow.mcp_registry.table.endpoint_tooltip"
        >
          <Typography.Text
            size="sm"
            css={{ fontFamily: 'monospace', display: 'block', maxWidth: 260, ...textEllipsisStyles }}
          >
            {binding.endpoint_url}
          </Typography.Text>
        </Tooltip>
      ))}
      {hiddenCount > 0 && <Typography.Hint>+{hiddenCount} more</Typography.Hint>}
    </div>
  );
};

const useMCPServerTableColumns = () => {
  const intl = useIntl();
  return useMemo(() => {
    const columns: ColumnDef<MCPServer>[] = [
      {
        header: intl.formatMessage({
          defaultMessage: 'Name',
          description: 'Header for the name column in the MCP servers table',
        }),
        accessorFn: (row) => row.name,
        id: 'name',
        cell: MCPServerNameCell,
      },
      {
        header: intl.formatMessage({
          defaultMessage: 'Description',
          description: 'Header for the description column in the MCP servers table',
        }),
        accessorKey: 'description',
        id: 'description',
        cell: MCPServerDescriptionCell,
      },
      {
        header: intl.formatMessage({
          defaultMessage: 'Endpoints',
          description: 'Header for the endpoints column in the MCP servers table',
        }),
        id: 'endpoints',
        cell: MCPServerEndpointsCell,
      },
      {
        header: intl.formatMessage({
          defaultMessage: 'Latest version',
          description: 'Header for the latest version column in the MCP servers table',
        }),
        id: 'latestVersion',
        accessorFn: (row) => row.latest_version || '—',
      },
      {
        header: intl.formatMessage({
          defaultMessage: 'Last modified',
          description: 'Header for the last modified column in the MCP servers table',
        }),
        id: 'lastModified',
        accessorFn: ({ last_updated_timestamp }) =>
          last_updated_timestamp ? Utils.formatTimestamp(last_updated_timestamp, intl) : '',
      },
      {
        header: intl.formatMessage({
          defaultMessage: 'Tags',
          description: 'Header for the tags column in the MCP servers table',
        }),
        id: 'tags',
        cell: MCPServerTagsCell,
      },
    ];
    return columns;
  }, [intl]);
};

export const MCPServerListTable = ({
  servers,
  dimmedNames,
  hasNextPage,
  hasPreviousPage,
  isLoading,
  isFiltered,
  onNextPage,
  onPreviousPage,
  pageSizeSelect,
}: {
  servers?: MCPServer[];
  dimmedNames?: Set<string>;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
  isLoading?: boolean;
  isFiltered?: boolean;
  onNextPage: () => void;
  onPreviousPage: () => void;
  pageSizeSelect?: CursorPaginationProps['pageSizeSelect'];
}) => {
  const { theme } = useDesignSystemTheme();
  const columns = useMCPServerTableColumns();

  const table = useReactTable('mlflow/server/js/src/mcp-registry/components/MCPServerListTable.tsx', {
    data: servers ?? [],
    columns,
    getCoreRowModel: coreRowModel,
    getRowId,
  });

  const isEmptyList = !isLoading && (!servers || servers.length === 0);
  const emptyState = isEmptyList ? (
    <MCPServersEmptyState isFiltered={isFiltered} componentId="mlflow.mcp_registry.table.empty_state.create_server" />
  ) : null;

  return (
    <Table
      scrollable
      noMinHeight
      pagination={
        <CursorPagination
          hasNextPage={hasNextPage}
          hasPreviousPage={hasPreviousPage}
          onNextPage={onNextPage}
          onPreviousPage={onPreviousPage}
          pageSizeSelect={pageSizeSelect}
          componentId="mlflow.mcp_registry.table.pagination"
        />
      }
      empty={emptyState}
      css={{
        borderLeft: `1px solid ${theme.colors.border}`,
        borderRight: `1px solid ${theme.colors.border}`,
        borderTop: `1px solid ${theme.colors.border}`,
        borderBottom: isEmptyList ? `1px solid ${theme.colors.border}` : 'none',
        borderRadius: theme.general.borderRadiusBase,
        overflow: 'hidden',
      }}
    >
      <TableRow isHeader>
        {table.getLeafHeaders().map((header) => (
          <TableHeader
            componentId="mlflow.mcp_registry.table.header"
            key={header.id}
            css={{ flex: COLUMN_FLEX[header.column.id] ?? 1 }}
          >
            {flexRender(header.column.columnDef.header, header.getContext())}
          </TableHeader>
        ))}
      </TableRow>
      {isLoading ? (
        <TableSkeletonRows table={table} />
      ) : (
        table.getRowModel().rows.map((row) => (
          <TableRow
            key={row.id}
            css={{ height: theme.general.buttonHeight, opacity: dimmedNames?.has(row.original.name) ? 0.5 : 1 }}
          >
            {row.getAllCells().map((cell) => (
              <TableCell key={cell.id} css={{ alignItems: 'center', flex: COLUMN_FLEX[cell.column.id] ?? 1 }}>
                {flexRender(cell.column.columnDef.cell, cell.getContext())}
              </TableCell>
            ))}
          </TableRow>
        ))
      )}
    </Table>
  );
};
