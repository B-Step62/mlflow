import invariant from 'invariant';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useSearchParams } from '../../../common/utils/RoutingUtils';
import { useDesignSystemTheme, Input, SearchIcon, TableFilterLayout, DropdownMenu, Button } from '@databricks/design-system';
import AiLogoUrl from './components/ai-logo.svg';
import { useExperimentInsightsRuns } from './hooks/useExperimentInsightsRuns';
import { ExperimentInsightsTable } from './components/ExperimentInsightsTable';

const SELECTED_RUN_QUERY_PARAM = 'insightRunId';

const ExperimentInsightsPage = () => {
  const { experimentId } = useParams();
  invariant(experimentId, 'Experiment ID must be defined');

  const { theme } = useDesignSystemTheme();
  const { runs, loading, error, refetch } = useExperimentInsightsRuns({ experimentId });

  const [searchParams, setSearchParams] = useSearchParams();
  const selectedRunUuid = searchParams.get(SELECTED_RUN_QUERY_PARAM) ?? undefined;

  const selectRun = useCallback(
    (runUuid: string | undefined) => {
      setSearchParams((params) => {
        if (!runUuid) {
          params.delete(SELECTED_RUN_QUERY_PARAM);
        } else {
          params.set(SELECTED_RUN_QUERY_PARAM, runUuid);
        }
        return params;
      });
    },
    [setSearchParams],
  );

  useEffect(() => {
    if (loading || !runs.length) {
      return;
    }
    const hasSelectedRun = selectedRunUuid && runs.some((run) => run.info.runUuid === selectedRunUuid);
    if (!hasSelectedRun) {
      selectRun(runs[0].info.runUuid);
    }
  }, [runs, loading, selectedRunUuid, selectRun]);

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

  const bannerInputRef = useRef<HTMLInputElement | null>(null);
  const [bannerValue, setBannerValue] = useState('');

  const renderCreateInsightBanner = () => {
    return (
      <form
        onSubmit={(e) => {
          e.preventDefault();
          handleCreateInsight();
        }}
        onClick={() => bannerInputRef.current?.focus()}
        css={{
          // Layout
          display: 'flex',
          alignItems: 'center',
          gap: theme.spacing.sm,
          width: '100%',
          padding: `${theme.spacing.md}px ${theme.spacing.lg}px`,
          textAlign: 'left',
          cursor: 'text',

          // Shape
          borderRadius: theme.borders.borderRadiusMd,
          border: '1px solid transparent',

          // Gradient border around a white fill using the padding-box/border-box trick
          background:
            'linear-gradient(#ffffff, #ffffff) padding-box, linear-gradient(135deg, rgb(74, 174, 255) 20.5%, rgb(202, 66, 224) 46.91%, rgb(255, 95, 70) 79.5%) border-box',

          // Motion + hover
          transition: 'transform 0.15s ease, box-shadow 0.15s ease, background-color 0.15s ease',
          boxShadow: '0 0 0 0 rgba(0,0,0,0)',
          '&:hover': {
            transform: 'translateY(-0.5px)',
            boxShadow: '0 1px 2px rgba(16, 24, 40, 0.06)'
          },
          '&:active': {
            transform: 'translateY(0)'
          },
          '&:focus-within': {
            outline: `2px solid ${theme.colors.actionPrimaryTextDefault}`,
            outlineOffset: 2,
          },
        }}
      >
        <span
          css={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
          aria-hidden
        >
          <img src={AiLogoUrl} alt="" width={20} height={20} css={{ display: 'block' }} />
        </span>
        <input
          ref={bannerInputRef}
          type="text"
          value={bannerValue}
          onChange={(e) => setBannerValue(e.target.value)}
          placeholder={'What Insight do you want to find from your traces? E.g. "What kind of questions are users asking?"'}
          aria-label="Create a new Insight"
          css={{
            flex: 1,
            minWidth: 0,
            border: 0,
            outline: 'none',
            background: 'transparent',
            color: theme.colors.textPrimary,
            fontSize: 14,
            lineHeight: '20px',
            '::placeholder': {
              color: theme.colors.textSecondary,
            },
          }}
        />
      </form>
    );
  };

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
          padding: `0 ${theme.spacing.lg}px ${theme.spacing.lg}px ${theme.spacing.lg}px`,
          gap: theme.spacing.lg,
        }}
      >
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
          selectedRunUuid={selectedRunUuid}
          onSelect={(runUuid) => selectRun(runUuid)}
          onCreateInsight={handleCreateInsight}
          filterText={filterText}
          sortBy={sortBy}
          hiddenColumns={hiddenColumns}
          toggleHiddenColumn={toggleHiddenColumn}
        />
      </div>
    </div>
  );
};

export default ExperimentInsightsPage;
