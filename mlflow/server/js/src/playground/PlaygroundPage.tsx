import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ErrorUtils from '../common/utils/ErrorUtils';
import { withErrorBoundary } from '../common/utils/withErrorBoundary';
import {
  Alert,
  Button,
  Input,
  Spinner,
  Typography,
  useDesignSystemTheme,
} from '@databricks/design-system';
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
import { getExperimentTraceV3 } from '@databricks/web-shared/model-trace-explorer';
import {
  getAjaxUrl,
  getDefaultHeaders,
} from '../shared/web-shared/model-trace-explorer/ModelTraceExplorer.request.utils';
import { useParams } from '../common/utils/RoutingUtils';

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

const fetchTraceSpansV3 = async (
  traceId: string,
  signal?: AbortSignal,
): Promise<ModelTrace | null> => {
  const traceResp = (await getExperimentTraceV3({ traceId })) as
    | {
        trace?: {
          trace_info?: ModelTrace['info'];
          data?: ModelTrace['data'];
          spans?: ModelTrace['data']['spans'];
        };
      }
    | undefined;
  if (signal?.aborted) {
    return null;
  }
  const info = traceResp?.trace?.trace_info;
  const data: ModelTrace['data'] | undefined =
    traceResp?.trace?.data ??
    (traceResp?.trace?.spans ? { spans: traceResp.trace.spans } : undefined);
  if (info && data) {
    return { info, data };
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

const parseSseChunk = (
  rawChunk: string,
  onEvent: (event: StreamEvent) => void,
) => {
  const dataLines = rawChunk
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trim())
    .filter(Boolean);

  for (const line of dataLines) {
    onEvent(JSON.parse(line) as StreamEvent);
  }
};

const stringifyToolValue = (value: unknown) => {
  if (value === undefined || value === null) {
    return 'None';
  }
  if (typeof value === 'string') {
    return value;
  }
  return JSON.stringify(value, null, 2);
};

/**
 * Pull a span's I/O attributes by id. MLflow stores `mlflow.spanInputs` /
 * `mlflow.spanOutputs` as JSON-encoded strings on each span's attribute map;
 * we parse them defensively because some entries land double-quoted (the value
 * is itself a JSON string).
 */
const findSpanIO = (
  trace: ModelTrace | null,
  spanId: string | undefined,
): { inputs: unknown; outputs: unknown; name: string } | null => {
  if (!trace || !spanId) return null;
  const spans = (trace.data?.spans ?? []) as {
    span_id?: string;
    name?: string;
    attributes?: Record<string, unknown>;
  }[];
  const span = spans.find((s) => s.span_id === spanId);
  if (!span) return null;
  const parse = (raw: unknown): unknown => {
    if (raw === undefined || raw === null) return undefined;
    if (typeof raw !== 'string') return raw;
    try {
      const once = JSON.parse(raw);
      // Some values are double-encoded (e.g. `"\"UNKNOWN\""`). Try a second pass.
      if (typeof once === 'string') {
        try {
          return JSON.parse(once);
        } catch {
          return once;
        }
      }
      return once;
    } catch {
      return raw;
    }
  };
  return {
    inputs: parse(span.attributes?.['mlflow.spanInputs']),
    outputs: parse(span.attributes?.['mlflow.spanOutputs']),
    name: span.name ?? '',
  };
};

const SpanIOPanel = ({
  trace,
  selectedSpanId,
}: {
  trace: ModelTrace | null;
  selectedSpanId: string | undefined;
}) => {
  const { theme } = useDesignSystemTheme();
  const io = useMemo(() => findSpanIO(trace, selectedSpanId), [trace, selectedSpanId]);
  if (!io) {
    return (
      <div css={{ padding: theme.spacing.md }}>
        <Typography.Text color="secondary">Select a span to inspect its inputs and outputs.</Typography.Text>
      </div>
    );
  }
  return (
    <div
      css={{
        display: 'flex',
        flexDirection: 'column',
        gap: theme.spacing.sm,
        padding: theme.spacing.md,
        overflowY: 'auto',
        minHeight: 0,
      }}
    >
      <Typography.Text css={{ fontWeight: 700 }}>{io.name || 'Span I/O'}</Typography.Text>
      {(['inputs', 'outputs'] as const).map((kind) => (
        <div
          key={kind}
          css={{
            borderRadius: theme.borders.borderRadiusMd,
            border: `1px solid ${theme.colors.border}`,
            backgroundColor: 'rgba(249,250,251,0.95)',
          }}
        >
          <Typography.Text
            color="secondary"
            size="sm"
            css={{
              display: 'block',
              padding: `${theme.spacing.xs}px ${theme.spacing.sm}px`,
              borderBottom: `1px solid ${theme.colors.border}`,
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
            }}
          >
            {kind}
          </Typography.Text>
          <pre
            css={{
              margin: 0,
              padding: theme.spacing.sm,
              fontSize: 12,
              lineHeight: 1.5,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              maxHeight: 220,
              overflowY: 'auto',
            }}
          >
            {stringifyToolValue(io[kind])}
          </pre>
        </div>
      ))}
    </div>
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
  const [selectedSpanId, setSelectedSpanId] = useState<string | undefined>(undefined);
  const [isFullTraceOpen, setIsFullTraceOpen] = useState(false);
  const threadEndRef = useRef<HTMLDivElement | null>(null);
  const traceLookupAbortersRef = useRef<Set<AbortController>>(new Set());

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

  const latestTraceMessage = useMemo(
    () => [...messages].reverse().find((message) => message.traceId),
    [messages],
  );
  const latestTraceId = latestTraceMessage?.traceId;

  // Default the selected span to the root once a trace has spans, so the I/O
  // panel below the tree shows something useful without forcing the user to
  // click. If the user picks another span, leave it alone.
  useEffect(() => {
    if (!selectedTrace) {
      return;
    }
    const spans = (selectedTrace.data?.spans ?? []) as { span_id?: string; parent_span_id?: string | null }[];
    if (spans.length === 0) {
      return;
    }
    setSelectedSpanId((current) => {
      if (current && spans.some((s) => s.span_id === current)) {
        return current;
      }
      const root = spans.find((s) => !s.parent_span_id);
      return root?.span_id ?? spans[0]?.span_id;
    });
  }, [selectedTrace]);

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
    setSelectedSpanId(undefined);
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
          const resolved = await lookupTraceIdByRequestId(
            experimentId,
            requestId,
            controller.signal,
          );
          if (resolved) {
            setMessages((current) =>
              current.map((m) => (m.id === userMessage.id ? { ...m, traceId: resolved } : m)),
            );
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
    () => (selectedTrace && isV3ModelTraceInfo(selectedTrace.info) ? (selectedTrace.info as ModelTraceInfoV3) : undefined),
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
          Chat with a local `@invoke` agent, watch the real MLflow trace stream in for each turn, and leave feedback from the
          built-in assessments pane.
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
                    css={{
                      borderRadius: theme.borders.borderRadiusLg,
                      padding: theme.spacing.md,
                      border: `1px solid ${
                        message.role === 'user' ? theme.colors.blue400 : theme.colors.border
                      }`,
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

        {/* Right pane: live span tree (auto-tracks the latest message's
            trace; polls until the trace state finalizes). */}
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
            <TraceContextProviders traceInfo={selectedTraceInfo}>
              <div
                css={{
                  flex: 1,
                  minHeight: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  // Compact inline view: drop the trace-id / tags header strip,
                  // the tab switcher, the search box, and the right-side
                  // attribute/assessment pane. The selected span's inputs and
                  // outputs are rendered in a stacked panel below the tree so
                  // narrow column widths still work. Power users get the full
                  // experience via "Open full trace".
                  '& > div:first-of-type': {
                    display: 'none', // trace header (trace_id / status / time)
                  },
                  '& [role="tablist"]': {
                    display: 'none', // Summary / Details / Linked prompts switcher
                  },
                  '& [role="tabpanel"] > div > div:first-of-type:has([data-component-id="shared.model-trace-explorer.search-input"])':
                    {
                      display: 'none', // search box row at the top of DetailView
                    },
                  // Hide the right-side pane (attributes/assessments tabs).
                  '& [data-component-id="shared.model-trace-explorer.right-pane-tabs"]':
                    {
                      display: 'none',
                    },
                }}
              >
                <div css={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
                  <ModelTraceExplorer
                    modelTrace={selectedTrace}
                    initialActiveView="detail"
                    collapseAssessmentPane
                    selectedSpanId={selectedSpanId}
                    onSelectSpan={setSelectedSpanId}
                  />
                </div>
                <div
                  css={{
                    borderTop: `1px solid ${theme.colors.border}`,
                    backgroundColor: 'rgba(255,255,255,0.96)',
                    flexShrink: 0,
                    maxHeight: '45%',
                    display: 'flex',
                    flexDirection: 'column',
                    minHeight: 0,
                  }}
                >
                  <SpanIOPanel trace={selectedTrace} selectedSpanId={selectedSpanId} />
                </div>
              </div>
            </TraceContextProviders>
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
                {latestTraceId
                  ? 'Loading trace…'
                  : 'No trace yet — send a turn and the span tree will stream in here.'}
              </Typography.Text>
            </div>
          )}
        </aside>
      </div>

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
