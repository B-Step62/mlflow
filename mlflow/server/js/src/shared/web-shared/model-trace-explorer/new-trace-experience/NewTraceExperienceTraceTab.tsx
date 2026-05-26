import { values } from 'lodash';
import { useCallback, useLayoutEffect, useMemo, useState } from 'react';

import { useDesignSystemTheme } from '@databricks/design-system';
import { FormattedMessage } from '@databricks/i18n';

import type { ModelTrace, ModelTraceSpanNode } from '../ModelTrace.types';
import { useModelTraceExplorerViewState } from '../ModelTraceExplorerViewStateContext';
import { useModelTraceSearch } from '../hooks/useModelTraceSearch';
import { TimelineTreeNode } from '../timeline-tree/TimelineTreeNode';
import { DEFAULT_EXPAND_DEPTH, getTimelineTreeNodesMap } from '../timeline-tree/TimelineTree.utils';
import { NewTraceExperienceTreeHeader } from './NewTraceExperienceTreeHeader';

const LEFT_PANE_WIDTH = 360;

type Props = {
  modelTraceInfo: ModelTrace['info'];
};

export const NewTraceExperienceTraceTab = ({ modelTraceInfo }: Props) => {
  const { theme } = useDesignSystemTheme();
  const { topLevelNodes, selectedNode, setSelectedNode, setActiveTab } = useModelTraceExplorerViewState();

  const [expandedKeys, setExpandedKeys] = useState<Set<string | number>>(new Set());
  const [isTreeOpen, setIsTreeOpen] = useState(true);

  const { spanFilterState, setSpanFilterState, filteredTreeNodes } = useModelTraceSearch({
    treeNodes: topLevelNodes,
    selectedNode,
    setSelectedNode,
    setActiveTab,
    setExpandedKeys,
    modelTraceInfo,
  });

  useLayoutEffect(() => {
    const list = values(getTimelineTreeNodesMap(filteredTreeNodes, DEFAULT_EXPAND_DEPTH)).map((node) => node.key);
    setExpandedKeys(new Set(list));
  }, [filteredTreeNodes]);

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
          width: isTreeOpen ? LEFT_PANE_WIDTH : 'auto',
          flexShrink: 0,
          borderRight: `1px solid ${theme.colors.borderDecorative}`,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          // Inset the selected-row background so it reads as a rounded
          // chip with breathing room from the pane edges, instead of
          // a full-bleed blue bar.
          '& [data-testid^="timeline-tree-node-"]': {
            marginLeft: theme.spacing.xs,
            marginRight: theme.spacing.xs,
            marginTop: 1,
            marginBottom: 1,
            borderRadius: theme.legacyBorders.borderRadiusMd,
            // Re-apply rounded corners on the hover background that DS sets
            // inline on the same div.
            overflow: 'hidden',
          },
        }}
      >
        <NewTraceExperienceTreeHeader
          isOpen={isTreeOpen}
          onToggle={() => setIsTreeOpen((v) => !v)}
          spanFilterState={spanFilterState}
          setSpanFilterState={setSpanFilterState}
        />
        {isTreeOpen && (
          <div
            css={{
              flex: 1,
              overflow: 'auto',
              // Reserve a gutter for the vertical scrollbar so it does not
              // visually collide with the three-dot button in the header,
              // and so the right edge of the tree rows does not jump when
              // the scrollbar appears.
              scrollbarGutter: 'stable',
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
        )}
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
