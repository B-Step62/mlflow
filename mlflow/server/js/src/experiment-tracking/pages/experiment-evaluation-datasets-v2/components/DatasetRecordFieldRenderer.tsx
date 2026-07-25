import { Button, ChevronDownIcon, DropdownMenu, Typography, useDesignSystemTheme } from '@databricks/design-system';
import { useRef } from 'react';
import { FormattedMessage, useIntl } from 'react-intl';
import { LazyJsonRecordEditor } from './LazyJsonRecordEditor';
import {
  getChatMessagesFromRecordValue,
  stringifyRecordObject,
  type RecordEditorFormat,
} from '../utils/datasetRecordRendering';
import type { ModelTraceChatMessage } from '../../../../shared/web-shared/model-trace-explorer/ModelTrace.types';
import { ModelTraceExplorerChatMessage } from '../../../../shared/web-shared/model-trace-explorer/right-pane/ModelTraceExplorerChatMessage';

export type DatasetRecordFieldRenderMode = 'yaml' | 'json' | 'chat';

interface DatasetRecordFieldState {
  text: string;
  setText: (next: string) => void;
  parsed: Record<string, unknown> | undefined;
  isValid: boolean;
}

interface DatasetRecordFieldRendererProps {
  fieldKey: 'inputs' | 'expectations';
  value: DatasetRecordFieldState;
  renderMode: DatasetRecordFieldRenderMode;
  editorFormat: RecordEditorFormat;
  ariaLabel: string;
  onSaveShortcut: () => void;
  onNavigateRecord?: (direction: -1 | 1) => void;
  canNavigatePreviousRecord?: boolean;
  canNavigateNextRecord?: boolean;
}

interface DatasetRecordFieldRenderModeSelectorProps {
  fieldKey: 'inputs' | 'expectations';
  value: DatasetRecordFieldState;
  renderMode: DatasetRecordFieldRenderMode;
  onRenderModeChange: (mode: DatasetRecordFieldRenderMode) => void;
  editorFormat: RecordEditorFormat;
  onEditorFormatChange: (format: RecordEditorFormat) => void;
}

const CHAT_MESSAGE_KEYS = ['messages', 'conversation', 'chat', 'history'] as const;

const editableModeToFormat = (mode: DatasetRecordFieldRenderMode): RecordEditorFormat | undefined => {
  if (mode === 'json' || mode === 'yaml') return mode;
  return undefined;
};

const getStoredMessagesKey = (value: Record<string, unknown> | undefined): string | undefined =>
  CHAT_MESSAGE_KEYS.find((key) => Array.isArray(value?.[key]));

const getFallbackMessageContent = (
  value: Record<string, unknown> | undefined,
  fieldKey: 'inputs' | 'expectations',
): string => {
  const keys =
    fieldKey === 'expectations'
      ? ['expected_response', 'expected', 'expectation', 'answer', 'response', 'output', 'content', 'text']
      : ['question', 'query', 'prompt', 'input', 'message', 'content', 'text'];
  for (const key of keys) {
    const candidate = value?.[key];
    if (typeof candidate === 'string') return candidate;
    if (typeof candidate === 'number' || typeof candidate === 'boolean') return String(candidate);
  }
  return '';
};

const getEditableChatMessages = (
  value: Record<string, unknown> | undefined,
  fieldKey: 'inputs' | 'expectations',
): ModelTraceChatMessage[] => {
  const messages = getChatMessagesFromRecordValue(value);
  if (messages && messages.length > 0) {
    return messages.map((message) => ({ ...message, content: message.content ?? '' }));
  }
  return [
    {
      role: fieldKey === 'expectations' ? 'assistant' : 'user',
      content: getFallbackMessageContent(value, fieldKey),
    },
  ];
};

