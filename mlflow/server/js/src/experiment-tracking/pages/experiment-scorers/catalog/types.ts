export type CatalogProvider = 'mlflow' | 'ragas' | 'deepeval' | 'trulens' | 'phoenix' | 'guardrails' | 'custom';

export type QuickFilter = 'owned-by-me' | 'scheduled' | 'llm-as-a-judge' | 'conversation';

export type JudgeCategory = 'rag' | 'text-quality' | 'safety' | 'tool-call' | 'agent';

export interface CategoryGroup {
  category: JudgeCategory;
  displayName: string;
  entries: CatalogEntry[];
}

export type CatalogTag =
  | 'rag'
  | 'safety'
  | 'conversation'
  | 'agent'
  | 'general'
  | 'retrieval'
  | 'tool-use'
  | 'text-quality'
  | 'comparison'
  | 'deterministic'
  | 'guardrail';

export interface CatalogEntry {
  id: string;
  name: string;
  provider: CatalogProvider;
  description: string;
  tags: CatalogTag[];
  evaluationLevel: 'span' | 'session';
  codeSnippet: string;
  installCommand?: string;
  canAddToExperiment: boolean;
  llmTemplate?: string;
  isSessionLevel?: boolean;
  requiresConfig?: boolean;
  instructions?: string;
}

export interface RegisteredJudgeRow {
  kind: 'registered';
  rowKey: string;
  scorer: import('../types').ScheduledScorer;
  status: 'active' | 'inactive';
}

export interface CatalogJudgeRow {
  kind: 'catalog';
  rowKey: string;
  entry: CatalogEntry;
  status: 'available';
}

export type UnifiedJudgeRow = RegisteredJudgeRow | CatalogJudgeRow;
