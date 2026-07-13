import { useMemo, useState, type ReactNode } from 'react';
import { useForm, Controller, FormProvider, type UseFormReturn } from 'react-hook-form';
import {
  Alert,
  ArrowRightIcon,
  Button,
  Checkbox,
  ChevronRightIcon,
  FilterIcon,
  FormUI,
  LightningIcon,
  Modal,
  PlusIcon,
  RHFControlledComponents,
  SimpleSelect,
  SimpleSelectOption,
  Typography,
  useDesignSystemTheme,
} from '@databricks/design-system';
import { FormattedMessage, useIntl } from '@databricks/i18n';
import { WebhooksApi } from './webhooksApi';
import type { Webhook, WebhookEvent } from './webhooksApi';
import { VALID_EVENTS, WEBHOOK_NAME_REGEX, eventKey, eventLabels, EVENT_GROUPS } from './webhookConstants';
import { TableFilterItem } from '../shared/web-shared/genai-traces-table/components/filters/TableFilterItem';
import { createMlflowSearchFilter } from '../shared/web-shared/genai-traces-table/hooks/useMlflowTraces';
import { ISSUES_COLUMN_ID, STATE_COLUMN_ID } from '../shared/web-shared/genai-traces-table/hooks/useTableColumns';
import {
  FilterOperator,
  TracesTableColumnGroup,
  TracesTableColumnType,
  type AssessmentInfo,
  type TableFilter,
  type TableFilterOptions,
  type TracesTableColumn,
} from '../shared/web-shared/genai-traces-table/types';
import { useDatasetsPageQuery } from '../experiment-tracking/pages/experiment-evaluation-datasets-v2/hooks/useDatasetsPageQuery';
import { useListReviewQueuesQuery } from '../experiment-tracking/pages/experiment-review-queue/hooks/useListReviewQueuesQuery';

interface WebhookFormData {
  name: string;
  url: string;
  description: string;
  secret: string;
  status: boolean;
  events: string[];
  sourceType: string;
  sourceId: string;
  actionType: string;
  actionTargetId: string;
}

interface WebhookFormModalProps {
  visible: boolean;
  editingWebhook: Webhook | null;
  onClose: () => void;
  onSaved: () => void;
  /** If set, only show events matching this entity */
  eventFilter?: string;
  defaultEvents?: string[];
  defaultCondition?: string;
  defaultSourceType?: string;
  defaultSourceId?: string;
  experimentId?: string;
  lockSource?: boolean;
  mode?: 'webhook' | 'automation';
}

const ACTION_TYPES = [
  { value: 'add_to_review_queue', label: 'Add to review queue' },
  { value: 'add_to_dataset', label: 'Add to dataset' },
  { value: 'send_webhook', label: 'Send webhook' },
];

const LEGACY_ACTION_TYPES = [{ value: 'set_record_status', label: 'Set record status' }];

const SOURCE_TYPES = [
  { value: '', label: 'Any source' },
  { value: 'experiment', label: 'Experiment' },
  { value: 'review_queue', label: 'Review queue' },
  { value: 'dataset', label: 'Dataset' },
  { value: 'trace', label: 'Trace' },
];

const DEFAULT_AUTOMATION_EVENT = eventKey('TRACE_ASSESSMENT', 'CREATED');

const AUTOMATION_ASSESSMENTS: AssessmentInfo[] = [
  {
    name: 'topic',
    displayName: 'Topic',
    isKnown: false,
    isOverall: false,
    metricName: 'topic',
    isCustomMetric: true,
    isEditable: false,
    isRetrievalAssessment: false,
    dtype: 'string',
    uniqueValues: new Set(),
    docsLink: '',
    missingTooltip: '',
    description: '',
  },
  {
    name: 'approved',
    displayName: 'Approved',
    isKnown: false,
    isOverall: false,
    metricName: 'approved',
    isCustomMetric: true,
    isEditable: false,
    isRetrievalAssessment: false,
    dtype: 'boolean',
    uniqueValues: new Set([true, false]),
    docsLink: '',
    missingTooltip: '',
    description: '',
  },
  {
    name: 'Topic correct?',
    displayName: 'Topic correct?',
    isKnown: false,
    isOverall: false,
    metricName: 'Topic correct?',
    isCustomMetric: true,
    isEditable: false,
    isRetrievalAssessment: false,
    dtype: 'boolean',
    uniqueValues: new Set([true, false]),
    docsLink: '',
    missingTooltip: '',
    description: '',
  },
  {
    name: 'Anonymized?',
    displayName: 'Anonymized?',
    isKnown: false,
    isOverall: false,
    metricName: 'Anonymized?',
    isCustomMetric: true,
    isEditable: false,
    isRetrievalAssessment: false,
    dtype: 'boolean',
    uniqueValues: new Set([true, false]),
    docsLink: '',
    missingTooltip: '',
    description: '',
  },
];

