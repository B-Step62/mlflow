import React, { useEffect, useState, useCallback } from 'react';
import {
  Modal,
  Button,
  useDesignSystemTheme,
  SparkleIcon,
  Typography,
  DesignSystemEventProviderAnalyticsEventTypes,
  DesignSystemEventProviderComponentTypes,
} from '@databricks/design-system';
import { FormattedMessage, useIntl } from '@databricks/i18n';
import { useLocation, useNavigate } from '../../../../../common/utils/RoutingUtils';
import { shouldEnableBackgroundIssueDetection } from '../../../../../common/utils/FeatureUtils';
import { useLogTelemetryEvent } from '../../../../../telemetry/hooks/useLogTelemetryEvent';
import Routes from '../../../../routes';
import { getTimeRangeQueryString } from '../../../../pages/experiment-page-tabs/side-nav/utils';
import { useEndpointsQuery } from '../../../../../gateway/hooks/useEndpointsQuery';
import { useApiKeyConfiguration } from '../../../../../gateway/components/model-configuration/hooks/useApiKeyConfiguration';
import { ALL_ISSUE_CATEGORIES } from './IssueDetectionCategories';
import {
  IssueDetectionProviderPicker,
  ISSUE_DETECTION_PROVIDERS,
  GATEWAY_LOGO,
  ProviderLogo,
  type IssueDetectionModelSelection,
} from './IssueDetectionProviderPicker';
import { useInvokeIssueDetection } from './hooks/useInvokeIssueDetection';
import heroImg from '../../../../../common/static/eval-runs-empty.svg';

interface IssueDetectionModalProps {
  onClose: () => void;
  experimentId?: string;
  initialSelectedTraceIds?: string[];
  availableTraceIds?: string[];
  /**
   * When provided (and background issue detection is enabled), the modal hands the
   * submitted job to the parent for background tracking instead of navigating away.
   */
  onSubmitted?: (job: { jobId: string; runId: string; traceCount: number }) => void;
}

const MIN_RECOMMENDED_TRACE_COUNT = 10;
const QUICK_SELECT_TRACE_COUNT = 50;

