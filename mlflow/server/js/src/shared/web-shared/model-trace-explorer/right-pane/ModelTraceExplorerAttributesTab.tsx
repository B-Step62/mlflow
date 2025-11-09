import { isNil, keys } from 'lodash';

import { Empty, useDesignSystemTheme } from '@databricks/design-system';
import { FormattedMessage } from '@databricks/i18n';

import type { ModelTraceSpanNode, SearchMatch } from '../ModelTrace.types';
import { ModelTraceExplorerCodeSnippet } from '../ModelTraceExplorerCodeSnippet';
import { useModelTraceExplorerViewState } from '../ModelTraceExplorerViewStateContext';

export function ModelTraceExplorerAttributesTab({
  activeSpan,
  searchFilter,
  activeMatch,
}: {
  activeSpan: ModelTraceSpanNode;
  searchFilter: string;
  activeMatch: SearchMatch | null;
}) {
  const { theme } = useDesignSystemTheme();
  const { attributes } = activeSpan;
  const { appliedSavedView, showSavedViewEditor } = useModelTraceExplorerViewState();
  const attrKeys = keys(attributes);
  const getAttrKeysForSpan = (): string[] | undefined => {
    const fields = appliedSavedView?.definition.fields as any;
    if (!fields) return undefined;
    const typeKey = (activeSpan?.type as string | undefined) ?? 'UNKNOWN';
    const byType = fields[typeKey]?.attributes?.keys as string[] | undefined;
    const all = fields['ALL']?.attributes?.keys as string[] | undefined;
    const chosen = (byType ?? all);
    if (chosen === undefined) return undefined; // no filter defined
    // Remove blank keys; blanks no longer imply show-all
    return chosen.filter((k: string) => !!k && String(k).trim() !== '');
  };
  const keysFilter = getAttrKeysForSpan();
  const allowed = keysFilter ? new Set(keysFilter) : undefined;
  const visibleAttrKeys = (() => {
    // While editor is open, show all attributes, but order so that
    // filtered keys are at the top in their original order
    if (showSavedViewEditor) {
      if (!keysFilter || keysFilter.length === 0) return attrKeys;
      const top = attrKeys.filter((k) => (allowed as Set<string>).has(k));
      const rest = attrKeys.filter((k) => !(allowed as Set<string>).has(k));
      return [...top, ...rest];
    }
    if (keysFilter === undefined) return attrKeys;
    if ((keysFilter ?? []).length === 0) return [] as string[];
    return attrKeys.filter((k) => (allowed as Set<string>).has(k));
  })();
  const containsAttributes = visibleAttrKeys.length > 0;
  const isActiveMatchSpan = !isNil(activeMatch) && activeMatch.span.key === activeSpan.key;

  if (!containsAttributes || isNil(attributes)) {
    return (
      <div css={{ marginTop: theme.spacing.md }}>
        <Empty
          description={
            <FormattedMessage
              defaultMessage="No attributes found"
              description="Empty state for the attributes tab in the model trace explorer. Attributes are properties of a span that the user defines."
            />
          }
        />
      </div>
    );
  }

  return (
    <div
      css={{
        display: 'flex',
        flexDirection: 'column',
        gap: theme.spacing.sm,
        padding: theme.spacing.md,
      }}
    >
      {visibleAttrKeys.map((key) => {
        const isDimmed = !!showSavedViewEditor && !!keysFilter && !(allowed as Set<string>)?.has(key);
        return (
          <div key={key} css={{ opacity: isDimmed ? 0.4 : 1 }}>
            <ModelTraceExplorerCodeSnippet
              title={key}
              data={JSON.stringify(attributes[key], null, 2)}
              searchFilter={searchFilter}
              activeMatch={activeMatch}
              containsActiveMatch={
                isActiveMatchSpan && activeMatch.section === 'attributes' && activeMatch.key === key
              }
            />
          </div>
        );
      })}
    </div>
  );
}
