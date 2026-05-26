import { values } from 'lodash';
import { useLayoutEffect, useMemo, useState } from 'react';

import { useDesignSystemTheme } from '@databricks/design-system';
import { FormattedMessage } from '@databricks/i18n';

import type { ModelTrace, ModelTraceSpanNode } from '../ModelTrace.types';
import { useModelTraceExplorerViewState } from '../ModelTraceExplorerViewStateContext';
import { useModelTraceSearch } from '../hooks/useModelTraceSearch';
import { TimelineTree } from '../timeline-tree/TimelineTree';
import { DEFAULT_EXPAND_DEPTH, getTimelineTreeNodesMap } from '../timeline-tree/TimelineTree.utils';

const LEFT_PANE_WIDTH = 360;

type Props = {
  modelTraceInfo: ModelTrace['info'];
};

export const NewTraceExperienceTraceTab = ({ modelTraceInfo }: Props) => {
  const { theme } = useDesignSystemTheme();
  const { topLevelNodes, selectedNode, setSelectedNode, setActiveTab } = useModelTraceExplorerViewState();

  const [expandedKeys, setExpandedKeys] = useState<Set<string | number>>(new Set());

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

  const handleSelectNode = (node?: ModelTraceSpanNode) => {
    setSelectedNode(node);
  };

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
        <TimelineTree
          rootNodes={filteredTreeNodes}
          selectedNode={selectedNode}
          setSelectedNode={handleSelectNode}
          traceStartTime={traceStartTime}
          traceEndTime={traceEndTime}
          expandedKeys={expandedKeys}
          setExpandedKeys={setExpandedKeys}
          spanFilterState={spanFilterState}
          setSpanFilterState={setSpanFilterState}
        />
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
