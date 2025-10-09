import { Context } from '@opentelemetry/api';
import { Span as OTelSpan, ReadableSpan as OTelReadableSpan } from '@opentelemetry/sdk-trace-base';

type OnSpanStartHook = (span: OTelSpan, parentContext: Context) => void;
type OnSpanEndHook = (span: OTelReadableSpan) => void;

const onSpanStartHooks: Set<OnSpanStartHook> = new Set();
const onSpanEndHooks: Set<OnSpanEndHook> = new Set();

export function registerOnSpanStartHook(hook: OnSpanStartHook): void {
  onSpanStartHooks.add(hook);
}

export function unregisterOnSpanStartHook(hook: OnSpanStartHook): void {
  onSpanStartHooks.delete(hook);
}

export function clearOnSpanStartHooks(): void {
  onSpanStartHooks.clear();
}

export function getOnSpanStartHooks(): OnSpanStartHook[] {
  return Array.from(onSpanStartHooks);
}

export function registerOnSpanEndHook(hook: OnSpanEndHook): void {
  onSpanEndHooks.add(hook);
}

export function unregisterOnSpanEndHook(hook: OnSpanEndHook): void {
  onSpanEndHooks.delete(hook);
}

export function clearOnSpanEndHooks(): void {
  onSpanEndHooks.clear();
}

export function getOnSpanEndHooks(): OnSpanEndHook[] {
  return Array.from(onSpanEndHooks);
}
