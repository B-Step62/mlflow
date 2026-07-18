import { describe, test, expect, jest, beforeEach } from '@jest/globals';
import userEvent from '@testing-library/user-event';
import { renderWithDesignSystem, screen, waitFor } from '../../../../../common/utils/TestUtils.react18';
import { IssueDetectionModal } from './IssueDetectionModal';
import { useCreateSecret } from '../../../../../gateway/hooks/useCreateSecret';
import { useInvokeIssueDetection } from './hooks/useInvokeIssueDetection';
import { useLocation, useNavigate } from '../../../../../common/utils/RoutingUtils';
import { useLogTelemetryEvent } from '../../../../../telemetry/hooks/useLogTelemetryEvent';

jest.mock('../../../../../gateway/hooks/useCreateSecret');
jest.mock('./hooks/useInvokeIssueDetection');
jest.mock('../../../../../telemetry/hooks/useLogTelemetryEvent', () => ({
  useLogTelemetryEvent: jest.fn(),
}));
jest.mock('../../../../../common/utils/RoutingUtils', () => ({
  ...jest.requireActual<typeof import('../../../../../common/utils/RoutingUtils')>(
    '../../../../../common/utils/RoutingUtils',
  ),
  useNavigate: jest.fn(),
  useLocation: jest.fn(),
}));
let mockModelSelectionValues: {
  mode: 'direct' | 'endpoint';
  provider: string;
  model: string;
  apiKeyConfig: {
    mode: 'new' | 'existing';
    existingSecretId: string;
    newSecret: {
      name: string;
      authMode: string;
      secretFields: Record<string, string>;
      configFields: Record<string, string>;
    };
  };
  saveKey: boolean;
} = {
  mode: 'direct',
  provider: '',
  model: '',
  apiKeyConfig: {
    mode: 'new',
    existingSecretId: '',
    newSecret: { name: '', authMode: '', secretFields: {}, configFields: {} },
  },
  saveKey: true,
};
let mockModelSelectionValid = false;

jest.mock('./GenAIModelSelection', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  return {
    GenAIModelSelection: React.forwardRef(function GenAIModelSelection(
      {
        onValidityChange,
        children,
      }: {
        onValidityChange: (isValid: boolean) => void;
        children?: React.ReactNode;
      },
      ref: any,
    ) {
      React.useImperativeHandle(ref, () => ({
        getValues: () => mockModelSelectionValues,
        isValid: mockModelSelectionValid,
        reset: () => {
          mockModelSelectionValues = {
            mode: 'direct',
            provider: '',
            model: '',
            apiKeyConfig: {
              mode: 'new',
              existingSecretId: '',
              newSecret: { name: '', authMode: '', secretFields: {}, configFields: {} },
            },
            saveKey: true,
          };
          mockModelSelectionValid = false;
        },
      }));

      return (
        <div data-testid="model-selection">
          <button
            data-testid="set-valid-existing-key"
            onClick={() => {
              mockModelSelectionValues = {
                mode: 'direct',
                provider: 'openai',
                model: 'gpt-5-mini',
                apiKeyConfig: {
                  mode: 'existing',
                  existingSecretId: 'secret-123',
                  newSecret: { name: '', authMode: '', secretFields: {}, configFields: {} },
                },
                saveKey: false,
              };
              mockModelSelectionValid = true;
              onValidityChange(true);
            }}
          >
            Use existing key
          </button>
          <button
            data-testid="set-valid-new-key"
            onClick={() => {
              mockModelSelectionValues = {
                mode: 'direct',
                provider: 'openai',
                model: 'gpt-5-mini',
                apiKeyConfig: {
                  mode: 'new',
                  existingSecretId: '',
                  newSecret: { name: 'my-key', authMode: '', secretFields: { api_key: 'sk-123' }, configFields: {} },
                },
                saveKey: true,
              };
              mockModelSelectionValid = true;
              onValidityChange(true);
            }}
          >
            Use new key
          </button>
          <button
            data-testid="set-invalid"
            onClick={() => {
              mockModelSelectionValid = false;
              onValidityChange(false);
            }}
          >
            Set invalid
          </button>
          <div data-testid="advanced-settings-content">{children}</div>
        </div>
      );
    }),
  };
});

