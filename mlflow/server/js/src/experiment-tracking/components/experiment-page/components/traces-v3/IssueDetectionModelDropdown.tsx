import { useState } from 'react';
import {
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  Popover,
  Spinner,
  Typography,
  useDesignSystemTheme,
} from '@databricks/design-system';
import { FormattedMessage } from '@databricks/i18n';
import { useModelsQuery } from '../../../../../gateway/hooks/useModelsQuery';
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
      css={{ width: 18, height: 18, objectFit: 'contain', borderRadius: theme.borders.borderRadiusSm }}
    />
  );
};

const optionRowCss = (theme: ReturnType<typeof useDesignSystemTheme>['theme']) =>
  ({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing.sm,
    width: '100%',
    padding: `${theme.spacing.xs}px ${theme.spacing.sm}px`,
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    textAlign: 'left' as const,
    '&:hover': { backgroundColor: theme.colors.actionTertiaryBackgroundHover },
  }) as const;

const ProviderGroup = ({
  provider,
  isExpanded,
  selectedModel,
  onToggle,
  onSelectModel,
}: {
  provider: ProviderOption;
  isExpanded: boolean;
  selectedModel?: string;
  onToggle: () => void;
  onSelectModel: (model: string) => void;
}) => {
  const { theme } = useDesignSystemTheme();
  const { data: models, isLoading } = useModelsQuery({ provider: isExpanded ? provider.id : undefined });

  // Fall back to the recommended model if the gateway returns nothing
  const modelNames = models?.length ? models.map((m) => m.model) : [provider.defaultModel];

  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        css={optionRowCss(theme)}
        aria-expanded={isExpanded}
        data-testid={`model-provider-${provider.id}`}
      >
        {isExpanded ? <ChevronDownIcon /> : <ChevronRightIcon />}
        <ProviderLogo src={provider.logo} />
        <Typography.Text css={{ flex: 1 }}>{provider.name}</Typography.Text>
      </button>
      {isExpanded &&
        (isLoading ? (
          <div css={{ padding: `${theme.spacing.xs}px ${theme.spacing.sm}px`, paddingLeft: theme.spacing.lg }}>
            <Spinner size="small" />
          </div>
        ) : (
          modelNames.map((model) => (
            <button
              key={model}
              type="button"
              onClick={() => onSelectModel(model)}
              css={{ ...optionRowCss(theme), paddingLeft: 44 }}
              data-testid={`model-option-${provider.id}-${model}`}
            >
              <Typography.Text css={{ flex: 1 }}>{model}</Typography.Text>
              {selectedModel === model && <CheckIcon css={{ color: theme.colors.actionDefaultBorderFocus }} />}
            </button>
          ))
        ))}
    </div>
  );
};

/**
 * A single collapsible dropdown for choosing the model powering issue detection.
 * Rows are complete choices: an AI Gateway endpoint, or a core provider expanded
 * to its models. Never asks for API keys.
 */
export const IssueDetectionModelDropdown = ({
  endpoints,
  value,
  onChange,
}: {
  endpoints: Endpoint[];
  value: IssueDetectionModelSelection;
  onChange: (value: IssueDetectionModelSelection) => void;
}) => {
  const { theme } = useDesignSystemTheme();
  const [open, setOpen] = useState(false);
  const [expandedProvider, setExpandedProvider] = useState<string | null>(
    value.mode === 'direct' ? value.provider : null,
  );

  const isEndpoint = value.mode === 'endpoint';
  const selectedProvider = ISSUE_DETECTION_PROVIDERS.find((p) => p.id === value.provider);
  const triggerLogo = isEndpoint ? GATEWAY_LOGO : selectedProvider?.logo;
  const triggerLabel = isEndpoint ? value.endpointName : (selectedProvider?.name ?? value.provider);

  const sectionLabelCss = {
    display: 'block',
    padding: `${theme.spacing.xs}px ${theme.spacing.sm}px`,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.4,
  };

  return (
    <Popover.Root componentId="mlflow.traces.issue-detection-modal.model-dropdown" open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          data-testid="model-dropdown-trigger"
          css={{
            display: 'flex',
            alignItems: 'center',
            gap: theme.spacing.sm,
            width: '100%',
            height: '100%',
            padding: theme.spacing.sm,
            background: 'none',
            textAlign: 'left',
            border: `1px solid ${theme.colors.border}`,
            borderRadius: theme.borders.borderRadiusMd,
            cursor: 'pointer',
            '&:hover': {
              backgroundColor: theme.colors.actionTertiaryBackgroundHover,
              borderColor: theme.colors.actionDefaultBorderHover,
            },
          }}
        >
          {triggerLogo && <ProviderLogo src={triggerLogo} />}
          <div css={{ minWidth: 0, flex: 1 }}>
            <Typography.Text css={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {triggerLabel}
            </Typography.Text>
            {!isEndpoint && value.model && <Typography.Hint>{value.model}</Typography.Hint>}
          </div>
          <ChevronDownIcon css={{ color: theme.colors.textSecondary }} />
        </button>
      </Popover.Trigger>
      <Popover.Content align="start" style={{ padding: 0, minWidth: 260 }}>
        <div css={{ maxHeight: 320, overflowY: 'auto', paddingTop: theme.spacing.xs, paddingBottom: theme.spacing.xs }}>
          {endpoints.length > 0 && (
            <>
              <Typography.Hint css={sectionLabelCss}>
                <FormattedMessage
                  defaultMessage="AI Gateway"
                  description="Section label for AI Gateway endpoints in the model dropdown"
                />
              </Typography.Hint>
              {endpoints.map((endpoint) => {
                const selected = isEndpoint && value.endpointName === endpoint.name;
                return (
                  <button
                    key={endpoint.name}
                    type="button"
                    data-testid={`model-option-endpoint-${endpoint.name}`}
                    onClick={() => {
                      onChange({
                        mode: 'endpoint',
                        endpointName: endpoint.name,
                        provider: ISSUE_DETECTION_PROVIDERS[0].id,
                        model: ISSUE_DETECTION_PROVIDERS[0].defaultModel,
                      });
                      setOpen(false);
                    }}
                    css={optionRowCss(theme)}
                  >
                    <ProviderLogo src={GATEWAY_LOGO} />
                    <Typography.Text css={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {endpoint.name}
                    </Typography.Text>
                    {selected && <CheckIcon css={{ color: theme.colors.actionDefaultBorderFocus }} />}
                  </button>
                );
              })}
            </>
          )}
          <Typography.Hint css={sectionLabelCss}>
            <FormattedMessage
              defaultMessage="Providers"
              description="Section label for model providers in the model dropdown"
            />
          </Typography.Hint>
          {ISSUE_DETECTION_PROVIDERS.map((provider) => (
            <ProviderGroup
              key={provider.id}
              provider={provider}
              isExpanded={expandedProvider === provider.id}
              selectedModel={value.mode === 'direct' && value.provider === provider.id ? value.model : undefined}
              onToggle={() => setExpandedProvider((current) => (current === provider.id ? null : provider.id))}
              onSelectModel={(model) => {
                onChange({ mode: 'direct', provider: provider.id, model });
                setOpen(false);
              }}
            />
          ))}
        </div>
      </Popover.Content>
    </Popover.Root>
  );
};
