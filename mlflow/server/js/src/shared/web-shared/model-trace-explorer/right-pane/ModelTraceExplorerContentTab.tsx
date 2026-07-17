import { useDesignSystemTheme } from '@databricks/design-system';

import { ModelTraceExplorerDefaultSpanView } from './ModelTraceExplorerDefaultSpanView';
import type { ModelTraceSpanNode, SearchMatch } from '../ModelTrace.types';
import { useModelTraceExplorerPreferences } from '../ModelTraceExplorerPreferencesContext';
import { SpanModelCostBadge } from './SpanModelCostBadge';

export function ModelTraceExplorerContentTab({
  activeSpan,
  className,
  searchFilter,
  activeMatch,
}: {
  activeSpan: ModelTraceSpanNode | undefined;
  className?: string;
  searchFilter: string;
  activeMatch: SearchMatch | null;
}) {
  const { theme } = useDesignSystemTheme();
  const { renderMode } = useModelTraceExplorerPreferences();

  return (
    <div
      css={{
        overflowY: 'auto',
      }}
      className={className}
      data-testid="model-trace-explorer-content-tab"
    >
      <div
        css={{
          display: 'flex',
          justifyContent: 'flex-end',
          marginBottom: theme.spacing.sm,
          marginRight: 'auto',
        }}
      >
        <SpanModelCostBadge css={{ marginRight: 'auto' }} activeSpan={activeSpan} />
      </div>
      <ModelTraceExplorerDefaultSpanView
        activeSpan={activeSpan}
        className={className}
        searchFilter={searchFilter}
        activeMatch={activeMatch}
        defaultRenderMode={renderMode}
      />
    </div>
  );
}
