import { Button, CopyIcon, useDesignSystemTheme } from '@databricks/design-system';
import type { PanelId } from '../types';

interface PromptInputProps {
  panelId: PanelId;
  value: string;
  onChange: (value: string) => void;
  onRun: () => void;
  onCopy: () => void;
  copyLabel: string;
  isExecuting?: boolean;
  onCancel?: () => void;
}

export const PromptInput = ({
  panelId,
  value,
  onChange,
  onRun,
  onCopy,
  copyLabel,
  isExecuting,
  onCancel,
}: PromptInputProps) => {
  const { theme } = useDesignSystemTheme();
  const isLeft = panelId === 'a';

  return (
    <div css={{ padding: theme.spacing.sm }}>
      <div css={{ display: 'flex', gap: theme.spacing.sm, alignItems: 'flex-end' }}>
        {/* Textarea container with copy icon inside */}
        <div css={{ flex: 1, position: 'relative' }}>
          <textarea
            placeholder="Type your prompt..."
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                if (value.trim()) {
                  onRun();
                }
              }
            }}
            css={{
              width: '100%',
              resize: 'none',
              border: `1px solid ${theme.colors.border}`,
              borderRadius: theme.borders.borderRadiusMd,
              padding: theme.spacing.sm,
              paddingBottom: theme.spacing.lg + theme.spacing.xs,
              fontSize: theme.typography.fontSizeBase,
              fontFamily: 'inherit',
              color: theme.colors.textPrimary,
              backgroundColor: theme.colors.backgroundPrimary,
              minHeight: 40,
              maxHeight: 120,
              boxSizing: 'border-box',
              '&:focus': {
                outline: 'none',
                borderColor: theme.colors.actionPrimaryBackgroundDefault,
              },
              '&::placeholder': {
                color: theme.colors.textPlaceholder,
              },
            }}
            rows={1}
          />
          <button
            type="button"
            onClick={onCopy}
            title={copyLabel}
            css={{
              position: 'absolute',
              bottom: theme.spacing.xs,
              ...(isLeft ? { right: theme.spacing.xs } : { left: theme.spacing.xs }),
              display: 'flex',
              alignItems: 'center',
              gap: 2,
              padding: `2px ${theme.spacing.xs}px`,
              border: 'none',
              borderRadius: theme.borders.borderRadiusSm,
              backgroundColor: 'transparent',
              color: theme.colors.textSecondary,
              cursor: 'pointer',
              fontSize: theme.typography.fontSizeSm,
              '&:hover': {
                backgroundColor: theme.colors.backgroundSecondary,
                color: theme.colors.textPrimary,
              },
            }}
          >
            {isLeft ? (
              <>
                <CopyIcon css={{ width: 12, height: 12 }} />
                <span>{'»'}</span>
              </>
            ) : (
              <>
                <span>{'«'}</span>
                <CopyIcon css={{ width: 12, height: 12 }} />
              </>
            )}
          </button>
        </div>
        {isExecuting ? (
          <Button
            componentId={`mlflow.skill-playground.panel-${panelId}.cancel`}
            type="tertiary"
            onClick={onCancel}
          >
            Cancel
          </Button>
        ) : (
          <Button
            componentId={`mlflow.skill-playground.panel-${panelId}.run`}
            type="primary"
            onClick={onRun}
            disabled={!value.trim()}
          >
            Run
          </Button>
        )}
      </div>
    </div>
  );
};
