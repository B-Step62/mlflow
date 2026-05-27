import { useCallback, useMemo } from 'react';

import { useDesignSystemTheme } from '@databricks/design-system';

import type { ModelTraceSpanNode } from '../ModelTrace.types';
import { useModelTraceExplorerViewState } from '../ModelTraceExplorerViewStateContext';
import { TimelineTreeGanttBars } from '../timeline-tree/gantt/TimelineTreeGanttBars';
import { getTimelineTreeExpandedNodesList } from '../timeline-tree/TimelineTree.utils';

type Props = {
  filteredTreeNodes: ModelTraceSpanNode[];
  expandedKeys: Set<string | number>;
  setExpandedKeys: React.Dispatch<React.SetStateAction<Set<string | number>>>;
};

export const NewTraceExperienceTimelineTab = ({ filteredTreeNodes, expandedKeys, setExpandedKeys }: Props) => {
  const { theme } = useDesignSystemTheme();
  const { topLevelNodes, selectedNode, setSelectedNode } = useModelTraceExplorerViewState();

  const { traceStartTime, traceEndTime } = useMemo(() => {
    if (!topLevelNodes || topLevelNodes.length === 0) {
      return { traceStartTime: 0, traceEndTime: 0 };
    }
    return {
      traceStartTime: Math.min(...topLevelNodes.map((node) => node.start)),
      traceEndTime: Math.max(...topLevelNodes.map((node) => node.end)),
    };
  }, [topLevelNodes]);

  const expandedNodesList = useMemo(
    () => getTimelineTreeExpandedNodesList(filteredTreeNodes, expandedKeys),
    [filteredTreeNodes, expandedKeys],
  );

  const handleSelectNode = useCallback(
    (node: ModelTraceSpanNode) => {
      setSelectedNode(node);
    },
    [setSelectedNode],
  );

  const setExpandedKeysFromGantt = useCallback(
    (keys: Set<string | number>) => {
      setExpandedKeys(new Set(keys));
    },
    [setExpandedKeys],
  );

  return (
    <div
      css={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'auto',
        paddingTop: theme.spacing.xs,
        paddingRight: theme.spacing.lg,
      }}
    >
      <TimelineTreeGanttBars
        nodes={expandedNodesList}
        selectedKey={selectedNode?.key ?? ''}
        onSelect={handleSelectNode}
        traceStartTime={traceStartTime}
        traceEndTime={traceEndTime}
        expandedKeys={expandedKeys}
        setExpandedKeys={setExpandedKeysFromGantt}
      />
    </div>
  );
};
