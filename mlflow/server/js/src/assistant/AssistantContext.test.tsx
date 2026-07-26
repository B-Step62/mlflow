import { describe, it, test, expect, jest, beforeEach, afterEach } from '@jest/globals';
import { renderHook, act, cleanup, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';

import { buildStorageKey } from '@databricks/web-shared/hooks/useLocalStorage';

import {
  AssistantProvider,
  useAssistant,
  upsertToolCalls,
  applyToolResult,
  reviveMessages,
  trimForStorage,
  CHAT_STORAGE_KEY_BASE,
  CHAT_STORAGE_VERSION,
} from './AssistantContext';
import * as AssistantService from './AssistantService';
import type { SendMessageStreamCallbacks } from './AssistantService';
import { GatewayApi } from '../gateway/api';
import { MlflowService } from '../experiment-tracking/sdk/MlflowService';
import type { AssistantConfig, ProviderConfig, AssistantPart, ChatMessage } from './types';

const EMPTY_TOKEN_USAGE = { promptTokens: 0, completionTokens: 0, totalTokens: 0, costUsd: null };

const CHAT_STORAGE_KEY = buildStorageKey(CHAT_STORAGE_KEY_BASE, CHAT_STORAGE_VERSION);

const makeMessage = (overrides: Partial<ChatMessage> = {}): ChatMessage => ({
  id: 'msg-1',
  role: 'user',
  content: 'hello',
  timestamp: new Date('2026-01-01T00:00:00.000Z'),
  ...overrides,
});

jest.mock('./AssistantService', () => ({
  __esModule: true,
  sendMessageStream: jest.fn(),
  getConfig: jest.fn(),
  cancelSession: jest.fn(),
}));

jest.mock('../gateway/api', () => ({
  GatewayApi: { listEndpoints: jest.fn() },
}));

jest.mock('../experiment-tracking/sdk/MlflowService', () => ({
  MlflowService: { searchRuns: jest.fn(), getExperiment: jest.fn() },
}));

jest.mock('./AssistantPageContext', () => ({
  useAssistantPageContextActions: () => ({ getContext: () => ({}) }),
}));

const mockSendMessageStream = jest.mocked(AssistantService.sendMessageStream);
const mockGetConfig = jest.mocked(AssistantService.getConfig);
const mockListEndpoints = jest.mocked(GatewayApi.listEndpoints);
const mockSearchRuns = jest.mocked(MlflowService.searchRuns);
const mockGetExperiment = jest.mocked(MlflowService.getExperiment);

// A fake EventSource — the real one is created inside sendMessageStream, which we mock,
// so the context only ever calls .close() on what we hand back here.
let fakeEventSource: { close: jest.Mock };
// Capture the callbacks the context passes in so a test can simulate the backend streaming.
let capturedCallbacks: SendMessageStreamCallbacks | undefined;

const wrapper = ({ children }: { children: ReactNode }) => <AssistantProvider>{children}</AssistantProvider>;

// Render and flush the mount-time refreshConfig() promise so its state update lands inside act().
const renderAssistant = async () => {
  const utils = renderHook(() => useAssistant(), { wrapper });
  await act(async () => {});
  return utils;
};

beforeEach(() => {
  localStorage.clear();
  fakeEventSource = { close: jest.fn() };
  capturedCallbacks = undefined;
  mockGetConfig.mockResolvedValue({ providers: {}, projects: {} });
  mockSendMessageStream.mockImplementation(async (_req, callbacks) => {
    capturedCallbacks = callbacks;
    return { eventSource: fakeEventSource as unknown as EventSource };
  });
  mockSearchRuns.mockResolvedValue({ runs: [] });
  mockGetExperiment.mockRejectedValue(new Error('No demo tags'));
  // Control rAF so a scheduled flush stays pending until we assert on it.
  jest.spyOn(window, 'requestAnimationFrame').mockReturnValue(777 as unknown as number);
  jest.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
  jest.restoreAllMocks();
  jest.clearAllMocks();
});

describe('AssistantContext — reset() tears down the active stream', () => {
  it('closes the active EventSource when reset() is called mid-stream', async () => {
    const { result } = await renderAssistant();

    // Start a stream via the public sendMessage path (no session yet → startChat).
    await act(async () => {
      result.current.sendMessage('hello');
    });
    expect(fakeEventSource.close).not.toHaveBeenCalled();

    act(() => {
      result.current.reset();
    });

    expect(fakeEventSource.close).toHaveBeenCalledTimes(1);
  });

  it('cancels a pending animation frame when reset() is called', async () => {
    const { result } = await renderAssistant();

    await act(async () => {
      result.current.sendMessage('hello');
    });

    // Simulate a token arriving — this schedules a rAF flush (id 777).
    act(() => {
      capturedCallbacks?.onMessage('partial token');
    });
    expect(window.requestAnimationFrame).toHaveBeenCalled();

    act(() => {
      result.current.reset();
    });

    expect(window.cancelAnimationFrame).toHaveBeenCalledWith(777);
  });

  it('clears the session so the next turn starts fresh', async () => {
    const { result } = await renderAssistant();

    await act(async () => {
      result.current.sendMessage('hello');
    });
    act(() => {
      capturedCallbacks?.onSessionId?.('session-OLD');
    });
    expect(result.current.sessionId).toBe('session-OLD');

    act(() => {
      result.current.reset();
    });

    expect(result.current.sessionId).toBeNull();
    expect(result.current.messages).toHaveLength(0);
  });
});

describe('AssistantContext — reset() during the in-flight send window', () => {
  // Drive sendMessageStream with a deferred promise so reset() can run while the POST is still
  // pending — the exact window where the captured token is invalidated before the stream attaches.
  const deferSend = () => {
    let resolveSend!: (result: { eventSource: EventSource | null }) => void;
    mockSendMessageStream.mockImplementation((_req, callbacks) => {
      capturedCallbacks = callbacks;
      return new Promise((resolve) => {
        resolveSend = resolve;
      });
    });
    return { resolve: () => resolveSend({ eventSource: fakeEventSource as unknown as EventSource }) };
  };

  it('ignores a stale onSessionId fired after reset() (no session revival)', async () => {
    const { result } = await renderAssistant();
    deferSend();

    // Start the send but leave the POST pending (do not await it).
    act(() => {
      result.current.sendMessage('hello');
    });

    act(() => {
      result.current.reset();
    });

    // The backend reply lands after reset — the guarded callback must no-op.
    act(() => {
      capturedCallbacks?.onSessionId?.('session-OLD');
    });

    expect(result.current.sessionId).toBeNull();
  });

  it('closes the late-resolved EventSource instead of storing it', async () => {
    const { result } = await renderAssistant();
    const send = deferSend();

    act(() => {
      result.current.sendMessage('hello');
    });
    act(() => {
      result.current.reset();
    });

    // POST resolves after reset: the post-await guard closes the orphaned stream.
    await act(async () => {
      send.resolve();
    });
    expect(fakeEventSource.close).toHaveBeenCalledTimes(1);

    // A second reset() must not close it again — proving it was never stored in eventSourceRef.
    act(() => {
      result.current.reset();
    });
    expect(fakeEventSource.close).toHaveBeenCalledTimes(1);
  });

  it('closes a regenerate stream orphaned by reset() during its in-flight window', async () => {
    const { result } = await renderAssistant();

    // Seed a completed turn so regenerateLastMessage has a user message to replay.
    const firstSend = deferSend();
    act(() => {
      result.current.sendMessage('hello');
    });
    await act(async () => {
      firstSend.resolve();
    });
    act(() => {
      capturedCallbacks?.onSessionId?.('session-1');
      capturedCallbacks?.onDone();
    });
    expect(result.current.isStreaming).toBe(false);
    fakeEventSource.close.mockClear();

    // Regenerate, but leave its POST pending, then reset before it attaches.
    const regen = deferSend();
    act(() => {
      result.current.regenerateLastMessage();
    });
    act(() => {
      result.current.reset();
    });

    await act(async () => {
      regen.resolve();
    });

    // The orphaned regenerate stream is closed by the guard, and the session stays cleared.
    expect(fakeEventSource.close).toHaveBeenCalledTimes(1);
    expect(result.current.sessionId).toBeNull();
  });
});

describe('AssistantContext — pendingPrompt seed', () => {
  it('prefillPrompt sets pendingPrompt and clearPendingPrompt nulls it', async () => {
    const { result } = await renderAssistant();
    expect(result.current.pendingPrompt).toBeNull();

    act(() => {
      result.current.prefillPrompt('SEED');
    });
    expect(result.current.pendingPrompt).toBe('SEED');

    act(() => {
      result.current.clearPendingPrompt();
    });
    expect(result.current.pendingPrompt).toBeNull();
  });

  it('closePanel clears a queued pendingPrompt (abandon ⇒ no stale inject later)', async () => {
    const { result } = await renderAssistant();

    act(() => {
      result.current.prefillPrompt('SEED');
    });
    expect(result.current.pendingPrompt).toBe('SEED');

    act(() => {
      result.current.closePanel();
    });
    expect(result.current.pendingPrompt).toBeNull();
  });

  // completing setup must NOT drop a queued prompt, so it can be
  // consumed once the chat input appears post-setup.
  it('keeps pendingPrompt across completeSetup() (seed survives the setup wizard)', async () => {
    const { result } = await renderAssistant();

    act(() => {
      result.current.prefillPrompt('SEED');
    });
    expect(result.current.pendingPrompt).toBe('SEED');

    // completeSetup() re-fetches config; mirror a finished wizard where a provider is selected
    // so setupComplete stays true after the refresh lands.
    mockGetConfig.mockResolvedValue({
      providers: { anthropic: { model: 'm', selected: true, permissions: {} } },
      projects: {},
    } as unknown as Awaited<ReturnType<typeof AssistantService.getConfig>>);

    await act(async () => {
      result.current.completeSetup();
    });

    expect(result.current.setupComplete).toBe(true);
    expect(result.current.pendingPrompt).toBe('SEED');
  });
});

describe('AssistantContext — mock evaluation flow', () => {
  const advanceMockStream = async (ms: number) => {
    await act(async () => {
      jest.advanceTimersByTime(ms);
      await Promise.resolve();
    });
  };

  it('streams mocked issue detection progress and links to the issues tab', async () => {
    jest.useFakeTimers();
    const onComplete = jest.fn();

    const { result } = await renderAssistant();

    act(() => {
      result.current.startMockIssueDetection({
        experimentId: 'experiment-123',
        jobId: 'job-1',
        runId: 'run-1',
        traceCount: 205,
        issueCount: 5,
        onComplete,
      });
    });

    expect(result.current.isPanelOpen).toBe(true);
    expect(result.current.setupComplete).toBe(true);
    expect(mockSendMessageStream).not.toHaveBeenCalled();

    await advanceMockStream(10000);

    const latestMessage = result.current.messages[result.current.messages.length - 1];
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(latestMessage.content).toContain('run issue detection across 205 traces');
    expect(latestMessage.content).toContain('keep this thread updated');
    expect(latestMessage.content).toContain('found 5 recurring failure modes');
    expect(latestMessage.parts).toContainEqual(
      expect.objectContaining({
        type: 'toolCall',
        name: 'check_llm_connection',
        status: 'done',
      }),
    );
    expect(latestMessage.parts).toContainEqual(
      expect.objectContaining({
        type: 'toolCall',
        name: 'run_issue_detection',
        status: 'done',
      }),
    );
    expect(latestMessage.parts).toContainEqual(
      expect.objectContaining({
        type: 'linkAction',
        label: 'View issues',
        href: '/#/experiments/experiment-123/issues',
        navigateInline: true,
      }),
    );
    expect(latestMessage.parts).toContainEqual(
      expect.objectContaining({
        type: 'promptAction',
        label: 'Set up eval',
        prompt: 'Set up eval',
        href: '/#/experiments/experiment-123/issues',
      }),
    );

    act(() => {
      result.current.sendMessage('Set up eval');
    });

    await advanceMockStream(650);

    const scopeMessage = result.current.messages[result.current.messages.length - 1];
    expect(scopeMessage.content).toContain('Which issues should I set up evals for');
    expect(scopeMessage.parts).toContainEqual(
      expect.objectContaining({
        type: 'selectionPrompt',
        title: 'Set up eval for which issues?',
        options: expect.arrayContaining([
          expect.objectContaining({ value: 'all', label: 'All issues' }),
          expect.objectContaining({ value: 'subset', label: 'Subset' }),
        ]),
      }),
    );

    act(() => {
      result.current.sendMessage('Set up eval for a subset');
    });

    await advanceMockStream(1750);

    expect(result.current.messages[result.current.messages.length - 1].parts).toContainEqual(
      expect.objectContaining({
        type: 'selectionPrompt',
        title: 'Where should I put these examples?',
      }),
    );

    act(() => {
      result.current.sendMessage('Create new dataset');
    });

    await advanceMockStream(4450);

    const createdEvalMessage = result.current.messages[result.current.messages.length - 1];
    expect(createdEvalMessage.parts).toContainEqual(
      expect.objectContaining({
        type: 'linkAction',
        label: 'Open issue with linked items',
        href: '/#/experiments/experiment-123/issues?selectedIssueId=iss-wrong-asset-class',
      }),
    );
    expect(createdEvalMessage.parts).toContainEqual(
      expect.objectContaining({
        type: 'selectionPrompt',
        title: 'Do you want to run evaluation now?',
      }),
    );
  });

  it('links to the latest evaluation run returned by searchRuns', async () => {
    jest.useFakeTimers();
    mockSearchRuns.mockResolvedValue({
      runs: [
        {
          info: { runUuid: 'real-evaluation-run-1' },
        },
      ],
    } as any);

    const { result } = await renderAssistant();

    act(() => {
      result.current.startMockEvalSetup({
        issueId: 'issue-1',
        issueName: 'Answer quality regression',
        experimentId: 'experiment-123',
        traceCount: 2,
        traceIds: ['trace-1', 'trace-2'],
        datasetName: 'answer-quality-regression',
        scorerNames: ['answer_quality_judge', 'retrieval_judge'],
      });
    });

    await advanceMockStream(1750);

    act(() => {
      result.current.sendMessage('Create new dataset');
    });

    await advanceMockStream(4450);

    act(() => {
      result.current.sendMessage('Run evaluation');
    });

    await advanceMockStream(2250);

    expect(mockSearchRuns).toHaveBeenCalledWith(
      expect.objectContaining({
        experiment_ids: ['experiment-123'],
        order_by: ['attributes.start_time DESC'],
        run_view_type: 'ACTIVE_ONLY',
        filter: "tags.`mlflow.runType` = 'genai_evaluate'",
        max_results: 1,
      }),
    );

    const latestMessage = result.current.messages[result.current.messages.length - 1];
    const linkAction = latestMessage.parts?.find((part) => part.type === 'linkAction');
    const promptAction = latestMessage.parts?.find((part) => part.type === 'promptAction');
    expect(linkAction).toEqual(
      expect.objectContaining({
        label: 'Open evaluation result',
        href: expect.stringContaining(
          '/experiments/experiment-123/evaluation-runs?selectedRunUuid=real-evaluation-run-1',
        ),
      }),
    );
    expect(promptAction).toEqual(
      expect.objectContaining({
        label: 'Analyze result',
        prompt: 'Analyze result',
      }),
    );

    act(() => {
      result.current.sendMessage('Analyze result');
    });

    await advanceMockStream(1900);

    const analysisMessage = result.current.messages[result.current.messages.length - 1];
    expect(analysisMessage.content).toContain('too permissive');
    expect(analysisMessage.parts).toContainEqual(
      expect.objectContaining({
        type: 'selectionPrompt',
        title: 'Do you want me to fine-tune the judge so it aligns with human judgement?',
      }),
    );
  });

  it('recommends creating a new dataset even when a golden dataset exists', async () => {
    jest.useFakeTimers();

    const { result } = await renderAssistant();

    act(() => {
      result.current.startMockEvalSetup({
        issueId: 'issue-golden',
        issueName: 'Answer quality regression',
        experimentId: 'experiment-123',
        traceCount: 2,
        traceIds: ['trace-1', 'trace-2'],
        datasetName: 'answer-quality-regression',
        scorerNames: ['answer_quality_judge', 'retrieval_judge'],
        goldenDatasetName: 'customer-support-golden',
        goldenDatasetRecordCount: 120,
      });
    });

    await advanceMockStream(1750);

    const promptMessage = result.current.messages[result.current.messages.length - 1];
    const selectionPrompt = promptMessage.parts?.find(
      (part): part is Extract<AssistantPart, { type: 'selectionPrompt' }> => part.type === 'selectionPrompt',
    );
    const newDatasetOption = selectionPrompt?.options.find((option) => option.value === 'new');
    const goldenDatasetOption = selectionPrompt?.options.find((option) => option.value === 'golden');
    expect(selectionPrompt).toEqual(
      expect.objectContaining({
        title: 'Where should I put these examples?',
        defaultValue: 'new',
      }),
    );
    expect(selectionPrompt?.options[0]).toEqual(
      expect.objectContaining({ value: 'new', label: 'Create new dataset', recommended: true }),
    );
    expect(newDatasetOption).toEqual(
      expect.objectContaining({ value: 'new', label: 'Create new dataset', recommended: true }),
    );
    expect(goldenDatasetOption).toEqual(
      expect.not.objectContaining({ value: 'golden', label: 'Add to existing dataset', recommended: true }),
    );
  });

  it('continues from judge alignment to fix and opens a baseline-vs-fixed comparison', async () => {
    jest.useFakeTimers();
    mockGetConfig.mockResolvedValue(
      config({ codex: providerConfig({ model: 'default', selected: true }) }) as Awaited<
        ReturnType<typeof AssistantService.getConfig>
      >,
    );
    mockGetExperiment.mockResolvedValue({
      experiment: {
        tags: [
          { key: 'mlflow.issueCujDemo.initialEvalRunId', value: 'baseline-evaluation-run' },
          { key: 'mlflow.issueCujDemo.alignedEvalRunId', value: 'aligned-evaluation-run' },
          { key: 'mlflow.issueCujDemo.fixedEvalRunId', value: 'fixed-evaluation-run' },
        ],
      },
    } as any);

    const { result } = await renderAssistant();

    act(() => {
      result.current.startMockEvalSetup({
        issueId: 'issue-2',
        issueName: 'Unsupported claims regression',
        experimentId: 'experiment-123',
        traceCount: 3,
        traceIds: ['trace-1', 'trace-2', 'trace-3'],
        datasetName: 'unsupported-claims-regression',
        scorerNames: ['groundedness_judge', 'retrieval_judge'],
      });
    });

    await advanceMockStream(1750);

    act(() => {
      result.current.sendMessage('Create new dataset');
    });

    await advanceMockStream(4450);

    act(() => {
      result.current.sendMessage('Run evaluation');
    });

    await advanceMockStream(2250);

    act(() => {
      result.current.sendMessage('Analyze result');
    });

    await advanceMockStream(1900);

    act(() => {
      result.current.sendMessage('Yes, align the judge');
    });

    await advanceMockStream(2850);

    const alignmentMessage = result.current.messages[result.current.messages.length - 1];
    expect(alignmentMessage.content).toContain('Once you aligned the judge');
    expect(alignmentMessage.parts).toContainEqual(
      expect.objectContaining({
        type: 'linkAction',
        label: 'Open judge alignment console',
        href: expect.stringContaining(
          '/#/experiments/experiment-123/judges/alignment?scorerName=groundedness_judge&prefill=eval',
        ),
      }),
    );
    expect(alignmentMessage.parts).toContainEqual(
      expect.objectContaining({
        type: 'promptAction',
        label: 'Re-run evaluation',
        prompt: 'Re-run evaluation',
      }),
    );

    act(() => {
      result.current.sendMessage('Re-run evaluation');
    });

    await advanceMockStream(2200);

    const fixMessage = result.current.messages[result.current.messages.length - 1];
    expect(fixMessage.content).toContain('Suggested fixes');
    expect(fixMessage.parts).toContainEqual(
      expect.objectContaining({
        type: 'promptAction',
        label: 'Fix it',
        prompt: 'Fix it',
      }),
    );

    act(() => {
      result.current.sendMessage('Fix it');
    });

    await advanceMockStream(1800);

    const runAgainPromptMessage = result.current.messages[result.current.messages.length - 1];
    expect(runAgainPromptMessage.parts).toContainEqual(
      expect.objectContaining({
        type: 'selectionPrompt',
        title: 'Run evaluation again with new traces?',
      }),
    );

    act(() => {
      result.current.sendMessage('Yes, run evaluation again');
    });

    await advanceMockStream(1850);

    const comparisonMessage = result.current.messages[result.current.messages.length - 1];
    expect(comparisonMessage.content).toContain('failures dropped from 11 to 2');
    expect(comparisonMessage.content).toContain('setting up production monitoring');
    expect(comparisonMessage.parts).toContainEqual(
      expect.objectContaining({
        type: 'evalComparisonSummary',
        title: 'Evaluation comparison summary',
      }),
    );
    expect(comparisonMessage.parts).toContainEqual(
      expect.objectContaining({
        type: 'linkAction',
        label: 'Open comparison view',
        href: expect.stringContaining(
          '/experiments/experiment-123/evaluation-runs?selectedRunUuid=fixed-evaluation-run&compareToRunUuid=baseline-evaluation-run',
        ),
      }),
    );
    expect(comparisonMessage.parts).toContainEqual(
      expect.objectContaining({
        type: 'promptAction',
        label: 'Setup production monitoring',
        prompt: 'Setup production monitoring',
      }),
    );

    act(() => {
      result.current.sendMessage('Setup production monitoring');
    });

    await advanceMockStream(650);

    act(() => {
      result.current.sendMessage('Use 5% trace sample');
    });

    await advanceMockStream(650);

    act(() => {
      result.current.sendMessage('Yes, add alert');
    });

    await advanceMockStream(650);

    act(() => {
      result.current.sendMessage('Alert when failure rate is above 5% for 15 minutes');
    });

    await advanceMockStream(2100);

    const monitoringMessage = result.current.messages[result.current.messages.length - 1];
    expect(monitoringMessage.content).toContain('Monitor is ready');
    expect(monitoringMessage.parts).toContainEqual(
      expect.objectContaining({
        type: 'toolCall',
        name: 'configure_online_judges',
        status: 'done',
      }),
    );
  });

  it('continues a persisted mock eval conversation without contacting the backend', async () => {
    jest.useFakeTimers();
    localStorage.setItem(
      CHAT_STORAGE_KEY,
      JSON.stringify({
        messages: [
          makeMessage({
            id: 'restored-assistant-message',
            role: 'assistant',
            content: 'Open evaluation result',
          }),
        ],
        tokenUsage: EMPTY_TOKEN_USAGE,
        mockState: {
          lastMockEvalSetup: {
            request: {
              issueId: 'issue-persisted',
              issueName: 'Cites the wrong asset class',
              experimentId: 'experiment-123',
              traceCount: 3,
              traceIds: ['trace-1', 'trace-2', 'trace-3'],
              datasetName: 'wrong_asset_class_regression',
              scorerNames: ['asset_class_consistency', 'retrieval_answer_alignment'],
            },
            traceCount: 3,
            traceSummary: '3 traces',
            primaryScorer: 'asset_class_consistency',
            secondaryScorer: 'retrieval_answer_alignment',
            datasetChoice: 'new',
          },
        },
      }),
    );

    const { result } = await renderAssistant();

    act(() => {
      result.current.sendMessage('Analyze result');
    });

    await advanceMockStream(1900);

    expect(mockSendMessageStream).not.toHaveBeenCalled();
    const analysisMessage = result.current.messages[result.current.messages.length - 1];
    expect(analysisMessage.content).toContain('asset_class_consistency');
    expect(analysisMessage.content).toContain('too permissive');
    expect(analysisMessage.parts).toContainEqual(
      expect.objectContaining({
        type: 'selectionPrompt',
        title: 'Do you want me to fine-tune the judge so it aligns with human judgement?',
      }),
    );
  });

  it('nudges production monitoring before resolving an issue that already has eval', async () => {
    jest.useFakeTimers();
    const onStart = jest.fn();
    const onComplete = jest.fn();
    const onResolve = jest.fn();

    const { result } = await renderAssistant();

    act(() => {
      result.current.startMockProductionMonitoringNudge({
        issueId: 'issue-3',
        issueName: 'Unsupported claims regression',
        experimentId: 'experiment-123',
        datasetName: 'unsupported-claims-regression',
        scorerNames: ['groundedness_judge'],
        samplingRatio: 0.05,
        onStart,
        onComplete,
        onResolve,
      });
    });

    await advanceMockStream(600);

    const nudgeMessage = result.current.messages[result.current.messages.length - 1];
    expect(nudgeMessage.content).toContain('production monitoring is not enabled yet');
    expect(nudgeMessage.parts).toContainEqual(
      expect.objectContaining({
        type: 'selectionPrompt',
        title: 'Set up production monitoring before resolving?',
      }),
    );

    act(() => {
      result.current.sendMessage('Setup production monitoring');
    });

    await advanceMockStream(650);

    expect(result.current.messages[result.current.messages.length - 1].content).toContain(
      'choose the production trace sample rate',
    );

    act(() => {
      result.current.sendMessage('Use 5% trace sample');
    });

    await advanceMockStream(650);

    expect(result.current.messages[result.current.messages.length - 1].content).toContain('Do you want an alert too?');

    act(() => {
      result.current.sendMessage('Yes, add alert');
    });

    await advanceMockStream(650);

    expect(result.current.messages[result.current.messages.length - 1].content).toContain(
      'What alerting criteria should I use',
    );

    act(() => {
      result.current.sendMessage('Alert when failure rate is above 5% for 15 minutes');
    });

    await advanceMockStream(2100);

    expect(onStart).toHaveBeenCalledTimes(1);
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onResolve).toHaveBeenCalledTimes(1);
    expect(result.current.messages[result.current.messages.length - 1].content).toContain('Monitor is ready');
    expect(result.current.messages[result.current.messages.length - 1].parts).toContainEqual(
      expect.objectContaining({
        type: 'linkAction',
        label: 'Go to dashboard',
        href: '/#/experiments/experiment-123/dashboard/quality',
      }),
    );
  });
});

