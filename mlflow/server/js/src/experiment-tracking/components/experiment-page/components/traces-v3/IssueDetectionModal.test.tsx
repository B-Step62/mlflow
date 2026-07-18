import { describe, test, expect, jest, beforeEach } from '@jest/globals';
import userEvent from '@testing-library/user-event';
import { renderWithDesignSystem, screen, waitFor } from '../../../../../common/utils/TestUtils.react18';
import { IssueDetectionModal } from './IssueDetectionModal';
import { useInvokeIssueDetection } from './hooks/useInvokeIssueDetection';
import { useLocation, useNavigate } from '../../../../../common/utils/RoutingUtils';
import { useLogTelemetryEvent } from '../../../../../telemetry/hooks/useLogTelemetryEvent';
import { useEndpointsQuery } from '../../../../../gateway/hooks/useEndpointsQuery';
import { useApiKeyConfiguration } from '../../../../../gateway/components/model-configuration/hooks/useApiKeyConfiguration';

jest.mock('./hooks/useInvokeIssueDetection');
jest.mock('../../../../../telemetry/hooks/useLogTelemetryEvent', () => ({
  useLogTelemetryEvent: jest.fn(),
}));
jest.mock('../../../../../gateway/hooks/useEndpointsQuery', () => ({
  useEndpointsQuery: jest.fn(),
}));
jest.mock('../../../../../gateway/components/model-configuration/hooks/useApiKeyConfiguration', () => ({
  useApiKeyConfiguration: jest.fn(),
}));
jest.mock('../../../../../common/utils/RoutingUtils', () => ({
  ...jest.requireActual<typeof import('../../../../../common/utils/RoutingUtils')>(
    '../../../../../common/utils/RoutingUtils',
  ),
  useNavigate: jest.fn(),
  useLocation: jest.fn(),
}));

jest.mock('./IssueDetectionProviderPicker', () => ({
  ...jest.requireActual<typeof import('./IssueDetectionProviderPicker')>('./IssueDetectionProviderPicker'),
  IssueDetectionProviderPicker: ({ onChange }: { onChange: (value: unknown) => void }) => (
    <div data-testid="provider-picker">
      <button
        data-testid="pick-anthropic"
        onClick={() => onChange({ mode: 'direct', provider: 'anthropic', model: 'claude-sonnet-4-6' })}
      >
        anthropic
      </button>
    </div>
  ),
}));

