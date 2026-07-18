import React, { useState, useCallback, useRef } from 'react';
import {
  Accordion,
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
import { MetricViewType, AggregationType, TraceMetricKey } from '@databricks/web-shared/model-trace-explorer';
import { useLocation, useNavigate } from '../../../../../common/utils/RoutingUtils';
import { useTraceMetricsQuery } from '../../../../pages/experiment-overview/hooks/useTraceMetricsQuery';
import { useLogTelemetryEvent } from '../../../../../telemetry/hooks/useLogTelemetryEvent';
import { estimateIssueDetectionCostUsd, formatEstimatedCostUsd } from './issueDetectionCostEstimate';
import Routes from '../../../../routes';
import { getTimeRangeQueryString } from '../../../../pages/experiment-page-tabs/side-nav/utils';
import { SelectTracesModal } from '../../../SelectTracesModal';
import { useCreateSecret } from '../../../../../gateway/hooks/useCreateSecret';
import { ALL_ISSUE_CATEGORIES, IssueCategoryList, type IssueCategory } from './IssueDetectionCategories';
import { GenAIModelSelection, type GenAIModelSelectionRef } from './GenAIModelSelection';
import { useInvokeIssueDetection } from './hooks/useInvokeIssueDetection';

interface IssueDetectionModalProps {
  onClose: () => void;
  experimentId?: string;
  initialSelectedTraceIds?: string[];
  availableTraceIds?: string[];
  defaultGroupBySession?: boolean;
}

const MIN_RECOMMENDED_TRACE_COUNT = 10;
const QUICK_SELECT_TRACE_COUNT = 30;

export const IssueDetectionModal: React.FC<IssueDetectionModalProps> = ({
  onClose,
  experimentId,
  initialSelectedTraceIds = [],
  availableTraceIds = [],
  defaultGroupBySession = false,
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
  const [isSelectTracesModalOpen, setIsSelectTracesModalOpen] = useState(false);
  const [isModelSelectionValid, setIsModelSelectionValid] = useState(false);

  const { data: traceCountMetrics } = useTraceMetricsQuery({
    experimentIds: experimentId ? [experimentId] : [],
    viewType: MetricViewType.TRACES,
    metricName: TraceMetricKey.TRACE_COUNT,
    aggregations: [{ aggregation_type: AggregationType.COUNT }],
    enabled: Boolean(experimentId),
  });
  const totalTraceCount = traceCountMetrics?.data_points?.[0]?.values?.[AggregationType.COUNT];

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
        totalTraceCount: totalTraceCount ?? null,
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
            resetForm();
            onClose();
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
    <>
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
        <Typography.Text color="secondary" css={{ display: 'block', marginBottom: theme.spacing.lg }}>
          <FormattedMessage
            defaultMessage="Use AI to automatically analyze your traces and identify potential issues"
            description="Description text for issue detection modal"
          />
        </Typography.Text>
        <div css={{ display: 'flex', flexDirection: 'column', gap: theme.spacing.lg }}>
          <div>
            <Typography.Text bold>
              <FormattedMessage defaultMessage="Traces" description="Section header for trace selection" />
            </Typography.Text>
            <Typography.Text color="secondary" css={{ display: 'block', marginTop: theme.spacing.xs }}>
              <FormattedMessage
                defaultMessage="Select the traces to analyze for issues"
                description="Description for trace selection section"
              />
            </Typography.Text>
            <div css={{ marginTop: theme.spacing.sm, display: 'flex', alignItems: 'center', gap: theme.spacing.sm }}>
              <Button
                componentId="mlflow.traces.issue-detection-modal.select-traces"
                data-testid="select-traces"
                onClick={() => setIsSelectTracesModalOpen(true)}
              >
                {selectedTraceIds.length > 0 ? (
                  <FormattedMessage
                    defaultMessage="{count, plural, one {1 trace selected} other {# traces selected}}"
                    description="Label showing number of traces selected"
                    values={{ count: selectedTraceIds.length }}
                  />
                ) : (
                  <FormattedMessage
                    defaultMessage="Select traces"
                    description="Button to open trace selection modal"
                  />
                )}
              </Button>
              {totalTraceCount !== undefined && (
                <Typography.Hint>
                  <FormattedMessage
                    defaultMessage="of {totalCount} traces in this experiment"
                    description="Hint showing the total number of traces available in the experiment"
                    values={{ totalCount: totalTraceCount }}
                  />
                </Typography.Hint>
              )}
            </div>
            {selectedTraceIds.length > 0 && (
              <Typography.Hint css={{ display: 'block', marginTop: theme.spacing.xs }}>
                <FormattedMessage
                  defaultMessage="Estimated cost: ~{low}–{high} for {count, plural, one {1 trace} other {# traces}} — actual varies by model. <link>See benchmark</link>."
                  description="Estimated USD cost range for the issue detection run, with link to benchmark docs"
                  values={{
                    low: formatEstimatedCostUsd(estimatedCost.low),
                    high: formatEstimatedCostUsd(estimatedCost.high),
                    count: selectedTraceIds.length,
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
            )}
            {showLowTraceWarning && (
              <Alert
                componentId="mlflow.traces.issue-detection-modal.low-trace-warning"
                type="warning"
                closable={false}
                css={{ marginTop: theme.spacing.sm }}
                message={
                  <FormattedMessage
                    defaultMessage="Small samples can miss real issues"
                    description="Title of the warning shown when fewer than the recommended number of traces are selected"
                  />
                }
                description={
                  <div>
                    <FormattedMessage
                      defaultMessage="You selected {count, plural, one {only 1 trace} other {only # traces}}. We recommend analyzing at least {recommended} traces for reliable issue coverage."
                      description="Body of the warning shown when fewer than the recommended number of traces are selected"
                      values={{ count: selectedTraceIds.length, recommended: MIN_RECOMMENDED_TRACE_COUNT }}
                    />
                    <div css={{ marginTop: theme.spacing.sm }}>
                      {canQuickSelectTraces ? (
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
                      ) : (
                        <Button
                          componentId="mlflow.traces.issue-detection-modal.quick-select-traces"
                          data-testid="quick-select-traces"
                          size="small"
                          onClick={() => setIsSelectTracesModalOpen(true)}
                        >
                          <FormattedMessage
                            defaultMessage="Select more traces"
                            description="Button to open the trace selection modal to add more traces"
                          />
                        </Button>
                      )}
                    </div>
                  </div>
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
          />
          <Accordion
            componentId="mlflow.traces.issue-detection-modal.advanced-config"
            dangerouslyAppendEmotionCSS={{
              background: 'transparent',
              border: 'none',
            }}
          >
            <Accordion.Panel
              key="advanced"
              header={
                <div css={{ display: 'flex', alignItems: 'baseline', gap: theme.spacing.sm }}>
                  <FormattedMessage
                    defaultMessage="Advanced configuration"
                    description="Collapsible section for advanced issue detection configuration"
                  />
                  <Typography.Text color={selectedCategories.size === 0 ? 'error' : 'secondary'} size="sm">
                    <FormattedMessage
                      defaultMessage="Categories: {selectedCount} of {totalCount}"
                      description="Summary of selected issue categories shown in the advanced configuration header"
                      values={{ selectedCount: selectedCategories.size, totalCount: ALL_ISSUE_CATEGORIES.length }}
                    />
                  </Typography.Text>
                </div>
              }
            >
              <Typography.Text color="secondary" css={{ display: 'block', marginBottom: theme.spacing.sm }}>
                <FormattedMessage
                  defaultMessage="Choose which types of issues to detect in your traces"
                  description="Description for the issue category selection"
                />
              </Typography.Text>
              <IssueCategoryList selectedCategories={selectedCategories} onToggle={handleCategoryToggle} />
            </Accordion.Panel>
          </Accordion>
          {selectedCategories.size === 0 && (
            <Typography.Text color="error" size="sm">
              <FormattedMessage
                defaultMessage="Select at least one issue category in Advanced configuration"
                description="Validation message when no issue categories are selected"
              />
            </Typography.Text>
          )}
        </div>
      </Modal>
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
    </>
  );
};
