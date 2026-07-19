import React, { useEffect, useState, useCallback } from 'react';
import {
  Modal,
  Button,
  Input,
  PencilIcon,
  useDesignSystemTheme,
  SparkleIcon,
  Tooltip,
  Typography,
  Alert,
  DesignSystemEventProviderAnalyticsEventTypes,
  DesignSystemEventProviderComponentTypes,
} from '@databricks/design-system';
import { FormattedMessage, useIntl } from '@databricks/i18n';
import { useLocation, useNavigate } from '../../../../../common/utils/RoutingUtils';
import { shouldEnableBackgroundIssueDetection } from '../../../../../common/utils/FeatureUtils';
import { generateRandomName } from '../../../../../common/utils/NameUtils';
import { useLogTelemetryEvent } from '../../../../../telemetry/hooks/useLogTelemetryEvent';
import Routes from '../../../../routes';
import { getTimeRangeQueryString } from '../../../../pages/experiment-page-tabs/side-nav/utils';
import { useCreateSecret } from '../../../../../gateway/hooks/useCreateSecret';
import { SelectTracesModal } from '../../../SelectTracesModal';
import { useEndpointsQuery } from '../../../../../gateway/hooks/useEndpointsQuery';
import { useApiKeyConfiguration } from '../../../../../gateway/components/model-configuration/hooks/useApiKeyConfiguration';
import { ALL_ISSUE_CATEGORIES } from './IssueDetectionCategories';
import {
  IssueDetectionModelDropdown,
  ISSUE_DETECTION_PROVIDERS,
  ProviderLogo,
  type IssueDetectionModelSelection,
} from './IssueDetectionModelDropdown';
import { useInvokeIssueDetection } from './hooks/useInvokeIssueDetection';
import { useActiveIssueDetectionRun } from './hooks/useActiveIssueDetectionRun';
import { estimateIssueDetectionCostUsd, formatEstimatedCostUsd } from './issueDetectionCostEstimate';
import heroImg from '../../../../../common/static/issue-detection-empty.svg';

interface IssueDetectionModalProps {
  onClose: () => void;
  experimentId?: string;
  initialSelectedTraceIds?: string[];
  availableTraceIds?: string[];
  defaultGroupBySession?: boolean;
  /**
   * When provided (and background issue detection is enabled), the modal hands the
   * submitted job to the parent for background tracking instead of navigating away.
   */
  onSubmitted?: (job: { jobId: string; runId: string; traceCount: number }) => void;
}

const MIN_RECOMMENDED_TRACE_COUNT = 10;
const QUICK_SELECT_TRACE_COUNT = 50;

const MISSING_API_KEY_ERROR_FRAGMENT = 'No API key available';

type ModalView = 'main' | 'apiKey';