describe('upsertToolCalls', () => {
  test('appends a new tool call with running status', () => {
    const result = upsertToolCalls([], [{ id: 't1', name: 'Bash', input: { command: 'ls' } }]);
    expect(result).toEqual([
      { type: 'toolCall', toolUseId: 't1', name: 'Bash', input: { command: 'ls' }, status: 'running' },
    ]);
  });

  test('keeps a tool call after any text part', () => {
    const parts: AssistantPart[] = [{ type: 'text', text: 'working' }];
    const result = upsertToolCalls(parts, [{ id: 't1', name: 'Bash', input: {} }]);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ type: 'text', text: 'working' });
    expect(result[1]).toMatchObject({ type: 'toolCall', toolUseId: 't1', status: 'running' });
  });

  test('re-upserting an existing call does not clobber a resolved status/result', () => {
    const parts: AssistantPart[] = [
      { type: 'toolCall', toolUseId: 't1', name: 'Bash', input: { command: 'ls' }, status: 'done', result: 'out' },
    ];
    const result = upsertToolCalls(parts, [{ id: 't1', name: 'Bash', input: { command: 'ls -a' } }]);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ status: 'done', result: 'out', input: { command: 'ls -a' } });
  });
});

describe('applyToolResult', () => {
  const parts: AssistantPart[] = [
    { type: 'text', text: 'let me check' },
    { type: 'toolCall', toolUseId: 't1', name: 'Bash', input: { command: 'ls' }, status: 'running' },
  ];

  test('resolves the matching tool call to done with its result', () => {
    const result = applyToolResult(parts, { toolUseId: 't1', content: 'output', isError: false });
    expect(result[1]).toMatchObject({ toolUseId: 't1', status: 'done', result: 'output' });
    expect(result[0]).toEqual({ type: 'text', text: 'let me check' });
  });

  test('marks the tool call as error when isError is true', () => {
    const result = applyToolResult(parts, { toolUseId: 't1', content: 'boom', isError: true });
    expect(result[1]).toMatchObject({ status: 'error', result: 'boom' });
  });

  test('leaves parts untouched when no toolUseId matches', () => {
    const result = applyToolResult(parts, { toolUseId: 'other', content: 'x', isError: false });
    expect(result).toEqual(parts);
  });
});

