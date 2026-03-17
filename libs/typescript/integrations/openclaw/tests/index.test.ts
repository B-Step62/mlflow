/**
 * Tests for MLflow OpenClaw integration
 */

import type { DiagnosticEventPayload } from 'openclaw/plugin-sdk';

// Capture the diagnostic event handler registered by the service
let diagnosticHandler: ((evt: DiagnosticEventPayload) => void) | null = null;

jest.mock('openclaw/plugin-sdk', () => ({
  onDiagnosticEvent: jest.fn((handler: (evt: DiagnosticEventPayload) => void) => {
    diagnosticHandler = handler;
    return jest.fn(); // unsubscribe
  }),
  emptyPluginConfigSchema: jest.fn(() => ({})),
}));

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

import * as mlflowTracing from '@mlflow/core';
import { createMLflowService } from '../src/service';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type EventHandler = (event: unknown, ctx: unknown) => void;

interface MockApi {
  on: jest.Mock;
  registerService: jest.Mock;
  registerCli: jest.Mock;
  runtime: { config: { loadConfig: jest.Mock; writeConfigFile: jest.Mock } };
  pluginConfig: undefined;
}

interface TestHarness {
  api: MockApi;
  fire: (event: string, eventData: Record<string, unknown>, ctx: Record<string, unknown>) => void;
  fireDiagnostic: (evt: DiagnosticEventPayload) => void;
  handlers: Map<string, EventHandler>;
}

function createTestHarness(): TestHarness {
  const handlers = new Map<string, EventHandler>();
  const api: MockApi = {
    on: jest.fn((eventName: string, handler: EventHandler) => {
      handlers.set(eventName, handler);
    }),
    registerService: jest.fn(),
    registerCli: jest.fn(),
    runtime: {
      config: {
        loadConfig: jest.fn(() => ({})),
        writeConfigFile: jest.fn(),
      },
    },
    pluginConfig: undefined,
  };

  return {
    api,
    handlers,
    fire(event: string, eventData: Record<string, unknown>, ctx: Record<string, unknown>) {
      const handler = handlers.get(event);
      if (handler) handler(eventData, ctx);
    },
    fireDiagnostic(evt: DiagnosticEventPayload) {
      if (diagnosticHandler) diagnosticHandler(evt);
    },
  };
}

function createMockLogger() {
  return {
    info: jest.fn(),
    warn: jest.fn(),
  };
}

async function startService(harness: TestHarness, config: Record<string, unknown> = {}) {
  const service = createMLflowService(harness.api as any);
  await service.start!({
    config: {
      trackingUri: 'http://localhost:5000',
      experimentId: 'exp-123',
      ...config,
    },
    logger: createMockLogger(),
  });
  return service;
}

