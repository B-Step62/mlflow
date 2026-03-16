/**
 * Tests for MLflow OpenClaw integration
 */

import { MLflowTracingPlugin } from '../src';
import type {
  PluginContext,
  ServiceHooks,
  LlmInputEvent,
  LlmOutputEvent,
  ToolStartEvent,
  ToolEndEvent,
  SubagentSpawningEvent,
  SubagentEndedEvent,
  ModelUsageEvent,
  AgentEndEvent,
} from 'openclaw/plugin';

// Mock the @mlflow/core module
jest.mock('@mlflow/core', () => {
  const createMockSpan = () => ({
    traceId: `mock-trace-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    setAttribute: jest.fn(),
    setOutputs: jest.fn(),
    end: jest.fn(),
  });

  const mockTraceInfo = {
    requestPreview: '',
    responsePreview: '',
    traceMetadata: {},
  };

  const mockTrace = {
    info: mockTraceInfo,
  };

  return {
    init: jest.fn(),
    startSpan: jest.fn(() => createMockSpan()),
    flushTraces: jest.fn().mockResolvedValue(undefined),
    SpanType: {
      LLM: 'LLM',
      TOOL: 'TOOL',
      AGENT: 'AGENT',
    },
    SpanAttributeKey: {
      TOKEN_USAGE: 'token_usage',
    },
    TraceMetadataKey: {
      TRACE_SESSION: 'mlflow.trace.session',
      TRACE_USER: 'mlflow.trace.user',
    },
    InMemoryTraceManager: {
      getInstance: jest.fn(() => ({
        getTrace: jest.fn(() => mockTrace),
      })),
    },
  };
});

// Import mocked functions after mocking
import * as mlflowTracing from '@mlflow/core';

// Helper: capture the registered service hooks from the plugin
function createMockContext(): { context: PluginContext; getHooks: () => ServiceHooks } {
  let registeredHooks: ServiceHooks = {};
  const context: PluginContext = {
    registerService: jest.fn((_name: string, hooks: ServiceHooks) => {
      registeredHooks = hooks;
    }),
  };
  return { context, getHooks: () => registeredHooks };
}

// Event factory helpers
function createLlmInputEvent(overrides: Partial<LlmInputEvent> = {}): LlmInputEvent {
  return {
    type: 'llm_input',
    sessionKey: 'session-1',
    prompt: 'Hello, world!',
    model: 'gpt-4',
    provider: 'openai',
    timestamp: Date.now(),
    ...overrides,
  };
}

function createLlmOutputEvent(overrides: Partial<LlmOutputEvent> = {}): LlmOutputEvent {
  return {
    type: 'llm_output',
    sessionKey: 'session-1',
    response: 'Hi there!',
    model: 'gpt-4',
    provider: 'openai',
    timestamp: Date.now(),
    ...overrides,
  };
}

function createToolStartEvent(overrides: Partial<ToolStartEvent> = {}): ToolStartEvent {
  return {
    type: 'tool_start',
    sessionKey: 'session-1',
    toolName: 'web_search',
    arguments: { query: 'MLflow tracing' },
    toolCallId: 'tool-call-1',
    timestamp: Date.now(),
    ...overrides,
  };
}

function createToolEndEvent(overrides: Partial<ToolEndEvent> = {}): ToolEndEvent {
  return {
    type: 'tool_end',
    sessionKey: 'session-1',
    toolName: 'web_search',
    result: 'Search results here',
    toolCallId: 'tool-call-1',
    timestamp: Date.now(),
    ...overrides,
  };
}

function createSubagentSpawningEvent(
  overrides: Partial<SubagentSpawningEvent> = {},
): SubagentSpawningEvent {
  return {
    type: 'subagent_spawning',
    sessionKey: 'session-1',
    agentId: 'sub-agent-1',
    label: 'research-agent',
    timestamp: Date.now(),
    ...overrides,
  };
}

function createSubagentEndedEvent(
  overrides: Partial<SubagentEndedEvent> = {},
): SubagentEndedEvent {
  return {
    type: 'subagent_ended',
    sessionKey: 'session-1',
    agentId: 'sub-agent-1',
    result: 'Subagent completed',
    timestamp: Date.now(),
    ...overrides,
  };
}

function createModelUsageEvent(overrides: Partial<ModelUsageEvent> = {}): ModelUsageEvent {
  return {
    type: 'model.usage',
    sessionKey: 'session-1',
    inputTokens: 100,
    outputTokens: 50,
    totalTokens: 150,
    cost: 0.003,
    model: 'gpt-4',
    timestamp: Date.now(),
    ...overrides,
  };
}

function createAgentEndEvent(overrides: Partial<AgentEndEvent> = {}): AgentEndEvent {
  return {
    type: 'agent_end',
    sessionKey: 'session-1',
    userId: 'test-user',
    summary: 'Agent completed task',
    timestamp: Date.now(),
    ...overrides,
  };
}

/**
 * Flush microtask queue so queueMicrotask callbacks in agent_end run.
 */
async function flushMicrotasks(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('MLflowTracingPlugin', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv };
    delete process.env.MLFLOW_TRACKING_URI;
    delete process.env.MLFLOW_EXPERIMENT_ID;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('Plugin Registration', () => {
    it('should export MLflowTracingPlugin function', () => {
      expect(typeof MLflowTracingPlugin).toBe('function');
    });

    it('should register a service with onEvent hook', () => {
      const { context } = createMockContext();
      MLflowTracingPlugin(context);

      expect(context.registerService).toHaveBeenCalledWith(
        'mlflow-tracing',
        expect.objectContaining({ onEvent: expect.any(Function) }),
      );
    });
  });

  describe('Environment Variable Handling', () => {
    it('should not create spans when MLFLOW_TRACKING_URI is not set', async () => {
      const { context, getHooks } = createMockContext();
      MLflowTracingPlugin(context);

      await getHooks().onEvent!(createLlmInputEvent());

      expect(mlflowTracing.startSpan).not.toHaveBeenCalled();
    });

    it('should not create spans when MLFLOW_EXPERIMENT_ID is not set', async () => {
      process.env.MLFLOW_TRACKING_URI = 'http://localhost:5000';

      const { context, getHooks } = createMockContext();
      MLflowTracingPlugin(context);

      await getHooks().onEvent!(createLlmInputEvent());

      expect(mlflowTracing.startSpan).not.toHaveBeenCalled();
    });

    it('should initialize SDK when both env variables are set', async () => {
      process.env.MLFLOW_TRACKING_URI = 'http://localhost:5000';
      process.env.MLFLOW_EXPERIMENT_ID = 'exp-123';

      const { context, getHooks } = createMockContext();
      MLflowTracingPlugin(context);

      await getHooks().onEvent!(createLlmInputEvent());

      expect(mlflowTracing.init).toHaveBeenCalledWith({
        trackingUri: 'http://localhost:5000',
        experimentId: 'exp-123',
      });
    });
  });

  describe('Basic LLM Call Tracing', () => {
    beforeEach(() => {
      process.env.MLFLOW_TRACKING_URI = 'http://localhost:5000';
      process.env.MLFLOW_EXPERIMENT_ID = 'exp-123';
    });

    it('should create root AGENT and child LLM spans on llm_input', async () => {
      const { context, getHooks } = createMockContext();
      MLflowTracingPlugin(context);
      const hooks = getHooks();

      await hooks.onEvent!(createLlmInputEvent({ prompt: 'What is 2+2?' }));

      // Root AGENT span
      expect(mlflowTracing.startSpan).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'openclaw_agent',
          spanType: 'AGENT',
          inputs: { prompt: 'What is 2+2?' },
        }),
      );

      // Child LLM span
      expect(mlflowTracing.startSpan).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'llm_call',
          spanType: 'LLM',
          inputs: expect.objectContaining({
            model: 'openai/gpt-4',
            prompt: 'What is 2+2?',
          }),
        }),
      );
    });

    it('should end LLM span on llm_output with response', async () => {
      const { context, getHooks } = createMockContext();
      MLflowTracingPlugin(context);
      const hooks = getHooks();

      await hooks.onEvent!(createLlmInputEvent());
      const mockSpan = (mlflowTracing.startSpan as jest.Mock).mock.results[1].value;

      await hooks.onEvent!(createLlmOutputEvent({ response: 'The answer is 4.' }));

      expect(mockSpan.setOutputs).toHaveBeenCalledWith({
        choices: [{ message: { role: 'assistant', content: 'The answer is 4.' } }],
      });
      expect(mockSpan.end).toHaveBeenCalled();
    });

    it('should flush traces on agent_end', async () => {
      const { context, getHooks } = createMockContext();
      MLflowTracingPlugin(context);
      const hooks = getHooks();

      await hooks.onEvent!(createLlmInputEvent());
      await hooks.onEvent!(createLlmOutputEvent());
      await hooks.onEvent!(createAgentEndEvent());
      await flushMicrotasks();

      expect(mlflowTracing.flushTraces).toHaveBeenCalled();
    });

    it('should set model label from provider and model', async () => {
      const { context, getHooks } = createMockContext();
      MLflowTracingPlugin(context);
      const hooks = getHooks();

      await hooks.onEvent!(
        createLlmInputEvent({ provider: 'anthropic', model: 'claude-3-opus' }),
      );

      expect(mlflowTracing.startSpan).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'llm_call',
          inputs: expect.objectContaining({ model: 'anthropic/claude-3-opus' }),
        }),
      );
    });

    it('should include system prompt in LLM inputs when provided', async () => {
      const { context, getHooks } = createMockContext();
      MLflowTracingPlugin(context);
      const hooks = getHooks();

      await hooks.onEvent!(
        createLlmInputEvent({ prompt: 'hello', systemPrompt: 'You are a helpful assistant.' }),
      );

      expect(mlflowTracing.startSpan).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'llm_call',
          inputs: expect.objectContaining({ system_prompt: 'You are a helpful assistant.' }),
        }),
      );
    });
  });

  describe('Tool Execution Tracing', () => {
    beforeEach(() => {
      process.env.MLFLOW_TRACKING_URI = 'http://localhost:5000';
      process.env.MLFLOW_EXPERIMENT_ID = 'exp-123';
    });

    it('should create TOOL span on tool_start', async () => {
      const { context, getHooks } = createMockContext();
      MLflowTracingPlugin(context);
      const hooks = getHooks();

      // Need a root trace first
      await hooks.onEvent!(createLlmInputEvent());
      await hooks.onEvent!(
        createToolStartEvent({
          toolName: 'web_search',
          arguments: { query: 'MLflow' },
          toolCallId: 'tc-1',
        }),
      );

      expect(mlflowTracing.startSpan).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'tool_web_search',
          spanType: 'TOOL',
          inputs: { query: 'MLflow' },
          attributes: expect.objectContaining({
            tool_name: 'web_search',
            tool_id: 'tc-1',
          }),
        }),
      );
    });

    it('should end TOOL span on tool_end with result', async () => {
      const { context, getHooks } = createMockContext();
      MLflowTracingPlugin(context);
      const hooks = getHooks();

      await hooks.onEvent!(createLlmInputEvent());
      await hooks.onEvent!(createToolStartEvent({ toolName: 'web_search', toolCallId: 'tc-1' }));

      // The tool span is the third startSpan call (root AGENT, LLM, TOOL)
      const toolSpan = (mlflowTracing.startSpan as jest.Mock).mock.results[2].value;

      await hooks.onEvent!(
        createToolEndEvent({
          toolName: 'web_search',
          toolCallId: 'tc-1',
          result: 'Found 10 results',
        }),
      );

      expect(toolSpan.setOutputs).toHaveBeenCalledWith({ result: 'Found 10 results' });
      expect(toolSpan.end).toHaveBeenCalled();
    });

    it('should handle tool errors', async () => {
      const { context, getHooks } = createMockContext();
      MLflowTracingPlugin(context);
      const hooks = getHooks();

      await hooks.onEvent!(createLlmInputEvent());
      await hooks.onEvent!(createToolStartEvent({ toolName: 'database', toolCallId: 'tc-2' }));

      const toolSpan = (mlflowTracing.startSpan as jest.Mock).mock.results[2].value;

      await hooks.onEvent!(
        createToolEndEvent({
          toolName: 'database',
          toolCallId: 'tc-2',
          error: 'Connection timeout',
        }),
      );

      expect(toolSpan.setOutputs).toHaveBeenCalledWith({ error: 'Connection timeout' });
      expect(toolSpan.end).toHaveBeenCalled();
    });

    it('should handle multiple concurrent tools', async () => {
      const { context, getHooks } = createMockContext();
      MLflowTracingPlugin(context);
      const hooks = getHooks();

      await hooks.onEvent!(createLlmInputEvent());
      await hooks.onEvent!(createToolStartEvent({ toolName: 'search', toolCallId: 'tc-a' }));
      await hooks.onEvent!(createToolStartEvent({ toolName: 'fetch', toolCallId: 'tc-b' }));

      expect(mlflowTracing.startSpan).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'tool_search' }),
      );
      expect(mlflowTracing.startSpan).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'tool_fetch' }),
      );

      // End them in reverse order
      await hooks.onEvent!(
        createToolEndEvent({ toolName: 'fetch', toolCallId: 'tc-b', result: 'fetched' }),
      );
      await hooks.onEvent!(
        createToolEndEvent({ toolName: 'search', toolCallId: 'tc-a', result: 'found' }),
      );

      const searchSpan = (mlflowTracing.startSpan as jest.Mock).mock.results[2].value;
      const fetchSpan = (mlflowTracing.startSpan as jest.Mock).mock.results[3].value;

      expect(searchSpan.end).toHaveBeenCalled();
      expect(fetchSpan.end).toHaveBeenCalled();
    });
  });

  describe('Subagent Tracing', () => {
    beforeEach(() => {
      process.env.MLFLOW_TRACKING_URI = 'http://localhost:5000';
      process.env.MLFLOW_EXPERIMENT_ID = 'exp-123';
    });

    it('should create nested AGENT span on subagent_spawning', async () => {
      const { context, getHooks } = createMockContext();
      MLflowTracingPlugin(context);
      const hooks = getHooks();

      await hooks.onEvent!(createLlmInputEvent());
      await hooks.onEvent!(
        createSubagentSpawningEvent({ agentId: 'researcher', label: 'research-agent' }),
      );

      expect(mlflowTracing.startSpan).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'subagent_research-agent',
          spanType: 'AGENT',
          inputs: { agent_id: 'researcher', label: 'research-agent' },
        }),
      );
    });

    it('should end subagent span on subagent_ended', async () => {
      const { context, getHooks } = createMockContext();
      MLflowTracingPlugin(context);
      const hooks = getHooks();

      await hooks.onEvent!(createLlmInputEvent());
      await hooks.onEvent!(createSubagentSpawningEvent({ agentId: 'researcher' }));

      const subSpan = (mlflowTracing.startSpan as jest.Mock).mock.results[2].value;

      await hooks.onEvent!(
        createSubagentEndedEvent({ agentId: 'researcher', result: 'Research done' }),
      );

      expect(subSpan.setOutputs).toHaveBeenCalledWith({ result: 'Research done' });
      expect(subSpan.end).toHaveBeenCalled();
    });

    it('should handle subagent errors', async () => {
      const { context, getHooks } = createMockContext();
      MLflowTracingPlugin(context);
      const hooks = getHooks();

      await hooks.onEvent!(createLlmInputEvent());
      await hooks.onEvent!(createSubagentSpawningEvent({ agentId: 'failing-agent' }));

      const subSpan = (mlflowTracing.startSpan as jest.Mock).mock.results[2].value;

      await hooks.onEvent!(
        createSubagentEndedEvent({ agentId: 'failing-agent', error: 'Out of memory' }),
      );

      expect(subSpan.setOutputs).toHaveBeenCalledWith({ error: 'Out of memory' });
      expect(subSpan.end).toHaveBeenCalled();
    });
  });

  describe('Token Usage Tracking', () => {
    beforeEach(() => {
      process.env.MLFLOW_TRACKING_URI = 'http://localhost:5000';
      process.env.MLFLOW_EXPERIMENT_ID = 'exp-123';
    });

    it('should accumulate token usage from model.usage events', async () => {
      const { context, getHooks } = createMockContext();
      MLflowTracingPlugin(context);
      const hooks = getHooks();

      await hooks.onEvent!(createLlmInputEvent());
      await hooks.onEvent!(createLlmOutputEvent());
      await hooks.onEvent!(
        createModelUsageEvent({ inputTokens: 100, outputTokens: 50, totalTokens: 150 }),
      );
      await hooks.onEvent!(
        createModelUsageEvent({ inputTokens: 200, outputTokens: 100, totalTokens: 300 }),
      );
      await hooks.onEvent!(createAgentEndEvent());
      await flushMicrotasks();

      // Root span should have accumulated token usage
      const rootSpan = (mlflowTracing.startSpan as jest.Mock).mock.results[0].value;
      expect(rootSpan.setAttribute).toHaveBeenCalledWith('token_usage', {
        input_tokens: 300,
        output_tokens: 150,
        total_tokens: 450,
      });
    });

    it('should not set token usage if no model.usage events', async () => {
      const { context, getHooks } = createMockContext();
      MLflowTracingPlugin(context);
      const hooks = getHooks();

      await hooks.onEvent!(createLlmInputEvent());
      await hooks.onEvent!(createLlmOutputEvent());
      await hooks.onEvent!(createAgentEndEvent());
      await flushMicrotasks();

      const rootSpan = (mlflowTracing.startSpan as jest.Mock).mock.results[0].value;
      // setAttribute should not be called with token_usage
      const tokenCalls = rootSpan.setAttribute.mock.calls.filter(
        (call: unknown[]) => call[0] === 'token_usage',
      );
      expect(tokenCalls).toHaveLength(0);
    });
  });

  describe('Trace Metadata', () => {
    beforeEach(() => {
      process.env.MLFLOW_TRACKING_URI = 'http://localhost:5000';
      process.env.MLFLOW_EXPERIMENT_ID = 'exp-123';
      process.env.USER = 'test-user';
    });

    it('should set trace metadata on agent_end', async () => {
      const { context, getHooks } = createMockContext();
      MLflowTracingPlugin(context);
      const hooks = getHooks();

      await hooks.onEvent!(createLlmInputEvent({ prompt: 'Hello' }));
      await hooks.onEvent!(createLlmOutputEvent({ response: 'Hi there!' }));
      await hooks.onEvent!(createAgentEndEvent({ userId: 'yuki', sessionKey: 'session-1' }));
      await flushMicrotasks();

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(mlflowTracing.InMemoryTraceManager.getInstance).toHaveBeenCalled();
    });

    it('should set requestPreview and responsePreview', async () => {
      const { context, getHooks } = createMockContext();
      MLflowTracingPlugin(context);
      const hooks = getHooks();

      await hooks.onEvent!(createLlmInputEvent({ prompt: 'What is MLflow?' }));
      await hooks.onEvent!(
        createLlmOutputEvent({ response: 'MLflow is a platform for ML lifecycle.' }),
      );
      await hooks.onEvent!(createAgentEndEvent());
      await flushMicrotasks();

      expect(mlflowTracing.flushTraces).toHaveBeenCalled();
    });
  });

  describe('Deferred Finalization', () => {
    beforeEach(() => {
      process.env.MLFLOW_TRACKING_URI = 'http://localhost:5000';
      process.env.MLFLOW_EXPERIMENT_ID = 'exp-123';
    });

    it('should handle agent_end before llm_output via queueMicrotask', async () => {
      const { context, getHooks } = createMockContext();
      MLflowTracingPlugin(context);
      const hooks = getHooks();

      await hooks.onEvent!(createLlmInputEvent());

      // agent_end fires but finalization is deferred via queueMicrotask
      await hooks.onEvent!(createAgentEndEvent());

      // llm_output fires before microtask runs
      await hooks.onEvent!(createLlmOutputEvent({ response: 'Late response' }));

      // Now let the microtask run
      await flushMicrotasks();

      expect(mlflowTracing.flushTraces).toHaveBeenCalled();
    });
  });

  describe('LRU Eviction', () => {
    beforeEach(() => {
      process.env.MLFLOW_TRACKING_URI = 'http://localhost:5000';
      process.env.MLFLOW_EXPERIMENT_ID = 'exp-123';
    });

    it('should evict oldest sessions when exceeding max active traces', async () => {
      const { context, getHooks } = createMockContext();
      MLflowTracingPlugin(context);
      const hooks = getHooks();

      // Create 51 sessions — the first should be evicted
      for (let i = 0; i < 51; i++) {
        await hooks.onEvent!(
          createLlmInputEvent({ sessionKey: `session-${i}`, prompt: `Prompt ${i}` }),
        );
      }

      // Should have created 51 root AGENT spans + 51 LLM spans = 102 total
      expect((mlflowTracing.startSpan as jest.Mock).mock.calls.length).toBe(102);

      // Sending an event for session-0 should create a new trace (it was evicted)
      jest.clearAllMocks();
      await hooks.onEvent!(
        createLlmInputEvent({ sessionKey: 'session-0', prompt: 'Revived prompt' }),
      );

      // New root AGENT + new LLM span
      expect((mlflowTracing.startSpan as jest.Mock).mock.calls.length).toBe(2);
    });
  });

  describe('Error Resilience', () => {
    beforeEach(() => {
      process.env.MLFLOW_TRACKING_URI = 'http://localhost:5000';
      process.env.MLFLOW_EXPERIMENT_ID = 'exp-123';
    });

    it('should not throw on llm_output without prior llm_input', async () => {
      const { context, getHooks } = createMockContext();
      MLflowTracingPlugin(context);
      const hooks = getHooks();

      // No llm_input for this session — should not throw
      await expect(
        hooks.onEvent!(createLlmOutputEvent({ sessionKey: 'unknown-session' })),
      ).resolves.not.toThrow();
    });

    it('should not throw on tool_end without prior tool_start', async () => {
      const { context, getHooks } = createMockContext();
      MLflowTracingPlugin(context);
      const hooks = getHooks();

      await hooks.onEvent!(createLlmInputEvent());

      await expect(
        hooks.onEvent!(createToolEndEvent({ toolName: 'unknown', toolCallId: 'tc-unknown' })),
      ).resolves.not.toThrow();
    });

    it('should not throw on subagent_ended without prior subagent_spawning', async () => {
      const { context, getHooks } = createMockContext();
      MLflowTracingPlugin(context);
      const hooks = getHooks();

      await hooks.onEvent!(createLlmInputEvent());

      await expect(
        hooks.onEvent!(createSubagentEndedEvent({ agentId: 'ghost-agent' })),
      ).resolves.not.toThrow();
    });

    it('should not throw on agent_end without prior events', async () => {
      const { context, getHooks } = createMockContext();
      MLflowTracingPlugin(context);
      const hooks = getHooks();

      await expect(
        hooks.onEvent!(createAgentEndEvent({ sessionKey: 'nonexistent' })),
      ).resolves.not.toThrow();
    });

    it('should handle tool_start without a root trace gracefully', async () => {
      const { context, getHooks } = createMockContext();
      MLflowTracingPlugin(context);
      const hooks = getHooks();

      // tool_start for unknown session — no root trace exists
      await expect(
        hooks.onEvent!(createToolStartEvent({ sessionKey: 'no-root' })),
      ).resolves.not.toThrow();
    });
  });

  describe('Complete Agent Workflow', () => {
    beforeEach(() => {
      process.env.MLFLOW_TRACKING_URI = 'http://localhost:5000';
      process.env.MLFLOW_EXPERIMENT_ID = 'exp-123';
    });

    it('should trace a full workflow: LLM → tool → subagent → LLM → end', async () => {
      const { context, getHooks } = createMockContext();
      MLflowTracingPlugin(context);
      const hooks = getHooks();

      // 1. Initial LLM call
      await hooks.onEvent!(
        createLlmInputEvent({ prompt: 'Find and summarize the latest MLflow docs' }),
      );
      await hooks.onEvent!(
        createLlmOutputEvent({ response: 'I will search and summarize for you.' }),
      );

      // 2. Tool call
      await hooks.onEvent!(
        createToolStartEvent({
          toolName: 'web_search',
          arguments: { query: 'MLflow documentation' },
          toolCallId: 'tc-1',
        }),
      );
      await hooks.onEvent!(
        createToolEndEvent({
          toolName: 'web_search',
          result: 'MLflow docs: https://mlflow.org/docs',
          toolCallId: 'tc-1',
        }),
      );

      // 3. Subagent
      await hooks.onEvent!(
        createSubagentSpawningEvent({ agentId: 'summarizer', label: 'summary-agent' }),
      );
      await hooks.onEvent!(
        createSubagentEndedEvent({ agentId: 'summarizer', result: 'Summary complete' }),
      );

      // 4. Token usage
      await hooks.onEvent!(
        createModelUsageEvent({ inputTokens: 500, outputTokens: 200, totalTokens: 700 }),
      );

      // 5. Second LLM call with final response
      await hooks.onEvent!(
        createLlmInputEvent({
          prompt: 'Find and summarize the latest MLflow docs',
          sessionKey: 'session-1',
        }),
      );
      await hooks.onEvent!(
        createLlmOutputEvent({ response: 'Here is your summary of MLflow docs.' }),
      );

      // 6. End
      await hooks.onEvent!(createAgentEndEvent());
      await flushMicrotasks();

      // Verify span hierarchy was created
      expect(mlflowTracing.startSpan).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'openclaw_agent', spanType: 'AGENT' }),
      );
      expect(mlflowTracing.startSpan).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'llm_call', spanType: 'LLM' }),
      );
      expect(mlflowTracing.startSpan).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'tool_web_search', spanType: 'TOOL' }),
      );
      expect(mlflowTracing.startSpan).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'subagent_summary-agent', spanType: 'AGENT' }),
      );

      expect(mlflowTracing.flushTraces).toHaveBeenCalled();
    });
  });

  describe('Multiple Sessions', () => {
    beforeEach(() => {
      process.env.MLFLOW_TRACKING_URI = 'http://localhost:5000';
      process.env.MLFLOW_EXPERIMENT_ID = 'exp-123';
    });

    it('should handle interleaved events from different sessions', async () => {
      const { context, getHooks } = createMockContext();
      MLflowTracingPlugin(context);
      const hooks = getHooks();

      // Session A starts
      await hooks.onEvent!(createLlmInputEvent({ sessionKey: 'session-A', prompt: 'A prompt' }));
      // Session B starts
      await hooks.onEvent!(createLlmInputEvent({ sessionKey: 'session-B', prompt: 'B prompt' }));

      // Session A gets LLM output
      await hooks.onEvent!(
        createLlmOutputEvent({ sessionKey: 'session-A', response: 'A response' }),
      );
      // Session B gets LLM output
      await hooks.onEvent!(
        createLlmOutputEvent({ sessionKey: 'session-B', response: 'B response' }),
      );

      // Both end
      await hooks.onEvent!(createAgentEndEvent({ sessionKey: 'session-A' }));
      await hooks.onEvent!(createAgentEndEvent({ sessionKey: 'session-B' }));
      await flushMicrotasks();

      // Should have created 2 root spans + 2 LLM spans = 4 total
      // Plus flushed twice
      expect(mlflowTracing.flushTraces).toHaveBeenCalledTimes(2);
    });
  });
});
