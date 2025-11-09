import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Button,
  Checkbox,
  DropdownMenu,
  FormUI,
  Input,
  SimpleSelect,
  SimpleSelectOption,
  PlusIcon,
  TrashIcon,
  Typography,
  useDesignSystemTheme,
  CloseIcon,
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
import { ModelTraceExplorerIcon } from './ModelTraceExplorerIcon';
import { useModelTraceExplorerViewState } from './ModelTraceExplorerViewStateContext';

type EditorFields = SavedTraceView['definition'];

const SELECTABLE_SPAN_TYPES: ModelSpanType[] = [
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
            componentId="trace-view-editor.key-input"
            value={val}
            placeholder={placeholder}
            onChange={(e) => handleChange(idx, e.target.value)}
            allowClear
          />
          <Button icon={<TrashIcon />} onClick={() => handleRemove(idx)} componentId="trace-view-editor.remove-key" />
        </div>
      ))}
      <div>
        <Button icon={<PlusIcon />} onClick={handleAdd} componentId="trace-view-editor.add-key">
          <FormattedMessage defaultMessage="Add" description="Add new key to list" />
        </Button>
      </div>
    </div>
  );
};

export const SavedTraceViewPanel = ({
  open,
  experimentId,
  onClose,
}: {
  open: boolean;
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
    if (open) {
      loadViews();
    }
  }, [open, loadViews]);

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

  const setWorkingDefinition = (updater: (prev: EditorFields) => EditorFields) => {
    setWorking((prev) => {
      if (!prev) return prev;
      const next = { ...prev, definition: updater(prev.definition) } as SavedTraceView;
      setAppliedSavedView(next);
      setAlwaysShowRootSpan(next.definition.spans.show_root_span ?? true);
      return next;
    });
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
        if (curr.has(t as any)) curr.delete(t as any);
        else curr.add(t as any);
        return { ...prev, spans: { ...prev.spans, span_types: Array.from(curr) } } as EditorFields;
      });
      return;
    };
    return (
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <Button size="small" componentId="trace-view-editor.span-type-selector">
            <FormattedMessage defaultMessage="Span types" description="Span types selector label" />
          </Button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Content align="start" minWidth={240}>
          <Typography.Text color="secondary" css={{ padding: '4px 8px', display: 'block' }}>
            <FormattedMessage defaultMessage="Span type" description="Span type section label in selector" />
          </Typography.Text>
          {SELECTABLE_SPAN_TYPES.map((t) => (
            <DropdownMenu.CheckboxItem
              key={t}
              checked={selectedTypes.has(t as any)}
              onCheckedChange={() => toggleType(t)}
              // Keep menu open while toggling
              onSelect={(e) => {
                e.preventDefault();
              }}
              componentId={`trace-view-editor.span-type-${t}`}
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

  if (!open) return null;

  return (
    <div
      css={{
        position: 'absolute',
        top: 0,
        right: 0,
        height: '100%',
        width: '33%',
        minWidth: 360,
        maxWidth: 640,
        background: 'white',
        borderLeft: `1px solid ${theme.colors.border}`,
        boxShadow: theme.general.shadowLow,
        display: 'flex',
        flexDirection: 'column',
        zIndex: 1,
      }}
    >
      {/* Header */}
      <div
        css={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: `${theme.spacing.sm}px ${theme.spacing.md}px`,
          minHeight: 44,
          borderBottom: `1px solid ${theme.colors.border}`,
        }}
      >
        <div css={{ display: 'flex', alignItems: 'center', gap: theme.spacing.sm }}>
          <Button icon={<CloseIcon />} onClick={onClose} size="small" componentId="trace-view-editor.close" />
          <Typography.Text size="lg" bold css={{ margin: 0, lineHeight: '20px' }}>
            <FormattedMessage defaultMessage="Configure View" description="Title for saved trace view panel" />
          </Typography.Text>
        </div>
        <div css={{ display: 'flex', gap: theme.spacing.xs, alignItems: 'center' }}>
          <Button type="primary" onClick={handleSave} size="small" disabled={!working} componentId="trace-view-editor.save">
            <FormattedMessage defaultMessage="Save" description="Save saved view" />
          </Button>
        </div>
      </div>

      {/* Body */}
      <div css={{ padding: theme.spacing.md, overflow: 'auto', flex: 1, gap: theme.spacing.md }}>
        {/* View selector */}
        <div css={{ display: 'flex', gap: theme.spacing.sm, alignItems: 'center' }}>
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <Button componentId="trace-view-editor.view-selector">{selectedOrNewLabel}</Button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Content align="start">
              {views.map((v) => (
                <DropdownMenu.Item key={v.id} componentId={`trace-view-editor.select-${v.id}`} onClick={() => handleSelectExisting(v.id)}>
                  {v.name}
                </DropdownMenu.Item>
              ))}
              <DropdownMenu.Separator />
              <DropdownMenu.Item componentId="trace-view-editor.create-new" onClick={handleCreateNew}>
                <PlusIcon />
                <span css={{ marginLeft: theme.spacing.xs }}>
                  <FormattedMessage defaultMessage="Create new view" description="Menu option to create new view" />
                </span>
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Root>
          {working?.id && (
            <Button componentId="trace-view-editor.delete" danger icon={<TrashIcon />} onClick={handleDelete}>
              <FormattedMessage defaultMessage="Delete" description="Delete saved view" />
            </Button>
          )}
        </div>

        {/* Edit UI */}
        <div css={{ display: 'grid', gridTemplateColumns: '1fr', gap: theme.spacing.md }}>
          <div>
            <FormUI.Label>
              <FormattedMessage defaultMessage="Name" description="Saved view name label" />
            </FormUI.Label>
            <Input
              componentId="trace-view-editor.name"
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
              componentId="trace-view-editor.description"
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
              <FormattedMessage defaultMessage="Span types" description="Span types label" />
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
                <FieldKeysByTargetEditor
                  componentPrefix={`trace-view-editor.${spanType}`}
                  fields={fields}
                  onChange={(next: any) =>
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
            );
          })}
        </div>

        <div>
            <FormUI.Label>
              <FormattedMessage defaultMessage="Other options" description="Other options label" />
            </FormUI.Label>
            <div css={{ display: 'flex', gap: theme.spacing.lg }}>
              <Checkbox
                componentId={`trace-view-editor.toggle-show-parents_${!working?.definition.spans.show_parents}`}
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
                componentId={`trace-view-editor.toggle-show-exceptions_${!working?.definition.spans.show_exceptions}`}
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
                componentId={`trace-view-editor.toggle-show-root_${!working?.definition.spans.show_root_span}`}
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
      </div>
    </div>
  );
};

