import type { CatalogEntry, CatalogProvider, CatalogTag } from './types';

export function filterCatalogEntries(
  entries: CatalogEntry[],
  searchQuery: string,
  selectedTags: CatalogTag[],
  selectedProviders: CatalogProvider[],
): CatalogEntry[] {
  const query = searchQuery.toLowerCase();

  return entries.filter((entry) => {
    // Text search on name and description
    if (query && !entry.name.toLowerCase().includes(query) && !entry.description.toLowerCase().includes(query)) {
      return false;
    }

    // Tag filter: match if entry has ANY of the selected tags
    if (selectedTags.length > 0 && !selectedTags.some((tag) => entry.tags.includes(tag))) {
      return false;
    }

    // Provider filter: match if entry's provider is in selected providers
    if (selectedProviders.length > 0 && !selectedProviders.includes(entry.provider)) {
      return false;
    }

    return true;
  });
}

const PROVIDER_DISPLAY_NAMES: Record<CatalogProvider, string> = {
  mlflow: 'MLflow',
  ragas: 'RAGAS',
  deepeval: 'DeepEval',
  trulens: 'TruLens',
  phoenix: 'Phoenix',
  guardrails: 'Guardrails',
};

export function getProviderDisplayName(provider: CatalogProvider): string {
  return PROVIDER_DISPLAY_NAMES[provider] ?? provider;
}

const TAG_DISPLAY_NAMES: Record<CatalogTag, string> = {
  rag: 'RAG',
  safety: 'Safety',
  conversation: 'Conversation',
  agent: 'Agent',
  general: 'General',
  retrieval: 'Retrieval',
  'tool-use': 'Tool Use',
  'text-quality': 'Text Quality',
  comparison: 'Comparison',
  deterministic: 'Deterministic',
  guardrail: 'Guardrail',
};

export function getTagDisplayName(tag: CatalogTag): string {
  return TAG_DISPLAY_NAMES[tag] ?? tag;
}

export const ALL_TAGS: CatalogTag[] = [
  'rag',
  'safety',
  'conversation',
  'agent',
  'general',
  'retrieval',
  'tool-use',
  'text-quality',
  'comparison',
  'deterministic',
  'guardrail',
];

export const ALL_PROVIDERS: CatalogProvider[] = ['mlflow', 'ragas', 'deepeval', 'trulens', 'phoenix', 'guardrails'];
