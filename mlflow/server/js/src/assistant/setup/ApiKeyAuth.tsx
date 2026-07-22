import { useCallback, useEffect, useState } from 'react';
import {
  Button,
  CheckCircleIcon,
  SimpleSelect,
  SimpleSelectOption,
  Spinner,
  Typography,
  useDesignSystemTheme,
} from '@databricks/design-system';

import { listProviderModels, updateConfig } from '../AssistantService';
import { useAssistantConfigQuery } from '../hooks/useAssistantConfigQuery';
import { SecretInput } from '../../gateway/components/secrets/SecretInput';
import type { AuthState } from '../types';

// Per-provider copy for the shared key-based auth step. All these SaaS
// providers are configured identically: API key in, model picked from the
// backend's curated tool-capable list.
const API_KEY_PROVIDERS = {
  openai: {
    displayName: 'OpenAI',
    placeholder: 'sk-...',
    keysUrl: 'https://platform.openai.com/api-keys',
    keysUrlLabel: 'platform.openai.com/api-keys',
  },
  anthropic: {
    displayName: 'Anthropic',
    placeholder: 'sk-ant-...',
    keysUrl: 'https://console.anthropic.com/settings/keys',
    keysUrlLabel: 'console.anthropic.com/settings/keys',
  },
  gemini: {
    displayName: 'Gemini',
    placeholder: 'API key',
    keysUrl: 'https://aistudio.google.com/apikey',
    keysUrlLabel: 'aistudio.google.com/apikey',
  },
} satisfies Record<string, { displayName: string; placeholder: string; keysUrl: string; keysUrlLabel: string }>;

export type ApiKeyAuthProviderId = keyof typeof API_KEY_PROVIDERS;

export const isApiKeyAuthProvider = (provider: string): provider is ApiKeyAuthProviderId =>
  provider in API_KEY_PROVIDERS;

interface ApiKeyAuthProps {
  provider: ApiKeyAuthProviderId;
  cachedAuthStatus?: AuthState;
  onAuthStatusChange: (status: AuthState) => void;
  onBack: () => void;
  onContinue: () => void;
}

