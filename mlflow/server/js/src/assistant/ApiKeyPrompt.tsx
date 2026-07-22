/**
 * Inline in-chat prompt collecting the resolved provider's API key, shown above
 * the composer when the next send needs one. The first send doubles as setup:
 * the queued message is delivered as soon as the key is saved.
 */
import { useCallback, useState } from 'react';
import { Button, Typography, useDesignSystemTheme } from '@databricks/design-system';
import { FormattedMessage } from '@databricks/i18n';

import { updateConfig } from './AssistantService';
import { getAssistantProvider } from './providerRegistry';
import { SecretInput } from '../gateway/components/secrets/SecretInput';

// Key-format placeholders per provider, matching the ones used in the setup
// wizard's auth steps (e.g. OpenAIAuth) so the key is asked the same way everywhere.
const PROVIDER_KEY_PLACEHOLDERS = { openai: 'sk-...', anthropic: 'sk-ant-...' } satisfies Record<string, string>;
const DEFAULT_KEY_PLACEHOLDER = 'API key';

const keyPlaceholderFor = (providerId: string): string =>
  (PROVIDER_KEY_PLACEHOLDERS as Record<string, string | undefined>)[providerId] ?? DEFAULT_KEY_PLACEHOLDER;

interface ApiKeyPromptProps {
  /** Provider id (as keyed in `/config`) the key is for. */
  providerId: string;
  /** Called after the key was saved successfully. */
  onSaved: () => void;
}

export const ApiKeyPrompt = ({ providerId, onSaved }: ApiKeyPromptProps) => {
  const { theme } = useDesignSystemTheme();
  const providerName = getAssistantProvider(providerId)?.name ?? providerId;
  const [apiKey, setApiKey] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = useCallback(async () => {
    if (!apiKey.trim()) {
      return;
    }
    setIsSaving(true);
    setError(null);
    try {
      await updateConfig({ providers: { [providerId]: { api_key: apiKey.trim() } } });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save the API key');
      setIsSaving(false);
    }
  }, [apiKey, providerId, onSaved]);

  return (
    <div
      css={{
        border: `1px solid ${theme.colors.borderWarning}`,
        borderRadius: theme.borders.borderRadiusMd,
        backgroundColor: theme.colors.backgroundValidationWarning,
        padding: theme.spacing.md,
        marginBottom: theme.spacing.sm,
        display: 'flex',
        flexDirection: 'column',
        gap: theme.spacing.sm,
      }}
    >
      <Typography.Text>
        <FormattedMessage
          defaultMessage="Add your {provider} API key to continue, or pick another provider below."
          description="Explanation shown in the inline assistant API key prompt"
          values={{ provider: providerName }}
        />
      </Typography.Text>

      <SecretInput
        componentId="mlflow.assistant.api_key_prompt.input"
        value={apiKey}
        onChange={(e) => {
          setApiKey(e.target.value);
          if (error) setError(null);
        }}
        placeholder={keyPlaceholderFor(providerId)}
        allowClear={false}
      />

      <Typography.Text color="secondary" css={{ fontSize: theme.typography.fontSizeSm - 1 }}>
        <FormattedMessage
          defaultMessage="Your key is stored in MLflow LLM Connections on this server."
          description="Note in the inline assistant API key prompt about how the key is stored"
        />
      </Typography.Text>

      {error && (
        <Typography.Text css={{ color: theme.colors.textValidationDanger, fontSize: theme.typography.fontSizeSm }}>
          {error}
        </Typography.Text>
      )}

      <div css={{ display: 'flex', justifyContent: 'flex-end' }}>
        <Button
          componentId="mlflow.assistant.api_key_prompt.save"
          type="primary"
          onClick={handleSave}
          loading={isSaving}
          disabled={!apiKey.trim()}
        >
          <FormattedMessage
            defaultMessage="Continue"
            description="Confirm button of the inline assistant API key prompt"
          />
        </Button>
      </div>
    </div>
  );
};
