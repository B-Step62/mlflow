import React, { useState, useCallback, useRef } from 'react';
import {
  Modal,
  Button,
  useDesignSystemTheme,
  SparkleIcon,
  Typography,
  Alert,
  DesignSystemEventProviderAnalyticsEventTypes,
  DesignSystemEventProviderComponentTypes,
} from '@databricks/design-system';
import { FormattedMessage } from '@databricks/i18n';
import { useLocation, useNavigate } from '../../../../../common/utils/RoutingUtils';
import { shouldEnableBackgroundIssueDetection } from '../../../../../common/utils/FeatureUtils';
import { useLogTelemetryEvent } from '../../../../../telemetry/hooks/useLogTelemetryEvent';
import { estimateIssueDetectionCostUsd, formatEstimatedCostUsd } from './issueDetectionCostEstimate';
import Routes from '../../../../routes';
import { getTimeRangeQueryString } from '../../../../pages/experiment-page-tabs/side-nav/utils';
import { useCreateSecret } from '../../../../../gateway/hooks/useCreateSecret';
import { ALL_ISSUE_CATEGORIES, IssueCategoryList, type IssueCategory } from './IssueDetectionCategories';
import { GenAIModelSelection, type GenAIModelSelectionRef } from './GenAIModelSelection';
import { useInvokeIssueDetection } from './hooks/useInvokeIssueDetection';

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
  const navigate = useNavigate();
  const location = useLocation();
  const logTelemetryEvent = useLogTelemetryEvent();
  const modelSelectionRef = useRef<GenAIModelSelectionRef>(null);

  const [selectedCategories, setSelectedCategories] = useState<Set<IssueCategory>>(new Set(ALL_ISSUE_CATEGORIES));
  const [selectedTraceIds, setSelectedTraceIds] = useState<string[]>(() => {
    return initialSelectedTraceIds.length > 0 ? initialSelectedTraceIds : availableTraceIds;
  });
  const [isModelSelectionValid, setIsModelSelectionValid] = useState(false);

  const showLowTraceWarning = selectedTraceIds.length > 0 && selectedTraceIds.length < MIN_RECOMMENDED_TRACE_COUNT;
  const quickSelectCount = Math.min(QUICK_SELECT_TRACE_COUNT, availableTraceIds.length);
  const canQuickSelectTraces = quickSelectCount > selectedTraceIds.length;
  const estimatedCost = estimateIssueDetectionCostUsd(selectedTraceIds.length);

  const {
    mutate: createSecret,
    isLoading: isCreatingSecret,
    error: createSecretError,
    reset: resetCreateSecret,
  } = useCreateSecret();

  const {
    mutate: invokeIssueDetection,
    isLoading: isInvokingIssueDetection,
    error: issueDetectionError,
    reset: resetIssueDetection,
  } = useInvokeIssueDetection();

  const resetForm = useCallback(() => {
    setSelectedCategories(new Set(ALL_ISSUE_CATEGORIES));
    setSelectedTraceIds([]);
    setIsModelSelectionValid(false);
    modelSelectionRef.current?.reset();
  }, []);

  const handleCategoryToggle = useCallback((categoryId: IssueCategory, isChecked: boolean) => {
    setSelectedCategories((prev) => {
      const next = new Set(prev);
      if (isChecked) {
        next.add(categoryId);
      } else {
        next.delete(categoryId);
      }
      return next;
    });
  }, []);

  const handleSubmit = () => {
    const values = modelSelectionRef.current?.getValues();
    if (!values || !experimentId) return;

    logTelemetryEvent({
      componentId: 'mlflow.traces.issue-detection-modal.submit-context',
      componentType: DesignSystemEventProviderComponentTypes.Card,
      componentViewId: experimentId,
      eventType: DesignSystemEventProviderAnalyticsEventTypes.OnView,
      value: JSON.stringify({
        selectedTraceCount: selectedTraceIds.length,
        lowTraceWarningShown: showLowTraceWarning,
        estimatedCostLowUsd: estimatedCost.low,
        estimatedCostHighUsd: estimatedCost.high,
      }),
    });

    const { mode, endpointName, provider, model, apiKeyConfig, saveKey } = values;

    const submitIssueDetection = (secretId?: string) => {
      invokeIssueDetection(
        {
          experimentId,
          traceIds: selectedTraceIds,
          categories: Array.from(selectedCategories),
          provider,
          model,
          secret_id: secretId,
          endpoint_name: endpointName,
        },
        {
          onSuccess: (response) => {
            const traceCount = selectedTraceIds.length;
            resetForm();
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

    // Endpoint mode - use the selected endpoint
    if (mode === 'endpoint' && endpointName) {
      submitIssueDetection();
      return;
    }

    // Direct mode - save secret if new API key, or use existing secret
    if (mode === 'direct' && saveKey && apiKeyConfig.mode === 'new') {
      const authConfig = { ...apiKeyConfig.newSecret.configFields } satisfies Record<string, string>;
      if (apiKeyConfig.newSecret.authMode) {
        authConfig['auth_mode'] = apiKeyConfig.newSecret.authMode;
      }

      createSecret(
        {
          secret_name: apiKeyConfig.newSecret.name,
          secret_value: apiKeyConfig.newSecret.secretFields,
          provider: provider,
          auth_config: Object.keys(authConfig).length > 0 ? authConfig : undefined,
        },
        {
          onSuccess: (response) => {
            submitIssueDetection(response.secret.secret_id);
          },
        },
      );
    } else if (apiKeyConfig.mode === 'existing' && apiKeyConfig.existingSecretId) {
      submitIssueDetection(apiKeyConfig.existingSecretId);
    }
  };

  const handleClose = useCallback(() => {
    resetForm();
    resetCreateSecret();
    resetIssueDetection();
    onClose();
  }, [resetForm, resetCreateSecret, resetIssueDetection, onClose]);

  const isFormValid = isModelSelectionValid && selectedTraceIds.length > 0 && selectedCategories.size > 0;

  const handleModelSelectionValidityChange = useCallback((isValid: boolean) => {
    setIsModelSelectionValid(isValid);
  }, []);

  const renderFooter = () => (
    <div css={{ display: 'flex', justifyContent: 'flex-end' }}>
      <Button componentId="mlflow.traces.issue-detection-modal.cancel" onClick={handleClose}>
        <FormattedMessage defaultMessage="Cancel" description="Cancel button in issue detection modal" />
      </Button>
      <Button
        componentId="mlflow.traces.issue-detection-modal.submit"
        type="primary"
        onClick={handleSubmit}
        loading={isCreatingSecret || isInvokingIssueDetection}
        disabled={!isFormValid}
      >
        <SparkleIcon css={{ marginRight: theme.spacing.xs }} />
        <FormattedMessage defaultMessage="Run Analysis" description="Submit button to trigger issue detection job" />
      </Button>
    </div>
  );

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
      onCancel={isCreatingSecret || isInvokingIssueDetection ? undefined : handleClose}
      footer={renderFooter()}
    >
      {(createSecretError || issueDetectionError) && (
        <Alert
          componentId="mlflow.traces.issue-detection-modal.error"
          type="error"
          message={createSecretError?.message || issueDetectionError?.message}
          closable
          onClose={() => {
            resetCreateSecret();
            resetIssueDetection();
          }}
          css={{ marginBottom: theme.spacing.md }}
        />
      )}
      <div css={{ display: 'flex', flexDirection: 'column', gap: theme.spacing.md }}>
        <div>
          <Typography.Text css={{ display: 'block' }}>
            <FormattedMessage
              defaultMessage="Analyze {count, plural, one {1 trace} other {# traces}} with AI to identify quality issues."
              description="Summary of how many traces the issue detection run will analyze"
              values={{ count: selectedTraceIds.length }}
            />
          </Typography.Text>
          <Typography.Hint>
            <FormattedMessage
              defaultMessage="Estimated cost: ~{low}–{high} · <link>See benchmark</link>"
              description="Estimated USD cost range for the issue detection run, with link to benchmark docs"
              values={{
                low: formatEstimatedCostUsd(estimatedCost.low),
                high: formatEstimatedCostUsd(estimatedCost.high),
                link: (chunks: React.ReactNode) => (
                  <a
                    href="https://mlflow.org/docs/latest/genai/eval-monitor/ai-insights/detect-issues/#cost-benchmark"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {chunks}
                  </a>
                ),
              }}
            />
          </Typography.Hint>
          {showLowTraceWarning && (
            <Alert
              componentId="mlflow.traces.issue-detection-modal.low-trace-warning"
              type="warning"
              closable={false}
              css={{ marginTop: theme.spacing.sm }}
              message={
                <FormattedMessage
                  defaultMessage="Small samples can miss real issues — we recommend at least {recommended} traces."
                  description="Warning shown when fewer than the recommended number of traces are selected"
                  values={{ recommended: MIN_RECOMMENDED_TRACE_COUNT }}
                />
              }
              description={
                canQuickSelectTraces ? (
                  <Button
                    componentId="mlflow.traces.issue-detection-modal.quick-select-traces"
                    data-testid="quick-select-traces"
                    size="small"
                    onClick={() => setSelectedTraceIds(availableTraceIds.slice(0, quickSelectCount))}
                  >
                    <FormattedMessage
                      defaultMessage="Select {count} most recent traces"
                      description="Button to select the most recent traces in one click"
                      values={{ count: quickSelectCount }}
                    />
                  </Button>
                ) : undefined
              }
            />
          )}
        </div>
        <GenAIModelSelection
          ref={modelSelectionRef}
          onValidityChange={handleModelSelectionValidityChange}
          showConfigureDirectly
          componentId="mlflow.traces.issue-detection-modal"
          description={
            <FormattedMessage
              defaultMessage="Configure the model to power issue detection."
              description="Description for model selection in issue detection modal"
            />
          }
        >
          <div css={{ marginTop: theme.spacing.sm }}>
            <Typography.Text bold css={{ display: 'block', marginBottom: theme.spacing.sm }}>
              <FormattedMessage
                defaultMessage="Issue categories"
                description="Label for the issue category selection inside advanced settings"
              />
            </Typography.Text>
            <IssueCategoryList selectedCategories={selectedCategories} onToggle={handleCategoryToggle} />
          </div>
        </GenAIModelSelection>
        {selectedCategories.size === 0 && (
          <Typography.Text color="error" size="sm">
            <FormattedMessage
              defaultMessage="Select at least one issue category in Advanced settings"
              description="Validation message when no issue categories are selected"
            />
          </Typography.Text>
        )}
      </div>
    </Modal>
  );
};
