import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import type React from 'react';
import { fireEvent, screen, waitFor } from '@testing-library/react';
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
const mockStartMockIssueDetection = jest.fn();
const mockRecordSubmittedIssueDetectionJob = jest.fn();
const mockGetExperiment = jest.fn<(params: unknown) => Promise<unknown>>();
jest.mock('@databricks/web-shared/genai-traces-table', () => ({
  createTraceLocationForExperiment: (experimentId: string) => ({ experimentId }),
  useSearchMlflowTraces: (params: unknown) => mockUseSearchMlflowTraces(params),
}));

jest.mock('../../../assistant/AssistantContext', () => ({
  useAssistant: () => ({
    closePanel: mockClosePanel,
    openPanel: mockOpenPanel,
    prefillPrompt: mockPrefillPrompt,
    startMockIssueDetection: mockStartMockIssueDetection,
  }),
}));

jest.mock('../../components/experiment-page/components/traces-v3/IssueDetectionJobNotifications', () => ({
  recordSubmittedIssueDetectionJob: (job: unknown) => mockRecordSubmittedIssueDetectionJob(job),
}));

jest.mock('../../sdk/MlflowService', () => ({
  MlflowService: { getExperiment: (params: unknown) => mockGetExperiment(params) },
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
  Tooltip: ({ content }: { content?: React.ReactElement }) => {
    const { cloneElement } = jest.requireActual<typeof import('react')>('react');
    return content
      ? cloneElement(content, {
          active: true,
          label: '8 AM',
          payload: [{ value: 1, color: '#1f77b4' }],
        })
      : null;
  },
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
    mockGetExperiment.mockResolvedValue({
      experiment: {
        tags: [{ key: 'mlflow.issueCujDemo.issueDetectionRunId', value: 'seeded-issue-detection-run' }],
      },
    });
  });

  it('recommends eval and issue detection when traces exist', () => {
    mockUseSearchMlflowTraces.mockReturnValue({
      data: [{ trace_id: 'trace-1' }],
      isLoading: false,
      isFetching: false,
      refetchMlflowTraces: jest.fn(),
    });

    renderComponent();

    expect(screen.getAllByText('Find common failure modes')).toHaveLength(2);
    expect(screen.getAllByText('Setup eval')).toHaveLength(2);
    expect(screen.getByText('Connect GitHub')).toBeInTheDocument();
    expect(screen.getAllByText('Traces logged')).toHaveLength(2);
    expect(screen.queryByText('No recent activity yet')).not.toBeInTheDocument();
    expect(screen.queryByText('Setup tracing')).not.toBeInTheDocument();
    expect(screen.queryByText('How do I get started with MLflow?')).not.toBeInTheDocument();
  });

  it('shows trace activity summary with a dashboard link', () => {
    mockUseSearchMlflowTraces.mockReturnValue({
      data: [{ trace_id: 'trace-1' }],
      isLoading: false,
      isFetching: false,
      refetchMlflowTraces: jest.fn(),
    });

    renderComponent();

    expect(screen.getByText('Traces in the last 7 days')).toBeInTheDocument();
    expect(screen.getByTestId('trace-activity-chart-data')).toHaveTextContent('0,0,0,0,0,0,1');
    expect(screen.queryByText('LLM cost')).not.toBeInTheDocument();
    expect(screen.queryByText('Avg. latency')).not.toBeInTheDocument();
    expect(screen.queryByText('Tokens')).not.toBeInTheDocument();
    expect(screen.getByText('Open Dashboard')).toBeInTheDocument();
    expect(screen.queryByText('Open Traces')).not.toBeInTheDocument();
  });

  it('starts mocked issue detection with assistant progress from the top suggested query', async () => {
    mockUseSearchMlflowTraces.mockReturnValue({
      data: [{ trace_id: 'trace-1' }],
      isLoading: false,
      isFetching: false,
      refetchMlflowTraces: jest.fn(),
    });

    renderComponent();

    fireEvent.click(screen.getAllByRole('button', { name: /Find common failure modes/ })[0]);

    await waitFor(() => {
      expect(mockRecordSubmittedIssueDetectionJob).toHaveBeenCalled();
    });
    expect(mockOpenPanel).not.toHaveBeenCalled();
    expect(mockPrefillPrompt).not.toHaveBeenCalled();
    expect(mockRecordSubmittedIssueDetectionJob).toHaveBeenCalledWith({
      experimentId,
      jobId: `mock-issue-cuj-common-failure-modes-${experimentId}`,
      runId: 'seeded-issue-detection-run',
      traceCount: 205,
      mockResult: {
        issues: 5,
        totalTracesAnalyzed: 205,
        completionDelayMs: 10000,
      },
    });
    expect(mockStartMockIssueDetection).toHaveBeenCalledWith({
      experimentId,
      jobId: `mock-issue-cuj-common-failure-modes-${experimentId}`,
      runId: 'seeded-issue-detection-run',
      traceCount: 205,
      issueCount: 5,
      completionDelayMs: 10000,
      onComplete: expect.any(Function),
    });
  });

  it('records submitted issue detection jobs for shared toasts instead of rendering an inline status card', async () => {
    mockUseSearchMlflowTraces.mockReturnValue({
      data: [{ trace_id: 'trace-1' }],
      isLoading: false,
      isFetching: false,
      refetchMlflowTraces: jest.fn(),
    });

    renderComponent();

    fireEvent.click(screen.getAllByRole('button', { name: /Find common failure modes/ })[1]);

    await waitFor(() => {
      expect(mockRecordSubmittedIssueDetectionJob).toHaveBeenCalled();
    });
    expect(mockRecordSubmittedIssueDetectionJob).toHaveBeenCalledWith({
      experimentId,
      jobId: `mock-issue-cuj-common-failure-modes-${experimentId}`,
      runId: 'seeded-issue-detection-run',
      traceCount: 205,
      mockResult: {
        issues: 5,
        totalTracesAnalyzed: 205,
        completionDelayMs: 10000,
      },
    });
    expect(mockStartMockIssueDetection).toHaveBeenCalledWith({
      experimentId,
      jobId: `mock-issue-cuj-common-failure-modes-${experimentId}`,
      runId: 'seeded-issue-detection-run',
      traceCount: 205,
      issueCount: 5,
      completionDelayMs: 10000,
      onComplete: expect.any(Function),
    });
    expect(screen.queryByText('Starting issue detection')).not.toBeInTheDocument();
    expect(screen.queryByText('Issue detection is running')).not.toBeInTheDocument();
  });

  it('falls back to the static mock run id when seeded demo tags are unavailable', async () => {
    mockGetExperiment.mockRejectedValue(new Error('No seeded demo tags'));
    mockUseSearchMlflowTraces.mockReturnValue({
      data: [{ trace_id: 'trace-1' }],
      isLoading: false,
      isFetching: false,
      refetchMlflowTraces: jest.fn(),
    });

    renderComponent();

    fireEvent.click(screen.getAllByRole('button', { name: /Find common failure modes/ })[0]);

    await waitFor(() => {
      expect(mockRecordSubmittedIssueDetectionJob).toHaveBeenCalledWith(
        expect.objectContaining({
          runId: 'job_7d3f9a21c',
          mockResult: expect.objectContaining({ issues: 5 }),
        }),
      );
    });
    expect(mockStartMockIssueDetection).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: 'job_7d3f9a21c',
        issueCount: 5,
      }),
    );
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
