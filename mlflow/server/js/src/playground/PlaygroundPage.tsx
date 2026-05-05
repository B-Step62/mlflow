import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

// Deep-imports of the trace-explorer subcomponents — the public barrel
// (`@databricks/web-shared/model-trace-explorer`) only exposes the full
// `<ModelTraceExplorer>` which forces a horizontal split and renders header
// chrome we don't want here. We reach into the source tree to compose a
// vertical playground-shaped layout (pills → tree → I/O) using the same
// primitives the regular trace view uses.
import {
  ModelTraceExplorerViewStateProvider,
  useModelTraceExplorerViewState,
} from '../shared/web-shared/model-trace-explorer/ModelTraceExplorerViewStateContext';
import { TimelineTree } from '../shared/web-shared/model-trace-explorer/timeline-tree/TimelineTree';
import { ModelTraceExplorerContentTab } from '../shared/web-shared/model-trace-explorer/right-pane/ModelTraceExplorerContentTab';
import { ModelTraceHeaderStatusTag } from '../shared/web-shared/model-trace-explorer/ModelTraceHeaderStatusTag';
import {
  ModelTraceExplorerCostHoverCard,
  isTraceCostType,
  type TraceCost,
} from '../shared/web-shared/model-trace-explorer/ModelTraceExplorerCostHoverCard';
import {
  ModelTraceExplorerTokenUsageHoverCard,
  isTokenUsageType,
  type TokenUsage,
} from '../shared/web-shared/model-trace-explorer/ModelTraceExplorerTokenUsageHoverCard';
import { ModelTraceHeaderMetricSection } from '../shared/web-shared/model-trace-explorer/ModelTraceExplorerMetricSection';
import {
  getTraceCost,
  getTraceTokenUsage,
  isV3ModelTraceInfo as _isV3,
} from '../shared/web-shared/model-trace-explorer/ModelTraceExplorer.utils';
import { truncateToFirstLineWithMaxLength } from '../shared/web-shared/model-trace-explorer/TagUtils';
import {
  spanTimeFormatter,
  useTimelineTreeExpandedNodes,
} from '../shared/web-shared/model-trace-explorer/timeline-tree/TimelineTree.utils';
import { useModelTraceSearch } from '../shared/web-shared/model-trace-explorer/hooks/useModelTraceSearch';
import { ClockIcon } from '@databricks/design-system';
import type { ModelTraceState } from '../shared/web-shared/model-trace-explorer/ModelTrace.types';
import { FormattedMessage } from 'react-intl';

import ErrorUtils from '../common/utils/ErrorUtils';
import { withErrorBoundary } from '../common/utils/withErrorBoundary';
import { Alert, Button, Input, Spinner, Typography, useDesignSystemTheme } from '@databricks/design-system';
import type { ModelTraceInfoV3 } from '@databricks/web-shared/model-trace-explorer';
import {
  isV3ModelTraceInfo,
  ModelTraceExplorer,
  ModelTraceExplorerContextProvider,
  ModelTraceExplorerDrawer,
  ModelTraceExplorerPreferencesProvider,
  ModelTraceExplorerUpdateTraceContextProvider,
} from '@databricks/web-shared/model-trace-explorer';
import type { ModelTrace } from '@databricks/web-shared/model-trace-explorer';
import { TracesServiceV3 } from '@databricks/web-shared/model-trace-explorer';
import {
  getAjaxUrl,
  getDefaultHeaders,
} from '../shared/web-shared/model-trace-explorer/ModelTraceExplorer.request.utils';
import { useParams } from '../common/utils/RoutingUtils';
import {
  DispatchModal,
  FeedbackComposer,
  FeedbackRail,
  FloatingAnnotateButton,
  dispatchFeedback,
  feedbacksFromTraceAssessments,
  persistFeedback,
  resolveAnchorOffsets,
  tagFeedbackWithIssueId,
  useChatSelection,
  type AssistantMessageAnchor,
  type PlaygroundFeedback,
} from './feedback';
import { IssueDetailDrawer } from './issues';

type MessageRole = 'user' | 'assistant' | 'system' | 'developer';

type ToolCall = {
  name: string;
  span_id?: string;
  duration_ms?: number | null;
  inputs?: unknown;
  outputs?: unknown;
};

type PlaygroundMessage = {
  id: string;
  role: MessageRole;
  content: string;
  // Client-generated id sent with the chat request; the agent tags the resulting
  // trace with `playground.request_id = requestId` so we can look it up by tag
  // independently of the SSE response shape.
  requestId?: string;
  traceId?: string;
  toolCalls?: ToolCall[];
};

type PlaygroundConfig = {
  agent_url: string;
  agent_connected: boolean;
  experiment?: string;
  worker_kind?: string;
  tracing_enabled?: boolean;
};

type StreamEvent =
  | { type: 'assistant_delta'; delta: string }
  | {
      type: 'assistant_final';
      message: { role: 'assistant'; content: string };
      trace_id?: string;
      tool_calls?: ToolCall[];
    }
  | { type: 'done' };