describe('IssueDetectionModal', () => {
  const defaultProps = {
    onClose: jest.fn(),
    experimentId: 'exp-123',
  };

  let mockCreateSecret: jest.Mock;
  let mockResetCreateSecret: jest.Mock;
  let mockInvokeIssueDetection: jest.Mock;
  let mockResetIssueDetection: jest.Mock;
  let mockNavigate: jest.Mock;
  let mockLogTelemetryEvent: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    mockNavigate = jest.fn();
    jest.mocked(useNavigate).mockReturnValue(mockNavigate);
    jest.mocked(useLocation).mockReturnValue({ search: '', pathname: '/', hash: '', state: null, key: 'default' });
    mockLogTelemetryEvent = jest.fn();
    jest.mocked(useLogTelemetryEvent).mockReturnValue(mockLogTelemetryEvent as any);
    // Reset mock values
    mockModelSelectionValues = {
      mode: 'direct',
      provider: '',
      model: '',
      apiKeyConfig: {
        mode: 'new',
        existingSecretId: '',
        newSecret: { name: '', authMode: '', secretFields: {}, configFields: {} },
      },
      saveKey: true,
    };
    mockModelSelectionValid = false;

    mockCreateSecret = jest.fn((_request, options) => {
      (options as { onSuccess?: (response: { secret: { secret_id: string } }) => void })?.onSuccess?.({
        secret: { secret_id: 'new-secret-123' },
      });
    });
    mockResetCreateSecret = jest.fn();
    mockInvokeIssueDetection = jest.fn((_request, options) => {
      (options as { onSuccess?: (response: { job_id: string; run_id: string }) => void })?.onSuccess?.({
        job_id: 'job-123',
        run_id: 'run-456',
      });
    });
    mockResetIssueDetection = jest.fn();
    jest.mocked(useCreateSecret).mockReturnValue({
      mutate: mockCreateSecret,
      isLoading: false,
      error: null,
      reset: mockResetCreateSecret,
    } as any);
    jest.mocked(useInvokeIssueDetection).mockReturnValue({
      mutate: mockInvokeIssueDetection,
      isLoading: false,
      error: null,
      reset: mockResetIssueDetection,
    } as any);
  });

  test('renders trace summary, model selection, and categories in a single step', () => {
    renderWithDesignSystem(
      <IssueDetectionModal {...defaultProps} initialSelectedTraceIds={['trace-1', 'trace-2', 'trace-3']} />,
    );

    expect(screen.getByText('Detect Issues')).toBeInTheDocument();
    expect(screen.getByText(/Analyze 3 traces/)).toBeInTheDocument();
    expect(screen.getByTestId('model-selection')).toBeInTheDocument();
    expect(screen.getByText('Issue categories')).toBeInTheDocument();
    expect(screen.getByText('Run Analysis')).toBeInTheDocument();
  });

  test('defaults to all available traces when none are preselected', () => {
    const availableTraceIds = Array.from({ length: 40 }, (_, i) => `trace-${i}`);
    renderWithDesignSystem(<IssueDetectionModal {...defaultProps} availableTraceIds={availableTraceIds} />);

    expect(screen.getByText(/Analyze 40 traces/)).toBeInTheDocument();
  });

  test('renders category selection with all categories selected by default', () => {
    renderWithDesignSystem(<IssueDetectionModal {...defaultProps} />);

    expect(screen.getByText('Correctness')).toBeInTheDocument();
    expect(screen.getByText('Safety')).toBeInTheDocument();
    expect(screen.queryByText('Select at least one issue category in Advanced settings')).not.toBeInTheDocument();
  });

  test('deselecting all categories disables submit and shows validation message', async () => {
    renderWithDesignSystem(<IssueDetectionModal {...defaultProps} initialSelectedTraceIds={['trace-1']} />);

    await userEvent.click(screen.getByTestId('set-valid-existing-key'));
    const submitButton = screen.getByText('Run Analysis').closest('button');
    expect(submitButton).not.toBeDisabled();

    for (const category of ['Correctness', 'Latency', 'Execution', 'Adherence', 'Relevance', 'Safety']) {
      await userEvent.click(screen.getByText(category));
    }

    expect(screen.getByText('Select at least one issue category in Advanced settings')).toBeInTheDocument();
    expect(submitButton).toBeDisabled();
  });

  test('shows low trace warning with quick select when few traces are selected', async () => {
    const availableTraceIds = Array.from({ length: 80 }, (_, i) => `trace-${i}`);
    renderWithDesignSystem(
      <IssueDetectionModal
        {...defaultProps}
        initialSelectedTraceIds={['trace-1', 'trace-2', 'trace-3']}
        availableTraceIds={availableTraceIds}
      />,
    );

    expect(screen.getByText(/Small samples can miss real issues/)).toBeInTheDocument();
    expect(screen.getByText('Select 50 most recent traces')).toBeInTheDocument();

    await userEvent.click(screen.getByTestId('quick-select-traces'));

    expect(screen.getByText(/Analyze 50 traces/)).toBeInTheDocument();
    expect(screen.queryByText(/Small samples can miss real issues/)).not.toBeInTheDocument();
  });

  test('low trace warning has no quick select when no more traces are available', () => {
    renderWithDesignSystem(
      <IssueDetectionModal
        {...defaultProps}
        initialSelectedTraceIds={['trace-1', 'trace-2']}
        availableTraceIds={['trace-1', 'trace-2']}
      />,
    );

    expect(screen.getByText(/Small samples can miss real issues/)).toBeInTheDocument();
    expect(screen.queryByTestId('quick-select-traces')).not.toBeInTheDocument();
  });

  test('does not show low trace warning when enough traces are selected', () => {
    const ids = Array.from({ length: 12 }, (_, i) => `trace-${i}`);
    renderWithDesignSystem(<IssueDetectionModal {...defaultProps} initialSelectedTraceIds={ids} />);

    expect(screen.queryByText(/Small samples can miss real issues/)).not.toBeInTheDocument();
  });

  test('logs submit context telemetry on submit', async () => {
    renderWithDesignSystem(<IssueDetectionModal {...defaultProps} initialSelectedTraceIds={['trace-1']} />);
    await userEvent.click(screen.getByTestId('set-valid-existing-key'));
    await userEvent.click(screen.getByText('Run Analysis').closest('button')!);

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

  test('submit button is disabled when form is invalid', async () => {
    renderWithDesignSystem(<IssueDetectionModal {...defaultProps} initialSelectedTraceIds={['trace-1']} />);
    // Form starts invalid
    const submitButton = screen.getByText('Run Analysis').closest('button');
    expect(submitButton).toBeDisabled();

    // Set form to valid state (model valid + traces already selected)
    await userEvent.click(screen.getByTestId('set-valid-existing-key'));
    expect(submitButton).not.toBeDisabled();

    // Set form back to invalid state
    await userEvent.click(screen.getByTestId('set-invalid'));
    expect(submitButton).toBeDisabled();
  });

  test('submit button is disabled when no traces are selected', async () => {
    renderWithDesignSystem(<IssueDetectionModal {...defaultProps} />);
    await userEvent.click(screen.getByTestId('set-valid-existing-key'));

    expect(screen.getByText('Run Analysis').closest('button')).toBeDisabled();
  });

  test('calls onClose when cancel button is clicked', async () => {
    const onClose = jest.fn();

    renderWithDesignSystem(<IssueDetectionModal {...defaultProps} onClose={onClose} />);

    const cancelButton = screen.getByText('Cancel').closest('button')!;
    await userEvent.click(cancelButton);

    expect(onClose).toHaveBeenCalled();
  });

  test('calls onClose when submit is clicked with existing key', async () => {
    const onClose = jest.fn();

    renderWithDesignSystem(
      <IssueDetectionModal {...defaultProps} onClose={onClose} initialSelectedTraceIds={['trace-1']} />,
    );
    await userEvent.click(screen.getByTestId('set-valid-existing-key'));

    const submitButton = screen.getByText('Run Analysis').closest('button')!;
    await userEvent.click(submitButton);

    await waitFor(() => {
      expect(onClose).toHaveBeenCalled();
    });
  });

  test('saves secret when form is submitted with new key', async () => {
    const onClose = jest.fn();

    renderWithDesignSystem(
      <IssueDetectionModal {...defaultProps} onClose={onClose} initialSelectedTraceIds={['trace-1']} />,
    );
    await userEvent.click(screen.getByTestId('set-valid-new-key'));

    const submitButton = screen.getByText('Run Analysis').closest('button')!;
    await userEvent.click(submitButton);

    await waitFor(() => {
      expect(mockCreateSecret).toHaveBeenCalledWith(
        {
          secret_name: 'my-key',
          secret_value: { api_key: 'sk-123' },
          provider: 'openai',
          auth_config: undefined,
        },
        expect.any(Object),
      );
    });
  });

  test('does not save secret when using existing key', async () => {
    const onClose = jest.fn();

    renderWithDesignSystem(
      <IssueDetectionModal {...defaultProps} onClose={onClose} initialSelectedTraceIds={['trace-1']} />,
    );
    await userEvent.click(screen.getByTestId('set-valid-existing-key'));

    const submitButton = screen.getByText('Run Analysis').closest('button')!;
    await userEvent.click(submitButton);

    await waitFor(() => {
      expect(onClose).toHaveBeenCalled();
    });
    expect(mockCreateSecret).not.toHaveBeenCalled();
  });

  test('hands submitted job to parent instead of navigating when onSubmitted is provided', async () => {
    const onSubmitted = jest.fn();
    renderWithDesignSystem(
      <IssueDetectionModal {...defaultProps} onSubmitted={onSubmitted} initialSelectedTraceIds={['trace-1']} />,
    );
    await userEvent.click(screen.getByTestId('set-valid-existing-key'));
    await userEvent.click(screen.getByText('Run Analysis').closest('button')!);

    await waitFor(() => {
      expect(onSubmitted).toHaveBeenCalledWith({ jobId: 'job-123', runId: 'run-456', traceCount: 1 });
    });
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  test('navigates to run details page when form is submitted', async () => {
    const onClose = jest.fn();

    renderWithDesignSystem(
      <IssueDetectionModal {...defaultProps} onClose={onClose} initialSelectedTraceIds={['trace-1']} />,
    );
    await userEvent.click(screen.getByTestId('set-valid-existing-key'));

    const submitButton = screen.getByText('Run Analysis').closest('button')!;
    await userEvent.click(submitButton);

    await waitFor(() => {
      expect(onClose).toHaveBeenCalled();
      expect(mockNavigate).toHaveBeenCalledWith({
        pathname: '/experiments/exp-123/evaluation-runs/run-456',
        search: undefined,
      });
    });
  });

  test('preserves only time range query params when navigating to run details', async () => {
    const onClose = jest.fn();
    jest.mocked(useLocation).mockReturnValue({
      search: '?startTimeLabel=LAST_7_DAYS&someOtherParam=foo',
      pathname: '/',
      hash: '',
      state: null,
      key: 'default',
    });

    renderWithDesignSystem(
      <IssueDetectionModal {...defaultProps} onClose={onClose} initialSelectedTraceIds={['trace-1']} />,
    );
    await userEvent.click(screen.getByTestId('set-valid-existing-key'));

    const submitButton = screen.getByText('Run Analysis').closest('button')!;
    await userEvent.click(submitButton);

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith({
        pathname: '/experiments/exp-123/evaluation-runs/run-456',
        search: '?startTimeLabel=LAST_7_DAYS',
      });
    });
  });
});
