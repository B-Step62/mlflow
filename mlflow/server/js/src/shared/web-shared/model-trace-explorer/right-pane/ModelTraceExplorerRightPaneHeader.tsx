import type { ReactNode } from 'react';
import { useMemo } from 'react';

import {
  ClockIcon,
  HoverCard,
  ListIcon,
  ModelsIcon,
  SpeechBubbleIcon,
  Tag,
  TokenIcon,
  Tooltip,
  Typography,
  useDesignSystemTheme,
} from '@databricks/design-system';
import { FormattedMessage } from '@databricks/i18n';

import { formatCostUSD } from '../CostUtils';
import type { ModelTrace, ModelTraceInfoV3, ModelTraceSpanNode, SpanCostInfo } from '../ModelTrace.types';
import {
  getTraceCost,
  getTraceTokenUsage,
  getSpanExceptionCount,
  isV3ModelTraceInfo,
} from '../ModelTraceExplorer.utils';
import { useModelTraceExplorerViewState } from '../ModelTraceExplorerViewStateContext';
import { useModelTraceExplorerContext } from '../ModelTraceExplorerContext';
import { isTraceCostType, type TraceCost } from '../ModelTraceExplorerCostHoverCard';
import { isTokenUsageType, type TokenUsage } from '../ModelTraceExplorerTokenUsageHoverCard';
import { SESSION_ID_METADATA_KEY } from '../constants';
import { isUserFacingTag, truncateToFirstLineWithMaxLength } from '../TagUtils';
import { spanTimeFormatter } from '../timeline-tree/TimelineTree.utils';
import { AssessmentPaneToggle } from '../assessments-pane/AssessmentPaneToggle';

const MAX_SESSION_ID_DISPLAY_LENGTH = 16;

const getUserFacingTags = (tags: ModelTrace['info']['tags']): Array<[string, unknown]> => {
  if (Array.isArray(tags)) {
    return tags.filter(({ key }) => isUserFacingTag(key)).map(({ key, value }) => [key, value]);
  }

  return Object.entries(tags ?? {}).filter(([key]) => isUserFacingTag(key));
};

const MetadataItem = ({ children, tooltip }: { children: ReactNode; tooltip: ReactNode }) => {
  const { theme } = useDesignSystemTheme();

  return (
    <Tooltip componentId="shared.model-trace-explorer.right-pane-header-metadata-tooltip" content={tooltip}>
      <span
        css={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: theme.spacing.xs,
          minWidth: 0,
          color: theme.colors.textSecondary,
          svg: {
            color: theme.colors.textSecondary,
            fontSize: theme.typography.fontSizeLg,
          },
        }}
      >
        {children}
      </span>
    </Tooltip>
  );
};

const BreakdownRow = ({ label, value, bold = false }: { label: ReactNode; value: ReactNode; bold?: boolean }) => {
  const { theme } = useDesignSystemTheme();

  return (
    <div
      css={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: theme.spacing.lg,
      }}
    >
      <Typography.Text bold={bold}>{label}</Typography.Text>
      <Tag componentId="shared.model-trace-explorer.right-pane-header-breakdown-tag">
        <span>{value}</span>
      </Tag>
    </div>
  );
};

const TokenUsageMetadataItem = ({ tokenUsage }: { tokenUsage: TokenUsage }) => {
  const { theme } = useDesignSystemTheme();
  const cacheReadTokens = tokenUsage.cache_read_input_tokens ?? null;
  const cacheCreationTokens = tokenUsage.cache_creation_input_tokens ?? null;

  return (
    <HoverCard
      trigger={
        <span
          css={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: theme.spacing.xs,
            minWidth: 0,
            color: theme.colors.textSecondary,
            svg: {
              color: theme.colors.textSecondary,
              fontSize: theme.typography.fontSizeLg,
            },
          }}
        >
          <TokenIcon />
          <Typography.Text color="secondary" size="md">
            <FormattedMessage
              defaultMessage="{tokenCount, number} tokens"
              description="Compact token count in the trace details header"
              values={{ tokenCount: tokenUsage.total_tokens }}
            />
          </Typography.Text>
        </span>
      }
      content={
        <div css={{ display: 'flex', flexDirection: 'column', gap: theme.spacing.sm, minWidth: 240 }}>
          <Typography.Title level={3} withoutMargins>
            <FormattedMessage defaultMessage="Usage breakdown" description="Header for token usage breakdown" />
          </Typography.Title>
          <BreakdownRow
            label={<FormattedMessage defaultMessage="Input tokens" description="Label for input token usage" />}
            value={tokenUsage.input_tokens}
          />
          <BreakdownRow
            label={
              <FormattedMessage defaultMessage="Cache read" description="Label for cache read input token usage" />
            }
            value={cacheReadTokens !== null ? cacheReadTokens : 'n/a'}
          />
          <BreakdownRow
            label={
              <FormattedMessage defaultMessage="Cache write" description="Label for cache creation input token usage" />
            }
            value={cacheCreationTokens !== null ? cacheCreationTokens : 'n/a'}
          />
          <BreakdownRow
            label={<FormattedMessage defaultMessage="Output tokens" description="Label for output token usage" />}
            value={tokenUsage.output_tokens}
          />
          <div css={{ borderTop: `1px solid ${theme.colors.borderDecorative}`, paddingTop: theme.spacing.sm }}>
            <BreakdownRow
              label={<FormattedMessage defaultMessage="Total" description="Label for total token usage" />}
              value={tokenUsage.total_tokens}
              bold
            />
          </div>
        </div>
      }
      side="bottom"
      align="start"
    />
  );
};

