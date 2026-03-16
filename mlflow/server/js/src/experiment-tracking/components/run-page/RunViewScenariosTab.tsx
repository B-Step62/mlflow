import { useMemo, useState, useCallback, useRef, useEffect } from 'react';
import {
  Button,
  ChecklistIcon,
  Empty,
  Modal,
  Spinner,
  TableSkeleton,
  UserIcon,
  useDesignSystemTheme,
} from '@databricks/design-system';
import { FormattedMessage, useIntl } from 'react-intl';
import {
  MLFLOW_FIND_BUGS_DATASET_ID_TAG,
  MLFLOW_FIND_BUGS_AGENT_DESCRIPTION_TAG,
  MLFLOW_FIND_BUGS_MODEL_TAG,
} from '../../constants';
import {
  useGetDatasetRecordsQuery,
  useGetDatasetQuery,
  useUpsertDatasetRecords,
  useDeleteDatasetRecords,
  useSetDatasetTags,
  useGenerateScenarios,
} from './hooks/useDatasetRecordsQuery';
import type { KeyValueEntity } from '../../../common/types';
import { parseJSONSafe } from '../../../common/utils/TagUtils';

interface ScenarioRow {
  recordId: string;
  goal: string;
  persona: string;
  guidelines: string;
}

interface RunViewScenariosTabProps {
  runUuid: string;
  experimentId: string;
  tags: Record<string, KeyValueEntity>;
  onTagUpdated: () => void;
}

const parseInputs = (inputs: unknown): Record<string, string> => {
  if (!inputs) return {};
  if (typeof inputs === 'string') return (parseJSONSafe(inputs) as Record<string, string>) ?? {};
  if (typeof inputs === 'object') return inputs as Record<string, string>;
  return {};
};

