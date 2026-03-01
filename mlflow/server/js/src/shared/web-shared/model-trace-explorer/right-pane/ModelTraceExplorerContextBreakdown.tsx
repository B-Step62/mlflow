import { useCallback, useState, useMemo } from 'react';

import {
  ChevronDownIcon,
  ChevronRightIcon,
  Tooltip,
  Typography,
  useDesignSystemTheme,
} from '@databricks/design-system';
import { FormattedMessage } from '@databricks/i18n';

import type { ModelTraceChatMessage, ModelTraceChatTool } from '../ModelTrace.types';

// ─── Types ───────────────────────────────────────────────────────────────────

/** Identifies an element to scroll to when a sub-category label is clicked. */
type ScrollTarget =
  | { type: 'message'; messageIndex: number }
  | { type: 'tool-definition'; toolName: string };

/** A sub-item within a parent category (e.g., a specific tool name). */
interface SubCategory {
  label: string;
  tokenCount: number;
  /** Percentage of total input tokens. */
  percentage: number;
  /** Target element to scroll to when clicked. */
  scrollTarget?: ScrollTarget;
}

/** A top-level category (e.g., "Tool results", "System prompt"). */
interface TopCategory {
  key: string;
  label: string;
  tokenCount: number;
  /** Percentage of total input tokens. */
  percentage: number;
  color: string;
  /** Sub-items — always present for rendering sub-segments in the bar. */
  children: SubCategory[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getMessageCharCount(message: ModelTraceChatMessage): number {
  let count = 0;
  if (message.content) count += message.content.length;
  if (message.reasoning) count += message.reasoning.length;
  if (message.tool_calls) {
    for (const tc of message.tool_calls) {
      count += tc.function.name.length;
      count += tc.function.arguments.length;
    }
  }
  return count;
}

function buildToolCallIdToNameMap(messages: ModelTraceChatMessage[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const message of messages) {
    if (message.tool_calls) {
      for (const tc of message.tool_calls) {
        if (tc.id && tc.function.name) {
          map[tc.id] = tc.function.name;
        }
      }
    }
  }
  return map;
}

function resolveToolName(message: ModelTraceChatMessage, toolCallIdToName: Record<string, string>): string {
  if (message.name) return message.name;
  if (message.tool_call_id && toolCallIdToName[message.tool_call_id]) return toolCallIdToName[message.tool_call_id];
  return 'unknown';
}

const CHARS_PER_TOKEN_ESTIMATE = 4;

function getOutputAssistantIndex(messages: ModelTraceChatMessage[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role !== 'assistant') return -1;
    if (i === 0 || messages[i - 1].role !== 'assistant') return i;
  }
  return -1;
}

// ─── Category colors ─────────────────────────────────────────────────────────

const CATEGORY_COLORS: Record<string, string> = {
  'System prompt': '#A78BFA',
  User: '#3B82F6',
  Assistant: '#60A5FA',
  'Tool results': '#F87171',
  'Tool definitions': '#94A3B8',
};

function colorForCategory(key: string): string {
  return CATEGORY_COLORS[key] ?? '#6B7280';
}

// ─── Computation ─────────────────────────────────────────────────────────────

interface ChildEntry {
  label: string;
  chars: number;
  scrollTarget?: ScrollTarget;
}

function computeContextBreakdown(
  messages: ModelTraceChatMessage[],
  tools: ModelTraceChatTool[] | undefined,
  inputTokens: number | undefined,
): TopCategory[] {
  const toolCallIdToName = buildToolCallIdToNameMap(messages);

  // Collect child-level char counts grouped by parent key.
  // Each child is kept as a separate entry (preserving insertion/time order).
  const groups: Record<string, ChildEntry[]> = {};

  const addToGroup = (parentKey: string, childLabel: string, chars: number, scrollTarget?: ScrollTarget) => {
    if (!groups[parentKey]) groups[parentKey] = [];
    groups[parentKey].push({ label: childLabel, chars, scrollTarget });
  };

  const outputStartIndex = getOutputAssistantIndex(messages);
  let systemMsgCount = 0;
  let userMsgCount = 0;
  let assistantMsgCount = 0;
  let toolResultCount = 0;

  for (let i = 0; i < messages.length; i++) {
    if (outputStartIndex >= 0 && i >= outputStartIndex && messages[i].role === 'assistant') {
      continue;
    }

    const message = messages[i];
    const charCount = getMessageCharCount(message);
    if (charCount === 0) continue;

    const target: ScrollTarget = { type: 'message', messageIndex: i };

    if (message.role === 'system' || message.role === 'developer') {
      systemMsgCount++;
      addToGroup('System prompt', `#${systemMsgCount}`, charCount, target);
    } else if (message.role === 'user') {
      userMsgCount++;
      addToGroup('User', `#${userMsgCount}`, charCount, target);
    } else if (message.role === 'assistant') {
      assistantMsgCount++;
      addToGroup('Assistant', `Turn ${assistantMsgCount}`, charCount, target);
    } else if (message.role === 'tool' || message.role === 'function') {
      toolResultCount++;
      const toolName = resolveToolName(message, toolCallIdToName);
      addToGroup('Tool results', `${toolName} #${toolResultCount}`, charCount, target);
    }
  }

  if (tools && tools.length > 0) {
    for (const tool of tools) {
      const size = JSON.stringify(tool).length;
      if (size > 0) {
        const target: ScrollTarget = { type: 'tool-definition', toolName: tool.function.name };
        addToGroup('Tool definitions', tool.function.name, size, target);
      }
    }
  }

  // Compute totals
  const totalChars = Object.values(groups).reduce(
    (sum, entries) => sum + entries.reduce((s, e) => s + e.chars, 0),
    0,
  );
  if (totalChars === 0) return [];

  const totalTokens = inputTokens ?? Math.round(totalChars / CHARS_PER_TOKEN_ESTIMATE);

  // Build top-level categories — children are kept in insertion order (time order)
  const result: TopCategory[] = [];
  for (const [parentKey, entries] of Object.entries(groups)) {
    const parentChars = entries.reduce((s, e) => s + e.chars, 0);
    const proportion = parentChars / totalChars;

    const children: SubCategory[] = entries.map((entry) => ({
      label: entry.label,
      tokenCount: Math.round((entry.chars / totalChars) * totalTokens),
      percentage: (entry.chars / totalChars) * 100,
      scrollTarget: entry.scrollTarget,
    }));

    result.push({
      key: parentKey,
      label: parentKey,
      tokenCount: Math.round(proportion * totalTokens),
      percentage: proportion * 100,
      color: colorForCategory(parentKey),
      children,
    });
  }

  return result.sort((a, b) => b.tokenCount - a.tokenCount);
}

// ─── Formatting ──────────────────────────────────────────────────────────────

function formatTokenCount(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1000) return `${(count / 1000).toFixed(1)}k`;
  return String(count);
}

