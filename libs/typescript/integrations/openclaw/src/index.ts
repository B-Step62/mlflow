/**
 * MLflow Tracing Plugin for OpenClaw
 *
 * This plugin subscribes to OpenClaw agent lifecycle events and creates MLflow
 * traces in real-time as events fire. It maps OpenClaw's granular events
 * (llm_input, llm_output, tool_start, tool_end, subagent_spawning,
 * subagent_ended, model.usage, agent_end) to a span hierarchy:
 *   root AGENT → child LLM / TOOL / sub-AGENT spans
 *
 * Usage:
 *   1. Install: npm install @mlflow/openclaw @mlflow/core
 *   2. Add to OpenClaw config:
 *      import { MLflowTracingPlugin } from '@mlflow/openclaw';
 *      export default { plugins: [MLflowTracingPlugin] };
 *   3. Set environment variables:
 *      export MLFLOW_TRACKING_URI=http://localhost:5000
 *      export MLFLOW_EXPERIMENT_ID=123
 *   4. Run OpenClaw normally — tracing happens automatically.
 */

import type { Plugin, PluginContext, OpenClawEvent } from 'openclaw/plugin';
import {
  init,
  startSpan,
  flushTraces,
  SpanType,
  SpanAttributeKey,
  TraceMetadataKey,
  InMemoryTraceManager,
} from '@mlflow/core';

// Silent plugin — no console output to avoid TUI interference.
const DEBUG = process.env.MLFLOW_OPENCLAW_DEBUG === 'true';

const NANOSECONDS_PER_MS = 1e6;
const MAX_PREVIEW_LENGTH = 1000;
const MAX_ACTIVE_TRACES = 50;

// SDK initialization state
let initialized = false;

type SpanLike = ReturnType<typeof startSpan>;

interface PendingChild {
  span: SpanLike;
  name: string;
}

interface ActiveTrace {
  rootSpan: SpanLike;
  pendingLlm: PendingChild | null;
  pendingTools: Map<string, PendingChild>;
  pendingSubagents: Map<string, PendingChild>;
  tokenUsage: { inputTokens: number; outputTokens: number; totalTokens: number; cost: number };
  firstPrompt: string;
  lastResponse: string;
  lastActivityMs: number;
}

/**
 * Initialize the MLflow tracing SDK if not already initialized.
 */
function ensureInitialized(): boolean {
  if (initialized) {
    return true;
  }

  const trackingUri = process.env.MLFLOW_TRACKING_URI;
  const experimentId = process.env.MLFLOW_EXPERIMENT_ID;

  if (!trackingUri) {
    if (DEBUG) {
      console.error('[mlflow-openclaw] MLFLOW_TRACKING_URI not set, skipping initialization');
    }
    return false;
  }

  if (!experimentId) {
    if (DEBUG) {
      console.error('[mlflow-openclaw] MLFLOW_EXPERIMENT_ID not set, skipping initialization');
    }
    return false;
  }

  try {
    init({ trackingUri, experimentId });
    initialized = true;
    if (DEBUG) {
      console.error('[mlflow-openclaw] SDK initialized successfully');
    }
    return true;
  } catch (error) {
    if (DEBUG) {
      console.error('[mlflow-openclaw] Failed to initialize SDK:', error);
    }
    return false;
  }
}

function timestampToNs(timestamp: number | undefined): number | undefined {
  return timestamp != null ? Math.floor(timestamp * NANOSECONDS_PER_MS) : undefined;
}

/**
 * Evict oldest entries from a Map to stay within a size limit (LRU via insertion order).
 */
function evictOldest<K, V>(map: Map<K, V>, maxSize: number): void {
  while (map.size > maxSize) {
    const oldest = map.keys().next().value;
    if (oldest !== undefined) {
      map.delete(oldest);
    }
  }
}

/**
 * Generate a unique key for a tool span within a session.
 */
function toolKey(toolName: string, toolCallId?: string): string {
  return toolCallId ? `${toolName}:${toolCallId}` : toolName;
}

/**
 * Finalize and flush a trace: end root span, set metadata, flush to MLflow.
 */
