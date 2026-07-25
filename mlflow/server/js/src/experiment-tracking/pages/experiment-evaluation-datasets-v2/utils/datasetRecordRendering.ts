import yaml from 'js-yaml';
import { isEqual } from 'lodash';
import { normalizeConversation } from '../../../../shared/web-shared/model-trace-explorer/ModelTraceExplorer.utils';
import type { ModelTraceChatMessage } from '../../../../shared/web-shared/model-trace-explorer/ModelTrace.types';

export type RecordEditorFormat = 'json' | 'yaml';

const PREVIEW_STRING_KEYS = [
  'question',
  'query',
  'prompt',
  'input',
  'message',
  'content',
  'text',
  'answer',
  'response',
  'output',
  'expected_response',
  'expected',
  'expectation',
] as const;

export const stringifyRecordObject = (
  value: Record<string, unknown> | undefined,
  format: RecordEditorFormat = 'json',
): string => {
  if (value === undefined) return '';
  if (format === 'yaml') {
    return yaml.safeDump(value, { noRefs: true, sortKeys: false });
  }
  return JSON.stringify(value, null, 2);
};

export interface ParseRecordObjectResult {
  value: Record<string, unknown> | undefined;
  error: string | undefined;
}

export const parseRecordObject = (text: string, format: RecordEditorFormat = 'json'): ParseRecordObjectResult => {
  if (text.trim() === '') return { value: {}, error: undefined };
  try {
    const value = format === 'yaml' ? yaml.safeLoad(text) : JSON.parse(text);
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return { value: value as Record<string, unknown>, error: undefined };
    }
    return { value: undefined, error: `${format.toUpperCase()} must be an object (not an array or primitive)` };
  } catch (e) {
    return { value: undefined, error: e instanceof Error ? e.message : `Invalid ${format.toUpperCase()}` };
  }
};

export const areRecordObjectsEqual = (
  left: Record<string, unknown> | undefined,
  right: Record<string, unknown> | undefined,
) => isEqual(left ?? {}, right ?? {});

export const getChatMessagesFromRecordValue = (value: unknown): ModelTraceChatMessage[] | null => {
  const messages = normalizeConversation(value);
  if (messages) return messages;
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const objectValue = value as Record<string, unknown>;
    for (const key of ['messages', 'conversation', 'chat', 'history']) {
      const nestedMessages = normalizeConversation(objectValue[key]);
      if (nestedMessages) return nestedMessages;
    }
  }
  return null;
};

const normalizePreviewString = (value: string): string => value.replace(/\s+/g, ' ').trim();

const primitiveToPreview = (value: unknown): string | undefined => {
  if (typeof value === 'string') return normalizePreviewString(value);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return undefined;
};

const getPreviewFromChatMessages = (messages: ModelTraceChatMessage[]): string | undefined => {
  const preferredMessage =
    [...messages]
      .reverse()
      .find((message) => message.role === 'user' && normalizePreviewString(message.content ?? '')) ??
    [...messages].reverse().find((message) => normalizePreviewString(message.content ?? ''));
  return preferredMessage ? normalizePreviewString(preferredMessage.content ?? '') : undefined;
};

export const getDatasetRecordValuePreview = (value: unknown): string | undefined => {
  const primitivePreview = primitiveToPreview(value);
  if (primitivePreview) return primitivePreview;

  const chatPreview = getPreviewFromChatMessages(getChatMessagesFromRecordValue(value) ?? []);
  if (chatPreview) return chatPreview;

  if (Array.isArray(value)) {
    const firstPrimitive = value.map(primitiveToPreview).find(Boolean);
    if (firstPrimitive) return firstPrimitive;
  }

  if (value && typeof value === 'object') {
    const objectValue = value as Record<string, unknown>;
    for (const key of PREVIEW_STRING_KEYS) {
      const preview = primitiveToPreview(objectValue[key]);
      if (preview) return preview;
    }
    const entries = Object.entries(objectValue);
    if (entries.length === 1) {
      const [, singleValue] = entries[0];
      const preview = primitiveToPreview(singleValue);
      if (preview) return preview;
    }
  }

  try {
    const compact = JSON.stringify(value);
    return compact ? normalizePreviewString(compact) : undefined;
  } catch {
    return String(value);
  }
};
