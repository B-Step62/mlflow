import {
  Button,
  Typography,
  useDesignSystemTheme,
  ChevronDownIcon,
  ChevronRightIcon,
  Tag,
  GavelIcon,
  LinkIcon,
  Tooltip,
  TokenIcon,
} from '@databricks/design-system';

import type { HierarchyBar } from './TimelineTree.types';
import { getActiveChildIndex, spanTimeFormatter, SPAN_ROW_HEIGHT, TimelineTreeZIndex } from './TimelineTree.utils';
import { TimelineTreeHierarchyBars } from './TimelineTreeHierarchyBars';
import { TimelineTreeSpanTooltip } from './TimelineTreeSpanTooltip';
import { type ModelTraceSpanNode } from '../ModelTrace.types';
import { getSpanExceptionCount } from '../ModelTraceExplorer.utils';
import { useModelTraceExplorerViewState } from '../ModelTraceExplorerViewStateContext';
import { useGatewayTraceLink } from '../hooks/useGatewayTraceLink';
import { Link } from '../RoutingUtils';
import { formatCostUSD } from '../CostUtils';

const formatCompactNumber = (value: number) =>
  new Intl.NumberFormat('en-US', {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value);

const formatCompactCostUSD = (cost: number): string => {
  const truncatedCost = Math.trunc(cost * 10000) / 10000;

  if (cost > 0 && truncatedCost === 0) {
    return '<$0.0001';
  }

  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  }).format(truncatedCost);
};

const ROW_HEIGHT = SPAN_ROW_HEIGHT + 4;
const ROW_HEIGHT_WITH_METADATA = 56;
const METADATA_TEXT_COLOR = '#718493';

const getNestedTotalTokens = (value: unknown, depth = 0, seen = new WeakSet()): number | undefined => {
  if (!value || typeof value !== 'object' || depth > 6) {
    return undefined;
  }

  if (seen.has(value)) {
    return undefined;
  }
  seen.add(value);

  if ('total_tokens' in value && typeof value.total_tokens === 'number') {
    return value.total_tokens;
  }
  if ('total_token_count' in value && typeof value.total_token_count === 'number') {
    return value.total_token_count;
  }

  for (const childValue of Object.values(value)) {
    const totalTokens = getNestedTotalTokens(childValue, depth + 1, seen);
    if (totalTokens !== undefined) {
      return totalTokens;
    }
  }

  return undefined;
};