const providerConfig = (overrides: Partial<ProviderConfig>): ProviderConfig => ({
  model: 'default',
  selected: false,
  permissions: { allow_edit_files: true, allow_read_docs: true, full_access: false },
  ...overrides,
});

const config = (providers: AssistantConfig['providers']): AssistantConfig => ({
  providers,
  projects: {},
});

describe('AssistantProvider setup completeness', () => {
  const renderAndWaitForConfig = async () => {
    const { result } = renderHook(() => useAssistant(), { wrapper: AssistantProvider });
    await waitFor(() => expect(result.current.isLoadingConfig).toBe(false));
    return result;
  };

  beforeEach(() => {
    mockGetConfig.mockReset();
    mockListEndpoints.mockReset();
  });

  test('gateway selected but no endpoints exist => setup incomplete', async () => {
    mockGetConfig.mockResolvedValue(config({ mlflow_gateway: providerConfig({ model: 'assistant', selected: true }) }));
    mockListEndpoints.mockResolvedValue({ endpoints: [] });

    const result = await renderAndWaitForConfig();

    expect(result.current.setupComplete).toBe(false);
  });

  test('gateway selected but configured endpoint is missing from the list => setup incomplete', async () => {
    mockGetConfig.mockResolvedValue(config({ mlflow_gateway: providerConfig({ model: 'assistant', selected: true }) }));
    mockListEndpoints.mockResolvedValue({ endpoints: [{ name: 'some-other-endpoint' }] as any });

    const result = await renderAndWaitForConfig();

    expect(result.current.setupComplete).toBe(false);
  });

  test('gateway selected and configured endpoint exists => setup complete', async () => {
    mockGetConfig.mockResolvedValue(config({ mlflow_gateway: providerConfig({ model: 'assistant', selected: true }) }));
    mockListEndpoints.mockResolvedValue({ endpoints: [{ name: 'assistant' }] as any });

    const result = await renderAndWaitForConfig();

    expect(result.current.setupComplete).toBe(true);
    expect(mockListEndpoints).toHaveBeenCalled();
  });

  test('non-gateway provider selected => setup complete without querying gateway endpoints', async () => {
    mockGetConfig.mockResolvedValue(config({ claude_code: providerConfig({ model: 'default', selected: true }) }));

    const result = await renderAndWaitForConfig();

    expect(result.current.setupComplete).toBe(true);
    expect(mockListEndpoints).not.toHaveBeenCalled();
  });
});

