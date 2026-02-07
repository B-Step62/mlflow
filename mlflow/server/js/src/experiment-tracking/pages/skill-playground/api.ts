import { getAjaxUrl } from '@mlflow/mlflow/src/common/utils/FetchUtils';
import type { PanelConfig, PanelId, SkillEntry } from './types';

const API_BASE = getAjaxUrl('ajax-api/3.0/mlflow/playground');

export interface SessionResponse {
  session_id: string;
  experiment_id: string;
  created_at: string;
  config_a: {
    panel_id: PanelId;
    skills: Array<{ name: string; repo: string; commit_id: string }>;
    allowed_tools: string[];
    model: 'opus' | 'sonnet' | 'haiku';
  };
  config_b: {
    panel_id: PanelId;
    skills: Array<{ name: string; repo: string; commit_id: string }>;
    allowed_tools: string[];
    model: 'opus' | 'sonnet' | 'haiku';
  };
}

export interface SkillInfo {
  name: string;
}

export interface CommitInfo {
  hash: string;
  message: string;
}

export const createSession = async (experimentId: string): Promise<SessionResponse> => {
  const response = await fetch(`${API_BASE}/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ experiment_id: experimentId }),
  });
  if (!response.ok) {
    const data = await response.json();
    throw new Error(data.detail || 'Failed to create session');
  }
  return response.json();
};

export const getSession = async (sessionId: string): Promise<SessionResponse> => {
  const response = await fetch(`${API_BASE}/sessions/${sessionId}`);
  if (!response.ok) {
    const data = await response.json();
    throw new Error(data.detail || 'Failed to get session');
  }
  return response.json();
};

export const deleteSession = async (sessionId: string): Promise<void> => {
  const response = await fetch(`${API_BASE}/sessions/${sessionId}`, { method: 'DELETE' });
  if (!response.ok) {
    const data = await response.json();
    throw new Error(data.detail || 'Failed to delete session');
  }
};

export const updatePanelConfig = async (
  sessionId: string,
  panelId: PanelId,
  config: {
    skills?: Array<{ name: string; repo: string; commit_id: string }>;
    allowed_tools?: string[];
    model?: 'opus' | 'sonnet' | 'haiku';
  },
): Promise<SessionResponse> => {
  const response = await fetch(`${API_BASE}/sessions/${sessionId}/panels/${panelId}/config`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  });
  if (!response.ok) {
    const data = await response.json();
    throw new Error(data.detail || 'Failed to update panel config');
  }
  return response.json();
};

export const listSkills = async (repo: string, ref: string): Promise<SkillInfo[]> => {
  const params = new URLSearchParams({ repo, ref });
  const response = await fetch(`${API_BASE}/skills/list?${params}`);
  if (!response.ok) {
    const data = await response.json();
    throw new Error(data.detail || 'Failed to list skills');
  }
  const result = await response.json();
  return result.skills;
};

export const listCommits = async (repo: string, count = 20): Promise<CommitInfo[]> => {
  const params = new URLSearchParams({ repo, count: String(count) });
  const response = await fetch(`${API_BASE}/skills/commits?${params}`);
  if (!response.ok) {
    const data = await response.json();
    throw new Error(data.detail || 'Failed to list commits');
  }
  const result = await response.json();
  return result.commits;
};

export const runPanel = async (
  sessionId: string,
  panelId: PanelId,
  message: string,
): Promise<{ stream_url: string }> => {
  const response = await fetch(`${API_BASE}/sessions/${sessionId}/panels/${panelId}/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message }),
  });
  if (!response.ok) {
    const data = await response.json();
    throw new Error(data.detail || 'Failed to run panel');
  }
  return response.json();
};

export const cancelPanel = async (sessionId: string, panelId: PanelId): Promise<{ message: string }> => {
  const response = await fetch(`${API_BASE}/sessions/${sessionId}/panels/${panelId}/cancel`, {
    method: 'PATCH',
  });
  if (!response.ok) {
    const data = await response.json();
    throw new Error(data.detail || 'Failed to cancel panel');
  }
  return response.json();
};

// Convert between frontend camelCase SkillEntry and backend snake_case format
export const toBackendSkills = (skills: SkillEntry[]): Array<{ name: string; repo: string; commit_id: string }> =>
  skills.map((s) => ({ name: s.name, repo: s.repo, commit_id: s.commitId }));

export const toFrontendSkills = (skills: Array<{ name: string; repo: string; commit_id: string }>): SkillEntry[] =>
  skills.map((s) => ({ name: s.name, repo: s.repo, commitId: s.commit_id }));
