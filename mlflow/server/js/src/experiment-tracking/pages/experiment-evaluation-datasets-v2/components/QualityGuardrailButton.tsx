import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  ArrowDownIcon,
  ArrowUpIcon,
  Button,
  FormUI,
  Input,
  Modal,
  PlusIcon,
  ShieldIcon,
  SimpleSelect,
  SimpleSelectOption,
  TrashIcon,
  Typography,
  useDesignSystemTheme,
} from '@databricks/design-system';
import { FormattedMessage, useIntl } from 'react-intl';

import { WebhooksApi } from '../../../../settings/webhooksApi';
import { useListReviewQueuesQuery } from '../../experiment-review-queue/hooks/useListReviewQueuesQuery';
import type { Dataset } from '../hooks/useDatasetsQueries';

const GUARDRAIL_PREFIX = 'quality-guardrail.';
const PROMOTE_ACTIVE_NAME = `${GUARDRAIL_PREFIX}promote-active`;
const MAX_GUARDRAIL_ID_LENGTH = 32;

type GuardrailType = 'llm_judge' | 'human_review' | 'webhook';

interface GuardrailStep {
  id: string;
  name: string;
  type: GuardrailType;
  instructions: string;
  queueId: string;
  webhookUrl: string;
}

interface RunnableGuardrailStep extends GuardrailStep {
  normalizedId: string;
  resultTag: string;
}

const GUARDRAIL_TYPE_OPTIONS: { value: GuardrailType; label: string }[] = [
  { value: 'llm_judge', label: 'LLM judge' },
  { value: 'human_review', label: 'Human review' },
  { value: 'webhook', label: 'Webhook' },
];

const DEFAULT_GUARDRAILS: GuardrailStep[] = [
  {
    id: 'anonymization',
    name: 'Anonymization check',
    type: 'llm_judge',
    instructions: 'Record contains no raw customer identifiers or private contact information.',
    queueId: '',
    webhookUrl: '',
  },
  {
    id: 'guideline-adherence',
    name: 'Guideline adherence',
    type: 'llm_judge',
    instructions: 'Record follows the rental QA guidelines and has useful expected output.',
    queueId: '',
    webhookUrl: '',
  },
];

const DEFAULTS_BY_TYPE: Record<GuardrailType, Omit<GuardrailStep, 'id'>> = {
  llm_judge: {
    name: 'LLM judge',
    type: 'llm_judge',
    instructions: '',
    queueId: '',
    webhookUrl: '',
  },
  human_review: {
    name: 'Human review',
    type: 'human_review',
    instructions: '',
    queueId: '',
    webhookUrl: '',
  },
  webhook: {
    name: 'Webhook',
    type: 'webhook',
    instructions: '',
    queueId: '',
    webhookUrl: '',
  },
};

const slugify = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'guardrail';

const normalizeGuardrailId = (value: string) =>
  slugify(value).slice(0, MAX_GUARDRAIL_ID_LENGTH).replace(/-+$/g, '') || 'guardrail';

const appendGuardrailSuffix = (baseId: string, suffix: number) => {
  const suffixText = `-${suffix}`;
  const prefix = baseId.slice(0, MAX_GUARDRAIL_ID_LENGTH - suffixText.length).replace(/-+$/g, '') || 'guardrail';
  return `${prefix}${suffixText}`;
};

const buildRunnableGuardrails = (guardrails: GuardrailStep[]): RunnableGuardrailStep[] => {
  const usedIds = new Set<string>();
  return guardrails
    .filter((guardrail) => guardrail.name.trim())
    .map((guardrail) => {
      const baseId = normalizeGuardrailId(guardrail.id || guardrail.name);
      let normalizedId = baseId;
      let suffix = 2;
      while (usedIds.has(normalizedId)) {
        normalizedId = appendGuardrailSuffix(baseId, suffix);
        suffix += 1;
      }
      usedIds.add(normalizedId);
      return {
        ...guardrail,
        id: normalizedId,
        name: guardrail.name.trim(),
        instructions: guardrail.instructions.trim(),
        queueId: guardrail.queueId.trim(),
        webhookUrl: guardrail.webhookUrl.trim(),
        normalizedId,
        resultTag: `mlflow.quality_guardrail.${normalizedId}`,
      };
    });
};