describe('IssueDetectionModal', () => {
  const defaultProps = {
    onClose: jest.fn(),
    experimentId: 'exp-123',
  };

  let mockInvokeIssueDetection: jest.Mock;
  let mockNavigate: jest.Mock;
  let mockLogTelemetryEvent: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    mockNavigate = jest.fn();
    jest.mocked(useNavigate).mockReturnValue(mockNavigate);
    jest.mocked(useLocation).mockReturnValue({ search: '', pathname: '/', hash: '', state: null, key: 'default' });
    mockLogTelemetryEvent = jest.fn();
    jest.mocked(useLogTelemetryEvent).mockReturnValue(mockLogTelemetryEvent as any);
    jest.mocked(useEndpointsQuery).mockReturnValue({ data: [], isLoading: false, refetch: jest.fn() } as any);
    jest.mocked(useApiKeyConfiguration).mockReturnValue({
      existingSecrets: [{ secret_id: 'secret-123', secret_name: 'my-key' }],
      hasExistingSecrets: true,
      isLoadingSecrets: false,
      authModes: [],
      defaultAuthMode: '',
      selectedAuthMode: undefined,
      isLoadingProviderConfig: false,
    } as any);

    mockInvokeIssueDetection = jest.fn((_request, options) => {
      (options as { onSuccess?: (response: { job_id: string; run_id: string }) => void })?.onSuccess?.({
        job_id: 'job-123',
        run_id: 'run-456',
      });
    });
    jest.mocked(useInvokeIssueDetection).mockReturnValue({
      mutate: mockInvokeIssueDetection,
      isLoading: false,
      error: null,
      reset: jest.fn(),
    } as any);
  });

  test('renders hero, provider summary, trace count, and Run button', () => {
    const availableTraceIds = Array.from({ length: 40 }, (_, i) => `trace-${i}`);
    renderWithDesignSystem(<IssueDetectionModal {...defaultProps} availableTraceIds={availableTraceIds} />);

    expect(screen.getByText('Detect Issues')).toBeInTheDocument();
    expect(screen.getByText('AI scans your traces and groups failures into issues.')).toBeInTheDocument();
    expect(screen.getByText('Provider')).toBeInTheDocument();
    expect(screen.getByText('OpenAI')).toBeInTheDocument();
    expect(screen.getByText('gpt-5.4')).toBeInTheDocument();
    expect(screen.getByText('40 traces selected')).toBeInTheDocument();
    expect(screen.getByText('Run')).toBeInTheDocument();
    // No API key input anywhere
    expect(screen.queryByText(/API key/i)).not.toBeInTheDocument();
  });

  test('defaults to the first gateway endpoint when endpoints exist', async () => {
    jest
      .mocked(useEndpointsQuery)
      .mockReturnValue({ data: [{ name: 'my-endpoint' }], isLoading: false, refetch: jest.fn() } as any);

    renderWithDesignSystem(<IssueDetectionModal {...defaultProps} initialSelectedTraceIds={['trace-1']} />);

    expect(screen.getByText('my-endpoint')).toBeInTheDocument();

    await userEvent.click(screen.getByText('Run').closest('button')!);
    await waitFor(() => {
      expect(mockInvokeIssueDetection).toHaveBeenCalledWith(
        expect.objectContaining({ endpoint_name: 'my-endpoint', secret_id: undefined }),
        expect.any(Object),
      );
    });
  });

  test('picker is hidden by default and toggles via Change/Hide', async () => {
    renderWithDesignSystem(<IssueDetectionModal {...defaultProps} initialSelectedTraceIds={['trace-1']} />);

    expect(screen.queryByTestId('provider-picker')).not.toBeInTheDocument();

    await userEvent.click(screen.getByText('Change'));
    expect(screen.getByTestId('provider-picker')).toBeInTheDocument();

    await userEvent.click(screen.getByText('Hide'));
    expect(screen.queryByTestId('provider-picker')).not.toBeInTheDocument();
  });

  test('changing provider in the picker updates the summary', async () => {
    renderWithDesignSystem(<IssueDetectionModal {...defaultProps} initialSelectedTraceIds={['trace-1']} />);

    await userEvent.click(screen.getByText('Change'));
    await userEvent.click(screen.getByTestId('pick-anthropic'));

    expect(screen.getByText('Anthropic')).toBeInTheDocument();
    expect(screen.getByText('claude-sonnet-4-6')).toBeInTheDocument();
  });

  test('shows error dialog when submission fails', async () => {
    jest.mocked(useInvokeIssueDetection).mockReturnValue({
      mutate: mockInvokeIssueDetection,
      isLoading: false,
      error: new Error(
        "No API key available for provider 'openai'. Save an API key in AI Gateway, or set the OPENAI_API_KEY environment variable on the MLflow server.",
      ),
      reset: jest.fn(),
    } as any);

    renderWithDesignSystem(<IssueDetectionModal {...defaultProps} initialSelectedTraceIds={['trace-1']} />);

    expect(screen.getByText('Unable to start issue detection')).toBeInTheDocument();
    expect(screen.getByText(/No API key available for provider 'openai'/)).toBeInTheDocument();
    expect(screen.getByText('Open AI Gateway')).toBeInTheDocument();
  });

  test('submits all categories and the saved secret for direct providers', async () => {
    renderWithDesignSystem(<IssueDetectionModal {...defaultProps} initialSelectedTraceIds={['trace-1']} />);

    await userEvent.click(screen.getByText('Run').closest('button')!);

    await waitFor(() => {
      expect(mockInvokeIssueDetection).toHaveBeenCalledWith(
        expect.objectContaining({
          categories: ['correctness', 'latency', 'execution', 'adherence', 'relevance', 'safety'],
          provider: 'openai',
          model: 'gpt-5.4',
          secret_id: 'secret-123',
          endpoint_name: undefined,
        }),
        expect.any(Object),
      );
    });
  });

  test('shows low trace warning with quick select in the traces column', async () => {
    const availableTraceIds = Array.from({ length: 80 }, (_, i) => `trace-${i}`);
    renderWithDesignSystem(
      <IssueDetectionModal
        {...defaultProps}
        initialSelectedTraceIds={['trace-1', 'trace-2', 'trace-3']}
        availableTraceIds={availableTraceIds}
      />,
    );

    expect(screen.getByText('Small samples can miss real issues.')).toBeInTheDocument();

    await userEvent.click(screen.getByTestId('quick-select-traces'));

    expect(screen.getByText('50 traces selected')).toBeInTheDocument();
    expect(screen.queryByText('Small samples can miss real issues.')).not.toBeInTheDocument();
  });

  test('low trace warning has no quick select when no more traces are available', () => {
    renderWithDesignSystem(
      <IssueDetectionModal
        {...defaultProps}
        initialSelectedTraceIds={['trace-1', 'trace-2']}
        availableTraceIds={['trace-1', 'trace-2']}
      />,
    );

    expect(screen.getByText('Small samples can miss real issues.')).toBeInTheDocument();
    expect(screen.queryByTestId('quick-select-traces')).not.toBeInTheDocument();
  });

  test('does not show low trace warning when enough traces are selected', () => {
    const ids = Array.from({ length: 12 }, (_, i) => `trace-${i}`);
    renderWithDesignSystem(<IssueDetectionModal {...defaultProps} initialSelectedTraceIds={ids} />);

    expect(screen.queryByText('Small samples can miss real issues.')).not.toBeInTheDocument();
  });

  test('logs submit context telemetry on submit', async () => {
    renderWithDesignSystem(<IssueDetectionModal {...defaultProps} initialSelectedTraceIds={['trace-1']} />);

    await userEvent.click(screen.getByText('Run').closest('button')!);

    await waitFor(() => {
      expect(mockLogTelemetryEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          componentId: 'mlflow.traces.issue-detection-modal.submit-context',
          value: JSON.stringify({
            selectedTraceCount: 1,
            lowTraceWarningShown: true,
          }),
        }),
      );
    });
  });

  test('Run is disabled when no traces are selected', () => {
    renderWithDesignSystem(<IssueDetectionModal {...defaultProps} />);

    expect(screen.getByText('Run').closest('button')).toBeDisabled();
  });

  test('hands submitted job to parent instead of navigating when onSubmitted is provided', async () => {
    const onSubmitted = jest.fn();
    const onClose = jest.fn();
    renderWithDesignSystem(
      <IssueDetectionModal
        {...defaultProps}
        onClose={onClose}
        onSubmitted={onSubmitted}
        initialSelectedTraceIds={['trace-1']}
      />,
    );

    await userEvent.click(screen.getByText('Run').closest('button')!);

    await waitFor(() => {
      expect(onSubmitted).toHaveBeenCalledWith({ jobId: 'job-123', runId: 'run-456', traceCount: 1 });
      expect(onClose).toHaveBeenCalled();
    });
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  test('navigates to run details page when submitted without onSubmitted', async () => {
    renderWithDesignSystem(<IssueDetectionModal {...defaultProps} initialSelectedTraceIds={['trace-1']} />);

    await userEvent.click(screen.getByText('Run').closest('button')!);

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith({
        pathname: '/experiments/exp-123/evaluation-runs/run-456',
        search: undefined,
      });
    });
  });

  test('preserves only time range query params when navigating to run details', async () => {
    jest.mocked(useLocation).mockReturnValue({
      search: '?startTimeLabel=LAST_7_DAYS&someOtherParam=foo',
      pathname: '/',
      hash: '',
      state: null,
      key: 'default',
    });

    renderWithDesignSystem(<IssueDetectionModal {...defaultProps} initialSelectedTraceIds={['trace-1']} />);

    await userEvent.click(screen.getByText('Run').closest('button')!);

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith({
        pathname: '/experiments/exp-123/evaluation-runs/run-456',
        search: '?startTimeLabel=LAST_7_DAYS',
      });
    });
  });
});