export const IssueDetectionModal: React.FC<IssueDetectionModalProps> = ({
  onClose,
  experimentId,
  initialSelectedTraceIds = [],
  availableTraceIds = [],
  onSubmitted,
}) => {
  const { theme } = useDesignSystemTheme();
  const intl = useIntl();
  const navigate = useNavigate();
  const location = useLocation();
  const logTelemetryEvent = useLogTelemetryEvent();

  const [selectedTraceIds, setSelectedTraceIds] = useState<string[]>(() => {
    return initialSelectedTraceIds.length > 0 ? initialSelectedTraceIds : availableTraceIds;
  });
  const [selection, setSelection] = useState<IssueDetectionModelSelection | null>(null);
  const [isPickerExpanded, setIsPickerExpanded] = useState(false);

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

  // Direct providers use the API key already saved in AI Gateway (never asked here)
  const { existingSecrets } = useApiKeyConfiguration({
    provider: selection?.mode === 'direct' ? selection.provider : ISSUE_DETECTION_PROVIDERS[0].id,
  });

  const showLowTraceWarning = selectedTraceIds.length > 0 && selectedTraceIds.length < MIN_RECOMMENDED_TRACE_COUNT;
  const quickSelectCount = Math.min(QUICK_SELECT_TRACE_COUNT, availableTraceIds.length);
  const canQuickSelectTraces = quickSelectCount > selectedTraceIds.length;

  const {
    mutate: invokeIssueDetection,
    isLoading: isInvokingIssueDetection,
    error: issueDetectionError,
    reset: resetIssueDetection,
  } = useInvokeIssueDetection();

  const isFormValid =
    selectedTraceIds.length > 0 &&
    Boolean(
      selection && (selection.mode === 'endpoint' ? selection.endpointName : selection.provider && selection.model),
    );

  const handleSubmit = () => {
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
        secret_id: selection.mode === 'direct' ? existingSecrets[0]?.secret_id : undefined,
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

  const handleClose = useCallback(() => {
    resetIssueDetection();
    onClose();
  }, [resetIssueDetection, onClose]);

  const renderProviderSummary = () => {
    if (!selection) {
      return null;
    }
    const isEndpoint = selection.mode === 'endpoint';
    const provider = ISSUE_DETECTION_PROVIDERS.find((p) => p.id === selection.provider);
    const logo = isEndpoint ? GATEWAY_LOGO : provider?.logo;
    const name = isEndpoint ? selection.endpointName : (provider?.name ?? selection.provider);

    return (
      <div css={{ display: 'flex', alignItems: 'center', gap: theme.spacing.sm }}>
        {logo && <ProviderLogo src={logo} />}
        <div css={{ minWidth: 0, textAlign: 'left' }}>
          <Typography.Text css={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {name}
          </Typography.Text>
          {!isEndpoint && selection.model && <Typography.Hint>{selection.model}</Typography.Hint>}
        </div>
      </div>
    );
  };

  return (
    <Modal
      componentId="mlflow.traces.issue-detection-modal"
      visible
      onCancel={isInvokingIssueDetection ? undefined : handleClose}
      footer={
        <Button
          componentId="mlflow.traces.issue-detection-modal.submit"
          type="primary"
          onClick={handleSubmit}
          loading={isInvokingIssueDetection}
          disabled={!isFormValid}
        >
          <SparkleIcon css={{ marginRight: theme.spacing.xs }} />
          <FormattedMessage defaultMessage="Run" description="Submit button to trigger issue detection job" />
        </Button>
      }
    >
      {issueDetectionError && (
        <Modal
          componentId="mlflow.traces.issue-detection-modal.error"
          visible
          title={
            <FormattedMessage
              defaultMessage="Unable to start issue detection"
              description="Title of the dialog shown when submitting an issue detection job fails"
            />
          }
          onCancel={() => resetIssueDetection()}
          footer={
            <Button componentId="mlflow.traces.issue-detection-modal.error-close" onClick={() => resetIssueDetection()}>
              <FormattedMessage defaultMessage="Close" description="Button to dismiss the submission error dialog" />
            </Button>
          }
        >
          <Typography.Text css={{ display: 'block', marginBottom: theme.spacing.sm }}>
            {issueDetectionError.message}
          </Typography.Text>
          <Typography.Link componentId="mlflow.traces.issue-detection-modal.gateway-link" href="#/gateway" openInNewTab>
            <FormattedMessage
              defaultMessage="Open AI Gateway"
              description="Link to the AI Gateway page from the submission error dialog"
            />
          </Typography.Link>
        </Modal>
      )}
      <div css={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
        <img
          src={heroImg}
          alt={intl.formatMessage({
            defaultMessage: 'Illustration of traces being analyzed for issues',
            description: 'Alt text for the issue detection illustration',
          })}
          css={{ maxWidth: '100%', maxHeight: 160 }}
        />
        <Typography.Title level={3} css={{ marginTop: theme.spacing.lg, marginBottom: theme.spacing.xs }}>
          <FormattedMessage
            defaultMessage="Detect Issues"
            description="Title of the issue detection configuration modal"
          />
        </Typography.Title>
        <Typography.Text color="secondary">
          <FormattedMessage
            defaultMessage="AI scans your traces and groups failures into issues."
            description="Description text for issue detection modal"
          />
        </Typography.Text>
      </div>
      <div
        css={{
          display: 'flex',
          gap: theme.spacing.lg,
          marginTop: theme.spacing.lg,
          paddingTop: theme.spacing.md,
          borderTop: `1px solid ${theme.colors.border}`,
        }}
      >
        <div css={{ flex: 1, minWidth: 0 }}>
          <Typography.Text bold color="secondary" css={{ display: 'block', marginBottom: theme.spacing.xs }}>
            <FormattedMessage defaultMessage="Provider" description="Column header for the model provider" />
          </Typography.Text>
          {renderProviderSummary()}
          <Typography.Link
            componentId="mlflow.traces.issue-detection-modal.change-model"
            onClick={() => setIsPickerExpanded((expanded) => !expanded)}
          >
            {isPickerExpanded ? (
              <FormattedMessage defaultMessage="Hide" description="Link to collapse the model provider picker" />
            ) : (
              <FormattedMessage defaultMessage="Change" description="Link to expand the model provider picker" />
            )}
          </Typography.Link>
        </div>
        <div css={{ flex: 1, minWidth: 0 }}>
          <Typography.Text bold color="secondary" css={{ display: 'block', marginBottom: theme.spacing.xs }}>
            <FormattedMessage defaultMessage="Traces" description="Column header for the analyzed traces" />
          </Typography.Text>
          <Typography.Text>
            <FormattedMessage
              defaultMessage="{count, plural, one {1 trace selected} other {# traces selected}}"
              description="Label showing number of traces selected"
              values={{ count: selectedTraceIds.length }}
            />
          </Typography.Text>
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
      {isPickerExpanded && selection && (
        <div data-testid="model-picker" css={{ marginTop: theme.spacing.md }}>
          <IssueDetectionProviderPicker endpoints={endpoints} value={selection} onChange={setSelection} />
        </div>
      )}
    </Modal>
  );
};
