import { useMemo, useState } from 'react';
import { Button, Switch, Tag, Typography, useDesignSystemTheme } from '@databricks/design-system';
import type { MockResource, MockScope } from './mockScopeData';
import { getResourcesForScope } from './mockScopeData';
import { SharedResourceBadge } from './SharedResourceBadge';
import type { ScopeTabName } from './ScopeSidebarItems';

interface ScopeResourceViewProps {
  scope: MockScope;
  activeTab?: ScopeTabName;
}

const TAB_FILTER_MAP: Record<string, MockResource['type'] | undefined> = {
  traces: 'trace',
  runs: 'run',
  datasets: 'dataset',
};

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
    <Tag componentId="mlflow.scope-browser.status-badge" color={colorMap[status] ?? 'default'}>
      {status}
    </Tag>
  );
};

export const ScopeResourceView = ({ scope, activeTab }: ScopeResourceViewProps) => {
  const { theme } = useDesignSystemTheme();
  const [includeChildren, setIncludeChildren] = useState(false);

  const resources = useMemo(() => getResourcesForScope(scope.id, includeChildren), [scope.id, includeChildren]);

  const filterType = activeTab ? TAB_FILTER_MAP[activeTab] : undefined;
  const filteredResources = useMemo(() => {
    if (!filterType) return resources;
    return resources.filter((r) => r.type === filterType);
  }, [resources, filterType]);

  // For tabs that don't have mock data (judges, prompts, models, evaluation-runs), show placeholder
  const isPlaceholderTab = activeTab && !TAB_FILTER_MAP[activeTab];

  return (
    <div css={{ display: 'flex', flexDirection: 'column', gap: theme.spacing.md }}>
      {/* Header */}
      <div css={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <Typography.Title level={3} css={{ margin: 0 }}>
            {scope.name}
          </Typography.Title>
          {scope.description && <Typography.Text color="secondary">{scope.description}</Typography.Text>}
        </div>
        <div css={{ display: 'flex', gap: theme.spacing.sm }}>
          <Button componentId="mlflow.scope-browser.create-scope" type="primary">
            Create Scope
          </Button>
          <Button componentId="mlflow.scope-browser.share">Share</Button>
        </div>
      </div>

      {/* Toggle */}
      <div
        css={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderBottom: `1px solid ${theme.colors.borderDecorative}`,
          paddingBottom: theme.spacing.sm,
        }}
      >
        <Typography.Text color="secondary" size="sm">
          {filteredResources.length} resource{filteredResources.length !== 1 ? 's' : ''}
          {activeTab && ` (${activeTab})`}
        </Typography.Text>
        <div css={{ display: 'flex', alignItems: 'center', gap: theme.spacing.sm }}>
          <Typography.Text size="sm" color="secondary">
            Include child scope resources
          </Typography.Text>
          <Switch
            componentId="mlflow.scope-browser.include-children-toggle"
            checked={includeChildren}
            onChange={(checked) => setIncludeChildren(checked)}
            label=""
          />
        </div>
      </div>

      {/* Placeholder for tabs without mock data */}
      {isPlaceholderTab ? (
        <div
          css={{
            padding: theme.spacing.lg * 2,
            textAlign: 'center',
            color: theme.colors.textSecondary,
          }}
        >
          <Typography.Text color="secondary">
            {activeTab} view coming soon (mock data not yet available for this tab)
          </Typography.Text>
        </div>
      ) : filteredResources.length === 0 ? (
        <div
          css={{
            padding: theme.spacing.lg * 2,
            textAlign: 'center',
            color: theme.colors.textSecondary,
          }}
        >
          <Typography.Text color="secondary">No resources in this scope</Typography.Text>
        </div>
      ) : (
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
              {includeChildren && <th>Scope</th>}
              <th>Details</th>
              <th>Timestamp</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filteredResources.map((resource) => (
              <tr key={resource.id}>
                <td>
                  <Typography.Text bold>{resource.name}</Typography.Text>
                </td>
                <td>
                  <Tag componentId={`mlflow.scope-browser.type-${resource.id}`}>{resource.type}</Tag>
                </td>
                <td>
                  <StatusBadge status={resource.status} />
                </td>
                {includeChildren && (
                  <td>
                    <Typography.Text size="sm" color="secondary">
                      {resource.scopeName}
                    </Typography.Text>
                  </td>
                )}
                <td>
                  <ResourceDetails resource={resource} />
                </td>
                <td>
                  <Typography.Text size="sm" color="secondary">
                    {new Date(resource.timestamp).toLocaleDateString()}
                  </Typography.Text>
                </td>
                <td>
                  {resource.sharedFrom && (
                    <SharedResourceBadge
                      scopeName={resource.sharedFrom.scopeName}
                      scopePath={resource.sharedFrom.scopePath}
                    />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
};

const ResourceDetails = ({ resource }: { resource: MockResource }) => {
  const { theme } = useDesignSystemTheme();

  if (resource.type === 'trace') {
    return (
      <span css={{ display: 'flex', gap: theme.spacing.sm, color: theme.colors.textSecondary, fontSize: 'inherit' }}>
        <span>{resource.traceType}</span>
        <span>{resource.latency}</span>
      </span>
    );
  }
  if (resource.type === 'run') {
    return (
      <span css={{ display: 'flex', gap: theme.spacing.sm, color: theme.colors.textSecondary, fontSize: 'inherit' }}>
        <span>{resource.duration}</span>
        {resource.metrics &&
          Object.entries(resource.metrics)
            .slice(0, 2)
            .map(([key, val]) => (
              <span key={key}>
                {key}: {typeof val === 'number' && val < 1 ? val.toFixed(3) : val}
              </span>
            ))}
      </span>
    );
  }
  if (resource.type === 'dataset') {
    return (
      <span css={{ display: 'flex', gap: theme.spacing.sm, color: theme.colors.textSecondary, fontSize: 'inherit' }}>
        <span>{resource.digest}</span>
        <span>{resource.profile}</span>
      </span>
    );
  }
  return null;
};
