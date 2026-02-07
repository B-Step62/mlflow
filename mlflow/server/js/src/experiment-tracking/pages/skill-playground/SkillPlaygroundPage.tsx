import { useState, useCallback, useEffect } from 'react';
import { useDesignSystemTheme } from '@databricks/design-system';
import { PlaygroundPanel } from './components/PlaygroundPanel';
import { FeedbackBar } from './components/FeedbackBar';
import { PromptInput } from './components/PromptInput';
import { usePlaygroundSession } from './hooks/usePlaygroundSession';
import { usePanelExecution } from './hooks/usePanelExecution';
import type { PanelConfig, PanelId, Preference } from './types';

const DEFAULT_CONFIG_A: PanelConfig = {
  panelId: 'a',
  name: 'Panel A',
  skills: [],
  allowedTools: ['Bash', 'Read', 'Write', 'Edit', 'Skill'],
  model: 'sonnet',
};

const DEFAULT_CONFIG_B: PanelConfig = {
  panelId: 'b',
  name: 'Panel B',
  skills: [],
  allowedTools: ['Bash', 'Read', 'Write', 'Edit', 'Skill'],
  model: 'sonnet',
};

export const SkillPlaygroundPage = ({ experimentId }: { experimentId: string }) => {
  const { theme } = useDesignSystemTheme();
  const { sessionId, session, savePanelConfig } = usePlaygroundSession(experimentId);

  const [configA, setConfigA] = useState<PanelConfig>(DEFAULT_CONFIG_A);
  const [configB, setConfigB] = useState<PanelConfig>(DEFAULT_CONFIG_B);
  const [promptA, setPromptA] = useState('');
  const [promptB, setPromptB] = useState('');
  const { execute, cancel, reset, messagesA, messagesB, isExecutingA, isExecutingB, activeToolsA, activeToolsB } =
    usePanelExecution(sessionId);

  // Sync local config from session when it first loads
  useEffect(() => {
    if (session) {
      setConfigA((prev) => ({ ...session.configA, name: prev.name }));
      setConfigB((prev) => ({ ...session.configB, name: prev.name }));
    }
  }, [session]);

  const handleConfigChangeA = useCallback(
    (config: PanelConfig) => {
      setConfigA(config);
      savePanelConfig('a', config);
    },
    [savePanelConfig],
  );

  const handleConfigChangeB = useCallback(
    (config: PanelConfig) => {
      setConfigB(config);
      savePanelConfig('b', config);
    },
    [savePanelConfig],
  );

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

  const handleRun = useCallback(
    (panelId: PanelId) => {
      const prompt = panelId === 'a' ? promptA : promptB;
      if (!prompt.trim()) return;

      const setPrompt = panelId === 'a' ? setPromptA : setPromptB;
      setPrompt('');
      execute(panelId, prompt);
    },
    [promptA, promptB, execute],
  );

  const handleFeedback = useCallback((_preference: Preference, _comment: string) => {
    // TODO: wire up to backend (Milestone 6)
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
            onConfigChange={handleConfigChangeA}
            messages={messagesA}
            activeTools={activeToolsA}
            onReset={() => reset('a')}
            experimentId={experimentId}
          />
        </div>
        <div css={{ display: 'flex', flexDirection: 'column', minHeight: 0, minWidth: 0 }}>
          <PlaygroundPanel
            panelId="b"
            panelLabel="B"
            config={configB}
            onConfigChange={handleConfigChangeB}
            messages={messagesB}
            activeTools={activeToolsB}
            onReset={() => reset('b')}
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
            isExecuting={isExecutingA}
            onCancel={() => cancel('a')}
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
            isExecuting={isExecutingB}
            onCancel={() => cancel('b')}
          />
        </div>
      </div>
    </div>
  );
};