export const DatasetRecordFieldRenderModeSelector = ({
  fieldKey,
  value,
  renderMode,
  onRenderModeChange,
  editorFormat,
  onEditorFormatChange,
}: DatasetRecordFieldRenderModeSelectorProps) => {
  const { theme } = useDesignSystemTheme();
  const intl = useIntl();

  const selectedModeLabel = (() => {
    switch (renderMode) {
      case 'yaml':
        return intl.formatMessage({
          defaultMessage: 'YAML',
          description: 'Dataset record field render mode label for YAML',
        });
      case 'json':
        return intl.formatMessage({
          defaultMessage: 'JSON',
          description: 'Dataset record field render mode label for JSON',
        });
      case 'chat':
        return intl.formatMessage({
          defaultMessage: 'Chat',
          description: 'Dataset record field render mode label for chat view',
        });
      default:
        return renderMode;
    }
  })();

  const handleModeChange = (nextMode: DatasetRecordFieldRenderMode) => {
    const nextEditorFormat = editableModeToFormat(nextMode);
    if (nextEditorFormat && nextEditorFormat !== editorFormat) {
      if (value.isValid) {
        value.setText(stringifyRecordObject(value.parsed ?? {}, nextEditorFormat));
      }
      onEditorFormatChange(nextEditorFormat);
    }
    onRenderModeChange(nextMode);
  };

  return (
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger asChild>
        <Button
          componentId="mlflow.eval-datasets-v2.side-panel.record-field.render-mode-trigger"
          type="tertiary"
          size="small"
          endIcon={<ChevronDownIcon />}
          aria-label={intl.formatMessage(
            {
              defaultMessage: '{field} view mode',
              description: 'Aria label for the dataset record field render mode dropdown',
            },
            { field: fieldKey },
          )}
          css={{
            border: 'none',
            boxShadow: 'none',
            backgroundColor: 'transparent',
            color: theme.colors.textSecondary,
            paddingLeft: theme.spacing.xs,
            paddingRight: theme.spacing.xs,
            '&:hover': {
              border: 'none',
              boxShadow: 'none',
            },
          }}
        >
          {selectedModeLabel}
        </Button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Content align="end">
        <DropdownMenu.RadioGroup
          componentId="mlflow.eval-datasets-v2.side-panel.record-field.render-mode"
          value={renderMode}
          onValueChange={(nextMode) => handleModeChange(nextMode as DatasetRecordFieldRenderMode)}
        >
          <DropdownMenu.RadioItem value="yaml">
            <DropdownMenu.ItemIndicator />
            <FormattedMessage defaultMessage="YAML" description="Dataset record field render mode option for YAML" />
          </DropdownMenu.RadioItem>
          <DropdownMenu.RadioItem value="json">
            <DropdownMenu.ItemIndicator />
            <FormattedMessage defaultMessage="JSON" description="Dataset record field render mode option for JSON" />
          </DropdownMenu.RadioItem>
          <DropdownMenu.RadioItem value="chat">
            <DropdownMenu.ItemIndicator />
            <FormattedMessage defaultMessage="Chat" description="Dataset record field render mode option for chat" />
          </DropdownMenu.RadioItem>
        </DropdownMenu.RadioGroup>
      </DropdownMenu.Content>
    </DropdownMenu.Root>
  );
};

