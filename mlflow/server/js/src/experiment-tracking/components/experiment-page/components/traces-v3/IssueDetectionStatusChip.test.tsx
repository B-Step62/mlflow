import { describe, test, expect, jest, beforeEach } from '@jest/globals';
import userEvent from '@testing-library/user-event';
import { renderWithDesignSystem, screen, waitFor } from '../../../../../common/utils/TestUtils.react18';
import { IssueDetectionStatusChip } from './IssueDetectionStatusChip';
import { JobStatus, useFetchJobStatus } from '../../../run-page/hooks/useFetchJobStatus';
import { useActiveIssueDetectionRun } from './hooks/useActiveIssueDetectionRun';
import { useNavigate } from '../../../../../common/utils/RoutingUtils';

jest.mock('./hooks/useActiveIssueDetectionRun', () => ({
  useActiveIssueDetectionRun: jest.fn(),
}));
jest.mock('../../../run-page/hooks/useFetchJobStatus', () => ({
  ...jest.requireActual<typeof import('../../../run-page/hooks/useFetchJobStatus')>(
    '../../../run-page/hooks/useFetchJobStatus',
  ),
  useFetchJobStatus: jest.fn(),
}));
jest.mock('../../../../../common/utils/RoutingUtils', () => ({
  ...jest.requireActual<typeof import('../../../../../common/utils/RoutingUtils')>(
    '../../../../../common/utils/RoutingUtils',
  ),
  useNavigate: jest.fn(),
}));

const mockJobStatus = (status?: JobStatus, stage?: string, result?: unknown) => {
  jest.mocked(useFetchJobStatus).mockReturnValue({
    status,
    result,
    status_details: stage ? { stage } : undefined,
    isLoading: false,
    isFetching: false,
    refetch: jest.fn(),
    error: null,
  });
};

describe('IssueDetectionStatusChip', () => {
  let mockNavigate: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    mockNavigate = jest.fn();
    jest.mocked(useNavigate).mockReturnValue(mockNavigate);
    jest.mocked(useActiveIssueDetectionRun).mockReturnValue({ activeRun: undefined });
    mockJobStatus(undefined);
  });

  test('renders nothing when there is no active job', () => {
    renderWithDesignSystem(<IssueDetectionStatusChip experimentId="exp-1" />);

    expect(screen.queryByTestId('issue-detection-status-chip')).not.toBeInTheDocument();
  });

  test('shows chip with stage for a running job discovered in the experiment', async () => {
    jest.mocked(useActiveIssueDetectionRun).mockReturnValue({ activeRun: { runId: 'run-1', jobId: 'job-1' } });
    mockJobStatus(JobStatus.RUNNING, 'Scanning traces');

    renderWithDesignSystem(<IssueDetectionStatusChip experimentId="exp-1" />);

    const chip = await screen.findByTestId('issue-detection-status-chip');
    expect(chip).toHaveTextContent('Scanning traces');

    await userEvent.click(chip);
    expect(mockNavigate).toHaveBeenCalledWith('/experiments/exp-1/evaluation-runs/run-1');
  });

  test('shows started notification when a job is submitted from this session', async () => {
    mockJobStatus(JobStatus.PENDING);

    renderWithDesignSystem(
      <IssueDetectionStatusChip
        experimentId="exp-1"
        submittedJob={{ jobId: 'job-1', runId: 'run-1', traceCount: 48 }}
      />,
    );

    expect(await screen.findByText('Issue detection started')).toBeInTheDocument();
    expect(screen.getByText(/Analyzing 48 traces/)).toBeInTheDocument();
    expect(screen.getByText('View progress')).toBeInTheDocument();
  });

  test('shows completion notification with issues link when job succeeds', async () => {
    mockJobStatus(JobStatus.RUNNING);
    const { rerender } = renderWithDesignSystem(
      <IssueDetectionStatusChip
        experimentId="exp-1"
        submittedJob={{ jobId: 'job-1', runId: 'run-1', traceCount: 48 }}
      />,
    );
    await screen.findByTestId('issue-detection-status-chip');

    mockJobStatus(JobStatus.SUCCEEDED, undefined, { issues: 4, total_traces_analyzed: 48 });
    rerender(
      <IssueDetectionStatusChip
        experimentId="exp-1"
        submittedJob={{ jobId: 'job-1', runId: 'run-1', traceCount: 48 }}
      />,
    );

    expect(await screen.findByText('Issue detection completed')).toBeInTheDocument();
    expect(screen.getByText('Found 4 issues across 48 traces.')).toBeInTheDocument();

    await userEvent.click(screen.getByText('View issues'));
    expect(mockNavigate).toHaveBeenCalledWith(expect.stringContaining('/experiments/exp-1/evaluation-runs/run-1'));

    // Chip disappears once the job is complete
    await waitFor(() => {
      expect(screen.queryByTestId('issue-detection-status-chip')).not.toBeInTheDocument();
    });
  });

  test('low-result completion links to details instead of issues', async () => {
    mockJobStatus(JobStatus.RUNNING);
    const { rerender } = renderWithDesignSystem(
      <IssueDetectionStatusChip
        experimentId="exp-1"
        submittedJob={{ jobId: 'job-1', runId: 'run-1', traceCount: 5 }}
      />,
    );
    await screen.findByTestId('issue-detection-status-chip');

    mockJobStatus(JobStatus.SUCCEEDED, undefined, { issues: 0, total_traces_analyzed: 5 });
    rerender(
      <IssueDetectionStatusChip
        experimentId="exp-1"
        submittedJob={{ jobId: 'job-1', runId: 'run-1', traceCount: 5 }}
      />,
    );

    expect(await screen.findByText('Found no issues across 5 traces.')).toBeInTheDocument();
    expect(screen.getByText('View details')).toBeInTheDocument();
    expect(screen.queryByText('View issues')).not.toBeInTheDocument();
  });

  test('shows failure notification when job fails', async () => {
    mockJobStatus(JobStatus.RUNNING);
    const { rerender } = renderWithDesignSystem(
      <IssueDetectionStatusChip
        experimentId="exp-1"
        submittedJob={{ jobId: 'job-1', runId: 'run-1', traceCount: 5 }}
      />,
    );
    await screen.findByTestId('issue-detection-status-chip');

    mockJobStatus(JobStatus.FAILED, undefined, 'boom');
    rerender(
      <IssueDetectionStatusChip
        experimentId="exp-1"
        submittedJob={{ jobId: 'job-1', runId: 'run-1', traceCount: 5 }}
      />,
    );

    expect(await screen.findByText('Issue detection failed')).toBeInTheDocument();
  });

  test('does not show any notification for canceled jobs', async () => {
    mockJobStatus(JobStatus.RUNNING);
    const { rerender } = renderWithDesignSystem(
      <IssueDetectionStatusChip
        experimentId="exp-1"
        submittedJob={{ jobId: 'job-1', runId: 'run-1', traceCount: 5 }}
      />,
    );
    await screen.findByTestId('issue-detection-status-chip');

    mockJobStatus(JobStatus.CANCELED);
    rerender(
      <IssueDetectionStatusChip
        experimentId="exp-1"
        submittedJob={{ jobId: 'job-1', runId: 'run-1', traceCount: 5 }}
      />,
    );

    await waitFor(() => {
      expect(screen.queryByTestId('issue-detection-status-chip')).not.toBeInTheDocument();
    });
    expect(screen.queryByText('Issue detection completed')).not.toBeInTheDocument();
    expect(screen.queryByText('Issue detection failed')).not.toBeInTheDocument();
  });
});
