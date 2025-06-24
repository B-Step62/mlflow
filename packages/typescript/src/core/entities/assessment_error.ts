/**
 * Error object representing any issues during generating the assessment.
 */
export class AssessmentError {
  error_code: string;
  error_message?: string;
  stack_trace?: string;

  private static readonly STACK_TRACE_TRUNCATION_PREFIX = '[Stack trace is truncated]\n...\n';
  private static readonly STACK_TRACE_TRUNCATION_LENGTH = 1000;

  constructor(params: {
    error_code: string;
    error_message?: string;
    stack_trace?: string;
  }) {
    this.error_code = params.error_code;
    this.error_message = params.error_message;
    this.stack_trace = params.stack_trace;
  }

  /**
   * Create AssessmentError from a JavaScript Error object
   */
  static fromError(error: Error): AssessmentError {
    return new AssessmentError({
      error_code: error.name || 'Error',
      error_message: error.message,
      stack_trace: error.stack
    });
  }

  toJson(): { error_code: string; error_message?: string; stack_trace?: string } {
    const json: { error_code: string; error_message?: string; stack_trace?: string } = {
      error_code: this.error_code
    };

    if (this.error_message) {
      json.error_message = this.error_message;
    }

    if (this.stack_trace) {
      // Truncate stack trace if too long
      if (this.stack_trace.length > AssessmentError.STACK_TRACE_TRUNCATION_LENGTH) {
        const truncLen = AssessmentError.STACK_TRACE_TRUNCATION_LENGTH -
                         AssessmentError.STACK_TRACE_TRUNCATION_PREFIX.length;
        json.stack_trace = AssessmentError.STACK_TRACE_TRUNCATION_PREFIX +
                          this.stack_trace.slice(-truncLen);
      } else {
        json.stack_trace = this.stack_trace;
      }
    }

    return json;
  }

  static fromJson(json: Record<string, any>): AssessmentError {
    return new AssessmentError({
      error_code: json.error_code as string,
      error_message: json.error_message as string | undefined,
      stack_trace: json.stack_trace as string | undefined
    });
  }
}

/**
 * Serialized format for AssessmentError in JSON
 */
export interface SerializedAssessmentError {
  error_code: string;
  error_message?: string;
  stack_trace?: string;
}