const CostMetadataItem = ({ cost }: { cost: TraceCost | SpanCostInfo }) => {
  const { theme } = useDesignSystemTheme();
  const totalCost = formatCostUSD(cost.total_cost);

  return (
    <HoverCard
      trigger={
        <span
          css={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: theme.spacing.xs,
            minWidth: 0,
            color: theme.colors.textSecondary,
          }}
        >
          <Typography.Text color="secondary" size="md">
            {totalCost}
          </Typography.Text>
        </span>
      }
      content={
        <div css={{ display: 'flex', flexDirection: 'column', gap: theme.spacing.sm, minWidth: 220 }}>
          <Typography.Title level={3} withoutMargins>
            <FormattedMessage defaultMessage="Cost breakdown" description="Header for cost breakdown" />
          </Typography.Title>
          <BreakdownRow
            label={<FormattedMessage defaultMessage="Input cost" description="Label for input cost" />}
            value={formatCostUSD(cost.input_cost)}
          />
          <BreakdownRow
            label={<FormattedMessage defaultMessage="Output cost" description="Label for output cost" />}
            value={formatCostUSD(cost.output_cost)}
          />
          <div css={{ borderTop: `1px solid ${theme.colors.borderDecorative}`, paddingTop: theme.spacing.sm }}>
            <BreakdownRow
              label={<FormattedMessage defaultMessage="Total" description="Label for total cost" />}
              value={totalCost}
              bold
            />
          </div>
        </div>
      }
      side="bottom"
      align="start"
    />
  );
};

const TagsMetadataItem = ({ tags }: { tags: Array<[string, unknown]> }) => {
  const { theme } = useDesignSystemTheme();

  if (tags.length === 0) {
    return null;
  }

  return (
    <HoverCard
      trigger={
        <span
          css={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: theme.spacing.xs,
            minWidth: 0,
            color: theme.colors.textSecondary,
            svg: {
              color: theme.colors.textSecondary,
              fontSize: theme.typography.fontSizeLg,
            },
          }}
        >
          <ListIcon />
          <Typography.Text color="secondary" size="md">
            <FormattedMessage
              defaultMessage="{tagCount, plural, one {1 tag} other {# tags}}"
              description="Compact trace tags count in the trace details header"
              values={{ tagCount: tags.length }}
            />
          </Typography.Text>
        </span>
      }
      content={
        <div css={{ display: 'flex', flexDirection: 'column', gap: theme.spacing.xs, maxWidth: 360 }}>
          {tags.map(([key, value]) => (
            <div key={key} css={{ display: 'flex', gap: theme.spacing.xs, alignItems: 'baseline' }}>
              <Typography.Text css={{ flexShrink: 0 }}>{truncateToFirstLineWithMaxLength(key, 24)}</Typography.Text>
              <Typography.Text color="secondary" css={{ wordBreak: 'break-word' }}>
                {String(value)}
              </Typography.Text>
            </div>
          ))}
        </div>
      }
      side="bottom"
      align="start"
    />
  );
};