const EditableCell = ({
  value,
  onSave,
  readOnly,
  autoFocus,
  truncate,
}: {
  value: string;
  onSave: (newValue: string) => void;
  readOnly: boolean;
  autoFocus?: boolean;
  truncate?: boolean;
}) => {
  const { theme } = useDesignSystemTheme();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  useEffect(() => {
    if (autoFocus && !readOnly) {
      setEditing(true);
    }
  }, [autoFocus, readOnly]);

  useEffect(() => {
    if (editing && textareaRef.current) {
      textareaRef.current.focus();
      textareaRef.current.setSelectionRange(textareaRef.current.value.length, textareaRef.current.value.length);
    }
  }, [editing]);

  const handleBlur = () => {
    setEditing(false);
    if (draft !== value) {
      onSave(draft);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setDraft(value);
      setEditing(false);
    }
  };

  if (readOnly) {
    return (
      <div
        css={{
          padding: `${theme.spacing.xs}px ${theme.spacing.sm}px`,
          fontSize: theme.typography.fontSizeSm,
          lineHeight: '1.5',
          maxWidth: '100%',
          ...(truncate
            ? {
                display: '-webkit-box',
                WebkitLineClamp: 2,
                WebkitBoxOrient: 'vertical' as const,
                overflow: 'hidden',
              }
            : {
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }),
        }}
      >
        {value || '\u00A0'}
      </div>
    );
  }

  if (editing) {
    return (
      <textarea
        ref={textareaRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        css={{
          width: '100%',
          minHeight: 60,
          padding: `${theme.spacing.xs}px ${theme.spacing.sm}px`,
          border: `1px solid ${theme.colors.actionPrimaryBackgroundDefault}`,
          borderRadius: theme.borders.borderRadiusMd,
          fontSize: theme.typography.fontSizeSm,
          lineHeight: '1.5',
          resize: 'vertical',
          fontFamily: 'inherit',
          outline: 'none',
        }}
      />
    );
  }

  return (
    <div
      onClick={() => setEditing(true)}
      css={{
        padding: `${theme.spacing.xs}px ${theme.spacing.sm}px`,
        fontSize: theme.typography.fontSizeSm,
        lineHeight: '1.5',
        cursor: 'pointer',
        borderRadius: theme.borders.borderRadiusMd,
        minHeight: 40,
        maxWidth: '100%',
        ...(truncate
          ? {
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical' as const,
              overflow: 'hidden',
            }
          : {
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }),
        '&:hover': {
          backgroundColor: theme.colors.actionTertiaryBackgroundHover,
        },
      }}
    >
      {value || <span css={{ color: theme.colors.textPlaceholder }}>Click to edit</span>}
    </div>
  );
};

export const RunViewScenariosTab = ({ runUuid, experimentId, tags, onTagUpdated }: RunViewScenariosTabProps) => {
  const { theme } = useDesignSystemTheme();
  const intl = useIntl();
  const datasetId = tags[MLFLOW_FIND_BUGS_DATASET_ID_TAG]?.value ?? '';
  const agentDescription = tags[MLFLOW_FIND_BUGS_AGENT_DESCRIPTION_TAG]?.value ?? '';
  const modelTag = tags[MLFLOW_FIND_BUGS_MODEL_TAG]?.value ?? '';
  const hasDatasetId = Boolean(datasetId);

  const {
    records,
    isLoading: isLoadingRecords,
    refetch: refetchRecords,
  } = useGetDatasetRecordsQuery({
    datasetId,
    enabled: hasDatasetId,
  });
  const {
    dataset,
    isLoading: isLoadingDataset,
    refetch: refetchDataset,
  } = useGetDatasetQuery({
    datasetId,
    enabled: hasDatasetId,
  });
  const { upsertRecords } = useUpsertDatasetRecords({ datasetId });
  const { deleteRecords } = useDeleteDatasetRecords({ datasetId });
  const { setTags } = useSetDatasetTags({ datasetId });
  const { generateScenarios, isGenerating } = useGenerateScenarios({ datasetId });

  const [newRowId, setNewRowId] = useState<string | null>(null);
  const [isRegenerateModalOpen, setIsRegenerateModalOpen] = useState(false);
  const [regenerateTopics, setRegenerateTopics] = useState('');
  const [regenerateInstructions, setRegenerateInstructions] = useState('');

  const datasetTags = useMemo(() => {
    if (!dataset?.tags) return {};
    return (parseJSONSafe(dataset.tags) as Record<string, string>) ?? {};
  }, [dataset]);

  const status = datasetTags['status'] ?? '';
  const isConfirmed = status === 'confirmed';
  const isPendingReview = status === 'pending_review';

  const scenarios: ScenarioRow[] = useMemo(() => {
    return records.map((record) => {
      const inputs = parseInputs(record.inputs);
      return {
        recordId: record.dataset_record_id,
        goal: inputs['goal'] ?? '',
        persona: inputs['persona'] ?? '',
        guidelines: inputs['simulation_guidelines'] ?? '',
      };
    });
  }, [records]);

  const handleCellSave = useCallback(
    async (recordId: string, field: string, newValue: string) => {
      const record = records.find((r) => r.dataset_record_id === recordId);
      if (!record) return;

      const currentInputs = parseInputs(record.inputs);
      const updatedInputs = { ...currentInputs, [field]: newValue };

      await upsertRecords([
        {
          dataset_record_id: recordId,
          inputs: JSON.stringify(updatedInputs),
        },
      ]);
      refetchRecords();
    },
    [records, upsertRecords, refetchRecords],
  );

  const handleDelete = useCallback(
    async (recordId: string) => {
      await deleteRecords([recordId]);
      refetchRecords();
    },
    [deleteRecords, refetchRecords],
  );

  const handleAddScenario = useCallback(async () => {
    const tempId = `new-${Date.now()}`;
    await upsertRecords([
      {
        inputs: JSON.stringify({
          goal: '',
          persona: '',
          simulation_guidelines: '',
        }),
      },
    ]);
    await refetchRecords();
    setNewRowId(tempId);
  }, [upsertRecords, refetchRecords]);

  const handleRegenerateSubmit = useCallback(async () => {
    if (!agentDescription || !modelTag) return;
    const parts: string[] = [];
    if (regenerateTopics.trim()) {
      parts.push(`Focus on: ${regenerateTopics.trim()}`);
    }
    if (regenerateInstructions.trim()) {
      parts.push(regenerateInstructions.trim());
    }
    const guidance = parts.join('. ') || undefined;
    await generateScenarios({
      agentDescription,
      model: modelTag,
      testingGuidance: guidance ?? '',
    });
    setRegenerateTopics('');
    setRegenerateInstructions('');
    setIsRegenerateModalOpen(false);
    refetchRecords();
  }, [agentDescription, modelTag, regenerateTopics, regenerateInstructions, generateScenarios, refetchRecords]);

  const handleConfirm = useCallback(async () => {
    await setTags({ status: 'confirmed' });
    refetchDataset();
    onTagUpdated();
  }, [setTags, refetchDataset, onTagUpdated]);

  if (!hasDatasetId) {
    return (
      <div
        css={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: theme.spacing.md,
        }}
      >
        <Empty
          title={
            <FormattedMessage
              defaultMessage="No scenarios available"
              description="Run page > Scenarios tab > empty state title"
            />
          }
          description={
            <FormattedMessage
              defaultMessage="No scenarios available for this run."
              description="Run page > Scenarios tab > empty state description"
            />
          }
        />
      </div>
    );
  }

  if (isLoadingRecords || isLoadingDataset) {
    return (
      <div css={{ padding: theme.spacing.md }}>
        <TableSkeleton lines={5} />
      </div>
    );
  }

  const thStyle = {
    padding: `${theme.spacing.sm}px ${theme.spacing.sm}px`,
    textAlign: 'left' as const,
    fontSize: theme.typography.fontSizeSm,
    fontWeight: theme.typography.typographyBoldFontWeight,
    color: theme.colors.textSecondary,
  };

  const totalColumns = isConfirmed ? 4 : 5;

  return (
    <div
      css={{
        width: '100%',
        overflow: 'auto',
        padding: theme.spacing.md,
      }}
    >
      {/* Top bar */}
      {isPendingReview && (
        <div
          css={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            backgroundColor: theme.isDarkMode ? `${theme.colors.blue600}22` : `${theme.colors.blue100}`,
            borderRadius: theme.borders.borderRadiusMd,
            padding: `${theme.spacing.sm}px ${theme.spacing.md}px`,
            marginBottom: theme.spacing.md,
          }}
        >
          <span
            css={{
              display: 'flex',
              alignItems: 'center',
              gap: theme.spacing.xs,
              color: theme.colors.blue500,
              fontSize: theme.typography.fontSizeSm,
              fontWeight: theme.typography.typographyBoldFontWeight,
            }}
          >
            <ChecklistIcon />
            <FormattedMessage
              defaultMessage="Waiting for review"
              description="Run page > Scenarios tab > pending review status"
            />
          </span>
          <div css={{ display: 'flex', gap: theme.spacing.sm }}>
            {agentDescription && modelTag && (
              <Button
                componentId="scenarios-tab.regenerate-with-instruction"
                type="tertiary"
                onClick={() => setIsRegenerateModalOpen(true)}
              >
                <FormattedMessage
                  defaultMessage="Regenerate with instruction"
                  description="Run page > Scenarios tab > regenerate button"
                />
              </Button>
            )}
            <Button
              componentId="scenarios-tab.confirm-and-run"
              type="primary"
              onClick={handleConfirm}
              disabled={scenarios.length === 0}
            >
              <FormattedMessage
                defaultMessage="Confirm & Run"
                description="Run page > Scenarios tab > confirm button"
              />
            </Button>
          </div>
        </div>
      )}
      {isConfirmed && (
        <div
          css={{
            backgroundColor: theme.colors.backgroundSecondary,
            border: `1px solid ${theme.colors.border}`,
            borderRadius: theme.borders.borderRadiusMd,
            padding: `${theme.spacing.sm}px ${theme.spacing.md}px`,
            marginBottom: theme.spacing.md,
          }}
        >
          <span css={{ color: theme.colors.textSecondary, fontSize: theme.typography.fontSizeSm }}>
            <FormattedMessage
              defaultMessage="Scenarios confirmed — sent to simulation."
              description="Run page > Scenarios tab > confirmed status"
            />
          </span>
        </div>
      )}

      {/* Regeneration modal */}
      <Modal
        componentId="scenarios-tab.regenerate-modal"
        visible={isRegenerateModalOpen}
        onCancel={() => setIsRegenerateModalOpen(false)}
        title={intl.formatMessage({
          defaultMessage: 'Regenerate Scenarios',
          description: 'Run page > Scenarios tab > regenerate modal title',
        })}
        okText={intl.formatMessage({
          defaultMessage: 'Generate',
          description: 'Run page > Scenarios tab > regenerate modal ok button',
        })}
        cancelText={intl.formatMessage({
          defaultMessage: 'Cancel',
          description: 'Run page > Scenarios tab > regenerate modal cancel button',
        })}
        onOk={handleRegenerateSubmit}
        okButtonProps={{ loading: isGenerating }}
      >
        <div css={{ display: 'flex', flexDirection: 'column', gap: theme.spacing.md }}>
          <p css={{ color: theme.colors.textSecondary, fontSize: theme.typography.fontSizeSm, margin: 0 }}>
            <FormattedMessage
              defaultMessage="Generate additional scenarios based on your instructions. Existing scenarios (not deleted) will be preserved."
              description="Run page > Scenarios tab > regenerate modal description"
            />
          </p>
          <div>
            <label
              css={{
                display: 'block',
                fontSize: theme.typography.fontSizeSm,
                fontWeight: theme.typography.typographyBoldFontWeight,
                marginBottom: theme.spacing.xs,
              }}
            >
              <FormattedMessage
                defaultMessage="Topics to focus"
                description="Run page > Scenarios tab > regenerate modal > topics label"
              />
            </label>
            <input
              type="text"
              value={regenerateTopics}
              onChange={(e) => setRegenerateTopics(e.target.value)}
              placeholder={intl.formatMessage({
                defaultMessage: 'e.g., edge cases, multi-step workflows',
                description: 'Run page > Scenarios tab > regenerate modal > topics placeholder',
              })}
              css={{
                width: '100%',
                padding: `${theme.spacing.xs}px ${theme.spacing.sm}px`,
                border: `1px solid ${theme.colors.border}`,
                borderRadius: theme.borders.borderRadiusMd,
                fontSize: theme.typography.fontSizeSm,
                outline: 'none',
                '&:focus': {
                  borderColor: theme.colors.actionPrimaryBackgroundDefault,
                },
              }}
            />
          </div>
          <div>
            <label
              css={{
                display: 'block',
                fontSize: theme.typography.fontSizeSm,
                fontWeight: theme.typography.typographyBoldFontWeight,
                marginBottom: theme.spacing.xs,
              }}
            >
              <FormattedMessage
                defaultMessage="Additional instructions"
                description="Run page > Scenarios tab > regenerate modal > instructions label"
              />
            </label>
            <textarea
              value={regenerateInstructions}
              onChange={(e) => setRegenerateInstructions(e.target.value)}
              placeholder={intl.formatMessage({
                defaultMessage: 'e.g., Make personas more technical',
                description: 'Run page > Scenarios tab > regenerate modal > instructions placeholder',
              })}
              rows={3}
              css={{
                width: '100%',
                padding: `${theme.spacing.xs}px ${theme.spacing.sm}px`,
                border: `1px solid ${theme.colors.border}`,
                borderRadius: theme.borders.borderRadiusMd,
                fontSize: theme.typography.fontSizeSm,
                resize: 'vertical',
                fontFamily: 'inherit',
                outline: 'none',
                '&:focus': {
                  borderColor: theme.colors.actionPrimaryBackgroundDefault,
                },
              }}
            />
          </div>
        </div>
      </Modal>

      {/* Table */}
      <div
        css={{
          border: `1px solid ${theme.colors.border}`,
          borderRadius: theme.borders.borderRadiusMd,
          overflow: 'hidden',
        }}
      >
        <table
          css={{
            width: '100%',
            borderCollapse: 'collapse',
            tableLayout: 'fixed',
          }}
        >
          <colgroup>
            <col css={{ width: 48 }} />
            <col css={{ width: '40%' }} />
            <col css={{ width: '25%' }} />
            <col css={{ width: '30%' }} />
            {!isConfirmed && <col css={{ width: 48 }} />}
          </colgroup>
          <thead>
            <tr
              css={{
                backgroundColor: theme.colors.backgroundSecondary,
                borderBottom: `1px solid ${theme.colors.border}`,
              }}
            >
              <th css={{ ...thStyle, textAlign: 'center', width: 48 }}>#</th>
              <th css={thStyle}>
                <FormattedMessage
                  defaultMessage="Goal"
                  description="Run page > Scenarios tab > table header > goal"
                />
              </th>
              <th css={thStyle}>
                <FormattedMessage
                  defaultMessage="Persona"
                  description="Run page > Scenarios tab > table header > persona"
                />
              </th>
              <th css={thStyle}>
                <FormattedMessage
                  defaultMessage="Guidelines"
                  description="Run page > Scenarios tab > table header > guidelines"
                />
              </th>
              {!isConfirmed && <th css={{ width: 48, padding: `${theme.spacing.sm}px` }} />}
            </tr>
          </thead>
          <tbody>
            {scenarios.map((scenario, index) => (
              <tr
                key={scenario.recordId}
                css={{
                  borderBottom: `1px solid ${theme.colors.border}`,
                  verticalAlign: 'top',
                }}
              >
                <td
                  css={{
                    padding: `${theme.spacing.sm}px`,
                    textAlign: 'center',
                    fontSize: theme.typography.fontSizeSm,
                    color: theme.colors.textSecondary,
                  }}
                >
                  {index + 1}
                </td>
                <td css={{ padding: `${theme.spacing.xs}px 0` }}>
                  <EditableCell
                    value={scenario.goal}
                    onSave={(v) => handleCellSave(scenario.recordId, 'goal', v)}
                    readOnly={isConfirmed}
                    autoFocus={scenario.recordId === newRowId}
                  />
                </td>
                <td css={{ padding: `${theme.spacing.xs}px 0` }}>
                  <div css={{ display: 'flex', alignItems: 'flex-start' }}>
                    <span
                      css={{
                        display: 'flex',
                        alignItems: 'center',
                        flexShrink: 0,
                        padding: `${theme.spacing.xs}px 0 0 ${theme.spacing.sm}px`,
                        color: theme.colors.textSecondary,
                      }}
                    >
                      <UserIcon />
                    </span>
                    <div css={{ flex: 1, minWidth: 0 }}>
                      <EditableCell
                        value={scenario.persona}
                        onSave={(v) => handleCellSave(scenario.recordId, 'persona', v)}
                        readOnly={isConfirmed}
                      />
                    </div>
                  </div>
                </td>
                <td css={{ padding: `${theme.spacing.xs}px 0` }}>
                  <EditableCell
                    value={scenario.guidelines}
                    onSave={(v) => handleCellSave(scenario.recordId, 'simulation_guidelines', v)}
                    readOnly={isConfirmed}
                    truncate
                  />
                </td>
                {!isConfirmed && (
                  <td
                    css={{
                      padding: `${theme.spacing.sm}px`,
                      textAlign: 'center',
                      verticalAlign: 'middle',
                    }}
                  >
                    <Button
                      componentId="scenarios-tab.delete-scenario"
                      type="tertiary"
                      size="small"
                      onClick={() => handleDelete(scenario.recordId)}
                      dangerouslySetAntdProps={{ style: { color: theme.colors.textSecondary } }}
                    >
                      &times;
                    </Button>
                  </td>
                )}
              </tr>
            ))}
            {/* Add scenario row */}
            {!isConfirmed && (
              <tr>
                <td
                  colSpan={totalColumns}
                  css={{
                    padding: 0,
                  }}
                >
                  <button
                    type="button"
                    onClick={handleAddScenario}
                    css={{
                      width: '100%',
                      textAlign: 'center',
                      padding: `${theme.spacing.xs}px`,
                      border: 'none',
                      background: 'none',
                      color: theme.colors.textSecondary,
                      cursor: 'pointer',
                      fontSize: theme.typography.fontSizeSm,
                      '&:hover': {
                        backgroundColor: theme.colors.actionTertiaryBackgroundHover,
                      },
                    }}
                  >
                    + Add scenario
                  </button>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
