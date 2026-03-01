import { useMemo } from 'react';

import { HoverCard, Tag, TokenIcon, Typography, useDesignSystemTheme } from '@databricks/design-system';
import { FormattedMessage } from '@databricks/i18n';

import type { ChatTokenUsage, ModelTraceSpanNode, SpanCostInfo } from '../ModelTrace.types';
import { formatCostUSD } from '../CostUtils';

const SpanCostHoverCard = ({ cost }: { cost: SpanCostInfo }) => {
  const { theme } = useDesignSystemTheme();

  const totalCost = useMemo(() => formatCostUSD(cost.total_cost), [cost.total_cost]);
  const inputCost = useMemo(() => formatCostUSD(cost.input_cost), [cost.input_cost]);
  const outputCost = useMemo(() => formatCostUSD(cost.output_cost), [cost.output_cost]);

  return (
    <HoverCard
      trigger={
        <div
          css={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexDirection: 'row',
            gap: theme.spacing.sm,
          }}
        >
          <Typography.Text size="md" color="secondary">
            <FormattedMessage defaultMessage="Cost" description="Label for cost in span details" />
          </Typography.Text>
          <Tag componentId="shared.model-trace-explorer.span-cost-badge" color="lime">
            <span>{totalCost}</span>
          </Tag>
        </div>
      }
      content={
        <div
          css={{
            display: 'flex',
            flexDirection: 'column',
            gap: theme.spacing.md,
            padding: theme.spacing.sm,
            maxWidth: 400,
          }}
        >
          <Typography.Title level={3} withoutMargins>
            <FormattedMessage defaultMessage="Cost breakdown" description="Header for span cost breakdown" />
          </Typography.Title>
          <div
            css={{
              display: 'flex',
              flexDirection: 'column',
              gap: theme.spacing.sm,
            }}
          >
            <div
              css={{
                display: 'flex',
                flexDirection: 'row',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <Typography.Text size="md">
                <FormattedMessage defaultMessage="Input cost" description="Label for input cost" />
              </Typography.Text>
              <Tag componentId="shared.model-trace-explorer.span-cost-hovercard.input-cost.tag">
                <span>{inputCost}</span>
              </Tag>
            </div>
            <div
              css={{
                display: 'flex',
                flexDirection: 'row',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <Typography.Text size="md">
                <FormattedMessage defaultMessage="Output cost" description="Label for output cost" />
              </Typography.Text>
              <Tag componentId="shared.model-trace-explorer.span-cost-hovercard.output-cost.tag">
                <span>{outputCost}</span>
              </Tag>
            </div>
            <div
              css={{
                display: 'flex',
                flexDirection: 'row',
                justifyContent: 'space-between',
                alignItems: 'center',
                paddingTop: theme.spacing.sm,
                borderTop: `1px solid ${theme.colors.borderDecorative}`,
              }}
            >
              <Typography.Text size="md" bold>
                <FormattedMessage defaultMessage="Total" description="Label for total cost" />
              </Typography.Text>
              <Tag componentId="shared.model-trace-explorer.span-cost-hovercard.total-cost.tag">
                <span>{totalCost}</span>
              </Tag>
            </div>
          </div>
        </div>
      }
      side="bottom"
      align="start"
    />
  );
};

const SpanTokenUsageHoverCard = ({ tokenUsage }: { tokenUsage: ChatTokenUsage }) => {
  const { theme } = useDesignSystemTheme();
  const total = tokenUsage.total_tokens ?? 0;
  const input = tokenUsage.input_tokens ?? 0;
  const output = tokenUsage.output_tokens ?? 0;

  return (
    <HoverCard
      trigger={
        <div
          css={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexDirection: 'row',
            gap: theme.spacing.sm,
          }}
        >
          <Typography.Text size="md" color="secondary">
            <FormattedMessage defaultMessage="Tokens" description="Label for token count in span details" />
          </Typography.Text>
          <Tag componentId="shared.model-trace-explorer.span-token-badge">
            <span css={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: theme.spacing.xs }}>
              <TokenIcon />
              <span>{total.toLocaleString()}</span>
            </span>
          </Tag>
        </div>
      }
      content={
        <div
          css={{
            display: 'flex',
            flexDirection: 'column',
            gap: theme.spacing.md,
            padding: theme.spacing.sm,
            maxWidth: 400,
          }}
        >
          <Typography.Title level={3} withoutMargins>
            <FormattedMessage defaultMessage="Usage breakdown" description="Header for span token usage breakdown" />
          </Typography.Title>
          <div css={{ display: 'flex', flexDirection: 'column', gap: theme.spacing.sm }}>
            <div
              css={{
                display: 'flex',
                flexDirection: 'row',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <Typography.Text size="md">
                <FormattedMessage defaultMessage="Input tokens" description="Label for input token usage in span" />
              </Typography.Text>
              <Tag componentId="shared.model-trace-explorer.span-token-hovercard.input.tag">
                <span>{input.toLocaleString()}</span>
              </Tag>
            </div>
            <div
              css={{
                display: 'flex',
                flexDirection: 'row',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <Typography.Text size="md">
                <FormattedMessage defaultMessage="Output tokens" description="Label for output token usage in span" />
              </Typography.Text>
              <Tag componentId="shared.model-trace-explorer.span-token-hovercard.output.tag">
                <span>{output.toLocaleString()}</span>
              </Tag>
            </div>
            <div
              css={{
                display: 'flex',
                flexDirection: 'row',
                justifyContent: 'space-between',
                alignItems: 'center',
                paddingTop: theme.spacing.sm,
                borderTop: `1px solid ${theme.colors.borderDecorative}`,
              }}
            >
              <Typography.Text size="md" bold>
                <FormattedMessage defaultMessage="Total" description="Label for total token usage in span" />
              </Typography.Text>
              <Tag componentId="shared.model-trace-explorer.span-token-hovercard.total.tag">
                <span>{total.toLocaleString()}</span>
              </Tag>
            </div>
          </div>
        </div>
      }
      side="bottom"
      align="start"
    />
  );
};

export const SpanModelCostBadge = ({ activeSpan }: { activeSpan: ModelTraceSpanNode }) => {
  const { theme } = useDesignSystemTheme();

  const { modelName, cost, chatTokenUsage } = activeSpan;

  if (!modelName && !cost && !chatTokenUsage) {
    return null;
  }

  return (
    <div
      css={{
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.spacing.md,
        paddingLeft: theme.spacing.md,
        paddingBottom: theme.spacing.sm,
        flexWrap: 'wrap',
      }}
    >
      {modelName && (
        <div css={{ display: 'flex', alignItems: 'center', gap: theme.spacing.xs }}>
          <Typography.Text size="md" color="secondary">
            <FormattedMessage defaultMessage="Model" description="Label for model name in span details" />
          </Typography.Text>
          <Tag componentId="shared.model-trace-explorer.span-model-badge" color="turquoise">
            {modelName}
          </Tag>
        </div>
      )}
      {chatTokenUsage && chatTokenUsage.total_tokens != null && (
        <SpanTokenUsageHoverCard tokenUsage={chatTokenUsage} />
      )}
      {cost && <SpanCostHoverCard cost={cost} />}
    </div>
  );
};