async function finalizeTrace(
  sessionKey: string,
  trace: ActiveTrace,
  userId?: string,
): Promise<void> {
  // End any still-pending LLM span
  if (trace.pendingLlm) {
    trace.pendingLlm.span.end();
    trace.pendingLlm = null;
  }

  // End any still-pending tool spans
  for (const [, pending] of trace.pendingTools) {
    pending.span.end();
  }
  trace.pendingTools.clear();

  // End any still-pending subagent spans
  for (const [, pending] of trace.pendingSubagents) {
    pending.span.end();
  }
  trace.pendingSubagents.clear();

  // Set trace-level token usage
  if (trace.tokenUsage.totalTokens > 0) {
    trace.rootSpan.setAttribute(SpanAttributeKey.TOKEN_USAGE, {
      input_tokens: trace.tokenUsage.inputTokens,
      output_tokens: trace.tokenUsage.outputTokens,
      total_tokens: trace.tokenUsage.totalTokens,
    });
  }

  // Set outputs and end root span
  trace.rootSpan.setOutputs({
    response: trace.lastResponse || 'Agent completed',
  });
  trace.rootSpan.end();

  // Set trace metadata
  try {
    const traceManager = InMemoryTraceManager.getInstance();
    const traceData = traceManager.getTrace(trace.rootSpan.traceId);
    if (traceData) {
      traceData.info.requestPreview = trace.firstPrompt.slice(0, MAX_PREVIEW_LENGTH);
      if (trace.lastResponse) {
        traceData.info.responsePreview = trace.lastResponse.slice(0, MAX_PREVIEW_LENGTH);
      }
      traceData.info.traceMetadata = {
        ...traceData.info.traceMetadata,
        [TraceMetadataKey.TRACE_SESSION]: sessionKey,
        [TraceMetadataKey.TRACE_USER]: userId || process.env.USER || '',
      };
    }
  } catch (error) {
    if (DEBUG) {
      console.error('[mlflow-openclaw] Failed to set trace metadata:', error);
    }
  }

  await flushTraces();

  if (DEBUG) {
    console.error(`[mlflow-openclaw] Flushed trace: ${trace.rootSpan.traceId}`);
  }
}

/**
 * MLflow tracing plugin for OpenClaw.
 * Subscribes to agent lifecycle events and creates MLflow traces in real-time.
 */
