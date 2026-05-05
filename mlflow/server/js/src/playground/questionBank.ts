/**
 * Typed REST wrappers for the per-experiment question bank — saved user
 * probes the cockpit can fire one-off (chip click) or in batch (Run all).
 *
 * Server endpoints land in `mlflow/server/playground_api.py` under
 * `/ajax-api/3.0/mlflow/playground/question-bank`. We keep the wrappers
 * thin (no caching, no React Query) — the cockpit owns refresh after
 * mutations.
 */

import {
  getAjaxUrl,
  getDefaultHeaders,
} from '../shared/web-shared/model-trace-explorer/ModelTraceExplorer.request.utils';

const BASE = 'ajax-api/3.0/mlflow/playground/question-bank';

export type SavedQuestion = {
  question_id: string;
  content: string;
  dataset_record_id?: string;
  source_message_id?: string | null;
  created_time?: number;
};

export const fetchQuestionBank = async (experimentId: string): Promise<SavedQuestion[]> => {
  const response = await fetch(getAjaxUrl(`${BASE}?experiment_id=${encodeURIComponent(experimentId)}`), {
    headers: getDefaultHeaders(document.cookie),
  });
  if (!response.ok) {
    throw new Error(`Question-bank fetch failed (${response.status}): ${await response.text()}`);
  }
  const body = (await response.json()) as { questions?: SavedQuestion[] };
  return body.questions ?? [];
};

export const addQuestion = async (
  experimentId: string,
  question: string,
  options?: { sourceMessageId?: string },
): Promise<string> => {
  const response = await fetch(getAjaxUrl(`${BASE}/add`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...getDefaultHeaders(document.cookie) },
    body: JSON.stringify({
      experiment_id: experimentId,
      question,
      source_message_id: options?.sourceMessageId,
    }),
  });
  if (!response.ok) {
    throw new Error(`Question-bank add failed (${response.status}): ${await response.text()}`);
  }
  const body = (await response.json()) as { question_id: string };
  return body.question_id;
};

export const deleteQuestion = async (experimentId: string, questionId: string): Promise<void> => {
  const response = await fetch(
    getAjaxUrl(`${BASE}/${encodeURIComponent(questionId)}?experiment_id=${encodeURIComponent(experimentId)}`),
    {
      method: 'DELETE',
      headers: getDefaultHeaders(document.cookie),
    },
  );
  if (!response.ok) {
    throw new Error(`Question-bank delete failed (${response.status}): ${await response.text()}`);
  }
};