const createMessageId = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const createRequestId = () => {
  // Browser-native UUID is preferred; fall back to a random hex string for
  // older runtimes (jsdom in tests, very old browsers).
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `req-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
};

const TRACE_LOOKUP_INTERVAL_MS = 500;
const TRACE_LOOKUP_TIMEOUT_MS = 30_000;
// Cadence for re-fetching the active trace so the inline trace panel keeps
// growing as new spans land. Stops once the trace state finalizes (OK / ERROR).
const LIVE_TRACE_REFRESH_MS = 1_000;

const fetchTraceSpansV3 = async (traceId: string, signal?: AbortSignal): Promise<ModelTrace | null> => {
  // Use the same fetcher the Experiment Traces tab uses — `TracesServiceV3.getTraceV3`
  // combines `/api/3.0/mlflow/traces/{traceId}` (info) and
  // `/api/3.0/mlflow/get-trace-artifact?request_id=...` (spans). The artifact
  // endpoint returns spans with a flat attribute dict (JSON-encoded values),
  // which is what the explorer's parser expects. The other route —
  // `getExperimentTraceV3({ traceId })` — returns OTel-protobuf-shaped
  // attributes (`{kvlist_value: ...}`) which renderers downstream don't handle,
  // producing the literal string "kvlist_value" in the inline I/O pane.
  const trace = (await TracesServiceV3.getTraceV3(traceId)) as ModelTrace | undefined;
  if (signal?.aborted || !trace) {
    return null;
  }
  if (trace.info && trace.data) {
    return trace;
  }
  return null;
};

/**
 * Look up a trace by the request id we tagged it with. The agent server attaches
 * `playground.request_id = <requestId>` to the trace via the
 * `x-mlflow-trace-tags` header, so once the trace is persisted we can find it
 * here without depending on the agent's response shape.
 */
const lookupTraceIdByRequestId = async (
  experimentId: string,
  requestId: string,
  signal: AbortSignal,
): Promise<string | null> => {
  const deadline = Date.now() + TRACE_LOOKUP_TIMEOUT_MS;
  while (!signal.aborted && Date.now() < deadline) {
    try {
      const response = await fetch(getAjaxUrl('ajax-api/3.0/mlflow/traces/search'), {
        method: 'POST',
        signal,
        headers: {
          'Content-Type': 'application/json',
          ...getDefaultHeaders(document.cookie),
        },
        body: JSON.stringify({
          locations: [
            {
              type: 'MLFLOW_EXPERIMENT',
              mlflow_experiment: { experiment_id: experimentId },
            },
          ],
          filter: `tags.\"playground.request_id\" = '${requestId}'`,
          max_results: 1,
        }),
      });
      if (response.ok) {
        const payload = (await response.json()) as { traces?: { trace_id?: string }[] };
        const traceId = payload?.traces?.[0]?.trace_id;
        if (traceId) {
          return traceId;
        }
      }
    } catch (e) {
      if (signal.aborted) {
        return null;
      }
      // network blip — keep polling
    }
    await new Promise((resolve) => setTimeout(resolve, TRACE_LOOKUP_INTERVAL_MS));
  }
  return null;
};

const parseErrorText = async (response: Response) => {
  try {
    const payload = await response.json();
    if (typeof payload?.detail === 'string') {
      return payload.detail;
    }
    return JSON.stringify(payload);
  } catch {
    return response.statusText || 'Request failed';
  }
};

const parseSseChunk = (rawChunk: string, onEvent: (event: StreamEvent) => void) => {
  const dataLines = rawChunk
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trim())
    .filter(Boolean);

  for (const line of dataLines) {
    onEvent(JSON.parse(line) as StreamEvent);
  }
};

/**
 * Compact header strip for the inline trace pane. Renders ONLY the pills the
 * playground needs (status / tokens / cost / latency) by re-using the same
 * components `ModelTraceHeaderDetails` uses, so the styling stays
 * pixel-identical to the regular trace view. Trace-id, tags, and user/session
 * pills are intentionally omitted; full detail is available via "Open full trace".
 */
const PlaygroundTraceHeaderPills = ({ traceInfo }: { traceInfo: ModelTrace['info'] }) => {
  const { theme } = useDesignSystemTheme();
  const { rootNode } = useModelTraceExplorerViewState();
  const tokenUsage = useMemo<Partial<TokenUsage> | undefined>(
    () => getTraceTokenUsage(traceInfo as ModelTraceInfoV3) as Partial<TokenUsage> | undefined,
    [traceInfo],
  );
  const cost = useMemo<Partial<TraceCost> | undefined>(
    () => getTraceCost(traceInfo as ModelTraceInfoV3) as Partial<TraceCost> | undefined,
    [traceInfo],
  );
  const statusState: ModelTraceState | undefined = useMemo(
    () => (_isV3(traceInfo) ? (traceInfo as ModelTraceInfoV3).state : undefined),
    [traceInfo],
  );
  const latency = useMemo(() => (rootNode ? spanTimeFormatter(rootNode.end - rootNode.start) : undefined), [rootNode]);
  const getTruncatedLabel = useCallback((label: string) => truncateToFirstLineWithMaxLength(label, 40), []);
  return (
    <div
      css={{
        display: 'flex',
        flexDirection: 'row',
        gap: theme.spacing.md,
        rowGap: theme.spacing.sm,
        flexWrap: 'wrap',
        paddingLeft: theme.spacing.md,
        paddingTop: theme.spacing.sm,
        paddingBottom: theme.spacing.sm,
        borderBottom: `1px solid ${theme.colors.border}`,
      }}
    >
      {statusState && <ModelTraceHeaderStatusTag statusState={statusState} getTruncatedLabel={getTruncatedLabel} />}
      {isTokenUsageType(tokenUsage) && <ModelTraceExplorerTokenUsageHoverCard tokenUsage={tokenUsage} />}
      {isTraceCostType(cost) && <ModelTraceExplorerCostHoverCard cost={cost} />}
      {latency && (
        <ModelTraceHeaderMetricSection
          label={<FormattedMessage defaultMessage="Latency" description="Label for the latency section" />}
          icon={<ClockIcon css={{ fontSize: 12, display: 'flex', alignItems: 'center', justifyContent: 'center' }} />}
          value={latency}
          getTruncatedLabel={getTruncatedLabel}
          onCopy={() => undefined}
        />
      )}
    </div>
  );
};

