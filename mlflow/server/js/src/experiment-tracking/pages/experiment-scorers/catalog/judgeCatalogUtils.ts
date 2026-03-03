import type { ScheduledScorer } from '../types';
import type { CatalogEntry, CatalogProvider, CatalogTag, CategoryGroup, JudgeCategory, QuickFilter } from './types';

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
  custom: 'Custom',
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

export const ALL_PROVIDERS: CatalogProvider[] = [
  'custom',
  'mlflow',
  'ragas',
  'deepeval',
  'trulens',
  'phoenix',
  'guardrails',
];

export interface ProviderGroup {
  provider: CatalogProvider;
  entries: CatalogEntry[];
}

export function groupCatalogByProvider(entries: CatalogEntry[]): ProviderGroup[] {
  const groups = new Map<CatalogProvider, CatalogEntry[]>();
  for (const entry of entries) {
    const list = groups.get(entry.provider);
    if (list) {
      list.push(entry);
    } else {
      groups.set(entry.provider, [entry]);
    }
  }
  // Maintain consistent ordering based on ALL_PROVIDERS
  return ALL_PROVIDERS.filter((p) => groups.has(p)).map((provider) => ({ provider, entries: groups.get(provider)! }));
}

export function filterRegisteredScorers(
  scorers: ScheduledScorer[],
  searchQuery: string,
  selectedTags: CatalogTag[],
  selectedProviders: CatalogProvider[],
): ScheduledScorer[] {
  // Hide registered scorers when any tag filter is active (they have no tags)
  if (selectedTags.length > 0) {
    return [];
  }

  // Show when 'custom' selected or no provider filter; hide when only non-custom providers selected
  if (selectedProviders.length > 0 && !selectedProviders.includes('custom')) {
    return [];
  }

  const query = searchQuery.toLowerCase();
  return scorers.filter((scorer) => {
    if (query && !scorer.name.toLowerCase().includes(query)) {
      return false;
    }
    return true;
  });
}

function scorerMatchesQuickFilter(scorer: ScheduledScorer, filter: QuickFilter): boolean {
  switch (filter) {
    case 'owned-by-me':
      return true;
    case 'scheduled':
      return (scorer.sampleRate ?? 0) > 0;
    case 'llm-as-a-judge':
      return scorer.type === 'llm';
    case 'conversation':
      return scorer.isSessionLevelScorer === true;
  }
}

export function applyQuickFiltersToScorers(scorers: ScheduledScorer[], quickFilters: QuickFilter[]): ScheduledScorer[] {
  if (quickFilters.length === 0) return scorers;
  return scorers.filter((scorer) => quickFilters.some((f) => scorerMatchesQuickFilter(scorer, f)));
}

function catalogMatchesQuickFilter(entry: CatalogEntry, filter: QuickFilter): boolean {
  switch (filter) {
    case 'owned-by-me':
      return false;
    case 'scheduled':
      return false;
    case 'llm-as-a-judge':
      return entry.provider === 'mlflow';
    case 'conversation':
      return entry.tags.includes('conversation');
  }
}

export function applyQuickFiltersToCatalog(entries: CatalogEntry[], quickFilters: QuickFilter[]): CatalogEntry[] {
  if (quickFilters.length === 0) return entries;
  return entries.filter((entry) => quickFilters.some((f) => catalogMatchesQuickFilter(entry, f)));
}

// --- Category grouping ---

export const JUDGE_CATEGORIES: { key: JudgeCategory; displayName: string }[] = [
  { key: 'rag', displayName: 'RAG' },
  { key: 'text-quality', displayName: 'Text Quality' },
  { key: 'safety', displayName: 'Safety' },
  { key: 'tool-call', displayName: 'Tool Call' },
  { key: 'agent', displayName: 'Agent' },
];

const TAG_TO_CATEGORY: Partial<Record<CatalogTag, JudgeCategory>> = {
  rag: 'rag',
  retrieval: 'rag',
  'text-quality': 'text-quality',
  general: 'text-quality',
  comparison: 'text-quality',
  safety: 'safety',
  guardrail: 'safety',
  'tool-use': 'tool-call',
  agent: 'agent',
  conversation: 'agent',
};

export function getCategoryForEntry(entry: CatalogEntry): JudgeCategory | null {
  for (const tag of entry.tags) {
    if (tag === 'deterministic') continue;
    const category = TAG_TO_CATEGORY[tag];
    if (category) return category;
  }
  return null;
}

export function groupByCategoryEntries(entries: CatalogEntry[]): CategoryGroup[] {
  const groups = new Map<JudgeCategory, CatalogEntry[]>();
  for (const entry of entries) {
    const category = getCategoryForEntry(entry);
    if (!category) continue;
    const list = groups.get(category);
    if (list) {
      list.push(entry);
    } else {
      groups.set(category, [entry]);
    }
  }
  return JUDGE_CATEGORIES.filter((c) => groups.has(c.key)).map((c) => ({
    category: c.key,
    displayName: c.displayName,
    entries: groups.get(c.key)!,
  }));
}
