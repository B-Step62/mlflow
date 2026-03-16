/**
 * Type declarations for the OpenClaw plugin SDK.
 *
 * These types represent the OpenClaw plugin interface that this integration
 * targets. Once OpenClaw publishes official TypeScript types, this file can
 * be removed in favor of the `openclaw` package's own type definitions.
 */

declare module 'openclaw/plugin' {
  export interface LlmInputEvent {
    type: 'llm_input';
    sessionKey: string;
    prompt: string;
    systemPrompt?: string;
    model?: string;
    provider?: string;
    timestamp?: number;
  }

  export interface LlmOutputEvent {
    type: 'llm_output';
    sessionKey: string;
    response: string;
    model?: string;
    provider?: string;
    timestamp?: number;
  }

  export interface ToolStartEvent {
    type: 'tool_start';
    sessionKey: string;
    toolName: string;
    arguments?: Record<string, unknown>;
    toolCallId?: string;
    timestamp?: number;
  }

  export interface ToolEndEvent {
    type: 'tool_end';
    sessionKey: string;
    toolName: string;
    result?: string;
    error?: string;
    toolCallId?: string;
    timestamp?: number;
  }

  export interface SubagentSpawningEvent {
    type: 'subagent_spawning';
    sessionKey: string;
    agentId: string;
    label?: string;
    timestamp?: number;
  }

  export interface SubagentEndedEvent {
    type: 'subagent_ended';
    sessionKey: string;
    agentId: string;
    result?: string;
    error?: string;
    timestamp?: number;
  }

  export interface ModelUsageEvent {
    type: 'model.usage';
    sessionKey: string;
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
    cost?: number;
    model?: string;
    timestamp?: number;
  }

  export interface AgentEndEvent {
    type: 'agent_end';
    sessionKey: string;
    userId?: string;
    summary?: string;
    timestamp?: number;
  }

  export type OpenClawEvent =
    | LlmInputEvent
    | LlmOutputEvent
    | ToolStartEvent
    | ToolEndEvent
    | SubagentSpawningEvent
    | SubagentEndedEvent
    | ModelUsageEvent
    | AgentEndEvent;

  export interface ServiceHooks {
    onEvent?: (event: OpenClawEvent) => void | Promise<void>;
  }

  export interface PluginContext {
    registerService: (name: string, hooks: ServiceHooks) => void;
  }

  export type Plugin = (context: PluginContext) => void | Promise<void>;
}
