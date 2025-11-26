import { useLayoutEffect, useRef } from 'react';

import { useDesignSystemTheme, Typography, Button, ChevronDownIcon, ChevronRightIcon } from '@databricks/design-system';
import { FormattedMessage } from '@databricks/i18n';

import type { ModelTraceSpanNode } from '../../ModelTrace.types';
import { spanTimeFormatter, TimelineTreeZIndex } from '../TimelineTree.utils';
import { TimelineTreeSpanTooltip } from '../TimelineTreeSpanTooltip';

export const TimelineTreeGanttNode = ({
  node,
  selectedKey,
  leftOffset,
  width,
  onSelect,
  expandedKeys,
  setExpandedKeys,
}: {
  node: ModelTraceSpanNode;
  selectedKey: string | number;
  leftOffset: number;
  width: number;
  onSelect: ((node: ModelTraceSpanNode) => void) | undefined;
  expandedKeys: Set<string | number>;
  setExpandedKeys: (keys: Set<string | number>) => void;
}) => {
  const { theme } = useDesignSystemTheme();
  const titleInBarRef = useRef<HTMLSpanElement>(null);
  const titleBesideBarRef = useRef<HTMLSpanElement>(null);
  const isActive = selectedKey === node.key;
  const backgroundColor = isActive ? theme.colors.actionDefaultBackgroundHover : 'transparent';
  const hasChildren = (node.children ?? []).length > 0;
  const expanded = expandedKeys.has(node.key);
  const totalFiltered = node.isFiltered ? 1 + (node.filteredDescendantCount ?? 0) : 0;

  useLayoutEffect(() => {
    if (!titleInBarRef.current || !titleBesideBarRef.current) {
      return;
    }

    const spanWidth = Math.max(titleInBarRef.current.offsetWidth, titleBesideBarRef.current.offsetWidth);

    if (spanWidth < width - theme.spacing.sm) {
      titleInBarRef.current.style.display = 'inline';
      titleBesideBarRef.current.style.display = 'none';
    } else {
      titleInBarRef.current.style.display = 'none';
      titleBesideBarRef.current.style.display = 'inline';
    }
  }, [theme.spacing.sm, width]);

  // Render a collapsed/filtered span indicator if this span is filtered
  if (node.isFiltered) {
    return (
      <div
        key={node.key}
        data-testid={`collapsed-gantt-span-${node.key}`}
        css={{
          display: 'flex',
          flexDirection: 'row',
          cursor: 'default',
          boxSizing: 'border-box',
          paddingLeft: theme.spacing.xs,
          paddingRight: theme.spacing.sm,
          paddingTop: theme.spacing.xs,
          paddingBottom: theme.spacing.xs,
          backgroundColor: 'transparent',
          alignItems: 'center',
          opacity: 0.5,
          zIndex: TimelineTreeZIndex.NORMAL,
        }}
      >
        <div css={{ width: 24, marginRight: theme.spacing.xs }} />
        <div css={{ width: leftOffset, flexShrink: 0 }} />
        <div
          css={{
            position: 'relative',
            width,
            height: theme.typography.lineHeightBase,
            backgroundColor: theme.colors.backgroundSecondary,
            borderRadius: theme.borders.borderRadiusSm,
            border: `1px dashed ${theme.colors.borderDecorative}`,
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Typography.Text
            css={{
              fontFamily: 'monospace',
              color: theme.colors.textSecondary,
              fontSize: theme.typography.fontSizeSm,
            }}
          >
            {'< >'}
          </Typography.Text>
        </div>
        <div css={{ flex: 1, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
          <Typography.Text
            color="secondary"
            css={{
              marginLeft: theme.spacing.xs,
              fontSize: theme.typography.fontSizeSm,
              fontStyle: 'italic',
            }}
          >
            <FormattedMessage
              defaultMessage="{count, plural, one {# filtered span} other {# filtered spans}}"
              description="Label showing the count of filtered spans in gantt view"
              values={{ count: totalFiltered }}
            />
          </Typography.Text>
        </div>
      </div>
    );
  }

  return (
    <TimelineTreeSpanTooltip span={node}>
      <div
        key={node.key}
        css={{
          display: 'flex',
          flexDirection: 'row',
          cursor: 'pointer',
          boxSizing: 'border-box',
          paddingLeft: theme.spacing.xs,
          paddingRight: theme.spacing.sm,
          paddingTop: theme.spacing.xs,
          paddingBottom: theme.spacing.xs,
          backgroundColor: backgroundColor,
          alignItems: 'center',
          ':hover': {
            backgroundColor: theme.colors.actionDefaultBackgroundHover,
          },
          ':active': {
            backgroundColor: theme.colors.actionDefaultBackgroundPress,
          },
          zIndex: TimelineTreeZIndex.NORMAL,
        }}
        onClick={() => onSelect?.(node)}
      >
        {hasChildren ? (
          <Button
            size="small"
            data-testid={`toggle-timeline-span-expanded-${node.key}`}
            css={{ flexShrink: 0, marginRight: theme.spacing.xs }}
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
            componentId="shared.model-trace-explorer.toggle-timeline-span"
          />
        ) : (
          <div css={{ width: 24, marginRight: theme.spacing.xs }} />
        )}
        <div css={{ width: leftOffset, flexShrink: 0 }} />
        <div
          css={{
            position: 'relative',
            width,
            height: theme.typography.lineHeightBase,
            backgroundColor: theme.colors.blue600,
            borderRadius: theme.borders.borderRadiusSm,
            flexShrink: 0,
          }}
        >
          <Typography.Text>
            <span
              ref={titleInBarRef}
              css={{
                marginLeft: theme.spacing.xs,
                color: theme.colors.white,
                display: 'none',
              }}
            >
              {node.title}
            </span>
          </Typography.Text>
        </div>
        <div css={{ flex: 1, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
          <Typography.Text>
            <span
              ref={titleBesideBarRef}
              css={{
                marginLeft: theme.spacing.xs,
                color: theme.colors.textPrimary,
              }}
            >
              {node.title}
            </span>
          </Typography.Text>
          <Typography.Text css={{ marginLeft: theme.spacing.xs }} color="secondary">
            {spanTimeFormatter(node.end - node.start)}
          </Typography.Text>
        </div>
      </div>
    </TimelineTreeSpanTooltip>
  );
};
