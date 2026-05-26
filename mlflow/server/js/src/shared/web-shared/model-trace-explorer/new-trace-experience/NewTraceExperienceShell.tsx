import { useState } from 'react';

import { useDesignSystemTheme } from '@databricks/design-system';

import type { ModelTrace } from '../ModelTrace.types';
import { useModelTraceExplorerViewState } from '../ModelTraceExplorerViewStateContext';
import { useModelTraceSearch } from '../hooks/useModelTraceSearch';
import { NewTraceExperienceTabs } from './NewTraceExperienceTabs';
import { NewTraceExperienceTopBar } from './NewTraceExperienceTopBar';
import { NewTraceExperienceTraceTab } from './NewTraceExperienceTraceTab';

type Props = {
  modelTraceInfo: ModelTrace['info'];
  className?: string;
  selectedSpanId?: string;
  onSelectSpan?: (selectedSpanId?: string) => void;
};

export const NewTraceExperienceShell = ({ modelTraceInfo, className }: Props) => {
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

  const traceId =
    (modelTraceInfo as { trace_id?: string } | undefined)?.trace_id ??
    (modelTraceInfo as { request_id?: string } | undefined)?.request_id ??
    '-';

  const renderTraceTab = () => (
    <NewTraceExperienceTraceTab
      modelTraceInfo={modelTraceInfo}
      filteredTreeNodes={filteredTreeNodes}
      expandedKeys={expandedKeys}
      setExpandedKeys={setExpandedKeys}
    />
  );

  return (
    <div
      className={className}
      css={{
        display: 'flex',
        flex: 1,
        flexDirection: 'column',
        overflow: 'hidden',
        backgroundColor: theme.colors.backgroundPrimary,
        color: theme.colors.textPrimary,
      }}
    >
      <NewTraceExperienceTopBar
        traceId={traceId}
        spanFilterState={spanFilterState}
        setSpanFilterState={setSpanFilterState}
      />
      <NewTraceExperienceTabs modelTraceInfo={modelTraceInfo} renderTraceTab={renderTraceTab} />
    </div>
  );
};