export const ModelTraceExplorerRightPaneHeader = ({
  activeSpan,
  modelTraceInfo,
  showAssessmentsToggle,
}: {
  activeSpan: ModelTraceSpanNode;
  modelTraceInfo: ModelTrace['info'];
  showAssessmentsToggle: boolean;
}) => {
  const { theme } = useDesignSystemTheme();
  const { rightPaneHeaderActions } = useModelTraceExplorerContext();
  const { rootNode } = useModelTraceExplorerViewState();
  const activeSpanTitle = typeof activeSpan.title === 'string' ? activeSpan.title : undefined;
  const hasException = getSpanExceptionCount(activeSpan) > 0;
  const isRootSpan = !activeSpan.parentId;
  const modelName = !isRootSpan && activeSpan.modelName ? activeSpan.modelName : undefined;

  const latency = useMemo(() => {
    const start = isRootSpan && rootNode ? rootNode.start : activeSpan.start;
    const end = isRootSpan && rootNode ? rootNode.end : activeSpan.end;

    return spanTimeFormatter(end - start);
  }, [activeSpan.end, activeSpan.start, isRootSpan, rootNode]);

  const tokenUsage = useMemo<Partial<TokenUsage> | undefined>(() => {
    if (!isRootSpan || !isV3ModelTraceInfo(modelTraceInfo)) {
      return undefined;
    }
    return getTraceTokenUsage(modelTraceInfo as ModelTraceInfoV3) as Partial<TokenUsage> | undefined;
  }, [isRootSpan, modelTraceInfo]);

  const traceCost = useMemo<Partial<TraceCost> | undefined>(() => {
    if (!isRootSpan || !isV3ModelTraceInfo(modelTraceInfo)) {
      return undefined;
    }
    return getTraceCost(modelTraceInfo as ModelTraceInfoV3) as Partial<TraceCost> | undefined;
  }, [isRootSpan, modelTraceInfo]);
  const cost = isRootSpan ? traceCost : activeSpan.cost;

  const sessionId =
    isRootSpan && isV3ModelTraceInfo(modelTraceInfo)
      ? modelTraceInfo.trace_metadata?.[SESSION_ID_METADATA_KEY]
      : undefined;
  const tags = useMemo(
    () => (isRootSpan ? getUserFacingTags(modelTraceInfo.tags) : []),
    [isRootSpan, modelTraceInfo.tags],
  );

  const hasMetadata =
    latency || modelName || isTokenUsageType(tokenUsage) || isTraceCostType(cost) || sessionId || tags.length > 0;

  return (
    <div
      css={{
        display: 'flex',
        flexDirection: 'column',
        borderTop: `2px solid ${theme.colors.border}`,
        boxSizing: 'border-box',
      }}
    >
      <div
        css={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: theme.spacing.sm,
          minWidth: 0,
          minHeight: theme.spacing.xl + 2 * theme.spacing.sm,
          padding: `${theme.spacing.xs}px ${theme.spacing.md}px`,
          boxSizing: 'border-box',
        }}
      >
        <div
          css={{
            display: 'flex',
            alignItems: 'center',
            gap: theme.spacing.xs,
            minWidth: 0,
          }}
        >
          <span
            css={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: theme.spacing.xl,
              height: theme.spacing.xl,
              flexShrink: 0,
              '& > div': {
                transform: 'scale(1.2)',
              },
            }}
          >
            {activeSpan.icon}
          </span>
          <Typography.Text
            bold
            size="lg"
            color={hasException ? 'error' : 'primary'}
            title={activeSpanTitle}
            css={{
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              minWidth: 0,
            }}
          >
            {activeSpan.title}
          </Typography.Text>
        </div>
        {(rightPaneHeaderActions || showAssessmentsToggle) && (
          <div css={{ display: 'flex', alignItems: 'center', gap: theme.spacing.xs, flexShrink: 0 }}>
            {rightPaneHeaderActions}
            {showAssessmentsToggle && (
              <AssessmentPaneToggle assessmentCount={activeSpan.assessments.length}>
                <FormattedMessage
                  defaultMessage="Annotate"
                  description="Label for the button to open the assessments pane from the trace details column"
                />
              </AssessmentPaneToggle>
            )}
          </div>
        )}
      </div>
      {hasMetadata && (
        <div
          css={{
            display: 'flex',
            alignItems: 'center',
            gap: theme.spacing.md,
            minWidth: 0,
            overflow: 'hidden',
            flexWrap: 'wrap',
            rowGap: theme.spacing.sm,
            padding: `${theme.spacing.sm}px ${theme.spacing.md}px ${theme.spacing.md}px`,
            boxSizing: 'border-box',
          }}
        >
          {latency && (
            <MetadataItem
              tooltip={
                isRootSpan ? (
                  <FormattedMessage
                    defaultMessage="Trace latency"
                    description="Tooltip for trace latency metadata item"
                  />
                ) : (
                  <FormattedMessage
                    defaultMessage="Span latency"
                    description="Tooltip for span latency metadata item"
                  />
                )
              }
            >
              <ClockIcon />
              <Typography.Text color="secondary" size="md">
                {latency}
              </Typography.Text>
            </MetadataItem>
          )}
          {modelName && (
            <MetadataItem
              tooltip={<FormattedMessage defaultMessage="Model" description="Tooltip for span model metadata item" />}
            >
              <ModelsIcon />
              <Typography.Text
                color="secondary"
                size="md"
                title={modelName}
                css={{
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  maxWidth: 240,
                }}
              >
                {modelName}
              </Typography.Text>
            </MetadataItem>
          )}
          {isTokenUsageType(tokenUsage) && <TokenUsageMetadataItem tokenUsage={tokenUsage} />}
          {isTraceCostType(cost) && <CostMetadataItem cost={cost} />}
          {sessionId && (
            <MetadataItem
              tooltip={
                <FormattedMessage
                  defaultMessage="Session ID"
                  description="Tooltip for trace session id metadata item"
                />
              }
            >
              <SpeechBubbleIcon />
              <Typography.Text color="secondary" size="md">
                {truncateToFirstLineWithMaxLength(sessionId, MAX_SESSION_ID_DISPLAY_LENGTH)}
              </Typography.Text>
            </MetadataItem>
          )}
          <TagsMetadataItem tags={tags} />
        </div>
      )}
    </div>
  );
};
