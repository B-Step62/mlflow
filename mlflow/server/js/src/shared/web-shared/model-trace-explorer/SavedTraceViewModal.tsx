import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Button,
  Checkbox,
  DropdownMenu,
  FormUI,
  Input,
  Modal,
  PlusIcon,
  TrashIcon,
  Typography,
  useDesignSystemTheme,
} from '@databricks/design-system';
import { FormattedMessage, useIntl } from 'react-intl';

import type { SavedTraceView } from './mock_saved_views';
import {
  deleteLocalSavedView,
  getSavedViews,
  setLastAppliedSavedViewId,
  upsertLocalSavedView,
} from './mock_saved_views';
import { ModelSpanType } from './ModelTrace.types';
import { getDisplayNameForSpanType, getIconTypeForSpan } from './ModelTraceExplorer.utils';
import { SimpleSelect, SimpleSelectOption } from '@databricks/design-system';
import { ModelTraceExplorerIcon } from './ModelTraceExplorerIcon';
import { useModelTraceExplorerViewState } from './ModelTraceExplorerViewStateContext';

type EditorFields = SavedTraceView['definition'];

const SELECTABLE_SPAN_TYPES: string[] = [
  ModelSpanType.CHAIN,
  ModelSpanType.CHAT_MODEL,
  ModelSpanType.LLM,
  ModelSpanType.TOOL,
  ModelSpanType.AGENT,
  ModelSpanType.RETRIEVER,
  ModelSpanType.PARSER,
  ModelSpanType.EMBEDDING,
  ModelSpanType.RERANKER,
  ModelSpanType.MEMORY,
];

function ensureEditor(def?: Partial<EditorFields>): EditorFields {
  return {
    spans: {
      span_types: def?.spans?.span_types ?? [],
      span_name_pattern: def?.spans?.span_name_pattern ?? '',
      show_parents: def?.spans?.show_parents ?? true,
      show_root_span: def?.spans?.show_root_span ?? true,
      show_exceptions: def?.spans?.show_exceptions ?? true,
    },
    fields: def?.fields ?? {},
  } as EditorFields;
}

const SectionHeader = ({ children }: { children: React.ReactNode }) => {
  const { theme } = useDesignSystemTheme();
  return (
    <Typography.Text bold css={{ display: 'block', marginTop: theme.spacing.md }}>
      {children}
    </Typography.Text>
  );
};

const KeyListEditor = ({
  value,
  onChange,
  placeholder,
}: {
  value?: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
}) => {
  const { theme } = useDesignSystemTheme();
  const list = value ?? [];
  const handleAdd = () => onChange([...list, '']);
  const handleChange = (idx: number, v: string) => onChange(list.map((x, i) => (i === idx ? v : x)));
  const handleRemove = (idx: number) => onChange(list.filter((_, i) => i !== idx));
  return (
    <div css={{ display: 'flex', flexDirection: 'column', gap: theme.spacing.xs }}>
      {list.map((val, idx) => (
        <div key={idx} css={{ display: 'flex', gap: theme.spacing.xs }}>
          <Input
            value={val}
            placeholder={placeholder}
            onChange={(e) => handleChange(idx, e.target.value)}
            allowClear
          />
          <Button icon={<TrashIcon />} onClick={() => handleRemove(idx)} />
        </div>
      ))}
      <div>
        <Button icon={<PlusIcon />} onClick={handleAdd}>
          <FormattedMessage defaultMessage="Add" description="Add new key to list" />
        </Button>
      </div>
    </div>
  );
};

