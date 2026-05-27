import { values } from 'lodash';
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { ChevronRightIcon, Tooltip, useDesignSystemTheme } from '@databricks/design-system';

import type { ModelTrace, ModelTraceSpanNode } from '../ModelTrace.types';
import ModelTraceExplorerResizablePane from '../ModelTraceExplorerResizablePane';
import type { ModelTraceExplorerResizablePaneRef } from '../ModelTraceExplorerResizablePane';
import { useModelTraceExplorerViewState } from '../ModelTraceExplorerViewStateContext';
import { TimelineTreeNode } from '../timeline-tree/TimelineTreeNode';
import { DEFAULT_EXPAND_DEPTH, getTimelineTreeNodesMap } from '../timeline-tree/TimelineTree.utils';
import { NewTraceExperienceRightPane } from './NewTraceExperienceRightPane';

const DEFAULT_TREE_PANE_RATIO = 0.4;
const TREE_MIN_WIDTH = 200;
const RIGHT_MIN_WIDTH = 320;

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
  const paneRef = useRef<ModelTraceExplorerResizablePaneRef>(null);
  const [paneWidth, setPaneWidth] = useState(() => Math.round(window.innerWidth * DEFAULT_TREE_PANE_RATIO * 0.5));
  const [isTreeCollapsed, setIsTreeCollapsed] = useState(false);

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

  const treeBody = (
    <div
      css={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        borderRight: `1px solid ${theme.colors.borderDecorative}`,
      }}
    >
      <div
        css={{
          flex: 1,
          overflowY: 'auto',
          overflowX: 'hidden',
          paddingTop: theme.spacing.xs,
          // Slimmer scrollbar than the platform default. Firefox uses the
          // standard property; WebKit uses the vendor pseudo-elements.
          scrollbarWidth: 'thin',
          '&::-webkit-scrollbar': { width: 6, height: 6 },
          '&::-webkit-scrollbar-thumb': {
            backgroundColor: theme.colors.actionDisabledBackground,
            borderRadius: 3,
          },
          '&::-webkit-scrollbar-thumb:hover': {
            backgroundColor: theme.colors.actionDefaultBorderHover,
          },
          '&::-webkit-scrollbar-track': { backgroundColor: 'transparent' },
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
  );

  if (isTreeCollapsed) {
    return (
      <div css={{ display: 'flex', flex: 1, position: 'relative', overflow: 'hidden' }}>
        <Tooltip componentId="trace-ui.expand-tree" content="Expand span tree">
          <button
            type="button"
            aria-label="Expand span tree"
            onClick={() => setIsTreeCollapsed(false)}
            css={{
              position: 'absolute',
              top: '50%',
              left: theme.spacing.sm,
              transform: 'translateY(-50%)',
              width: 24,
              height: 24,
              padding: 0,
              borderRadius: '50%',
              border: `1px solid ${theme.colors.border}`,
              backgroundColor: theme.colors.backgroundPrimary,
              color: theme.colors.textSecondary,
              boxShadow: theme.shadows.sm,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 2,
              ':hover': {
                color: theme.colors.textPrimary,
                backgroundColor: theme.colors.backgroundSecondary,
              },
            }}
          >
            <ChevronRightIcon css={{ fontSize: 12 }} />
          </button>
        </Tooltip>
        <NewTraceExperienceRightPane modelTraceInfo={modelTraceInfo} />
      </div>
    );
  }

  return (
    <ModelTraceExplorerResizablePane
      ref={paneRef}
      initialRatio={DEFAULT_TREE_PANE_RATIO}
      paneWidth={paneWidth}
      setPaneWidth={setPaneWidth}
      leftChild={treeBody}
      leftMinWidth={TREE_MIN_WIDTH}
      rightChild={<NewTraceExperienceRightPane modelTraceInfo={modelTraceInfo} />}
      rightMinWidth={RIGHT_MIN_WIDTH}
      onCollapseLeft={() => setIsTreeCollapsed(true)}
      collapseLeftAriaLabel="Collapse span tree"
    />
  );
};
