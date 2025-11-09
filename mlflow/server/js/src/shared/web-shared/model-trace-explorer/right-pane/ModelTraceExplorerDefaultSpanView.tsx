import { isNil } from 'lodash';
import { useMemo } from 'react';

import { useDesignSystemTheme } from '@databricks/design-system';
import { FormattedMessage } from '@databricks/i18n';

import type { ModelTraceSpanNode, SearchMatch } from '../ModelTrace.types';
import { createListFromObject } from '../ModelTraceExplorer.utils';
import { ModelTraceExplorerCodeSnippet } from '../ModelTraceExplorerCodeSnippet';
import { ModelTraceExplorerCollapsibleSection } from '../ModelTraceExplorerCollapsibleSection';
import { useModelTraceExplorerViewState } from '../ModelTraceExplorerViewStateContext';

export function ModelTraceExplorerDefaultSpanView({
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
  const inputList = useMemo(() => createListFromObject(activeSpan?.inputs), [activeSpan]);
  const outputList = useMemo(() => createListFromObject(activeSpan?.outputs), [activeSpan]);
  const { appliedViewConfig } = useModelTraceExplorerViewState();

  const filterByVisibility = (
    list: { key: string; value: string }[],
    vis?: { mode: 'all' | 'none' | 'keys'; keys?: string[] },
  ) => {
    if (!vis || vis.mode === 'all') return list;
    if (vis.mode === 'none') return [];
    const allowed = new Set(vis.keys ?? []);
    return list.filter(({ key }) => allowed.has(key));
  };

  const visibleInputs = useMemo(
    () => filterByVisibility(inputList, appliedViewConfig?.visibility?.inputs),
    [inputList, appliedViewConfig?.visibility?.inputs],
  );
  const visibleOutputs = useMemo(
    () => filterByVisibility(outputList, appliedViewConfig?.visibility?.outputs),
    [outputList, appliedViewConfig?.visibility?.outputs],
  );

  if (isNil(activeSpan)) {
    return null;
  }

  const containsInputs = visibleInputs.length > 0;
  const containsOutputs = visibleOutputs.length > 0;

  const isActiveMatchSpan = !isNil(activeMatch) && activeMatch.span.key === activeSpan.key;

  return (
    <div data-testid="model-trace-explorer-default-span-view">
      {containsInputs && (
        <ModelTraceExplorerCollapsibleSection
          withBorder
          css={{ marginBottom: theme.spacing.sm }}
          sectionKey="input"
          title={
            <div
              css={{
                display: 'flex',
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                width: '100%',
              }}
            >
              <FormattedMessage
                defaultMessage="Inputs"
                description="Model trace explorer > selected span > inputs header"
              />
            </div>
          }
        >
          <div css={{ display: 'flex', flexDirection: 'column', gap: theme.spacing.sm }}>
            {visibleInputs.map(({ key, value }, index) => (
              <ModelTraceExplorerCodeSnippet
                key={key || index}
                title={key}
                data={value}
                searchFilter={searchFilter}
                activeMatch={activeMatch}
                containsActiveMatch={isActiveMatchSpan && activeMatch.section === 'inputs' && activeMatch.key === key}
              />
            ))}
          </div>
        </ModelTraceExplorerCollapsibleSection>
      )}
      {containsOutputs && (
        <ModelTraceExplorerCollapsibleSection
          withBorder
          sectionKey="output"
          title={
            <div css={{ display: 'flex', flexDirection: 'row', justifyContent: 'space-between', width: '100%' }}>
              <FormattedMessage
                defaultMessage="Outputs"
                description="Model trace explorer > selected span > outputs header"
              />
            </div>
          }
        >
          <div css={{ display: 'flex', flexDirection: 'column', gap: theme.spacing.sm }}>
            {visibleOutputs.map(({ key, value }) => (
              <ModelTraceExplorerCodeSnippet
                key={key}
                title={key}
                data={value}
                searchFilter={searchFilter}
                activeMatch={activeMatch}
                containsActiveMatch={isActiveMatchSpan && activeMatch.section === 'outputs' && activeMatch.key === key}
              />
            ))}
          </div>
        </ModelTraceExplorerCollapsibleSection>
      )}
    </div>
  );
}
