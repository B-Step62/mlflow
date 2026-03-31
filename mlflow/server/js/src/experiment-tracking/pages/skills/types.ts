export interface RegisteredSkill {
  name: string;
  description?: string;
  creation_timestamp?: number;
  last_updated_timestamp?: number;
  latest_version?: number;
  aliases?: { alias: string; version: number }[];
  source?: string;
  tags?: Record<string, string>;
  created_by?: string;
}

export interface RegisteredSkillVersion {
  name: string;
  version: number;
  source?: string;
  description?: string;
  manifest_content?: string;
  artifact_location?: string;
  creation_timestamp?: number;
  tags?: Record<string, string>;
  aliases?: string[];
  created_by?: string;
}

export interface RegisteredSkillsListResponse {
  skills: RegisteredSkill[];
}

export interface RegisteredSkillDetailsResponse {
  skill: RegisteredSkill;
  versions: RegisteredSkillVersion[];
}
