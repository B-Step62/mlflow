import {
  Button,
  Typography,
  useDesignSystemTheme,
  ChevronDownIcon,
  ChevronRightIcon,
  HashIcon,
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
import { getSpanExceptionCount } from '../ModelTraceExplorer.utils';
import { useModelTraceExplorerViewState } from '../ModelTraceExplorerViewStateContext';
import { useGatewayTraceLink } from '../hooks/useGatewayTraceLink';
import { Link } from '../RoutingUtils';

// Pull a "tokens used" number from a span's OTel attributes. Tries the
// common GenAI semconv keys and a couple of legacy variants; returns
// undefined when nothing usable is present (most non-LLM spans).
const NEW_TRACE_TOKEN_ATTR_KEYS = [
  'gen_ai.usage.total_tokens',
  'llm.token_count.total',
  'usage.total_tokens',
];

const getSpanTotalTokens = (attributes: unknown): number | undefined => {
  if (!attributes || typeof attributes !== 'object' || Array.isArray(attributes)) return undefined;
  const attrs = attributes as Record<string, unknown>;
  for (const key of NEW_TRACE_TOKEN_ATTR_KEYS) {
    const raw = attrs[key];
    if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
    if (typeof raw === 'string' && raw.trim() !== '' && !Number.isNaN(Number(raw))) return Number(raw);
  }
  // Fall back to input + output if a total isn't recorded explicitly.
  const input = attrs['gen_ai.usage.input_tokens'] ?? attrs['llm.token_count.prompt'] ?? attrs['usage.prompt_tokens'];
  const output =
    attrs['gen_ai.usage.output_tokens'] ?? attrs['llm.token_count.completion'] ?? attrs['usage.completion_tokens'];
  const inputNum = typeof input === 'number' ? input : typeof input === 'string' ? Number(input) : NaN;
  const outputNum = typeof output === 'number' ? output : typeof output === 'string' ? Number(output) : NaN;
  if (Number.isFinite(inputNum) || Number.isFinite(outputNum)) {
    return (Number.isFinite(inputNum) ? inputNum : 0) + (Number.isFinite(outputNum) ? outputNum : 0);
  }
  return undefined;
};

// Compact "1.2k" / "850" / "12.3M" formatter for the token-count chip.
const compactTokens = (n: number): string => {
  if (n < 1000) return String(n);
  if (n < 10_000) return `${(n / 1000).toFixed(1)}k`;
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
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

  // Metrics shown only in the new experience; latency is always available
  // from start/end, tokens depend on the span carrying OTel usage attrs.
  const latencyText = useNewExperience ? spanTimeFormatter(node.end - node.start) : null;
  const totalTokens = useNewExperience ? getSpanTotalTokens(node.attributes) : undefined;

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
              {useNewExperience && (
                <div
                  css={{
                    flexShrink: 0,
                    display: 'flex',
                    alignItems: 'center',
                    gap: theme.spacing.xs,
                    marginLeft: theme.spacing.sm,
                    color: theme.colors.textSecondary,
                    fontSize: theme.typography.fontSizeSm,
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {latencyText && <span data-testid={`span-latency-${node.key}`}>{latencyText}</span>}
                  {typeof totalTokens === 'number' && (
                    <span
                      data-testid={`span-tokens-${node.key}`}
                      css={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}
                    >
                      <HashIcon css={{ fontSize: 12 }} />
                      {compactTokens(totalTokens)}
                    </span>
                  )}
                  {hasChildren && (
                    <span className="timeline-tree-row-expand" css={{ display: 'inline-flex' }}>
                      {expandToggle}
                    </span>
                  )}
                </div>
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