export const IssueDetectionModal: React.FC<IssueDetectionModalProps> = ({
  onClose,
  experimentId,
  initialSelectedTraceIds = [],
  availableTraceIds = [],
  defaultGroupBySession = false,
  onSubmitted,
}) => {
  const { theme } = useDesignSystemTheme();
  const intl = useIntl();
  const navigate = useNavigate();
  const location = useLocation();
  const logTelemetryEvent = useLogTelemetryEvent();

  // Without an explicit table selection, default to the most recent traces
  const [selectedTraceIds, setSelectedTraceIds] = useState<string[]>(() => {
    return initialSelectedTraceIds.length > 0
      ? initialSelectedTraceIds
      : availableTraceIds.slice(0, QUICK_SELECT_TRACE_COUNT);
  });
  const [selection, setSelection] = useState<IssueDetectionModelSelection | null>(null);
  const [view, setView] = useState<ModalView>('main');
  const [apiKeyDraft, setApiKeyDraft] = useState('');
  const [isSelectTracesModalOpen, setIsSelectTracesModalOpen] = useState(false);

  const { data: endpoints, isLoading: isLoadingEndpoints } = useEndpointsQuery();

  // Default to the first gateway endpoint, else the first core provider
  useEffect(() => {
    if (!selection && !isLoadingEndpoints) {
      const provider = ISSUE_DETECTION_PROVIDERS[0];
      if (endpoints.length > 0) {
        setSelection({
          mode: 'endpoint',
          endpointName: endpoints[0].name,
          provider: provider.id,
          model: provider.defaultModel,
        });
      } else {
        setSelection({ mode: 'direct', provider: provider.id, model: provider.defaultModel });
      }
    }
  }, [selection, isLoadingEndpoints, endpoints]);

  // Direct providers use the API key already saved in AI Gateway (never asked upfront)
  const { existingSecrets } = useApiKeyConfiguration({
    provider: selection?.mode === 'direct' ? selection.provider : ISSUE_DETECTION_PROVIDERS[0].id,
  });

  // Surface an indicator if a run is already in progress in this experiment
  const { activeRun } = useActiveIssueDetectionRun({ experimentId, enabled: Boolean(experimentId) });

  const hasNoTraces = selectedTraceIds.length === 0 && availableTraceIds.length === 0;
  const showLowTraceWarning = selectedTraceIds.length > 0 && selectedTraceIds.length < MIN_RECOMMENDED_TRACE_COUNT;
  const quickSelectCount = Math.min(QUICK_SELECT_TRACE_COUNT, availableTraceIds.length);
  const canQuickSelectTraces = quickSelectCount > selectedTraceIds.length;
  const estimatedCost = estimateIssueDetectionCostUsd(selectedTraceIds.length);

  const {
    mutate: invokeIssueDetection,
    isLoading: isInvokingIssueDetection,
    error: issueDetectionError,
    reset: resetIssueDetection,
  } = useInvokeIssueDetection();

  const {
    mutate: createSecret,
    isLoading: isCreatingSecret,
    error: createSecretError,
    reset: resetCreateSecret,
  } = useCreateSecret();

  // The server rejects keyless submissions upfront; turn that into the API key step
  const isMissingKeyError = Boolean(issueDetectionError?.message.includes(MISSING_API_KEY_ERROR_FRAGMENT));
  useEffect(() => {
    if (isMissingKeyError) {
      setView('apiKey');
      resetIssueDetection();
    }
  }, [isMissingKeyError, resetIssueDetection]);

  const isFormValid =
    selectedTraceIds.length > 0 &&
    Boolean(
      selection && (selection.mode === 'endpoint' ? selection.endpointName : selection.provider && selection.model),
    );

  const submitRun = (secretIdOverride?: string) => {
    if (!selection || !experimentId) return;

    logTelemetryEvent({
      componentId: 'mlflow.traces.issue-detection-modal.submit-context',
      componentType: DesignSystemEventProviderComponentTypes.Card,
      componentViewId: experimentId,
      eventType: DesignSystemEventProviderAnalyticsEventTypes.OnView,
      value: JSON.stringify({
        selectedTraceCount: selectedTraceIds.length,
        lowTraceWarningShown: showLowTraceWarning,
      }),
    });

    invokeIssueDetection(
      {
        experimentId,
        traceIds: selectedTraceIds,
        categories: ALL_ISSUE_CATEGORIES,
        provider: selection.provider,
        model: selection.model,
        secret_id: selection.mode === 'direct' ? (secretIdOverride ?? existingSecrets[0]?.secret_id) : undefined,
        endpoint_name: selection.mode === 'endpoint' ? selection.endpointName : undefined,
      },
      {
        onSuccess: (response) => {
          const traceCount = selectedTraceIds.length;
          onClose();
          if (shouldEnableBackgroundIssueDetection() && onSubmitted) {
            onSubmitted({ jobId: response.job_id, runId: response.run_id, traceCount });
            return;
          }
          navigate({
            pathname: Routes.getIssueDetectionRunDetailsRoute(experimentId, response.run_id),
            search: getTimeRangeQueryString(location.search),
          });
        },
      },
    );
  };

  const handleContinueAndRun = () => {
    if (!selection || !apiKeyDraft.trim()) return;
    createSecret(
      {
        secret_name: generateRandomName(selection.provider),
        secret_value: { api_key: apiKeyDraft.trim() },
        provider: selection.provider,
      },
      {
        onSuccess: (response) => {
          submitRun(response.secret.secret_id);
        },
      },
    );
  };

  const handleClose = useCallback(() => {
    resetIssueDetection();
    resetCreateSecret();
    onClose();
  }, [resetIssueDetection, resetCreateSecret, onClose]);

  const selectedProvider = ISSUE_DETECTION_PROVIDERS.find((p) => p.id === selection?.provider);

  const summaryCardCss = {
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing.sm,
    padding: theme.spacing.sm,
    border: `1px solid ${theme.colors.border}`,
    borderRadius: theme.borders.borderRadiusMd,
    cursor: 'pointer',
    '&:hover': {
      backgroundColor: theme.colors.actionTertiaryBackgroundHover,
      borderColor: theme.colors.actionDefaultBorderHover,
    },
  } as const;

  const renderMainView = () => (
    <>
      {activeRun && (
        <Alert
          componentId="mlflow.traces.issue-detection-modal.active-run-banner"
          type="info"
          closable={false}
          css={{ marginBottom: theme.spacing.md }}
          message={
            <FormattedMessage
              defaultMessage="An issue detection run is already in progress."
              description="Banner shown in the modal when an issue detection run is already running"
            />
          }
          description={
            <Typography.Link
              componentId="mlflow.traces.issue-detection-modal.active-run-view-progress"
              onClick={() => {
                if (experimentId) {
                  handleClose();
                  navigate(Routes.getIssueDetectionRunDetailsRoute(experimentId, activeRun.runId));
                }
              }}
            >
              <FormattedMessage
                defaultMessage="View progress"
                description="Link to the in-progress issue detection run from the modal banner"
              />
            </Typography.Link>
          }
        />
      )}
      <div css={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
        <img
          src={heroImg}
          alt={intl.formatMessage({
            defaultMessage: 'Illustration of traces being analyzed for issues',
            description: 'Alt text for the issue detection illustration',
          })}
          css={{ maxWidth: '100%', maxHeight: 120 }}
        />
        <Typography.Text css={{ marginTop: theme.spacing.md }}>
          <FormattedMessage
            defaultMessage="Find failure patterns hiding in your traces, automatically."
            description="Headline for the issue detection modal"
          />
        </Typography.Text>
        <Typography.Text color="secondary" css={{ marginTop: theme.spacing.xs }}>
          <FormattedMessage
            defaultMessage="AI reviews every trace, groups failures into issues, and shows you what to fix. No manual trace reading required."
            description="Supporting description for the issue detection modal"
          />
        </Typography.Text>
      </div>
      <div
        css={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: theme.spacing.md,
          marginTop: theme.spacing.md,
          paddingTop: theme.spacing.sm,
          borderTop: `1px solid ${theme.colors.border}`,
        }}
      >
        <div css={{ flex: 1, minWidth: 0 }}>
          <Typography.Text bold color="secondary" css={{ display: 'block', marginBottom: theme.spacing.xs }}>
            <FormattedMessage
              defaultMessage="Model"
              description="Column header for the model powering issue detection"
            />
          </Typography.Text>
          {selection && <IssueDetectionModelDropdown endpoints={endpoints} value={selection} onChange={setSelection} />}
        </div>
        <div css={{ flex: 1, minWidth: 0 }}>
          <Typography.Text bold color="secondary" css={{ display: 'block', marginBottom: theme.spacing.xs }}>
            <FormattedMessage defaultMessage="Traces" description="Column header for the analyzed traces" />
          </Typography.Text>
          {hasNoTraces ? (
            <Typography.Text css={{ display: 'block' }} color="secondary">
              <FormattedMessage
                defaultMessage="No traces yet. Log traces to this experiment first."
                description="Message shown in the issue detection modal when the experiment has no traces"
              />
            </Typography.Text>
          ) : (
            <div
              role="button"
              tabIndex={0}
              data-testid="traces-card"
              onClick={() => setIsSelectTracesModalOpen(true)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') setIsSelectTracesModalOpen(true);
              }}
              css={summaryCardCss}
            >
              <div css={{ minWidth: 0, flex: 1, textAlign: 'left' }}>
                <Typography.Text css={{ display: 'block' }}>
                  <FormattedMessage
                    defaultMessage="{count, plural, one {1 trace selected} other {# traces selected}}"
                    description="Label showing number of traces selected"
                    values={{ count: selectedTraceIds.length }}
                  />
                </Typography.Text>
                {selectedTraceIds.length > 0 && (
                  <Typography.Hint>
                    <FormattedMessage
                      defaultMessage="Estimated cost: ~{low}-{high}"
                      description="Estimated USD cost range for the issue detection run"
                      values={{
                        low: formatEstimatedCostUsd(estimatedCost.low),
                        high: formatEstimatedCostUsd(estimatedCost.high),
                      }}
                    />
                  </Typography.Hint>
                )}
              </div>
              <PencilIcon css={{ color: theme.colors.textSecondary }} />
            </div>
          )}
          {showLowTraceWarning && (
            <div css={{ marginTop: theme.spacing.xs }}>
              <Typography.Text size="sm" css={{ display: 'block', color: theme.colors.textValidationWarning }}>
                <FormattedMessage
                  defaultMessage="Small samples can miss real issues."
                  description="Warning shown when fewer than the recommended number of traces are selected"
                />
              </Typography.Text>
              {canQuickSelectTraces && (
                <Button
                  componentId="mlflow.traces.issue-detection-modal.quick-select-traces"
                  data-testid="quick-select-traces"
                  size="small"
                  css={{ marginTop: theme.spacing.xs }}
                  onClick={() => setSelectedTraceIds(availableTraceIds.slice(0, quickSelectCount))}
                >
                  <FormattedMessage
                    defaultMessage="Select {count} most recent traces"
                    description="Button to select the most recent traces in one click"
                    values={{ count: quickSelectCount }}
                  />
                </Button>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );

  const renderApiKeyView = () => (
    <div data-testid="api-key-view" css={{ display: 'flex', flexDirection: 'column', gap: theme.spacing.md }}>
      <Typography.Text bold css={{ textAlign: 'center', marginTop: theme.spacing.sm }}>
        <FormattedMessage
          defaultMessage="One last step to run issue detection"
          description="Headline of the API key step in the issue detection modal"
        />
      </Typography.Text>
      <div css={{ display: 'flex', alignItems: 'center', gap: theme.spacing.sm }}>
        {selectedProvider && <ProviderLogo src={selectedProvider.logo} />}
        <Typography.Text color="secondary">
          <FormattedMessage
            defaultMessage="{provider} needs an API key. Paste it once and MLflow saves it securely in AI Gateway for all future runs."
            description="Explanation of the API key step in the issue detection modal"
            values={{ provider: selectedProvider?.name ?? selection?.provider }}
          />
        </Typography.Text>
      </div>
      <Input
        componentId="mlflow.traces.issue-detection-modal.api-key-input"
        data-testid="api-key-input"
        type="password"
        value={apiKeyDraft}
        onChange={(e) => setApiKeyDraft(e.target.value)}
        placeholder={intl.formatMessage({
          defaultMessage: 'API key',
          description: 'Placeholder of the API key input in the issue detection modal',
        })}
      />
      {createSecretError && (
        <Alert
          componentId="mlflow.traces.issue-detection-modal.error"
          type="error"
          message={createSecretError.message}
          closable
          onClose={() => resetCreateSecret()}
        />
      )}
    </div>
  );

  const renderFooter = () => {
    if (view === 'apiKey') {
      return (
        <>
          <Button
            componentId="mlflow.traces.issue-detection-modal.api-key-back"
            onClick={() => {
              resetCreateSecret();
              setView('main');
            }}
          >
            <FormattedMessage defaultMessage="Back" description="Button to go back from the API key step" />
          </Button>
          <Button
            componentId="mlflow.traces.issue-detection-modal.api-key-continue"
            type="primary"
            onClick={handleContinueAndRun}
            loading={isCreatingSecret || isInvokingIssueDetection}
            disabled={!apiKeyDraft.trim()}
          >
            <SparkleIcon css={{ marginRight: theme.spacing.xs }} />
            <FormattedMessage
              defaultMessage="Continue and run"
              description="Button to save the API key and start issue detection"
            />
          </Button>
        </>
      );
    }
    return (
      <Tooltip
        componentId="mlflow.traces.issue-detection-modal.submit.tooltip"
        content={
          isFormValid ? null : hasNoTraces ? (
            <FormattedMessage
              defaultMessage="No traces to analyze. Log traces to this experiment first."
              description="Tooltip on the disabled Run button when the experiment has no traces"
            />
          ) : (
            <FormattedMessage
              defaultMessage="Select traces to analyze first."
              description="Tooltip on the disabled Run button when no traces are selected"
            />
          )
        }
      >
        <span css={{ display: 'inline-block' }}>
          <Button
            componentId="mlflow.traces.issue-detection-modal.submit"
            type="primary"
            onClick={() => submitRun()}
            loading={isInvokingIssueDetection}
            disabled={!isFormValid}
          >
            <SparkleIcon css={{ marginRight: theme.spacing.xs }} />
            <FormattedMessage
              defaultMessage="Run Analysis"
              description="Submit button to trigger issue detection job"
            />
          </Button>
        </span>
      </Tooltip>
    );
  };

  return (
    <Modal
      componentId="mlflow.traces.issue-detection-modal"
      title={
        <div css={{ display: 'flex', alignItems: 'center', gap: theme.spacing.sm }}>
          <SparkleIcon color="ai" />
          <FormattedMessage
            defaultMessage="Detect Issues"
            description="Title of the issue detection configuration modal"
          />
        </div>
      }
      visible
      dangerouslySetAntdProps={{
        width: 520,
        // The modal's dynamic sizing under-allocates the body by ~16px, leaving a
        // spurious scrollbar. Disable body scrolling (content is always well under the
        // viewport height) and reserve bottom padding so nothing real is clipped.
        bodyStyle: { paddingLeft: 32, paddingRight: 32, paddingBottom: 24, overflowY: 'hidden' },
      }}
      onCancel={isInvokingIssueDetection || isCreatingSecret ? undefined : handleClose}
      footer={renderFooter()}
    >
      {issueDetectionError && !isMissingKeyError && (
        <Alert
          componentId="mlflow.traces.issue-detection-modal.error"
          type="error"
          message={issueDetectionError.message}
          closable
          onClose={() => resetIssueDetection()}
          css={{ marginBottom: theme.spacing.md }}
        />
      )}
      {view === 'main' && renderMainView()}
      {view === 'apiKey' && renderApiKeyView()}
      {isSelectTracesModalOpen && (
        <SelectTracesModal
          onClose={() => setIsSelectTracesModalOpen(false)}
          onSuccess={(traceIds) => {
            setSelectedTraceIds(traceIds);
            setIsSelectTracesModalOpen(false);
          }}
          initialTraceIdsSelected={selectedTraceIds}
          defaultGroupBySession={defaultGroupBySession}
        />
      )}
    </Modal>
  );
};
