import { CheckIcon, Typography, useDesignSystemTheme } from '@databricks/design-system';
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

const SelectableCard = ({
  isSelected,
  onClick,
  children,
  testId,
}: {
  isSelected: boolean;
  onClick: () => void;
  children: React.ReactNode;
  testId?: string;
}) => {
  const { theme } = useDesignSystemTheme();
  return (
    <div
      role="button"
      tabIndex={0}
      data-testid={testId}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') onClick();
      }}
      css={{
        display: 'flex',
        flexDirection: 'column',
        gap: theme.spacing.sm,
        padding: theme.spacing.sm,
        border: `1px solid ${isSelected ? theme.colors.actionDefaultBorderFocus : theme.colors.border}`,
        borderRadius: theme.borders.borderRadiusMd,
        cursor: 'pointer',
        '&:hover': {
          backgroundColor: theme.colors.actionTertiaryBackgroundHover,
        },
      }}
    >
      {children}
    </div>
  );
};

/**
 * Card list for picking the model powering issue detection: an AI Gateway
 * endpoint or a core provider + model. Never asks for API keys.
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

  const rowCss = { display: 'flex', alignItems: 'center', gap: theme.spacing.sm } as const;

  return (
    <div css={{ display: 'flex', flexDirection: 'column', gap: theme.spacing.sm }}>
      {endpoints.map((endpoint) => {
        const isSelected = value.mode === 'endpoint' && value.endpointName === endpoint.name;
        return (
          <SelectableCard
            key={endpoint.name}
            testId={`model-option-endpoint-${endpoint.name}`}
            isSelected={isSelected}
            onClick={() =>
              onChange({
                mode: 'endpoint',
                endpointName: endpoint.name,
                provider: ISSUE_DETECTION_PROVIDERS[0].id,
                model: ISSUE_DETECTION_PROVIDERS[0].defaultModel,
              })
            }
          >
            <div css={rowCss}>
              <ProviderLogo src={GATEWAY_LOGO} />
              <Typography.Text css={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {endpoint.name}
              </Typography.Text>
              <Typography.Hint>
                <FormattedMessage
                  defaultMessage="AI Gateway endpoint"
                  description="Hint marking an option as an AI Gateway endpoint"
                />
              </Typography.Hint>
              {isSelected && <CheckIcon css={{ color: theme.colors.actionDefaultBorderFocus }} />}
            </div>
          </SelectableCard>
        );
      })}
      {ISSUE_DETECTION_PROVIDERS.map((provider) => {
        const isSelected = value.mode === 'direct' && value.provider === provider.id;
        return (
          <SelectableCard
            key={provider.id}
            testId={`model-option-${provider.id}`}
            isSelected={isSelected}
            onClick={() => onChange({ mode: 'direct', provider: provider.id, model: provider.defaultModel })}
          >
            <div css={rowCss}>
              <ProviderLogo src={provider.logo} />
              <Typography.Text css={{ flex: 1 }}>{provider.name}</Typography.Text>
              {isSelected && <CheckIcon css={{ color: theme.colors.actionDefaultBorderFocus }} />}
            </div>
            {isSelected && (
              // eslint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events
              <div css={{ maxWidth: 300 }} onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
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
          </SelectableCard>
        );
      })}
    </div>
  );
};
