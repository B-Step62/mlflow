import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Button, Spinner, Typography, useDesignSystemTheme } from '@databricks/design-system';
import { FormattedMessage, useIntl } from '@databricks/i18n';
import { WebhooksApi } from './webhooksApi';
import type { Webhook } from './webhooksApi';
import WebhookListItem from './WebhookListItem';
import WebhookFormModal from './WebhookFormModal';
import WebhookDeleteModal from './WebhookDeleteModal';
import { useDatasetsPageQuery } from '../experiment-tracking/pages/experiment-evaluation-datasets-v2/hooks/useDatasetsPageQuery';
import { useListReviewQueuesQuery } from '../experiment-tracking/pages/experiment-review-queue/hooks/useListReviewQueuesQuery';

interface WebhooksSettingsProps {
  /** Filter displayed webhooks to only those containing at least one event whose entity matches this value exactly */
  eventFilter?: string;
  /** Filter and default automations to a specific source object. */
  sourceType?: string;
  sourceId?: string;
  experimentId?: string;
  defaultEvents?: string[];
  defaultCondition?: string;
  lockSource?: boolean;
  /** Render webhook or automation copy and fields. */
  mode?: 'webhook' | 'automation';
  /** Title override */
  title?: React.ReactNode;
  /** Description override */
  description?: React.ReactNode;
  /** Whether to show the section title. Defaults to true. */
  showTitle?: boolean;
  /** Whether to show the section description. Defaults to true. */
  showDescription?: boolean;
  /** Override the empty state message shown when no webhooks exist */
  emptyDescription?: React.ReactNode;
}

const isAutomationRecord = (webhook: Webhook) =>
  Boolean(webhook.action_type || webhook.condition || webhook.source_type || webhook.source_id);