// ─── Model context windows ──────────────────────────────────────────────────

const MODEL_CONTEXT_WINDOWS: Record<string, number> = {
  'gpt-4o': 128_000,
  'gpt-4o-mini': 128_000,
  'gpt-4-turbo': 128_000,
  'gpt-4': 8_192,
  'gpt-4-32k': 32_768,
  'gpt-3.5-turbo': 16_385,
  'o1': 200_000,
  'o1-mini': 128_000,
  'o1-pro': 200_000,
  'o3': 200_000,
  'o3-mini': 200_000,
  'o4-mini': 200_000,
  'claude-opus-4-6': 200_000,
  'claude-opus-4-0': 200_000,
  'claude-sonnet-4-6': 200_000,
  'claude-sonnet-4-0': 200_000,
  'claude-3-7-sonnet-latest': 200_000,
  'claude-3-5-sonnet-latest': 200_000,
  'claude-3-5-haiku-latest': 200_000,
  'claude-3-opus-latest': 200_000,
  'claude-3-sonnet-20240229': 200_000,
  'claude-3-haiku-20240307': 200_000,
  'gemini-2.5-pro': 1_048_576,
  'gemini-2.5-flash': 1_048_576,
  'gemini-2.0-flash': 1_048_576,
  'gemini-1.5-pro': 2_097_152,
  'gemini-1.5-flash': 1_048_576,
  'llama-3.3-70b': 128_000,
  'llama-3.1-405b': 128_000,
  'llama-3.1-70b': 128_000,
  'llama-3.1-8b': 128_000,
  'mistral-large-latest': 128_000,
  'mistral-small-latest': 128_000,
  'command-r-plus': 128_000,
  'command-r': 128_000,
  'amazon.nova-pro-v1:0': 300_000,
  'amazon.nova-lite-v1:0': 300_000,
  'deepseek-chat': 64_000,
  'deepseek-reasoner': 64_000,
};

