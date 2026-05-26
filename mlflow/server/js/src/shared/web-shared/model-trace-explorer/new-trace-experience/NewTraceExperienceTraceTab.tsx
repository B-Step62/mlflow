import { values } from 'lodash';
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';

import {
  Button,
  ChevronLeftIcon,
  ChevronRightIcon,
  Tooltip,
  useDesignSystemTheme,
} from '@databricks/design-system';
import { useIntl } from '@databricks/i18n';

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
// When collapsed, leave just enough of the left pane to fit the expand button.
const COLLAPSED_TREE_WIDTH = 32;

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
  const intl = useIntl();
  const { topLevelNodes, selectedNode, setSelectedNode } = useModelTraceExplorerViewState();
  const paneRef = useRef<ModelTraceExplorerResizablePaneRef>(null);
  const [paneWidth, setPaneWidth] = useState(() => Math.round(window.innerWidth * DEFAULT_TREE_PANE_RATIO * 0.5));
  const [isCollapsed, setIsCollapsed] = useState(false);

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

  const collapseLabel = intl.formatMessage({
    defaultMessage: 'Collapse trace tree',
    description: 'Tooltip for the button that collapses the trace tree pane in the new trace experience',
  });
  const expandLabel = intl.formatMessage({
    defaultMessage: 'Expand trace tree',
    description: 'Tooltip for the button that expands the trace tree pane in the new trace experience',
  });

  const treeBody = (
    <div
      css={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        borderRight: `1px solid ${theme.colors.borderDecorative}`,
        position: 'relative',
      }}
    >
      <Tooltip componentId="mlflow.new-trace-experience.tree.collapse.tooltip" content={collapseLabel}>
        <Button
          componentId="mlflow.new-trace-experience.tree.collapse"
          aria-label={collapseLabel}
          icon={<ChevronLeftIcon />}
          size="small"
          onClick={() => setIsCollapsed(true)}
          css={{
            position: 'absolute',
            top: theme.spacing.xs,
            right: theme.spacing.xs,
            zIndex: 1,
          }}
        />
      </Tooltip>
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
  );

  if (isCollapsed) {
    return (
      <div css={{ display: 'flex', flex: 1, minHeight: 0, overflow: 'hidden' }}>
        <div
          css={{
            width: COLLAPSED_TREE_WIDTH,
            flexShrink: 0,
            borderRight: `1px solid ${theme.colors.borderDecorative}`,
            display: 'flex',
            justifyContent: 'center',
            paddingTop: theme.spacing.xs,
          }}
        >
          <Tooltip componentId="mlflow.new-trace-experience.tree.expand.tooltip" content={expandLabel}>
            <Button
              componentId="mlflow.new-trace-experience.tree.expand"
              aria-label={expandLabel}
              icon={<ChevronRightIcon />}
              size="small"
              onClick={() => setIsCollapsed(false)}
            />
          </Tooltip>
        </div>
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
    />
  );
};
