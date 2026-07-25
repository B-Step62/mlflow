import { useEffect, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Button, CloseIcon, Typography, useDesignSystemTheme } from '@databricks/design-system';
import { FormattedMessage, useIntl } from 'react-intl';
import type { DatasetRecord } from '../hooks/useDatasetsQueries';
import { DatasetRecordDetailFooter } from './DatasetRecordDetailFooter';
import { DatasetRecordCollapsibleSection } from './DatasetRecordCollapsibleSection';
import { DatasetRecordDetailHeader } from './DatasetRecordDetailHeader';
import { TagsCell } from './TagsCell';
import { DraftTagsField } from './DraftTagsField';
import { useRecordSaveState } from '../hooks/useRecordSaveState';
import { useRecordCreateState, type PendingNewRecord } from '../hooks/useRecordCreateState';
import {
  DatasetRecordFieldRenderer,
  DatasetRecordFieldRenderModeSelector,
  type DatasetRecordFieldRenderMode,
} from './DatasetRecordFieldRenderer';
import type { RecordEditorFormat } from '../utils/datasetRecordRendering';
// Tiny intl-based date formatter; replaces @databricks/web-shared/date-time which OSS lacks.
const formatDateTime = (
  input: string | undefined,
  intl: { formatDate: (d: Date, opts?: Intl.DateTimeFormatOptions) => string },
) => {
  if (!input) return '';
  return intl.formatDate(new Date(input), {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

type SidePanelMode = 'edit' | 'create';

/**
 * Renders the metadata Source row value for a given record source. Trace-sourced records
 * render the trace_id as a Typography.Link that opens the trace explorer via the parent's
 * `onOpenTraceModal` callback; human and document sources render as inline text.
 */
const renderSourceValue = (
  source: DatasetRecord['source'],
  onOpenTraceModal: ((traceId: string) => void) | undefined,
) => {
  if (source?.trace) {
    const traceId = source.trace.trace_id;
    return (
      <>
        Trace (
        <Typography.Link
          componentId="mlflow.eval-datasets-v2.side-panel.source-trace-link"
          onClick={() => onOpenTraceModal?.(traceId)}
        >
          {traceId}
        </Typography.Link>
        )
      </>
    );
  }
  if (source?.human) {
    return `Human (${source.human.user_name})`;
  }
  if (source?.document) {
    return `Document (${source.document.doc_uri})`;
  }
  return '-';
};

interface DatasetRecordSidePanelProps {
  mode: SidePanelMode;
  datasetId: string;
  /** Required when mode === 'edit'; ignored in create mode. */
  record: DatasetRecord | undefined;
  /** Full record set for the dataset — gates save against mixed singleturn/multiturn schemas. */
  existingRecords: DatasetRecord[];
  open: boolean;
  onClose: () => void;
  /** Toast helper — fired after a successful save. */
  onSaveSuccess?: () => void;
  /** Receives `unknown` so the same handler covers save errors (always Error-shaped
   * after the hooks' wrapping) and inline tag-edit errors (the upsert mutation surfaces
   * the raw rejection). */
  onSaveError?: (error: unknown) => void;
  /**
   * Create-mode only: fires on every editor change so the parent can update the fake-row
   * preview rendered at the top of the records table.
   */
  onPendingChange?: (next: PendingNewRecord) => void;
  /**
   * Notifies the parent whenever the panel's dirty/guard state flips. The page consolidates
   * dirty state across record-switch, mode-switch, close, and in-app navigation so a single
   * "discard unsaved changes?" modal can gate all four transitions consistently.
   */
  onDirtyChange?: (isDirty: boolean) => void;
  /**
   * Edit-mode only: opens the trace explorer modal for a trace-sourced record. The parent
   * owns the modal so it can overlay the entire dataset page (and so the side panel doesn't
   * need to know about SQL warehouse / labeling-schemas plumbing the modal requires).
   */
  onOpenTraceModal?: (traceId: string) => void;
  onNavigateRecord?: (direction: -1 | 1) => void;
  canNavigatePreviousRecord?: boolean;
  canNavigateNextRecord?: boolean;
}

const isEditableKeyboardTarget = (target: EventTarget | null) => {
  if (!(target instanceof HTMLElement)) return false;
  const tagName = target.tagName.toLowerCase();
  return (
    target.isContentEditable ||
    tagName === 'input' ||
    tagName === 'textarea' ||
    tagName === 'select' ||
    target.getAttribute('role') === 'textbox' ||
    Boolean(target.closest('.monaco-editor'))
  );
};

/**
 * Inline side panel for editing an existing dataset record OR composing a new one. Replaces
 * the prior overlay drawer + AddRecordModal pair so the page no longer has two competing
 * surfaces for record interaction — and so a partially-typed new record can preview live
 * in the table as a synthetic row alongside saved records.
 */
export const DatasetRecordSidePanel = ({
  mode,
  datasetId,
  record,
  existingRecords,
  open,
  onClose,
  onSaveSuccess,
  onSaveError,
  onPendingChange,
  onDirtyChange,
  onOpenTraceModal,
  onNavigateRecord,
  canNavigatePreviousRecord = false,
  canNavigateNextRecord = false,
}: DatasetRecordSidePanelProps) => {
  const { theme } = useDesignSystemTheme();
  const intl = useIntl();

  const editFallback = intl.formatMessage({
    defaultMessage: 'Failed to save record',
    description: 'Generic fallback save-error text for the dataset record side panel (edit mode)',
  });
  const createFallback = intl.formatMessage({
    defaultMessage: 'Failed to create record',
    description: 'Generic fallback save-error text for the dataset record side panel (create mode)',
  });

  const [inputsRenderMode, setInputsRenderMode] = useState<DatasetRecordFieldRenderMode>(() =>
    mode === 'create' ? 'json' : 'chat',
  );
  const [expectationsRenderMode, setExpectationsRenderMode] = useState<DatasetRecordFieldRenderMode>(() =>
    mode === 'create' ? 'json' : 'chat',
  );
  const [inputsEditorFormat, setInputsEditorFormat] = useState<RecordEditorFormat>('json');
  const [expectationsEditorFormat, setExpectationsEditorFormat] = useState<RecordEditorFormat>('json');

  // Both hooks are called unconditionally to satisfy the rules of hooks. The unused one
  // sits in `clean` status with no in-flight mutation, so the cost is a couple of memo'd
  // values and the editor state for two un-rendered fields — cheap and trivially correct.
  const editState = useRecordSaveState({
    datasetId,
    record,
    fallbackErrorMessage: editFallback,
    existingRecords,
    onSaveSuccess: mode === 'edit' ? onSaveSuccess : undefined,
    onSaveError: mode === 'edit' ? onSaveError : undefined,
    inputsFormat: inputsEditorFormat,
    expectationsFormat: expectationsEditorFormat,
  });
  const createState = useRecordCreateState({
    datasetId,
    fallbackErrorMessage: createFallback,
    existingRecords,
    onSaveSuccess: mode === 'create' ? onSaveSuccess : undefined,
    onSaveError: mode === 'create' ? onSaveError : undefined,
    onPendingChange: mode === 'create' ? onPendingChange : undefined,
    inputsFormat: inputsEditorFormat,
    expectationsFormat: expectationsEditorFormat,
  });

  const active = mode === 'edit' ? editState : createState;
  // Pull these out explicitly so the JSX below can stay narrative — the wide union type of
  // `active` doesn't expose `tags`/`setTags`, which are only on the create-state branch.
  const draftTags = createState.tags;
  const setDraftTags = createState.setTags;
  // `isDirty` distinguishes "user actually edited" from "panel just opened with seeded
  // defaults", so closing a seeded-but-unedited create panel does not prompt.
  const shouldGuard = active.isDirty;

  // Surface dirty state up to the page so it can serialize close, record-switch, and
  // in-app navigation through a single confirmation modal.
  useEffect(() => {
    onDirtyChange?.(open && shouldGuard);
  }, [open, shouldGuard, onDirtyChange]);

  // Native browser prompt for tab-close / reload while dirty. The page-level router
  // blocker handles in-app navigation; this covers `beforeunload`, which the router
  // blocker doesn't see.
  useEffect(() => {
    if (!open || !shouldGuard) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      // Modern browsers ignore the string and show a generic prompt, but setting
      // `returnValue` is required to actually trigger the dialog.
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [open, shouldGuard]);

  // Esc anywhere on the page closes the panel. Document-level (vs `<aside>` onKeyDown)
  // because Monaco swallows keydown events before they bubble to ancestor handlers
  // (see the matching note for Cmd+S in `JsonRecordEditor`), and an aside handler would
  // miss editor-focused presses. `defaultPrevented` defers to anything that legitimately
  // wanted Esc first — Monaco's suggest/find widgets, an open DangerModal, the bulk-delete
  // or trace modals. `onClose` routes through `useGuardedTransition`, so the discard
  // prompt appears when dirty.
  useEffect(() => {
    if (!open) return undefined;
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) {
        onClose();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  const closeLabel = intl.formatMessage({
    defaultMessage: 'Close',
    description: 'Aria label for the close button on the V2 dataset record side panel',
  });
  const editPanelLabel = intl.formatMessage({
    defaultMessage: 'Dataset record details',
    description: 'Aria label for the dataset record edit side panel',
  });
  const createPanelLabel = intl.formatMessage({
    defaultMessage: 'New dataset record',
    description: 'Aria label for the dataset record create side panel',
  });

  if (!open) return null;

  const showRecordDetail = mode === 'edit' && record !== undefined;

  const handleBodyKeyDown = (event: KeyboardEvent) => {
    active.onContainerKeyDown(event);
    if (event.defaultPrevented || mode !== 'edit' || !onNavigateRecord || isEditableKeyboardTarget(event.target)) {
      return;
    }
    if (event.key === 'ArrowUp' && canNavigatePreviousRecord) {
      event.preventDefault();
      onNavigateRecord(-1);
    }
    if (event.key === 'ArrowDown' && canNavigateNextRecord) {
      event.preventDefault();
      onNavigateRecord(1);
    }
  };

  const renderSectionTitle = (title: ReactNode, action?: ReactNode) => (
    <div
      css={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: theme.spacing.sm,
        width: '100%',
        minWidth: 0,
      }}
    >
      <span css={{ minWidth: 0 }}>{title}</span>
      {action && (
        <span
          css={{ flexShrink: 0 }}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
        >
          {action}
        </span>
      )}
    </div>
  );

  return (
    <aside
      aria-label={mode === 'edit' ? editPanelLabel : createPanelLabel}
      css={{
        // `flex: 1` makes the aside fill the parent's height so the body's `overflowY: auto`
        // actually scrolls when content is tall. Without it, the aside sizes to content,
        // pushing the footer below the viewport on long records.
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
        backgroundColor: theme.colors.backgroundPrimary,
      }}
    >
      {/*
          Outer wrapper owns the horizontal padding so the inner border-bottom
          sits inside the panel content area — matching the body's `lg`
          horizontal padding (the previous `paddingRight: md` on a single
          padded+bordered div made the divider span past the content). Same
          shape as the footer wrapper below.
        */}
      <div
        css={{
          paddingLeft: theme.spacing.lg,
          paddingRight: theme.spacing.lg,
          flexShrink: 0,
        }}
      >
        <div
          css={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: theme.spacing.sm,
            paddingTop: 0,
            paddingBottom: theme.spacing.md,
            borderBottom: `1px solid ${theme.colors.border}`,
          }}
        >
          {showRecordDetail && record ? (
            <DatasetRecordDetailHeader recordId={record.dataset_record_id} />
          ) : mode === 'create' ? (
            <Typography.Text bold>
              <FormattedMessage
                defaultMessage="New record"
                description="Heading at the top of the V2 dataset record side panel when composing a new record"
              />
            </Typography.Text>
          ) : (
            // Keeps the close button right-aligned while the record query resolves.
            <span />
          )}
          <Button
            componentId="mlflow.eval-datasets-v2.side-panel.close"
            icon={<CloseIcon />}
            aria-label={closeLabel}
            onClick={onClose}
          />
        </div>
      </div>
      <div
        onKeyDown={handleBodyKeyDown}
        css={{
          flex: 1,
          overflowY: 'auto',
          paddingLeft: theme.spacing.lg,
          paddingRight: theme.spacing.lg,
          paddingTop: theme.spacing.md,
        }}
      >
        <DatasetRecordCollapsibleSection
          title={renderSectionTitle(
            <FormattedMessage
              defaultMessage="Inputs"
              description="Section title for inputs in the V2 dataset record side panel"
            />,
            <DatasetRecordFieldRenderModeSelector
              fieldKey="inputs"
              value={active.inputs}
              renderMode={inputsRenderMode}
              onRenderModeChange={setInputsRenderMode}
              editorFormat={inputsEditorFormat}
              onEditorFormatChange={setInputsEditorFormat}
            />,
          )}
        >
          <DatasetRecordFieldRenderer
            fieldKey="inputs"
            value={active.inputs}
            renderMode={inputsRenderMode}
            editorFormat={inputsEditorFormat}
            ariaLabel={intl.formatMessage({
              defaultMessage: 'Dataset record inputs',
              description: 'Aria label for the dataset record inputs editor',
            })}
            onSaveShortcut={active.save}
            onNavigateRecord={mode === 'edit' ? onNavigateRecord : undefined}
            canNavigatePreviousRecord={canNavigatePreviousRecord}
            canNavigateNextRecord={canNavigateNextRecord}
          />
        </DatasetRecordCollapsibleSection>

        <DatasetRecordCollapsibleSection
          title={renderSectionTitle(
            <FormattedMessage
              defaultMessage="Expectations"
              description="Section title for expectations in the V2 dataset record side panel"
            />,
            <DatasetRecordFieldRenderModeSelector
              fieldKey="expectations"
              value={active.expectations}
              renderMode={expectationsRenderMode}
              onRenderModeChange={setExpectationsRenderMode}
              editorFormat={expectationsEditorFormat}
              onEditorFormatChange={setExpectationsEditorFormat}
            />,
          )}
        >
          <DatasetRecordFieldRenderer
            fieldKey="expectations"
            value={active.expectations}
            renderMode={expectationsRenderMode}
            editorFormat={expectationsEditorFormat}
            ariaLabel={intl.formatMessage({
              defaultMessage: 'Dataset record expectations',
              description: 'Aria label for the dataset record expectations editor',
            })}
            onSaveShortcut={active.save}
            onNavigateRecord={mode === 'edit' ? onNavigateRecord : undefined}
            canNavigatePreviousRecord={canNavigatePreviousRecord}
            canNavigateNextRecord={canNavigateNextRecord}
          />
        </DatasetRecordCollapsibleSection>

        <DatasetRecordCollapsibleSection
          title={
            <FormattedMessage
              defaultMessage="Tags"
              description="Section title for the editable tags section in the V2 dataset record side panel"
            />
          }
        >
          {mode === 'edit' ? (
            // Edit-mode tags persist immediately via upsert. The TagsCell only renders once
            // the saved record is in hand — until then the section is empty (matches the
            // edit-mode behavior elsewhere on this panel where the saved record drives
            // detail rendering).
            record ? (
              <TagsCell record={record} datasetId={datasetId} onSaveError={onSaveError} />
            ) : null
          ) : (
            <DraftTagsField tags={draftTags} onChange={setDraftTags} />
          )}
        </DatasetRecordCollapsibleSection>

        {showRecordDetail && record && (
          <DatasetRecordCollapsibleSection
            title={
              <FormattedMessage
                defaultMessage="Metadata"
                description="Section title for metadata in the V2 dataset record side panel"
              />
            }
          >
            <dl
              css={{
                display: 'grid',
                gridTemplateColumns: 'auto 1fr',
                gap: `${theme.spacing.xs}px ${theme.spacing.md}px`,
                margin: 0,
              }}
            >
              <Typography.Text color="secondary">
                <FormattedMessage
                  defaultMessage="Created"
                  description="Metadata label for the dataset record creation time"
                />
              </Typography.Text>
              <Typography.Text>{record.create_time ? formatDateTime(record.create_time, intl) : '-'}</Typography.Text>
              <Typography.Text color="secondary">
                <FormattedMessage
                  defaultMessage="Created by"
                  description="Metadata label for the dataset record author"
                />
              </Typography.Text>
              <Typography.Text>{record.created_by ?? '-'}</Typography.Text>
              <Typography.Text color="secondary">
                <FormattedMessage
                  defaultMessage="Last updated"
                  description="Metadata label for the dataset record last-update time"
                />
              </Typography.Text>
              <Typography.Text>
                {record.last_update_time ? formatDateTime(record.last_update_time, intl) : '-'}
              </Typography.Text>
              <Typography.Text color="secondary">
                <FormattedMessage
                  defaultMessage="Source"
                  description="Metadata label for the dataset record source (origin: trace, document, or human)"
                />
              </Typography.Text>
              <Typography.Text>{renderSourceValue(record.source, onOpenTraceModal)}</Typography.Text>
            </dl>
          </DatasetRecordCollapsibleSection>
        )}
      </div>
      <div
        css={{
          // No paddingBottom here: the outer wrappers (PageWrapper +
          // ExperimentPageTabs content wrapper) already contribute ~24px of
          // bottom space on the experiment page, so adding more here makes
          // the gap below Save read as visually empty.
          paddingLeft: theme.spacing.lg,
          paddingRight: theme.spacing.lg,
          flexShrink: 0,
        }}
      >
        <DatasetRecordDetailFooter
          status={active.status}
          errorMessage={active.errorMessage}
          onSave={active.save}
          onDiscard={active.discard}
          saveLabel={
            mode === 'create' ? (
              <FormattedMessage
                defaultMessage="Add record"
                description="Primary-button label on the dataset record side panel in create mode"
              />
            ) : undefined
          }
        />
      </div>
    </aside>
  );
};
