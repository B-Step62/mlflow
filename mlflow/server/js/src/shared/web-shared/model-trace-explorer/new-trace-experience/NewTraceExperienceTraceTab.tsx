import { values } from 'lodash';
import { useCallback, useLayoutEffect, useMemo } from 'react';

import { useDesignSystemTheme } from '@databricks/design-system';
import { FormattedMessage } from '@databricks/i18n';

import type { ModelTraceSpanNode } from '../ModelTrace.types';
import { useModelTraceExplorerViewState } from '../ModelTraceExplorerViewStateContext';
import { TimelineTreeNode } from '../timeline-tree/TimelineTreeNode';
import { DEFAULT_EXPAND_DEPTH, getTimelineTreeNodesMap } from '../timeline-tree/TimelineTree.utils';

const LEFT_PANE_WIDTH = 360;
// The scrollbar lives in a dedicated column to the right of the row content.
// The scroll container is `LEFT_PANE_WIDTH + SCROLLBAR_WIDTH` wide; the
// scrollbar physically occupies SCROLLBAR_WIDTH pixels on the right, so the
// row content area is exactly LEFT_PANE_WIDTH pixels with no overlap.
const SCROLLBAR_WIDTH = 12;

type Props = {
  filteredTreeNodes: ModelTraceSpanNode[];
  expandedKeys: Set<string | number>;
  setExpandedKeys: React.Dispatch<React.SetStateAction<Set<string | number>>>;
};

export const NewTraceExperienceTraceTab = ({ filteredTreeNodes, expandedKeys, setExpandedKeys }: Props) => {
  const { theme } = useDesignSystemTheme();
  const { topLevelNodes, selectedNode, setSelectedNode } = useModelTraceExplorerViewState();

  useLayoutEffect(() => {
    const list = values(getTimelineTreeNodesMap(filteredTreeNodes, DEFAULT_EXPAND_DEPTH)).map((node) => node.key);
    setExpandedKeys(new Set(list));
  }, [filteredTreeNodes, setExpandedKeys]);

  const { traceStartTime, traceEndTime } = useMemo(() => {
    if (!topLevelNodes || topLevelNodes.length === 0) {
      return { traceStartTime: 0, traceEndTime: 0 };
    }
    return {
      traceStartTime: Math.min(...topLevelNodes.map((node) => node.start)),
      traceEndTime: Math.max(...topLevelNodes.map((node) => node.end)),
    };
  }, [topLevelNodes]);

  const handleSelectNode = useCallback(
    (node: ModelTraceSpanNode) => {
      setSelectedNode(node);
    },
    [setSelectedNode],
  );

  return (
    <div
      css={{
        display: 'flex',
        flex: 1,
        minHeight: 0,
        overflow: 'hidden',
      }}
    >
      <div
        css={{
          // Wrapper width = visible row column + a physical column for the
          // scrollbar. The scroll container below is `width: 100%` with
          // `overflow-y: scroll`, and forces ::-webkit-scrollbar to take a
          // fixed SCROLLBAR_WIDTH on its right. Rows live in the content
          // box (LEFT_PANE_WIDTH wide); the scrollbar lives in its own
          // SCROLLBAR_WIDTH column to the right of the rows. They never
          // share a column, so the left panel and the scrollbar do not
          // overlap.
          width: LEFT_PANE_WIDTH + SCROLLBAR_WIDTH,
          flexShrink: 0,
          borderRight: `1px solid ${theme.colors.borderDecorative}`,
          boxSizing: 'content-box',
          display: 'flex',
          flexDirection: 'column',
          '& [data-testid^="timeline-tree-node-"]': {
            marginLeft: theme.spacing.xs,
            marginRight: theme.spacing.xs,
            marginTop: 1,
            marginBottom: 1,
            borderRadius: theme.legacyBorders.borderRadiusMd,
            overflow: 'hidden',
          },
        }}
      >
        <div
          css={{
            flex: 1,
            // overflow-y: auto so the scrollbar column only exists when
            // there is actually content to scroll. When the scrollbar is
            // present, the custom ::-webkit-scrollbar rules below force it
            // to take a fixed physical column instead of overlaying.
            overflowY: 'auto',
            overflowX: 'hidden',
            paddingTop: theme.spacing.xs,
            // Pin the webkit scrollbar to exactly SCROLLBAR_WIDTH so the
            // column math above always lines up regardless of the OS
            // "Show scroll bars" preference.
            '&::-webkit-scrollbar': {
              width: SCROLLBAR_WIDTH,
            },
            '&::-webkit-scrollbar-track': {
              backgroundColor: 'transparent',
            },
            '&::-webkit-scrollbar-thumb': {
              backgroundColor: theme.colors.actionDefaultBorderDefault,
              borderRadius: SCROLLBAR_WIDTH / 2,
              border: `3px solid transparent`,
              backgroundClip: 'padding-box',
            },
            '&::-webkit-scrollbar-thumb:hover': {
              backgroundColor: theme.colors.actionDefaultBorderHover,
            },
          }}
        >
          {filteredTreeNodes.map((node) => (
            <TimelineTreeNode
              key={node.key}
              node={node}
              expandedKeys={expandedKeys}
              setExpandedKeys={setExpandedKeys}
              selectedKey={selectedNode?.key ?? ''}
              traceStartTime={traceStartTime}
              traceEndTime={traceEndTime}
              onSelect={handleSelectNode}
              linesToRender={[]}
            />
          ))}
        </div>
      </div>
      <div
        css={{
          flex: 1,
          minWidth: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: theme.colors.textSecondary,
          padding: theme.spacing.lg,
        }}
      >
        <FormattedMessage
          defaultMessage="Right pane (Feedback / Expectations / Metrics / Inputs+Outputs / Attributes / Events) coming in the next step."
          description="Placeholder shown in the new trace experience Trace tab right pane while the stacked sections are being wired"
        />
      </div>
    </div>
  );
};