describe('AssistantContext — a new message supersedes a pending permission prompt', () => {
  // The pause path surfaces the request and closes the stream WITHOUT a done event,
  // so the Allow/Deny prompt is left showing.
  const pausePrompt = () => {
    capturedCallbacks?.onPermissionRequest?.({
      sessionId: 'session-1',
      requestId: 'req-1',
      toolName: 'bash',
      toolInput: { command: 'ls' },
    });
  };

  it('clears pendingPermission on the cold-start path (startChat, no session yet)', async () => {
    const { result } = await renderAssistant();

    await act(async () => {
      result.current.sendMessage('run the tool');
    });
    act(pausePrompt);
    expect(result.current.pendingPermission).not.toBeNull();

    // No session was established, so this send falls through to startChat.
    await act(async () => {
      result.current.sendMessage('never mind, what is 2+2');
    });

    expect(result.current.pendingPermission).toBeNull();
  });

  it('clears pendingPermission on the established-session path (handleSendMessage)', async () => {
    const { result } = await renderAssistant();

    await act(async () => {
      result.current.sendMessage('run the tool');
    });

    // The first turn returns a session id, so subsequent sends route through
    // handleSendMessage's own branch rather than startChat. Then the turn pauses.
    act(() => {
      capturedCallbacks?.onSessionId?.('session-1');
      pausePrompt();
    });
    expect(result.current.sessionId).toBe('session-1');
    expect(result.current.pendingPermission).not.toBeNull();

    // This send exercises handleSendMessage (sessionId is set); the stale prompt must clear.
    await act(async () => {
      result.current.sendMessage('never mind, what is 2+2');
    });

    expect(result.current.pendingPermission).toBeNull();
  });
});