const WebhooksSettings = ({
  eventFilter,
  sourceType,
  sourceId,
  experimentId,
  defaultEvents,
  defaultCondition,
  lockSource = false,
  mode = 'webhook',
  title,
  description,
  showTitle = true,
  showDescription = true,
  emptyDescription,
}: WebhooksSettingsProps) => {
  const { theme } = useDesignSystemTheme();
  const intl = useIntl();

  const [webhooks, setWebhooks] = useState<Webhook[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingWebhook, setEditingWebhook] = useState<Webhook | null>(null);

  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [webhookToDelete, setWebhookToDelete] = useState<Webhook | null>(null);

  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{
    webhookId: string;
    success: boolean;
    message: string;
  } | null>(null);
  const shouldResolveAutomationDestinations = mode === 'automation' && Boolean(experimentId);
  const datasetsQuery = useDatasetsPageQuery({
    experimentId: experimentId ?? '',
    nameFilter: '',
    pageSize: 100,
    pageToken: undefined,
    enabled: shouldResolveAutomationDestinations,
  });
  const { reviewQueues } = useListReviewQueuesQuery({
    experimentId: experimentId ?? '',
    maxResults: 100,
    enabled: shouldResolveAutomationDestinations,
  });
  const destinationNames = useMemo(
    () => ({
      datasets: Object.fromEntries(
        (datasetsQuery.data?.datasets ?? []).map((dataset) => [dataset.dataset_id, dataset.name || dataset.dataset_id]),
      ),
      reviewQueues: Object.fromEntries(reviewQueues.map((queue) => [queue.queue_id, queue.name])),
    }),
    [datasetsQuery.data?.datasets, reviewQueues],
  );

  const fetchWebhooks = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await WebhooksApi.listWebhooks();
      let all = response?.webhooks ?? [];
      if (mode === 'automation') {
        all = all.filter(isAutomationRecord);
      } else {
        all = all.filter((w) => !isAutomationRecord(w));
      }
      if (sourceType || sourceId) {
        all = all.filter(
          (w) => (!sourceType || w.source_type === sourceType) && (!sourceId || w.source_id === sourceId),
        );
      }
      if (eventFilter) {
        setWebhooks(all.filter((w) => w.events.some((e) => e.entity === eventFilter)));
      } else {
        setWebhooks(all);
      }
    } catch (e: any) {
      setError(
        e?.message ??
          intl.formatMessage({
            defaultMessage: 'Failed to load webhooks',
            description: 'Error message informing the user that webhooks did not load successfully',
          }),
      );
    } finally {
      setLoading(false);
    }
  }, [intl, eventFilter, mode, sourceId, sourceType]);

  useEffect(() => {
    fetchWebhooks();
  }, [fetchWebhooks]);

  const openCreateModal = useCallback(() => {
    setEditingWebhook(null);
    setIsModalOpen(true);
  }, []);

  const openEditModal = useCallback((webhook: Webhook) => {
    setEditingWebhook(webhook);
    setIsModalOpen(true);
  }, []);

  const closeModal = useCallback(() => {
    setIsModalOpen(false);
    setEditingWebhook(null);
  }, []);

  const handleSaved = useCallback(async () => {
    closeModal();
    await fetchWebhooks();
  }, [closeModal, fetchWebhooks]);

  const openDeleteModal = useCallback((webhook: Webhook) => {
    setWebhookToDelete(webhook);
    setIsDeleteModalOpen(true);
  }, []);

  const handleDelete = useCallback(async () => {
    if (!webhookToDelete) return;
    setDeletingId(webhookToDelete.webhook_id);
    setIsDeleteModalOpen(false);
    try {
      await WebhooksApi.deleteWebhook(webhookToDelete.webhook_id);
      await fetchWebhooks();
    } catch (e: any) {
      setError(
        e?.message ??
          intl.formatMessage({
            defaultMessage: 'Failed to delete webhook',
            description: 'Generic error message informing the user that webhook deletion failed',
          }),
      );
    } finally {
      setDeletingId(null);
      setWebhookToDelete(null);
    }
  }, [webhookToDelete, fetchWebhooks, intl]);

  const handleTest = useCallback(
    async (webhook: Webhook) => {
      setTestingId(webhook.webhook_id);
      setTestResult(null);
      try {
        const response = await WebhooksApi.testWebhook(webhook.webhook_id);
        const result = response?.result;
        setTestResult({
          webhookId: webhook.webhook_id,
          success: result?.success ?? false,
          message: result?.success
            ? intl.formatMessage(
                {
                  defaultMessage: 'Test succeeded (HTTP {status})',
                  description: 'Message informing the user that the webhook test succeeded',
                },
                { status: result?.response_status ?? '' },
              )
            : (result?.error_message ??
              intl.formatMessage({
                defaultMessage: 'Test failed with no error message',
                description: 'Message informing the user that the webhook test failed with no error message',
              })),
        });
      } catch (e: any) {
        setTestResult({
          webhookId: webhook.webhook_id,
          success: false,
          message:
            e?.message ??
            intl.formatMessage({
              defaultMessage: 'Failed to invoke webhook',
              description: 'Message informing the user that the webhook test failed to invoke',
            }),
        });
      } finally {
        setTestingId(null);
      }
    },
    [intl],
  );

  return (
    <div css={{ display: 'flex', flexDirection: 'column', gap: theme.spacing.md }}>
      {(showTitle || showDescription) && (
        <div>
          {showTitle && (
            <Typography.Title level={4} withoutMargins>
              {title ??
                (mode === 'automation' ? (
                  <FormattedMessage defaultMessage="Automations" description="Automations settings section title" />
                ) : (
                  <FormattedMessage defaultMessage="Webhooks" description="Webhooks settings section title" />
                ))}
            </Typography.Title>
          )}
          {showDescription && (
            <Typography.Text color="secondary">
              {description ?? (
                <>
                  {mode === 'automation' ? (
                    <FormattedMessage
                      defaultMessage="Manage trigger, condition, and action rules for MLflow events."
                      description="Automations settings section description"
                    />
                  ) : (
                    <FormattedMessage
                      defaultMessage="Manage webhooks to receive HTTP notifications when events occur in MLflow."
                      description="Webhooks settings section description"
                    />
                  )}
                </>
              )}
            </Typography.Text>
          )}
        </div>
      )}
      <div css={{ display: 'flex', justifyContent: 'flex-start', width: '100%' }}>
        <Button componentId="mlflow.settings.webhooks.create-button" type="primary" onClick={openCreateModal}>
          {mode === 'automation' ? (
            <FormattedMessage defaultMessage="Create automation" description="Create automation button" />
          ) : (
            <FormattedMessage defaultMessage="Create webhook" description="Create webhook button" />
          )}
        </Button>
      </div>

      {error && (
        <Alert
          componentId="mlflow.settings.webhooks.error-alert"
          type="error"
          message={error}
          closable
          onClose={() => setError(null)}
        />
      )}

      {testResult && (
        <Alert
          componentId="mlflow.settings.webhooks.test-result-alert"
          type={testResult.success ? 'info' : 'error'}
          message={testResult.message}
          closable
          onClose={() => setTestResult(null)}
        />
      )}

      {loading ? (
        <div css={{ display: 'flex', justifyContent: 'center', padding: theme.spacing.lg }}>
          <Spinner />
        </div>
      ) : webhooks.length === 0 ? (
        <div
          css={{
            padding: theme.spacing.lg,
            border: `1px solid ${theme.colors.border}`,
            borderRadius: theme.legacyBorders.borderRadiusMd,
            textAlign: 'center',
          }}
        >
          <Typography.Text color="secondary">
            {emptyDescription ?? (
              <>
                {mode === 'automation' ? (
                  <FormattedMessage
                    defaultMessage="No automations configured. Create one to get started."
                    description="Empty state for automations list"
                  />
                ) : (
                  <FormattedMessage
                    defaultMessage="No webhooks configured. Create one to get started. <link>Learn more about webhooks.</link>"
                    description="Empty state for webhooks list"
                    values={{
                      link: (chunks: any) => (
                        <a href="https://mlflow.org/docs/latest/ml/webhooks/" target="_blank" rel="noopener noreferrer">
                          {chunks}
                        </a>
                      ),
                    }}
                  />
                )}
              </>
            )}
          </Typography.Text>
        </div>
      ) : (
        <div
          css={{
            border: `1px solid ${theme.colors.border}`,
            borderRadius: theme.legacyBorders.borderRadiusMd,
            overflow: 'hidden',
          }}
        >
          {webhooks.map((webhook, index) => (
            <WebhookListItem
              key={webhook.webhook_id}
              webhook={webhook}
              isLast={index === webhooks.length - 1}
              testingId={testingId}
              deletingId={deletingId}
              onTest={handleTest}
              onEdit={openEditModal}
              onDelete={openDeleteModal}
              mode={mode}
              destinationNames={destinationNames}
            />
          ))}
        </div>
      )}

      {isModalOpen && (
        <WebhookFormModal
          visible={isModalOpen}
          editingWebhook={editingWebhook}
          onClose={closeModal}
          onSaved={handleSaved}
          eventFilter={eventFilter}
          defaultEvents={defaultEvents}
          defaultCondition={defaultCondition}
          defaultSourceType={sourceType}
          defaultSourceId={sourceId}
          experimentId={experimentId}
          lockSource={lockSource}
          mode={mode}
        />
      )}

      <WebhookDeleteModal
        visible={isDeleteModalOpen}
        webhook={webhookToDelete}
        onCancel={() => {
          setIsDeleteModalOpen(false);
          setWebhookToDelete(null);
        }}
        onConfirm={handleDelete}
        mode={mode}
      />
    </div>
  );
};

export default WebhooksSettings;