/**
 * Inner body of `PlaygroundTracePane`. Lives inside `ModelTraceExplorerViewStateProvider`
 * so it can share `selectedNode` / `expandedKeys` / etc. with the same view-state
 * that the regular trace explorer uses. Layout:
 *
 *   ┌───────────────────────────────┐
 *   │ status / tokens / cost / lat  │  ← PlaygroundTraceHeaderPills
 *   ├───────────────────────────────┤    (re-uses MLflow's pill components)
 *   │  TimelineTree                  │  ← deep-imported tree
 *   │   ├─ root                      │
 *   │   │   └─ ...                   │
 *   ├───────────────────────────────┤
 *   │  ModelTraceExplorerContentTab │  ← deep-imported I/O renderer
 *   │  (selected span's I/O)        │     same component as the regular right-pane
 *   └───────────────────────────────┘    "Inputs / Outputs" tab
 */
const PlaygroundTracePaneBody = ({ trace }: { trace: ModelTrace }) => {
  const { theme } = useDesignSystemTheme();
  const { selectedNode, setSelectedNode, setActiveTab, rootNode, topLevelNodes } = useModelTraceExplorerViewState();

  // expandedKeys / spanFilterState aren't part of the view-state context —
  // they're owned per-mount by the regular DetailView via these hooks.
  // We do the same.
  const { expandedKeys, setExpandedKeys } = useTimelineTreeExpandedNodes({
    rootNodes: topLevelNodes,
  });
  const { spanFilterState, setSpanFilterState, filteredTreeNodes, matchData } = useModelTraceSearch({
    treeNodes: topLevelNodes,
    selectedNode,
    setSelectedNode,
    setActiveTab,
    setExpandedKeys,
    modelTraceInfo: trace.info,
  });

  const { traceStartTime, traceEndTime } = useMemo(() => {
    if (!rootNode) return { traceStartTime: 0, traceEndTime: 0 };
    return { traceStartTime: rootNode.start, traceEndTime: rootNode.end };
  }, [rootNode]);

  return (
    <div css={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <PlaygroundTraceHeaderPills traceInfo={trace.info} />
      <div
        css={{
          flex: '1 1 55%',
          minHeight: 0,
          overflow: 'auto',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <TimelineTree
          rootNodes={filteredTreeNodes}
          selectedNode={selectedNode}
          setSelectedNode={setSelectedNode}
          traceStartTime={traceStartTime}
          traceEndTime={traceEndTime}
          expandedKeys={expandedKeys}
          setExpandedKeys={setExpandedKeys}
          spanFilterState={spanFilterState}
          setSpanFilterState={setSpanFilterState}
        />
      </div>
      <div
        css={{
          flex: '1 1 45%',
          minHeight: 0,
          borderTop: `1px solid ${theme.colors.border}`,
          backgroundColor: 'rgba(255,255,255,0.96)',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <ModelTraceExplorerContentTab activeSpan={selectedNode} searchFilter="" activeMatch={matchData.match} />
      </div>
    </div>
  );
};

/**
 * Public component for the playground's right-pane trace view. Provides the
 * required preference / context / view-state / update providers — same shape
 * as the public `<ModelTraceExplorer>` — and renders the compact stacked body.
 */
const PlaygroundTracePane = ({ trace }: { trace: ModelTrace }) => {
  const traceInfo = useMemo(() => (_isV3(trace.info) ? (trace.info as ModelTraceInfoV3) : undefined), [trace.info]);
  return (
    <ModelTraceExplorerPreferencesProvider>
      <ModelTraceExplorerContextProvider>
        <ModelTraceExplorerUpdateTraceContextProvider modelTraceInfo={traceInfo}>
          <ModelTraceExplorerViewStateProvider
            modelTrace={trace}
            initialActiveView="detail"
            assessmentsPaneEnabled={false}
            initialAssessmentsPaneCollapsed
          >
            <PlaygroundTracePaneBody trace={trace} />
          </ModelTraceExplorerViewStateProvider>
        </ModelTraceExplorerUpdateTraceContextProvider>
      </ModelTraceExplorerContextProvider>
    </ModelTraceExplorerPreferencesProvider>
  );
};

const TraceContextProviders = ({
  children,
  traceInfo,
}: {
  children: React.ReactNode;
  traceInfo?: ModelTraceInfoV3;
}) => (
  <ModelTraceExplorerPreferencesProvider>
    <ModelTraceExplorerContextProvider>
      <ModelTraceExplorerUpdateTraceContextProvider modelTraceInfo={traceInfo}>
        {children}
      </ModelTraceExplorerUpdateTraceContextProvider>
    </ModelTraceExplorerContextProvider>
  </ModelTraceExplorerPreferencesProvider>
);

/**
 * Three pulsing dots used as a placeholder while the agent is processing the
 * request but hasn't sent its first SSE delta yet. Pure CSS keyframes — no
 * external dep.
 */
const ThinkingDots = () => {
  const { theme } = useDesignSystemTheme();
  const dotStyle = {
    display: 'inline-block',
    width: 6,
    height: 6,
    borderRadius: '50%',
    backgroundColor: theme.colors.textSecondary,
    animation: 'mlflow-playground-thinking 1.2s infinite ease-in-out',
  } as const;
  return (
    <span
      css={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: theme.spacing.xs,
        '@keyframes mlflow-playground-thinking': {
          '0%, 80%, 100%': { opacity: 0.25, transform: 'scale(0.8)' },
          '40%': { opacity: 1, transform: 'scale(1)' },
        },
      }}
    >
      <span css={dotStyle} />
      <span css={{ ...dotStyle, animationDelay: '0.15s' }} />
      <span css={{ ...dotStyle, animationDelay: '0.3s' }} />
    </span>
  );
};

const PlaygroundPageImpl = () => {
  const { theme } = useDesignSystemTheme();
  const { experimentId } = useParams<{ experimentId: string }>();
  const [config, setConfig] = useState<PlaygroundConfig | null>(null);
  const [agentUrlInput, setAgentUrlInput] = useState('');
  const [messages, setMessages] = useState<PlaygroundMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [streamingText, setStreamingText] = useState('');
  const [isLoadingConfig, setIsLoadingConfig] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isReconnecting, setIsReconnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedTrace, setSelectedTrace] = useState<ModelTrace | null>(null);
  const [isFullTraceOpen, setIsFullTraceOpen] = useState(false);
  const threadEndRef = useRef<HTMLDivElement | null>(null);
  const traceLookupAbortersRef = useRef<Set<AbortController>>(new Set());

  // --- Annotation state (Epic 4) -------------------------------------------
  const { selection, clear: clearSelection } = useChatSelection();
  const [composerOpen, setComposerOpen] = useState(false);
  const [composerSelection, setComposerSelection] = useState<typeof selection>(null);
  const [feedbacks, setFeedbacks] = useState<PlaygroundFeedback[]>([]);
  const [hoveredFeedback, setHoveredFeedback] = useState<string | null>(null);
  const [flashedFeedback, setFlashedFeedback] = useState<string | null>(null);

  const upsertFeedback = useCallback((next: PlaygroundFeedback) => {
    setFeedbacks((prev) => {
      const idx = prev.findIndex((f) => f.assessment_id === next.assessment_id);
      if (idx >= 0) {
        const merged = [...prev];
        merged[idx] = { ...prev[idx], ...next };
        return merged;
      }
      return [...prev, next];
    });
  }, []);

  // Hydrate feedbacks from each turn's trace assessments. The trace already
  // arrives via the live-trace polling effect above; we walk its info
  // assessments and merge anything tagged as a playground feedback.
  useEffect(() => {
    if (!selectedTrace) return;
    const traceId = (selectedTrace.info as { trace_id?: string })?.trace_id;
    const assessments = (selectedTrace.info as { assessments?: never[] })?.assessments;
    if (!traceId) return;
    const reconstructed = feedbacksFromTraceAssessments(traceId, assessments);
    if (reconstructed.length === 0) return;
    setFeedbacks((prev) => {
      const byId = new Map(prev.map((f) => [f.assessment_id, f] as const));
      for (const f of reconstructed) {
        // Don't overwrite a locally-pending row with a server row that's
        // missing the dispatched flag etc. — keep the most-informed copy.
        const existing = byId.get(f.assessment_id);
        byId.set(f.assessment_id, existing ? { ...existing, ...f } : f);
      }
      return Array.from(byId.values());
    });
  }, [selectedTrace]);

  const submitFeedback = useCallback(
    async (input: {
      rationale: string;
      aspect: PlaygroundFeedback['aspect'];
      expected_output?: string;
      anchor: AssistantMessageAnchor;
    }) => {
      const traceId = input.anchor.trace_id;
      if (!traceId) {
        setError('Cannot save feedback: this turn has no trace yet. Try again in a moment.');
        return;
      }
      const optimisticId = `pending-${Date.now()}`;
      const optimistic: PlaygroundFeedback = {
        assessment_id: optimisticId,
        trace_id: traceId,
        rationale: input.rationale,
        aspect: input.aspect,
        expected_output: input.expected_output,
        anchor: input.anchor,
        pending: true,
      };
      setFeedbacks((prev) => [...prev, optimistic]);
      setComposerOpen(false);
      clearSelection();
      try {
        const { assessment_id } = await persistFeedback({
          trace_id: traceId,
          rationale: input.rationale,
          aspect: input.aspect,
          expected_output: input.expected_output,
          anchor: input.anchor,
        });
        setFeedbacks((prev) =>
          prev.map((f) =>
            f.assessment_id === optimisticId
              ? { ...f, assessment_id: assessment_id || optimisticId, pending: false }
              : f,
          ),
        );
      } catch (e) {
        setFeedbacks((prev) => prev.filter((f) => f.assessment_id !== optimisticId));
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [clearSelection],
  );

  const handleFeedbackHover = useCallback((feedbackId: string | null) => {
    setHoveredFeedback(feedbackId);
    setFlashedFeedback(feedbackId);
  }, []);

  const resolveFeedback = useCallback((feedback: PlaygroundFeedback) => {
    setFeedbacks((prev) =>
      prev.map((f) => (f.assessment_id === feedback.assessment_id ? { ...f, resolved: true } : f)),
    );
  }, []);

  // --- Dispatch flow (Epic 5) ---------------------------------------------
  const [dispatchTarget, setDispatchTarget] = useState<PlaygroundFeedback | null>(null);
  const [dispatchSubmitting, setDispatchSubmitting] = useState(false);

  // --- Issue detail drawer (Epic 6) ---------------------------------------
  const [openIssueId, setOpenIssueId] = useState<string | null>(null);

  /**
   * Build the conversation prefix for the dispatch payload by walking
   * `messages` up to (but not including) the assistant message that the
   * feedback is anchored to. The trace generator wants {role, content}
   * pairs, so we drop client-only fields like requestId / traceId.
   */
  const buildDispatchPayload = useCallback(
    (
      feedback: PlaygroundFeedback,
      overrides: { rationale: string; aspect: string; expected_output?: string },
    ): {
      rationale: string;
      failing_assistant_message: string;
      conversation_prefix: Array<{ role: string; content: string }>;
      expected_response?: string;
      aspect?: string;
      experiment_id?: string;
      source_trace_id?: string;
      source_feedback_id?: string;
    } | null => {
      const targetIndex = messages.findIndex((m) => m.id === feedback.anchor.message_id);
      if (targetIndex < 0) return null;
      const failing = messages[targetIndex];
      const prefix = messages.slice(0, targetIndex).map((m) => ({
        role: m.role,
        content: m.content,
      }));
      return {
        rationale: overrides.rationale,
        failing_assistant_message: failing.content,
        conversation_prefix: prefix,
        expected_response: overrides.expected_output,
        aspect: overrides.aspect,
        experiment_id: experimentId,
        source_trace_id: feedback.trace_id,
        source_feedback_id: feedback.assessment_id,
      };
    },
    [messages, experimentId],
  );

  const confirmDispatch = useCallback(
    async (overrides: { rationale: string; aspect: string; expected_output?: string }) => {
      if (!dispatchTarget) return;
      const payload = buildDispatchPayload(dispatchTarget, overrides);
      if (!payload) {
        setError('Cannot dispatch: the assistant message this feedback is anchored to was not found.');
        setDispatchTarget(null);
        return;
      }
      setDispatchSubmitting(true);
      try {
        const result = await dispatchFeedback(payload);
        setFeedbacks((prev) =>
          prev.map((f) =>
            f.assessment_id === dispatchTarget.assessment_id
              ? {
                  ...f,
                  dispatched_issue_id: result.issue_id,
                  rationale: overrides.rationale,
                  aspect: overrides.aspect,
                  expected_output: overrides.expected_output,
                }
              : f,
          ),
        );
        // Best-effort: stamp the assessment so the dispatched link survives a reload.
        void tagFeedbackWithIssueId(dispatchTarget.trace_id, dispatchTarget.assessment_id, result.issue_id);
        setDispatchTarget(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setDispatchSubmitting(false);
      }
    },
    [dispatchTarget, buildDispatchPayload],
  );

  useEffect(() => {
    const aborters = traceLookupAbortersRef.current;
    return () => {
      aborters.forEach((controller) => controller.abort());
      aborters.clear();
    };
  }, []);

  const syncConfig = useCallback(async () => {
    setIsLoadingConfig(true);
    try {
      const response = await fetch(getAjaxUrl('ajax-api/3.0/mlflow/playground/config'), {
        headers: getDefaultHeaders(document.cookie),
      });
      if (!response.ok) {
        throw new Error(await parseErrorText(response));
      }
      const payload = (await response.json()) as PlaygroundConfig;
      setConfig(payload);
      setAgentUrlInput(payload.agent_url);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setIsLoadingConfig(false);
    }
  }, []);

  useEffect(() => {
    syncConfig();
  }, [syncConfig]);

  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, streamingText]);

  const latestTraceMessage = useMemo(() => [...messages].reverse().find((message) => message.traceId), [messages]);
  const latestTraceId = latestTraceMessage?.traceId;

  // Live-poll the latest trace's span tree so the inline panel grows as the
  // agent runs. Polls until the trace's `state` finalizes (OK / ERROR) or until
  // the latest trace id changes (next turn).
  useEffect(() => {
    if (!latestTraceId) {
      setSelectedTrace(null);
      return undefined;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const tick = async () => {
      if (cancelled) return;
      try {
        const trace = await fetchTraceSpansV3(latestTraceId);
        if (cancelled || !trace) {
          if (!cancelled) {
            timer = setTimeout(tick, LIVE_TRACE_REFRESH_MS);
          }
          return;
        }
        setSelectedTrace(trace);
        const state = (trace.info as { state?: string })?.state;
        if (state === 'OK' || state === 'ERROR') {
          return; // stop polling — trace is finalized
        }
      } catch {
        // ignore network blips and retry
      }
      if (!cancelled) {
        timer = setTimeout(tick, LIVE_TRACE_REFRESH_MS);
      }
    };

    void tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [latestTraceId]);

  const reconnectAgent = useCallback(async () => {
    setIsReconnecting(true);
    try {
      const response = await fetch(getAjaxUrl('ajax-api/3.0/mlflow/playground/config'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getDefaultHeaders(document.cookie),
        },
        body: JSON.stringify({ agent_url: agentUrlInput }),
      });
      if (!response.ok) {
        throw new Error(await parseErrorText(response));
      }
      const payload = (await response.json()) as Pick<PlaygroundConfig, 'agent_url'>;
      setConfig((current) =>
        current
          ? { ...current, agent_url: payload.agent_url, agent_connected: true }
          : { agent_url: payload.agent_url, agent_connected: true },
      );
      setError(null);
    } catch (e) {
      setConfig((current) => (current ? { ...current, agent_connected: false } : current));
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setIsReconnecting(false);
    }
  }, [agentUrlInput]);

  const sendMessage = useCallback(async () => {
    const content = draft.trim();
    if (!content || isSubmitting) {
      return;
    }

    const requestId = createRequestId();
    const userMessage: PlaygroundMessage = {
      id: createMessageId('user'),
      role: 'user',
      content,
      requestId,
    };
    const nextMessages = [...messages, userMessage];

    setMessages(nextMessages);
    setDraft('');
    setStreamingText('');
    setIsSubmitting(true);
    setError(null);
    // Clear the prior turn's trace so the right pane shows "Loading trace…"
    // until the new turn's first span lands. Without this, the previous turn's
    // span tree lingers visibly while the new turn is in flight.
    setSelectedTrace(null);
    // Cancel any in-flight tag-lookup polling from a prior turn (a stale
    // resolver could still race in and set traceId on an old user message).
    traceLookupAbortersRef.current.forEach((controller) => controller.abort());
    traceLookupAbortersRef.current.clear();

    // Start polling for the trace by request_id IMMEDIATELY so the right pane
    // can pick up the trace as soon as the agent's first child span persists
    // the trace_info row in the backend. We attach the traceId onto the user
    // message (whichever message has the latest traceId drives the live-poll
    // effect; SSE assistant_final later mirrors it onto the assistant
    // message).
    if (experimentId) {
      const controller = new AbortController();
      traceLookupAbortersRef.current.add(controller);
      void (async () => {
        try {
          const resolved = await lookupTraceIdByRequestId(experimentId, requestId, controller.signal);
          if (resolved) {
            setMessages((current) => current.map((m) => (m.id === userMessage.id ? { ...m, traceId: resolved } : m)));
          }
        } finally {
          traceLookupAbortersRef.current.delete(controller);
        }
      })();
    }

    try {
      const response = await fetch(getAjaxUrl('ajax-api/3.0/mlflow/playground/chat'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getDefaultHeaders(document.cookie),
        },
        body: JSON.stringify({
          messages: nextMessages.map(({ role, content: messageContent }) => ({ role, content: messageContent })),
          agent_url: agentUrlInput,
          request_id: requestId,
        }),
      });
      if (!response.ok) {
        throw new Error(await parseErrorText(response));
      }
      if (!response.body) {
        throw new Error('Streaming response body is not available.');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let finalMessage: PlaygroundMessage | null = null;

      while (true) {
        const { value, done } = await reader.read();
        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const chunks = buffer.split('\n\n');
        buffer = chunks.pop() ?? '';

        chunks.forEach((chunk) =>
          parseSseChunk(chunk, (event) => {
            if (event.type === 'assistant_delta') {
              setStreamingText((current) => current + event.delta);
            }
            if (event.type === 'assistant_final') {
              finalMessage = {
                id: createMessageId('assistant'),
                role: 'assistant',
                content: event.message.content,
                requestId,
                traceId: event.trace_id,
                toolCalls: event.tool_calls,
              };
            }
          }),
        );
      }

      if (finalMessage) {
        const completed: PlaygroundMessage = finalMessage;
        setMessages((current) => [...current, completed]);
        setStreamingText('');
        if (completed.traceId) {
          setConfig((current) => (current ? { ...current, agent_connected: true } : current));
        }
      } else {
        throw new Error('The playground did not receive a completed assistant response.');
      }
    } catch (e) {
      setConfig((current) => (current ? { ...current, agent_connected: false } : current));
      setStreamingText('');
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setIsSubmitting(false);
    }
  }, [agentUrlInput, draft, experimentId, isSubmitting, messages]);

  const selectedTraceInfo = useMemo(
    () =>
      selectedTrace && isV3ModelTraceInfo(selectedTrace.info) ? (selectedTrace.info as ModelTraceInfoV3) : undefined,
    [selectedTrace],
  );

  return (
    <div
      css={{
        display: 'flex',
        flexDirection: 'column',
        gap: theme.spacing.md,
        padding: theme.spacing.lg,
        // Bounded to the viewport so the chat thread can scroll internally
        // instead of pushing the whole page down. Combined with `minHeight: 0`
        // on the inner grid, this lets the chat / trace panes own their scroll.
        height: '100%',
        minHeight: 0,
        overflow: 'hidden',
        background:
          'linear-gradient(180deg, rgba(255, 250, 239, 0.9) 0%, rgba(248, 250, 252, 0.98) 38%, rgba(255,255,255,1) 100%)',
      }}
    >
      {/* Page header: title + tagline + tiny connection dot. Worker /
          tracing / experiment cards are gone — the URL already binds the
          experiment, and connection state is shown by the dot. */}
      <div
        css={{
          display: 'flex',
          flexDirection: 'column',
          gap: theme.spacing.xs,
        }}
      >
        <div css={{ display: 'flex', alignItems: 'center', gap: theme.spacing.sm }}>
          <Typography.Title level={2} withoutMargins>
            Agent Playground
          </Typography.Title>
          <span
            title={config?.agent_connected ? 'Agent connected' : 'Agent disconnected'}
            css={{
              display: 'inline-block',
              width: 8,
              height: 8,
              borderRadius: '50%',
              backgroundColor: config?.agent_connected ? theme.colors.green500 : theme.colors.grey400,
            }}
          />
          <Typography.Text color="secondary" size="sm">
            {config?.agent_connected ? 'Connected' : 'Waiting for agent'}
          </Typography.Text>
        </div>
        <Typography.Text color="secondary" css={{ maxWidth: 760 }}>
          Chat with a local `@invoke` agent, watch the real MLflow trace stream in for each turn, and leave feedback
          from the built-in assessments pane.
        </Typography.Text>
      </div>

      {error && (
        <Alert
          componentId="mlflow.playground.error"
          type="error"
          message={error}
          closable
          onClose={() => setError(null)}
        />
      )}

      <div
        css={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1.7fr) minmax(320px, 0.9fr)',
          gap: theme.spacing.lg,
          minHeight: 0,
          flex: 1,
          '@media (max-width: 1100px)': {
            gridTemplateColumns: '1fr',
          },
        }}
      >
        {/* Left pane: chat */}
        <section
          css={{
            display: 'flex',
            flexDirection: 'column',
            minHeight: 0,
            borderRadius: theme.borders.borderRadiusLg,
            border: `1px solid ${theme.colors.border}`,
            backgroundColor: 'rgba(255,255,255,0.92)',
            overflow: 'hidden',
            boxShadow: theme.shadows.sm,
          }}
        >
          <div
            css={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: `${theme.spacing.md}px ${theme.spacing.lg}px`,
              borderBottom: `1px solid ${theme.colors.border}`,
              background:
                'linear-gradient(90deg, rgba(255,244,214,0.85) 0%, rgba(250,250,250,0.85) 55%, rgba(232,244,255,0.85) 100%)',
            }}
          >
            <div>
              <Typography.Text css={{ display: 'block', fontWeight: 700 }}>Live Thread</Typography.Text>
              <Typography.Text color="secondary">
                Each turn streams into the right pane as the agent runs.
              </Typography.Text>
            </div>
            <Button
              componentId="mlflow.playground.clear-thread"
              onClick={() => {
                setMessages([]);
                setStreamingText('');
              }}
              disabled={messages.length === 0 && !streamingText}
            >
              Clear thread
            </Button>
          </div>

          <div
            css={{
              flex: 1,
              overflowY: 'auto',
              padding: theme.spacing.lg,
              display: 'flex',
              flexDirection: 'column',
              gap: theme.spacing.md,
            }}
          >
            {isLoadingConfig ? (
              <div css={{ display: 'flex', justifyContent: 'center', paddingTop: theme.spacing.xl }}>
                <Spinner />
              </div>
            ) : messages.length === 0 && !streamingText ? (
              <Typography.Text color="secondary">
                Send a turn to start the session. The right pane will fill with the live trace.
              </Typography.Text>
            ) : (
              messages.map((message, index) => (
                <div
                  key={message.id}
                  css={{
                    alignSelf: message.role === 'user' ? 'flex-end' : 'stretch',
                    maxWidth: message.role === 'user' ? '78%' : '100%',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: theme.spacing.xs,
                  }}
                >
                  <Typography.Text
                    color="secondary"
                    size="sm"
                    css={{ textTransform: 'uppercase', letterSpacing: '0.06em' }}
                  >
                    {message.role === 'user' ? 'User' : `Assistant turn ${String(index + 1).padStart(2, '0')}`}
                  </Typography.Text>
                  <div
                    data-mlflow-feedback-anchor={message.role === 'assistant' ? message.id : undefined}
                    data-mlflow-feedback-trace-id={message.role === 'assistant' ? message.traceId : undefined}
                    css={{
                      borderRadius: theme.borders.borderRadiusLg,
                      padding: theme.spacing.md,
                      border: `1px solid ${message.role === 'user' ? theme.colors.blue400 : theme.colors.border}`,
                      backgroundColor:
                        message.role === 'user' ? 'rgba(238, 244, 255, 0.95)' : 'rgba(255, 255, 255, 0.98)',
                      whiteSpace: 'pre-wrap',
                      lineHeight: 1.6,
                    }}
                  >
                    {message.content}
                  </div>
                </div>
              ))
            )}

            {(isSubmitting || streamingText) && (
              <div css={{ display: 'flex', flexDirection: 'column', gap: theme.spacing.xs }}>
                <Typography.Text
                  color="secondary"
                  size="sm"
                  css={{ textTransform: 'uppercase', letterSpacing: '0.06em' }}
                >
                  {streamingText ? 'Assistant is responding' : 'Assistant is thinking'}
                </Typography.Text>
                <div
                  css={{
                    borderRadius: theme.borders.borderRadiusLg,
                    padding: theme.spacing.md,
                    border: `1px solid ${theme.colors.border}`,
                    backgroundColor: 'rgba(255, 255, 255, 0.98)',
                    whiteSpace: 'pre-wrap',
                    lineHeight: 1.6,
                    display: 'flex',
                    alignItems: 'center',
                    gap: theme.spacing.sm,
                    minHeight: 56,
                  }}
                >
                  {streamingText || <ThinkingDots />}
                </div>
              </div>
            )}
            <div ref={threadEndRef} />
          </div>

          <div
            css={{
              borderTop: `1px solid ${theme.colors.border}`,
              padding: theme.spacing.lg,
              backgroundColor: 'rgba(255,255,255,0.98)',
            }}
          >
            <Input.TextArea
              componentId="mlflow.playground.composer"
              autoSize={{ minRows: 2, maxRows: 8 }}
              placeholder="Ask the agent something. Press Enter to send, Shift+Enter for a newline."
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  void sendMessage();
                }
              }}
            />
            <div
              css={{
                marginTop: theme.spacing.sm,
                display: 'flex',
                justifyContent: 'flex-end',
                alignItems: 'center',
              }}
            >
              <Button
                componentId="mlflow.playground.send"
                type="primary"
                onClick={() => void sendMessage()}
                disabled={!draft.trim() || isSubmitting}
              >
                {isSubmitting ? <Spinner size="small" /> : 'Send'}
              </Button>
            </div>
          </div>
        </section>

        {/* Right pane: feedback rail on top (per-session annotation cards),
            live span tree below. Each section scrolls independently so the
            trace stays usable when the rail fills with cards. */}
        <aside
          css={{
            display: 'flex',
            flexDirection: 'column',
            minHeight: 0,
            borderRadius: theme.borders.borderRadiusLg,
            border: `1px solid ${theme.colors.border}`,
            backgroundColor: 'rgba(255,255,255,0.92)',
            overflow: 'hidden',
            boxShadow: theme.shadows.sm,
          }}
        >
          <div
            css={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: `${theme.spacing.sm}px ${theme.spacing.lg}px`,
              borderBottom: `1px solid ${theme.colors.border}`,
              background: 'linear-gradient(90deg, rgba(232,255,232,0.85) 0%, rgba(250,250,250,0.85) 100%)',
            }}
          >
            <Typography.Text css={{ fontWeight: 700 }}>Feedback</Typography.Text>
            <Typography.Text size="sm" color="secondary">
              {feedbacks.filter((f) => !f.resolved).length} active
            </Typography.Text>
          </div>
          <div
            css={{
              flex: '1 1 0',
              minHeight: 120,
              maxHeight: '40vh',
              overflowY: 'auto',
              borderBottom: `1px solid ${theme.colors.border}`,
            }}
          >
            <FeedbackRail
              feedbacks={feedbacks}
              hoveredId={hoveredFeedback}
              flashedId={flashedFeedback}
              callbacks={{
                onHover: handleFeedbackHover,
                onDispatch: (feedback) => setDispatchTarget(feedback),
                onResolve: resolveFeedback,
                onOpenIssue: (issueId) => setOpenIssueId(issueId),
              }}
            />
          </div>
          <div
            css={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: theme.spacing.sm,
              padding: `${theme.spacing.sm}px ${theme.spacing.lg}px`,
              borderBottom: `1px solid ${theme.colors.border}`,
              background:
                'linear-gradient(90deg, rgba(232,244,255,0.85) 0%, rgba(250,250,250,0.85) 55%, rgba(255,244,214,0.85) 100%)',
            }}
          >
            <Typography.Text css={{ fontWeight: 700, flexShrink: 0 }}>Live Trace</Typography.Text>
            {latestTraceId && (
              <Typography.Text
                color="secondary"
                size="sm"
                css={{
                  fontFamily: 'monospace',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  flex: 1,
                  minWidth: 0,
                }}
                title={latestTraceId}
              >
                {latestTraceId}
              </Typography.Text>
            )}
            <Button
              componentId="mlflow.playground.open-full-trace"
              size="small"
              disabled={!selectedTrace}
              onClick={() => setIsFullTraceOpen(true)}
            >
              Open full trace
            </Button>
          </div>

          {selectedTrace ? (
            <PlaygroundTracePane trace={selectedTrace} />
          ) : (
            <div
              css={{
                flex: 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: theme.spacing.lg,
              }}
            >
              <Typography.Text color="secondary">
                {latestTraceId ? 'Loading trace…' : 'No trace yet — send a turn and the span tree will stream in here.'}
              </Typography.Text>
            </div>
          )}
        </aside>
      </div>

      {/* Floating 💬 button shown next to the active text selection.
          Click → captures the selection into composerSelection and opens the
          composer modal. The button itself uses preventDefault on mousedown
          so the underlying selection doesn't collapse before our handler runs. */}
      {!composerOpen && (
        <FloatingAnnotateButton
          selection={selection}
          onClick={() => {
            setComposerSelection(selection);
            setComposerOpen(true);
          }}
        />
      )}
      <FeedbackComposer
        selection={composerSelection}
        visible={composerOpen}
        onCancel={() => {
          setComposerOpen(false);
          setComposerSelection(null);
        }}
        onSubmit={submitFeedback}
      />

      <DispatchModal
        feedback={dispatchTarget}
        visible={!!dispatchTarget}
        isSubmitting={dispatchSubmitting}
        onCancel={() => setDispatchTarget(null)}
        onConfirm={confirmDispatch}
      />

      <IssueDetailDrawer issueId={openIssueId} visible={!!openIssueId} onClose={() => setOpenIssueId(null)} />

      {/* Full-trace drawer: opens on demand for the full explorer experience
          (assessments pane, attributes, events, linked prompts). */}
      {isFullTraceOpen && selectedTrace && (
        <TraceContextProviders traceInfo={selectedTraceInfo}>
          <ModelTraceExplorerDrawer
            handleClose={() => setIsFullTraceOpen(false)}
            renderModalTitle={() => selectedTraceInfo?.trace_id ?? 'Trace'}
            traceInfo={selectedTraceInfo}
            selectPreviousEval={() => undefined}
            selectNextEval={() => undefined}
            isPreviousAvailable={false}
            isNextAvailable={false}
          >
            <div
              css={{
                height: '100%',
                marginLeft: -theme.spacing.lg,
                marginRight: -theme.spacing.lg,
                marginBottom: -theme.spacing.lg,
              }}
            >
              <ModelTraceExplorer modelTrace={selectedTrace} collapseAssessmentPane="force-open" />
            </div>
          </ModelTraceExplorerDrawer>
        </TraceContextProviders>
      )}
    </div>
  );
};

export default withErrorBoundary(ErrorUtils.mlflowServices.EXPERIMENTS, PlaygroundPageImpl);
