/**
 * React Context for Assistant Agent.
 * Provides Assistant functionality accessible from anywhere in MLflow.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import {
  ToolCallStatus,
  type AssistantAgentContextType,
  type AssistantEvalComparisonChartPoint,
  type AssistantEvalComparisonMetric,
  type AssistantConfig,
  type AssistantPart,
  type AssistantSelectionPromptOption,
  type ChatMessage,
  type MockEvalSetupRequest,
  type MockProductionMonitoringRequest,
  type PermissionRequest,
  type ToolUseInfo,
  type ToolResultInfo,
  type TokenUsage,
} from './types';
import {
  cancelSession as cancelSessionApi,
  sendMessageStream,
  getConfig,
  resumeStream,
  type SendMessageStreamCallbacks,
  type SendMessageStreamResult,
} from './AssistantService';
import { useLocalStorage } from '@databricks/web-shared/hooks';
import { useAssistantPageContextActions } from './AssistantPageContext';
import { GatewayApi } from '../gateway/api';
import { GATEWAY_PROVIDER_ID } from './constants';
import Routes from '../experiment-tracking/routes';
import {
  ExperimentPageTabName,
  MLFLOW_RUN_TYPE_TAG,
  MLFLOW_RUN_TYPE_VALUE_EVALUATION,
  MLFLOW_RUN_TYPE_VALUE_GENAI_EVALUATE,
} from '../experiment-tracking/constants';
import { MlflowService } from '../experiment-tracking/sdk/MlflowService';
import { COMPARE_TO_RUN_UUID_QUERY_PARAM } from '../experiment-tracking/components/evaluations/hooks/useCompareToRunUuid';
import { SELECTED_RUN_UUID_QUERY_PARAM } from '../experiment-tracking/components/evaluations/hooks/useSelectedRunUuid';

const AssistantReactContext = createContext<AssistantAgentContextType | null>(null);

// Cap the persisted transcript by JSON string length (UTF-16 code units — what localStorage counts),
// keeping it well under the ~5 MB localStorage limit.
const MAX_PERSISTED_CHARS = 1_500_000;

// Exported as base + version (not a precomputed key) so this module does no work at import time:
// `useLocalStorage` builds the full key from these, and tests build it via `buildStorageKey`.
// A top-level `buildStorageKey()` call here would run whenever the module is loaded — including
// transitively in unrelated suites — and throw under any mock that stubs the hooks module.
export const CHAT_STORAGE_KEY_BASE = 'mlflow.assistant.chat';
export const CHAT_STORAGE_VERSION = 1;

const EMPTY_TOKEN_USAGE: TokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0, costUsd: null };

interface PersistedChat {
  messages: ChatMessage[];
  tokenUsage: TokenUsage;
}

type MockEvalDatasetChoice = 'new' | 'golden';

const EVALUATION_RUN_TYPE_VALUES = [MLFLOW_RUN_TYPE_VALUE_GENAI_EVALUATE, MLFLOW_RUN_TYPE_VALUE_EVALUATION];
const DIRECT_FIX_PROVIDER_IDS = new Set(['claude_code', 'codex']);
const MOCK_PRODUCTION_MONITORING_SAMPLING_RATIO = 0.05;

const getLatestEvaluationRunIds = async (experimentId: string, maxResults: number): Promise<string[]> => {
  const runIds: string[] = [];
  const seenRunIds = new Set<string>();
  for (const runType of EVALUATION_RUN_TYPE_VALUES) {
    try {
      const response = await MlflowService.searchRuns({
        experiment_ids: [experimentId],
        order_by: ['attributes.start_time DESC'],
        run_view_type: 'ACTIVE_ONLY',
        filter: `tags.\`${MLFLOW_RUN_TYPE_TAG}\` = '${runType}'`,
        max_results: maxResults,
      });
      for (const run of response.runs ?? []) {
        const info = run.info as unknown as
          | ({ runUuid?: string; run_uuid?: string; run_id?: string } & Record<string, unknown>)
          | undefined;
        const runId = info?.runUuid ?? info?.run_uuid ?? info?.run_id;
        if (runId && !seenRunIds.has(runId)) {
          seenRunIds.add(runId);
          runIds.push(runId);
        }
        if (runIds.length >= maxResults) {
          return runIds;
        }
      }
    } catch {
      // Try the next known evaluation run type.
    }
  }
  return runIds;
};

const getLatestEvaluationRunId = async (experimentId: string): Promise<string | undefined> => {
  return (await getLatestEvaluationRunIds(experimentId, 1))[0];
};

const getEvaluationRunsResultUrl = (experimentId: string, runUuid: string): string => {
  const route = Routes.getExperimentPageTabRoute(experimentId, ExperimentPageTabName.EvaluationRuns);
  const searchParams = new URLSearchParams({ [SELECTED_RUN_UUID_QUERY_PARAM]: runUuid });
  return `/#${route}?${searchParams.toString()}`;
};

const getEvaluationRunsComparisonUrl = (experimentId: string, selectedRunUuid: string, compareToRunUuid: string) => {
  const route = Routes.getExperimentPageTabRoute(experimentId, ExperimentPageTabName.EvaluationRuns);
  const searchParams = new URLSearchParams({
    [SELECTED_RUN_UUID_QUERY_PARAM]: selectedRunUuid,
    [COMPARE_TO_RUN_UUID_QUERY_PARAM]: compareToRunUuid,
  });
  return `/#${route}?${searchParams.toString()}`;
};

const getJudgeAlignmentUrl = (experimentId: string): string => {
  return `/#${Routes.getExperimentPageTabScorerAlignmentRoute(experimentId)}`;
};

type ActiveMockEvalSetup = {
  request: MockEvalSetupRequest;
  traceCount: number;
  traceSummary: string;
  primaryScorer: string;
  secondaryScorer: string;
};

const getMockEvalTargetDatasetName = (
  setup: ActiveMockEvalSetup & { datasetChoice: MockEvalDatasetChoice },
): string => {
  const { request, datasetChoice } = setup;
  return datasetChoice === 'golden' ? (request.goldenDatasetName ?? request.datasetName) : request.datasetName;
};

const getMockCodingAgentFixPrompt = (setup: ActiveMockEvalSetup & { datasetChoice: MockEvalDatasetChoice }): string =>
  [
    `Fix the regression tracked by issue "${setup.request.issueName}".`,
    `Use evaluation dataset "${getMockEvalTargetDatasetName(setup)}" and aligned scorer "${setup.primaryScorer}" as the verification target.`,
    'The latest eval shows the LLM judge is now calibrated and the remaining failures are caused by unsupported answer claims when retrieval evidence is weak.',
    'Please tighten the answer-generation prompt or guardrail so the app cites retrieved evidence, declines unsupported claims, and uses an uncertainty fallback when context is insufficient.',
    'After the change, run the linked evaluation with a fresh trace sample and compare it against the baseline evaluation run.',
  ].join('\n');

const getMockProductionMonitoringRequest = (
  setup: ActiveMockEvalSetup & { datasetChoice: MockEvalDatasetChoice },
): MockProductionMonitoringRequest => ({
  issueId: setup.request.issueId,
  issueName: setup.request.issueName,
  sourceJobId: setup.request.sourceJobId,
  experimentId: setup.request.experimentId,
  datasetName: getMockEvalTargetDatasetName(setup),
  scorerNames: [setup.primaryScorer, setup.secondaryScorer],
  samplingRatio: MOCK_PRODUCTION_MONITORING_SAMPLING_RATIO,
});

/** `timestamp` round-trips through JSON as a string; restore it to a Date on load. */
export const reviveMessages = (messages: ChatMessage[]): ChatMessage[] =>
  messages.map((m) => ({ ...m, timestamp: new Date(m.timestamp) }));

/** Shrink a transcript to fit storage by dropping the oldest messages under a string-length budget. */
export const trimForStorage = (messages: ChatMessage[], maxChars: number = MAX_PERSISTED_CHARS): ChatMessage[] => {
  // Drop the oldest message until under budget, but never drop the last one.
  const lengths = messages.map((msg) => JSON.stringify(msg).length);
  let size = lengths.reduce((acc, len) => acc + len, 0); // best-effort; ignores separators
  let start = 0;
  while (start < messages.length - 1 && size > maxChars) {
    size -= lengths[start];
    start += 1;
  }
  return start === 0 ? messages : messages.slice(start);
};

/**
 * Wrap every stream callback so it no-ops once the originating send is stale (the user reset or
 * cancelled while the POST was still in flight). Guards the whole object generically rather than
 * each callback by hand, so callbacks added later are covered automatically.
 */
const withGuard = (isCurrent: () => boolean, callbacks: SendMessageStreamCallbacks): SendMessageStreamCallbacks =>
  Object.fromEntries(
    Object.entries(callbacks).map(([key, fn]) => [
      key,
      typeof fn === 'function'
        ? (...args: unknown[]) => {
            if (isCurrent()) {
              fn(...args);
            }
          }
        : fn,
    ]),
    // Object.fromEntries widens to { [k: string]: ... }; the shape is unchanged so the cast is safe.
  ) as SendMessageStreamCallbacks;

/**
 * Check if the server is running locally (localhost or 127.0.0.1).
 */
const checkIsLocalServer = (): boolean => {
  const hostname = window.location.hostname;
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
};

