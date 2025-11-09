// Mocked saved views for the Trace modal (frontend-only v0), following
// the schema defined in the design doc.

import type { SpanFilterState, ModelSpanType } from './ModelTrace.types';

export type SavedTraceView = {
  id: string;
  name: string;
  experiment_id: string;
  definition: {
    spans: {
      span_types?: Array<
        | 'LLM'
        | 'CHAIN'
        | 'AGENT'
        | 'TOOL'
        | 'CHAT_MODEL'
        | 'RETRIEVER'
        | 'PARSER'
        | 'EMBEDDING'
        | 'RERANKER'
        | 'MEMORY'
        | 'UNKNOWN'
      >;
      span_name_pattern?: string;
      show_parents?: boolean;
      // Whether to always display the root span in the tree
      show_root_span?: boolean;
      show_exceptions?: boolean;
    };
    fields: Record<
      'ALL' | ModelSpanType | string,
      {
        inputs?: { keys?: string[] };
        outputs?: { keys?: string[] };
        attributes?: { keys?: string[] };
      }
    >;
  };
};

// Local storage helpers
const STORAGE_KEY = (experimentId: string) => `mlflow:traceView:${experimentId}`;

export function getLastAppliedSavedViewId(experimentId: string): string | undefined {
  try {
    const v = localStorage.getItem(STORAGE_KEY(experimentId));
    return v || undefined;
  } catch {
    return undefined;
  }
}

export function setLastAppliedSavedViewId(experimentId: string, viewId?: string) {
  try {
    const key = STORAGE_KEY(experimentId);
    if (!viewId) {
      localStorage.removeItem(key);
    } else {
      localStorage.setItem(key, viewId);
    }
  } catch {
    // ignore
  }
}

// Hard-coded mock views per experiment id; fallbacks under "global".
const MOCK_SAVED_VIEWS: Record<string, SavedTraceView[]> = {
  global: [
    {
      id: 'llm-agent-io',
      name: 'LLM and tools',
      experiment_id: 'global',
      definition: {
        spans: {
          span_types: ['LLM', 'TOOL', 'CHAT_MODEL'],
          span_name_pattern: '',
          show_parents: false,
          show_exceptions: true,
        },
        fields: {
          CHAIN: {
            inputs: { keys: ['messages.0.content'] },
            outputs: { keys: ['messages.-1.content'] },
          },
          TOOL: {
            outputs: { keys: ['content'] },
          },
        },
      },
    },
  ],
};

export function getMockSavedViews(experimentId?: string): SavedTraceView[] {
  if (experimentId && MOCK_SAVED_VIEWS[experimentId]) {
    return MOCK_SAVED_VIEWS[experimentId];
  }
  return MOCK_SAVED_VIEWS.global ?? [];
}

// Utility to merge a view's span types into an existing SpanFilterState
export function applyViewDefinitionToSpanFilterState(
  spanFilterState: SpanFilterState,
  view: SavedTraceView,
): SpanFilterState {
  const currentTypes = Object.keys(spanFilterState.spanTypeDisplayState);
  const allowed = new Set(view.definition.spans.span_types ?? currentTypes);
  return {
    ...spanFilterState,
    showParents: view.definition.spans.show_parents ?? spanFilterState.showParents,
    showExceptions: view.definition.spans.show_exceptions ?? spanFilterState.showExceptions,
    spanTypeDisplayState: currentTypes.reduce<Record<string, boolean>>((acc, t) => {
      acc[t] = allowed.has(t);
      return acc;
    }, {}),
  };
}