export const DatasetRecordFieldRenderer = ({
  fieldKey,
  value,
  renderMode,
  editorFormat,
  ariaLabel,
  onSaveShortcut,
  onNavigateRecord,
  canNavigatePreviousRecord = true,
  canNavigateNextRecord = true,
}: DatasetRecordFieldRendererProps) => {
  const { theme } = useDesignSystemTheme();
  const intl = useIntl();
  const messageRefs = useRef<Array<HTMLTextAreaElement | null>>([]);

  const invalidMessage =
    editorFormat === 'yaml'
      ? intl.formatMessage({
          defaultMessage: 'Invalid YAML',
          description:
            'Inline error shown under a dataset record YAML editor when the contents do not parse as an object',
        })
      : intl.formatMessage({
          defaultMessage: 'Invalid JSON',
          description:
            'Inline error shown under a dataset record JSON editor when the contents do not parse as an object',
        });

  const chatMessages = getEditableChatMessages(value.parsed, fieldKey);

  const updateChatMessageContent = (index: number, content: string) => {
    const nextObject = { ...(value.parsed ?? {}) };
    const messageKey = getStoredMessagesKey(value.parsed) ?? 'messages';
    const storedMessages = Array.isArray(value.parsed?.[messageKey]) ? (value.parsed[messageKey] as unknown[]) : [];
    nextObject[messageKey] = chatMessages.map((message, messageIndex) => {
      const storedMessage = storedMessages[messageIndex];
      const base =
        storedMessage && typeof storedMessage === 'object' && !Array.isArray(storedMessage)
          ? (storedMessage as Record<string, unknown>)
          : {};
      return {
        ...base,
        role: message.role,
        content: messageIndex === index ? content : (message.content ?? ''),
      };
    });
    value.setText(stringifyRecordObject(nextObject, editorFormat));
  };

  const focusMessage = (index: number, position: 'start' | 'end') => {
    window.requestAnimationFrame(() => {
      const next = messageRefs.current[index];
      if (!next) return;
      next.focus();
      const cursor = position === 'end' ? next.value.length : 0;
      next.setSelectionRange(cursor, cursor);
    });
  };

  const handleChatKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>, index: number) => {
    const target = event.currentTarget;
    if (event.key === 'ArrowUp' && index > 0 && target.selectionStart === 0 && target.selectionEnd === 0) {
      event.preventDefault();
      focusMessage(index - 1, 'end');
      return;
    }
    if (
      event.key === 'ArrowUp' &&
      index === 0 &&
      target.selectionStart === 0 &&
      target.selectionEnd === 0 &&
      onNavigateRecord &&
      canNavigatePreviousRecord
    ) {
      event.preventDefault();
      onNavigateRecord(-1);
      return;
    }
    if (
      event.key === 'ArrowDown' &&
      index < chatMessages.length - 1 &&
      target.selectionStart === target.value.length &&
      target.selectionEnd === target.value.length
    ) {
      event.preventDefault();
      focusMessage(index + 1, 'start');
      return;
    }
    if (
      event.key === 'ArrowDown' &&
      index === chatMessages.length - 1 &&
      target.selectionStart === target.value.length &&
      target.selectionEnd === target.value.length &&
      onNavigateRecord &&
      canNavigateNextRecord
    ) {
      event.preventDefault();
      onNavigateRecord(1);
    }
  };

  const getRoleLabel = (role: ModelTraceChatMessage['role']) => {
    switch (role) {
      case 'assistant':
        return intl.formatMessage({
          defaultMessage: 'Assistant',
          description: 'Role label for assistant messages in the dataset record chat editor',
        });
      case 'system':
        return intl.formatMessage({
          defaultMessage: 'System',
          description: 'Role label for system messages in the dataset record chat editor',
        });
      case 'tool':
        return intl.formatMessage({
          defaultMessage: 'Tool',
          description: 'Role label for tool messages in the dataset record chat editor',
        });
      case 'user':
        return intl.formatMessage({
          defaultMessage: 'User',
          description: 'Role label for user messages in the dataset record chat editor',
        });
      default:
        return role;
    }
  };

  const getPlaceholder = (role: ModelTraceChatMessage['role']) => {
    if (fieldKey === 'expectations' && role === 'assistant') {
      return intl.formatMessage({
        defaultMessage: 'type expected output',
        description: 'Placeholder for an empty assistant message in the expectations chat editor',
      });
    }
    if (role === 'assistant') {
      return intl.formatMessage({
        defaultMessage: 'type assistant message',
        description: 'Placeholder for an empty assistant message in the dataset record chat editor',
      });
    }
    return intl.formatMessage({
      defaultMessage: 'type message',
      description: 'Placeholder for an empty message in the dataset record chat editor',
    });
  };

  const invalidState = (
    <div
      css={{
        border: `1px solid ${theme.colors.borderDanger}`,
        borderRadius: theme.borders.borderRadiusSm,
        padding: theme.spacing.sm,
      }}
    >
      <Typography.Text color="error">{invalidMessage}</Typography.Text>
    </div>
  );

  const renderBody = () => {
    if (renderMode === 'json' || renderMode === 'yaml') {
      return (
        <LazyJsonRecordEditor
          value={value.text}
          onChange={value.setText}
          language={renderMode}
          ariaLabel={ariaLabel}
          errorMessage={value.isValid ? undefined : invalidMessage}
          onSaveShortcut={onSaveShortcut}
        />
      );
    }

    if (!value.isValid) {
      return invalidState;
    }

    return (
      <div css={{ display: 'flex', flexDirection: 'column', gap: theme.spacing.sm }}>
        {chatMessages.map((message, index) => (
          <ModelTraceExplorerChatMessage
            key={index}
            css={{
              maxWidth: message.role === 'user' ? '80%' : '95%',
              alignSelf: 'flex-start',
              border: `1px solid ${theme.colors.border}`,
              borderRadius: theme.borders.borderRadiusMd,
            }}
            message={message}
            renderContent={() => (
              <>
                <textarea
                  ref={(element) => {
                    messageRefs.current[index] = element;
                  }}
                  value={message.content ?? ''}
                  placeholder={getPlaceholder(message.role)}
                  rows={Math.max(2, Math.min(8, (message.content ?? '').split('\n').length))}
                  onChange={(event) => updateChatMessageContent(index, event.target.value)}
                  onKeyDown={(event) => handleChatKeyDown(event, index)}
                  aria-label={intl.formatMessage(
                    {
                      defaultMessage: '{role} message',
                      description: 'Aria label for a dataset record chat message textarea',
                    },
                    { role: getRoleLabel(message.role) },
                  )}
                  css={{
                    width: '100%',
                    boxSizing: 'border-box',
                    border: 'none',
                    outline: 'none',
                    resize: 'vertical',
                    color: theme.colors.textPrimary,
                    backgroundColor: 'transparent',
                    padding: theme.spacing.sm,
                    paddingTop: 0,
                    font: 'inherit',
                    lineHeight: theme.typography.lineHeightBase,
                    '&::placeholder': {
                      color: theme.colors.textSecondary,
                    },
                    '&:focus-visible': {
                      boxShadow: `inset 0 0 0 2px ${theme.colors.actionDefaultBorderFocus}`,
                    },
                  }}
                />
              </>
            )}
          />
        ))}
      </div>
    );
  };

  return renderBody();
};