async function flushMicrotasks(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MLflowTracingPlugin', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    diagnosticHandler = null;
    process.env = { ...originalEnv };
    delete process.env.MLFLOW_TRACKING_URI;
    delete process.env.MLFLOW_EXPERIMENT_ID;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('Service Lifecycle', () => {
    it('should return a service with id and start/stop', () => {
      const harness = createTestHarness();
      const service = createMLflowService(harness.api as any);
      expect(service.id).toBe('mlflow-tracing');
      expect(typeof service.start).toBe('function');
      expect(typeof service.stop).toBe('function');
    });

    it('should register event hooks on start', async () => {
      const harness = createTestHarness();
      await startService(harness);

      expect(harness.api.on).toHaveBeenCalledWith('llm_input', expect.any(Function));
      expect(harness.api.on).toHaveBeenCalledWith('llm_output', expect.any(Function));
      expect(harness.api.on).toHaveBeenCalledWith('tool_start', expect.any(Function));
      expect(harness.api.on).toHaveBeenCalledWith('tool_end', expect.any(Function));
      expect(harness.api.on).toHaveBeenCalledWith('subagent_spawning', expect.any(Function));
      expect(harness.api.on).toHaveBeenCalledWith('subagent_ended', expect.any(Function));
      expect(harness.api.on).toHaveBeenCalledWith('agent_end', expect.any(Function));
    });
  });

  describe('Configuration', () => {
    it('should not register hooks when trackingUri is missing', async () => {
      const harness = createTestHarness();
      const service = createMLflowService(harness.api as any);
      await service.start!({
        config: { experimentId: 'exp-123' },
        logger: createMockLogger(),
      });

      expect(harness.api.on).not.toHaveBeenCalled();
    });

    it('should not register hooks when experimentId is missing', async () => {
      const harness = createTestHarness();
      const service = createMLflowService(harness.api as any);
      await service.start!({
        config: { trackingUri: 'http://localhost:5000' },
        logger: createMockLogger(),
      });

      expect(harness.api.on).not.toHaveBeenCalled();
    });

    it('should fall back to env vars when config is empty', async () => {
      process.env.MLFLOW_TRACKING_URI = 'http://env-host:5000';
      process.env.MLFLOW_EXPERIMENT_ID = 'env-exp';

      const harness = createTestHarness();
      const service = createMLflowService(harness.api as any);
      await service.start!({ config: {}, logger: createMockLogger() });

      expect(mlflowTracing.init).toHaveBeenCalledWith({
        trackingUri: 'http://env-host:5000',
        experimentId: 'env-exp',
      });
    });

    it('should initialize SDK with config values', async () => {
      const harness = createTestHarness();
      await startService(harness);

      expect(mlflowTracing.init).toHaveBeenCalledWith({
        trackingUri: 'http://localhost:5000',
        experimentId: 'exp-123',
      });
    });
  });

  describe('Basic LLM Call Tracing', () => {
    it('should create root AGENT and child LLM spans on llm_input', async () => {
      const harness = createTestHarness();
      await startService(harness);

      harness.fire('llm_input', { prompt: 'What is 2+2?', model: 'gpt-4', provider: 'openai' }, { sessionKey: 'session-1' });

      expect(mlflowTracing.startSpan).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'openclaw_agent',
          spanType: 'AGENT',
          inputs: { prompt: 'What is 2+2?' },
          attributes: expect.objectContaining({ session_id: 'session-1' }),
        }),
      );

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
      const harness = createTestHarness();
      await startService(harness);

      harness.fire('llm_input', { prompt: 'Hello', model: 'gpt-4', provider: 'openai' }, { sessionKey: 'session-1' });
      const mockSpan = (mlflowTracing.startSpan as jest.Mock).mock.results[1].value;

      harness.fire('llm_output', { response: 'The answer is 4.' }, { sessionKey: 'session-1' });

      expect(mockSpan.setOutputs).toHaveBeenCalledWith({
        choices: [{ message: { role: 'assistant', content: 'The answer is 4.' } }],
      });
      expect(mockSpan.end).toHaveBeenCalled();
    });

    it('should flush traces on agent_end', async () => {
      const harness = createTestHarness();
      await startService(harness);

      harness.fire('llm_input', { prompt: 'Hello', model: 'gpt-4', provider: 'openai' }, { sessionKey: 'session-1' });
      harness.fire('llm_output', { response: 'Hi' }, { sessionKey: 'session-1' });
      harness.fire('agent_end', {}, { sessionKey: 'session-1' });
      await flushMicrotasks();

      expect(mlflowTracing.flushTraces).toHaveBeenCalled();
    });

    it('should set model label from provider and model', async () => {
      const harness = createTestHarness();
      await startService(harness);

      harness.fire('llm_input', { prompt: 'Hi', provider: 'anthropic', model: 'claude-3-opus' }, { sessionKey: 'session-1' });

      expect(mlflowTracing.startSpan).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'llm_call',
          inputs: expect.objectContaining({ model: 'anthropic/claude-3-opus' }),
        }),
      );
    });

    it('should include historyMessages in LLM inputs when provided', async () => {
      const harness = createTestHarness();
      await startService(harness);

      const history = [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there' },
      ];
      harness.fire(
        'llm_input',
        { prompt: 'Follow up', model: 'gpt-4', provider: 'openai', historyMessages: history },
        { sessionKey: 'session-1' },
      );

      expect(mlflowTracing.startSpan).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'llm_call',
          inputs: expect.objectContaining({ messages: history }),
        }),
      );
    });

    it('should capture assistantTexts and lastAssistant from llm_output', async () => {
      const harness = createTestHarness();
      await startService(harness);

      harness.fire('llm_input', { prompt: 'Hello', model: 'gpt-4', provider: 'openai' }, { sessionKey: 'session-1' });
      const llmSpan = (mlflowTracing.startSpan as jest.Mock).mock.results[1].value;

      harness.fire(
        'llm_output',
        {
          assistantTexts: ['Part 1', 'Part 2'],
          lastAssistant: { role: 'assistant', content: 'Part 2' },
        },
        { sessionKey: 'session-1' },
      );

      expect(llmSpan.setOutputs).toHaveBeenCalledWith(
        expect.objectContaining({
          choices: [{ message: { role: 'assistant', content: 'Part 1\nPart 2' } }],
          assistantTexts: ['Part 1', 'Part 2'],
          lastAssistant: { role: 'assistant', content: 'Part 2' },
        }),
      );
    });

    it('should fall back to response string when assistantTexts is absent', async () => {
      const harness = createTestHarness();
      await startService(harness);

      harness.fire('llm_input', { prompt: 'Hello', model: 'gpt-4', provider: 'openai' }, { sessionKey: 'session-1' });
      const llmSpan = (mlflowTracing.startSpan as jest.Mock).mock.results[1].value;

      harness.fire('llm_output', { response: 'Plain response' }, { sessionKey: 'session-1' });

      expect(llmSpan.setOutputs).toHaveBeenCalledWith({
        choices: [{ message: { role: 'assistant', content: 'Plain response' } }],
      });
    });

    it('should include system prompt in LLM inputs when provided', async () => {
      const harness = createTestHarness();
      await startService(harness);

      harness.fire(
        'llm_input',
        { prompt: 'hello', systemPrompt: 'You are a helpful assistant.', model: 'gpt-4', provider: 'openai' },
        { sessionKey: 'session-1' },
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
    it('should create TOOL span on tool_start', async () => {
      const harness = createTestHarness();
      await startService(harness);

      harness.fire('llm_input', { prompt: 'Search', model: 'gpt-4', provider: 'openai' }, { sessionKey: 'session-1' });
      harness.fire(
        'tool_start',
        { toolName: 'web_search', arguments: { query: 'MLflow' }, toolCallId: 'tc-1' },
        { sessionKey: 'session-1' },
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
      const harness = createTestHarness();
      await startService(harness);

      harness.fire('llm_input', { prompt: 'Search', model: 'gpt-4', provider: 'openai' }, { sessionKey: 'session-1' });
      harness.fire('tool_start', { toolName: 'web_search', toolCallId: 'tc-1' }, { sessionKey: 'session-1' });

      const toolSpan = (mlflowTracing.startSpan as jest.Mock).mock.results[2].value;

      harness.fire(
        'tool_end',
        { toolName: 'web_search', toolCallId: 'tc-1', result: 'Found 10 results' },
        { sessionKey: 'session-1' },
      );

      expect(toolSpan.setOutputs).toHaveBeenCalledWith({ result: 'Found 10 results' });
      expect(toolSpan.end).toHaveBeenCalled();
    });

    it('should handle tool errors', async () => {
      const harness = createTestHarness();
      await startService(harness);

      harness.fire('llm_input', { prompt: 'Query', model: 'gpt-4', provider: 'openai' }, { sessionKey: 'session-1' });
      harness.fire('tool_start', { toolName: 'database', toolCallId: 'tc-2' }, { sessionKey: 'session-1' });

      const toolSpan = (mlflowTracing.startSpan as jest.Mock).mock.results[2].value;

      harness.fire(
        'tool_end',
        { toolName: 'database', toolCallId: 'tc-2', error: 'Connection timeout' },
        { sessionKey: 'session-1' },
      );

      expect(toolSpan.setOutputs).toHaveBeenCalledWith({ error: 'Connection timeout' });
      expect(toolSpan.end).toHaveBeenCalled();
    });

    it('should handle multiple concurrent tools', async () => {
      const harness = createTestHarness();
      await startService(harness);

      harness.fire('llm_input', { prompt: 'Do things', model: 'gpt-4', provider: 'openai' }, { sessionKey: 'session-1' });
      harness.fire('tool_start', { toolName: 'search', toolCallId: 'tc-a' }, { sessionKey: 'session-1' });
      harness.fire('tool_start', { toolName: 'fetch', toolCallId: 'tc-b' }, { sessionKey: 'session-1' });

      expect(mlflowTracing.startSpan).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'tool_search' }),
      );
      expect(mlflowTracing.startSpan).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'tool_fetch' }),
      );

      harness.fire('tool_end', { toolName: 'fetch', toolCallId: 'tc-b', result: 'fetched' }, { sessionKey: 'session-1' });
      harness.fire('tool_end', { toolName: 'search', toolCallId: 'tc-a', result: 'found' }, { sessionKey: 'session-1' });

      const searchSpan = (mlflowTracing.startSpan as jest.Mock).mock.results[2].value;
      const fetchSpan = (mlflowTracing.startSpan as jest.Mock).mock.results[3].value;

      expect(searchSpan.end).toHaveBeenCalled();
      expect(fetchSpan.end).toHaveBeenCalled();
    });
  });

  describe('Subagent Tracing', () => {
    it('should create nested AGENT span on subagent_spawning', async () => {
      const harness = createTestHarness();
      await startService(harness);

      harness.fire('llm_input', { prompt: 'Research', model: 'gpt-4', provider: 'openai' }, { sessionKey: 'session-1' });
      harness.fire(
        'subagent_spawning',
        { agentId: 'researcher', label: 'research-agent' },
        { sessionKey: 'session-1' },
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
      const harness = createTestHarness();
      await startService(harness);

      harness.fire('llm_input', { prompt: 'Research', model: 'gpt-4', provider: 'openai' }, { sessionKey: 'session-1' });
      harness.fire('subagent_spawning', { agentId: 'researcher', label: 'research-agent' }, { sessionKey: 'session-1' });

      const subSpan = (mlflowTracing.startSpan as jest.Mock).mock.results[2].value;

      harness.fire('subagent_ended', { agentId: 'researcher', result: 'Research done' }, { sessionKey: 'session-1' });

      expect(subSpan.setOutputs).toHaveBeenCalledWith({ result: 'Research done' });
      expect(subSpan.end).toHaveBeenCalled();
    });

    it('should handle subagent errors', async () => {
      const harness = createTestHarness();
      await startService(harness);

      harness.fire('llm_input', { prompt: 'Research', model: 'gpt-4', provider: 'openai' }, { sessionKey: 'session-1' });
      harness.fire('subagent_spawning', { agentId: 'failing-agent' }, { sessionKey: 'session-1' });

      const subSpan = (mlflowTracing.startSpan as jest.Mock).mock.results[2].value;

      harness.fire('subagent_ended', { agentId: 'failing-agent', error: 'Out of memory' }, { sessionKey: 'session-1' });

      expect(subSpan.setOutputs).toHaveBeenCalledWith({ error: 'Out of memory' });
      expect(subSpan.end).toHaveBeenCalled();
    });
  });

  describe('Token Usage Tracking', () => {
    it('should accumulate token usage from diagnostic events', async () => {
      const harness = createTestHarness();
      await startService(harness);

      harness.fire('llm_input', { prompt: 'Hello', model: 'gpt-4', provider: 'openai' }, { sessionKey: 'session-1' });
      harness.fire('llm_output', { response: 'Hi' }, { sessionKey: 'session-1' });

      harness.fireDiagnostic({
        type: 'model.usage',
        sessionKey: 'session-1',
        usage: { input: 100, output: 50, total: 150 },
      });
      harness.fireDiagnostic({
        type: 'model.usage',
        sessionKey: 'session-1',
        usage: { input: 200, output: 100, total: 300 },
      });

      harness.fire('agent_end', {}, { sessionKey: 'session-1' });
      await flushMicrotasks();

      const rootSpan = (mlflowTracing.startSpan as jest.Mock).mock.results[0].value;
      expect(rootSpan.setAttribute).toHaveBeenCalledWith('token_usage', {
        input_tokens: 300,
        output_tokens: 150,
        total_tokens: 450,
      });
    });

    it('should not set token usage if no diagnostic events', async () => {
      const harness = createTestHarness();
      await startService(harness);

      harness.fire('llm_input', { prompt: 'Hello', model: 'gpt-4', provider: 'openai' }, { sessionKey: 'session-1' });
      harness.fire('llm_output', { response: 'Hi' }, { sessionKey: 'session-1' });
      harness.fire('agent_end', {}, { sessionKey: 'session-1' });
      await flushMicrotasks();

      const rootSpan = (mlflowTracing.startSpan as jest.Mock).mock.results[0].value;
      const tokenCalls = rootSpan.setAttribute.mock.calls.filter(
        (call: unknown[]) => call[0] === 'token_usage',
      );
      expect(tokenCalls).toHaveLength(0);
    });
  });

  describe('Trace Metadata', () => {
    beforeEach(() => {
      process.env.USER = 'test-user';
    });

    it('should set trace metadata on agent_end', async () => {
      const harness = createTestHarness();
      await startService(harness);

      harness.fire('llm_input', { prompt: 'Hello', model: 'gpt-4', provider: 'openai' }, { sessionKey: 'session-1' });
      harness.fire('llm_output', { response: 'Hi there!' }, { sessionKey: 'session-1' });
      harness.fire('agent_end', {}, { sessionKey: 'session-1', userId: 'yuki' });
      await flushMicrotasks();

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(mlflowTracing.InMemoryTraceManager.getInstance).toHaveBeenCalled();
    });

    it('should set requestPreview and responsePreview', async () => {
      const harness = createTestHarness();
      await startService(harness);

      harness.fire('llm_input', { prompt: 'What is MLflow?', model: 'gpt-4', provider: 'openai' }, { sessionKey: 'session-1' });
      harness.fire('llm_output', { response: 'MLflow is a platform for ML lifecycle.' }, { sessionKey: 'session-1' });
      harness.fire('agent_end', {}, { sessionKey: 'session-1' });
      await flushMicrotasks();

      expect(mlflowTracing.flushTraces).toHaveBeenCalled();
    });
  });

  describe('Deferred Finalization', () => {
    it('should handle agent_end before llm_output via queueMicrotask', async () => {
      const harness = createTestHarness();
      await startService(harness);

      harness.fire('llm_input', { prompt: 'Hello', model: 'gpt-4', provider: 'openai' }, { sessionKey: 'session-1' });

      // agent_end fires but finalization is deferred via queueMicrotask
      harness.fire('agent_end', {}, { sessionKey: 'session-1' });

      // llm_output fires before microtask runs
      harness.fire('llm_output', { response: 'Late response' }, { sessionKey: 'session-1' });

      await flushMicrotasks();

      expect(mlflowTracing.flushTraces).toHaveBeenCalled();
    });
  });

  describe('LRU Eviction', () => {
    it('should evict oldest sessions when exceeding max active traces', async () => {
      const harness = createTestHarness();
      await startService(harness);

      // Create 51 sessions — the first should be evicted
      for (let i = 0; i < 51; i++) {
        harness.fire(
          'llm_input',
          { prompt: `Prompt ${i}`, model: 'gpt-4', provider: 'openai' },
          { sessionKey: `session-${i}` },
        );
      }

      // Should have created 51 root AGENT spans + 51 LLM spans = 102 total
      expect((mlflowTracing.startSpan as jest.Mock).mock.calls.length).toBe(102);

      // Sending an event for session-0 should create a new trace (it was evicted)
      jest.clearAllMocks();
      harness.fire(
        'llm_input',
        { prompt: 'Revived prompt', model: 'gpt-4', provider: 'openai' },
        { sessionKey: 'session-0' },
      );

      // New root AGENT + new LLM span
      expect((mlflowTracing.startSpan as jest.Mock).mock.calls.length).toBe(2);
    });
  });

  describe('Error Resilience', () => {
    it('should not throw on llm_output without prior llm_input', async () => {
      const harness = createTestHarness();
      await startService(harness);

      expect(() => {
        harness.fire('llm_output', { response: 'orphan' }, { sessionKey: 'unknown-session' });
      }).not.toThrow();
    });

    it('should not throw on tool_end without prior tool_start', async () => {
      const harness = createTestHarness();
      await startService(harness);

      harness.fire('llm_input', { prompt: 'Hi', model: 'gpt-4', provider: 'openai' }, { sessionKey: 'session-1' });

      expect(() => {
        harness.fire(
          'tool_end',
          { toolName: 'unknown', toolCallId: 'tc-unknown' },
          { sessionKey: 'session-1' },
        );
      }).not.toThrow();
    });

    it('should not throw on subagent_ended without prior subagent_spawning', async () => {
      const harness = createTestHarness();
      await startService(harness);

      harness.fire('llm_input', { prompt: 'Hi', model: 'gpt-4', provider: 'openai' }, { sessionKey: 'session-1' });

      expect(() => {
        harness.fire('subagent_ended', { agentId: 'ghost-agent' }, { sessionKey: 'session-1' });
      }).not.toThrow();
    });

    it('should not throw on agent_end without prior events', async () => {
      const harness = createTestHarness();
      await startService(harness);

      expect(() => {
        harness.fire('agent_end', {}, { sessionKey: 'nonexistent' });
      }).not.toThrow();
    });

    it('should handle tool_start without a root trace gracefully', async () => {
      const harness = createTestHarness();
      await startService(harness);

      expect(() => {
        harness.fire('tool_start', { toolName: 'search' }, { sessionKey: 'no-root' });
      }).not.toThrow();
    });
  });

  describe('Complete Agent Workflow', () => {
    it('should trace a full workflow: LLM → tool → subagent → LLM → end', async () => {
      const harness = createTestHarness();
      await startService(harness);

      const ctx = { sessionKey: 'session-1' };

      // 1. Initial LLM call
      harness.fire('llm_input', { prompt: 'Find and summarize the latest MLflow docs', model: 'gpt-4', provider: 'openai' }, ctx);
      harness.fire('llm_output', { response: 'I will search and summarize for you.' }, ctx);

      // 2. Tool call
      harness.fire('tool_start', { toolName: 'web_search', arguments: { query: 'MLflow documentation' }, toolCallId: 'tc-1' }, ctx);
      harness.fire('tool_end', { toolName: 'web_search', result: 'MLflow docs: https://mlflow.org/docs', toolCallId: 'tc-1' }, ctx);

      // 3. Subagent
      harness.fire('subagent_spawning', { agentId: 'summarizer', label: 'summary-agent' }, ctx);
      harness.fire('subagent_ended', { agentId: 'summarizer', result: 'Summary complete' }, ctx);

      // 4. Token usage
      harness.fireDiagnostic({
        type: 'model.usage',
        sessionKey: 'session-1',
        usage: { input: 500, output: 200, total: 700 },
      });

      // 5. Second LLM call with final response
      harness.fire('llm_input', { prompt: 'Find and summarize the latest MLflow docs', model: 'gpt-4', provider: 'openai' }, ctx);
      harness.fire('llm_output', { response: 'Here is your summary of MLflow docs.' }, ctx);

      // 6. End
      harness.fire('agent_end', {}, ctx);
      await flushMicrotasks();

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
    it('should handle interleaved events from different sessions', async () => {
      const harness = createTestHarness();
      await startService(harness);

      // Session A starts
      harness.fire('llm_input', { prompt: 'A prompt', model: 'gpt-4', provider: 'openai' }, { sessionKey: 'session-A' });
      // Session B starts
      harness.fire('llm_input', { prompt: 'B prompt', model: 'gpt-4', provider: 'openai' }, { sessionKey: 'session-B' });

      // Session A gets LLM output
      harness.fire('llm_output', { response: 'A response' }, { sessionKey: 'session-A' });
      // Session B gets LLM output
      harness.fire('llm_output', { response: 'B response' }, { sessionKey: 'session-B' });

      // Both end
      harness.fire('agent_end', {}, { sessionKey: 'session-A' });
      harness.fire('agent_end', {}, { sessionKey: 'session-B' });
      await flushMicrotasks();

      expect(mlflowTracing.flushTraces).toHaveBeenCalledTimes(2);
    });
  });
});
