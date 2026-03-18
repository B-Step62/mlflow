import { useMemo, useState } from 'react';
import { Button, Input, SearchIcon, Tag, Typography, useDesignSystemTheme } from '@databricks/design-system';
import { Link } from '../../../common/utils/RoutingUtils';
import { MOCK_RESOURCES, getScopePath } from './mockScopeData';
import { SharedResourceBadge } from './SharedResourceBadge';
import type { MockResource } from './mockScopeData';

type FilterType = 'all' | 'trace' | 'run' | 'dataset';

const FILTER_CONFIG: { key: FilterType; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'trace', label: 'Traces' },
  { key: 'run', label: 'Runs' },
  { key: 'dataset', label: 'Datasets' },
];

const StatusBadge = ({ status }: { status: string }) => {
  const colorMap: Record<string, 'teal' | 'coral' | 'lemon' | 'default'> = {
    OK: 'teal',
    FINISHED: 'teal',
    Active: 'teal',
    ERROR: 'coral',
    FAILED: 'coral',
    RUNNING: 'lemon',
  };
  return (
    <Tag componentId="mlflow.scope-browser.search-status-badge" color={colorMap[status] ?? 'default'}>
      {status}
    </Tag>
  );
};

export const ScopeSearchPanel = () => {
  const { theme } = useDesignSystemTheme();
  const [query, setQuery] = useState('');
  const [filterType, setFilterType] = useState<FilterType>('all');

  const results = useMemo(() => {
    let filtered = MOCK_RESOURCES;
    if (filterType !== 'all') {
      filtered = filtered.filter((r) => r.type === filterType);
    }
    if (query.trim()) {
      const lowerQuery = query.toLowerCase();
      filtered = filtered.filter(
        (r) => r.name.toLowerCase().includes(lowerQuery) || r.scopeName.toLowerCase().includes(lowerQuery),
      );
    }
    return filtered;
  }, [query, filterType]);

  return (
    <div css={{ padding: theme.spacing.lg, display: 'flex', flexDirection: 'column', gap: theme.spacing.md }}>
      <Typography.Title level={3}>Search All Scopes</Typography.Title>

      {/* Search input */}
      <Input
        componentId="mlflow.scope-browser.search-input"
        prefix={<SearchIcon />}
        placeholder="Search resources across all scopes..."
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        allowClear
      />

      {/* Filter chips */}
      <div css={{ display: 'flex', gap: theme.spacing.xs }}>
        {FILTER_CONFIG.map((filter) => (
          <Button
            componentId={`mlflow.scope-browser.search-filter-${filter.key}`}
            key={filter.key}
            type={filterType === filter.key ? 'primary' : 'tertiary'}
            size="small"
            onClick={() => setFilterType(filter.key)}
          >
            {filter.label}
          </Button>
        ))}
      </div>

      {/* Results count */}
      <Typography.Text color="secondary" size="sm">
        {results.length} result{results.length !== 1 ? 's' : ''}
      </Typography.Text>

      {/* Results table */}
      <table
        css={{
          width: '100%',
          borderCollapse: 'collapse',
          fontSize: theme.typography.fontSizeSm,
          '& th': {
            textAlign: 'left',
            padding: `${theme.spacing.sm}px ${theme.spacing.md}px`,
            borderBottom: `2px solid ${theme.colors.borderDecorative}`,
            color: theme.colors.textSecondary,
            fontWeight: theme.typography.typographyBoldFontWeight,
            whiteSpace: 'nowrap',
          },
          '& td': {
            padding: `${theme.spacing.sm}px ${theme.spacing.md}px`,
            borderBottom: `1px solid ${theme.colors.borderDecorative}`,
            verticalAlign: 'middle',
          },
          '& tr:hover td': {
            backgroundColor: theme.colors.tableRowHover,
          },
        }}
      >
        <thead>
          <tr>
            <th>Name</th>
            <th>Type</th>
            <th>Status</th>
            <th>Scope Path</th>
            <th>Timestamp</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {results.map((resource) => (
            <SearchResultRow key={resource.id} resource={resource} />
          ))}
        </tbody>
      </table>
    </div>
  );
};

const SearchResultRow = ({ resource }: { resource: MockResource }) => {
  const { theme } = useDesignSystemTheme();
  const scopePath = getScopePath(resource.scopeId);
  const scopeUrl = `/scopes/${scopePath.join('/')}`;

  return (
    <tr>
      <td>
        <Typography.Text bold>{resource.name}</Typography.Text>
      </td>
      <td>
        <Tag componentId={`mlflow.scope-browser.search-type-${resource.id}`}>{resource.type}</Tag>
      </td>
      <td>
        <StatusBadge status={resource.status} />
      </td>
      <td>
        <Link
          componentId={`mlflow.scope-browser.search-scope-link-${resource.id}`}
          to={scopeUrl}
          css={{
            display: 'flex',
            alignItems: 'center',
            gap: theme.spacing.xs,
            color: theme.colors.textSecondary,
            fontSize: theme.typography.fontSizeSm,
            '&:hover': { color: theme.colors.actionLinkHover },
          }}
        >
          {scopePath.join(' / ')}
        </Link>
      </td>
      <td>
        <Typography.Text size="sm" color="secondary">
          {new Date(resource.timestamp).toLocaleDateString()}
        </Typography.Text>
      </td>
      <td>
        {resource.sharedFrom && (
          <SharedResourceBadge scopeName={resource.sharedFrom.scopeName} scopePath={resource.sharedFrom.scopePath} />
        )}
      </td>
    </tr>
  );
};
