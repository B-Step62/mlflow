import invariant from 'invariant';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useSearchParams } from '../../../common/utils/RoutingUtils';
import { useDesignSystemTheme, Input, SearchIcon, TableFilterLayout, DropdownMenu, Button } from '@databricks/design-system';
import AiLogoUrl from './components/ai-logo.svg';
import { InsightQueryBanner } from './components/InsightQueryBanner';
import { useExperimentInsightsRuns } from './hooks/useExperimentInsightsRuns';
import { ExperimentInsightsTable } from './components/ExperimentInsightsTable';
import ExperimentInsightDetailsPage from './ExperimentInsightDetailsPage';

const SELECTED_INSIGHT_QUERY_PARAM = 'selectedInsightId';

const ExperimentInsightsPage = () => {
  const { experimentId } = useParams();
  invariant(experimentId, 'Experiment ID must be defined');

  const { theme } = useDesignSystemTheme();
  const { runs, loading } = useExperimentInsightsRuns({ experimentId });
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedInsightId = searchParams.get(SELECTED_INSIGHT_QUERY_PARAM) ?? undefined;

  const openInsightDetails = (insightId?: string) => {
    setSearchParams((params) => {
      if (!insightId) {
        params.delete(SELECTED_INSIGHT_QUERY_PARAM);
      } else {
        params.set(SELECTED_INSIGHT_QUERY_PARAM, insightId);
      }
      return params;
    });
  };

  const handleCreateInsight = useCallback(() => {
    // TODO(ML-INSIGHTS): Wire up to actual create insight flow once backend is ready.
    // For now this serves as an entry point in the UI so users know where to start.
    // eslint-disable-next-line no-console
    console.warn('Create Insight action is not yet implemented');
  }, []);

  // Controls state for insights table
  const [filterText, setFilterText] = useState('');
  const [sortBy, setSortBy] = useState<
    'createdAtDesc' | 'createdAtAsc' | 'nameAsc' | 'nameDesc' | 'traceCountDesc' | 'traceCountAsc'
  >('createdAtDesc');
  const [hiddenColumns, setHiddenColumns] = useState<string[]>([]);
  const toggleHiddenColumn = useCallback((columnId: string) => {
    setHiddenColumns((prev) => (prev.includes(columnId) ? prev.filter((c) => c !== columnId) : [...prev, columnId]));
  }, []);

  const renderCreateInsightBanner = () => (
    <InsightQueryBanner
      placeholder={'What Insight do you want to find from your traces? E.g. "What kind of questions are users asking?"'}
      ariaLabel="Create a new Insight"
      onSubmit={handleCreateInsight}
    />
  );

  return (
    <div
      data-testid="experiment-insights-page"
      css={{
        flex: 1,
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      <div
        css={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          minHeight: 0,
          overflow: 'hidden',
          gap: theme.spacing.lg,
        }}
      >
        {!selectedInsightId && (
          <>
            {renderCreateInsightBanner()}
            <div css={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <TableFilterLayout css={{ marginBottom: 0 }}>
                <Input
                  placeholder="Search insights"
                  value={filterText}
                  onChange={(e) => setFilterText(e.target.value)}
                  prefix={<SearchIcon />}
                  allowClear
                  onClear={() => setFilterText('')}
                  css={{ width: 360 }}
                />
                <DropdownMenu.Root>
                  <DropdownMenu.Trigger asChild>
                    <Button size="large">
                      {(() => {
                        switch (sortBy) {
                          case 'createdAtAsc':
                            return 'Sort: Created ↑';
                          case 'nameAsc':
                            return 'Sort: Name ↑';
                          case 'nameDesc':
                            return 'Sort: Name ↓';
                          case 'traceCountAsc':
                            return 'Sort: Trace Count ↑';
                          case 'traceCountDesc':
                            return 'Sort: Trace Count ↓';
                          case 'createdAtDesc':
                          default:
                            return 'Sort: Created ↓';
                        }
                      })()}
                    </Button>
                  </DropdownMenu.Trigger>
                  <DropdownMenu.Content align="start">
                    <DropdownMenu.Item onClick={() => setSortBy('createdAtDesc')}>Created ↓</DropdownMenu.Item>
                    <DropdownMenu.Item onClick={() => setSortBy('createdAtAsc')}>Created ↑</DropdownMenu.Item>
                    <DropdownMenu.Separator />
                    <DropdownMenu.Item onClick={() => setSortBy('nameAsc')}>Name ↑</DropdownMenu.Item>
                    <DropdownMenu.Item onClick={() => setSortBy('nameDesc')}>Name ↓</DropdownMenu.Item>
                    <DropdownMenu.Separator />
                    <DropdownMenu.Item onClick={() => setSortBy('traceCountDesc')}>Trace Count ↓</DropdownMenu.Item>
                    <DropdownMenu.Item onClick={() => setSortBy('traceCountAsc')}>Trace Count ↑</DropdownMenu.Item>
                  </DropdownMenu.Content>
                </DropdownMenu.Root>
              </TableFilterLayout>
            </div>
            <ExperimentInsightsTable
              runs={runs}
              loading={loading}
              onSelect={(runUuid) => openInsightDetails(runUuid)}
              onCreateInsight={handleCreateInsight}
              filterText={filterText}
              sortBy={sortBy}
              hiddenColumns={hiddenColumns}
              toggleHiddenColumn={toggleHiddenColumn}
            />
          </>
        )}
        {selectedInsightId && (
          <div css={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
            <ExperimentInsightDetailsPage experimentId={experimentId!} insightId={selectedInsightId} />
          </div>
        )}
      </div>
    </div>
  );
};

export default ExperimentInsightsPage;
