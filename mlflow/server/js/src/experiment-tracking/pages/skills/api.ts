import { fetchEndpoint } from '../../../common/utils/FetchUtils';
import type {
  RegisteredSkill,
  RegisteredSkillVersion,
  RegisteredSkillDetailsResponse,
  SkillVersionFile,
} from './types';

const defaultErrorHandler = async ({
  reject,
  response,
  err: originalError,
}: {
  reject: (cause: any) => void;
  response: Response;
  err: Error;
}) => {
  const error = originalError;
  if (response) {
    try {
      const messageFromResponse = (await response.json())?.detail;
      if (messageFromResponse) {
        error.message = messageFromResponse;
      }
    } catch {
      // keep original error message
    }
  }
  reject(error);
};

export const RegisteredSkillsApi = {
  listRegisteredSkills: (searchFilter?: string, maxResults: number = 100) => {
    const params = new URLSearchParams();
    if (searchFilter) {
      params.append('filter', searchFilter);
    }
    params.append('max_results', String(maxResults));
    const relativeUrl = ['ajax-api/3.0/mlflow/skills/', params.toString()].join('?');
    return fetchEndpoint({
      relativeUrl,
      error: defaultErrorHandler,
    }) as Promise<RegisteredSkill[]>;
  },

  getSkillDetails: (skillName: string) => {
    const relativeUrl = `ajax-api/3.0/mlflow/skills/${encodeURIComponent(skillName)}`;
    return fetchEndpoint({
      relativeUrl,
      error: defaultErrorHandler,
    }) as Promise<RegisteredSkillDetailsResponse>;
  },

  previewSource: (source: string) => {
    return fetchEndpoint({
      relativeUrl: 'ajax-api/3.0/mlflow/skills/preview',
      method: 'POST',
      body: JSON.stringify({ source }),
      error: defaultErrorHandler,
    }) as Promise<{ name: string; description: string | null }[]>;
  },

  registerFromSource: (source: string, tags?: Record<string, string>, skillNames?: string[]) => {
    return fetchEndpoint({
      relativeUrl: 'ajax-api/3.0/mlflow/skills/register',
      method: 'POST',
      body: JSON.stringify({ source, tags, skill_names: skillNames }),
      error: defaultErrorHandler,
    }) as Promise<RegisteredSkillVersion[]>;
  },

  deleteRegisteredSkill: (skillName: string) => {
    return fetchEndpoint({
      relativeUrl: `ajax-api/3.0/mlflow/skills/${encodeURIComponent(skillName)}`,
      method: 'DELETE',
      error: defaultErrorHandler,
    });
  },

  deleteRegisteredSkillVersion: (skillName: string, version: number) => {
    return fetchEndpoint({
      relativeUrl: `ajax-api/3.0/mlflow/skills/${encodeURIComponent(skillName)}/versions/${version}`,
      method: 'DELETE',
      error: defaultErrorHandler,
    });
  },

  setSkillVersionTag: (skillName: string, version: number, key: string, value: string) => {
    return fetchEndpoint({
      relativeUrl: `ajax-api/3.0/mlflow/skills/${encodeURIComponent(skillName)}/versions/${version}/tags`,
      method: 'POST',
      body: JSON.stringify({ key, value }),
      error: defaultErrorHandler,
    });
  },

  getSkillVersionFiles: (skillName: string, version: number) => {
    const relativeUrl = `ajax-api/3.0/mlflow/skills/${encodeURIComponent(skillName)}/versions/${version}/files`;
    return fetchEndpoint({
      relativeUrl,
      error: defaultErrorHandler,
    }) as Promise<SkillVersionFile[]>;
  },

  setSkillAlias: (skillName: string, alias: string, version: number) => {
    return fetchEndpoint({
      relativeUrl: `ajax-api/3.0/mlflow/skills/${encodeURIComponent(skillName)}/aliases`,
      method: 'POST',
      body: JSON.stringify({ alias, version }),
      error: defaultErrorHandler,
    });
  },
};