describe('reviveMessages', () => {
  it('restores a JSON-stringified timestamp back to a Date', () => {
    const serialized = JSON.parse(JSON.stringify([makeMessage()])) as ChatMessage[];
    expect(typeof serialized[0].timestamp).toBe('string');

    const revived = reviveMessages(serialized);

    expect(revived[0].timestamp).toBeInstanceOf(Date);
    expect(revived[0].timestamp.toISOString()).toBe('2026-01-01T00:00:00.000Z');
  });

  it('preserves all other message fields', () => {
    const revived = reviveMessages([
      makeMessage({ id: 'msg-9', role: 'assistant', content: 'hi', isInterrupted: true }),
    ]);
    expect(revived[0]).toMatchObject({ id: 'msg-9', role: 'assistant', content: 'hi', isInterrupted: true });
  });

  it('returns an empty array unchanged', () => {
    expect(reviveMessages([])).toEqual([]);
  });
});

describe('trimForStorage', () => {
  it('returns the transcript unchanged when under the byte budget', () => {
    const messages = [makeMessage({ id: 'a' }), makeMessage({ id: 'b' })];
    expect(trimForStorage(messages, 1_000_000)).toEqual(messages);
  });

  it('drops the oldest messages until under the byte budget', () => {
    const messages = [
      makeMessage({ id: 'a', content: 'x'.repeat(200) }),
      makeMessage({ id: 'b', content: 'x'.repeat(200) }),
      makeMessage({ id: 'c', content: 'x'.repeat(200) }),
    ];

    const trimmed = trimForStorage(messages, 500);

    expect(trimmed.length).toBeLessThan(messages.length);
    // The newest message is always kept; the oldest is dropped first.
    expect(trimmed[trimmed.length - 1].id).toBe('c');
    expect(trimmed.map((m) => m.id)).not.toContain('a');
  });

  it('never drops the last remaining message even if it exceeds the budget', () => {
    const messages = [makeMessage({ id: 'only', content: 'x'.repeat(1000) })];
    expect(trimForStorage(messages, 10)).toEqual(messages);
  });

  it('keeps as many recent messages as fit the byte budget', () => {
    const messages = [makeMessage({ id: 'm1' }), makeMessage({ id: 'm2' }), makeMessage({ id: 'm3' })];
    // trimForStorage tracks a running size that ignores separator commas, so it can over-count by up
    // to one char per dropped message; give the budget that headroom so the last two still fit.
    const budgetForLastTwo = JSON.stringify(messages.slice(1)).length + messages.length;
    const trimmed = trimForStorage(messages, budgetForLastTwo);
    expect(trimmed.map((m) => m.id)).toEqual(['m2', 'm3']);
  });
});

