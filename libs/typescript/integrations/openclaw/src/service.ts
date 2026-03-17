/**
 * MLflow Tracing service for OpenClaw.
 *
 * Creates an OpenClawPluginService that subscribes to agent lifecycle events
 * via api.on() and creates MLflow traces in real-time. Maps OpenClaw events
 * to a span hierarchy:  root AGENT → child LLM / TOOL / sub-AGENT spans.
 */

import type {
  OpenClawPluginApi,
  OpenClawPluginService,
  DiagnosticEventPayload,
} from "openclaw/plugin-sdk";
import { onDiagnosticEvent } from "openclaw/plugin-sdk";
import {
  init,
  startSpan,
  flushTraces,
  SpanType,
  SpanStatusCode,
  SpanAttributeKey,
  TraceMetadataKey,
  InMemoryTraceManager,
} from "@mlflow/core";

const MAX_PREVIEW_LENGTH = 1000;
const MAX_ACTIVE_TRACES = 50;

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
  tokenUsage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    cost: number;
  };
  firstPrompt: string;
  lastResponse: string;
  agentEndData: {
    success?: boolean;
    error?: string;
    durationMs?: number;
    messages?: unknown[];
  } | null;
  lastActivityMs: number;
}

function evictOldest<K, V>(map: Map<K, V>, maxSize: number): void {
  while (map.size > maxSize) {
    const oldest = map.keys().next().value;
    if (oldest !== undefined) {
      map.delete(oldest);
    }
  }
}

function toolKey(toolName: string, toolCallId?: string): string {
  return toolCallId ? `${toolName}:${toolCallId}` : toolName;
}

async function finalizeTrace(
  sessionKey: string,
  trace: ActiveTrace,
  userId?: string,
): Promise<void> {
  if (trace.pendingLlm) {
    trace.pendingLlm.span.end();
    trace.pendingLlm = null;
  }

  for (const [, pending] of trace.pendingTools) {
    pending.span.end();
  }
  trace.pendingTools.clear();

  for (const [, pending] of trace.pendingSubagents) {
    pending.span.end();
  }
  trace.pendingSubagents.clear();

  if (trace.tokenUsage.totalTokens > 0) {
    trace.rootSpan.setAttribute(SpanAttributeKey.TOKEN_USAGE, {
      input_tokens: trace.tokenUsage.inputTokens,
      output_tokens: trace.tokenUsage.outputTokens,
      total_tokens: trace.tokenUsage.totalTokens,
    });
  }

  // Use agent_end messages as fallback output if no llm_output was captured
  const endData = trace.agentEndData;
  if (!trace.lastResponse && endData?.messages?.length) {
    trace.lastResponse = JSON.stringify(endData.messages);
  }

  const outputs: Record<string, unknown> = {
    response: trace.lastResponse || "Agent completed",
  };
  if (endData?.error) {
    trace.rootSpan.setStatus(SpanStatusCode.ERROR, endData.error);
    outputs.error = endData.error;
  }
  trace.rootSpan.setOutputs(outputs);

  if (endData?.durationMs != null) {
    trace.rootSpan.setAttribute("agent_duration_ms", endData.durationMs);
  }

  trace.rootSpan.end();

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
        [TraceMetadataKey.TRACE_USER]: userId || process.env.USER || "",
      };
    }
  } catch {
    // Silently ignore metadata errors
  }

  await flushTraces();
}

