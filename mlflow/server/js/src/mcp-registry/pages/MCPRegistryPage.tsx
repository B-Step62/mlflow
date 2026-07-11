import { useMemo, useState } from 'react';
import {
  Alert,
  Button,
  GridIcon,
  Header,
  ListIcon,
  SegmentedControlButton,
  SegmentedControlGroup,
  WrenchIcon,
  Spacer,
  useDesignSystemTheme,
} from '@databricks/design-system';
import { FormattedMessage, useIntl } from 'react-intl';

import { ScrollablePageWrapper } from '../../common/components/ScrollablePageWrapper';
import { withErrorBoundary } from '../../common/utils/withErrorBoundary';
import ErrorUtils from '../../common/utils/ErrorUtils';
import { useMCPServersListQuery } from '../hooks/useMCPServersListQuery';
import { MCPServerCardGrid } from '../components/MCPServerCardGrid';
import { MCPServerListTable } from '../components/MCPServerListTable';
import { MCPServerListFilters } from '../components/MCPServerListFilters';
import { useMockPersona } from '../hooks/useMockPersona';
import { isServerAvailable } from '../components/connect/serverAvailability';
import { flexColumnContainerStyles, headerIconStyles } from '../styles';
import { useDebounce } from 'use-debounce';

type ViewMode = 'list' | 'grid';
type AvailabilityFilter = 'available' | 'all';

const MCPRegistryPage = () => {
  const { theme } = useDesignSystemTheme();
  const intl = useIntl();
  const [persona] = useMockPersona();
  const isAdmin = persona === 'admin';
  const developerView = !isAdmin;
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [availabilityFilter, setAvailabilityFilter] = useState<AvailabilityFilter>('available');
  const [searchFilter, setSearchFilter] = useState('');
  const [debouncedSearchFilter] = useDebounce(searchFilter, 500);

  const {
    data: servers,
    isLoading,
    error,
    hasNextPage,
    hasPreviousPage,
    onNextPage,
    onPreviousPage,
    pageSizeSelect,
  } = useMCPServersListQuery({
    searchFilter: debouncedSearchFilter,
  });

  // Developers default to seeing only servers with an accessible endpoint; the
  // "All" filter reveals the rest, grayed out. Admins always see everything.
  const availableNames = useMemo(
    () => new Set((servers ?? []).filter(isServerAvailable).map((s) => s.name)),
    [servers],
  );
  const displayedServers = useMemo(() => {
    if (!developerView || availabilityFilter === 'all') {
      return servers;
    }
    return servers?.filter((s) => availableNames.has(s.name));
  }, [servers, developerView, availabilityFilter, availableNames]);
  const dimmedNames =
    developerView && availabilityFilter === 'all'
      ? new Set((servers ?? []).filter((s) => !availableNames.has(s.name)).map((s) => s.name))
      : undefined;

  const hideCreateButton = !isLoading && !servers?.length && !debouncedSearchFilter;
  const createButton =
    isAdmin && !hideCreateButton ? (
      <Button componentId="mlflow.mcp_registry.create_server_button" type="primary" disabled>
        <FormattedMessage defaultMessage="Create MCP server" description="Button to create a new MCP server" />
      </Button>
    ) : null;

  return (
    <ScrollablePageWrapper css={{ overflow: 'hidden', display: 'flex', flexDirection: 'column', flex: 1 }}>
      <Spacer shrinks={false} />
      <Header
        title={
          <span css={{ display: 'flex', alignItems: 'center', gap: theme.spacing.sm }}>
            <span css={headerIconStyles(theme)}>
              <WrenchIcon />
            </span>
            <FormattedMessage defaultMessage="MCP Registry" description="MCP Registry page title" />
          </span>
        }
        buttons={createButton}
      />
      <Spacer shrinks={false} />
      <div css={flexColumnContainerStyles}>
        <div css={flexColumnContainerStyles}>
          <div
            css={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: theme.spacing.sm,
              paddingTop: theme.spacing.md,
              flexShrink: 0,
            }}
          >
            <div css={{ flex: 1 }}>
              <MCPServerListFilters
                searchFilter={searchFilter}
                onSearchFilterChange={setSearchFilter}
                componentId="mlflow.mcp_registry.search"
              />
            </div>
            {developerView && (
              <SegmentedControlGroup
                name="mcp-registry-availability"
                value={availabilityFilter}
                onChange={(e) => setAvailabilityFilter(e.target.value as AvailabilityFilter)}
                componentId="mlflow.mcp_registry.availability_filter"
              >
                <SegmentedControlButton value="available">
                  <FormattedMessage
                    defaultMessage="Available"
                    description="Filter to servers with an accessible endpoint"
                  />
                </SegmentedControlButton>
                <SegmentedControlButton value="all">
                  <FormattedMessage defaultMessage="All" description="Filter to show all servers" />
                </SegmentedControlButton>
              </SegmentedControlGroup>
            )}
            <SegmentedControlGroup
              name="mcp-registry-view-mode"
              value={viewMode}
              onChange={(e) => setViewMode(e.target.value as ViewMode)}
              componentId="mlflow.mcp_registry.view_toggle"
            >
              <SegmentedControlButton
                value="list"
                icon={<ListIcon />}
                aria-label={intl.formatMessage({
                  defaultMessage: 'List view',
                  description: 'Aria label for list view toggle',
                })}
              />
              <SegmentedControlButton
                value="grid"
                icon={<GridIcon />}
                aria-label={intl.formatMessage({
                  defaultMessage: 'Grid view',
                  description: 'Aria label for grid view toggle',
                })}
              />
            </SegmentedControlGroup>
          </div>
          {error?.message && (
            <Alert
              type="error"
              message={error.message}
              componentId="mlflow.mcp_registry.error"
              closable={false}
              css={{ marginTop: theme.spacing.sm, flexShrink: 0 }}
            />
          )}
          {!error &&
            (viewMode === 'grid' ? (
              <MCPServerCardGrid
                servers={displayedServers}
                dimmedNames={dimmedNames}
                isLoading={isLoading}
                isFiltered={Boolean(debouncedSearchFilter)}
                hasNextPage={hasNextPage}
                hasPreviousPage={hasPreviousPage}
                onNextPage={onNextPage}
                onPreviousPage={onPreviousPage}
                pageSizeSelect={pageSizeSelect}
              />
            ) : (
              <MCPServerListTable
                servers={displayedServers}
                dimmedNames={dimmedNames}
                hasNextPage={hasNextPage}
                hasPreviousPage={hasPreviousPage}
                isLoading={isLoading}
                isFiltered={Boolean(debouncedSearchFilter)}
                onNextPage={onNextPage}
                onPreviousPage={onPreviousPage}
                pageSizeSelect={pageSizeSelect}
              />
            ))}
        </div>
      </div>
    </ScrollablePageWrapper>
  );
};

export default withErrorBoundary(ErrorUtils.mlflowServices.MCP_REGISTRY, MCPRegistryPage);
