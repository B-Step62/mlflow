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
  const { appliedSavedView } = useModelTraceExplorerViewState();

  // Filter logic supporting dotted paths with array indices, e.g. "messages.0.content" or "0.content"
  const filterValueByKeys = (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    value: any,
    keys?: string[],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ): any => {
    if (keys === undefined) return value; // no filtering
    if (!keys || keys.length === 0) return undefined; // show none

    const getAtPath = (src: any, segments: string[]) => {
      let cur = src;
      for (const seg of segments) {
        if (cur === undefined || cur === null) return undefined;
        const isIndex = /^-?\d+$/.test(seg);
        if (Array.isArray(cur)) {
          if (!isIndex) return undefined;
          let idx = Number(seg);
          if (!Number.isInteger(idx)) return undefined;
          if (idx < 0) {
            // Support negative indices, e.g., -1 = last element
            idx = cur.length + idx;
          }
          if (idx < 0 || idx >= cur.length) return undefined;
          cur = cur[idx];
          continue;
        }
        if (typeof cur === 'object') {
          if (!(seg in cur)) return undefined;
          cur = (cur as Record<string, unknown>)[seg];
          continue;
        }
        return undefined;
      }
      // Deep clone objects/arrays to avoid mutating originals
      return Array.isArray(cur) || (typeof cur === 'object' && cur !== null)
        ? JSON.parse(JSON.stringify(cur))
        : cur;
    };

    // Single key → unwrap and return the leaf value directly
    if (keys.length === 1) {
      const leaf = getAtPath(value, (keys[0] || '').split('.').filter(Boolean));
      return leaf;
    }

    // Multiple keys → return an object keyed by full path → leaf value
    const out: Record<string, unknown> = {};
    for (const path of keys) {
      const leaf = getAtPath(value, (path || '').split('.').filter(Boolean));
      if (leaf !== undefined) {
        out[path] = leaf;
      }
    }
    return out;
  };

  const getSectionKeys = (
    section: 'inputs' | 'outputs',
    spanType?: string,
  ): string[] | undefined => {
    const fields = appliedSavedView?.definition.fields as any;
    if (!fields) return undefined;
    const typeKey = spanType ?? 'UNKNOWN';
    const byType = fields[typeKey]?.[section]?.keys as string[] | undefined;
    const all = fields['ALL']?.[section]?.keys as string[] | undefined;
    return byType ?? all;
  };

  const filteredInputs = useMemo(() => {
    const keys = getSectionKeys('inputs', activeSpan?.type as string | undefined);
    return filterValueByKeys(activeSpan?.inputs, keys);
  }, [activeSpan, appliedSavedView?.definition.fields]);

  const filteredOutputs = useMemo(() => {
    const keys = getSectionKeys('outputs', activeSpan?.type as string | undefined);
    return filterValueByKeys(activeSpan?.outputs, keys);
  }, [activeSpan, appliedSavedView?.definition.fields]);

  const inputList = useMemo(() => {
    const keysFromView = getSectionKeys('inputs', activeSpan?.type as string | undefined);
    const isSingleKey = (keysFromView?.length ?? 0) === 1;
    if (isSingleKey) {
      if (typeof filteredInputs === 'undefined') {
        return [];
      }
      return [
        {
          key: keysFromView?.[0] ?? '',
          value: JSON.stringify(filteredInputs ?? null, null, 2) ?? 'null',
        },
      ];
    }
    return createListFromObject(filteredInputs);
  }, [filteredInputs, appliedSavedView?.definition.fields.inputs?.keys]);

  const outputList = useMemo(() => {
    const keysFromView = getSectionKeys('outputs', activeSpan?.type as string | undefined);
    const isSingleKey = (keysFromView?.length ?? 0) === 1;
    if (isSingleKey) {
      if (typeof filteredOutputs === 'undefined') {
        return [];
      }
      return [
        {
          key: keysFromView?.[0] ?? '',
          value: JSON.stringify(filteredOutputs ?? null, null, 2) ?? 'null',
        },
      ];
    }
    return createListFromObject(filteredOutputs);
  }, [filteredOutputs, appliedSavedView?.definition.fields.outputs?.keys]);

  const visibleInputs = inputList;
  const visibleOutputs = outputList;

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
            {visibleInputs.map(({ key, value }, index) => {
              const keysFromView = appliedSavedView?.definition.fields.inputs?.keys;
              const isSingleKeyUnwrapped = (keysFromView?.length ?? 0) === 1;
              const pathTitle = isSingleKeyUnwrapped
                ? (keysFromView?.[0] ?? '').split('.').filter(Boolean).join(' > ')
                : (key || '').split('.').filter(Boolean).join(' > ');
              const title = pathTitle || key;
              return (
              <ModelTraceExplorerCodeSnippet
                key={key || index}
                title={title}
                data={value}
                searchFilter={searchFilter}
                activeMatch={activeMatch}
                containsActiveMatch={isActiveMatchSpan && activeMatch.section === 'inputs' && activeMatch.key === key}
              />
              );
            })}
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
            {visibleOutputs.map(({ key, value }, index) => {
              const keysFromView = appliedSavedView?.definition.fields.outputs?.keys;
              const isSingleKeyUnwrapped = (keysFromView?.length ?? 0) === 1;
              const pathTitle = isSingleKeyUnwrapped
                ? (keysFromView?.[0] ?? '').split('.').filter(Boolean).join(' > ')
                : (key || '').split('.').filter(Boolean).join(' > ');
              const title = pathTitle || key;
              return (
              <ModelTraceExplorerCodeSnippet
                key={key || index}
                title={title}
                data={value}
                searchFilter={searchFilter}
                activeMatch={activeMatch}
                containsActiveMatch={isActiveMatchSpan && activeMatch.section === 'outputs' && activeMatch.key === key}
              />
              );
            })}
          </div>
        </ModelTraceExplorerCollapsibleSection>
      )}
    </div>
  );
}
