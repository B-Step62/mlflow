import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { fireEvent, screen } from '@testing-library/react';
import { DesignSystemProvider } from '@databricks/design-system';

import { renderWithIntl } from '../../../common/utils/TestUtils.react18';
import { testRoute, TestRouter } from '../../../common/utils/RoutingTestUtils';
import { generatePath } from '../../../common/utils/RoutingUtils';
import { RoutePaths } from '../../routes';
import ExperimentGenAIOverviewPage from './ExperimentGenAIOverviewPage';

const mockUseSearchMlflowTraces = jest.fn();
const mockClosePanel = jest.fn();
const mockOpenPanel = jest.fn();
const mockPrefillPrompt = jest.fn();
jest.mock('@databricks/web-shared/genai-traces-table', () => ({
  createTraceLocationForExperiment: (experimentId: string) => ({ experimentId }),
  useSearchMlflowTraces: (params: unknown) => mockUseSearchMlflowTraces(params),
}));

jest.mock('../../../assistant/AssistantContext', () => ({
  useAssistant: () => ({
    closePanel: mockClosePanel,
    openPanel: mockOpenPanel,
    prefillPrompt: mockPrefillPrompt,
  }),
}));

jest.mock('../../../gateway/hooks/useEndpointsQuery', () => ({
  useEndpointsQuery: () => ({ data: [], isLoading: false }),
}));

jest.mock('../../components/experiment-page/components/traces-v3/hooks/useInvokeIssueDetection', () => ({
  useInvokeIssueDetection: () => ({ mutate: jest.fn(), isLoading: false }),
}));

jest.mock('recharts', () => ({
  Bar: () => null,
  BarChart: ({ children, data }: { children?: React.ReactNode; data?: { count: number }[] }) => (
    <div>
      <div data-testid="trace-activity-chart-data">{data?.map((point) => point.count).join(',')}</div>
      {children}
    </div>
  ),
  ResponsiveContainer: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  Tooltip: () => null,
  XAxis: () => null,
  YAxis: () => null,
}));

describe('ExperimentGenAIOverviewPage suggested actions', () => {
  const experimentId = 'exp-overview-actions';
  const overviewUrl = generatePath(RoutePaths.experimentPageTabOverview, { experimentId });

  const renderComponent = () =>
    renderWithIntl(
      <DesignSystemProvider>
        <TestRouter
          routes={[testRoute(<ExperimentGenAIOverviewPage />, RoutePaths.experimentPageTabOverview)]}
          initialEntries={[overviewUrl]}
        />
      </DesignSystemProvider>,
    );

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('recommends eval and issue detection when traces exist', () => {
    mockUseSearchMlflowTraces.mockReturnValue({
      data: [{ trace_id: 'trace-1' }],
      isLoading: false,
      isFetching: false,
      refetchMlflowTraces: jest.fn(),
    });

    renderComponent();

    expect(screen.getAllByText('Detect issues')).toHaveLength(2);
    expect(screen.getAllByText('Setup eval')).toHaveLength(2);
    expect(screen.getByText('Connect GitHub')).toBeInTheDocument();
    expect(screen.getAllByText('Traces logged')).toHaveLength(2);
    expect(screen.queryByText('No recent activity yet')).not.toBeInTheDocument();
    expect(screen.queryByText('Setup tracing')).not.toBeInTheDocument();
    expect(screen.queryByText('How do I get started with MLflow?')).not.toBeInTheDocument();

    fireEvent.click(screen.getAllByRole('button', { name: /Detect issues/ })[0]);

    expect(mockOpenPanel).toHaveBeenCalled();
    expect(mockPrefillPrompt).toHaveBeenCalledWith('Detect issues');
  });

  it('shows seven-day trace activity with a dashboard link', () => {
    mockUseSearchMlflowTraces.mockReturnValue({
      data: [{ trace_id: 'trace-1' }],
      isLoading: false,
      isFetching: false,
      refetchMlflowTraces: jest.fn(),
    });

    renderComponent();

    expect(screen.getByText('Traces in the last 7 days')).toBeInTheDocument();
    expect(screen.getByTestId('trace-activity-chart-data')).toHaveTextContent('2,0,0,0,3,0,0');
    expect(screen.getByText('Open Dashboard')).toBeInTheDocument();
    expect(screen.queryByText('Open Traces')).not.toBeInTheDocument();
  });

  it('recommends tracing setup and playground when no traces exist', () => {
    mockUseSearchMlflowTraces.mockReturnValue({
      data: [],
      isLoading: false,
      isFetching: false,
      refetchMlflowTraces: jest.fn(),
    });

    renderComponent();

    expect(screen.getByText('Setup tracing')).toBeInTheDocument();
    expect(screen.getByText('Try playground')).toBeInTheDocument();
    expect(screen.getByText('Connect GitHub')).toBeInTheDocument();
    expect(screen.getByText('No recent activity yet')).toBeInTheDocument();
    expect(screen.getByText('Trace activity will appear here after traces are logged.')).toBeInTheDocument();
    expect(screen.getByTestId('trace-activity-chart-data')).toHaveTextContent('0,0,0,0,0,0,0');
    expect(screen.getByText('How do I get started with MLflow?')).toBeInTheDocument();
    expect(screen.getByText('How to trace my agent?')).toBeInTheDocument();
    expect(screen.queryByText('Detect issues')).not.toBeInTheDocument();
    expect(screen.queryByText('Setup eval')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'How do I get started with MLflow?' }));

    expect(mockOpenPanel).toHaveBeenCalled();
    expect(mockPrefillPrompt).toHaveBeenCalledWith('How do I get started with MLflow?');
  });
});