function getContextWindowForModel(modelName: string | undefined): number | undefined {
  if (!modelName) return undefined;
  const normalized = modelName.toLowerCase();
  if (MODEL_CONTEXT_WINDOWS[normalized]) return MODEL_CONTEXT_WINDOWS[normalized];
  const sortedKeys = Object.keys(MODEL_CONTEXT_WINDOWS).sort((a, b) => b.length - a.length);
  for (const key of sortedKeys) {
    if (normalized.includes(key)) return MODEL_CONTEXT_WINDOWS[key];
  }
  return undefined;
}

const MIN_USAGE_BAR_PERCENT = 3;

// ─── Scroll helpers ──────────────────────────────────────────────────────────

function scrollToTarget(target: ScrollTarget) {
  const chatTab = document.querySelector('[data-testid="model-trace-explorer-chat-tab"]');
  if (!chatTab) return;

  let element: Element | null = null;
  if (target.type === 'message') {
    element = chatTab.querySelector(`[data-message-index="${target.messageIndex}"]`);
  } else if (target.type === 'tool-definition') {
    element = chatTab.querySelector(`[data-tool-name="${CSS.escape(target.toolName)}"]`);
  }

  if (element) {
    element.scrollIntoView({ behavior: 'smooth', block: 'center' });
    // Brief highlight flash
    const el = element as HTMLElement;
    const prevOutline = el.style.outline;
    const prevTransition = el.style.transition;
    el.style.transition = 'outline-color 0.3s ease';
    el.style.outline = '2px solid #3B82F6';
    setTimeout(() => {
      el.style.outline = '2px solid transparent';
      setTimeout(() => {
        el.style.outline = prevOutline;
        el.style.transition = prevTransition;
      }, 300);
    }, 800);
  }
}

// ─── UI Components ───────────────────────────────────────────────────────────

function SummaryLine({
  totalTokens,
  isEstimated,
  contextUsagePercent,
  contextWindow,
}: {
  totalTokens: number;
  isEstimated: boolean;
  contextUsagePercent: number | undefined;
  contextWindow: number | undefined;
}) {
  const { theme } = useDesignSystemTheme();
  return (
    <div css={{ display: 'flex', alignItems: 'center', gap: theme.spacing.sm, flexWrap: 'wrap' }}>
      <Typography.Text color="secondary" css={{ fontSize: theme.typography.fontSizeSm }}>
        {isEstimated ? (
          <FormattedMessage
            defaultMessage="~{tokenCount} tokens (estimated)"
            description="Estimated total token count in context breakdown"
            values={{ tokenCount: formatTokenCount(totalTokens) }}
          />
        ) : (
          <FormattedMessage
            defaultMessage="{tokenCount} input tokens"
            description="Total input token count from usage data in context breakdown"
            values={{ tokenCount: formatTokenCount(totalTokens) }}
          />
        )}
      </Typography.Text>
      {contextUsagePercent !== undefined && (
        <Typography.Text
          color="secondary"
          css={{
            fontSize: theme.typography.fontSizeSm,
            color:
              contextUsagePercent > 90
                ? theme.colors.textValidationDanger
                : contextUsagePercent > 70
                  ? theme.colors.textValidationWarning
                  : undefined,
          }}
        >
          <FormattedMessage
            defaultMessage="({percentage}% of {contextWindow} context window)"
            description="Shows what percentage of the model's context window is being used"
            values={{
              percentage: contextUsagePercent < 1 ? '<1' : Math.round(contextUsagePercent).toString(),
              contextWindow: formatTokenCount(contextWindow!),
            }}
          />
        </Typography.Text>
      )}
    </div>
  );
}

/**
 * Top-level stacked bar — full width = context window (or 100% of usage when unknown).
 * Each category is a colored segment; categories with multiple children show
 * thin line splitters between sub-segments.
 */
