export type CatalogProvider = 'mlflow' | 'ragas' | 'deepeval' | 'trulens' | 'phoenix' | 'guardrails';

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
