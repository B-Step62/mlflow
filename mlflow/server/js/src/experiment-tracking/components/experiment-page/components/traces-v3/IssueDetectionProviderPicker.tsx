import { Radio, Typography, useDesignSystemTheme, type RadioChangeEvent } from '@databricks/design-system';
import { FormattedMessage } from '@databricks/i18n';
import { ModelSelect } from '../../../../../gateway/components/create-endpoint/ModelSelect';
import type { Endpoint } from '../../../../../gateway/types';
import OpenAiLogo from '../../../../../common/static/logos/openai.svg';
import AnthropicLogo from '../../../../../common/static/logos/anthropic.svg';
import GeminiLogo from '../../../../../common/static/logos/gemini.png';
import MLflowGatewayLogo from '../../../../../common/static/logos/mlflow-gateway.svg';

export interface IssueDetectionModelSelection {
  mode: 'endpoint' | 'direct';
  endpointName?: string;
  provider: string;
  model: string;
}

export interface ProviderOption {
  id: string;
  name: string;
  logo: string;
  defaultModel: string;
}

export const ISSUE_DETECTION_PROVIDERS: ProviderOption[] = [
  { id: 'openai', name: 'OpenAI', logo: OpenAiLogo, defaultModel: 'gpt-5.5' },
  { id: 'anthropic', name: 'Anthropic', logo: AnthropicLogo, defaultModel: 'claude-sonnet-4-6' },
  { id: 'gemini', name: 'Google Gemini', logo: GeminiLogo, defaultModel: 'gemini-2.5-pro' },
];

export const GATEWAY_LOGO = MLflowGatewayLogo;

const ENDPOINT_VALUE_PREFIX = 'endpoint:';
const PROVIDER_VALUE_PREFIX = 'direct:';

export const ProviderLogo = ({ src }: { src: string }) => {
  const { theme } = useDesignSystemTheme();
  return (
    <img
      src={src}
      alt=""
      css={{ width: 20, height: 20, objectFit: 'contain', borderRadius: theme.borders.borderRadiusSm }}
    />
  );
};

/**
 * Picks the model powering issue detection: an AI Gateway endpoint or a core
 * provider + model. Never asks for API keys - endpoints carry their own and
 * direct providers use the key already saved in AI Gateway (or the server's
 * environment).
 */
export const IssueDetectionProviderPicker = ({
  endpoints,
  value,
  onChange,
}: {
  endpoints: Endpoint[];
  value: IssueDetectionModelSelection;
  onChange: (value: IssueDetectionModelSelection) => void;
}) => {
  const { theme } = useDesignSystemTheme();

  const radioValue =
    value.mode === 'endpoint'
      ? `${ENDPOINT_VALUE_PREFIX}${value.endpointName}`
      : `${PROVIDER_VALUE_PREFIX}${value.provider}`;

  const handleRadioChange = (e: RadioChangeEvent) => {
    const selected: string = e.target.value;
    if (selected.startsWith(ENDPOINT_VALUE_PREFIX)) {
      // Keep provider/model defaults populated; the backend prefers endpoint_name when set
      onChange({
        mode: 'endpoint',
        endpointName: selected.slice(ENDPOINT_VALUE_PREFIX.length),
        provider: ISSUE_DETECTION_PROVIDERS[0].id,
        model: ISSUE_DETECTION_PROVIDERS[0].defaultModel,
      });
    } else {
      const providerId = selected.slice(PROVIDER_VALUE_PREFIX.length);
      const provider = ISSUE_DETECTION_PROVIDERS.find((p) => p.id === providerId);
      onChange({ mode: 'direct', provider: providerId, model: provider?.defaultModel ?? '' });
    }
  };

  return (
    <Radio.Group
      name="issue-detection-provider"
      componentId="mlflow.traces.issue-detection-modal.provider-picker"
      value={radioValue}
      onChange={handleRadioChange}
      css={{ width: '100%' }}
    >
      {endpoints.map((endpoint) => (
        <Radio key={endpoint.name} value={`${ENDPOINT_VALUE_PREFIX}${endpoint.name}`}>
          <span css={{ display: 'inline-flex', alignItems: 'center', gap: theme.spacing.sm }}>
            <ProviderLogo src={GATEWAY_LOGO} />
            {endpoint.name}
            <Typography.Hint>
              <FormattedMessage
                defaultMessage="AI Gateway endpoint"
                description="Hint marking an option as an AI Gateway endpoint"
              />
            </Typography.Hint>
          </span>
        </Radio>
      ))}
      {ISSUE_DETECTION_PROVIDERS.map((provider) => (
        <div key={provider.id}>
          <Radio value={`${PROVIDER_VALUE_PREFIX}${provider.id}`}>
            <span css={{ display: 'inline-flex', alignItems: 'center', gap: theme.spacing.sm }}>
              <ProviderLogo src={provider.logo} />
              {provider.name}
            </span>
          </Radio>
          {value.mode === 'direct' && value.provider === provider.id && (
            <div css={{ marginLeft: theme.spacing.lg, marginBottom: theme.spacing.sm, maxWidth: 320 }}>
              <ModelSelect
                componentId="mlflow.traces.issue-detection-modal.model"
                provider={provider.id}
                value={value.model}
                onChange={(model) => onChange({ ...value, model })}
                hideCapabilities
                label={<></>}
              />
            </div>
          )}
        </div>
      ))}
    </Radio.Group>
  );
};