function ContextBreakdownBar({
  categories,
  contextWindow,
  totalTokens,
}: {
  categories: TopCategory[];
  contextWindow: number | undefined;
  totalTokens: number;
}) {
  const { theme } = useDesignSystemTheme();

  // When context window is known, usage fills a proportional part of the bar.
  // When unknown, usage fills 100%.
  const usagePercent = contextWindow
    ? Math.max((totalTokens / contextWindow) * 100, MIN_USAGE_BAR_PERCENT)
    : 100;

  return (
    <div
      css={{
        display: 'flex',
        height: 10,
        borderRadius: 5,
        overflow: 'hidden',
        backgroundColor: theme.colors.backgroundSecondary,
        border: contextWindow ? `1px solid ${theme.colors.border}` : undefined,
      }}
    >
      <div css={{ display: 'flex', width: `${usagePercent}%`, height: '100%', transition: 'width 0.3s ease' }}>
        {categories.map((category, catIdx) => {
          const children = category.children;
          if (children.length >= 2) {
            return children.map((sub, subIdx) => {
              const subProportion = category.tokenCount > 0 ? sub.tokenCount / category.tokenCount : 0;
              const subWidth = category.percentage * subProportion;
              return (
                <Tooltip
                  key={`${category.key}-${sub.label}`}
                  componentId="shared.model-trace-explorer.context-breakdown-bar-tooltip"
                  content={`${category.label} › ${sub.label}: ~${formatTokenCount(sub.tokenCount)} tokens`}
                >
                  <div
                    css={{
                      width: `${subWidth}%`,
                      height: '100%',
                      backgroundColor: category.color,
                      minWidth: sub.tokenCount > 0 ? 1 : 0,
                      borderRight:
                        subIdx < children.length - 1
                          ? '1px solid rgba(255,255,255,0.35)'
                          : catIdx < categories.length - 1
                            ? `1px solid ${theme.colors.backgroundPrimary}`
                            : 'none',
                    }}
                  />
                </Tooltip>
              );
            });
          }
          return (
            <Tooltip
              key={category.key}
              componentId="shared.model-trace-explorer.context-breakdown-bar-tooltip"
              content={`${category.label}: ~${formatTokenCount(category.tokenCount)} tokens (${Math.round(category.percentage)}%)`}
            >
              <div
                css={{
                  width: `${category.percentage}%`,
                  height: '100%',
                  backgroundColor: category.color,
                  minWidth: category.tokenCount > 0 ? 1 : 0,
                  borderRight:
                    catIdx < categories.length - 1
                      ? `1px solid ${theme.colors.backgroundPrimary}`
                      : 'none',
                }}
              />
            </Tooltip>
          );
        })}
      </div>
    </div>
  );
}

/**
 * A single sub-category row (indented, shown when parent is expanded).
 * Bar width uses the same scale as level 1 (percentage of total tokens).
 */
function SubCategoryRow({ sub, parentColor }: { sub: SubCategory; parentColor: string }) {
  const { theme } = useDesignSystemTheme();

  const handleLabelClick = useCallback(
    (e: React.MouseEvent) => {
      if (sub.scrollTarget) {
        e.stopPropagation();
        scrollToTarget(sub.scrollTarget);
      }
    },
    [sub.scrollTarget],
  );

  return (
    <Tooltip
      componentId="shared.model-trace-explorer.context-breakdown-sub-tooltip"
      content={`~${formatTokenCount(sub.tokenCount)} tokens (${Math.round(sub.percentage)}%)`}
    >
      <div
        css={{
          display: 'flex',
          alignItems: 'center',
          gap: theme.spacing.sm,
          paddingLeft: theme.spacing.lg,
        }}
      >
        <span
          role={sub.scrollTarget ? 'button' : undefined}
          css={{
            minWidth: 100,
            flexShrink: 0,
            fontSize: theme.typography.fontSizeSm,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            color: theme.colors.textSecondary,
            ...(sub.scrollTarget
              ? {
                  cursor: 'pointer',
                  '&:hover': {
                    color: theme.colors.actionPrimaryBackgroundDefault,
                    textDecoration: 'underline',
                  },
                }
              : {}),
          }}
          onClick={handleLabelClick}
        >
          {sub.label}
        </span>
        <div
          css={{
            flex: 1,
            height: 6,
            borderRadius: 3,
            backgroundColor: theme.colors.backgroundSecondary,
            overflow: 'hidden',
          }}
        >
          <div
            css={{
              width: `${sub.percentage}%`,
              minWidth: sub.tokenCount > 0 ? 2 : 0,
              height: '100%',
              borderRadius: 3,
              backgroundColor: parentColor,
              opacity: 0.65,
              transition: 'width 0.3s ease',
            }}
          />
        </div>
        <Typography.Text
          color="secondary"
          css={{ minWidth: 36, textAlign: 'right', fontSize: theme.typography.fontSizeSm, flexShrink: 0 }}
        >
          {Math.round(sub.percentage)}%
        </Typography.Text>
      </div>
    </Tooltip>
  );
}

