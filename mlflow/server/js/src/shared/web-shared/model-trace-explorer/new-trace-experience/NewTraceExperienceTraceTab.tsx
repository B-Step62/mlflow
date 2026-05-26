import { values } from 'lodash';
import { useCallback, useLayoutEffect, useMemo } from 'react';

import { useDesignSystemTheme } from '@databricks/design-system';

import type { ModelTrace, ModelTraceSpanNode } from '../ModelTrace.types';
import { useModelTraceExplorerViewState } from '../ModelTraceExplorerViewStateContext';
import { TimelineTreeNode } from '../timeline-tree/TimelineTreeNode';
import { DEFAULT_EXPAND_DEPTH, getTimelineTreeNodesMap } from '../timeline-tree/TimelineTree.utils';
import { NewTraceExperienceRightPane } from './NewTraceExperienceRightPane';

const LEFT_PANE_WIDTH = 360;

type Props = {
  modelTraceInfo: ModelTrace['info'];
  filteredTreeNodes: ModelTraceSpanNode[];
  expandedKeys: Set<string | number>;
  setExpandedKeys: React.Dispatch<React.SetStateAction<Set<string | number>>>;
};

export const NewTraceExperienceTraceTab = ({
  modelTraceInfo,
  filteredTreeNodes,
  expandedKeys,
  setExpandedKeys,
}: Props) => {
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
          width: LEFT_PANE_WIDTH,
          flexShrink: 0,
          borderRight: `1px solid ${theme.colors.borderDecorative}`,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        <div
          css={{
            flex: 1,
            overflowY: 'auto',
            overflowX: 'hidden',
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
      <NewTraceExperienceRightPane modelTraceInfo={modelTraceInfo} />
    </div>
  );
};
