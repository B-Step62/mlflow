import { values } from 'lodash';
import { useCallback, useLayoutEffect, useMemo } from 'react';

import { useDesignSystemTheme } from '@databricks/design-system';
import { FormattedMessage } from '@databricks/i18n';

import type { ModelTraceSpanNode } from '../ModelTrace.types';
import { useModelTraceExplorerViewState } from '../ModelTraceExplorerViewStateContext';
import { TimelineTreeNode } from '../timeline-tree/TimelineTreeNode';
import { DEFAULT_EXPAND_DEPTH, getTimelineTreeNodesMap } from '../timeline-tree/TimelineTree.utils';

const LEFT_PANE_WIDTH = 360;
// Reserve a strip on the right of the left pane that holds the vertical
// scrollbar, so the bar is never inside the visible content area.
const SCROLLBAR_GUTTER = 14;

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
          // Left pane wrapper. Width = visible tree column + a fixed-width
          // empty strip on the right where the scrollbar lives. The
          // scrollable area itself is constrained to LEFT_PANE_WIDTH, so the
          // scrollbar sits at x = LEFT_PANE_WIDTH with a clear gutter of
          // SCROLLBAR_GUTTER pixels between it and the divider. The
          // scrollbar therefore never sits flush against the left panel's
          // right border, and never visually overlaps the tree rows.
          width: LEFT_PANE_WIDTH + SCROLLBAR_GUTTER,
          flexShrink: 0,
          borderRight: `1px solid ${theme.colors.borderDecorative}`,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
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
            // Constrain the scrollable column so the scrollbar lives at
            // x = LEFT_PANE_WIDTH, not at the wrapper's right border.
            width: LEFT_PANE_WIDTH,
            flex: 1,
            overflow: 'auto',
            scrollbarGutter: 'stable',
            paddingTop: theme.spacing.xs,
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