const ACTION_TARGET_LABELS: Record<string, string> = {
  add_to_review_queue: 'Review queue',
  add_to_dataset: 'Dataset',
  set_record_status: 'Dataset',
};

const formatAutomationOperatorLabel = (operator: FilterOperator) => {
  switch (operator) {
    case FilterOperator.EQUALS:
      return 'equals';
    case FilterOperator.NOT_EQUALS:
      return 'does not equal';
    case FilterOperator.IS_NULL:
      return 'is empty';
    case FilterOperator.IS_NOT_NULL:
      return 'exists';
    case FilterOperator.GREATER_THAN:
      return 'greater than';
    case FilterOperator.LESS_THAN:
      return 'less than';
    case FilterOperator.GREATER_THAN_OR_EQUALS:
      return 'at least';
    case FilterOperator.LESS_THAN_OR_EQUALS:
      return 'at most';
    case FilterOperator.CONTAINS:
      return 'contains';
    case FilterOperator.RLIKE:
      return 'matches regex';
    default:
      return operator;
  }
};

const parseActionConfig = (webhook: Webhook | null): Record<string, any> => {
  if (!webhook?.action_config) {
    return {};
  }
  try {
    return JSON.parse(webhook.action_config);
  } catch {
    return {};
  }
};

const getActionTargetId = (webhook: Webhook | null) => {
  const config = parseActionConfig(webhook);
  if (webhook?.action_type === 'add_to_review_queue') {
    return config['queue_id'] ?? '';
  }
  if (webhook?.action_type === 'add_to_dataset' || webhook?.action_type === 'set_record_status') {
    return config['dataset_id'] ?? '';
  }
  return '';
};

const buildActionConfig = (actionType: string, actionTargetId: string, sourceType: string) => {
  if (actionType === 'add_to_review_queue') {
    return JSON.stringify({
      queue_id: actionTargetId.trim(),
      item_type: sourceType === 'dataset' ? 'dataset_record' : 'trace',
    });
  }
  if (actionType === 'add_to_dataset') {
    return JSON.stringify({ dataset_id: actionTargetId.trim(), status: 'staged' });
  }
  if (actionType === 'set_record_status') {
    return JSON.stringify({ dataset_id: actionTargetId.trim(), status: 'active' });
  }
  return '{}';
};