describe('AssistantContext — localStorage chat persistence', () => {
  it('restores messages from localStorage on mount', async () => {
    localStorage.setItem(
      CHAT_STORAGE_KEY,
      JSON.stringify({
        messages: [makeMessage({ id: 'restored', content: 'from storage' })],
        tokenUsage: EMPTY_TOKEN_USAGE,
      }),
    );

    const { result } = await renderAssistant();

    expect(result.current.messages).toHaveLength(1);
    expect(result.current.messages[0]).toMatchObject({ id: 'restored', content: 'from storage' });
    // timestamp must be revived to a Date, not left as a string.
    expect(result.current.messages[0].timestamp).toBeInstanceOf(Date);
  });

  it('persists a sent message to localStorage once streaming settles', async () => {
    const { result } = await renderAssistant();

    await act(async () => {
      result.current.sendMessage('persist me');
    });
    // Finish the stream so the persistence effect runs on the settled state.
    await act(async () => {
      capturedCallbacks?.onDone();
    });

    const stored = JSON.parse(localStorage.getItem(CHAT_STORAGE_KEY) ?? '{}');
    expect(stored.messages.some((m: ChatMessage) => m.content === 'persist me')).toBe(true);
  });

  it('clears persisted messages when reset() is called', async () => {
    // Seed a non-empty tokenUsage so the assertion below actually exercises the reset
    // path rather than passing vacuously against a pre-zeroed value.
    localStorage.setItem(
      CHAT_STORAGE_KEY,
      JSON.stringify({
        messages: [makeMessage({ id: 'restored' })],
        tokenUsage: { ...EMPTY_TOKEN_USAGE, promptTokens: 40, completionTokens: 60, totalTokens: 100 },
      }),
    );

    const { result } = await renderAssistant();
    expect(result.current.messages).toHaveLength(1);
    expect(result.current.tokenUsage.totalTokens).toBe(100);

    act(() => {
      result.current.reset();
    });

    expect(result.current.messages).toHaveLength(0);
    const stored = JSON.parse(localStorage.getItem(CHAT_STORAGE_KEY) ?? '{}');
    expect(stored.messages).toEqual([]);
    expect(stored.tokenUsage).toEqual(EMPTY_TOKEN_USAGE);
  });

  it('persists the interrupted turn when a stream is cancelled mid-stream', async () => {
    // Capture the scheduled rAF flush so a streamed token actually lands in the
    // assistant message before we cancel (the mount mock no-ops rAF otherwise).
    let rafFlush: FrameRequestCallback | undefined;
    jest.mocked(window.requestAnimationFrame).mockImplementation((cb: FrameRequestCallback) => {
      rafFlush = cb;
      return 777 as unknown as number;
    });

    // handleCancelSession fires the backend cancel API and .catch()es it; give it a resolved promise.
    jest.mocked(AssistantService.cancelSession).mockResolvedValue({ message: 'cancelled' });

    const { result } = await renderAssistant();

    await act(async () => {
      result.current.sendMessage('cancel me');
    });
    // cancelSession guards on a known sessionId, so the backend must report one first.
    act(() => {
      capturedCallbacks?.onSessionId?.('session-cancel');
    });
    // Deliver a partial token and flush it so the assistant message has real content.
    act(() => {
      capturedCallbacks?.onMessage('partial answer');
      rafFlush?.(0);
    });

    act(() => {
      result.current.cancelSession();
    });

    const stored = JSON.parse(localStorage.getItem(CHAT_STORAGE_KEY) ?? '{}');
    expect(stored.messages.some((m: ChatMessage) => m.content === 'cancel me')).toBe(true);
    const interrupted = stored.messages.find((m: ChatMessage) => m.role === 'assistant');
    expect(interrupted).toMatchObject({ isInterrupted: true, content: 'partial answer' });
  });

  it('does not write the in-flight turn to localStorage while streaming', async () => {
    const { result } = await renderAssistant();

    await act(async () => {
      result.current.sendMessage('still streaming');
    });
    // Establish a session and stream a token, but never settle the turn.
    act(() => {
      capturedCallbacks?.onSessionId?.('session-inflight');
      capturedCallbacks?.onMessage('partial answer');
    });

    // The mount effect may have written an empty transcript; the in-flight user
    // message must not be persisted while isStreaming is still true.
    const stored = JSON.parse(localStorage.getItem(CHAT_STORAGE_KEY) ?? '{"messages":[]}');
    expect(stored.messages.some((m: ChatMessage) => m.content === 'still streaming')).toBe(false);
    expect(result.current.isStreaming).toBe(true);
  });
});

describe('AssistantContext — buffered text survives a tool call', () => {
  it('commits unflushed streamed text as a text part before the tool call', async () => {
    // renderAssistant's rAF mock no-ops, so the streamed token stays buffered in the ref and is
    // never flushed before the tool call arrives. addToolCalls must snapshot that buffer
    // synchronously — reading the ref inside the deferred setMessages updater (after the clear)
    // would drop the text.
    const { result } = await renderAssistant();

    await act(async () => {
      result.current.sendMessage('go');
    });
    act(() => {
      capturedCallbacks?.onSessionId?.('session-tool');
      capturedCallbacks?.onMessage('Looking into it. ');
      capturedCallbacks?.onToolUse?.([{ id: 'tool-1', name: 'Bash', input: { command: 'ls' } }]);
    });

    const assistant = result.current.messages.find((m) => m.role === 'assistant');
    expect(assistant?.parts).toEqual([
      { type: 'text', text: 'Looking into it. ' },
      expect.objectContaining({ type: 'toolCall', toolUseId: 'tool-1', name: 'Bash' }),
    ]);
  });
});
