import { AssessmentSource, AssessmentSourceType, SerializedAssessmentSource } from './assessment_source';
import { AssessmentError, SerializedAssessmentError } from './assessment_error';

/**
 * Feedback value types - matching Python's flexible value types
 */
export type PrimitiveValue = string | number | boolean;
export type FeedbackValueType =
  | PrimitiveValue
  | PrimitiveValue[];



/**
 * Serialized format for Feedback data in JSON
 */
export interface SerializedFeedbackValue {
  value?: FeedbackValueType;
  error?: SerializedAssessmentError;
}

/**
 * Serialized format for complete Feedback in JSON
 */
export interface SerializedAssessment {
  // This is not marked as required field via "validate_required", because the message
  // is used in the context of creating a new assessment, where the ID is not known.
  assessment_id?: string;
  assessment_name: string;
  trace_id: string;
  span_id?: string;
  source: SerializedAssessmentSource;
  // Timestamp format: "2025-06-15T14:07:41.282Z"
  create_time: string;
  last_update_time: string;
  // TODO: Make this optional when we support expectation assessment.
  feedback: SerializedFeedbackValue;
  rationale?: string;
  metadata?: Record<string, string>;
  overrides?: string;
  valid?: boolean;
}

/**
 * Represents feedback about the output of an operation.
 */
export class Feedback {
  name: string;
  value?: FeedbackValueType;
  error?: AssessmentError;
  source: AssessmentSource;
  trace_id?: string;
  span_id?: string;
  rationale?: string;
  metadata?: Record<string, string>;
  assessment_id?: string;
  create_time_ms?: number;
  last_update_time_ms?: number;
  overrides?: string;
  valid?: boolean;

  constructor(params: {
    name?: string;
    value?: FeedbackValueType;
    error?: AssessmentError | Error;
    source?: AssessmentSource;
    trace_id?: string;
    span_id?: string;
    rationale?: string;
    metadata?: Record<string, string>;
    overrides?: string;
    valid?: boolean;
  }) {
    // Validate that either value or error is provided
    if (params.value === undefined && params.error === undefined) {
      throw new Error('Either value or error must be provided');
    }

    this.name = params.name ?? 'feedback';
    this.value = params.value;

    // Handle error - convert Error to AssessmentError if needed
    if (params.error) {
      this.error = params.error instanceof AssessmentError
        ? params.error
        : AssessmentError.fromError(params.error);
    }

    // Default source to CODE if not provided
    this.source = params.source ?? new AssessmentSource({
      source_type: AssessmentSourceType.CODE,
      source_id: 'default'
    });

    this.trace_id = params.trace_id;
    this.span_id = params.span_id;
    this.rationale = params.rationale;
    this.metadata = params.metadata;

    // Set timestamps
    const currentTime = Date.now();
    this.create_time_ms = currentTime;
    this.last_update_time_ms = currentTime;
  }

  toJson(): SerializedAssessment {
    const feedbackData: SerializedFeedbackValue = {};

    if (this.value !== undefined) {
      feedbackData.value = this.value;
    }

    if (this.error) {
      feedbackData.error = this.error.toJson() as SerializedAssessmentError;
    }

    const json: SerializedAssessment = {
      assessment_id: this.assessment_id, // undefined when creating a new assessment.
      assessment_name: this.name,
      trace_id: this.trace_id!,  // trace ID must be set when sending to backend.
      span_id: this.span_id,
      source: this.source.toJson() as SerializedAssessmentSource,
      create_time: this.timestampToProto(this.create_time_ms ?? Date.now()),
      last_update_time: this.timestampToProto(this.last_update_time_ms ?? Date.now()),
      feedback: feedbackData,
      rationale: this.rationale,
      metadata: this.metadata,
      overrides: this.overrides,
      valid: this.valid
    };

    return json;
  }

  static fromJson(json: SerializedAssessment): Feedback {
    const feedback = new Feedback({
      name: json.assessment_name,
      value: json.feedback.value,
      error: json.feedback.error ? AssessmentError.fromJson(json.feedback.error) : undefined,
      source: AssessmentSource.fromJson(json.source),
      trace_id: json.trace_id,
      span_id: json.span_id,
      rationale: json.rationale,
      metadata: json.metadata
    });

    // Set backend-generated fields
    feedback.assessment_id = json.assessment_id;
    feedback.create_time_ms = feedback.protoToTimestamp(json.create_time);
    feedback.last_update_time_ms = feedback.protoToTimestamp(json.last_update_time);

    return feedback;
  }

  /**
   * Convert milliseconds timestamp to protobuf timestamp format
   */
  private timestampToProto(ms: number): string {
    return new Date(ms).toISOString();
  }

  /**
   * Convert protobuf timestamp to milliseconds
   */
  private protoToTimestamp(proto: string): number {
    return new Date(proto).getTime();
  }
}