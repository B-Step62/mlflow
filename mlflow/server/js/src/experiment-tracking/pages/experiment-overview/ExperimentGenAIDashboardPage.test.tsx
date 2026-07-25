import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { screen, waitFor } from '@testing-library/react';
import { DesignSystemProvider } from '@databricks/design-system';

import { renderWithIntl } from '../../../common/utils/TestUtils.react18';
import { setupTestRouter, testRoute, TestRouter } from '../../../common/utils/RoutingTestUtils';
import { generatePath, useLocation } from '../../../common/utils/RoutingUtils';
import { RoutePaths } from '../../routes';
import ExperimentGenAIDashboardPage from './ExperimentGenAIDashboardPage';

jest.mock('../../hooks/useServerInfo', () => ({
  useIsFileStore: () => false,
}));

const mockUseGetExperimentQuery = jest.fn();
jest.mock('../../hooks/useExperimentQuery', () => ({
  useGetExperimentQuery: (params: unknown) => mockUseGetExperimentQuery(params),
}));

jest.mock('./components/LazyTraceRequestsChart', () => ({
  LazyTraceRequestsChart: () => <div data-testid="trace-requests-chart" />,
}));
jest.mock('./components/LazyTraceLatencyChart', () => ({
  LazyTraceLatencyChart: () => <div data-testid="trace-latency-chart" />,
}));
jest.mock('./components/LazyTraceErrorsChart', () => ({
  LazyTraceErrorsChart: () => <div data-testid="trace-errors-chart" />,
}));
jest.mock('./components/LazyTraceTokenUsageChart', () => ({
  LazyTraceTokenUsageChart: () => <div data-testid="trace-token-usage-chart" />,
}));
jest.mock('./components/LazyTraceTokenStatsChart', () => ({
  LazyTraceTokenStatsChart: () => <div data-testid="trace-token-stats-chart" />,
}));
jest.mock('./components/LazyTraceCostBreakdownChart', () => ({
  LazyTraceCostBreakdownChart: () => <div data-testid="trace-cost-breakdown-chart" />,
}));
jest.mock('./components/LazyTraceCostOverTimeChart', () => ({
  LazyTraceCostOverTimeChart: () => <div data-testid="trace-cost-over-time-chart" />,
}));
jest.mock('./components/AssessmentChartsSection', () => ({
  AssessmentChartsSection: () => <div data-testid="assessment-charts-section" />,
}));
jest.mock('./components/ToolCallStatistics', () => ({
  ToolCallStatistics: () => <div data-testid="tool-call-statistics" />,
}));
jest.mock('./components/ToolCallChartsSection', () => ({
  ToolCallChartsSection: () => <div data-testid="tool-call-charts-section" />,
}));
jest.mock('./components/LazyToolUsageChart', () => ({
  LazyToolUsageChart: () => <div data-testid="tool-usage-chart" />,
}));
jest.mock('./components/LazyToolLatencyChart', () => ({
  LazyToolLatencyChart: () => <div data-testid="tool-latency-chart" />,
}));
jest.mock('./components/LazyToolPerformanceSummary', () => ({
  LazyToolPerformanceSummary: () => <div data-testid="tool-performance-summary" />,
}));

describe('ExperimentGenAIDashboardPage', () => {
  const { history } = setupTestRouter();
  const experimentId = 'exp-dashboard';
  let currentSearch = '';
  const dashboardUrl = generatePath(RoutePaths.experimentPageTabDashboard, {
    experimentId,
    overviewTab: 'usage',
  });

  const LocationProbe = () => {
    const location = useLocation();
    currentSearch = location.search;
    return null;
  };

  const renderComponent = (initialUrl = dashboardUrl) =>
    renderWithIntl(
      <DesignSystemProvider>
        <TestRouter
          history={history}
          routes={[
            testRoute(
              <>
                <ExperimentGenAIDashboardPage />
                <LocationProbe />
              </>,
              RoutePaths.experimentPageTabDashboard,
            ),
          ]}
          initialEntries={[initialUrl]}
        />
      </DesignSystemProvider>,
    );

  beforeEach(() => {
    currentSearch = '';
    jest.clearAllMocks();
    mockUseGetExperimentQuery.mockReturnValue({
      data: {
        experimentId,
        name: 'Demo experiment',
        tags: [
          { key: 'mlflow.demo.version.dashboard', value: '1' },
          { key: 'mlflow.demo.start_time_ms', value: String(Date.UTC(2025, 0, 1)) },
          { key: 'mlflow.demo.end_time_ms', value: String(Date.UTC(2025, 0, 7)) },
        ],
      },
    });
  });

  it('does not rewrite an explicit default time range to a demo custom range', async () => {
    renderComponent(`${dashboardUrl}?startTimeLabel=LAST_7_DAYS`);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Last 7 days/i })).toBeInTheDocument();
    });

    expect(currentSearch).toBe('?startTimeLabel=LAST_7_DAYS');
  });
});
