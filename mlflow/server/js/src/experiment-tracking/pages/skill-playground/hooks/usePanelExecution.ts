import { useCallback, useRef, useState } from 'react';
import { getAjaxUrl } from '@mlflow/mlflow/src/common/utils/FetchUtils';
import { processContentBlocks } from '@mlflow/mlflow/src/assistant/AssistantService';
import { runPanel, cancelPanel } from '../api';
import type { PanelId, ChatMessage } from '../types';
import type { ToolUseInfo } from '@mlflow/mlflow/src/assistant/types';

const generateMessageId = (): string => {
  return `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
};

export const usePanelExecution = (sessionId: string | null) => {
  const [messagesA, setMessagesA] = useState<ChatMessage[]>([]);
  const [messagesB, setMessagesB] = useState<ChatMessage[]>([]);
  const [isExecutingA, setIsExecutingA] = useState(false);
  const [isExecutingB, setIsExecutingB] = useState(false);
  const [activeToolsA, setActiveToolsA] = useState<ToolUseInfo[]>([]);
  const [activeToolsB, setActiveToolsB] = useState<ToolUseInfo[]>([]);
  const eventSourceRefA = useRef<EventSource | null>(null);
  const eventSourceRefB = useRef<EventSource | null>(null);
  const streamingRefA = useRef('');
  const streamingRefB = useRef('');

  const execute = useCallback(
    async (panelId: PanelId, message: string) => {
      if (!sessionId) return;

      const setMessages = panelId === 'a' ? setMessagesA : setMessagesB;
      const setExecuting = panelId === 'a' ? setIsExecutingA : setIsExecutingB;
      const setActiveTools = panelId === 'a' ? setActiveToolsA : setActiveToolsB;
      const eventSourceRef = panelId === 'a' ? eventSourceRefA : eventSourceRefB;
      const streamingRef = panelId === 'a' ? streamingRefA : streamingRefB;

      setExecuting(true);
      setActiveTools([]);
      streamingRef.current = '';

      // Add user message + streaming assistant placeholder
      const assistantMsgId = generateMessageId();
      setMessages((prev) => [
        ...prev,
        { id: generateMessageId(), role: 'user', content: message },
        { id: assistantMsgId, role: 'assistant', content: '', isStreaming: true },
      ]);

      // -- helpers that mirror AssistantContext.tsx --
      const appendToStreaming = (text: string) => {
        if (streamingRef.current && !streamingRef.current.endsWith('\n') && !text.startsWith('\n')) {
          streamingRef.current += '\n\n';
        }
        streamingRef.current += text;
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (last?.role === 'assistant' && last.isStreaming) {
            return [...prev.slice(0, -1), { ...last, content: streamingRef.current }];
          }
          return prev;
        });
      };

      const finalizeStreaming = () => {
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (last?.role === 'assistant' && last.isStreaming) {
            return [...prev.slice(0, -1), { ...last, isStreaming: false }];
          }
          return prev;
        });
        streamingRef.current = '';
        eventSourceRef.current = null;
        setActiveTools([]);
        setExecuting(false);
      };

      const handleStreamError = (errorMsg: string) => {
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (last?.role === 'assistant' && last.isStreaming) {
            return [...prev.slice(0, -1), { ...last, content: `Error: ${errorMsg}`, isStreaming: false }];
          }
          return prev;
        });
        streamingRef.current = '';
        eventSourceRef.current = null;
        setActiveTools([]);
        setExecuting(false);
      };

      const handleInterrupted = () => {
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (last?.role === 'assistant' && last.isStreaming) {
            return [...prev.slice(0, -1), { ...last, isStreaming: false }];
          }
          return prev;
        });
        streamingRef.current = '';
        eventSourceRef.current = null;
        setActiveTools([]);
        setExecuting(false);
      };

      try {
        const { stream_url } = await runPanel(sessionId, panelId, message);
        const url = getAjaxUrl(stream_url);
        const eventSource = new EventSource(url);
        eventSourceRef.current = eventSource;

        // Same event handling as AssistantService.sendMessageStream
        eventSource.addEventListener('message', (event) => {
          try {
            const data = JSON.parse(event.data);
            if (data.message?.content) {
              const { content } = data.message;
              if (typeof content === 'string') {
                appendToStreaming(content);
              } else if (Array.isArray(content)) {
                processContentBlocks(content, appendToStreaming, setActiveTools);
              }
            }
          } catch {
            // ignore parse errors
          }
        });

        eventSource.addEventListener('stream_event', (event) => {
          try {
            const data = JSON.parse(event.data);
            if (data.event) {
              if (data.event.type === 'content_delta' && data.event.delta?.text) {
                appendToStreaming(data.event.delta.text);
              }
            }
          } catch {
            // ignore parse errors
          }
        });

        eventSource.addEventListener('done', () => {
          finalizeStreaming();
          eventSource.close();
        });

        eventSource.addEventListener('interrupted', () => {
          handleInterrupted();
          eventSource.close();
        });

        eventSource.addEventListener('error', (event) => {
          if (event.type === 'error' && (event as MessageEvent).data) {
            try {
              const data = JSON.parse((event as MessageEvent).data);
              handleStreamError(data.error || 'Unknown error');
            } catch {
              handleStreamError('Connection error');
            }
          } else if (eventSource.readyState === EventSource.CLOSED) {
            return;
          } else {
            handleStreamError('Connection error');
          }
          eventSource.close();
        });
      } catch (err) {
        handleStreamError(err instanceof Error ? err.message : 'Failed to start execution');
      }
    },
    [sessionId],
  );

  const cancel = useCallback(
    async (panelId: PanelId) => {
      if (!sessionId) return;

      const eventSourceRef = panelId === 'a' ? eventSourceRefA : eventSourceRefB;
      const setExecuting = panelId === 'a' ? setIsExecutingA : setIsExecutingB;
      const setActiveTools = panelId === 'a' ? setActiveToolsA : setActiveToolsB;
      const streamingRef = panelId === 'a' ? streamingRefA : streamingRefB;
      const setMessages = panelId === 'a' ? setMessagesA : setMessagesB;

      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }

      try {
        await cancelPanel(sessionId, panelId);
      } catch {
        // ignore cancel errors
      }

      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (last?.role === 'assistant' && last.isStreaming) {
          return [...prev.slice(0, -1), { ...last, isStreaming: false }];
        }
        return prev;
      });
      streamingRef.current = '';
      setActiveTools([]);
      setExecuting(false);
    },
    [sessionId],
  );

  const reset = useCallback(
    (panelId: PanelId) => {
      const eventSourceRef = panelId === 'a' ? eventSourceRefA : eventSourceRefB;
      const streamingRef = panelId === 'a' ? streamingRefA : streamingRefB;
      const setMessages = panelId === 'a' ? setMessagesA : setMessagesB;
      const setExecuting = panelId === 'a' ? setIsExecutingA : setIsExecutingB;
      const setActiveTools = panelId === 'a' ? setActiveToolsA : setActiveToolsB;

      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }

      setMessages([]);
      setExecuting(false);
      setActiveTools([]);
      streamingRef.current = '';
    },
    [],
  );

  return { execute, cancel, reset, messagesA, messagesB, isExecutingA, isExecutingB, activeToolsA, activeToolsB };
};
