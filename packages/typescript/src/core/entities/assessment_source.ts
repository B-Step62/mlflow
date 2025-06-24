/**
 * Source of an assessment (human, LLM judge, code-based).
 */
export class AssessmentSource {
  source_type: AssessmentSourceType;
  source_id: string;

  constructor(params: {
    source_type: AssessmentSourceType;
    source_id?: string;
  }) {
    this.source_type = params.source_type;
    this.source_id = params.source_id ?? 'default';
  }

  toJson(): SerializedAssessmentSource {
    return {
      source_type: this.source_type,
      source_id: this.source_id
    };
  }

  static fromJson(json: SerializedAssessmentSource): AssessmentSource {
    return new AssessmentSource({
      source_type: json.source_type as AssessmentSourceType,
      source_id: json.source_id
    });
  }
}

/**
 * Serialized format for AssessmentSource in JSON
 */
export interface SerializedAssessmentSource {
  source_type: string;
  source_id: string;
}

/**
 * Type of assessment source
 */
export enum AssessmentSourceType {
  HUMAN = 'HUMAN',
  LLM_JUDGE = 'LLM_JUDGE',
  CODE = 'CODE',
}