export const SavedTraceViewModal = ({
  visible,
  experimentId,
  onClose,
}: {
  visible: boolean;
  experimentId: string;
  onClose: () => void;
}) => {
  const intl = useIntl();
  const { theme } = useDesignSystemTheme();
  const { setAppliedSavedView, setSelectedSavedViewId, setAlwaysShowRootSpan } =
    useModelTraceExplorerViewState();

  const [views, setViews] = useState<SavedTraceView[]>([]);
  const [selectedId, setSelectedId] = useState<string>('');
  const [working, setWorking] = useState<SavedTraceView | undefined>();

  const loadViews = useCallback(() => {
    setViews(getSavedViews(experimentId));
  }, [experimentId]);

  useEffect(() => {
    if (visible) {
      loadViews();
    }
  }, [visible, loadViews]);

  const selectedName = useMemo(() => views.find((v) => v.id === selectedId)?.name, [views, selectedId]);

  const createEmptyView = (): SavedTraceView => ({
    id: '',
    name: intl.formatMessage({ defaultMessage: 'Untitled view', description: 'Default new view name' }),
    experiment_id: experimentId,
    definition: ensureEditor({}),
  });

  const handleSelectExisting = (id: string) => {
    setSelectedId(id);
    const v = views.find((x) => x.id === id);
    if (v) {
      setWorking({ ...v });
      // Live apply
      setAppliedSavedView(v);
      setAlwaysShowRootSpan(v.definition.spans.show_root_span ?? true);
    }
  };

  const handleCreateNew = () => {
    const v = createEmptyView();
    setWorking(v);
    setSelectedId(v.id);
    setAppliedSavedView(v);
    setAlwaysShowRootSpan(v.definition.spans.show_root_span ?? true);
  };

  // Live-apply changes as user edits
  const setWorkingDefinition = (updater: (prev: EditorFields) => EditorFields) => {
    setWorking((prev) => {
      if (!prev) return prev;
      const next = { ...prev, definition: updater(prev.definition) } as SavedTraceView;
      setAppliedSavedView(next);
      setAlwaysShowRootSpan(next.definition.spans.show_root_span ?? true);
      return next;
    });
  };

  const handleApply = () => {
    if (!working) return;
    setAppliedSavedView(working);
    setSelectedSavedViewId(working.id || undefined);
    setLastAppliedSavedViewId(experimentId, working.id || undefined);
  };

  const handleSave = () => {
    if (!working) return;
    const saved = upsertLocalSavedView(experimentId, working);
    setAppliedSavedView(saved);
    setSelectedSavedViewId(saved.id);
    setLastAppliedSavedViewId(experimentId, saved.id);
    loadViews();
    onClose();
  };

  const handleDelete = () => {
    if (!working?.id) return;
    deleteLocalSavedView(experimentId, working.id);
    if (selectedId === working.id) {
      setSelectedId('');
    }
    setWorking(undefined);
    loadViews();
  };

  const renderSpanTypeSelector = () => {
    const selectedTypes = new Set(working?.definition.spans.span_types || []);
    const toggleType = (t: string) => {
      setWorkingDefinition((prev) => {
        const curr = new Set(prev.spans.span_types || []);
        if (curr.has(t)) curr.delete(t);
        else curr.add(t);
        return { ...prev, spans: { ...prev.spans, span_types: Array.from(curr) } } as EditorFields;
      });
      return;
    };
    return (
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <Button size="small">
            {intl.formatMessage({ defaultMessage: 'Span types', description: 'Span types selector label' })}
          </Button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Content align="start" minWidth={240}>
          <Typography.Text color="secondary" css={{ padding: '4px 8px', display: 'block' }}>
            <FormattedMessage defaultMessage="Span type" description="Span type section label in selector" />
          </Typography.Text>
          {SELECTABLE_SPAN_TYPES.map((t) => (
            <DropdownMenu.CheckboxItem
              key={t}
              checked={selectedTypes.has(t)}
              onCheckedChange={() => toggleType(t)}
              onSelect={(e) => {
                e.preventDefault();
              }}
              componentId={`trace-view-modal.span-type-${t}`}
            >
              <DropdownMenu.ItemIndicator />
              <span css={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <ModelTraceExplorerIcon type={getIconTypeForSpan(t)} />
                <Typography.Text>{getDisplayNameForSpanType(t)}</Typography.Text>
              </span>
            </DropdownMenu.CheckboxItem>
          ))}
          <DropdownMenu.Arrow />
        </DropdownMenu.Content>
      </DropdownMenu.Root>
    );
  };

  const selectedOrNewLabel = selectedName ||
    intl.formatMessage({ defaultMessage: 'New view (unsaved)', description: 'Unsaved view label' });

  return (
    <Modal
      componentId="mlflow.trace-views.editor-modal"
      visible={visible}
      onCancel={onClose}
      title={
        <FormattedMessage defaultMessage="Select View" description="Title for saved trace view modal" />
      }
      footer={
        <div css={{ display: 'flex', width: '100%', justifyContent: 'flex-end', gap: theme.spacing.sm }}>
          <Button onClick={onClose}>
            <FormattedMessage defaultMessage="Close" description="Close modal button" />
          </Button>
          <Button type="default" onClick={handleApply} disabled={!working}>
            <FormattedMessage defaultMessage="Apply" description="Apply saved view without closing" />
          </Button>
          <Button type="primary" onClick={handleSave} disabled={!working}>
            <FormattedMessage defaultMessage="Save" description="Save saved view and close" />
          </Button>
        </div>
      }
      width={800}
    >
      {/* View selector */}
      <SectionHeader>
        <FormattedMessage defaultMessage="View" description="Section label for view selection" />
      </SectionHeader>
        <div css={{ display: 'flex', gap: theme.spacing.sm, alignItems: 'center' }}>
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <Button>{selectedOrNewLabel}</Button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Content align="start">
            {views.map((v) => (
              <DropdownMenu.Item key={v.id} componentId={`trace-view-modal.select-${v.id}`} onClick={() => handleSelectExisting(v.id)}>
                {v.name}
              </DropdownMenu.Item>
            ))}
              <DropdownMenu.Separator />
              <DropdownMenu.Item componentId="trace-view-modal.create-new" onClick={handleCreateNew}>
                <PlusIcon />
                <span css={{ marginLeft: theme.spacing.xs }}>
                  <FormattedMessage defaultMessage="Create new view" description="Menu option to create new view" />
                </span>
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Root>
          {working?.id && (
            <Button componentId="trace-view-modal.delete" danger icon={<TrashIcon />} onClick={handleDelete}>
              <FormattedMessage defaultMessage="Delete" description="Delete saved view" />
            </Button>
          )}
        </div>

      {/* Edit UI */}
      <SectionHeader>
        <FormattedMessage defaultMessage="Details" description="Section label for view details" />
      </SectionHeader>
        <div css={{ display: 'grid', gridTemplateColumns: '1fr', gap: theme.spacing.sm }}>
          <div>
            <FormUI.Label>
              <FormattedMessage defaultMessage="Name" description="Saved view name label" />
            </FormUI.Label>
            <Input
              value={working?.name || ''}
              onChange={(e) => setWorking((w) => (w ? { ...w, name: e.target.value } : w))}
              placeholder={intl.formatMessage({ defaultMessage: 'Enter name', description: 'Saved view name PH' })}
            />
          </div>
          <div>
            <FormUI.Label>
              <FormattedMessage defaultMessage="Description" description="Saved view description label" />
            </FormUI.Label>
            <Input.TextArea
              value={(working as any)?.description || ''}
              rows={2}
              onChange={(e) => setWorking((w) => (w ? ({ ...(w as any), description: e.target.value } as any) : w))}
              placeholder={intl.formatMessage({
                defaultMessage: 'Optional description',
                description: 'Saved view description placeholder',
              })}
            />
          </div>
          <div>
            <FormUI.Label>
              <FormattedMessage defaultMessage="Span types to show" description="Span types label" />
            </FormUI.Label>
            {renderSpanTypeSelector()}
          </div>
        </div>

      {/* Field filters per span type */}
      <SectionHeader>
        <FormattedMessage defaultMessage="Field filters" description="Section label for field filters" />
      </SectionHeader>
        <div css={{ display: 'grid', gridTemplateColumns: '1fr', gap: theme.spacing.md }}>
          {(working?.definition.spans.span_types ?? []).map((spanType) => {
            const fields = working?.definition.fields?.[spanType] || {};
          return (
            <div
              key={spanType}
              css={{
                border: `1px solid ${theme.colors.border}`,
                borderRadius: theme.general.borderRadiusBase,
                padding: theme.spacing.sm,
              }}
            >
              <Typography.Text bold>{getDisplayNameForSpanType(spanType)}</Typography.Text>
              <div css={{ display: 'grid', gridTemplateColumns: '1fr', gap: theme.spacing.sm, marginTop: theme.spacing.sm }}>
                <div>
                  <FormUI.Label>
                    <FormattedMessage defaultMessage="Inputs" description="Inputs label" />
                  </FormUI.Label>
                  <KeyListEditor
                    value={fields.inputs?.keys}
                    onChange={(next) =>
                      setWorkingDefinition((prev) => ({
                        ...prev,
                        fields: {
                          ...prev.fields,
                          [spanType]: { ...fields, inputs: { keys: next } },
                        },
                      }))
                    }
                    placeholder={intl.formatMessage({ defaultMessage: 'Input key', description: 'Input key PH' })}
                  />
        </div>

        {/* Other options at the bottom */}
        <div css={{ marginTop: theme.spacing.md }}>
          <FormUI.Label>
            <FormattedMessage defaultMessage="Other options" description="Other options label" />
          </FormUI.Label>
          <div css={{ display: 'flex', gap: theme.spacing.lg }}>
            <Checkbox
              componentId={`trace-view-modal.toggle-show-parents_${!working?.definition.spans.show_parents}`}
              isChecked={!!working?.definition.spans.show_parents}
              onChange={() =>
                setWorkingDefinition((prev) => ({
                  ...prev,
                  spans: { ...prev.spans, show_parents: !prev.spans.show_parents },
                }))
              }
            >
              <FormattedMessage defaultMessage="Show parents" description="Option: show parents" />
            </Checkbox>
            <Checkbox
              componentId={`trace-view-modal.toggle-show-exceptions_${!working?.definition.spans.show_exceptions}`}
              isChecked={!!working?.definition.spans.show_exceptions}
              onChange={() =>
                setWorkingDefinition((prev) => ({
                  ...prev,
                  spans: { ...prev.spans, show_exceptions: !prev.spans.show_exceptions },
                }))
              }
            >
              <FormattedMessage defaultMessage="Show exceptions" description="Option: show exceptions" />
            </Checkbox>
            <Checkbox
              componentId={`trace-view-modal.toggle-show-root_${!working?.definition.spans.show_root_span}`}
              isChecked={!!working?.definition.spans.show_root_span}
              onChange={() =>
                setWorkingDefinition((prev) => ({
                  ...prev,
                  spans: { ...prev.spans, show_root_span: !prev.spans.show_root_span },
                }))
              }
            >
              <FormattedMessage defaultMessage="Show root span" description="Option: show root span" />
            </Checkbox>
          </div>
        </div>
                <FieldKeysByTargetEditor
                  componentPrefix={`trace-view-modal.${spanType}`}
                  fields={fields}
                  onChange={(next) =>
                    setWorkingDefinition((prev) => ({
                      ...prev,
                      fields: {
                        ...prev.fields,
                        [spanType]: next,
                      },
                    }))
                  }
                />
              </div>
            </div>
          );
        })}
      </div>
    </Modal>
  );
};

export default SavedTraceViewModal;