const conditionToFilters = (condition?: string): TableFilter[] => {
  if (!condition) {
    return [{ column: ISSUES_COLUMN_ID, operator: FilterOperator.IS_NOT_NULL, value: '' }];
  }
  return condition
    .split(/\s+AND\s+/i)
    .map((clause): TableFilter | null => {
      const trimmed = clause.trim();
      const issueMatch = trimmed.match(/^issue\s+(IS NULL|IS NOT NULL)$/i);
      if (issueMatch) {
        return {
          column: ISSUES_COLUMN_ID,
          operator: issueMatch[1].toUpperCase() as FilterOperator,
          value: '',
        };
      }

      const feedbackMatch = trimmed.match(
        /^feedback(?:\.`([^`]+)`|\.([A-Za-z0-9_.-]+))\s*(IS NOT NULL|IS NULL|>=|<=|!=|=|>|<)\s*(?:(?:'([^']*)')|(.+))?$/i,
      );
      if (feedbackMatch) {
        const operator = feedbackMatch[3].toUpperCase() as FilterOperator;
        return {
          column: TracesTableColumnGroup.ASSESSMENT,
          key: feedbackMatch[1] ?? feedbackMatch[2],
          operator,
          value:
            operator === FilterOperator.IS_NULL || operator === FilterOperator.IS_NOT_NULL
              ? ''
              : (feedbackMatch[4] ?? feedbackMatch[5] ?? '').trim(),
        };
      }
      return null;
    })
    .filter((filter): filter is TableFilter => Boolean(filter));
};

const AutomationRuleSection = ({
  icon,
  title,
  description,
  children,
}: {
  icon: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
}) => {
  const { theme } = useDesignSystemTheme();

  return (
    <div
      css={{
        display: 'grid',
        gridTemplateColumns: '28px minmax(0, 1fr)',
        columnGap: theme.spacing.sm,
      }}
    >
      <div
        css={{
          width: 28,
          height: 28,
          borderRadius: theme.borders.borderRadiusMd,
          border: `1px solid ${theme.colors.border}`,
          backgroundColor: theme.colors.backgroundSecondary,
          color: theme.colors.textSecondary,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        {icon}
      </div>
      <div css={{ display: 'flex', flexDirection: 'column', gap: theme.spacing.sm, minWidth: 0 }}>
        <div>
          <Typography.Text bold>{title}</Typography.Text>
          {description && (
            <Typography.Text size="sm" color="secondary" css={{ display: 'block' }}>
              {description}
            </Typography.Text>
          )}
        </div>
        {children}
      </div>
    </div>
  );
};

const AutomationConditionFilter = ({
  filters,
  setFilters,
  experimentId,
}: {
  filters: TableFilter[];
  setFilters: (filters: TableFilter[]) => void;
  experimentId?: string;
}) => {
  const intl = useIntl();
  const { theme } = useDesignSystemTheme();
  const allColumns = useMemo<TracesTableColumn[]>(
    () => [
      {
        id: ISSUES_COLUMN_ID,
        label: intl.formatMessage({
          defaultMessage: 'Issue',
          description: 'Automation condition filter field label for issue',
        }),
        type: TracesTableColumnType.TRACE_INFO,
        group: TracesTableColumnGroup.INFO,
        filterOrder: 0,
      },
      {
        id: STATE_COLUMN_ID,
        label: intl.formatMessage({
          defaultMessage: 'State',
          description: 'Automation condition filter field label for trace state',
        }),
        type: TracesTableColumnType.TRACE_INFO,
        group: TracesTableColumnGroup.INFO,
        filterOrder: 1,
      },
    ],
    [intl],
  );
  const tableFilterOptions = useMemo<TableFilterOptions>(() => ({ source: [] }), []);
  const visibleFilters = filters.length > 0 ? filters : [{ column: '', operator: FilterOperator.EQUALS, value: '' }];

  return (
    <div css={{ display: 'flex', flexDirection: 'column', gap: theme.spacing.sm }}>
      {visibleFilters.map((filter, index) => (
        <TableFilterItem
          key={`${filter.column}-${filter.key}-${filter.operator}-${index}`}
          tableFilter={filter}
          index={index}
          onChange={(nextFilter, filterIndex) => {
            const nextFilters = [...visibleFilters];
            nextFilters[filterIndex] = nextFilter;
            setFilters(nextFilters);
          }}
          onDelete={() => {
            const nextFilters = visibleFilters.filter((_, filterIndex) => filterIndex !== index);
            setFilters(
              nextFilters.length > 0 ? nextFilters : [{ column: '', operator: FilterOperator.EQUALS, value: '' }],
            );
          }}
          assessmentInfos={AUTOMATION_ASSESSMENTS}
          experimentId={experimentId}
          tableFilterOptions={tableFilterOptions}
          allColumns={allColumns}
          usesV4APIs
          showLabels={false}
          forceFreeTextAssessmentValue
          formatOperatorLabel={formatAutomationOperatorLabel}
        />
      ))}
      <div>
        <Button
          componentId="mlflow.settings.automations.condition-add-filter"
          type="tertiary"
          icon={<PlusIcon />}
          onClick={() => setFilters([...visibleFilters, { column: '', operator: FilterOperator.EQUALS, value: '' }])}
        >
          <FormattedMessage defaultMessage="Add condition" description="Automation condition add filter button" />
        </Button>
      </div>
    </div>
  );
};

const AutomationActionFields = ({
  form,
  actionType,
  experimentId,
}: {
  form: UseFormReturn<WebhookFormData>;
  actionType: string;
  experimentId?: string;
}) => {
  const datasetsQuery = useDatasetsPageQuery({
    experimentId: experimentId ?? '',
    nameFilter: '',
    pageSize: 100,
    pageToken: undefined,
    enabled: Boolean(experimentId) && (actionType === 'add_to_dataset' || actionType === 'set_record_status'),
  });
  const { reviewQueues, isLoading: reviewQueuesLoading } = useListReviewQueuesQuery({
    experimentId: experimentId ?? '',
    maxResults: 100,
    enabled: Boolean(experimentId) && actionType === 'add_to_review_queue',
  });

  if (actionType === 'send_webhook') {
    return (
      <RHFControlledComponents.Input
        name="url"
        control={form.control}
        id="mlflow.settings.automations.url-input"
        aria-label="Webhook URL"
        componentId="mlflow.settings.automations.url-input"
        placeholder="https://example.com/webhook"
        css={{ width: '100%' }}
      />
    );
  }

  const isReviewQueueAction = actionType === 'add_to_review_queue';
  const options = isReviewQueueAction
    ? reviewQueues.map((queue) => ({ value: queue.queue_id, label: queue.name }))
    : (datasetsQuery.data?.datasets ?? []).map((dataset) => ({
        value: dataset.dataset_id,
        label: dataset.name || dataset.dataset_id,
      }));
  const isLoading = isReviewQueueAction ? reviewQueuesLoading : datasetsQuery.isLoading;

  return (
    <Controller
      name="actionTargetId"
      control={form.control}
      render={({ field }) => (
        <SimpleSelect
          id="mlflow.settings.automations.action-target-input"
          aria-label={ACTION_TARGET_LABELS[actionType] ?? 'Destination'}
          componentId="mlflow.settings.automations.action-target-input"
          value={field.value}
          onChange={({ target }) => field.onChange(target.value)}
          css={{ width: '100%' }}
        >
          <SimpleSelectOption value="">
            {isLoading ? 'Loading...' : isReviewQueueAction ? 'Select review queue' : 'Select dataset'}
          </SimpleSelectOption>
          {options.map((option) => (
            <SimpleSelectOption key={option.value} value={option.value}>
              {option.label}
            </SimpleSelectOption>
          ))}
        </SimpleSelect>
      )}
    />
  );
};

const WebhookFormModal = ({
  visible,
  editingWebhook,
  onClose,
  onSaved,
  eventFilter,
  defaultEvents: defaultEventKeys,
  defaultCondition,
  defaultSourceType,
  defaultSourceId,
  experimentId,
  lockSource = false,
  mode = 'webhook',
}: WebhookFormModalProps) => {
  const { theme } = useDesignSystemTheme();
  const intl = useIntl();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const displayedEvents = eventFilter ? VALID_EVENTS.filter((e) => e.entity === eventFilter) : VALID_EVENTS;

  const defaultEvents =
    mode === 'automation'
      ? (editingWebhook?.events.map((e) => eventKey(e.entity, e.action)) ??
        defaultEventKeys ?? [DEFAULT_AUTOMATION_EVENT])
      : !editingWebhook && eventFilter && displayedEvents.length === 1
        ? displayedEvents.map((e) => eventKey(e.entity, e.action))
        : (editingWebhook?.events.map((e) => eventKey(e.entity, e.action)) ?? defaultEventKeys ?? []);

  const form = useForm<WebhookFormData>({
    defaultValues: {
      name: editingWebhook?.name ?? '',
      url: editingWebhook?.url ?? '',
      description: editingWebhook?.description ?? '',
      secret: '',
      status: editingWebhook ? editingWebhook.status === 'ACTIVE' : true,
      events: defaultEvents,
      sourceType: editingWebhook?.source_type ?? defaultSourceType ?? '',
      sourceId: editingWebhook?.source_id ?? defaultSourceId ?? '',
      actionType: editingWebhook?.action_type ?? (mode === 'automation' ? 'add_to_review_queue' : 'send_webhook'),
      actionTargetId: getActionTargetId(editingWebhook),
    },
  });

  const actionType = form.watch('actionType');
  const isWebhookMode = mode === 'webhook';
  const actionTypeOptions = useMemo(() => {
    const options = actionType === 'set_record_status' ? [...ACTION_TYPES, ...LEGACY_ACTION_TYPES] : ACTION_TYPES;
    return options.some((action) => action.value === actionType)
      ? options
      : [...options, { value: actionType, label: actionType }];
  }, [actionType]);
  const [conditionFilters, setConditionFilters] = useState<TableFilter[]>(() =>
    conditionToFilters(editingWebhook?.condition ?? defaultCondition),
  );

  // Which coarse event groups are expanded. Start open if the group already has
  // a selected event (so editing a webhook shows its events).
  const [openGroups, setOpenGroups] = useState<Set<string>>(() => {
    const open = new Set<string>();
    for (const group of EVENT_GROUPS) {
      const hasSelected = displayedEvents.some(
        (e) => group.entities.includes(e.entity) && defaultEvents.includes(eventKey(e.entity, e.action)),
      );
      if (hasSelected || !editingWebhook) {
        open.add(group.label);
      }
    }
    return open;
  });
  const toggleGroup = (label: string) =>
    setOpenGroups((prev) => {
      const next = new Set(prev);
      if (next.has(label)) {
        next.delete(label);
      } else {
        next.add(label);
      }
      return next;
    });

  const formatEventLabel = (entity: string, action: string) => {
    const key = eventKey(entity, action);
    const descriptor = eventLabels[key as keyof typeof eventLabels];
    return descriptor ? intl.formatMessage(descriptor) : key;
  };

  const handleSubmit = async (values: WebhookFormData) => {
    const events: WebhookEvent[] = values.events.map((key) => {
      const [entity, action] = key.split('.', 2);
      return { entity, action };
    });

    setIsSaving(true);
    setSubmitError(null);

    if (mode === 'automation') {
      if (values.actionType === 'send_webhook' && !values.url.trim()) {
        setIsSaving(false);
        setSubmitError(
          intl.formatMessage({
            defaultMessage: 'Webhook URL is required',
            description: 'Automation webhook URL validation error',
          }),
        );
        return;
      }
      if (values.actionType !== 'send_webhook' && !values.actionTargetId.trim()) {
        setIsSaving(false);
        setSubmitError(
          intl.formatMessage({
            defaultMessage: 'Destination is required',
            description: 'Automation destination validation error',
          }),
        );
        return;
      }
    }

    const automationCondition =
      mode === 'automation' ? createMlflowSearchFilter(undefined, undefined, conditionFilters) : undefined;
    const actionConfig =
      mode === 'automation'
        ? buildActionConfig(values.actionType, values.actionTargetId, values.sourceType)
        : undefined;

    const payload = {
      name: values.name.trim(),
      url: isWebhookMode || (mode === 'automation' && values.actionType === 'send_webhook') ? values.url.trim() : '',
      events,
      description: isWebhookMode ? values.description.trim() || undefined : undefined,
      secret: isWebhookMode ? values.secret.trim() || undefined : undefined,
      status: isWebhookMode && !values.status ? ('DISABLED' as const) : ('ACTIVE' as const),
      source_type: mode === 'automation' ? values.sourceType : undefined,
      source_id: mode === 'automation' ? values.sourceId.trim() : undefined,
      condition: automationCondition,
      action_type: mode === 'automation' ? values.actionType : undefined,
      action_config: mode === 'automation' ? actionConfig : undefined,
    };

    try {
      if (editingWebhook) {
        await WebhooksApi.updateWebhook(editingWebhook.webhook_id, payload);
      } else {
        await WebhooksApi.createWebhook(payload);
      }
      onSaved();
    } catch (e: any) {
      setSubmitError(
        e?.message ??
          intl.formatMessage({
            defaultMessage: 'Failed to save webhook',
            description: 'Generic error message informing the user that webhook saving failed',
          }),
      );
    } finally {
      setIsSaving(false);
    }
  };

  const nameValidationMessage = intl.formatMessage({
    defaultMessage:
      'Name must start and end with a letter or digit, be less than 63 characters long, and contain only letters, digits, dots (.), underscores (_), and hyphens (-).',
    description: 'Webhook name validation error',
  });

  return (
    <FormProvider {...form}>
      <Modal
        componentId="mlflow.settings.webhooks.form-modal"
        title={
          editingWebhook
            ? mode === 'automation'
              ? intl.formatMessage({ defaultMessage: 'Edit automation', description: 'Edit automation modal title' })
              : intl.formatMessage({ defaultMessage: 'Edit webhook', description: 'Edit webhook modal title' })
            : mode === 'automation'
              ? intl.formatMessage({
                  defaultMessage: 'Create automation',
                  description: 'Create automation modal title',
                })
              : intl.formatMessage({ defaultMessage: 'Create webhook', description: 'Create webhook modal title' })
        }
        visible={visible}
        onCancel={onClose}
        onOk={form.handleSubmit(handleSubmit)}
        okText={
          editingWebhook
            ? intl.formatMessage({ defaultMessage: 'Save', description: 'Save webhook button' })
            : intl.formatMessage({
                defaultMessage: 'Create',
                description: 'Create webhook or automation confirm button',
              })
        }
        cancelText={intl.formatMessage({ defaultMessage: 'Cancel', description: 'Cancel webhook form button' })}
        confirmLoading={isSaving}
        size="wide"
      >
        <div css={{ display: 'flex', flexDirection: 'column', gap: theme.spacing.md }}>
          {submitError && (
            <Alert componentId="mlflow.settings.webhooks.form-error-alert" type="error" message={submitError} />
          )}

          <div>
            <FormUI.Label htmlFor="mlflow.settings.webhooks.name-input">
              <FormattedMessage defaultMessage="Name" description="Webhook name field label" /> *
            </FormUI.Label>
            <RHFControlledComponents.Input
              name="name"
              control={form.control}
              id="mlflow.settings.webhooks.name-input"
              componentId="mlflow.settings.webhooks.name-input"
              placeholder={
                mode === 'automation'
                  ? intl.formatMessage({
                      defaultMessage: 'route-rentals-to-pm-review',
                      description: 'Automation name placeholder',
                    })
                  : intl.formatMessage({
                      defaultMessage: 'my-webhook',
                      description: 'Webhook name placeholder',
                    })
              }
              rules={{
                required: intl.formatMessage({
                  defaultMessage: 'Name is required',
                  description: 'Form validation error message informing the user that the webhook name is required',
                }),
                validate: (value) => {
                  const trimmed = String(value).trim();
                  if (trimmed.length > 63 || !WEBHOOK_NAME_REGEX.test(trimmed)) {
                    return nameValidationMessage;
                  }
                  return true;
                },
              }}
              validationState={form.formState.errors.name ? 'error' : undefined}
            />
            {form.formState.errors.name && <FormUI.Message type="error" message={form.formState.errors.name.message} />}
          </div>

          {isWebhookMode && (
            <div>
              <FormUI.Label htmlFor="mlflow.settings.webhooks.url-input">
                <FormattedMessage defaultMessage="URL" description="Webhook URL field label" /> *
              </FormUI.Label>
              <RHFControlledComponents.Input
                name="url"
                control={form.control}
                id="mlflow.settings.webhooks.url-input"
                componentId="mlflow.settings.webhooks.url-input"
                placeholder={intl.formatMessage({
                  defaultMessage: 'https://example.com/webhook',
                  description: 'Webhook URL placeholder',
                })}
                rules={{
                  required: intl.formatMessage({
                    defaultMessage: 'URL is required',
                    description: 'Form validation error message informing the user that the webhook URL is required',
                  }),
                }}
                validationState={form.formState.errors.url ? 'error' : undefined}
              />
              {form.formState.errors.url && <FormUI.Message type="error" message={form.formState.errors.url.message} />}
            </div>
          )}

          {isWebhookMode && (
            <div>
              <FormUI.Label htmlFor="mlflow.settings.webhooks.description-input">
                <FormattedMessage defaultMessage="Description" description="Webhook description field label" />
              </FormUI.Label>
              <RHFControlledComponents.TextArea
                name="description"
                control={form.control}
                id="mlflow.settings.webhooks.description-input"
                componentId="mlflow.settings.webhooks.description-input"
                placeholder={intl.formatMessage({
                  defaultMessage: 'Optional description',
                  description: 'Webhook description placeholder',
                })}
                rows={2}
              />
            </div>
          )}

          {isWebhookMode && (
            <div>
              <FormUI.Label htmlFor="mlflow.settings.webhooks.secret-input">
                <FormattedMessage defaultMessage="Secret" description="Webhook secret field label" />
              </FormUI.Label>
              <FormUI.Hint>
                <FormattedMessage
                  defaultMessage="Used for HMAC signature verification of incoming webhook requests."
                  description="Webhook secret field description"
                />
              </FormUI.Hint>
              <RHFControlledComponents.Password
                name="secret"
                control={form.control}
                id="mlflow.settings.webhooks.secret-input"
                placeholder={
                  editingWebhook
                    ? intl.formatMessage({
                        defaultMessage: 'Leave blank to keep existing secret',
                        description: 'Webhook secret placeholder when editing',
                      })
                    : intl.formatMessage({
                        defaultMessage: 'Optional secret key',
                        description: 'Webhook secret placeholder when creating',
                      })
                }
              />
            </div>
          )}

          {isWebhookMode && (
            <div css={{ display: 'flex', alignItems: 'center', gap: theme.spacing.sm }}>
              <FormUI.Label htmlFor="mlflow.settings.webhooks.status-switch">
                <FormattedMessage defaultMessage="Active" description="Webhook status field label" />
              </FormUI.Label>
              <RHFControlledComponents.Switch
                name="status"
                control={form.control}
                id="mlflow.settings.webhooks.status-switch"
                componentId="mlflow.settings.webhooks.status-switch"
                activeLabel={intl.formatMessage({ defaultMessage: 'Active', description: 'Webhook active label' })}
                inactiveLabel={intl.formatMessage({
                  defaultMessage: 'Disabled',
                  description: 'Webhook disabled label',
                })}
              />
            </div>
          )}

          {mode === 'automation' && (
            <>
              {!lockSource && (
                <AutomationRuleSection
                  icon={<LightningIcon />}
                  title={<FormattedMessage defaultMessage="Scope" description="Automation scope section title" />}
                >
                  <div
                    css={{
                      display: 'grid',
                      gridTemplateColumns: 'minmax(160px, 220px) minmax(0, 1fr)',
                      gap: theme.spacing.sm,
                    }}
                  >
                    <Controller
                      name="sourceType"
                      control={form.control}
                      render={({ field }) => (
                        <SimpleSelect
                          id="mlflow.settings.automations.source-type-input"
                          aria-label="Source"
                          componentId="mlflow.settings.automations.source-type-input"
                          value={field.value}
                          onChange={({ target }) => field.onChange(target.value)}
                          css={{ width: '100%' }}
                        >
                          {SOURCE_TYPES.map((sourceType) => (
                            <SimpleSelectOption key={sourceType.value} value={sourceType.value}>
                              {sourceType.label}
                            </SimpleSelectOption>
                          ))}
                        </SimpleSelect>
                      )}
                    />
                    <RHFControlledComponents.Input
                      name="sourceId"
                      control={form.control}
                      id="mlflow.settings.automations.source-id-input"
                      aria-label="Source ID"
                      componentId="mlflow.settings.automations.source-id-input"
                      placeholder={intl.formatMessage({
                        defaultMessage: 'Experiment, queue, dataset, or trace ID',
                        description: 'Automation source id placeholder',
                      })}
                    />
                  </div>
                </AutomationRuleSection>
              )}

              <AutomationRuleSection
                icon={<FilterIcon />}
                title={<FormattedMessage defaultMessage="IF" description="Automation condition field label" />}
                description={
                  <FormattedMessage
                    defaultMessage="Define which trace assessments should match."
                    description="Automation condition section description"
                  />
                }
              >
                <AutomationConditionFilter
                  filters={conditionFilters}
                  setFilters={setConditionFilters}
                  experimentId={experimentId}
                />
              </AutomationRuleSection>

              <AutomationRuleSection
                icon={<ArrowRightIcon />}
                title={<FormattedMessage defaultMessage="THEN" description="Automation action type field label" />}
                description={
                  <FormattedMessage
                    defaultMessage="Choose the action and destination."
                    description="Automation action section description"
                  />
                }
              >
                <div css={{ display: 'flex', flexDirection: 'column', gap: theme.spacing.xs }}>
                  <div
                    css={{
                      display: 'grid',
                      gridTemplateColumns: 'minmax(220px, 260px) 20px minmax(260px, 1fr)',
                      gap: theme.spacing.sm,
                      alignItems: 'center',
                    }}
                  >
                    <Controller
                      name="actionType"
                      control={form.control}
                      render={({ field }) => (
                        <SimpleSelect
                          id="mlflow.settings.automations.action-type-input"
                          aria-label="Action"
                          componentId="mlflow.settings.automations.action-type-input"
                          value={field.value}
                          onChange={({ target }) => {
                            field.onChange(target.value);
                            form.setValue('actionTargetId', '');
                            if (target.value !== 'send_webhook') {
                              form.setValue('url', '');
                            }
                          }}
                          css={{ width: '100%' }}
                        >
                          {actionTypeOptions.map((action) => (
                            <SimpleSelectOption key={action.value} value={action.value}>
                              {action.label}
                            </SimpleSelectOption>
                          ))}
                        </SimpleSelect>
                      )}
                    />
                    <ArrowRightIcon css={{ color: theme.colors.textSecondary, justifySelf: 'center' }} />
                    <AutomationActionFields form={form} actionType={actionType} experimentId={experimentId} />
                  </div>
                </div>
              </AutomationRuleSection>
            </>
          )}

          {isWebhookMode && (
            <div>
              <FormUI.Label>
                <FormattedMessage defaultMessage="Events" description="Webhook events field label" /> *
              </FormUI.Label>
              <FormUI.Hint>
                <FormattedMessage
                  defaultMessage="Select the events that will trigger this webhook."
                  description="Webhook events field description"
                />
              </FormUI.Hint>
              <Controller
                name="events"
                control={form.control}
                rules={{
                  validate: (value: string[]) =>
                    value.length > 0 ||
                    intl.formatMessage({
                      defaultMessage: 'At least one event must be selected',
                      description:
                        'Form validation error message informing the user that at least one event must be selected',
                    }),
                }}
                render={({ field }) => (
                  <div css={{ display: 'flex', flexDirection: 'column', gap: theme.spacing.sm }}>
                    {EVENT_GROUPS.map((group) => {
                      const events = displayedEvents.filter((e) => group.entities.includes(e.entity));
                      if (events.length === 0) {
                        return null;
                      }
                      const isOpen = openGroups.has(group.label);
                      return (
                        <div key={group.label}>
                          <div
                            role="button"
                            tabIndex={0}
                            onClick={() => toggleGroup(group.label)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                toggleGroup(group.label);
                              }
                            }}
                            css={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: theme.spacing.xs,
                              cursor: 'pointer',
                              userSelect: 'none',
                            }}
                          >
                            <ChevronRightIcon
                              css={{ transform: isOpen ? 'rotate(90deg)' : undefined, transition: 'transform 0.1s' }}
                            />
                            <Typography.Text bold>{group.label}</Typography.Text>
                          </div>
                          {isOpen && (
                            <div
                              css={{
                                display: 'flex',
                                flexDirection: 'column',
                                gap: theme.spacing.xs,
                                paddingLeft: theme.spacing.lg,
                                paddingTop: theme.spacing.xs,
                              }}
                            >
                              {events.map((event) => {
                                const key = eventKey(event.entity, event.action);
                                return (
                                  <Checkbox
                                    key={key}
                                    componentId="mlflow.settings.webhooks.event-checkbox"
                                    isChecked={field.value.includes(key)}
                                    onChange={(checked) => {
                                      const next = checked
                                        ? [...field.value, key]
                                        : field.value.filter((k: string) => k !== key);
                                      field.onChange(next);
                                    }}
                                  >
                                    {formatEventLabel(event.entity, event.action)}
                                  </Checkbox>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              />
              {form.formState.errors.events && (
                <FormUI.Message type="error" message={form.formState.errors.events.message} />
              )}
            </div>
          )}
        </div>
      </Modal>
    </FormProvider>
  );
};

export default WebhookFormModal;