const MetadataItem = ({
  children,
  icon,
  title,
}: {
  children: React.ReactNode;
  icon?: React.ReactNode;
  title: string;
}) => {
  const { theme } = useDesignSystemTheme();

  return (
    <span
      title={title}
      css={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 2,
        minWidth: 0,
        maxWidth: 160,
        color: METADATA_TEXT_COLOR,
        overflow: 'hidden',
        fontSize: theme.typography.fontSizeSm,
        lineHeight: theme.typography.lineHeightSm,
        fontVariantNumeric: 'tabular-nums',
      }}
    >
      {icon && (
        <span
          css={{
            display: 'inline-flex',
            alignItems: 'center',
            flexShrink: 0,
            color: 'inherit',
            '& svg': {
              fontSize: 12,
            },
          }}
        >
          {icon}
        </span>
      )}
      <span
        css={{
          minWidth: 0,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {children}
      </span>
    </span>
  );
};

export const TimelineTreeNode = ({
  node,
  selectedKey,
  expandedKeys,
  setExpandedKeys,
  traceStartTime,
  traceEndTime,
  onSelect,
  linesToRender,
}: {
  node: ModelTraceSpanNode;
  selectedKey: string | number;
  expandedKeys: Set<string | number>;
  setExpandedKeys: (keys: Set<string | number>) => void;
  traceStartTime: number;
  traceEndTime: number;
  onSelect: ((node: ModelTraceSpanNode) => void) | undefined;
  // a boolean array that signifies whether or not a vertical
  // connecting line is supposed to in at the `i`th spacer. see
  // TimelineTreeHierarchyBars for more details.
  linesToRender: Array<HierarchyBar>;
}) => {
  const expanded = expandedKeys.has(node.key);
  const { theme } = useDesignSystemTheme();
  const hasChildren = (node.children ?? []).length > 0;
  const { setAssessmentsPaneExpanded } = useModelTraceExplorerViewState();

  const isActive = selectedKey === node.key;
  const activeChildIndex = getActiveChildIndex(node, String(selectedKey));
  // true if a span has active children OR is the active span
  const isInActiveChain = activeChildIndex > -1;

  const hasException = getSpanExceptionCount(node) > 0;
  const gatewayTraceHref = useGatewayTraceLink(node.linkedGatewayTraceId);
  const latency = spanTimeFormatter(node.end - node.start);
  const totalTokens =
    getNestedTotalTokens(node.outputs) ?? getNestedTotalTokens(node.inputs) ?? getNestedTotalTokens(node.attributes);
  const hasTokenMetadata = totalTokens !== undefined;
  const showInlineLatency = !hasTokenMetadata;
  const hasMetadata = Boolean(node.cost || hasTokenMetadata);
  const rowHeight = hasMetadata ? ROW_HEIGHT_WITH_METADATA : ROW_HEIGHT;
  const rowTopPadding = 4;

  const backgroundColor = isActive ? theme.colors.actionDefaultBackgroundHover : 'transparent';

  return (
    <>
      <TimelineTreeSpanTooltip span={node}>
        <div
          data-testid={`timeline-tree-node-${node.key}`}
          css={{
            display: 'flex',
            flexDirection: 'column',
            width: '100%',
            height: rowHeight,
            cursor: 'pointer',
            boxSizing: 'border-box',
            backgroundColor,
            ':hover': {
              backgroundColor: theme.colors.actionDefaultBackgroundHover,
            },
            ':active': {
              backgroundColor: theme.colors.actionDefaultBackgroundPress,
            },
            position: 'relative',
            ...(isActive
              ? {
                  '&::before': {
                    content: '""',
                    position: 'absolute',
                    top: 0,
                    bottom: 0,
                    left: 0,
                    width: 2,
                    backgroundColor: theme.colors.actionPrimaryBackgroundDefault,
                    zIndex: TimelineTreeZIndex.HIGH,
                  },
                }
              : {}),
          }}
          onClick={() => {
            onSelect?.(node);
          }}
        >
          <div
            css={{
              display: 'flex',
              flexDirection: 'row',
              alignItems: 'stretch',
              // add padding to root nodes, because they have no connecting lines
              padding: `0px ${theme.spacing.sm}px`,
              justifyContent: 'space-between',
              overflow: 'hidden',
              flex: 1,
              height: rowHeight,
            }}
          >
            <div
              css={{
                display: 'flex',
                flexDirection: 'row',
                alignItems: 'stretch',
                overflow: 'hidden',
                flex: 1,
              }}
            >
              {hasChildren ? (
                <Button
                  size="small"
                  data-testid={`toggle-span-expanded-${node.key}`}
                  css={{ flexShrink: 0, marginRight: theme.spacing.xs, marginTop: rowTopPadding }}
                  icon={expanded ? <ChevronDownIcon /> : <ChevronRightIcon />}
                  onClick={(event) => {
                    // prevent the node from being selected when the expand button is clicked
                    event.stopPropagation();
                    const newExpandedKeys = new Set(expandedKeys);
                    if (expanded) {
                      newExpandedKeys.delete(node.key);
                    } else {
                      newExpandedKeys.add(node.key);
                    }
                    setExpandedKeys(newExpandedKeys);
                  }}
                  componentId="shared.model-trace-explorer.toggle-span"
                />
              ) : (
                <div css={{ width: 24, marginRight: theme.spacing.xs, marginTop: rowTopPadding, flexShrink: 0 }} />
              )}
              <TimelineTreeHierarchyBars
                isActiveSpan={isActive}
                isInActiveChain={isInActiveChain}
                linesToRender={linesToRender}
                hasChildren={hasChildren}
                isExpanded={expanded}
                rowHeight={rowHeight}
              />
              <div
                css={{
                  display: 'flex',
                  flexDirection: 'column',
                  flex: 1,
                  minWidth: 0,
                  height: rowHeight,
                  boxSizing: 'border-box',
                  justifyContent: 'flex-start',
                  paddingTop: theme.spacing.xs,
                  paddingBottom: theme.spacing.xs,
                }}
              >
                <div
                  css={{
                    display: 'flex',
                    alignItems: 'center',
                    minWidth: 0,
                    minHeight: 24,
                  }}
                >
                  <span
                    css={{
                      flexShrink: 0,
                      marginRight: theme.spacing.xs,
                      borderRadius: theme.borders.borderRadiusSm,
                      border: `1px solid ${
                        activeChildIndex > -1 ? theme.colors.blue500 : theme.colors.backgroundSecondary
                      }`,
                      zIndex: TimelineTreeZIndex.NORMAL,
                    }}
                  >
                    {node.icon}
                  </span>
                  <div
                    css={{
                      display: 'flex',
                      alignItems: 'center',
                      flex: 1,
                      minWidth: 0,
                    }}
                  >
                    <Typography.Text
                      color={hasException ? 'error' : 'primary'}
                      css={{
                        overflow: 'hidden',
                        whiteSpace: 'nowrap',
                        textOverflow: 'ellipsis',
                        flex: '0 1 auto',
                        minWidth: 0,
                      }}
                    >
                      {node.title}
                    </Typography.Text>
                    {showInlineLatency && (
                      <span css={{ flexShrink: 0, marginLeft: theme.spacing.xs }}>
                        <MetadataItem title={`Latency: ${latency}`}>{latency}</MetadataItem>
                      </span>
                    )}
                  </div>
                  {gatewayTraceHref && (
                    <Tooltip
                      content="View linked gateway trace"
                      componentId="shared.model-trace-explorer.gateway-trace-link"
                    >
                      <Link
                        componentId="mlflow.model_trace_explorer.timeline.gateway_trace_link"
                        to={gatewayTraceHref}
                        target="_blank"
                        rel="noreferrer"
                        data-testid={`gateway-trace-link-${node.key}`}
                        onClick={(e: React.MouseEvent) => e.stopPropagation()}
                        css={{
                          flexShrink: 0,
                          display: 'flex',
                          alignItems: 'center',
                          marginLeft: theme.spacing.xs,
                          color: theme.colors.actionPrimaryBackgroundDefault,
                        }}
                      >
                        <LinkIcon css={{ fontSize: 14 }} />
                      </Link>
                    </Tooltip>
                  )}
                  {node.assessments.length > 0 && (
                    <Tag
                      color="indigo"
                      data-testid={`assessment-tag-${node.key}`}
                      componentId="shared.model-trace-explorer.assessment-count"
                      css={{
                        margin: 0,
                        marginLeft: theme.spacing.xs,
                        borderRadius: theme.borders.borderRadiusSm,
                      }}
                      onClick={() => setAssessmentsPaneExpanded?.(true)}
                    >
                      <GavelIcon />
                      <Typography.Text css={{ marginLeft: theme.spacing.xs }}>
                        {node.assessments.length}
                      </Typography.Text>
                    </Tag>
                  )}
                </div>
                {hasMetadata && (
                  <div
                    css={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: theme.spacing.xs,
                      flexWrap: 'nowrap',
                      minWidth: 0,
                      marginTop: 1,
                      paddingLeft: theme.spacing.xl + theme.spacing.xs,
                      overflow: 'hidden',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {hasTokenMetadata && (
                      <>
                        <MetadataItem title={`Latency: ${latency}`}>{latency}</MetadataItem>
                        <MetadataItem title={`${totalTokens} tokens`} icon={<TokenIcon />}>
                          {formatCompactNumber(totalTokens)}
                        </MetadataItem>
                      </>
                    )}
                    {node.cost && (
                      <MetadataItem title={`Cost: ${formatCostUSD(node.cost.total_cost)}`}>
                        {formatCompactCostUSD(node.cost.total_cost)}
                      </MetadataItem>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </TimelineTreeSpanTooltip>
      {expanded &&
        node.children?.map((child, idx) => (
          <TimelineTreeNode
            key={child.key}
            node={child}
            expandedKeys={expandedKeys}
            setExpandedKeys={setExpandedKeys}
            selectedKey={selectedKey}
            traceStartTime={traceStartTime}
            traceEndTime={traceEndTime}
            onSelect={onSelect}
            linesToRender={linesToRender.concat({
              // render the connecting line at this depth
              // if there are more children to render
              shouldRender: idx < (node.children?.length ?? 0) - 1,
              // make the vertical line blue if the active span
              // is below this child
              isActive: idx < activeChildIndex,
            })}
          />
        ))}
    </>
  );
};