export function createMLflowService(
  api: OpenClawPluginApi,
): OpenClawPluginService {
  const activeTraces = new Map<string, ActiveTrace>();
  let cleanup: (() => void) | null = null;

  function getOrCreateTrace(
    sessionKey: string,
    prompt: string,
  ): ActiveTrace {
    const existing = activeTraces.get(sessionKey);
    if (existing) {
      activeTraces.delete(sessionKey);
      activeTraces.set(sessionKey, existing);
      existing.lastActivityMs = Date.now();
      return existing;
    }

    const rootSpan = startSpan({
      name: "openclaw_agent",
      inputs: { prompt },
      spanType: SpanType.AGENT,
      attributes: { "session.id": sessionKey },
    });

    const trace: ActiveTrace = {
      rootSpan,
      pendingLlm: null,
      pendingTools: new Map(),
      pendingSubagents: new Map(),
      tokenUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, cost: 0 },
      firstPrompt: prompt,
      lastResponse: "",
      agentEndData: null,
      lastActivityMs: Date.now(),
    };

    activeTraces.set(sessionKey, trace);
    evictOldest(activeTraces, MAX_ACTIVE_TRACES);

    return trace;
  }

  return {
    id: "mlflow-tracing",

    async start(ctx) {
      const pluginCfg = (api.pluginConfig ?? {}) as Record<string, unknown>;
      const runtimeCfg = (ctx.config ?? {}) as Record<string, unknown>;
      const trackingUri =
        (typeof pluginCfg.trackingUri === "string" ? pluginCfg.trackingUri : "") ||
        (typeof runtimeCfg.trackingUri === "string" ? runtimeCfg.trackingUri : "") ||
        process.env.MLFLOW_TRACKING_URI;
      const experimentId =
        (typeof pluginCfg.experimentId === "string" ? pluginCfg.experimentId : "") ||
        (typeof runtimeCfg.experimentId === "string" ? runtimeCfg.experimentId : "") ||
        process.env.MLFLOW_EXPERIMENT_ID;

      if (!trackingUri) {
        ctx.logger.warn(
          "mlflow: MLFLOW_TRACKING_URI not set, skipping initialization",
        );
        return;
      }

      if (!experimentId) {
        ctx.logger.warn(
          "mlflow: MLFLOW_EXPERIMENT_ID not set, skipping initialization",
        );
        return;
      }

      try {
        init({ trackingUri, experimentId });
      } catch (error) {
        ctx.logger.warn(`mlflow: failed to initialize SDK: ${error}`);
        return;
      }

      ctx.logger.info(
        `mlflow: exporting traces to ${trackingUri} (experiment=${experimentId})`,
      );

      // =====================================================================
      // Hook: llm_input — create root AGENT span + child LLM span
      // =====================================================================
      api.on("llm_input", (event: unknown, agentCtx: unknown) => {
        const ctx = agentCtx as Record<string, unknown>;
        const evt = event as Record<string, unknown>;
        const sessionKey = ctx.sessionKey as string | undefined;
        if (!sessionKey) return;

        const prompt = (evt.prompt as string) ?? "";
        const historyMessages = evt.historyMessages as unknown[] | undefined;
        const trace = getOrCreateTrace(sessionKey, prompt);

        if (trace.pendingLlm) {
          trace.pendingLlm.span.end();
        }

        const provider = evt.provider as string | undefined;
        const model = evt.model as string | undefined;
        const modelLabel =
          provider && model ? `${provider}/${model}` : model || "unknown";

        const llmSpan = startSpan({
          name: "llm_call",
          parent: trace.rootSpan,
          spanType: SpanType.LLM,
          inputs: {
            model: modelLabel,
            prompt,
            ...(evt.systemPrompt
              ? { system_prompt: evt.systemPrompt }
              : {}),
            ...(historyMessages?.length
              ? { messages: historyMessages }
              : {}),
          },
          attributes: {
            ...(model ? { model } : {}),
            ...(provider ? { provider } : {}),
          },
        });

        trace.pendingLlm = { span: llmSpan, name: "llm_call" };
      });

      // =====================================================================
      // Hook: llm_output — end LLM span with response
      // =====================================================================
      api.on("llm_output", (event: unknown, agentCtx: unknown) => {
        const ctx = agentCtx as Record<string, unknown>;
        const evt = event as Record<string, unknown>;
        const sessionKey = ctx.sessionKey as string | undefined;
        if (!sessionKey) return;

        const trace = activeTraces.get(sessionKey);
        if (!trace) return;

        trace.lastActivityMs = Date.now();
        const assistantTexts = (evt.assistantTexts as string[] | undefined) ?? [];
        const lastAssistant = evt.lastAssistant as Record<string, unknown> | undefined;
        const response =
          assistantTexts.length > 0
            ? assistantTexts.join("\n")
            : (evt.response as string) || "";
        trace.lastResponse = response;

        if (trace.pendingLlm) {
          // Extract usage from top-level or from lastAssistant as fallback
          type UsageLike = { input?: number; output?: number; total?: number; totalTokens?: number };
          const usage =
            (evt.usage as UsageLike | undefined) ??
            (lastAssistant?.usage as UsageLike | undefined);
          if (usage) {
            trace.pendingLlm.span.setAttribute(SpanAttributeKey.TOKEN_USAGE, {
              input_tokens: usage.input || 0,
              output_tokens: usage.output || 0,
              total_tokens: usage.total || usage.totalTokens || 0,
            });
          }
          trace.pendingLlm.span.setOutputs({
            choices: [
              { message: { role: "assistant", content: response } },
            ],
          });
          trace.pendingLlm.span.end();
          trace.pendingLlm = null;
        }
      });

      // =====================================================================
      // Hook: tool_start — create TOOL span
      // =====================================================================
      api.on("tool_start", (event: unknown, agentCtx: unknown) => {
        const ctx = agentCtx as Record<string, unknown>;
        const evt = event as Record<string, unknown>;
        const sessionKey = ctx.sessionKey as string | undefined;
        if (!sessionKey) return;

        const trace = activeTraces.get(sessionKey);
        if (!trace) return;

        trace.lastActivityMs = Date.now();
        const toolName = evt.toolName as string;
        const toolCallId = evt.toolCallId as string | undefined;
        const key = toolKey(toolName, toolCallId);

        const toolSpan = startSpan({
          name: `tool_${toolName}`,
          parent: trace.rootSpan,
          spanType: SpanType.TOOL,
          inputs: (evt.arguments as Record<string, unknown>) || {},
          attributes: {
            tool_name: toolName,
            ...(toolCallId ? { tool_id: toolCallId } : {}),
          },
        });

        trace.pendingTools.set(key, { span: toolSpan, name: toolName });
      });

      // =====================================================================
      // Hook: tool_end — end TOOL span with result or error
      // =====================================================================
      api.on("tool_end", (event: unknown, agentCtx: unknown) => {
        const ctx = agentCtx as Record<string, unknown>;
        const evt = event as Record<string, unknown>;
        const sessionKey = ctx.sessionKey as string | undefined;
        if (!sessionKey) return;

        const trace = activeTraces.get(sessionKey);
        if (!trace) return;

        trace.lastActivityMs = Date.now();
        const toolName = evt.toolName as string;
        const toolCallId = evt.toolCallId as string | undefined;
        const key = toolKey(toolName, toolCallId);
        const pending = trace.pendingTools.get(key);

        if (pending) {
          if (evt.error) {
            pending.span.setOutputs({ error: evt.error });
          } else {
            pending.span.setOutputs({
              result: (evt.result as string) || "",
            });
          }
          pending.span.end();
          trace.pendingTools.delete(key);
        }
      });

      // =====================================================================
      // Hook: subagent_spawning — create nested AGENT span
      // =====================================================================
      api.on("subagent_spawning", (event: unknown, agentCtx: unknown) => {
        const ctx = agentCtx as Record<string, unknown>;
        const evt = event as Record<string, unknown>;
        const sessionKey = ctx.sessionKey as string | undefined;
        if (!sessionKey) return;

        const trace = activeTraces.get(sessionKey);
        if (!trace) return;

        trace.lastActivityMs = Date.now();
        const agentId = evt.agentId as string;
        const label = evt.label as string | undefined;

        const subSpan = startSpan({
          name: `subagent_${label || agentId}`,
          parent: trace.rootSpan,
          spanType: SpanType.AGENT,
          inputs: {
            agent_id: agentId,
            ...(label ? { label } : {}),
          },
        });

        trace.pendingSubagents.set(agentId, {
          span: subSpan,
          name: agentId,
        });
      });

      // =====================================================================
      // Hook: subagent_ended — end subagent span
      // =====================================================================
      api.on("subagent_ended", (event: unknown, agentCtx: unknown) => {
        const ctx = agentCtx as Record<string, unknown>;
        const evt = event as Record<string, unknown>;
        const sessionKey = ctx.sessionKey as string | undefined;
        if (!sessionKey) return;

        const trace = activeTraces.get(sessionKey);
        if (!trace) return;

        trace.lastActivityMs = Date.now();
        const agentId = evt.agentId as string;
        const pending = trace.pendingSubagents.get(agentId);

        if (pending) {
          if (evt.error) {
            pending.span.setOutputs({ error: evt.error });
          } else {
            pending.span.setOutputs({
              result: (evt.result as string) || "",
            });
          }
          pending.span.end();
          trace.pendingSubagents.delete(agentId);
        }
      });

      // =====================================================================
      // Hook: agent_end — finalize trace (deferred via queueMicrotask)
      // =====================================================================
      api.on("agent_end", (event: unknown, agentCtx: unknown) => {
        const ctx = agentCtx as Record<string, unknown>;
        const evt = event as Record<string, unknown>;
        const sessionKey = ctx.sessionKey as string | undefined;
        if (!sessionKey) return;

        const trace = activeTraces.get(sessionKey);
        if (!trace) return;

        trace.agentEndData = {
          success: evt.success as boolean | undefined,
          error: evt.error as string | undefined,
          durationMs: evt.durationMs as number | undefined,
          messages: evt.messages as unknown[] | undefined,
        };

        const userId = ctx.userId as string | undefined;

        queueMicrotask(async () => {
          try {
            const t = activeTraces.get(sessionKey);
            if (t) {
              activeTraces.delete(sessionKey);
              await finalizeTrace(sessionKey, t, userId);
            }
          } catch {
            // Silently ignore finalization errors
          }
        });
      });

      // =====================================================================
      // Diagnostic: model.usage — accumulate token usage
      // =====================================================================
      const unsubDiagnostics = onDiagnosticEvent(
        (evt: DiagnosticEventPayload) => {
          if (evt.type !== "model.usage") return;

          const sessionKey = evt.sessionKey;
          if (!sessionKey) return;

          const trace = activeTraces.get(sessionKey);
          if (!trace) return;

          trace.lastActivityMs = Date.now();
          if (evt.usage) {
            trace.tokenUsage.inputTokens += evt.usage.input || 0;
            trace.tokenUsage.outputTokens += evt.usage.output || 0;
            trace.tokenUsage.totalTokens += evt.usage.total || 0;
          }
          if (evt.costUsd) {
            trace.tokenUsage.cost += evt.costUsd;
          }
        },
      );

      cleanup = () => {
        unsubDiagnostics();
      };
    },

    async stop() {
      cleanup?.();
      cleanup = null;

      for (const [sessionKey, trace] of activeTraces) {
        await finalizeTrace(sessionKey, trace);
      }
      activeTraces.clear();
    },
  };
}