const generateMessageId = (): string => {
  return `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
};

async function resolveSetupComplete(config: AssistantConfig): Promise<boolean> {
  const selectedProvider = Object.entries(config.providers ?? {}).find(
    ([, providerConfig]) => providerConfig.selected === true,
  );
  if (!selectedProvider) return false;

  const [providerId, providerConfig] = selectedProvider;
  if (providerId !== GATEWAY_PROVIDER_ID) {
    return true;
  }
  // The endpoint must be the same as the model name
  const { endpoints } = await GatewayApi.listEndpoints();
  return endpoints.some((endpoint) => endpoint.name === providerConfig.model);
}

/**
 * Set the current (open) text segment of an assistant turn. `text` is the full
 * segment since the last tool call, so we replace the trailing text part if there
 * is one, otherwise append a new text part (a tool call always closes the prior
 * text part, so the next text starts fresh).
 */
const setOpenTextPart = (parts: AssistantPart[], text: string): AssistantPart[] => {
  const last = parts[parts.length - 1];
  if (last?.type === 'text') {
    return [...parts.slice(0, -1), { type: 'text', text }];
  }
  return [...parts, { type: 'text', text }];
};

/** Add or update tool-call parts by `toolUseId` (they can re-stream, so upsert). */
export const upsertToolCalls = (parts: AssistantPart[], tools: ToolUseInfo[]): AssistantPart[] => {
  const next = [...parts];
  for (const tool of tools) {
    const i = next.findIndex((p) => p.type === 'toolCall' && p.toolUseId === tool.id);
    const part = { type: 'toolCall' as const, toolUseId: tool.id, name: tool.name, input: tool.input };
    if (i >= 0) {
      // Merge without clobbering an already-resolved status/result from a tool_result.
      next[i] = { ...next[i], ...part };
    } else {
      next.push({ ...part, status: ToolCallStatus.Running });
    }
  }
  return next;
};

/** Resolve a tool call's status/result once its tool_result arrives, matched by `toolUseId`. */
export const applyToolResult = (parts: AssistantPart[], result: ToolResultInfo): AssistantPart[] =>
  parts.map((p) =>
    p.type === 'toolCall' && p.toolUseId === result.toolUseId
      ? { ...p, status: result.isError ? ToolCallStatus.Error : ToolCallStatus.Done, result: result.content }
      : p,
  );

/** The kinds of new information the stream delivers, each changing the open message's parts. */
const PartsUpdateKind = {
  Text: 'text',
  LinkAction: 'linkAction',
  PromptAction: 'promptAction',
  CopyAction: 'copyAction',
  EvalComparisonSummary: 'evalComparisonSummary',
  SelectionPrompt: 'selectionPrompt',
  ToolCalls: 'toolCalls',
  ToolResult: 'toolResult',
} as const;

/** A piece of new information from the stream that changes the open message's parts. */
type PartsUpdate =
  | { kind: typeof PartsUpdateKind.Text; text: string }
  | {
      kind: typeof PartsUpdateKind.LinkAction;
      actionId: string;
      label: string;
      href: string;
    }
  | {
      kind: typeof PartsUpdateKind.PromptAction;
      actionId: string;
      label: string;
      prompt: string;
    }
  | {
      kind: typeof PartsUpdateKind.CopyAction;
      actionId: string;
      label: string;
      copyText: string;
    }
  | {
      kind: typeof PartsUpdateKind.EvalComparisonSummary;
      actionId: string;
      title: string;
      metrics: AssistantEvalComparisonMetric[];
      chart: AssistantEvalComparisonChartPoint[];
    }
  | {
      kind: typeof PartsUpdateKind.SelectionPrompt;
      selectionId: string;
      title: string;
      description?: string;
      options: AssistantSelectionPromptOption[];
      defaultValue: string;
      continueLabel?: string;
    }
  | { kind: typeof PartsUpdateKind.ToolCalls; tools: ToolUseInfo[] }
  | { kind: typeof PartsUpdateKind.ToolResult; result: ToolResultInfo };

/** Fold one update into the parts list. Streaming an assistant turn is a reduction over these. */
const reduceParts = (parts: AssistantPart[], update: PartsUpdate): AssistantPart[] => {
  switch (update.kind) {
    case PartsUpdateKind.Text:
      return update.text ? setOpenTextPart(parts, update.text) : parts;
    case PartsUpdateKind.LinkAction:
      return [...parts, { type: 'linkAction', actionId: update.actionId, label: update.label, href: update.href }];
    case PartsUpdateKind.PromptAction:
      return [
        ...parts,
        { type: 'promptAction', actionId: update.actionId, label: update.label, prompt: update.prompt },
      ];
    case PartsUpdateKind.CopyAction:
      return [
        ...parts,
        { type: 'copyAction', actionId: update.actionId, label: update.label, copyText: update.copyText },
      ];
    case PartsUpdateKind.EvalComparisonSummary:
      return [
        ...parts,
        {
          type: 'evalComparisonSummary',
          actionId: update.actionId,
          title: update.title,
          metrics: update.metrics,
          chart: update.chart,
        },
      ];
    case PartsUpdateKind.SelectionPrompt:
      return [
        ...parts,
        {
          type: 'selectionPrompt',
          selectionId: update.selectionId,
          title: update.title,
          description: update.description,
          options: update.options,
          defaultValue: update.defaultValue,
          continueLabel: update.continueLabel,
        },
      ];
    case PartsUpdateKind.ToolCalls:
      return upsertToolCalls(parts, update.tools);
    case PartsUpdateKind.ToolResult:
      return applyToolResult(parts, update.result);
  }
};

/** Why a streaming turn stopped; the open message is closed differently for each. */
const TurnEndReason = {
  Completed: 'completed',
  Failed: 'failed',
  Interrupted: 'interrupted',
} as const;

/** The terminal of a streaming turn: it completed, failed (with an error), or was interrupted. */
type TurnEnd =
  | { reason: typeof TurnEndReason.Completed }
  | { reason: typeof TurnEndReason.Failed; error: string }
  | { reason: typeof TurnEndReason.Interrupted };

const partsToContent = (parts: AssistantPart[]): string =>
  parts
    .filter((p): p is Extract<AssistantPart, { type: 'text' }> => p.type === 'text')
    .map((p) => p.text)
    .join('');

/** The last message is the open turn we stream into: an assistant message still streaming. */
const isOpenAssistantTurn = (message: ChatMessage | undefined): message is ChatMessage =>
  message?.role === 'assistant' && Boolean(message.isStreaming);

export const AssistantProvider = ({ children }: { children: ReactNode }) => {
  // Detect if server is local - memoized since hostname doesn't change
  const isLocalServer = useMemo(() => checkIsLocalServer(), []);

  // Panel state - persisted to localStorage
  const [isPanelOpen, setIsPanelOpen] = useLocalStorage({
    key: 'mlflow.assistant.panelOpen',
    version: 1,
    initialValue: false,
  });

  // Conversation - persisted to localStorage so it survives reloads as a single conversation.
  const [persistedChat, setPersistedChat] = useLocalStorage<PersistedChat>({
    key: CHAT_STORAGE_KEY_BASE,
    version: CHAT_STORAGE_VERSION,
    initialValue: { messages: [], tokenUsage: EMPTY_TOKEN_USAGE },
  });

  // Chat state - messages/tokenUsage seeded once from the persisted conversation on first mount.
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>(() => reviveMessages(persistedChat.messages));
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentStatus, setCurrentStatus] = useState<string | null>(null);
  const [activeTools, setActiveTools] = useState<ToolUseInfo[]>([]);
  const [pendingPermission, setPendingPermission] = useState<PermissionRequest | null>(null);
  const [pendingPrompt, setPendingPrompt] = useState<string | null>(null);
  const [contextualSuggestedPrompts, setContextualSuggestedPrompts] = useState<string[]>([]);
  const [tokenUsage, setTokenUsage] = useState<TokenUsage>(() => persistedChat.tokenUsage ?? EMPTY_TOKEN_USAGE);

  // Setup state
  const [setupComplete, setSetupComplete] = useState(false);
  const [isLoadingConfig, setIsLoadingConfig] = useState(true);
  const [remoteAccessAllowed, setRemoteAccessAllowed] = useState(false);
  const canUseAssistant = isLocalServer || remoteAccessAllowed;

  // Use ref to track current streaming message
  const openTextBufferRef = useRef<string>('');

  // NB: Using the actions hook to avoid re-rendering the component when the context changes.
  const { getContext: getPageContext } = useAssistantPageContextActions();

  // Use ref to track active EventSource for cancellation
  const eventSourceRef = useRef<EventSource | null>(null);
  const mockStreamTimeoutsRef = useRef<number[]>([]);
  const activeMockEvalSetupRef = useRef<ActiveMockEvalSetup | null>(null);
  const lastMockEvalSetupRef = useRef<(ActiveMockEvalSetup & { datasetChoice: MockEvalDatasetChoice }) | null>(null);
  const pendingMockJudgeAlignmentRef = useRef<(ActiveMockEvalSetup & { datasetChoice: MockEvalDatasetChoice }) | null>(
    null,
  );
  const pendingMockAlignedEvaluationRef = useRef<
    (ActiveMockEvalSetup & { datasetChoice: MockEvalDatasetChoice }) | null
  >(null);
  const pendingMockFixRef = useRef<(ActiveMockEvalSetup & { datasetChoice: MockEvalDatasetChoice }) | null>(null);
  const pendingMockFinalEvaluationRef = useRef<(ActiveMockEvalSetup & { datasetChoice: MockEvalDatasetChoice }) | null>(
    null,
  );
  const pendingMockIssueResolutionRef = useRef<MockEvalSetupRequest | null>(null);
  const pendingMockProductionMonitoringRef = useRef<MockProductionMonitoringRequest | null>(null);
  const pendingMockProductionMonitoringNudgeRef = useRef<MockProductionMonitoringRequest | null>(null);
  const baselineEvaluationRunIdRef = useRef<string | null>(null);
  const fixedEvaluationRunIdRef = useRef<string | null>(null);
  const selectedProviderIdRef = useRef<string | null>(null);

  // Token identifying the in-flight send; reset/cancel invalidates it so a late POST's
  // guarded callbacks no-op and its stream is closed instead of leaking into new state.
  const activeRequestRef = useRef<symbol | null>(null);

  // Throttle streaming updates to avoid overwhelming React with re-renders
  const rafPendingRef = useRef<number | null>(null);

  const clearMockStreamTimers = useCallback(() => {
    for (const timeoutId of mockStreamTimeoutsRef.current) {
      window.clearTimeout(timeoutId);
    }
    mockStreamTimeoutsRef.current = [];
  }, []);

  // Fold stream updates into the open (streaming) assistant message's parts, keeping
  // `content` mirrored to the text parts. No-op if the last message isn't an open turn.
  const applyToOpenParts = useCallback((...updates: PartsUpdate[]) => {
    setMessages((prev) => {
      const lastMessage = prev[prev.length - 1];
      if (isOpenAssistantTurn(lastMessage)) {
        const parts = updates.reduce(reduceParts, lastMessage.parts ?? []);
        return [...prev.slice(0, -1), { ...lastMessage, parts, content: partsToContent(parts) }];
      }
      return prev;
    });
  }, []);

  // Close the in-flight streaming assistant message: flush any buffered text into an open
  // text part, mirror `content`, mark it no longer streaming, and reflect how the turn ended
  // (append the error text on failure, flag an interrupt). Shared by the done / error /
  // interrupt terminals so the message-finalize logic lives once.
  const closeStreamingMessage = useCallback((end: TurnEnd) => {
    // Snapshot the buffer and clear it up front. The setMessages updater runs during a later
    // render, so reading openTextBufferRef inside it would race with the clear below and drop
    // any text streamed since the last flush.
    const buffered = openTextBufferRef.current;
    openTextBufferRef.current = '';
    setMessages((prev) => {
      const lastMessage = prev[prev.length - 1];
      if (!isOpenAssistantTurn(lastMessage)) {
        return prev;
      }
      // When `buffered` is empty, everything was already flushed — leave the parts as-is.
      // Do NOT call setOpenTextPart(parts, '') here: it would overwrite the last committed
      // text part with an empty string and drop the turn's final line.
      const withBufferedText = buffered
        ? setOpenTextPart(lastMessage.parts ?? [], buffered)
        : (lastMessage.parts ?? []);
      // On failure, append the error as a text part (a styled error callout is a planned follow-up).
      const parts: AssistantPart[] =
        end.reason === TurnEndReason.Failed
          ? [...withBufferedText, { type: 'text', text: `Error: ${end.error}` }]
          : withBufferedText;
      return [
        ...prev.slice(0, -1),
        {
          ...lastMessage,
          parts,
          content: partsToContent(parts),
          isStreaming: false,
          ...(end.reason === TurnEndReason.Interrupted ? { isInterrupted: true } : {}),
        },
      ];
    });
  }, []);

  const flushTextToMessage = useCallback(() => {
    rafPendingRef.current = null;
    const buffered = openTextBufferRef.current;
    if (!buffered) {
      return;
    }
    applyToOpenParts({ kind: PartsUpdateKind.Text, text: buffered });
  }, [applyToOpenParts]);

  const writeStreamedText = useCallback(
    (text: string) => {
      openTextBufferRef.current += text;
      if (rafPendingRef.current === null) {
        rafPendingRef.current = requestAnimationFrame(flushTextToMessage);
      }
    },
    [flushTextToMessage],
  );

  const endStreamingTurn = useCallback(() => {
    // Cancel any pending RAF and do a final flush with isStreaming: false
    if (rafPendingRef.current !== null) {
      cancelAnimationFrame(rafPendingRef.current);
      rafPendingRef.current = null;
    }
    closeStreamingMessage({ reason: TurnEndReason.Completed });
    eventSourceRef.current = null;
    setIsStreaming(false);
    setCurrentStatus(null);
    setActiveTools([]);
    setPendingPermission(null);
  }, [closeStreamingMessage]);

  const handleStatus = useCallback((status: string) => {
    setCurrentStatus(status);
  }, []);

  const handleSessionId = useCallback((newSessionId: string) => {
    setSessionId(newSessionId);
  }, []);

  const addToolCalls = useCallback(
    (tools: ToolUseInfo[]) => {
      // `activeTools` drives the transient "working" indicator only.
      setActiveTools(tools);
      if (tools.length === 0) {
        return;
      }
      // Persist the calls onto the message, in order. Commit any buffered text
      // first (so the calls land after the text that preceded them) and reset the
      // buffer so subsequent text starts a new part after the tool call.
      if (rafPendingRef.current !== null) {
        cancelAnimationFrame(rafPendingRef.current);
        rafPendingRef.current = null;
      }
      const buffered = openTextBufferRef.current;
      openTextBufferRef.current = '';
      // Commit any buffered text first so the calls land after the text that preceded them.
      applyToOpenParts({ kind: PartsUpdateKind.Text, text: buffered }, { kind: PartsUpdateKind.ToolCalls, tools });
    },
    [applyToOpenParts],
  );

  const addSelectionPrompt = useCallback(
    ({
      selectionId,
      title,
      description,
      options,
      defaultValue,
      continueLabel,
    }: {
      selectionId: string;
      title: string;
      description?: string;
      options: AssistantSelectionPromptOption[];
      defaultValue: string;
      continueLabel?: string;
    }) => {
      if (rafPendingRef.current !== null) {
        cancelAnimationFrame(rafPendingRef.current);
        rafPendingRef.current = null;
      }
      const buffered = openTextBufferRef.current;
      openTextBufferRef.current = '';
      applyToOpenParts(
        { kind: PartsUpdateKind.Text, text: buffered },
        {
          kind: PartsUpdateKind.SelectionPrompt,
          selectionId,
          title,
          description,
          options,
          defaultValue,
          continueLabel,
        },
      );
    },
    [applyToOpenParts],
  );

  const addLinkAction = useCallback(
    ({ actionId, label, href }: { actionId: string; label: string; href: string }) => {
      if (rafPendingRef.current !== null) {
        cancelAnimationFrame(rafPendingRef.current);
        rafPendingRef.current = null;
      }
      const buffered = openTextBufferRef.current;
      openTextBufferRef.current = '';
      applyToOpenParts(
        { kind: PartsUpdateKind.Text, text: buffered },
        { kind: PartsUpdateKind.LinkAction, actionId, label, href },
      );
    },
    [applyToOpenParts],
  );

  const addPromptAction = useCallback(
    ({ actionId, label, prompt }: { actionId: string; label: string; prompt: string }) => {
      if (rafPendingRef.current !== null) {
        cancelAnimationFrame(rafPendingRef.current);
        rafPendingRef.current = null;
      }
      const buffered = openTextBufferRef.current;
      openTextBufferRef.current = '';
      applyToOpenParts(
        { kind: PartsUpdateKind.Text, text: buffered },
        { kind: PartsUpdateKind.PromptAction, actionId, label, prompt },
      );
    },
    [applyToOpenParts],
  );

  const addCopyAction = useCallback(
    ({ actionId, label, copyText }: { actionId: string; label: string; copyText: string }) => {
      if (rafPendingRef.current !== null) {
        cancelAnimationFrame(rafPendingRef.current);
        rafPendingRef.current = null;
      }
      const buffered = openTextBufferRef.current;
      openTextBufferRef.current = '';
      applyToOpenParts(
        { kind: PartsUpdateKind.Text, text: buffered },
        { kind: PartsUpdateKind.CopyAction, actionId, label, copyText },
      );
    },
    [applyToOpenParts],
  );

  const addEvalComparisonSummary = useCallback(
    ({
      actionId,
      title,
      metrics,
      chart,
    }: {
      actionId: string;
      title: string;
      metrics: AssistantEvalComparisonMetric[];
      chart: AssistantEvalComparisonChartPoint[];
    }) => {
      if (rafPendingRef.current !== null) {
        cancelAnimationFrame(rafPendingRef.current);
        rafPendingRef.current = null;
      }
      const buffered = openTextBufferRef.current;
      openTextBufferRef.current = '';
      applyToOpenParts(
        { kind: PartsUpdateKind.Text, text: buffered },
        { kind: PartsUpdateKind.EvalComparisonSummary, actionId, title, metrics, chart },
      );
    },
    [applyToOpenParts],
  );

  const resolveToolCall = useCallback(
    (result: ToolResultInfo) => {
      applyToOpenParts({ kind: PartsUpdateKind.ToolResult, result });
    },
    [applyToOpenParts],
  );

  const handleUsage = useCallback(
    (usage: {
      prompt_tokens: number;
      completion_tokens: number;
      total_tokens: number;
      total_cost_usd?: number | null;
    }) => {
      // Contract: each `usage` event is a per-turn / per-request *delta*, never a
      // session-running total. Every provider emits it at a turn/request boundary
      // (Claude Code's `result`, Codex's `turn.completed`, the gateway's per-request
      // usage chunk), so we accumulate. A provider that emitted cumulative totals would
      // double-count here — emit deltas, not running totals.
      setTokenUsage((prev) => ({
        promptTokens: prev.promptTokens + (usage.prompt_tokens ?? 0),
        completionTokens: prev.completionTokens + (usage.completion_tokens ?? 0),
        totalTokens: prev.totalTokens + (usage.total_tokens ?? 0),
        // Accumulate cost only from priced turns; stays null until the first
        // numeric estimate arrives so unpriced models render no cost at all.
        costUsd: usage.total_cost_usd == null ? prev.costUsd : (prev.costUsd ?? 0) + usage.total_cost_usd,
      }));
    },
    [],
  );

  const handlePermissionRequest = useCallback((request: PermissionRequest) => {
    setPendingPermission(request);
  }, []);

  // Setup actions
  const refreshConfig = useCallback(async () => {
    setIsLoadingConfig(true);
    try {
      const config = await getConfig();
      selectedProviderIdRef.current =
        Object.entries(config.providers ?? {}).find(([, providerConfig]) => providerConfig.selected === true)?.[0] ??
        null;
      const isComplete = await resolveSetupComplete(config);
      setSetupComplete(isComplete);
      setRemoteAccessAllowed(config.remote_access_allowed ?? false);
    } catch {
      // On error, assume setup is not complete
      selectedProviderIdRef.current = null;
      setSetupComplete(false);
      setRemoteAccessAllowed(false);
    } finally {
      setIsLoadingConfig(false);
    }
  }, []);

  const completeSetup = useCallback(() => {
    setSetupComplete(true);
    refreshConfig();
  }, [refreshConfig]);

  // Fetch config on mount
  useEffect(() => {
    refreshConfig();
  }, [refreshConfig]);

  // Cancel pending RAF and close EventSource on unmount
  useEffect(() => {
    return () => {
      clearMockStreamTimers();
      // Invalidate any in-flight send so any POST cleans up the stream on unmount
      activeRequestRef.current = null;
      if (rafPendingRef.current !== null) {
        cancelAnimationFrame(rafPendingRef.current);
        rafPendingRef.current = null;
      }
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
    };
  }, [clearMockStreamTimers]);

  // Persist the conversation only once a turn has settled (never on the streaming
  // hot path, which would write to storage on every frame). `reset()` flips back to
  // the empty state here too, which clears the stored conversation.
  useEffect(() => {
    if (isStreaming) {
      return;
    }
    setPersistedChat({ messages: trimForStorage(messages), tokenUsage });
  }, [isStreaming, messages, tokenUsage, setPersistedChat]);

  const failStreamingTurn = useCallback(
    (errorMsg: string) => {
      setError(errorMsg);
      setIsStreaming(false);
      setCurrentStatus(null);
      eventSourceRef.current = null;
      setActiveTools([]);
      setPendingPermission(null);
      closeStreamingMessage({ reason: TurnEndReason.Failed, error: errorMsg });
    },
    [closeStreamingMessage],
  );

  const interruptStreamingTurn = useCallback(() => {
    setIsStreaming(false);
    setCurrentStatus(null);
    setActiveTools([]);
    setPendingPermission(null);
    eventSourceRef.current = null;
    if (rafPendingRef.current !== null) {
      cancelAnimationFrame(rafPendingRef.current);
      rafPendingRef.current = null;
    }
    closeStreamingMessage({ reason: TurnEndReason.Interrupted });
  }, [closeStreamingMessage]);

  // Shared SSE callback wiring for startChat, handleSendMessage, respondToPermission and
  // regenerate. Each call site wraps this in `withGuard(isCurrent, streamCallbacks)` so a
  // superseded send's callbacks no-op.
  const streamCallbacks = useMemo(
    () => ({
      onMessage: writeStreamedText,
      onError: failStreamingTurn,
      onDone: endStreamingTurn,
      onStatus: handleStatus,
      onSessionId: handleSessionId,
      onToolUse: addToolCalls,
      onToolResult: resolveToolCall,
      onInterrupted: interruptStreamingTurn,
      onUsage: handleUsage,
      onPermissionRequest: handlePermissionRequest,
    }),
    [
      writeStreamedText,
      failStreamingTurn,
      endStreamingTurn,
      handleStatus,
      handleSessionId,
      addToolCalls,
      resolveToolCall,
      interruptStreamingTurn,
      handleUsage,
      handlePermissionRequest,
    ],
  );

  // Actions
  const openPanel = useCallback(() => {
    setIsPanelOpen(true);
    setError(null);
    // Refresh config when panel opens (intentionally not awaited)
    refreshConfig();
  }, [refreshConfig, setIsPanelOpen]);

  const closePanel = useCallback(() => {
    setIsPanelOpen(false);
    // Drop any queued prompt — closing the panel is an abandon, so a stale seed shouldn't
    // inject into an unrelated chat opened later.
    setPendingPrompt(null);
    setContextualSuggestedPrompts([]);
  }, [setIsPanelOpen]);

  const prefillPrompt = useCallback((prompt: string) => setPendingPrompt(prompt), []);
  const clearPendingPrompt = useCallback(() => setPendingPrompt(null), []);

  const reset = useCallback(() => {
    clearMockStreamTimers();
    // Invalidate any in-flight send still awaiting its POST: its captured token no longer matches,
    // so its guarded callbacks no-op and its EventSource is closed when the await resolves.
    activeRequestRef.current = null;
    // Tear down any active stream so its callbacks can't leak into the reset state
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    if (rafPendingRef.current !== null) {
      cancelAnimationFrame(rafPendingRef.current);
      rafPendingRef.current = null;
    }
    setSessionId(null);
    setMessages([]);
    setIsStreaming(false);
    setError(null);
    setCurrentStatus(null);
    setActiveTools([]);
    setTokenUsage({ promptTokens: 0, completionTokens: 0, totalTokens: 0, costUsd: null });
    openTextBufferRef.current = '';
    setPendingPermission(null);
    setContextualSuggestedPrompts([]);
    activeMockEvalSetupRef.current = null;
    lastMockEvalSetupRef.current = null;
    pendingMockJudgeAlignmentRef.current = null;
    pendingMockAlignedEvaluationRef.current = null;
    pendingMockFixRef.current = null;
    pendingMockFinalEvaluationRef.current = null;
    pendingMockIssueResolutionRef.current = null;
    pendingMockProductionMonitoringRef.current = null;
    pendingMockProductionMonitoringNudgeRef.current = null;
    baselineEvaluationRunIdRef.current = null;
    fixedEvaluationRunIdRef.current = null;
  }, [clearMockStreamTimers]);

  // Begin a new in-flight send: stamp a fresh token in closure,
  // return a checker for whether this send is
  // still the active one (i.e. not superseded by a reset/cancel that ran during its POST).
  const beginRequest = useCallback(() => {
    const token = Symbol();
    activeRequestRef.current = token;
    return () => activeRequestRef.current === token;
  }, []);

  // Store the resolved stream if its send is still current, otherwise close the orphan. Returns
  // whether it was attached
  const attachStreamIfCurrent = useCallback((isCurrent: () => boolean, result: SendMessageStreamResult): boolean => {
    if (!isCurrent()) {
      result.eventSource?.close();
      return false;
    }
    eventSourceRef.current = result.eventSource;
    return true;
  }, []);

  const startChat = useCallback(
    async (prompt?: string) => {
      clearMockStreamTimers();
      const isCurrent = beginRequest();

      setError(null);
      setIsStreaming(true);
      setContextualSuggestedPrompts([]);
      // A new message supersedes any prompt the user was deciding on. Clearing it
      // here drops the stale Allow/Deny so it can't resume the abandoned turn; the
      // backend closes the orphaned tool call out as cancelled.
      setPendingPermission(null);

      // Add user message if prompt provided
      if (prompt) {
        setMessages((prev) => [
          ...prev,
          {
            id: generateMessageId(),
            role: 'user',
            content: prompt,
            timestamp: new Date(),
          },
        ]);
      }

      // Add streaming assistant message placeholder
      openTextBufferRef.current = '';
      setMessages((prev) => [
        ...prev,
        {
          id: generateMessageId(),
          role: 'assistant',
          content: '',
          timestamp: new Date(),
          isStreaming: true,
        },
      ]);

      try {
        const pageContext = getPageContext();
        const result = await sendMessageStream(
          {
            message: prompt || '',
            session_id: sessionId ?? undefined,
            experiment_id: pageContext['experimentId'] as string | undefined,
            context: pageContext,
          },
          withGuard(isCurrent, streamCallbacks),
        );
        if (!attachStreamIfCurrent(isCurrent, result)) {
          return;
        }
      } catch (err) {
        if (!isCurrent()) {
          return;
        }
        failStreamingTurn(err instanceof Error ? err.message : 'Failed to start chat');
      }
    },
    [
      clearMockStreamTimers,
      sessionId,
      beginRequest,
      attachStreamIfCurrent,
      getPageContext,
      streamCallbacks,
      failStreamingTurn,
    ],
  );

  const respondToPermission = useCallback(
    (allow: boolean) => {
      if (!pendingPermission) {
        return;
      }
      // Target the request's originating session, not the current one, so a
      // session change while the prompt was shown can't resolve the wrong turn.
      const { sessionId: requestSessionId, requestId } = pendingPermission;
      setPendingPermission(null);
      setError(null);
      setIsStreaming(true);

      // The paused assistant placeholder keeps streaming — no new message; the
      // resume stream continues accumulating into it until done.
      const isCurrent = beginRequest();
      resumeStream(requestSessionId, requestId, allow ? 'allow' : 'deny', withGuard(isCurrent, streamCallbacks))
        .then((result) => {
          attachStreamIfCurrent(isCurrent, result);
        })
        .catch((err) => {
          if (isCurrent()) {
            failStreamingTurn(err instanceof Error ? err.message : 'Failed to resume');
          }
        });
    },
    [pendingPermission, beginRequest, attachStreamIfCurrent, streamCallbacks, failStreamingTurn],
  );

  const scheduleMockStreamAction = useCallback((delayMs: number, action: () => void) => {
    const timeoutId = window.setTimeout(() => {
      mockStreamTimeoutsRef.current = mockStreamTimeoutsRef.current.filter((id) => id !== timeoutId);
      action();
    }, delayMs);
    mockStreamTimeoutsRef.current.push(timeoutId);
  }, []);

  const startMockEvalArtifactCreation = useCallback(
    (setup: ActiveMockEvalSetup, datasetChoice: MockEvalDatasetChoice) => {
      clearMockStreamTimers();
      activeRequestRef.current = null;
      setup.request.onChoice?.(datasetChoice);
      activeMockEvalSetupRef.current = null;
      pendingMockJudgeAlignmentRef.current = null;
      pendingMockAlignedEvaluationRef.current = null;
      pendingMockFixRef.current = null;
      pendingMockFinalEvaluationRef.current = null;
      pendingMockProductionMonitoringRef.current = null;
      pendingMockProductionMonitoringNudgeRef.current = null;

      const { request, traceCount, traceSummary, primaryScorer, secondaryScorer } = setup;
      const addToGolden = datasetChoice === 'golden';
      const targetDatasetName = addToGolden ? (request.goldenDatasetName ?? request.datasetName) : request.datasetName;
      const datasetAction = addToGolden ? 'add_records_to_dataset' : 'create_dataset';
      const datasetResult = addToGolden
        ? `Added ${traceCount || 0} records to ${targetDatasetName}.`
        : `Created dataset ${targetDatasetName}.`;

      setError(null);
      setIsStreaming(true);
      setCurrentStatus(addToGolden ? 'Adding records to golden dataset' : 'Creating regression dataset');
      setActiveTools([]);
      setPendingPermission(null);
      setContextualSuggestedPrompts([]);
      openTextBufferRef.current = '';

      setMessages((prev) => [
        ...prev,
        {
          id: generateMessageId(),
          role: 'user',
          content: addToGolden ? 'Add to existing dataset' : 'Create new dataset',
          timestamp: new Date(),
        },
        {
          id: generateMessageId(),
          role: 'assistant',
          content: '',
          timestamp: new Date(),
          isStreaming: true,
          parts: [],
        },
      ]);

      scheduleMockStreamAction(150, () => {
        writeStreamedText(
          addToGolden
            ? `I'll add the ${traceCount || 0} issue records to \`${targetDatasetName}\` and create judges for this failure mode.`
            : `I'll create a dedicated regression dataset \`${targetDatasetName}\` and create judges for this failure mode.`,
        );
      });
      scheduleMockStreamAction(650, () => {
        setCurrentStatus('Selecting representative traces');
        addToolCalls([
          {
            id: `mock-select-traces-${request.issueId}`,
            name: 'select_impacted_traces',
            input: { issue_id: request.issueId, traces: traceSummary, trace_count: traceCount },
          },
        ]);
      });
      scheduleMockStreamAction(1150, () => {
        resolveToolCall({
          toolUseId: `mock-select-traces-${request.issueId}`,
          content: `Selected ${traceCount || 0} traces for the regression set.`,
          isError: false,
        });
        writeStreamedText(`\n\nSelected ${traceCount || 0} traces that reproduce the issue.`);
      });
      scheduleMockStreamAction(1600, () => {
        setCurrentStatus(addToGolden ? 'Adding records to golden dataset' : 'Creating regression dataset');
        addToolCalls([
          {
            id: `mock-upsert-dataset-${request.issueId}`,
            name: datasetAction,
            input: {
              name: targetDatasetName,
              source: request.sourceJobId,
              trace_count: traceCount,
              mode: datasetChoice,
            },
          },
        ]);
      });
      scheduleMockStreamAction(2200, () => {
        resolveToolCall({
          toolUseId: `mock-upsert-dataset-${request.issueId}`,
          content: datasetResult,
          isError: false,
        });
        writeStreamedText(
          addToGolden
            ? `\n\nAdded those traces as new records in \`${targetDatasetName}\`.`
            : `\n\nCreated dataset \`${targetDatasetName}\` with those traces.`,
        );
      });
      scheduleMockStreamAction(2700, () => {
        setCurrentStatus('Creating LLM judge scorers');
        addToolCalls([
          {
            id: `mock-create-primary-scorer-${request.issueId}`,
            name: 'create_scorer',
            input: { name: primaryScorer, type: 'llm_judge', dataset: targetDatasetName },
          },
          {
            id: `mock-create-secondary-scorer-${request.issueId}`,
            name: 'create_scorer',
            input: { name: secondaryScorer, type: 'llm_judge', dataset: targetDatasetName },
          },
        ]);
      });
      scheduleMockStreamAction(3450, () => {
        resolveToolCall({
          toolUseId: `mock-create-primary-scorer-${request.issueId}`,
          content: `Created scorer ${primaryScorer}.`,
          isError: false,
        });
        resolveToolCall({
          toolUseId: `mock-create-secondary-scorer-${request.issueId}`,
          content: `Created scorer ${secondaryScorer}.`,
          isError: false,
        });
        writeStreamedText(
          `\n\nCreated scorers \`${primaryScorer}\` and \`${secondaryScorer}\` to catch this class of regression.`,
        );
      });
      scheduleMockStreamAction(4050, () => {
        setCurrentStatus('Linking eval artifacts');
        writeStreamedText(
          `\n\nDone. I linked \`${targetDatasetName}\` and the judges back to the issue. Open the linked items in the issue detail to inspect the records and judge criteria.`,
        );
      });
      scheduleMockStreamAction(4450, () => {
        request.onComplete?.(datasetChoice);
        lastMockEvalSetupRef.current = { ...setup, datasetChoice };
        addSelectionPrompt({
          selectionId: `mock-run-evaluation-now-${request.issueId}`,
          title: 'Do you want to run evaluation now?',
          description: 'Run the linked judges now and open the standard run page when it finishes.',
          defaultValue: 'run',
          continueLabel: 'Continue',
          options: [
            {
              value: 'run',
              label: 'Yes, run evaluation',
              description: 'Run the evaluation with the linked dataset and judges now.',
              recommended: true,
              prompt: 'Run evaluation',
            },
            {
              value: 'later',
              label: 'No, not now',
              description: 'Keep the dataset and judges linked so you can run evaluation later.',
              prompt: 'Not now',
            },
          ],
        });
        endStreamingTurn();
      });
    },
    [
      addToolCalls,
      addSelectionPrompt,
      clearMockStreamTimers,
      endStreamingTurn,
      resolveToolCall,
      scheduleMockStreamAction,
      writeStreamedText,
    ],
  );

  const startMockRunEvaluation = useCallback(
    (setup: ActiveMockEvalSetup & { datasetChoice: MockEvalDatasetChoice }) => {
      clearMockStreamTimers();
      activeRequestRef.current = null;
      lastMockEvalSetupRef.current = setup;

      const { request, datasetChoice, primaryScorer, secondaryScorer } = setup;
      const targetDatasetName =
        datasetChoice === 'golden' ? (request.goldenDatasetName ?? request.datasetName) : request.datasetName;
      const experimentId = request.experimentId ?? (getPageContext()['experimentId'] as string | undefined);

      setError(null);
      setIsStreaming(true);
      setCurrentStatus('Starting evaluation');
      setActiveTools([]);
      setPendingPermission(null);
      setContextualSuggestedPrompts([]);
      openTextBufferRef.current = '';

      setMessages((prev) => [
        ...prev,
        {
          id: generateMessageId(),
          role: 'user',
          content: 'Run evaluation',
          timestamp: new Date(),
        },
        {
          id: generateMessageId(),
          role: 'assistant',
          content: '',
          timestamp: new Date(),
          isStreaming: true,
          parts: [],
        },
      ]);

      scheduleMockStreamAction(150, () => {
        writeStreamedText(`I'll run the evaluation on \`${targetDatasetName}\` with the two linked judges.`);
      });
      scheduleMockStreamAction(700, () => {
        addToolCalls([
          {
            id: `mock-run-evaluation-${request.issueId}`,
            name: 'run_evaluation',
            input: {
              dataset: targetDatasetName,
              scorers: [primaryScorer, secondaryScorer],
              issue_id: request.issueId,
            },
          },
        ]);
      });
      scheduleMockStreamAction(1550, () => {
        resolveToolCall({
          toolUseId: `mock-run-evaluation-${request.issueId}`,
          content: 'Started evaluation run.',
          isError: false,
        });
        writeStreamedText('\n\nEvaluation is running. I will attach the result to this issue when it finishes.');
      });
      scheduleMockStreamAction(1900, () => {
        setCurrentStatus('Summarizing evaluation result');
        writeStreamedText(
          '\n\nEvaluation finished. The linked judges found a small set of failing traces that still reproduce the issue.',
        );
      });
      scheduleMockStreamAction(2250, () => {
        setCurrentStatus('Finding evaluation result');
        const latestEvaluationRunIdPromise = experimentId
          ? getLatestEvaluationRunId(experimentId)
          : Promise.resolve(undefined);
        void latestEvaluationRunIdPromise.then((latestEvaluationRunId) => {
          if (experimentId && latestEvaluationRunId) {
            baselineEvaluationRunIdRef.current = latestEvaluationRunId;
            addLinkAction({
              actionId: `mock-open-eval-result-${request.issueId}`,
              label: 'Open evaluation result',
              href: getEvaluationRunsResultUrl(experimentId, latestEvaluationRunId),
            });
            addPromptAction({
              actionId: `mock-analyze-eval-result-${request.issueId}`,
              label: 'Analyze result',
              prompt: 'Analyze result',
            });
          } else {
            writeStreamedText(
              '\n\nI could not find an evaluation run to open yet. Check the evaluation runs table once the run appears.',
            );
          }
          endStreamingTurn();
        });
      });
    },
    [
      addLinkAction,
      addPromptAction,
      addToolCalls,
      clearMockStreamTimers,
      endStreamingTurn,
      getPageContext,
      resolveToolCall,
      scheduleMockStreamAction,
      writeStreamedText,
    ],
  );

  const startMockDeferEvaluation = useCallback(
    (setup: ActiveMockEvalSetup & { datasetChoice: MockEvalDatasetChoice }) => {
      clearMockStreamTimers();
      activeRequestRef.current = null;
      lastMockEvalSetupRef.current = null;

      const { request, datasetChoice } = setup;
      const targetDatasetName =
        datasetChoice === 'golden' ? (request.goldenDatasetName ?? request.datasetName) : request.datasetName;

      setError(null);
      setIsStreaming(true);
      setCurrentStatus('Saving eval setup');
      setActiveTools([]);
      setPendingPermission(null);
      setContextualSuggestedPrompts([]);
      openTextBufferRef.current = '';

      setMessages((prev) => [
        ...prev,
        {
          id: generateMessageId(),
          role: 'user',
          content: 'Not now',
          timestamp: new Date(),
        },
        {
          id: generateMessageId(),
          role: 'assistant',
          content: '',
          timestamp: new Date(),
          isStreaming: true,
          parts: [],
        },
      ]);

      scheduleMockStreamAction(150, () => {
        writeStreamedText(
          `No problem. \`${targetDatasetName}\` and the linked judges are attached to the issue, so you can run evaluation later from the eval run workflow.`,
        );
      });
      scheduleMockStreamAction(650, () => {
        endStreamingTurn();
      });
    },
    [clearMockStreamTimers, endStreamingTurn, scheduleMockStreamAction, writeStreamedText],
  );

  const startMockAnalyzeEvaluationResult = useCallback(
    (setup: ActiveMockEvalSetup & { datasetChoice: MockEvalDatasetChoice }) => {
      clearMockStreamTimers();
      activeRequestRef.current = null;

      const { request, datasetChoice, primaryScorer } = setup;
      const targetDatasetName =
        datasetChoice === 'golden' ? (request.goldenDatasetName ?? request.datasetName) : request.datasetName;

      setError(null);
      setIsStreaming(true);
      setCurrentStatus('Analyzing evaluation result');
      setActiveTools([]);
      setPendingPermission(null);
      setContextualSuggestedPrompts([]);
      openTextBufferRef.current = '';

      setMessages((prev) => [
        ...prev,
        {
          id: generateMessageId(),
          role: 'user',
          content: 'Analyze result',
          timestamp: new Date(),
        },
        {
          id: generateMessageId(),
          role: 'assistant',
          content: '',
          timestamp: new Date(),
          isStreaming: true,
          parts: [],
        },
      ]);

      scheduleMockStreamAction(150, () => {
        writeStreamedText(`I'll inspect the latest evaluation result for \`${targetDatasetName}\`.`);
      });
      scheduleMockStreamAction(700, () => {
        addToolCalls([
          {
            id: `mock-analyze-eval-result-${request.issueId}`,
            name: 'analyze_evaluation_result',
            input: {
              dataset: targetDatasetName,
              scorer: primaryScorer,
              issue_id: request.issueId,
            },
          },
        ]);
      });
      scheduleMockStreamAction(1500, () => {
        resolveToolCall({
          toolUseId: `mock-analyze-eval-result-${request.issueId}`,
          content: 'Found 11 failing traces where the judge score stayed high despite issue-pattern matches.',
          isError: false,
        });
        writeStreamedText(
          `\n\nThe evaluation suggests \`${primaryScorer}\` is too permissive for this failure mode. Several traces still reproduce the issue, but the judge gives them passing or near-passing scores. I recommend aligning the judge before using this eval as a release gate.`,
        );
      });
      scheduleMockStreamAction(1900, () => {
        pendingMockJudgeAlignmentRef.current = setup;
        addSelectionPrompt({
          selectionId: `mock-align-judge-${request.issueId}`,
          title: 'Do you want me to fine-tune the judge so it aligns with human judgement?',
          description:
            'Judge alignment can improve agreement with reviewers, but it may take longer and use additional model calls.',
          defaultValue: 'align',
          continueLabel: 'Continue',
          options: [
            {
              value: 'align',
              label: 'Yes, align the judge',
              description: 'Use reviewed traces and fix-verification outcomes to tune the judge rubric.',
              recommended: true,
            },
            {
              value: 'skip',
              label: 'Skip for now',
              description: 'Keep the generated judge as-is and run evaluations with the draft rubric.',
            },
          ],
        });
        endStreamingTurn();
      });
    },
    [
      addSelectionPrompt,
      addToolCalls,
      clearMockStreamTimers,
      endStreamingTurn,
      resolveToolCall,
      scheduleMockStreamAction,
      writeStreamedText,
    ],
  );

  const addMockFixAction = useCallback(
    (setup: ActiveMockEvalSetup & { datasetChoice: MockEvalDatasetChoice }) => {
      const fixPrompt = getMockCodingAgentFixPrompt(setup);
      if (DIRECT_FIX_PROVIDER_IDS.has(selectedProviderIdRef.current ?? '')) {
        addPromptAction({
          actionId: `mock-fix-issue-${setup.request.issueId}`,
          label: 'Fix it',
          prompt: 'Fix it',
        });
        return;
      }
      addCopyAction({
        actionId: `mock-copy-fix-prompt-${setup.request.issueId}`,
        label: 'Copy prompt to fix with coding agent',
        copyText: fixPrompt,
      });
    },
    [addCopyAction, addPromptAction],
  );

  const startMockJudgeAlignment = useCallback(
    (setup: ActiveMockEvalSetup & { datasetChoice: MockEvalDatasetChoice }) => {
      clearMockStreamTimers();
      activeRequestRef.current = null;
      pendingMockJudgeAlignmentRef.current = null;
      pendingMockAlignedEvaluationRef.current = setup;
      lastMockEvalSetupRef.current = setup;

      const { request, datasetChoice, primaryScorer } = setup;
      const targetDatasetName =
        datasetChoice === 'golden' ? (request.goldenDatasetName ?? request.datasetName) : request.datasetName;
      const experimentId = request.experimentId ?? (getPageContext()['experimentId'] as string | undefined);

      setError(null);
      setIsStreaming(true);
      setCurrentStatus('Preparing judge alignment');
      setActiveTools([]);
      setPendingPermission(null);
      setContextualSuggestedPrompts([]);
      openTextBufferRef.current = '';

      setMessages((prev) => [
        ...prev,
        {
          id: generateMessageId(),
          role: 'user',
          content: 'Yes, align the judge',
          timestamp: new Date(),
        },
        {
          id: generateMessageId(),
          role: 'assistant',
          content: '',
          timestamp: new Date(),
          isStreaming: true,
          parts: [],
        },
      ]);

      scheduleMockStreamAction(150, () => {
        writeStreamedText(
          `I'll prepare judge alignment for \`${primaryScorer}\` using reviewed traces and the failing examples from the evaluation result.`,
        );
      });
      scheduleMockStreamAction(700, () => {
        setCurrentStatus('Building alignment set');
        addToolCalls([
          {
            id: `mock-build-alignment-set-${request.issueId}`,
            name: 'build_judge_alignment_set',
            input: {
              dataset: targetDatasetName,
              issue_id: request.issueId,
              include_reviewed_traces: true,
              include_fix_verification: true,
            },
          },
        ]);
      });
      scheduleMockStreamAction(1450, () => {
        resolveToolCall({
          toolUseId: `mock-build-alignment-set-${request.issueId}`,
          content: 'Built alignment set with reviewed examples, repaired traces, and edge cases.',
          isError: false,
        });
        writeStreamedText('\n\nBuilt an alignment set from reviewed examples, repaired traces, and edge cases.');
      });
      scheduleMockStreamAction(1900, () => {
        setCurrentStatus('Opening judge alignment console');
        addToolCalls([
          {
            id: `mock-create-alignment-session-${request.issueId}`,
            name: 'create_judge_alignment_session',
            input: {
              scorer: primaryScorer,
              dataset: targetDatasetName,
              objective: 'match human judgement on this failure mode',
            },
          },
        ]);
      });
      scheduleMockStreamAction(2550, () => {
        resolveToolCall({
          toolUseId: `mock-create-alignment-session-${request.issueId}`,
          content: 'Created judge alignment session with the failing eval examples.',
          isError: false,
        });
        writeStreamedText(
          `\n\nI prepared the alignment console for \`${primaryScorer}\`. Use it to review the failing eval examples and tighten the judge rubric.`,
        );
      });
      scheduleMockStreamAction(2850, () => {
        if (experimentId) {
          addLinkAction({
            actionId: `mock-open-judge-alignment-${request.issueId}`,
            label: 'Open judge alignment console',
            href: getJudgeAlignmentUrl(experimentId),
          });
        }
        writeStreamedText('\n\nOnce you aligned the judge, tell me to re-run the evaluation.');
        addPromptAction({
          actionId: `mock-rerun-aligned-evaluation-${request.issueId}`,
          label: 'Re-run evaluation',
          prompt: 'Re-run evaluation',
        });
        endStreamingTurn();
      });
    },
    [
      addLinkAction,
      addPromptAction,
      addToolCalls,
      clearMockStreamTimers,
      endStreamingTurn,
      getPageContext,
      resolveToolCall,
      scheduleMockStreamAction,
      writeStreamedText,
    ],
  );

  const startMockSkipJudgeAlignment = useCallback(
    (setup: ActiveMockEvalSetup & { datasetChoice: MockEvalDatasetChoice }) => {
      clearMockStreamTimers();
      activeRequestRef.current = null;
      pendingMockJudgeAlignmentRef.current = null;
      pendingMockFixRef.current = setup;

      const { request, datasetChoice, primaryScorer } = setup;
      const targetDatasetName =
        datasetChoice === 'golden' ? (request.goldenDatasetName ?? request.datasetName) : request.datasetName;

      setError(null);
      setIsStreaming(true);
      setCurrentStatus('Keeping draft judge');
      setActiveTools([]);
      setPendingPermission(null);
      setContextualSuggestedPrompts([]);
      openTextBufferRef.current = '';

      setMessages((prev) => [
        ...prev,
        {
          id: generateMessageId(),
          role: 'user',
          content: 'Skip judge alignment',
          timestamp: new Date(),
        },
        {
          id: generateMessageId(),
          role: 'assistant',
          content: '',
          timestamp: new Date(),
          isStreaming: true,
          parts: [],
        },
      ]);

      scheduleMockStreamAction(150, () => {
        writeStreamedText(
          `Got it. I'll keep \`${primaryScorer}\` as-is for \`${targetDatasetName}\`. The latest evaluation result suggests it may be too permissive, so fix recommendations will be lower confidence until the judge is aligned.`,
        );
      });
      scheduleMockStreamAction(700, () => {
        writeStreamedText(
          '\n\nThe likely app-side fixes are to tighten grounding, add an unsupported-claim fallback, and make retrieval evidence mandatory before final answer generation.',
        );
        addMockFixAction(setup);
        endStreamingTurn();
      });
    },
    [addMockFixAction, clearMockStreamTimers, endStreamingTurn, scheduleMockStreamAction, writeStreamedText],
  );

  const startMockRerunAlignedEvaluation = useCallback(
    (setup: ActiveMockEvalSetup & { datasetChoice: MockEvalDatasetChoice }) => {
      clearMockStreamTimers();
      activeRequestRef.current = null;
      pendingMockAlignedEvaluationRef.current = null;
      pendingMockFixRef.current = setup;
      lastMockEvalSetupRef.current = setup;

      const { request, primaryScorer, secondaryScorer } = setup;
      const targetDatasetName = getMockEvalTargetDatasetName(setup);

      setError(null);
      setIsStreaming(true);
      setCurrentStatus('Re-running evaluation');
      setActiveTools([]);
      setPendingPermission(null);
      setContextualSuggestedPrompts([]);
      openTextBufferRef.current = '';

      setMessages((prev) => [
        ...prev,
        {
          id: generateMessageId(),
          role: 'user',
          content: 'Re-run evaluation',
          timestamp: new Date(),
        },
        {
          id: generateMessageId(),
          role: 'assistant',
          content: '',
          timestamp: new Date(),
          isStreaming: true,
          parts: [],
        },
      ]);

      scheduleMockStreamAction(150, () => {
        writeStreamedText(`I'll re-run the evaluation on \`${targetDatasetName}\` with the aligned judge rubric.`);
      });
      scheduleMockStreamAction(650, () => {
        addToolCalls([
          {
            id: `mock-rerun-aligned-evaluation-${request.issueId}`,
            name: 'run_evaluation',
            input: {
              dataset: targetDatasetName,
              scorers: [primaryScorer, secondaryScorer],
              issue_id: request.issueId,
              judge_alignment: 'aligned',
            },
          },
        ]);
      });
      scheduleMockStreamAction(1450, () => {
        resolveToolCall({
          toolUseId: `mock-rerun-aligned-evaluation-${request.issueId}`,
          content: 'Aligned evaluation run completed.',
          isError: false,
        });
        writeStreamedText(
          `\n\nThe aligned judge now flags this issue pattern consistently. The remaining failures point to app behavior, not judge drift.`,
        );
      });
      scheduleMockStreamAction(1900, () => {
        writeStreamedText(
          [
            '\n\nSuggested fixes:',
            '- Require retrieved evidence before emitting factual claims.',
            '- Add an uncertainty fallback when context is missing or contradictory.',
            '- Tighten the final-answer prompt so citations are mandatory for user-facing claims.',
          ].join('\n'),
        );
      });
      scheduleMockStreamAction(2200, () => {
        addMockFixAction(setup);
        endStreamingTurn();
      });
    },
    [
      addMockFixAction,
      addToolCalls,
      clearMockStreamTimers,
      endStreamingTurn,
      resolveToolCall,
      scheduleMockStreamAction,
      writeStreamedText,
    ],
  );

  const startMockApplyFix = useCallback(
    (setup: ActiveMockEvalSetup & { datasetChoice: MockEvalDatasetChoice }) => {
      clearMockStreamTimers();
      activeRequestRef.current = null;
      pendingMockFixRef.current = null;
      pendingMockFinalEvaluationRef.current = setup;

      const { request } = setup;
      const targetDatasetName = getMockEvalTargetDatasetName(setup);

      setError(null);
      setIsStreaming(true);
      setCurrentStatus('Applying fix');
      setActiveTools([]);
      setPendingPermission(null);
      setContextualSuggestedPrompts([]);
      openTextBufferRef.current = '';

      setMessages((prev) => [
        ...prev,
        {
          id: generateMessageId(),
          role: 'user',
          content: 'Fix it',
          timestamp: new Date(),
        },
        {
          id: generateMessageId(),
          role: 'assistant',
          content: '',
          timestamp: new Date(),
          isStreaming: true,
          parts: [],
        },
      ]);

      scheduleMockStreamAction(150, () => {
        writeStreamedText(
          'I will apply the prompt and guardrail changes that address the aligned evaluation failures.',
        );
      });
      scheduleMockStreamAction(650, () => {
        addToolCalls([
          {
            id: `mock-apply-fix-${request.issueId}`,
            name: 'apply_prompt_fix',
            input: {
              issue_id: request.issueId,
              dataset: targetDatasetName,
              change:
                'Require retrieval evidence for factual claims and fall back to uncertainty when evidence is insufficient.',
            },
          },
        ]);
      });
      scheduleMockStreamAction(1450, () => {
        resolveToolCall({
          toolUseId: `mock-apply-fix-${request.issueId}`,
          content: 'Applied prompt and guardrail update.',
          isError: false,
        });
        writeStreamedText(
          '\n\nI applied the fix. The next useful check is an evaluation with a fresh trace sample so we can compare it against the baseline.',
        );
      });
      scheduleMockStreamAction(1800, () => {
        addSelectionPrompt({
          selectionId: `mock-run-fixed-evaluation-${request.issueId}`,
          title: 'Run evaluation again with new traces?',
          description: 'This will compare the fixed behavior against the baseline evaluation run.',
          defaultValue: 'run',
          continueLabel: 'Continue',
          options: [
            {
              value: 'run',
              label: 'Yes, run evaluation again',
              description: 'Run the aligned judges on a fresh trace sample and compare with the baseline.',
              recommended: true,
              prompt: 'Yes, run evaluation again',
            },
            {
              value: 'later',
              label: 'No, not now',
              description: 'Keep the fix and linked eval artifacts for a later run.',
              prompt: 'No, not now',
            },
          ],
        });
        endStreamingTurn();
      });
    },
    [
      addSelectionPrompt,
      addToolCalls,
      clearMockStreamTimers,
      endStreamingTurn,
      resolveToolCall,
      scheduleMockStreamAction,
      writeStreamedText,
    ],
  );

  const startMockDeferFixedEvaluation = useCallback(
    (setup: ActiveMockEvalSetup & { datasetChoice: MockEvalDatasetChoice }) => {
      clearMockStreamTimers();
      activeRequestRef.current = null;
      pendingMockFinalEvaluationRef.current = null;

      const targetDatasetName = getMockEvalTargetDatasetName(setup);

      setError(null);
      setIsStreaming(true);
      setCurrentStatus('Saving fix');
      setActiveTools([]);
      setPendingPermission(null);
      setContextualSuggestedPrompts([]);
      openTextBufferRef.current = '';

      setMessages((prev) => [
        ...prev,
        {
          id: generateMessageId(),
          role: 'user',
          content: 'No, not now',
          timestamp: new Date(),
        },
        {
          id: generateMessageId(),
          role: 'assistant',
          content: '',
          timestamp: new Date(),
          isStreaming: true,
          parts: [],
        },
      ]);

      scheduleMockStreamAction(150, () => {
        writeStreamedText(
          `No problem. The fix is ready, and \`${targetDatasetName}\` remains linked so you can run the comparison later.`,
        );
      });
      scheduleMockStreamAction(650, () => {
        endStreamingTurn();
      });
    },
    [clearMockStreamTimers, endStreamingTurn, scheduleMockStreamAction, writeStreamedText],
  );

  const startMockRunFixedEvaluation = useCallback(
    (setup: ActiveMockEvalSetup & { datasetChoice: MockEvalDatasetChoice }) => {
      clearMockStreamTimers();
      activeRequestRef.current = null;
      pendingMockFinalEvaluationRef.current = null;

      const { request, primaryScorer, secondaryScorer } = setup;
      const targetDatasetName = getMockEvalTargetDatasetName(setup);
      const experimentId = request.experimentId ?? (getPageContext()['experimentId'] as string | undefined);

      setError(null);
      setIsStreaming(true);
      setCurrentStatus('Running fixed evaluation');
      setActiveTools([]);
      setPendingPermission(null);
      setContextualSuggestedPrompts([]);
      openTextBufferRef.current = '';

      setMessages((prev) => [
        ...prev,
        {
          id: generateMessageId(),
          role: 'user',
          content: 'Yes, run evaluation again',
          timestamp: new Date(),
        },
        {
          id: generateMessageId(),
          role: 'assistant',
          content: '',
          timestamp: new Date(),
          isStreaming: true,
          parts: [],
        },
      ]);

      scheduleMockStreamAction(150, () => {
        writeStreamedText(
          `I'll run the aligned evaluation again on fresh traces and compare it with the baseline result.`,
        );
      });
      scheduleMockStreamAction(650, () => {
        addToolCalls([
          {
            id: `mock-run-fixed-evaluation-${request.issueId}`,
            name: 'run_evaluation',
            input: {
              dataset: targetDatasetName,
              scorers: [primaryScorer, secondaryScorer],
              issue_id: request.issueId,
              trace_sample: 'fresh',
              compare_to: baselineEvaluationRunIdRef.current ?? 'latest baseline evaluation run',
            },
          },
        ]);
      });
      scheduleMockStreamAction(1450, () => {
        resolveToolCall({
          toolUseId: `mock-run-fixed-evaluation-${request.issueId}`,
          content: 'Fixed evaluation run completed.',
          isError: false,
        });
        writeStreamedText(
          '\n\nEvaluation finished. Compared with the baseline, aligned-judge failures dropped from 11 to 2, and the remaining failures are low-confidence edge cases.',
        );
      });
      scheduleMockStreamAction(1850, () => {
        setCurrentStatus('Finding evaluation runs');
        const latestEvaluationRunIdsPromise = experimentId
          ? getLatestEvaluationRunIds(experimentId, 2)
          : Promise.resolve([]);
        void latestEvaluationRunIdsPromise.then((latestEvaluationRunIds) => {
          addEvalComparisonSummary({
            actionId: `mock-eval-comparison-summary-${request.issueId}`,
            title: 'Evaluation comparison summary',
            metrics: [
              {
                label: 'Failing traces',
                baseline: '11',
                fixed: '2',
                delta: '-82%',
                improved: true,
              },
              {
                label: 'Pass rate',
                baseline: '78%',
                fixed: '96%',
                delta: '+18 pts',
                improved: true,
              },
              {
                label: 'P95 latency',
                baseline: '1.42s',
                fixed: '1.48s',
                delta: '+0.06s',
                improved: false,
              },
            ],
            chart: [
              { label: 'Failures', baseline: 11, fixed: 2 },
              { label: 'Pass rate', baseline: 78, fixed: 96, unit: '%' },
              { label: 'Latency p95', baseline: 1420, fixed: 1480, unit: 'ms' },
            ],
          });
          const baselineRunId =
            baselineEvaluationRunIdRef.current ??
            latestEvaluationRunIds.find((runId) => runId !== fixedEvaluationRunIdRef.current) ??
            null;
          const fixedRunId =
            latestEvaluationRunIds.find((runId) => runId !== baselineRunId) ?? latestEvaluationRunIds[0] ?? null;
          if (fixedRunId) {
            fixedEvaluationRunIdRef.current = fixedRunId;
          }
          if (experimentId && baselineRunId && fixedRunId && baselineRunId !== fixedRunId) {
            addLinkAction({
              actionId: `mock-open-eval-comparison-${request.issueId}`,
              label: 'Open comparison view',
              href: getEvaluationRunsComparisonUrl(experimentId, fixedRunId, baselineRunId),
            });
          } else {
            writeStreamedText(
              '\n\nI could not find two distinct evaluation runs to compare yet. Open the evaluation runs table once the fixed run appears.',
            );
          }
          pendingMockProductionMonitoringRef.current = getMockProductionMonitoringRequest(setup);
          writeStreamedText(
            '\n\nThe fix looks good in evaluation. I recommend setting up production monitoring with the aligned judges so regressions are caught on live traffic.',
          );
          addPromptAction({
            actionId: `mock-setup-production-monitoring-${request.issueId}`,
            label: 'Setup production monitoring',
            prompt: 'Setup production monitoring',
          });
          request.onResolve?.();
          endStreamingTurn();
        });
      });
    },
    [
      addEvalComparisonSummary,
      addLinkAction,
      addPromptAction,
      addToolCalls,
      clearMockStreamTimers,
      endStreamingTurn,
      getPageContext,
      resolveToolCall,
      scheduleMockStreamAction,
      writeStreamedText,
    ],
  );

  const beginMockEvalSetup = useCallback(
    (request: MockEvalSetupRequest) => {
      clearMockStreamTimers();
      activeRequestRef.current = null;
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      if (rafPendingRef.current !== null) {
        cancelAnimationFrame(rafPendingRef.current);
        rafPendingRef.current = null;
      }

      const traceCount = request.traceCount ?? request.traceIds?.length ?? 0;
      const traceSummary =
        request.traceIds && request.traceIds.length > 0 ? request.traceIds.slice(0, 3).join(', ') : 'impacted traces';
      const primaryScorer = request.scorerNames[0] ?? 'issue_regression_judge';
      const secondaryScorer = request.scorerNames[1] ?? 'source_alignment_judge';
      const activeSetup = { request, traceCount, traceSummary, primaryScorer, secondaryScorer };
      const userPrompt = [
        `Set up an evaluation for "${request.issueName}".`,
        `Use ${traceCount || 'the'} impacted traces to create or update a regression dataset and scorer(s).`,
        request.sourceJobId ? `Source job: ${request.sourceJobId}` : undefined,
      ]
        .filter(Boolean)
        .join('\n');

      request.onStart?.();
      activeMockEvalSetupRef.current = activeSetup;
      lastMockEvalSetupRef.current = null;
      pendingMockJudgeAlignmentRef.current = null;
      pendingMockAlignedEvaluationRef.current = null;
      pendingMockFixRef.current = null;
      pendingMockFinalEvaluationRef.current = null;
      pendingMockIssueResolutionRef.current = null;
      pendingMockProductionMonitoringRef.current = null;
      pendingMockProductionMonitoringNudgeRef.current = null;
      baselineEvaluationRunIdRef.current = null;
      fixedEvaluationRunIdRef.current = null;
      setIsPanelOpen(true);
      setSetupComplete(true);
      setIsLoadingConfig(false);
      setSessionId(`mock-eval-setup-${request.issueId}`);
      setError(null);
      setIsStreaming(true);
      setCurrentStatus('Preparing eval setup');
      setActiveTools([]);
      setPendingPermission(null);
      setContextualSuggestedPrompts([]);
      openTextBufferRef.current = '';

      const setupMessages: ChatMessage[] = [
        {
          id: generateMessageId(),
          role: 'user',
          content: userPrompt,
          timestamp: new Date(),
        },
        {
          id: generateMessageId(),
          role: 'assistant',
          content: '',
          timestamp: new Date(),
          isStreaming: true,
          parts: [],
        },
      ];
      if (request.appendToCurrentThread) {
        setMessages((prev) => [...prev, ...setupMessages]);
      } else {
        setMessages(setupMessages);
      }

      scheduleMockStreamAction(150, () => {
        writeStreamedText(
          [
            "I'll turn this issue into an evaluation package:",
            'dataset records from the impacted traces and judges that detect the same failure mode.',
          ].join(' '),
        );
      });
      scheduleMockStreamAction(700, () => {
        setCurrentStatus('Checking existing datasets');
        addToolCalls([
          {
            id: `mock-find-golden-dataset-${request.issueId}`,
            name: 'find_golden_datasets',
            input: { experiment_id: getPageContext()['experimentId'], issue_id: request.issueId },
          },
        ]);
      });
      scheduleMockStreamAction(1350, () => {
        resolveToolCall({
          toolUseId: `mock-find-golden-dataset-${request.issueId}`,
          content: request.goldenDatasetName
            ? `Found ${request.goldenDatasetName} with ${request.goldenDatasetRecordCount ?? 'existing'} records.`
            : 'No existing golden dataset found.',
          isError: false,
        });
        writeStreamedText(
          request.goldenDatasetName
            ? `\n\nI found an existing golden dataset, \`${request.goldenDatasetName}\`. Do you want to add the ${
                traceCount || 0
              } new records there, or create a dedicated dataset \`${request.datasetName}\` for this issue?`
            : `\n\nI did not find a golden dataset, so I can create \`${request.datasetName}\` for this issue.`,
        );
      });
      scheduleMockStreamAction(1750, () => {
        addSelectionPrompt({
          selectionId: `mock-select-eval-target-${request.issueId}`,
          title: 'Where should I put these examples?',
          description: request.goldenDatasetName
            ? `I found ${request.goldenDatasetName} with ${request.goldenDatasetRecordCount ?? 'existing'} records.`
            : 'No matching golden dataset was found, so I can create a dedicated regression dataset.',
          defaultValue: 'new',
          continueLabel: 'Continue',
          options: request.goldenDatasetName
            ? [
                {
                  value: 'golden',
                  label: 'Add to existing dataset',
                  description: `Add ${traceCount || 0} issue records to ${request.goldenDatasetName}.`,
                },
                {
                  value: 'new',
                  label: 'Create new dataset',
                  description: `Create ${request.datasetName} for this issue.`,
                  recommended: true,
                },
              ]
            : [
                {
                  value: 'new',
                  label: 'Create new dataset',
                  description: `Create ${request.datasetName} for this issue.`,
                  recommended: true,
                },
              ],
        });
        endStreamingTurn();
      });
    },
    [
      addToolCalls,
      addSelectionPrompt,
      clearMockStreamTimers,
      endStreamingTurn,
      getPageContext,
      resolveToolCall,
      scheduleMockStreamAction,
      setIsPanelOpen,
      writeStreamedText,
    ],
  );

  const startMockResolveWithoutEval = useCallback(
    (request: MockEvalSetupRequest) => {
      clearMockStreamTimers();
      activeRequestRef.current = null;
      pendingMockIssueResolutionRef.current = null;
      pendingMockProductionMonitoringRef.current = null;
      pendingMockProductionMonitoringNudgeRef.current = null;

      setError(null);
      setIsStreaming(true);
      setCurrentStatus('Resolving issue');
      setActiveTools([]);
      setPendingPermission(null);
      setContextualSuggestedPrompts([]);
      openTextBufferRef.current = '';

      setMessages((prev) => [
        ...prev,
        {
          id: generateMessageId(),
          role: 'user',
          content: 'Resolve without eval',
          timestamp: new Date(),
        },
        {
          id: generateMessageId(),
          role: 'assistant',
          content: '',
          timestamp: new Date(),
          isStreaming: true,
          parts: [],
        },
      ]);

      scheduleMockStreamAction(150, () => {
        writeStreamedText('Got it. I marked the issue as resolved without creating a golden eval.');
      });
      scheduleMockStreamAction(650, () => {
        request.onResolve?.();
        endStreamingTurn();
      });
    },
    [clearMockStreamTimers, endStreamingTurn, scheduleMockStreamAction, writeStreamedText],
  );

  const startMockIssueResolution = useCallback(
    (request: MockEvalSetupRequest) => {
      clearMockStreamTimers();
      activeRequestRef.current = null;
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      if (rafPendingRef.current !== null) {
        cancelAnimationFrame(rafPendingRef.current);
        rafPendingRef.current = null;
      }

      pendingMockIssueResolutionRef.current = request;
      activeMockEvalSetupRef.current = null;
      lastMockEvalSetupRef.current = null;
      pendingMockJudgeAlignmentRef.current = null;
      pendingMockAlignedEvaluationRef.current = null;
      pendingMockFixRef.current = null;
      pendingMockFinalEvaluationRef.current = null;
      pendingMockProductionMonitoringRef.current = null;
      pendingMockProductionMonitoringNudgeRef.current = null;
      baselineEvaluationRunIdRef.current = null;
      fixedEvaluationRunIdRef.current = null;
      setIsPanelOpen(true);
      setSetupComplete(true);
      setIsLoadingConfig(false);
      setSessionId(`mock-resolve-issue-${request.issueId}`);
      setError(null);
      setIsStreaming(true);
      setCurrentStatus('Preparing resolution');
      setActiveTools([]);
      setPendingPermission(null);
      setContextualSuggestedPrompts([]);
      openTextBufferRef.current = '';

      setMessages([
        {
          id: generateMessageId(),
          role: 'user',
          content: `Mark issue as resolved: ${request.issueName}`,
          timestamp: new Date(),
        },
        {
          id: generateMessageId(),
          role: 'assistant',
          content: '',
          timestamp: new Date(),
          isStreaming: true,
          parts: [],
        },
      ]);

      scheduleMockStreamAction(150, () => {
        writeStreamedText(
          'Before I resolve this, I can create a golden eval from the issue traces so the same failure does not regress.',
        );
      });
      scheduleMockStreamAction(600, () => {
        addSelectionPrompt({
          selectionId: `mock-resolve-create-eval-${request.issueId}`,
          title: 'Create a golden eval before resolving?',
          description:
            'I can use the impacted traces and generated judges to create or update a golden test suite. This is recommended for fixed issues.',
          defaultValue: 'create',
          continueLabel: 'Continue',
          options: [
            {
              value: 'create',
              label: 'Yes, create eval',
              description: 'Create or update a golden dataset and judges, then resolve the issue.',
              recommended: true,
            },
            {
              value: 'skip',
              label: 'Resolve without eval',
              description: 'Mark this issue resolved without adding regression coverage.',
            },
          ],
        });
        endStreamingTurn();
      });
    },
    [
      addSelectionPrompt,
      clearMockStreamTimers,
      endStreamingTurn,
      scheduleMockStreamAction,
      setIsPanelOpen,
      writeStreamedText,
    ],
  );

  const startMockProductionMonitoring = useCallback(
    (request: MockProductionMonitoringRequest) => {
      clearMockStreamTimers();
      activeRequestRef.current = null;
      pendingMockProductionMonitoringRef.current = null;
      pendingMockProductionMonitoringNudgeRef.current = null;
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      if (rafPendingRef.current !== null) {
        cancelAnimationFrame(rafPendingRef.current);
        rafPendingRef.current = null;
      }

      const samplingPercent = Math.round(request.samplingRatio * 100);
      const scorerNames = request.scorerNames.length ? request.scorerNames : ['linked_issue_judge'];
      const scorerList = scorerNames.map((scorerName) => `\`${scorerName}\``).join(', ');

      request.onStart?.();
      setIsPanelOpen(true);
      setSetupComplete(true);
      setIsLoadingConfig(false);
      setSessionId(`mock-production-monitoring-${request.issueId}`);
      setError(null);
      setIsStreaming(true);
      setCurrentStatus('Preparing production monitor');
      setActiveTools([]);
      setPendingPermission(null);
      setContextualSuggestedPrompts([]);
      openTextBufferRef.current = '';

      const productionMonitoringMessages: ChatMessage[] = [
        {
          id: generateMessageId(),
          role: 'user',
          content: `Monitor issue in production: ${request.issueName}`,
          timestamp: new Date(),
        },
        {
          id: generateMessageId(),
          role: 'assistant',
          content: '',
          timestamp: new Date(),
          isStreaming: true,
          parts: [],
        },
      ];
      if (request.appendToCurrentThread) {
        setMessages((prev) => [...prev, ...productionMonitoringMessages]);
      } else {
        setMessages(productionMonitoringMessages);
      }

      scheduleMockStreamAction(150, () => {
        writeStreamedText(
          `I'll turn the linked eval judges into an online monitor for "${request.issueName}" with a ${samplingPercent}% sampling ratio.`,
        );
      });
      scheduleMockStreamAction(700, () => {
        setCurrentStatus('Configuring online judges');
        addToolCalls([
          {
            id: `mock-configure-online-judges-${request.issueId}`,
            name: 'configure_online_judges',
            input: {
              issue_id: request.issueId,
              experiment_id: request.experimentId ?? getPageContext()['experimentId'],
              dataset: request.datasetName,
              scorers: scorerNames,
              sampling_ratio: request.samplingRatio,
              source_job: request.sourceJobId,
            },
          },
        ]);
      });
      scheduleMockStreamAction(1550, () => {
        resolveToolCall({
          toolUseId: `mock-configure-online-judges-${request.issueId}`,
          content: `Enabled ${scorerNames.length} online judges at ${samplingPercent}% sampling.`,
          isError: false,
        });
        writeStreamedText(
          `\n\nEnabled ${scorerList} on production traffic at ${samplingPercent}% sampling. New failures will be linked back to this issue's eval package.`,
        );
      });
      scheduleMockStreamAction(2100, () => {
        setCurrentStatus('Saving monitor');
        request.onComplete?.();
        writeStreamedText(
          '\n\nMonitor is ready. You can adjust the sampling ratio later from the online judges configuration.',
        );
        endStreamingTurn();
      });
    },
    [
      addToolCalls,
      clearMockStreamTimers,
      endStreamingTurn,
      getPageContext,
      resolveToolCall,
      scheduleMockStreamAction,
      setIsPanelOpen,
      writeStreamedText,
    ],
  );

  const startMockResolveWithoutProductionMonitoring = useCallback(
    (request: MockProductionMonitoringRequest) => {
      clearMockStreamTimers();
      activeRequestRef.current = null;
      pendingMockProductionMonitoringNudgeRef.current = null;

      setError(null);
      setIsStreaming(true);
      setCurrentStatus('Resolving issue');
      setActiveTools([]);
      setPendingPermission(null);
      setContextualSuggestedPrompts([]);
      openTextBufferRef.current = '';

      setMessages((prev) => [
        ...prev,
        {
          id: generateMessageId(),
          role: 'user',
          content: 'Resolve without production monitoring',
          timestamp: new Date(),
        },
        {
          id: generateMessageId(),
          role: 'assistant',
          content: '',
          timestamp: new Date(),
          isStreaming: true,
          parts: [],
        },
      ]);

      scheduleMockStreamAction(150, () => {
        writeStreamedText(
          'Got it. I marked the issue as resolved without production monitoring. The eval package remains linked if you want to enable monitoring later.',
        );
      });
      scheduleMockStreamAction(650, () => {
        request.onResolve?.();
        endStreamingTurn();
      });
    },
    [clearMockStreamTimers, endStreamingTurn, scheduleMockStreamAction, writeStreamedText],
  );

  const startMockProductionMonitoringNudge = useCallback(
    (request: MockProductionMonitoringRequest) => {
      clearMockStreamTimers();
      activeRequestRef.current = null;
      pendingMockProductionMonitoringNudgeRef.current = request;
      pendingMockProductionMonitoringRef.current = null;
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      if (rafPendingRef.current !== null) {
        cancelAnimationFrame(rafPendingRef.current);
        rafPendingRef.current = null;
      }

      setIsPanelOpen(true);
      setSetupComplete(true);
      setIsLoadingConfig(false);
      setSessionId(`mock-production-monitoring-nudge-${request.issueId}`);
      setError(null);
      setIsStreaming(true);
      setCurrentStatus('Preparing production monitoring prompt');
      setActiveTools([]);
      setPendingPermission(null);
      setContextualSuggestedPrompts([]);
      openTextBufferRef.current = '';

      setMessages([
        {
          id: generateMessageId(),
          role: 'user',
          content: `Mark issue as resolved: ${request.issueName}`,
          timestamp: new Date(),
        },
        {
          id: generateMessageId(),
          role: 'assistant',
          content: '',
          timestamp: new Date(),
          isStreaming: true,
          parts: [],
        },
      ]);

      scheduleMockStreamAction(150, () => {
        writeStreamedText(
          'This issue already has an eval, but production monitoring is not enabled yet. I recommend turning the aligned judges into an online monitor before resolving it.',
        );
      });
      scheduleMockStreamAction(600, () => {
        addSelectionPrompt({
          selectionId: `mock-resolve-monitor-production-${request.issueId}`,
          title: 'Set up production monitoring before resolving?',
          description:
            'This enables the linked judges on sampled production traffic so regressions reopen as new issue signals.',
          defaultValue: 'monitor',
          continueLabel: 'Continue',
          options: [
            {
              value: 'monitor',
              label: 'Yes, monitor in production',
              description: 'Enable online monitoring, then mark the issue as resolved.',
              recommended: true,
              prompt: 'Setup production monitoring',
            },
            {
              value: 'skip',
              label: 'Resolve without monitoring',
              description: 'Mark resolved now and leave monitoring disabled.',
              prompt: 'Resolve without production monitoring',
            },
          ],
        });
        endStreamingTurn();
      });
    },
    [
      addSelectionPrompt,
      clearMockStreamTimers,
      endStreamingTurn,
      scheduleMockStreamAction,
      setIsPanelOpen,
      writeStreamedText,
    ],
  );

  const handleSendMessage = useCallback(
    async (message: string) => {
      clearMockStreamTimers();
      const normalizedMessage = message.trim().toLowerCase();
      const pendingMockIssueResolution = pendingMockIssueResolutionRef.current;
      const pendingMockProductionMonitoringNudge = pendingMockProductionMonitoringNudgeRef.current;
      if (pendingMockProductionMonitoringNudge) {
        if (normalizedMessage.includes('without') || normalizedMessage.includes('skip') || normalizedMessage === 'no') {
          startMockResolveWithoutProductionMonitoring(pendingMockProductionMonitoringNudge);
          return;
        }
        if (
          normalizedMessage.includes('monitor') ||
          normalizedMessage.includes('production') ||
          normalizedMessage.includes('yes') ||
          normalizedMessage.includes('setup')
        ) {
          startMockProductionMonitoring({
            ...pendingMockProductionMonitoringNudge,
            appendToCurrentThread: true,
            onComplete: () => {
              pendingMockProductionMonitoringNudge.onComplete?.();
              pendingMockProductionMonitoringNudge.onResolve?.();
            },
          });
          return;
        }
      }
      const pendingMockProductionMonitoring = pendingMockProductionMonitoringRef.current;
      if (
        pendingMockProductionMonitoring &&
        (normalizedMessage.includes('monitor') ||
          normalizedMessage.includes('production') ||
          normalizedMessage.includes('setup'))
      ) {
        startMockProductionMonitoring({ ...pendingMockProductionMonitoring, appendToCurrentThread: true });
        return;
      }
      if (pendingMockIssueResolution) {
        if (
          normalizedMessage.includes('without') ||
          normalizedMessage.includes('skip') ||
          normalizedMessage.includes('no')
        ) {
          startMockResolveWithoutEval(pendingMockIssueResolution);
          return;
        }
        if (
          normalizedMessage.includes('yes') ||
          normalizedMessage.includes('create') ||
          normalizedMessage.includes('eval')
        ) {
          beginMockEvalSetup({ ...pendingMockIssueResolution, appendToCurrentThread: true });
          return;
        }
      }
      const activeMockEvalSetup = activeMockEvalSetupRef.current;
      if (activeMockEvalSetup) {
        if (normalizedMessage.includes('golden') || normalizedMessage.includes('existing')) {
          startMockEvalArtifactCreation(activeMockEvalSetup, 'golden');
          return;
        }
        if (
          normalizedMessage.includes('new') ||
          normalizedMessage.includes('dedicated') ||
          normalizedMessage.includes('create')
        ) {
          startMockEvalArtifactCreation(activeMockEvalSetup, 'new');
          return;
        }
      }
      const pendingMockJudgeAlignment = pendingMockJudgeAlignmentRef.current;
      if (pendingMockJudgeAlignment) {
        if (normalizedMessage.includes('skip') || normalizedMessage.includes('no')) {
          startMockSkipJudgeAlignment(pendingMockJudgeAlignment);
          return;
        }
        if (
          normalizedMessage.includes('align') ||
          normalizedMessage.includes('fine-tune') ||
          normalizedMessage.includes('yes')
        ) {
          startMockJudgeAlignment(pendingMockJudgeAlignment);
          return;
        }
      }
      const pendingMockAlignedEvaluation = pendingMockAlignedEvaluationRef.current;
      if (pendingMockAlignedEvaluation) {
        if (
          normalizedMessage.includes('re-run') ||
          normalizedMessage.includes('rerun') ||
          normalizedMessage === 'run evaluation' ||
          normalizedMessage.includes('run evaluation')
        ) {
          startMockRerunAlignedEvaluation(pendingMockAlignedEvaluation);
          return;
        }
      }
      const pendingMockFix = pendingMockFixRef.current;
      if (pendingMockFix) {
        if (
          normalizedMessage.includes('fix it') ||
          normalizedMessage.includes('apply') ||
          normalizedMessage.includes('fixed') ||
          normalizedMessage.includes('ready')
        ) {
          startMockApplyFix(pendingMockFix);
          return;
        }
      }
      const pendingMockFinalEvaluation = pendingMockFinalEvaluationRef.current;
      if (pendingMockFinalEvaluation) {
        if (
          normalizedMessage.includes('yes') ||
          normalizedMessage.includes('run') ||
          normalizedMessage.includes('evaluation')
        ) {
          startMockRunFixedEvaluation(pendingMockFinalEvaluation);
          return;
        }
        if (
          normalizedMessage.includes('not now') ||
          normalizedMessage.includes('later') ||
          normalizedMessage.includes('skip') ||
          normalizedMessage === 'no'
        ) {
          startMockDeferFixedEvaluation(pendingMockFinalEvaluation);
          return;
        }
      }
      const lastMockEvalSetup = lastMockEvalSetupRef.current;
      if (lastMockEvalSetup) {
        if (normalizedMessage.includes('analyze') && normalizedMessage.includes('result')) {
          startMockAnalyzeEvaluationResult(lastMockEvalSetup);
          return;
        }
        if (
          normalizedMessage === 'run evaluation' ||
          (normalizedMessage.includes('yes') && normalizedMessage.includes('evaluation'))
        ) {
          startMockRunEvaluation(lastMockEvalSetup);
          return;
        }
        if (
          normalizedMessage.includes('not now') ||
          normalizedMessage.includes('later') ||
          normalizedMessage.includes('skip') ||
          normalizedMessage === 'no'
        ) {
          startMockDeferEvaluation(lastMockEvalSetup);
          return;
        }
      }
      if (!sessionId) {
        startChat(message);
        return;
      }

      const isCurrent = beginRequest();

      setError(null);
      setIsStreaming(true);
      setContextualSuggestedPrompts([]);
      setPendingPermission(null);

      // Add user message
      setMessages((prev) => [
        ...prev,
        {
          id: generateMessageId(),
          role: 'user',
          content: message,
          timestamp: new Date(),
        },
      ]);

      // Add streaming assistant message placeholder
      openTextBufferRef.current = '';
      setMessages((prev) => [
        ...prev,
        {
          id: generateMessageId(),
          role: 'assistant',
          content: '',
          timestamp: new Date(),
          isStreaming: true,
        },
      ]);

      // Send message and stream response
      const pageContext = getPageContext();
      const result = await sendMessageStream(
        {
          session_id: sessionId,
          message,
          experiment_id: pageContext['experimentId'] as string | undefined,
          context: pageContext,
        },
        withGuard(isCurrent, streamCallbacks),
      );
      attachStreamIfCurrent(isCurrent, result);
    },
    [
      clearMockStreamTimers,
      sessionId,
      startChat,
      beginRequest,
      attachStreamIfCurrent,
      getPageContext,
      streamCallbacks,
      beginMockEvalSetup,
      startMockEvalArtifactCreation,
      startMockJudgeAlignment,
      startMockResolveWithoutEval,
      startMockSkipJudgeAlignment,
      startMockDeferEvaluation,
      startMockAnalyzeEvaluationResult,
      startMockRerunAlignedEvaluation,
      startMockApplyFix,
      startMockRunFixedEvaluation,
      startMockDeferFixedEvaluation,
      startMockProductionMonitoring,
      startMockResolveWithoutProductionMonitoring,
      startMockRunEvaluation,
    ],
  );

  const handleCancelSession = useCallback(() => {
    clearMockStreamTimers();
    if (!sessionId || !isStreaming) return;

    // Invalidate any in-flight send so a late POST can't reopen a stream after cancel
    activeRequestRef.current = null;

    // Close EventSource immediately to stop receiving data
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }

    // Send cancel request to backend
    cancelSessionApi(sessionId).catch((err) => {
      if (err) {
        // fail silently
      }
    });

    // Flush any buffered text and mark the turn interrupted through the shared terminal,
    // matching the server-driven interrupt path (interruptStreamingTurn) so a user cancel
    // can't drop text buffered since the last RAF flush.
    if (rafPendingRef.current !== null) {
      cancelAnimationFrame(rafPendingRef.current);
      rafPendingRef.current = null;
    }
    closeStreamingMessage({ reason: TurnEndReason.Interrupted });

    setIsStreaming(false);
    setCurrentStatus(null);
    setActiveTools([]);
    setPendingPermission(null);
    setContextualSuggestedPrompts([]);
  }, [clearMockStreamTimers, sessionId, isStreaming, closeStreamingMessage]);

  const startMockEvalSetup = useCallback(
    (request: MockEvalSetupRequest) => {
      beginMockEvalSetup(request);
    },
    [beginMockEvalSetup],
  );

  const regenerateLastMessage = useCallback(async () => {
    // Prevent regeneration while already streaming
    if (isStreaming) {
      return;
    }

    // Find the last user message from current state
    const lastUserMessageIndex = messages.findLastIndex((msg) => msg.role === 'user');
    if (lastUserMessageIndex === -1) {
      return; // No user message to regenerate from
    }

    clearMockStreamTimers();
    const isCurrent = beginRequest();

    const userMessageContent = messages[lastUserMessageIndex].content;

    // Set streaming state BEFORE modifying messages
    setError(null);
    setIsStreaming(true);
    openTextBufferRef.current = '';

    // Remove all messages after the last user message and add streaming placeholder
    setMessages((prev) => {
      const lastUserIdx = prev.findLastIndex((msg) => msg.role === 'user');

      if (lastUserIdx === -1) {
        return prev;
      }

      // Keep messages up to and including the last user message
      const messagesUpToLastUser = prev.slice(0, lastUserIdx + 1);

      // Add the new streaming placeholder
      return [
        ...messagesUpToLastUser,
        {
          id: generateMessageId(),
          role: 'assistant' as const,
          content: '',
          timestamp: new Date(),
          isStreaming: true,
        },
      ];
    });

    // Re-send the last user message
    const pageContext = getPageContext();
    const result = await sendMessageStream(
      {
        session_id: sessionId ?? undefined,
        message: userMessageContent,
        experiment_id: pageContext['experimentId'] as string | undefined,
        context: pageContext,
      },
      withGuard(isCurrent, streamCallbacks),
    );
    attachStreamIfCurrent(isCurrent, result);
  }, [
    messages,
    sessionId,
    isStreaming,
    clearMockStreamTimers,
    beginRequest,
    attachStreamIfCurrent,
    getPageContext,
    streamCallbacks,
  ]);

  const value: AssistantAgentContextType = {
    // State
    isPanelOpen,
    sessionId,
    messages,
    isStreaming,
    error,
    currentStatus,
    activeTools,
    setupComplete,
    isLoadingConfig,
    isLocalServer,
    pendingPrompt,
    contextualSuggestedPrompts,
    pendingPermission,
    canUseAssistant,
    tokenUsage,
    // Actions
    openPanel,
    closePanel,
    sendMessage: handleSendMessage,
    prefillPrompt,
    clearPendingPrompt,
    regenerateLastMessage,
    reset,
    cancelSession: handleCancelSession,
    refreshConfig,
    completeSetup,
    respondToPermission,
    startMockEvalSetup,
    startMockIssueResolution,
    startMockProductionMonitoring,
    startMockProductionMonitoringNudge,
  };

  return <AssistantReactContext.Provider value={value}>{children}</AssistantReactContext.Provider>;
};

