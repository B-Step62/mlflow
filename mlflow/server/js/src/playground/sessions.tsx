/**
 * Session history menu — anchored to the clock icon in the Conversation header.
 * Lists past playground sessions (one row per `mlflow.trace.session` group) and,
 * on selection, calls back into PlaygroundPage with the rehydrated chat history,
 * trace map, and reconstructed feedbacks.
 */

import { useCallback, useState } from 'react';

import { Button, ClockIcon, DropdownMenu, Spinner, Typography, useDesignSystemTheme } from '@databricks/design-system';

import {
  getAjaxUrl,
  getDefaultHeaders,
} from '../shared/web-shared/model-trace-explorer/ModelTraceExplorer.request.utils';
import { feedbacksFromTraceAssessments, type PlaygroundFeedback } from './feedback';

type SessionSummary = {
  session_id: string;
  trace_count: number;
  first_activity_ms: number;
  last_activity_ms: number;
  preview: string;
};

type ResumedMessage = {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'developer';
  content: string;
  requestId?: string;
  toolCalls?: Array<{
    name: string;
    span_id?: string;
    duration_ms?: number | null;
    inputs?: unknown;
    outputs?: unknown;
  }>;
};

type SessionDetail = {
  session_id: string;
  messages: ResumedMessage[];
  traceIdsByRequestId: Record<string, string>;
  assessments: Array<{
    trace_id: string;
    assessment: Parameters<typeof feedbacksFromTraceAssessments>[1] extends Array<infer A> | undefined ? A : never;
  }>;
};

export type ResumedSession = {
  sessionId: string;
  messages: ResumedMessage[];
  traceIdsByRequestId: Record<string, string>;
  feedbacks: PlaygroundFeedback[];
};

const formatRelative = (ms: number): string => {
  if (!ms) return '';
  const diff = Date.now() - ms;
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) {
    const m = Math.round(diff / 60_000);
    return `${m} min ago`;
  }
  if (diff < 86_400_000) {
    const h = Math.round(diff / 3_600_000);
    return `${h} hr ago`;
  }
  const d = Math.round(diff / 86_400_000);
  return `${d} day${d === 1 ? '' : 's'} ago`;
};

const fetchSessions = async (): Promise<SessionSummary[]> => {
  const response = await fetch(getAjaxUrl('ajax-api/3.0/mlflow/playground/sessions'), {
    headers: { ...getDefaultHeaders(document.cookie) },
  });
  if (!response.ok) {
    throw new Error(`Failed to load sessions (${response.status}).`);
  }
  const payload = (await response.json()) as { sessions?: SessionSummary[] };
  return payload.sessions ?? [];
};

const fetchSession = async (sessionId: string): Promise<SessionDetail> => {
  const response = await fetch(getAjaxUrl(`ajax-api/3.0/mlflow/playground/sessions/${encodeURIComponent(sessionId)}`), {
    headers: { ...getDefaultHeaders(document.cookie) },
  });
  if (!response.ok) {
    throw new Error(`Failed to load session ${sessionId} (${response.status}).`);
  }
  return (await response.json()) as SessionDetail;
};

const buildFeedbacks = (assessments: SessionDetail['assessments']): PlaygroundFeedback[] => {
  const out: PlaygroundFeedback[] = [];
  for (const entry of assessments) {
    const reconstructed = feedbacksFromTraceAssessments(entry.trace_id, [entry.assessment as never]);
    out.push(...reconstructed);
  }
  return out;
};

export const SessionHistoryMenu = ({
  experimentId,
  hasUnsavedConversation,
  onResumeSession,
}: {
  experimentId: string | undefined;
  hasUnsavedConversation: boolean;
  onResumeSession: (resumed: ResumedSession) => void;
}) => {
  const { theme } = useDesignSystemTheme();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [resumingId, setResumingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setSessions(await fetchSessions());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  const handleSelect = useCallback(
    async (summary: SessionSummary) => {
      if (
        hasUnsavedConversation &&
        // eslint-disable-next-line no-alert
        !window.confirm('Discard the current conversation and load this session?')
      ) {
        return;
      }
      setResumingId(summary.session_id);
      setError(null);
      try {
        const detail = await fetchSession(summary.session_id);
        onResumeSession({
          sessionId: detail.session_id,
          messages: detail.messages,
          traceIdsByRequestId: detail.traceIdsByRequestId,
          feedbacks: buildFeedbacks(detail.assessments),
        });
        setOpen(false);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setResumingId(null);
      }
    },
    [hasUnsavedConversation, onResumeSession],
  );

  return (
    <DropdownMenu.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          void reload();
        }
      }}
    >
      <DropdownMenu.Trigger asChild>
        <Button
          componentId="mlflow.playground.session-history"
          icon={<ClockIcon />}
          disabled={!experimentId}
          aria-label="Session history"
          title="Session history"
        />
      </DropdownMenu.Trigger>
      <DropdownMenu.Content minWidth={320} css={{ maxWidth: 420 }}>
        {loading && (
          <div
            css={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: theme.spacing.md,
            }}
          >
            <Spinner size="small" />
          </div>
        )}
        {!loading && error && (
          <div css={{ padding: theme.spacing.md }}>
            <Typography.Text color="error" size="sm">
              {error}
            </Typography.Text>
          </div>
        )}
        {!loading && !error && sessions.length === 0 && (
          <div css={{ padding: theme.spacing.md }}>
            <Typography.Text size="sm" color="secondary">
              No past sessions yet — chat with the agent to start one.
            </Typography.Text>
          </div>
        )}
        {!loading && !error && sessions.length > 0 && (
          <>
            <DropdownMenu.Label>
              <Typography.Text size="sm" color="secondary">
                Past sessions
              </Typography.Text>
            </DropdownMenu.Label>
            {sessions.map((session) => {
              const isResuming = resumingId === session.session_id;
              return (
                <DropdownMenu.Item
                  key={session.session_id}
                  componentId="mlflow.playground.session-history.item"
                  onClick={() => void handleSelect(session)}
                  disabled={Boolean(resumingId)}
                  css={{
                    flexDirection: 'column',
                    alignItems: 'stretch',
                    gap: theme.spacing.xs,
                    padding: theme.spacing.sm,
                  }}
                >
                  <div
                    css={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      gap: theme.spacing.sm,
                    }}
                  >
                    <Typography.Text size="sm" css={{ fontWeight: 600 }}>
                      {formatRelative(session.last_activity_ms)}
                    </Typography.Text>
                    <Typography.Text size="sm" color="secondary">
                      {session.trace_count} {session.trace_count === 1 ? 'turn' : 'turns'}
                      {isResuming ? ' · loading…' : ''}
                    </Typography.Text>
                  </div>
                  {session.preview && (
                    <Typography.Text
                      size="sm"
                      color="secondary"
                      css={{
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {session.preview}
                    </Typography.Text>
                  )}
                </DropdownMenu.Item>
              );
            })}
          </>
        )}
      </DropdownMenu.Content>
    </DropdownMenu.Root>
  );
};
