// Mock types for OpenClaw plugin SDK

/**
 * Event types emitted by the OpenClaw agent runtime.
 */
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

/**
 * Service hooks registered via registerService().
 */
export interface ServiceHooks {
  onEvent?: (event: OpenClawEvent) => void | Promise<void>;
}

/**
 * The context provided to a plugin's init function.
 */
export interface PluginContext {
  registerService: (name: string, hooks: ServiceHooks) => void;
}

/**
 * A plugin is a function that receives a PluginContext and registers services.
 */
export type Plugin = (context: PluginContext) => void | Promise<void>;
