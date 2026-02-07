import { useState, useRef, useEffect, useCallback } from 'react';
import { GearIcon, Popover, useDesignSystemTheme, Typography } from '@databricks/design-system';
import { PanelConfigBar } from './PanelConfigBar';
import { ChatHistory } from './ChatHistory';
import type { PanelConfig, ChatMessage, PanelId } from '../types';
import type { ToolUseInfo } from '@mlflow/mlflow/src/assistant/types';

interface PlaygroundPanelProps {
  panelId: PanelId;
  panelLabel: string;
  config: PanelConfig;
  onConfigChange: (config: PanelConfig) => void;
  messages: ChatMessage[];
  activeTools?: ToolUseInfo[];
  experimentId: string;
}

export const PlaygroundPanel = ({
  panelId,
  panelLabel,
  config,
  onConfigChange,
  messages,
  activeTools,
  experimentId,
}: PlaygroundPanelProps) => {
  const { theme } = useDesignSystemTheme();
  const [configOpen, setConfigOpen] = useState(false);
  const [isEditingName, setIsEditingName] = useState(false);
  const [editName, setEditName] = useState(config.name);
  const nameInputRef = useRef<HTMLInputElement>(null);

  // Draft config for the popover — only committed to parent on explicit Save
  const [draftConfig, setDraftConfig] = useState<PanelConfig>(config);

  // Reset draft to saved config whenever popover opens
  useEffect(() => {
    if (configOpen) {
      setDraftConfig(config);
    }
  }, [configOpen, config]);

  const isDirty = JSON.stringify(draftConfig) !== JSON.stringify(config);

  const handleSave = useCallback(() => {
    onConfigChange(draftConfig);
    setConfigOpen(false);
  }, [draftConfig, onConfigChange]);

  const handleReset = useCallback(() => {
    setDraftConfig(config);
  }, [config]);

  useEffect(() => {
    if (isEditingName) {
      nameInputRef.current?.focus();
      nameInputRef.current?.select();
    }
  }, [isEditingName]);

  const commitName = () => {
    const trimmed = editName.trim();
    if (trimmed) {
      onConfigChange({ ...config, name: trimmed });
    } else {
      setEditName(config.name);
    }
    setIsEditingName(false);
  };

  return (
    <div css={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      {/* Panel header */}
      <div
        css={{
          display: 'flex',
          alignItems: 'center',
          gap: theme.spacing.sm,
          padding: `${theme.spacing.sm}px ${theme.spacing.md}px`,
          borderBottom: `1px solid ${theme.colors.border}`,
          backgroundColor: theme.colors.backgroundSecondary,
          flexShrink: 0,
        }}
      >
        <div
          css={{
            width: 24,
            height: 24,
            borderRadius: '50%',
            backgroundColor: panelId === 'a' ? theme.colors.blue400 : theme.colors.green400,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#fff',
            fontSize: 12,
            fontWeight: 600,
            flexShrink: 0,
          }}
        >
          {panelLabel}
        </div>

        {/* Editable panel name */}
        {isEditingName ? (
          <input
            ref={nameInputRef}
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            onBlur={commitName}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitName();
              if (e.key === 'Escape') {
                setEditName(config.name);
                setIsEditingName(false);
              }
            }}
            css={{
              border: `1px solid ${theme.colors.actionPrimaryBackgroundDefault}`,
              borderRadius: theme.borders.borderRadiusSm,
              padding: `2px ${theme.spacing.xs}px`,
              fontSize: theme.typography.fontSizeBase,
              fontWeight: 600,
              fontFamily: 'inherit',
              color: theme.colors.textPrimary,
              backgroundColor: theme.colors.backgroundPrimary,
              outline: 'none',
              width: 140,
            }}
          />
        ) : (
          <span
            role="button"
            tabIndex={0}
            css={{
              cursor: 'pointer',
              '&:hover': { textDecoration: 'underline', textDecorationStyle: 'dashed' },
            }}
            onClick={() => {
              setEditName(config.name);
              setIsEditingName(true);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                setEditName(config.name);
                setIsEditingName(true);
              }
            }}
          >
            <Typography.Text bold>{config.name}</Typography.Text>
          </span>
        )}

        <Typography.Text color="secondary" css={{ marginLeft: 'auto', fontSize: theme.typography.fontSizeSm }}>
          {config.model}
        </Typography.Text>

        {/* Gear icon with config popover */}
        <Popover.Root
          open={configOpen}
          onOpenChange={setConfigOpen}
          componentId={`mlflow.skill-playground.panel-${panelId}.config-popover`}
        >
          <Popover.Trigger asChild>
            <button
              type="button"
              css={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 28,
                height: 28,
                border: 'none',
                borderRadius: theme.borders.borderRadiusMd,
                backgroundColor: configOpen ? theme.colors.backgroundSecondary : 'transparent',
                color: theme.colors.textSecondary,
                cursor: 'pointer',
                '&:hover': {
                  backgroundColor: theme.colors.backgroundSecondary,
                  color: theme.colors.textPrimary,
                },
              }}
            >
              <GearIcon />
            </button>
          </Popover.Trigger>
          <Popover.Content
            align="end"
            side="bottom"
            css={{
              width: 640,
              maxHeight: '70vh',
              overflow: 'auto',
              padding: 0,
            }}
          >
            <PanelConfigBar
              panelId={panelId}
              config={draftConfig}
              onLocalChange={setDraftConfig}
              onSave={handleSave}
              onReset={handleReset}
              isDirty={isDirty}
            />
          </Popover.Content>
        </Popover.Root>
      </div>

      {/* Chat history (scrollable, fills remaining space) */}
      <ChatHistory messages={messages} activeTools={activeTools} experimentId={experimentId} />
    </div>
  );
};
