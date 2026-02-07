export type PanelId = 'a' | 'b';

export interface SkillEntry {
  name: string;
  repo: string;
  commitId: string;
}

export interface PanelConfig {
  panelId: PanelId;
  name: string;
  skills: SkillEntry[];
  allowedTools: string[];
  model: 'opus' | 'sonnet' | 'haiku';
}

export interface ToolCall {
  name: string;
  description: string;
  status: 'success' | 'error' | 'running';
  durationMs?: number;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  isStreaming?: boolean;
  toolCalls?: ToolCall[];
  traceId?: string;
  judgeScores?: Record<string, number>;
}

export interface ComparisonPair {
  pairId: string;
  traceIdA?: string;
  traceIdB?: string;
}

export type Preference = 'A' | 'B' | 'tie' | 'both_bad';
