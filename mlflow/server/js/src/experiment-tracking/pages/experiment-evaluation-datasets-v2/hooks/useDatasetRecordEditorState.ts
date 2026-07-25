import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  areRecordObjectsEqual,
  parseRecordObject,
  stringifyRecordObject,
  type RecordEditorFormat,
} from '../utils/datasetRecordRendering';

interface UseDatasetRecordEditorStateParams {
  /**
   * Stable identifier for the source record. Editor state resets when this changes.
   * Pass `undefined` for "new record" flows — the editor then sticks to its initial value
   * for the lifetime of the mount.
   */
  recordId?: string;
  /** Source-of-truth dictionary. Read once per `recordId` change, ignored on refetch. */
  initialValue: Record<string, unknown> | undefined;
  /** Text format currently being edited. Read-only render modes keep the last editable format. */
  format?: RecordEditorFormat;
}

interface UseDatasetRecordEditorStateResult {
  /** Editor string the current editable mode displays (and mutates via onChange). */
  text: string;
  setText: (next: string) => void;
  /** Parsed value when the text is valid. Empty text parses to `{}`. */
  parsed: Record<string, unknown> | undefined;
  isDirty: boolean;
  isValid: boolean;
  /**
   * Raw parse error message (e.g. `"Unexpected token } in JSON at position 47"`) when the
   * text is invalid, otherwise `undefined`. Surfaced for diagnostics — UI surfaces typically
   * show a localized "Invalid JSON" string driven by `!isValid` instead.
   */
  parseError: string | undefined;
  /**
   * Reset both `text` and the dirty `baseline`. Pass `nextBaseline` to advance to an explicit
   * post-save value rather than re-reading `latestInitialTextRef` — needed for save-success
   * paths so the new baseline matches the text the user just submitted, independent of when
   * the upstream re-render flushes.
   */
  reset: (nextBaseline?: string) => void;
}

/**
 * Tracks local editor text for one record field (inputs, expectations). Surfaces parsed value when
 * valid, dirty flag for save-button enablement, and `reset` for the drawer's Discard button.
 *
 * The dirty comparison uses a `baseline` snapshot that only advances on `recordId` change or
 * explicit `reset()` — never on server-side refetch. That way a concurrent edit landing in the
 * cache cannot silently arm the Save button against an untouched draft and overwrite the new
 * server state on the next click.
 *
 * Empty text is treated as the empty object `{}` so emptying the editor commits an explicit
 * write rather than silently dropping the field.
 */
export const useDatasetRecordEditorState = ({
  recordId,
  initialValue,
  format = 'json',
}: UseDatasetRecordEditorStateParams): UseDatasetRecordEditorStateResult => {
  const initialObjectForCurrentRecord = useMemo(() => initialValue ?? {}, [initialValue]);
  const initialTextForCurrentRecord = useMemo(
    () => stringifyRecordObject(initialValue, format),
    [format, initialValue],
  );

  // Track the freshest initialValue without making it a reset/dirty trigger.
  const latestInitialTextRef = useRef(initialTextForCurrentRecord);
  const latestInitialObjectRef = useRef(initialObjectForCurrentRecord);
  useEffect(() => {
    latestInitialTextRef.current = initialTextForCurrentRecord;
    latestInitialObjectRef.current = initialObjectForCurrentRecord;
  }, [initialObjectForCurrentRecord, initialTextForCurrentRecord]);

  const [text, setText] = useState(initialTextForCurrentRecord);
  const [baseline, setBaseline] = useState(initialTextForCurrentRecord);
  const [baselineObject, setBaselineObject] = useState(initialObjectForCurrentRecord);

  // Reset only when the underlying record changes — not on every refetch.
  useEffect(() => {
    setText(latestInitialTextRef.current);
    setBaseline(latestInitialTextRef.current);
    setBaselineObject(latestInitialObjectRef.current);
  }, [recordId]);

  const { value: parsed, error: parseError } = useMemo(() => parseRecordObject(text, format), [format, text]);
  const isValid = parsed !== undefined;
  const isDirty = isValid ? !areRecordObjectsEqual(parsed, baselineObject) : text !== baseline;

  const reset = useCallback(
    (nextBaseline?: string) => {
      if (nextBaseline !== undefined) {
        const { value } = parseRecordObject(nextBaseline, format);
        setText(nextBaseline);
        setBaseline(nextBaseline);
        setBaselineObject(value ?? {});
        return;
      }
      const nextObject = latestInitialObjectRef.current;
      const nextText = latestInitialTextRef.current;
      setText(nextText);
      setBaseline(nextText);
      setBaselineObject(nextObject);
    },
    [format],
  );

  return { text, setText, parsed, isDirty, isValid, parseError, reset };
};
