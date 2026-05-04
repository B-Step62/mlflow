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
import { AssistantAwareDrawer } from '../common/components/AssistantAwareDrawer';
import { ExportTracesToDatasetModal } from '../experiment-tracking/pages/experiment-evaluation-datasets/components/ExportTracesToDatasetModal';
import { getTrace } from '../experiment-tracking/utils/TraceUtils';
import {
  getAjaxUrl,
  getDefaultHeaders,
} from '../shared/web-shared/model-trace-explorer/ModelTraceExplorer.request.utils';

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

const TraceContextProviders = ({
  children,
  traceInfo,
}: {
  children: React.ReactNode;
  traceInfo?: ModelTraceInfoV3;
}) => (
  <ModelTraceExplorerPreferencesProvider>
    <ModelTraceExplorerContextProvider
      renderExportTracesToDatasetsModal={ExportTracesToDatasetModal}
      DrawerComponent={AssistantAwareDrawer}
    >
      <ModelTraceExplorerUpdateTraceContextProvider modelTraceInfo={traceInfo}>
        {children}
      </ModelTraceExplorerUpdateTraceContextProvider>
    </ModelTraceExplorerContextProvider>
  </ModelTraceExplorerPreferencesProvider>
);

const PlaygroundPageImpl = () => {
  const { theme } = useDesignSystemTheme();
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
  const [selectedTraceIndex, setSelectedTraceIndex] = useState<number | null>(null);
  const [isLoadingTrace, setIsLoadingTrace] = useState(false);
  const threadEndRef = useRef<HTMLDivElement | null>(null);

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

  const openTrace = useCallback(
    async (traceId: string) => {
      const nextIndex = messages.findIndex((message) => message.traceId === traceId);
      setSelectedTraceIndex(nextIndex >= 0 ? nextIndex : null);
      setIsLoadingTrace(true);
      try {
        const trace = await getTrace(traceId);
        if (!trace) {
          throw new Error(`Trace ${traceId} is not available from the current MLflow server.`);
        }
        setSelectedTrace(trace);
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setIsLoadingTrace(false);
      }
    },
    [messages],
  );

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

    const userMessage: PlaygroundMessage = {
      id: createMessageId('user'),
      role: 'user',
      content,
    };
    const nextMessages = [...messages, userMessage];

    setMessages(nextMessages);
    setDraft('');
    setStreamingText('');
    setIsSubmitting(true);
    setError(null);

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
  }, [agentUrlInput, draft, isSubmitting, messages]);

  const selectedTraceInfo = useMemo(
    () => (selectedTrace && isV3ModelTraceInfo(selectedTrace.info) ? (selectedTrace.info as ModelTraceInfoV3) : undefined),
    [selectedTrace],
  );

  return (
    <div
      css={{
        display: 'flex',
        flexDirection: 'column',
        gap: theme.spacing.lg,
        padding: theme.spacing.lg,
        minHeight: '100%',
        background:
          'linear-gradient(180deg, rgba(255, 250, 239, 0.9) 0%, rgba(248, 250, 252, 0.98) 38%, rgba(255,255,255,1) 100%)',
      }}
    >
      <div
        css={{
          display: 'flex',
          justifyContent: 'space-between',
          gap: theme.spacing.md,
          alignItems: 'flex-start',
          flexWrap: 'wrap',
        }}
      >
        <div css={{ maxWidth: 760 }}>
          <Typography.Title level={2} css={{ marginBottom: theme.spacing.xs }}>
            Agent Playground
          </Typography.Title>
          <Typography.Text color="secondary">
            Chat with a local `@invoke` agent, open the real MLflow trace for each turn, and leave feedback from the
            built-in assessments pane.
          </Typography.Text>
        </div>
        <div
          css={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, minmax(140px, 1fr))',
            gap: theme.spacing.sm,
            minWidth: 360,
            maxWidth: 520,
            width: '100%',
          }}
        >
          {[
            ['Worker', config?.worker_kind ?? 'claude-code'],
            ['Tracing', config?.tracing_enabled ? 'enabled' : 'unknown'],
            ['Experiment', config?.experiment ?? 'not set'],
          ].map(([label, value]) => (
            <div
              key={label}
              css={{
                borderRadius: theme.borders.borderRadiusMd,
                border: `1px solid ${theme.colors.border}`,
                padding: theme.spacing.sm,
                backgroundColor: 'rgba(255,255,255,0.82)',
              }}
            >
              <Typography.Text color="secondary" css={{ display: 'block', marginBottom: 4 }}>
                {label}
              </Typography.Text>
              <Typography.Text css={{ fontWeight: 600 }}>{value}</Typography.Text>
            </div>
          ))}
        </div>
      </div>

      {error && <Alert componentId="mlflow.playground.error" type="error" message={error} closable onClose={() => setError(null)} />}

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
        <section
          css={{
            display: 'flex',
            flexDirection: 'column',
            minHeight: 680,
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
                Each assistant turn can open the full trace drawer for debugging and feedback.
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
              <div
                css={{
                  borderRadius: theme.borders.borderRadiusLg,
                  border: `1px dashed ${theme.colors.border}`,
                  padding: theme.spacing.xl,
                  backgroundColor: 'rgba(247, 248, 250, 0.75)',
                }}
              >
                <Typography.Title level={4} css={{ marginBottom: theme.spacing.sm }}>
                  Send a turn to start the session
                </Typography.Title>
                <Typography.Text color="secondary">
                  The right pane will light up with the latest trace, tool calls, and a direct path into the MLflow
                  feedback UI.
                </Typography.Text>
              </div>
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
                  <div
                    css={{
                      fontSize: 12,
                      letterSpacing: '0.08em',
                      textTransform: 'uppercase',
                      color: theme.colors.textSecondary,
                      display: 'flex',
                      justifyContent: 'space-between',
                    }}
                  >
                    <span>{message.role === 'user' ? 'User' : `Assistant turn ${String(index + 1).padStart(2, '0')}`}</span>
                    {message.traceId && <span>{message.traceId}</span>}
                  </div>
                  <div
                    css={{
                      borderRadius: theme.borders.borderRadiusLg,
                      padding: theme.spacing.md,
                      border: `1px solid ${message.role === 'user' ? theme.colors.blue400 : theme.colors.border}`,
                      backgroundColor:
                        message.role === 'user' ? 'rgba(238, 244, 255, 0.95)' : 'rgba(255, 255, 255, 0.98)',
                    }}
                  >
                    <div css={{ whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>{message.content}</div>
                    {message.toolCalls && message.toolCalls.length > 0 && (
                      <div css={{ marginTop: theme.spacing.md, display: 'grid', gap: theme.spacing.sm }}>
                        {message.toolCalls.map((toolCall, toolIndex) => (
                          <div
                            key={`${toolCall.span_id ?? toolCall.name}-${toolIndex}`}
                            css={{
                              borderRadius: theme.borders.borderRadiusMd,
                              border: `1px solid ${theme.colors.border}`,
                              backgroundColor: 'rgba(249, 250, 251, 0.92)',
                              padding: theme.spacing.sm,
                            }}
                          >
                            <Typography.Text css={{ fontWeight: 600 }}>
                              {toolCall.name}
                              {toolCall.duration_ms ? ` · ${toolCall.duration_ms} ms` : ''}
                            </Typography.Text>
                            <pre
                              css={{
                                margin: `${theme.spacing.xs}px 0 0`,
                                whiteSpace: 'pre-wrap',
                                fontSize: 12,
                                lineHeight: 1.5,
                              }}
                            >
                              {`inputs\n${stringifyToolValue(toolCall.inputs)}\n\noutputs\n${stringifyToolValue(toolCall.outputs)}`}
                            </pre>
                          </div>
                        ))}
                      </div>
                    )}
                    {message.traceId && (
                      <div css={{ marginTop: theme.spacing.md, display: 'flex', gap: theme.spacing.sm, flexWrap: 'wrap' }}>
                        <Button componentId={`mlflow.playground.open-trace.${message.traceId}`} onClick={() => openTrace(message.traceId!)}>
                          Open trace + feedback
                        </Button>
                        <Typography.Text color="secondary">
                          Opens the MLflow trace drawer with the built-in assessments pane.
                        </Typography.Text>
                      </div>
                    )}
                  </div>
                </div>
              ))
            )}

            {streamingText && (
              <div css={{ display: 'flex', flexDirection: 'column', gap: theme.spacing.xs }}>
                <Typography.Text color="secondary" css={{ fontSize: 12, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                  Assistant is responding
                </Typography.Text>
                <div
                  css={{
                    borderRadius: theme.borders.borderRadiusLg,
                    padding: theme.spacing.md,
                    border: `1px solid ${theme.colors.border}`,
                    backgroundColor: 'rgba(255, 255, 255, 0.98)',
                    whiteSpace: 'pre-wrap',
                    lineHeight: 1.6,
                  }}
                >
                  {streamingText}
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
              autoSize={{ minRows: 3, maxRows: 8 }}
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
            <div css={{ marginTop: theme.spacing.sm, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <Typography.Text color="secondary">
                {config?.agent_connected ? 'Agent connected' : 'Agent disconnected'} · traces and feedback stay inside
                the MLflow shell now.
              </Typography.Text>
              <Button componentId="mlflow.playground.send" type="primary" onClick={() => void sendMessage()} disabled={!draft.trim() || isSubmitting}>
                {isSubmitting ? <Spinner size="small" /> : 'Send'}
              </Button>
            </div>
          </div>
        </section>

        <aside
          css={{
            display: 'flex',
            flexDirection: 'column',
            gap: theme.spacing.md,
            minHeight: 680,
          }}
        >
          <div
            css={{
              borderRadius: theme.borders.borderRadiusLg,
              border: `1px solid ${theme.colors.border}`,
              backgroundColor: 'rgba(255,255,255,0.92)',
              padding: theme.spacing.lg,
              boxShadow: theme.shadows.sm,
            }}
          >
            <Typography.Title level={4} css={{ marginBottom: theme.spacing.sm }}>
              Agent connection
            </Typography.Title>
            <Typography.Text color="secondary" css={{ display: 'block', marginBottom: theme.spacing.sm }}>
              The happy path auto-starts a local `@invoke` agent. Override the URL only when you want a different
              target.
            </Typography.Text>
            <Input
              componentId="mlflow.playground.agent-url"
              value={agentUrlInput}
              onChange={(event) => setAgentUrlInput(event.target.value)}
            />
            <div css={{ marginTop: theme.spacing.sm, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <Typography.Text color={config?.agent_connected ? 'success' : 'secondary'}>
                {config?.agent_connected ? 'Connected' : 'Waiting for agent'}
              </Typography.Text>
              <Button componentId="mlflow.playground.reconnect" onClick={() => void reconnectAgent()} disabled={isReconnecting}>
                {isReconnecting ? <Spinner size="small" /> : 'Reconnect'}
              </Button>
            </div>
          </div>

          <div
            css={{
              borderRadius: theme.borders.borderRadiusLg,
              border: `1px solid ${theme.colors.border}`,
              backgroundColor: 'rgba(255,255,255,0.92)',
              padding: theme.spacing.lg,
              boxShadow: theme.shadows.sm,
            }}
          >
            <Typography.Title level={4} css={{ marginBottom: theme.spacing.sm }}>
              Latest trace
            </Typography.Title>
            {latestTraceMessage?.traceId ? (
              <div css={{ display: 'grid', gap: theme.spacing.sm }}>
                <div
                  css={{
                    borderRadius: theme.borders.borderRadiusMd,
                    border: `1px solid ${theme.colors.border}`,
                    padding: theme.spacing.sm,
                    backgroundColor: 'rgba(248,250,252,0.95)',
                  }}
                >
                  <Typography.Text css={{ display: 'block', fontWeight: 600 }}>{latestTraceMessage.traceId}</Typography.Text>
                  <Typography.Text color="secondary">
                    {latestTraceMessage.toolCalls?.length
                      ? `${latestTraceMessage.toolCalls.length} tool call${latestTraceMessage.toolCalls.length > 1 ? 's' : ''}`
                      : 'No tool calls captured'}
                  </Typography.Text>
                </div>
                <Button componentId="mlflow.playground.open-latest-trace" onClick={() => void openTrace(latestTraceMessage.traceId!)}>
                  Open latest trace + feedback
                </Button>
              </div>
            ) : (
              <Typography.Text color="secondary">
                No trace yet. Once the agent responds, you can inspect spans and leave feedback from here.
              </Typography.Text>
            )}
          </div>

          <div
            css={{
              borderRadius: theme.borders.borderRadiusLg,
              border: `1px solid ${theme.colors.border}`,
              backgroundColor: 'rgba(255,252,245,0.96)',
              padding: theme.spacing.lg,
              boxShadow: theme.shadows.sm,
            }}
          >
            <Typography.Title level={4} css={{ marginBottom: theme.spacing.sm }}>
              Feedback path
            </Typography.Title>
            <Typography.Text color="secondary">
              After each turn, open the trace drawer and use the assessments pane on the right to leave structured
              feedback immediately. This reuses the existing MLflow feedback model instead of a demo-only side
              channel.
            </Typography.Text>
          </div>
        </aside>
      </div>

      {selectedTrace && (
        <TraceContextProviders traceInfo={selectedTraceInfo}>
          <ModelTraceExplorerDrawer
            handleClose={() => setSelectedTrace(null)}
            selectPreviousEval={() => {
              if (selectedTraceIndex === null) {
                return;
              }
              for (let index = selectedTraceIndex - 1; index >= 0; index -= 1) {
                const traceId = messages[index]?.traceId;
                if (traceId) {
                  void openTrace(traceId);
                  return;
                }
              }
            }}
            selectNextEval={() => {
              if (selectedTraceIndex === null) {
                return;
              }
              for (let index = selectedTraceIndex + 1; index < messages.length; index += 1) {
                const traceId = messages[index]?.traceId;
                if (traceId) {
                  void openTrace(traceId);
                  return;
                }
              }
            }}
            isPreviousAvailable={
              selectedTraceIndex !== null && messages.slice(0, selectedTraceIndex).some((message) => Boolean(message.traceId))
            }
            isNextAvailable={
              selectedTraceIndex !== null &&
              messages.slice(selectedTraceIndex + 1).some((message) => Boolean(message.traceId))
            }
            renderModalTitle={() => selectedTraceInfo?.trace_id ?? 'Trace'}
            isLoading={isLoadingTrace}
            traceInfo={selectedTraceInfo}
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