// Unified field-keys editor: renders rows of [target dropdown][key input][trash],
// backed by the SavedTraceView schema fields object for a given span type.
const FieldKeysByTargetEditor = ({
  fields,
  onChange,
  componentPrefix,
}: {
  fields: { inputs?: { keys?: string[] }; outputs?: { keys?: string[] }; attributes?: { keys?: string[] } };
  onChange: (next: { inputs?: { keys?: string[] }; outputs?: { keys?: string[] }; attributes?: { keys?: string[] } }) => void;
  componentPrefix: string;
}) => {
  const { theme } = useDesignSystemTheme();

  type Kind = 'inputs' | 'outputs' | 'attributes';

  const items = [
    ...(fields.inputs?.keys ?? []).map((k) => ({ kind: 'inputs' as Kind, key: k })),
    ...(fields.outputs?.keys ?? []).map((k) => ({ kind: 'outputs' as Kind, key: k })),
    ...(fields.attributes?.keys ?? []).map((k) => ({ kind: 'attributes' as Kind, key: k })),
  ];

  const applyItems = (list: { kind: Kind; key: string }[]) => {
    const next = {
      inputs: list.filter((i) => i.kind === 'inputs').map((i) => i.key),
      outputs: list.filter((i) => i.kind === 'outputs').map((i) => i.key),
      attributes: list.filter((i) => i.kind === 'attributes').map((i) => i.key),
    };
    onChange({
      inputs: next.inputs.length ? { keys: next.inputs } : undefined,
      outputs: next.outputs.length ? { keys: next.outputs } : undefined,
      attributes: next.attributes.length ? { keys: next.attributes } : undefined,
    });
  };

  const handleChangeKind = (index: number, newKind: Kind) => {
    const next = items.map((it, i) => (i === index ? { ...it, kind: newKind } : it));
    applyItems(next);
  };
  const handleChangeKey = (index: number, newKey: string) => {
    const next = items.map((it, i) => (i === index ? { ...it, key: newKey } : it));
    applyItems(next);
  };
  const handleRemove = (index: number) => {
    const next = items.filter((_, i) => i !== index);
    applyItems(next);
  };
  const handleAdd = () => {
    applyItems([...items, { kind: 'inputs', key: '' }]);
  };

  return (
    <div css={{ display: 'flex', flexDirection: 'column', gap: theme.spacing.xs, marginTop: theme.spacing.sm }}>
      {items.map((item, idx) => (
        <div key={idx} css={{ display: 'grid', gridTemplateColumns: '100px 1fr auto', gap: theme.spacing.xs }}>
          <SimpleSelect
            id={`${componentPrefix}.row-${idx}.kind`}
            componentId={`${componentPrefix}.row-${idx}.kind`}
            value={item.kind}
            onChange={(e) => handleChangeKind(idx, e.target.value as Kind)}
            css={{ width: 100 }}
          >
            <SimpleSelectOption value="inputs">Inputs</SimpleSelectOption>
            <SimpleSelectOption value="outputs">Outputs</SimpleSelectOption>
            <SimpleSelectOption value="attributes">Attributes</SimpleSelectOption>
          </SimpleSelect>
          <Input
            componentId={`${componentPrefix}.row-${idx}.key`}
            value={item.key}
            placeholder="Key (e.g. messages.0.content)"
            onChange={(e) => handleChangeKey(idx, e.target.value)}
          />
          <Button componentId={`${componentPrefix}.row-${idx}.delete`} icon={<TrashIcon />} onClick={() => handleRemove(idx)} />
        </div>
      ))}
      <div>
        <Button componentId={`${componentPrefix}.add`} icon={<PlusIcon />} onClick={handleAdd}>
          <FormattedMessage defaultMessage="Add" description="Add new key to list" />
        </Button>
      </div>
    </div>
  );
};

export default SavedTraceViewPanel;