// Default disabled state when no provider is present
const disabledAssistantContext: AssistantAgentContextType = {
  isPanelOpen: false,
  sessionId: null,
  messages: [],
  isStreaming: false,
  error: null,
  currentStatus: null,
  activeTools: [],
  setupComplete: false,
  isLoadingConfig: false,
  isLocalServer: false,
  pendingPrompt: null,
  contextualSuggestedPrompts: [],
  pendingPermission: null,
  canUseAssistant: false,
  tokenUsage: { promptTokens: 0, completionTokens: 0, totalTokens: 0, costUsd: null },
  openPanel: () => {},
  closePanel: () => {},
  sendMessage: () => {},
  prefillPrompt: () => {},
  clearPendingPrompt: () => {},
  regenerateLastMessage: () => {},
  reset: () => {},
  cancelSession: () => {},
  refreshConfig: () => Promise.resolve(),
  completeSetup: () => {},
  respondToPermission: () => {},
  startMockEvalSetup: () => {},
  startMockIssueResolution: () => {},
  startMockProductionMonitoring: () => {},
  startMockProductionMonitoringNudge: () => {},
};

/**
 * Hook to access the Assistant context.
 */
export const useAssistant = (): AssistantAgentContextType => {
  const context = useContext(AssistantReactContext);
  return context ?? disabledAssistantContext;
};