/**
 * Categories that always show sub-breakdown (even with a single child),
 * because the child label carries meaningful info (e.g., tool name).
 */
const ALWAYS_EXPANDABLE_CATEGORIES = new Set(['Tool results', 'Tool definitions']);

/**
 * A top-level category row with optional expand/collapse for children.
 * The bar shows sub-segments with thin line splitters when multiple children exist.
 */
function CategoryRow({ category }: { category: TopCategory }) {
  const { theme } = useDesignSystemTheme();
  const [expanded, setExpanded] = useState(false);

  // Always expandable for tool categories (tool name is useful even for single tool),
  // otherwise only expandable when there are ≥2 children
  const isExpandable =
    ALWAYS_EXPANDABLE_CATEGORIES.has(category.key)
      ? category.children.length >= 1
      : category.children.length >= 2;

  // When not expandable but has a single child with a scroll target, allow jumping to it
  const singleScrollTarget =
    !isExpandable && category.children.length === 1 ? category.children[0].scrollTarget : undefined;

  const isClickable = isExpandable || !!singleScrollTarget;

  const handleClick = () => {
    if (isExpandable) {
      setExpanded(!expanded);
    } else if (singleScrollTarget) {
      scrollToTarget(singleScrollTarget);
    }
  };

  return (
    <div css={{ display: 'flex', flexDirection: 'column' }}>
      <div
        role={isClickable ? 'button' : undefined}
        css={{
          display: 'flex',
          alignItems: 'center',
          gap: theme.spacing.sm,
          cursor: isClickable ? 'pointer' : 'default',
          borderRadius: theme.borders.borderRadiusSm,
          '&:hover': isClickable ? { backgroundColor: theme.colors.actionDefaultBackgroundHover } : {},
          padding: `2px ${theme.spacing.xs}px`,
          margin: `0 -${theme.spacing.xs}px`,
        }}
        onClick={isClickable ? handleClick : undefined}
      >
        {/* Expand/collapse icon — reserve space even when not expandable for alignment */}
        <div css={{ width: 12, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {isExpandable &&
            (expanded ? (
              <ChevronDownIcon css={{ fontSize: 12, color: theme.colors.textSecondary }} />
            ) : (
              <ChevronRightIcon css={{ fontSize: 12, color: theme.colors.textSecondary }} />
            ))}
        </div>
        <span
          css={{
            minWidth: 110,
            flexShrink: 0,
            fontSize: theme.typography.fontSizeSm,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            color: theme.colors.textSecondary,
            ...(singleScrollTarget
              ? {
                  '&:hover': {
                    color: theme.colors.actionPrimaryBackgroundDefault,
                    textDecoration: 'underline',
                  },
                }
              : {}),
          }}
        >
          {category.label}
        </span>
        {/* Bar — uses category.percentage directly so width matches actual proportion */}
        <div
          css={{
            flex: 1,
            height: 8,
            borderRadius: 4,
            backgroundColor: theme.colors.backgroundSecondary,
            overflow: 'hidden',
          }}
        >
          {category.children.length >= 2 ? (
            // Sub-segmented bar: each sub-segment has its own tooltip
            <div
              css={{
                display: 'flex',
                width: `${category.percentage}%`,
                height: '100%',
                borderRadius: 4,
                overflow: 'hidden',
              }}
            >
              {category.children.map((sub, idx) => {
                const subProportion = category.tokenCount > 0 ? sub.tokenCount / category.tokenCount : 0;
                return (
                  <Tooltip
                    key={sub.label}
                    componentId="shared.model-trace-explorer.context-breakdown-row-sub-tooltip"
                    content={`${sub.label}: ~${formatTokenCount(sub.tokenCount)} tokens (${Math.round(sub.percentage)}%)`}
                  >
                    <div
                      css={{
                        width: `${subProportion * 100}%`,
                        minWidth: sub.tokenCount > 0 ? 1 : 0,
                        height: '100%',
                        backgroundColor: category.color,
                        borderRight:
                          idx < category.children.length - 1 ? '1px solid rgba(255,255,255,0.35)' : 'none',
                      }}
                    />
                  </Tooltip>
                );
              })}
            </div>
          ) : (
            // Solid bar for single-item categories — tooltip shows the single child label
            <Tooltip
              componentId="shared.model-trace-explorer.context-breakdown-row-tooltip"
              content={
                category.children.length === 1
                  ? `${category.children[0].label}: ~${formatTokenCount(category.tokenCount)} tokens (${Math.round(category.percentage)}%)`
                  : `${category.label}: ~${formatTokenCount(category.tokenCount)} tokens (${Math.round(category.percentage)}%)`
              }
            >
              <div
                css={{
                  width: `${category.percentage}%`,
                  minWidth: category.tokenCount > 0 ? 2 : 0,
                  height: '100%',
                  borderRadius: 4,
                  backgroundColor: category.color,
                  transition: 'width 0.3s ease',
                }}
              />
            </Tooltip>
          )}
        </div>
        <Typography.Text
          color="secondary"
          css={{ minWidth: 36, textAlign: 'right', fontSize: theme.typography.fontSizeSm, flexShrink: 0 }}
        >
          {Math.round(category.percentage)}%
        </Typography.Text>
      </div>
      {/* Expanded children */}
      {expanded && isExpandable && (
        <div css={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: 2 }}>
          {category.children.map((sub) => (
            <SubCategoryRow key={sub.label} sub={sub} parentColor={category.color} />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Main component ──────────────────────────────────────────────────────────

export function ModelTraceExplorerContextBreakdown({
  chatMessages,
  chatTools,
  inputTokens,
  modelName,
  barOnly = false,
}: {
  chatMessages: ModelTraceChatMessage[];
  chatTools?: ModelTraceChatTool[];
  inputTokens?: number;
  modelName?: string;
  /** When true, render only the level 0 stacked bar (used as collapsed preview). */
  barOnly?: boolean;
}) {
  const { theme } = useDesignSystemTheme();

  const categories = useMemo(
    () => computeContextBreakdown(chatMessages, chatTools, inputTokens),
    [chatMessages, chatTools, inputTokens],
  );
  const contextWindow = useMemo(() => getContextWindowForModel(modelName), [modelName]);

  if (categories.length === 0) return null;

  const totalTokens = categories.reduce((sum, c) => sum + c.tokenCount, 0);

  const isEstimated = !inputTokens;
  const contextUsagePercent = contextWindow ? (totalTokens / contextWindow) * 100 : undefined;

  if (barOnly) {
    return (
      <div css={{ display: 'flex', flexDirection: 'column', gap: theme.spacing.xs }}>
        <SummaryLine
          totalTokens={totalTokens}
          isEstimated={isEstimated}
          contextUsagePercent={contextUsagePercent}
          contextWindow={contextWindow}
        />
        <ContextBreakdownBar categories={categories} contextWindow={contextWindow} totalTokens={totalTokens} />
      </div>
    );
  }

  return (
    <div css={{ display: 'flex', flexDirection: 'column', gap: theme.spacing.xs }}>
      <SummaryLine
        totalTokens={totalTokens}
        isEstimated={isEstimated}
        contextUsagePercent={contextUsagePercent}
        contextWindow={contextWindow}
      />

      {/* Top-level stacked bar */}
      <ContextBreakdownBar categories={categories} contextWindow={contextWindow} totalTokens={totalTokens} />

      {/* Category rows — each row has its own bar showing actual percentage */}
      <div css={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: theme.spacing.xs }}>
        {categories.map((category) => (
          <CategoryRow key={category.key} category={category} />
        ))}
      </div>
    </div>
  );
}