export const ApiKeyAuth = ({ provider, cachedAuthStatus, onAuthStatusChange, onBack, onContinue }: ApiKeyAuthProps) => {
  const { theme } = useDesignSystemTheme();
  const { config } = useAssistantConfigQuery();
  const { displayName, placeholder, keysUrl, keysUrlLabel } = API_KEY_PROVIDERS[provider];
  const [authState, setAuthState] = useState<AuthState>(cachedAuthStatus ?? 'not_authenticated');
  const [error, setError] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [models, setModels] = useState<string[]>([]);
  const [selectedModel, setSelectedModel] = useState('');
  const [isFetchingModels, setIsFetchingModels] = useState(false);

  useEffect(() => {
    setSelectedModel(config?.providers?.[provider]?.model ?? '');
  }, [config, provider]);

  const connect = useCallback(async () => {
    setAuthState('checking');
    setError(null);
    setIsFetchingModels(true);
    try {
      // base_url stays unset so the server-side default (the vendor API) applies.
      const fetchedModels = await listProviderModels(provider, undefined, apiKey.trim());
      setModels(fetchedModels);
      setSelectedModel((current) => {
        if (current && current !== 'default' && fetchedModels.includes(current)) return current;
        return fetchedModels[0] ?? '';
      });
      await updateConfig({ providers: { [provider]: { api_key: apiKey.trim() } } });
      setAuthState('authenticated');
      onAuthStatusChange('authenticated');
    } catch (err) {
      setModels([]);
      setError(err instanceof Error ? err.message : `Failed to connect to ${displayName}`);
      setAuthState('not_authenticated');
      onAuthStatusChange('not_authenticated');
    } finally {
      setIsFetchingModels(false);
    }
  }, [apiKey, provider, displayName, onAuthStatusChange]);

  const handleContinue = useCallback(async () => {
    if (selectedModel) {
      await updateConfig({ providers: { [provider]: { model: selectedModel, selected: true } } });
    }
    onContinue();
  }, [onContinue, provider, selectedModel]);

  let content: React.ReactNode;

  if (authState === 'checking') {
    content = (
      <div
        css={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: theme.spacing.lg * 2,
          gap: theme.spacing.md,
        }}
      >
        <Spinner size="default" />
        <Typography.Text color="secondary">Connecting to {displayName}...</Typography.Text>
      </div>
    );
  } else if (authState === 'authenticated') {
    content = (
      <div css={{ display: 'flex', flexDirection: 'column', gap: theme.spacing.md }}>
        <div css={{ display: 'flex', alignItems: 'center', gap: theme.spacing.sm }}>
          <CheckCircleIcon css={{ color: theme.colors.textValidationSuccess, fontSize: 20 }} />
          <Typography.Text>Connected to {displayName}</Typography.Text>
        </div>
        <div css={{ marginTop: theme.spacing.sm }}>
          <Typography.Text css={{ display: 'block', marginBottom: theme.spacing.sm }}>Select a model:</Typography.Text>
          {isFetchingModels ? (
            <Spinner size="small" />
          ) : models.length > 0 ? (
            <SimpleSelect
              id="mlflow.assistant.setup.provider.model"
              componentId="mlflow.assistant.setup.provider.model"
              value={selectedModel}
              onChange={({ target }) => setSelectedModel(target.value)}
              css={{ width: '100%' }}
            >
              {models.map((model) => (
                <SimpleSelectOption key={model} value={model}>
                  {model}
                </SimpleSelectOption>
              ))}
            </SimpleSelect>
          ) : (
            <Typography.Text color="secondary">
              No models available for this API key. Check the key's permissions, then click Connect again.
            </Typography.Text>
          )}
        </div>
      </div>
    );
  } else {
    content = (
      <div css={{ display: 'flex', flexDirection: 'column', gap: theme.spacing.md }}>
        <Typography.Text color="secondary">Enter your {displayName} API key:</Typography.Text>
        <SecretInput
          componentId="mlflow.assistant.setup.api_key_auth.input"
          value={apiKey}
          onChange={(event) => setApiKey(event.target.value)}
          placeholder={placeholder}
          allowClear={false}
        />
        {error && (
          <Typography.Text color="error" css={{ fontSize: theme.typography.fontSizeSm }}>
            {error}
          </Typography.Text>
        )}
        <Typography.Text color="secondary" css={{ fontSize: theme.typography.fontSizeSm }}>
          The key is stored in MLflow LLM Connections on this server. Create one at{' '}
          <Typography.Link componentId="mlflow.assistant.setup.api_key_auth.link" href={keysUrl} target="_blank">
            {keysUrlLabel}
          </Typography.Link>
        </Typography.Text>
      </div>
    );
  }

  const continueDisabled = authState !== 'authenticated' || isFetchingModels || models.length === 0 || !selectedModel;

  const actionButton =
    authState === 'authenticated' ? (
      <Button
        componentId="mlflow.assistant.setup.connection.continue"
        type="primary"
        onClick={handleContinue}
        disabled={continueDisabled}
      >
        Continue
      </Button>
    ) : (
      <Button
        componentId="mlflow.assistant.setup.connection.connect"
        type="primary"
        onClick={connect}
        disabled={authState === 'checking' || !apiKey.trim()}
      >
        Connect
      </Button>
    );

  return (
    <div css={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div css={{ flex: 1 }}>{content}</div>
      <div
        css={{
          display: 'flex',
          justifyContent: 'space-between',
          marginTop: theme.spacing.lg,
          paddingTop: theme.spacing.md,
          borderTop: `1px solid ${theme.colors.border}`,
        }}
      >
        <Button componentId="mlflow.assistant.setup.connection.back" onClick={onBack}>
          Back
        </Button>
        {actionButton}
      </div>
    </div>
  );
};
