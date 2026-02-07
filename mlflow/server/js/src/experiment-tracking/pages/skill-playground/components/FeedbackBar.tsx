import { useState } from 'react';
import { Button, Typography, useDesignSystemTheme } from '@databricks/design-system';
import type { Preference } from '../types';

interface FeedbackBarProps {
  enabled: boolean;
  onSubmit: (preference: Preference, comment: string) => void;
}

const PREFERENCE_OPTIONS: { value: Preference; label: string }[] = [
  { value: 'A', label: 'A is better' },
  { value: 'B', label: 'B is better' },
  { value: 'tie', label: 'Tie' },
  { value: 'both_bad', label: 'Both bad' },
];

export const FeedbackBar = ({ enabled, onSubmit }: FeedbackBarProps) => {
  const { theme } = useDesignSystemTheme();
  const [selected, setSelected] = useState<Preference | null>(null);
  const [comment, setComment] = useState('');
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = () => {
    if (!selected) return;
    onSubmit(selected, comment);
    setSubmitted(true);
  };

  if (submitted) {
    return (
      <div
        css={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: `${theme.spacing.sm}px ${theme.spacing.md}px`,
          backgroundColor: theme.colors.backgroundSecondary,
          borderTop: `1px solid ${theme.colors.border}`,
          borderBottom: `1px solid ${theme.colors.border}`,
          gap: theme.spacing.sm,
        }}
      >
        <Typography.Text color="secondary">
          Feedback submitted: <strong>{PREFERENCE_OPTIONS.find((o) => o.value === selected)?.label}</strong>
        </Typography.Text>
        <Button
          componentId="mlflow.skill-playground.feedback.reset"
          type="link"
          size="small"
          onClick={() => {
            setSubmitted(false);
            setSelected(null);
            setComment('');
          }}
        >
          Change
        </Button>
      </div>
    );
  }

  return (
    <div
      css={{
        display: 'flex',
        alignItems: 'center',
        padding: `${theme.spacing.sm}px ${theme.spacing.md}px`,
        backgroundColor: theme.colors.backgroundSecondary,
        borderTop: `1px solid ${theme.colors.border}`,
        borderBottom: `1px solid ${theme.colors.border}`,
        gap: theme.spacing.sm,
        opacity: enabled ? 1 : 0.5,
        pointerEvents: enabled ? 'auto' : 'none',
        flexShrink: 0,
      }}
    >
      <Typography.Text size="sm" bold css={{ flexShrink: 0 }}>
        Which is better?
      </Typography.Text>

      {PREFERENCE_OPTIONS.map((option) => (
        <Button
          key={option.value}
          componentId={`mlflow.skill-playground.feedback.${option.value}`}
          type={selected === option.value ? 'primary' : 'tertiary'}
          size="small"
          onClick={() => setSelected(option.value)}
        >
          {option.label}
        </Button>
      ))}

      <input
        placeholder="Comment (optional)"
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        css={{
          flex: 1,
          minWidth: 120,
          border: `1px solid ${theme.colors.border}`,
          borderRadius: theme.borders.borderRadiusMd,
          padding: `${theme.spacing.xs}px ${theme.spacing.sm}px`,
          fontSize: theme.typography.fontSizeSm,
          color: theme.colors.textPrimary,
          backgroundColor: theme.colors.backgroundPrimary,
          '&::placeholder': { color: theme.colors.textPlaceholder },
        }}
      />

      <Button
        componentId="mlflow.skill-playground.feedback.submit"
        type="primary"
        size="small"
        disabled={!selected}
        onClick={handleSubmit}
      >
        Submit
      </Button>
    </div>
  );
};
