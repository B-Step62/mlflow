import { LiveSpan, registerOnSpanStartHook, SpanAttributeKey, SpanType } from 'mlflow-tracing';

const VERCEL_OPERATION_ID_ATTRIBUTE = 'ai.operationId';
const VERCEL_PROMPT_ATTRIBUTE = 'ai.prompt';
const VERCEL_PROMPT_MESSAGES_ATTRIBUTE = 'ai.prompt.messages';
const VERCEL_MESSAGE_FORMAT = 'vercel_ai';

export function vercelOnSpanStartHook(span: LiveSpan) {
  if (!isVercelAISpan(span)) {
    return undefined;
  }

  const inputs = extractInputs(span);

  span.setSpanType(SpanType.LLM);
  span.setAttribute(SpanAttributeKey.MESSAGE_FORMAT, VERCEL_MESSAGE_FORMAT);
  if (inputs) {
    span.setInputs(inputs);
  }
}

function isVercelAISpan(span: LiveSpan): boolean {
  return (
    Boolean(span.attributes) &&
    Object.prototype.hasOwnProperty.call(span.attributes, VERCEL_OPERATION_ID_ATTRIBUTE)
  );
}

function extractInputs(span: LiveSpan): Record<string, unknown> | undefined {
  if (!span.attributes) {
    return undefined;
  }

  if (Object.prototype.hasOwnProperty.call(span.attributes, VERCEL_PROMPT_MESSAGES_ATTRIBUTE)) {
    return { messages: span.attributes[VERCEL_PROMPT_MESSAGES_ATTRIBUTE] };
  }

  if (Object.prototype.hasOwnProperty.call(span.attributes, VERCEL_PROMPT_ATTRIBUTE)) {
    return { prompt: span.attributes[VERCEL_PROMPT_ATTRIBUTE] };
  }

  return undefined;
}

registerOnSpanStartHook(vercelOnSpanStartHook);
