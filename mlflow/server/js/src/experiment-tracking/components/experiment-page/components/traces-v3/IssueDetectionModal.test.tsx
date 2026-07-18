import { describe, test, expect, jest, beforeEach } from '@jest/globals';
import userEvent from '@testing-library/user-event';
import { AggregationType } from '@databricks/web-shared/model-trace-explorer';
import { renderWithDesignSystem, screen, waitFor } from '../../../../../common/utils/TestUtils.react18';
import { IssueDetectionModal } from './IssueDetectionModal';
import { useCreateSecret } from '../../../../../gateway/hooks/useCreateSecret';
import { useInvokeIssueDetection } from './hooks/useInvokeIssueDetection';
import { useLocation, useNavigate } from '../../../../../common/utils/RoutingUtils';
import { useTraceMetricsQuery } from '../../../../pages/experiment-overview/hooks/useTraceMetricsQuery';
import { useLogTelemetryEvent } from '../../../../../telemetry/hooks/useLogTelemetryEvent';

jest.mock('../../../../../gateway/hooks/useCreateSecret');
jest.mock('./hooks/useInvokeIssueDetection');
jest.mock('../../../../pages/experiment-overview/hooks/useTraceMetricsQuery', () => ({
  useTraceMetricsQuery: jest.fn(),
}));
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
      }: {
        onValidityChange: (isValid: boolean) => void;
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
        </div>
      );
    }),
  };
});

