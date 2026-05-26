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
          // Left pane wrapper = visible content width + gutter for the
          // scrollbar. The visible content (tree rows) lives in the
          // LEFT_PANE_WIDTH area; the vertical scrollbar lives in the
          // SCROLLBAR_GUTTER strip to the right of that content, before the
          // divider. So the scrollbar never overlaps the visible left panel.
          width: LEFT_PANE_WIDTH + SCROLLBAR_GUTTER,
          flexShrink: 0,
          borderRight: `1px solid ${theme.colors.borderDecorative}`,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          // Inset the selected-row background so it reads as a rounded chip
          // with breathing room from the pane edges, instead of a full-bleed
          // blue bar.
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
            overflow: 'auto',
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