export const MLflowTracingPlugin: Plugin = (context: PluginContext): void => {
  const activeTraces = new Map<string, ActiveTrace>();

  function getOrCreateTrace(sessionKey: string, prompt: string, timestampMs?: number): ActiveTrace {
    const existing = activeTraces.get(sessionKey);
    if (existing) {
      // LRU: move to end
      activeTraces.delete(sessionKey);
      activeTraces.set(sessionKey, existing);
      existing.lastActivityMs = Date.now();
      return existing;
    }

    const rootSpan = startSpan({
      name: 'openclaw_agent',
      inputs: { prompt },
      spanType: SpanType.AGENT,
      startTimeNs: timestampToNs(timestampMs),
    });

    const trace: ActiveTrace = {
      rootSpan,
      pendingLlm: null,
      pendingTools: new Map(),
      pendingSubagents: new Map(),
      tokenUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, cost: 0 },
      firstPrompt: prompt,
      lastResponse: '',
      lastActivityMs: Date.now(),
    };

    activeTraces.set(sessionKey, trace);
    evictOldest(activeTraces, MAX_ACTIVE_TRACES);

    return trace;
  }

  context.registerService('mlflow-tracing', {
    onEvent: async (event: OpenClawEvent): Promise<void> => {
      if (!ensureInitialized()) {
        return;
      }

      try {
        switch (event.type) {
          case 'llm_input': {
            const trace = getOrCreateTrace(event.sessionKey, event.prompt, event.timestamp);
            // End previous pending LLM span if any (e.g. multi-turn)
            if (trace.pendingLlm) {
              trace.pendingLlm.span.end();
            }
            const modelLabel =
              event.provider && event.model
                ? `${event.provider}/${event.model}`
                : event.model || 'unknown';
            const llmSpan = startSpan({
              name: 'llm_call',
              parent: trace.rootSpan,
              spanType: SpanType.LLM,
              startTimeNs: timestampToNs(event.timestamp),
              inputs: {
                model: modelLabel,
                prompt: event.prompt,
                ...(event.systemPrompt ? { system_prompt: event.systemPrompt } : {}),
              },
              attributes: {
                ...(event.model ? { model: event.model } : {}),
                ...(event.provider ? { provider: event.provider } : {}),
              },
            });
            trace.pendingLlm = { span: llmSpan, name: 'llm_call' };
            break;
          }

          case 'llm_output': {
            const trace = activeTraces.get(event.sessionKey);
            if (!trace) break;
            trace.lastActivityMs = Date.now();
            trace.lastResponse = event.response || '';
            if (trace.pendingLlm) {
              trace.pendingLlm.span.setOutputs({
                choices: [{ message: { role: 'assistant', content: event.response || '' } }],
              });
              trace.pendingLlm.span.end({ endTimeNs: timestampToNs(event.timestamp) });
              trace.pendingLlm = null;
            }
            break;
          }

          case 'tool_start': {
            const trace = activeTraces.get(event.sessionKey);
            if (!trace) break;
            trace.lastActivityMs = Date.now();
            const key = toolKey(event.toolName, event.toolCallId);
            const toolSpan = startSpan({
              name: `tool_${event.toolName}`,
              parent: trace.rootSpan,
              spanType: SpanType.TOOL,
              startTimeNs: timestampToNs(event.timestamp),
              inputs: event.arguments || {},
              attributes: {
                tool_name: event.toolName,
                ...(event.toolCallId ? { tool_id: event.toolCallId } : {}),
              },
            });
            trace.pendingTools.set(key, { span: toolSpan, name: event.toolName });
            break;
          }

          case 'tool_end': {
            const trace = activeTraces.get(event.sessionKey);
            if (!trace) break;
            trace.lastActivityMs = Date.now();
            const key = toolKey(event.toolName, event.toolCallId);
            const pending = trace.pendingTools.get(key);
            if (pending) {
              if (event.error) {
                pending.span.setOutputs({ error: event.error });
              } else {
                pending.span.setOutputs({ result: event.result || '' });
              }
              pending.span.end({ endTimeNs: timestampToNs(event.timestamp) });
              trace.pendingTools.delete(key);
            }
            break;
          }

          case 'subagent_spawning': {
            const trace = activeTraces.get(event.sessionKey);
            if (!trace) break;
            trace.lastActivityMs = Date.now();
            const subSpan = startSpan({
              name: `subagent_${event.label || event.agentId}`,
              parent: trace.rootSpan,
              spanType: SpanType.AGENT,
              startTimeNs: timestampToNs(event.timestamp),
              inputs: { agent_id: event.agentId, ...(event.label ? { label: event.label } : {}) },
            });
            trace.pendingSubagents.set(event.agentId, { span: subSpan, name: event.agentId });
            break;
          }

          case 'subagent_ended': {
            const trace = activeTraces.get(event.sessionKey);
            if (!trace) break;
            trace.lastActivityMs = Date.now();
            const pending = trace.pendingSubagents.get(event.agentId);
            if (pending) {
              if (event.error) {
                pending.span.setOutputs({ error: event.error });
              } else {
                pending.span.setOutputs({ result: event.result || '' });
              }
              pending.span.end({ endTimeNs: timestampToNs(event.timestamp) });
              trace.pendingSubagents.delete(event.agentId);
            }
            break;
          }

          case 'model.usage': {
            const trace = activeTraces.get(event.sessionKey);
            if (!trace) break;
            trace.lastActivityMs = Date.now();
            trace.tokenUsage.inputTokens += event.inputTokens || 0;
            trace.tokenUsage.outputTokens += event.outputTokens || 0;
            trace.tokenUsage.totalTokens += event.totalTokens || 0;
            trace.tokenUsage.cost += event.cost || 0;
            break;
          }

          case 'agent_end': {
            const trace = activeTraces.get(event.sessionKey);
            if (!trace) break;
            // Use queueMicrotask to allow any remaining llm_output events to fire first
            const sessionKey = event.sessionKey;
            const userId = event.userId;
            queueMicrotask(async () => {
              try {
                const t = activeTraces.get(sessionKey);
                if (t) {
                  activeTraces.delete(sessionKey);
                  await finalizeTrace(sessionKey, t, userId);
                }
              } catch (error) {
                if (DEBUG) {
                  console.error('[mlflow-openclaw] Error finalizing trace:', error);
                }
              }
            });
            break;
          }
        }
      } catch (error) {
        if (DEBUG) {
          console.error('[mlflow-openclaw] Error handling event:', event.type, error);
        }
      }
    },
  });
};

export default MLflowTracingPlugin;
