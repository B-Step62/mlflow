import { useState, useCallback } from 'react';
import { useDesignSystemTheme } from '@databricks/design-system';
import { PlaygroundPanel } from './components/PlaygroundPanel';
import { FeedbackBar } from './components/FeedbackBar';
import { PromptInput } from './components/PromptInput';
import { DUMMY_CONFIG_A, DUMMY_CONFIG_B, DUMMY_MESSAGES_A, DUMMY_MESSAGES_B } from './dummy-data';
import type { PanelConfig, ChatMessage, Preference } from './types';

export const SkillPlaygroundPage = ({ experimentId }: { experimentId: string }) => {
  const { theme } = useDesignSystemTheme();

  const [configA, setConfigA] = useState<PanelConfig>(DUMMY_CONFIG_A);
  const [configB, setConfigB] = useState<PanelConfig>(DUMMY_CONFIG_B);
  const [messagesA] = useState<ChatMessage[]>(DUMMY_MESSAGES_A);
  const [messagesB] = useState<ChatMessage[]>(DUMMY_MESSAGES_B);
  const [promptA, setPromptA] = useState('');
  const [promptB, setPromptB] = useState('');

  const handleCopyPrompt = useCallback(
    (from: 'a' | 'b') => {
      if (from === 'a') {
        setPromptB(promptA);
      } else {
        setPromptA(promptB);
      }
    },
    [promptA, promptB],
  );

  const handleRun = useCallback((_panelId: 'a' | 'b') => {
    // TODO: wire up to backend
  }, []);

  const handleFeedback = useCallback((_preference: Preference, _comment: string) => {
    // TODO: wire up to backend
  }, []);

  // Check if both panels have completed responses (for enabling feedback)
  const lastMessageA = messagesA[messagesA.length - 1];
  const lastMessageB = messagesB[messagesB.length - 1];
  const bothComplete =
    lastMessageA?.role === 'assistant' &&
    !lastMessageA?.isStreaming &&
    lastMessageB?.role === 'assistant' &&
    !lastMessageB?.isStreaming;

  return (
    <div
      css={{
        display: 'flex',
        flexDirection: 'column',
        flex: 1,
        minHeight: 0,
        overflow: 'hidden',
      }}
    >
      {/* Main split layout: two panels side by side */}
      <div
        css={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          flex: 1,
          minHeight: 0,
        }}
      >
        <div
          css={{
            borderRight: `1px solid ${theme.colors.border}`,
            display: 'flex',
            flexDirection: 'column',
            minHeight: 0,
            minWidth: 0,
          }}
        >
          <PlaygroundPanel
            panelId="a"
            panelLabel="A"
            config={configA}
            onConfigChange={setConfigA}
            messages={messagesA}
            experimentId={experimentId}
          />
        </div>
        <div css={{ display: 'flex', flexDirection: 'column', minHeight: 0, minWidth: 0 }}>
          <PlaygroundPanel
            panelId="b"
            panelLabel="B"
            config={configB}
            onConfigChange={setConfigB}
            messages={messagesB}
            experimentId={experimentId}
          />
        </div>
      </div>

      {/* Feedback bar - spans full width */}
      <FeedbackBar enabled={bothComplete} onSubmit={handleFeedback} />

      {/* Prompt inputs - split */}
      <div
        css={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          borderTop: `1px solid ${theme.colors.border}`,
          flexShrink: 0,
        }}
      >
        <div css={{ borderRight: `1px solid ${theme.colors.border}` }}>
          <PromptInput
            panelId="a"
            value={promptA}
            onChange={setPromptA}
            onRun={() => handleRun('a')}
            onCopy={() => handleCopyPrompt('a')}
            copyLabel="Copy to B >>"
          />
        </div>
        <div>
          <PromptInput
            panelId="b"
            value={promptB}
            onChange={setPromptB}
            onRun={() => handleRun('b')}
            onCopy={() => handleCopyPrompt('b')}
            copyLabel="<< Copy to A"
          />
        </div>
      </div>
    </div>
  );
};
