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
} from '@databricks/design-system';

import type { HierarchyBar } from './TimelineTree.types';
import { getActiveChildIndex, spanTimeFormatter, TimelineTreeZIndex } from './TimelineTree.utils';
import { TimelineTreeHierarchyBars } from './TimelineTreeHierarchyBars';
import { TimelineTreeSpanTooltip } from './TimelineTreeSpanTooltip';
import { shouldUseNewTraceExperience } from '../FeatureUtils';
import { type ModelTraceSpanNode } from '../ModelTrace.types';
import { getSpanExceptionCount, getSpanTotalTokens } from '../ModelTraceExplorer.utils';
import { useModelTraceExplorerViewState } from '../ModelTraceExplorerViewStateContext';
import { useGatewayTraceLink } from '../hooks/useGatewayTraceLink';
import { Link } from '../RoutingUtils';

// New-experience rows are taller so they can stack latency / tokens /
// cost under the span name. The hierarchy connectors stay anchored to
// the row's top/bottom edges so vertical lines remain continuous between
// rows of the new height.
const NEW_TRACE_ROW_HEIGHT = 52;

const formatSpanCost = (n?: number | null): string | null => {
  if (typeof n !== 'number' || !Number.isFinite(n)) return null;
  if (n === 0) return '$0';
  if (n < 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(3)}`;
};

const formatSpanTokens = (n?: number): string | null => {
  if (typeof n !== 'number' || !Number.isFinite(n)) return null;
  return `${n.toLocaleString('en-US')} tok`;
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
  const useNewExperience = shouldUseNewTraceExperience();

  const backgroundColor = isActive ? theme.colors.actionDefaultBackgroundHover : 'transparent';

  // Sub-line metrics shown only in the new experience; latency is always
  // available, tokens / cost depend on the span carrying usage attrs.
  const metricsParts: string[] = [];
  if (useNewExperience) {
    metricsParts.push(spanTimeFormatter(node.end - node.start));
    const tokens = formatSpanTokens(getSpanTotalTokens(node.attributes));
    if (tokens) metricsParts.push(tokens);
    const cost = formatSpanCost(node.cost?.total_cost);
    if (cost) metricsParts.push(cost);
  }
  const metricsLine = metricsParts.join(', ');

  const expandToggle = hasChildren ? (
    <Button
      size="small"
      data-testid={`toggle-span-expanded-${node.key}`}
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
  ) : null;

  return (
    <>
      <TimelineTreeSpanTooltip span={node}>
        <div
          data-testid={`timeline-tree-node-${node.key}`}
          className="timeline-tree-row"
          css={{
            display: 'flex',
            flexDirection: 'column',
            width: '100%',
            cursor: 'pointer',
            boxSizing: 'border-box',
            backgroundColor,
            ':hover': {
              backgroundColor: theme.colors.actionDefaultBackgroundHover,
            },
            ':active': {
              backgroundColor: theme.colors.actionDefaultBackgroundPress,
            },
            // Thin accent rail on the left edge of the currently
            // selected row in the new-experience tree. Uses inset
            // box-shadow so the row content doesn't shift.
            ...(useNewExperience &&
              isActive && {
                boxShadow: `inset 3px 0 0 0 ${theme.colors.actionPrimaryBackgroundDefault}`,
              }),
            // In the new experience, the expand chevron lives on the right
            // and is hidden until the row is hovered.
            ...(useNewExperience && {
              '& .timeline-tree-row-expand': {
                visibility: 'hidden',
              },
              '&:hover .timeline-tree-row-expand': {
                visibility: 'visible',
              },
            }),
          }}
          onClick={() => {
            onSelect?.(node);
          }}
        >
          <div
            css={{
              display: 'flex',
              flexDirection: 'row',
              alignItems: 'center',
              // add padding to root nodes, because they have no connecting lines
              padding: `0px ${theme.spacing.sm}px`,
              justifyContent: 'space-between',
              overflow: 'hidden',
              flex: 1,
              ...(useNewExperience && { minHeight: NEW_TRACE_ROW_HEIGHT }),
            }}
          >
            <div css={{ display: 'flex', flexDirection: 'row', alignItems: 'center', overflow: 'hidden', flex: 1 }}>
              {!useNewExperience &&
                (hasChildren ? (
                  <span css={{ flexShrink: 0, marginRight: theme.spacing.xs }}>{expandToggle}</span>
                ) : (
                  <div css={{ width: 24, marginRight: theme.spacing.xs }} />
                ))}
              <TimelineTreeHierarchyBars
                isActiveSpan={isActive}
                isInActiveChain={isInActiveChain}
                linesToRender={linesToRender}
                hasChildren={hasChildren}
                isExpanded={expanded}
                rowHeight={useNewExperience ? NEW_TRACE_ROW_HEIGHT : undefined}
              />
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
              {useNewExperience ? (
                <div
                  css={{
                    display: 'flex',
                    flexDirection: 'column',
                    overflow: 'hidden',
                    flex: 1,
                    minWidth: 0,
                    justifyContent: 'center',
                  }}
                >
                  <div css={{ display: 'flex', alignItems: 'center', gap: theme.spacing.xs, overflow: 'hidden' }}>
                    <Typography.Text
                      color={hasException ? 'error' : 'primary'}
                      css={{
                        overflow: 'hidden',
                        whiteSpace: 'nowrap',
                        textOverflow: 'ellipsis',
                        flex: 1,
                        minWidth: 0,
                      }}
                    >
                      {node.title}
                    </Typography.Text>
                  </div>
                  {metricsLine && (
                    <div
                      data-testid={`span-metrics-${node.key}`}
                      css={{
                        color: theme.colors.textSecondary,
                        fontSize: 11,
                        lineHeight: '14px',
                        fontVariantNumeric: 'tabular-nums',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {metricsLine}
                    </div>
                  )}
                </div>
              ) : (
                <Typography.Text
                  color={hasException ? 'error' : 'primary'}
                  css={{
                    overflow: 'hidden',
                    whiteSpace: 'nowrap',
                    textOverflow: 'ellipsis',
                    flex: 1,
                  }}
                >
                  {node.title}
                </Typography.Text>
              )}
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
                    borderRadius: theme.borders.borderRadiusSm,
                  }}
                  onClick={() => setAssessmentsPaneExpanded?.(true)}
                >
                  <GavelIcon />
                  <Typography.Text css={{ marginLeft: theme.spacing.xs }}>{node.assessments.length}</Typography.Text>
                </Tag>
              )}
              {useNewExperience && hasChildren && (
                <span
                  className="timeline-tree-row-expand"
                  css={{ display: 'inline-flex', flexShrink: 0, marginLeft: theme.spacing.sm }}
                >
                  {expandToggle}
                </span>
              )}
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