const guardrailPassCondition = (guardrail: RunnableGuardrailStep) => `tag.${guardrail.resultTag} = 'pass'`;

const buildCondition = (clauses: string[]) => clauses.filter(Boolean).join(' AND ');

const parseActionConfig = (actionConfig?: string): Record<string, any> => {
  if (!actionConfig) {
    return {};
  }
  try {
    const parsed = JSON.parse(actionConfig);
    return typeof parsed === 'object' && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
};

const parseGuardrailName = (name: string) => {
  const match = name.match(/^quality-guardrail\.(\d+)\.([^.]+)(?:\.(route|pass|webhook))?$/);
  if (!match) {
    return null;
  }
  return {
    order: Number(match[1]),
    id: match[2],
    suffix: match[3],
  };
};

const belongsToDataset = (webhook: { source_id?: string; action_config?: string }, datasetId: string) => {
  if (webhook.source_id === datasetId) {
    return true;
  }
  return parseActionConfig(webhook.action_config).dataset_id === datasetId;
};

const createStep = (type: GuardrailType, index: number): GuardrailStep => ({
  id: `guardrail-${index + 1}`,
  ...DEFAULTS_BY_TYPE[type],
});

export const QualityGuardrailButton = ({
  experimentId,
  datasetId,
  dataset,
}: {
  experimentId: string;
  datasetId: string;
  dataset: Dataset;
}) => {
  const intl = useIntl();
  const { theme } = useDesignSystemTheme();
  const [isOpen, setIsOpen] = useState(false);
  const [guardrails, setGuardrails] = useState<GuardrailStep[]>(DEFAULT_GUARDRAILS);
  const [pendingType, setPendingType] = useState<GuardrailType | ''>('');
  const [isAdding, setIsAdding] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const { reviewQueues, isLoading: reviewQueuesLoading } = useListReviewQueuesQuery({
    experimentId,
    maxResults: 100,
    enabled: isOpen,
  });

  const reviewQueueOptions = useMemo(
    () => reviewQueues.map((queue) => ({ value: queue.queue_id, label: queue.name })),
    [reviewQueues],
  );

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    let isCancelled = false;
    WebhooksApi.listWebhooks()
      .then((existing) => {
        if (isCancelled) {
          return;
        }
        const guardrailWebhooks = (existing.webhooks ?? [])
          .filter((webhook) => webhook.name.startsWith(GUARDRAIL_PREFIX))
          .filter((webhook) => belongsToDataset(webhook, datasetId));
        const grouped = new Map<number, Partial<GuardrailStep> & { id?: string }>();
        for (const webhook of guardrailWebhooks) {
          const parsed = parseGuardrailName(webhook.name);
          if (!parsed) {
            continue;
          }
          const config = parseActionConfig(webhook.action_config);
          const current = grouped.get(parsed.order) ?? {};
          current.id = config.guardrail_id || parsed.id;
          current.name = config.name || current.name || parsed.id;
          current.instructions = config.instructions || current.instructions || webhook.description || '';
          if (webhook.action_type === 'run_quality_guardrail' && !parsed.suffix) {
            current.type = 'llm_judge';
          } else if (webhook.action_type === 'add_to_review_queue' || parsed.suffix === 'route') {
            current.type = 'human_review';
            current.queueId = config.queue_id || current.queueId || '';
          } else if (webhook.action_type === 'send_webhook' || parsed.suffix === 'webhook') {
            current.type = 'webhook';
            current.webhookUrl = webhook.url || current.webhookUrl || '';
          }
          grouped.set(parsed.order, current);
        }
        const existingGuardrails = Array.from(grouped.entries())
          .sort(([a], [b]) => a - b)
          .map(([, guardrail]) => ({
            id: guardrail.id || normalizeGuardrailId(guardrail.name || 'guardrail'),
            name: guardrail.name || 'Guardrail',
            type: guardrail.type || 'llm_judge',
            instructions: guardrail.instructions || '',
            queueId: guardrail.queueId || '',
            webhookUrl: guardrail.webhookUrl || '',
          }));
        setGuardrails(existingGuardrails.length > 0 ? existingGuardrails : DEFAULT_GUARDRAILS);
      })
      .catch(() => {
        if (!isCancelled) {
          setMessage({
            type: 'error',
            text: intl.formatMessage({
              defaultMessage: 'Failed to load existing quality guardrails',
              description: 'Quality guardrails load error message',
            }),
          });
        }
      });
    return () => {
      isCancelled = true;
    };
  }, [datasetId, intl, isOpen]);

  const updateGuardrail = (index: number, update: Partial<GuardrailStep>) => {
    setGuardrails((current) =>
      current.map((guardrail, guardrailIndex) => (guardrailIndex === index ? { ...guardrail, ...update } : guardrail)),
    );
  };

  const moveGuardrail = (index: number, direction: -1 | 1) => {
    setGuardrails((current) => {
      const nextIndex = index + direction;
      if (nextIndex < 0 || nextIndex >= current.length) {
        return current;
      }
      const next = [...current];
      const [guardrail] = next.splice(index, 1);
      if (!guardrail) {
        return current;
      }
      next.splice(nextIndex, 0, guardrail);
      return next;
    });
  };

  const addGuardrail = () => {
    if (!pendingType) {
      return;
    }
    setGuardrails((current) => [...current, createStep(pendingType, current.length)]);
    setPendingType('');
    setIsAdding(false);
  };

  const removeGuardrail = (index: number) => {
    setGuardrails((current) => current.filter((_, guardrailIndex) => guardrailIndex !== index));
  };

  const resetMessage = () => setMessage(null);

  const validateGuardrails = (activeGuardrails: RunnableGuardrailStep[]) => {
    if (activeGuardrails.length === 0) {
      return intl.formatMessage({
        defaultMessage: 'At least one guardrail is required',
        description: 'Quality guardrail validation error for missing guardrail steps',
      });
    }
    const missingHumanReview = activeGuardrails.find((guardrail) => guardrail.type === 'human_review' && !guardrail.queueId);
    if (missingHumanReview) {
      return intl.formatMessage({
        defaultMessage: 'Human review guardrails require a review queue',
        description: 'Quality guardrail validation error for missing review queue',
      });
    }
    const missingWebhookUrl = activeGuardrails.find((guardrail) => guardrail.type === 'webhook' && !guardrail.webhookUrl);
    if (missingWebhookUrl) {
      return intl.formatMessage({
        defaultMessage: 'Webhook guardrails require a webhook URL',
        description: 'Quality guardrail validation error for missing webhook URL',
      });
    }
    return undefined;
  };

  const baseConditionFor = (guardrails: RunnableGuardrailStep[], index: number) =>
    buildCondition(["status = 'staged'", index > 0 ? guardrailPassCondition(guardrails[index - 1]) : '']);

  const guardrailConfig = (guardrail: RunnableGuardrailStep) => ({
    dataset_id: datasetId,
    guardrail_id: guardrail.normalizedId,
    guardrail_type: guardrail.type,
    name: guardrail.name,
    instructions: guardrail.instructions,
    result_tag: guardrail.resultTag,
  });

  const handleSave = async () => {
    resetMessage();
    const activeGuardrails = buildRunnableGuardrails(guardrails);
    const validationError = validateGuardrails(activeGuardrails);
    if (validationError) {
      setMessage({ type: 'error', text: validationError });
      return;
    }

    setIsSaving(true);
    try {
      const existing = await WebhooksApi.listWebhooks();
      await Promise.all(
        (existing.webhooks ?? [])
          .filter((webhook) => webhook.name.startsWith(GUARDRAIL_PREFIX))
          .filter((webhook) => belongsToDataset(webhook, datasetId))
          .map((webhook) => WebhooksApi.deleteWebhook(webhook.webhook_id)),
      );

      await Promise.all(
        activeGuardrails.flatMap((guardrail, index) => {
          const triggerEvent = {
            entity: 'dataset_record',
            action: index === 0 ? 'created' : 'updated',
          };
          const baseName = `${GUARDRAIL_PREFIX}${index + 1}.${guardrail.normalizedId}`;
          const condition = baseConditionFor(activeGuardrails, index);
          if (guardrail.type === 'human_review') {
            return [
              WebhooksApi.createWebhook({
                name: `${baseName}.route`,
                url: '',
                events: [triggerEvent],
                description: guardrail.instructions || undefined,
                status: 'ACTIVE',
                source_type: 'dataset',
                source_id: datasetId,
                condition,
                action_type: 'add_to_review_queue',
                action_config: JSON.stringify({
                  ...guardrailConfig(guardrail),
                  queue_id: guardrail.queueId,
                  item_type: 'dataset_record',
                }),
              }),
              WebhooksApi.createWebhook({
                name: `${baseName}.pass`,
                url: '',
                events: [{ entity: 'review_queue_item', action: 'updated' }],
                description: guardrail.instructions || undefined,
                status: 'ACTIVE',
                source_type: 'review_queue',
                source_id: guardrail.queueId,
                condition: "status = 'staged' AND tag.approved = 'true'",
                action_type: 'run_quality_guardrail',
                action_config: JSON.stringify(guardrailConfig(guardrail)),
              }),
            ];
          }
          if (guardrail.type === 'webhook') {
            return [
              WebhooksApi.createWebhook({
                name: `${baseName}.webhook`,
                url: guardrail.webhookUrl,
                events: [triggerEvent],
                description: guardrail.instructions || undefined,
                status: 'ACTIVE',
                source_type: 'dataset',
                source_id: datasetId,
                condition,
                action_type: 'send_webhook',
                action_config: JSON.stringify(guardrailConfig(guardrail)),
              }),
              WebhooksApi.createWebhook({
                name: `${baseName}.pass`,
                url: '',
                events: [triggerEvent],
                description: guardrail.instructions || undefined,
                status: 'ACTIVE',
                source_type: 'dataset',
                source_id: datasetId,
                condition,
                action_type: 'run_quality_guardrail',
                action_config: JSON.stringify(guardrailConfig(guardrail)),
              }),
            ];
          }
          return [
            WebhooksApi.createWebhook({
              name: baseName,
              url: '',
              events: [triggerEvent],
              description: guardrail.instructions || undefined,
              status: 'ACTIVE',
              source_type: 'dataset',
              source_id: datasetId,
              condition,
              action_type: 'run_quality_guardrail',
              action_config: JSON.stringify(guardrailConfig(guardrail)),
            }),
          ];
        }),
      );

      await WebhooksApi.createWebhook({
        name: PROMOTE_ACTIVE_NAME,
        url: '',
        events: [{ entity: 'dataset_record', action: 'updated' }],
        status: 'ACTIVE',
        source_type: 'dataset',
        source_id: datasetId,
        condition: buildCondition(["status = 'staged'", ...activeGuardrails.map(guardrailPassCondition)]),
        action_type: 'set_record_status',
        action_config: JSON.stringify({ dataset_id: datasetId, status: 'active' }),
      });

      setMessage({
        type: 'success',
        text: intl.formatMessage({
          defaultMessage: 'Quality guardrails saved',
          description: 'Quality guardrails saved message',
        }),
      });
    } catch (e: any) {
      setMessage({
        type: 'error',
        text:
          e?.message ??
          intl.formatMessage({
            defaultMessage: 'Failed to save quality guardrails',
            description: 'Quality guardrails save error message',
          }),
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <>
      <Button
        componentId="mlflow.eval-datasets-v2.detail.quality-guardrail"
        icon={<ShieldIcon />}
        onClick={() => {
          resetMessage();
          setIsOpen(true);
        }}
      >
        <FormattedMessage
          defaultMessage="Quality guardrails"
          description="Dataset detail quality guardrails button label"
        />
      </Button>
      <Modal
        componentId="mlflow.eval-datasets-v2.detail.quality-guardrail.modal"
        visible={isOpen}
        title={intl.formatMessage({
          defaultMessage: 'Quality guardrails',
          description: 'Dataset quality guardrails modal title',
        })}
        onCancel={() => setIsOpen(false)}
        onOk={handleSave}
        okText={intl.formatMessage({
          defaultMessage: 'Save guardrails',
          description: 'Dataset quality guardrails save button',
        })}
        cancelText={intl.formatMessage({
          defaultMessage: 'Cancel',
          description: 'Dataset quality guardrails cancel button',
        })}
        confirmLoading={isSaving}
        size="wide"
      >
        <div css={{ display: 'flex', flexDirection: 'column', gap: theme.spacing.md }}>
          {message && (
            <Alert
              componentId="mlflow.eval-datasets-v2.detail.quality-guardrail.message"
              type={message.type === 'success' ? 'info' : 'error'}
              message={message.text}
            />
          )}
          <div>
            <Typography.Title level={5} withoutMargins>
              {dataset.name ?? datasetId}
            </Typography.Title>
            <Typography.Text color="secondary">
              <FormattedMessage
                defaultMessage="staged candidate -> ordered guardrails -> active record"
                description="Dataset quality guardrail pipeline summary"
              />
            </Typography.Text>
          </div>
          <div css={{ display: 'flex', flexDirection: 'column', gap: theme.spacing.sm }}>
            {guardrails.map((guardrail, index) => (
              <div
                key={guardrail.id}
                css={{
                  display: 'grid',
                  gridTemplateColumns: '32px minmax(180px, 220px) minmax(180px, 220px) minmax(280px, 1fr) auto',
                  gap: theme.spacing.sm,
                  alignItems: 'start',
                  padding: theme.spacing.sm,
                  border: `1px solid ${theme.colors.border}`,
                  borderRadius: theme.borders.borderRadiusSm,
                }}
              >
                <Typography.Text bold css={{ paddingTop: 6 }}>
                  {index + 1}
                </Typography.Text>
                <div>
                  <FormUI.Label htmlFor={`mlflow.eval-datasets-v2.detail.quality-guardrail.name-${index}`}>
                    <FormattedMessage defaultMessage="Guardrail" description="Dataset guardrail step name label" />
                  </FormUI.Label>
                  <Input
                    id={`mlflow.eval-datasets-v2.detail.quality-guardrail.name-${index}`}
                    componentId="mlflow.eval-datasets-v2.detail.quality-guardrail.name"
                    value={guardrail.name}
                    onChange={(e) =>
                      updateGuardrail(index, {
                        name: e.target.value,
                        id: guardrail.id.startsWith('guardrail-') ? slugify(e.target.value) : guardrail.id,
                      })
                    }
                  />
                </div>
                <div>
                  <FormUI.Label htmlFor={`mlflow.eval-datasets-v2.detail.quality-guardrail.type-${index}`}>
                    <FormattedMessage defaultMessage="Type" description="Dataset guardrail step type label" />
                  </FormUI.Label>
                  <SimpleSelect
                    id={`mlflow.eval-datasets-v2.detail.quality-guardrail.type-${index}`}
                    componentId="mlflow.eval-datasets-v2.detail.quality-guardrail.type"
                    value={guardrail.type}
                    onChange={({ target }) =>
                      updateGuardrail(index, {
                        type: target.value as GuardrailType,
                        instructions: '',
                        queueId: '',
                        webhookUrl: '',
                      })
                    }
                    css={{ width: '100%' }}
                  >
                    {GUARDRAIL_TYPE_OPTIONS.map((type) => (
                      <SimpleSelectOption key={type.value} value={type.value}>
                        {type.label}
                      </SimpleSelectOption>
                    ))}
                  </SimpleSelect>
                </div>
                <div>
                  {guardrail.type === 'llm_judge' && (
                    <>
                      <FormUI.Label htmlFor={`mlflow.eval-datasets-v2.detail.quality-guardrail.instructions-${index}`}>
                        <FormattedMessage defaultMessage="Judge criteria" description="Dataset guardrail judge label" />
                      </FormUI.Label>
                      <Input.TextArea
                        id={`mlflow.eval-datasets-v2.detail.quality-guardrail.instructions-${index}`}
                        componentId="mlflow.eval-datasets-v2.detail.quality-guardrail.instructions"
                        value={guardrail.instructions}
                        onChange={(e) => updateGuardrail(index, { instructions: e.target.value })}
                        rows={2}
                      />
                    </>
                  )}
                  {guardrail.type === 'human_review' && (
                    <>
                      <FormUI.Label htmlFor={`mlflow.eval-datasets-v2.detail.quality-guardrail.queue-${index}`}>
                        <FormattedMessage defaultMessage="Review queue" description="Dataset guardrail queue label" /> *
                      </FormUI.Label>
                      <SimpleSelect
                        id={`mlflow.eval-datasets-v2.detail.quality-guardrail.queue-${index}`}
                        componentId="mlflow.eval-datasets-v2.detail.quality-guardrail.queue"
                        value={guardrail.queueId}
                        onChange={({ target }) => updateGuardrail(index, { queueId: target.value })}
                        css={{ width: '100%' }}
                      >
                        <SimpleSelectOption value="">
                          {reviewQueuesLoading ? 'Loading...' : 'Select review queue'}
                        </SimpleSelectOption>
                        {reviewQueueOptions.map((queue) => (
                          <SimpleSelectOption key={queue.value} value={queue.value}>
                            {queue.label}
                          </SimpleSelectOption>
                        ))}
                      </SimpleSelect>
                    </>
                  )}
                  {guardrail.type === 'webhook' && (
                    <>
                      <FormUI.Label htmlFor={`mlflow.eval-datasets-v2.detail.quality-guardrail.webhook-${index}`}>
                        <FormattedMessage defaultMessage="Webhook URL" description="Dataset guardrail webhook URL label" /> *
                      </FormUI.Label>
                      <Input
                        id={`mlflow.eval-datasets-v2.detail.quality-guardrail.webhook-${index}`}
                        componentId="mlflow.eval-datasets-v2.detail.quality-guardrail.webhook"
                        value={guardrail.webhookUrl}
                        onChange={(e) => updateGuardrail(index, { webhookUrl: e.target.value })}
                        placeholder="http://127.0.0.1:8000/webhook"
                      />
                    </>
                  )}
                </div>
                <div css={{ display: 'flex', gap: theme.spacing.xs, paddingTop: 22 }}>
                  <Button
                    componentId="mlflow.eval-datasets-v2.detail.quality-guardrail.move-up"
                    icon={<ArrowUpIcon />}
                    disabled={index === 0}
                    onClick={() => moveGuardrail(index, -1)}
                    aria-label={intl.formatMessage({
                      defaultMessage: 'Move guardrail up',
                      description: 'Dataset quality guardrail move up aria label',
                    })}
                  />
                  <Button
                    componentId="mlflow.eval-datasets-v2.detail.quality-guardrail.move-down"
                    icon={<ArrowDownIcon />}
                    disabled={index === guardrails.length - 1}
                    onClick={() => moveGuardrail(index, 1)}
                    aria-label={intl.formatMessage({
                      defaultMessage: 'Move guardrail down',
                      description: 'Dataset quality guardrail move down aria label',
                    })}
                  />
                  <Button
                    componentId="mlflow.eval-datasets-v2.detail.quality-guardrail.remove"
                    icon={<TrashIcon />}
                    disabled={guardrails.length === 1}
                    onClick={() => removeGuardrail(index)}
                    aria-label={intl.formatMessage({
                      defaultMessage: 'Remove guardrail',
                      description: 'Dataset quality guardrail remove aria label',
                    })}
                  />
                </div>
              </div>
            ))}
            {isAdding ? (
              <div css={{ display: 'flex', gap: theme.spacing.sm, alignItems: 'center' }}>
                <SimpleSelect
                  componentId="mlflow.eval-datasets-v2.detail.quality-guardrail.add-type"
                  value={pendingType}
                  onChange={({ target }) => setPendingType(target.value as GuardrailType)}
                  css={{ minWidth: 220 }}
                >
                  <SimpleSelectOption value="">Select guardrail type</SimpleSelectOption>
                  {GUARDRAIL_TYPE_OPTIONS.map((type) => (
                    <SimpleSelectOption key={type.value} value={type.value}>
                      {type.label}
                    </SimpleSelectOption>
                  ))}
                </SimpleSelect>
                <Button
                  componentId="mlflow.eval-datasets-v2.detail.quality-guardrail.add-confirm"
                  onClick={addGuardrail}
                  disabled={!pendingType}
                >
                  <FormattedMessage defaultMessage="Add" description="Dataset quality guardrail add confirm button" />
                </Button>
                <Button
                  componentId="mlflow.eval-datasets-v2.detail.quality-guardrail.add-cancel"
                  onClick={() => {
                    setPendingType('');
                    setIsAdding(false);
                  }}
                >
                  <FormattedMessage defaultMessage="Cancel" description="Dataset quality guardrail add cancel button" />
                </Button>
              </div>
            ) : (
              <div>
                <Button
                  componentId="mlflow.eval-datasets-v2.detail.quality-guardrail.add"
                  icon={<PlusIcon />}
                  onClick={() => setIsAdding(true)}
                >
                  <FormattedMessage defaultMessage="Add guardrail" description="Dataset quality guardrail add button" />
                </Button>
              </div>
            )}
          </div>
        </div>
      </Modal>
    </>
  );
};