jest.mock('../../../SelectTracesModal', () => ({
  SelectTracesModal: ({
    onClose,
    onSuccess,
    defaultGroupBySession,
  }: {
    onClose: () => void;
    onSuccess: (traceIds: string[]) => void;
    defaultGroupBySession?: boolean;
  }) => (
    <div data-testid="select-traces-modal">
      <div data-testid="default-group-by-session">{String(defaultGroupBySession)}</div>
      <button data-testid="select-traces-cancel" onClick={onClose}>
        Cancel
      </button>
      <button data-testid="select-traces-confirm" onClick={() => onSuccess(['trace-1', 'trace-2'])}>
        Select
      </button>
    </div>
  ),
}));

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
    jest.mocked(useTraceMetricsQuery).mockReturnValue({
      data: { data_points: [{ values: { [AggregationType.COUNT]: 412 } }] },
      isLoading: false,
    } as any);
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

  // Helper to expand the advanced configuration section containing category selection
  const expandAdvancedConfig = async () => {
    await userEvent.click(screen.getByText('Advanced configuration'));
  };

  test('renders traces, model selection, and advanced configuration in a single step', () => {
    renderWithDesignSystem(<IssueDetectionModal {...defaultProps} />);

    expect(screen.getByText('Detect Issues')).toBeInTheDocument();
    expect(screen.getByText('Traces')).toBeInTheDocument();
    expect(screen.getByTestId('model-selection')).toBeInTheDocument();
    expect(screen.getByText('Advanced configuration')).toBeInTheDocument();
    expect(screen.getByText('Run Analysis')).toBeInTheDocument();
  });

  test('shows all categories selected by default in the advanced configuration header', () => {
    renderWithDesignSystem(<IssueDetectionModal {...defaultProps} />);

    expect(screen.getByText('Categories: 6 of 6')).toBeInTheDocument();
  });

  test('category selection is available inside advanced configuration', async () => {
    renderWithDesignSystem(<IssueDetectionModal {...defaultProps} />);

    await expandAdvancedConfig();

    expect(screen.getByText('Correctness')).toBeInTheDocument();
    expect(screen.getByText('Safety')).toBeInTheDocument();
  });

  test('deselecting all categories disables submit and shows validation message', async () => {
    renderWithDesignSystem(<IssueDetectionModal {...defaultProps} initialSelectedTraceIds={['trace-1']} />);

    await userEvent.click(screen.getByTestId('set-valid-existing-key'));
    const submitButton = screen.getByText('Run Analysis').closest('button');
    expect(submitButton).not.toBeDisabled();

    await expandAdvancedConfig();
    for (const category of ['Correctness', 'Latency', 'Execution', 'Adherence', 'Relevance', 'Safety']) {
      await userEvent.click(screen.getByText(category));
    }

    expect(screen.getByText('Categories: 0 of 6')).toBeInTheDocument();
    expect(screen.getByText('Select at least one issue category in Advanced configuration')).toBeInTheDocument();
    expect(submitButton).toBeDisabled();
  });

  test('shows the total trace count of the experiment', () => {
    renderWithDesignSystem(<IssueDetectionModal {...defaultProps} initialSelectedTraceIds={['trace-1']} />);

    expect(screen.getByText('of 412 traces in this experiment')).toBeInTheDocument();
  });

  test('shows low trace warning with quick select when few traces are selected', async () => {
    const availableTraceIds = Array.from({ length: 50 }, (_, i) => `trace-${i}`);
    renderWithDesignSystem(
      <IssueDetectionModal
        {...defaultProps}
        initialSelectedTraceIds={['trace-1', 'trace-2', 'trace-3']}
        availableTraceIds={availableTraceIds}
      />,
    );

    expect(screen.getByText('Small samples can miss real issues')).toBeInTheDocument();
    expect(screen.getByText('Select 30 most recent traces')).toBeInTheDocument();

    await userEvent.click(screen.getByTestId('quick-select-traces'));

    expect(screen.getByText('30 traces selected')).toBeInTheDocument();
    expect(screen.queryByText('Small samples can miss real issues')).not.toBeInTheDocument();
  });

  test('low trace warning falls back to opening trace selection when no more traces are available', async () => {
    renderWithDesignSystem(
      <IssueDetectionModal
        {...defaultProps}
        initialSelectedTraceIds={['trace-1', 'trace-2']}
        availableTraceIds={['trace-1', 'trace-2']}
      />,
    );

    expect(screen.getByText('Small samples can miss real issues')).toBeInTheDocument();

    await userEvent.click(screen.getByTestId('quick-select-traces'));

    expect(screen.getByTestId('select-traces-modal')).toBeInTheDocument();
  });

  test('does not show low trace warning when enough traces are selected', () => {
    const ids = Array.from({ length: 12 }, (_, i) => `trace-${i}`);
    renderWithDesignSystem(<IssueDetectionModal {...defaultProps} initialSelectedTraceIds={ids} />);

    expect(screen.queryByText('Small samples can miss real issues')).not.toBeInTheDocument();
  });

  test('does not show low trace warning when no traces are selected', () => {
    renderWithDesignSystem(<IssueDetectionModal {...defaultProps} />);

    expect(screen.queryByText('Small samples can miss real issues')).not.toBeInTheDocument();
  });

  test('shows estimated cost scaled to the selected trace count', () => {
    const ids = Array.from({ length: 100 }, (_, i) => `trace-${i}`);
    renderWithDesignSystem(<IssueDetectionModal {...defaultProps} initialSelectedTraceIds={ids} />);

    expect(screen.getByText(/Estimated cost: ~\$0\.25–\$1\.00 for 100 traces/)).toBeInTheDocument();
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
            totalTraceCount: 412,
            lowTraceWarningShown: true,
            estimatedCostLowUsd: 0.0025,
            estimatedCostHighUsd: 0.01,
          }),
        }),
      );
    });
  });

  test('renders description text', () => {
    renderWithDesignSystem(<IssueDetectionModal {...defaultProps} />);

    expect(
      screen.getByText('Use AI to automatically analyze your traces and identify potential issues'),
    ).toBeInTheDocument();
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

  test('submit button is enabled when form is valid with existing key', async () => {
    renderWithDesignSystem(<IssueDetectionModal {...defaultProps} initialSelectedTraceIds={['trace-1']} />);
    await userEvent.click(screen.getByTestId('set-valid-existing-key'));

    const submitButton = screen.getByText('Run Analysis').closest('button');
    expect(submitButton).not.toBeDisabled();
  });

  test('submit button is enabled when form is valid with new key', async () => {
    renderWithDesignSystem(<IssueDetectionModal {...defaultProps} initialSelectedTraceIds={['trace-1']} />);
    await userEvent.click(screen.getByTestId('set-valid-new-key'));

    const submitButton = screen.getByText('Run Analysis').closest('button');
    expect(submitButton).not.toBeDisabled();
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

  test('shows trace count when initial traces are provided', async () => {
    renderWithDesignSystem(
      <IssueDetectionModal {...defaultProps} initialSelectedTraceIds={['trace-1', 'trace-2', 'trace-3']} />,
    );

    expect(screen.getByText('3 traces selected')).toBeInTheDocument();
  });

  test('opens select traces modal when button is clicked', async () => {
    renderWithDesignSystem(<IssueDetectionModal {...defaultProps} />);
    await userEvent.click(screen.getByTestId('select-traces'));

    expect(screen.getByTestId('select-traces-modal')).toBeInTheDocument();
  });

  test('updates trace count after selecting traces', async () => {
    renderWithDesignSystem(<IssueDetectionModal {...defaultProps} />);
    await userEvent.click(screen.getByTestId('select-traces'));
    await userEvent.click(screen.getByTestId('select-traces-confirm'));

    expect(screen.getByText('2 traces selected')).toBeInTheDocument();
  });

  test('closes select traces modal when cancel is clicked', async () => {
    renderWithDesignSystem(<IssueDetectionModal {...defaultProps} />);
    await userEvent.click(screen.getByTestId('select-traces'));
    expect(screen.getByTestId('select-traces-modal')).toBeInTheDocument();

    await userEvent.click(screen.getByTestId('select-traces-cancel'));
    expect(screen.queryByTestId('select-traces-modal')).not.toBeInTheDocument();
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

  test('passes defaultGroupBySession prop to SelectTracesModal when set to true', async () => {
    renderWithDesignSystem(
      <IssueDetectionModal {...defaultProps} initialSelectedTraceIds={['trace-1']} defaultGroupBySession />,
    );

    // Open the select traces modal
    const selectTracesButton = screen.getByTestId('select-traces');
    await userEvent.click(selectTracesButton);

    // Verify the SelectTracesModal receives defaultGroupBySession=true
    expect(screen.getByTestId('default-group-by-session')).toHaveTextContent('true');
  });

  test('passes defaultGroupBySession prop to SelectTracesModal when set to false', async () => {
    renderWithDesignSystem(
      <IssueDetectionModal {...defaultProps} initialSelectedTraceIds={['trace-1']} defaultGroupBySession={false} />,
    );

    // Open the select traces modal
    const selectTracesButton = screen.getByTestId('select-traces');
    await userEvent.click(selectTracesButton);

    // Verify the SelectTracesModal receives defaultGroupBySession=false
    expect(screen.getByTestId('default-group-by-session')).toHaveTextContent('false');
  });
});
