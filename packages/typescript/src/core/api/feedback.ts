import { MlflowClient } from '../../client';
import { Feedback, FeedbackValueType } from '../entities/feedback';
import { AssessmentSource } from '../entities/assessment_source';
import { AssessmentError } from '../entities/assessment_error';

export interface LogFeedbackOptions {
  /**
   * The name of the feedback assessment e.g., "faithfulness".
   * Defaults to "feedback" if not provided.
   */
  name?: string;

  /**
   * The value of the feedback. Must be one of the following types:
   * - number
   * - string
   * - boolean
   * - array of primitive values
   * - object with string keys and primitive values
   */
  value?: FeedbackValueType;

  /**
   * The source of the feedback assessment.
   * If not provided, defaults to CODE source type.
   */
  source?: AssessmentSource;

  /**
   * An error object representing any issues encountered while computing the
   * feedback. Either this or `value` must be provided.
   */
  error?: Error | AssessmentError;

  /**
   * The rationale / justification for the feedback.
   */
  rationale?: string;

  /**
   * Additional metadata for the feedback.
   */
  metadata?: Record<string, string>;

  /**
   * The ID of the span associated with the feedback, if it needs to be
   * associated with a specific span in the trace.
   */
  span_id?: string;
}

/**
 * Logs feedback to a Trace.
 *
 * @param trace_id - The ID of the trace
 * @param options - The feedback options
 * @returns The created feedback with server-generated ID
 *
 * @example
 * ```typescript
 * import { logFeedback, AssessmentSource, AssessmentSourceType } from 'mlflow-tracing';
 *
 * // Log feedback from an LLM judge
 * const feedback = await logFeedback('trace-123', {
 *   name: 'faithfulness',
 *   value: 0.9,
 *   rationale: 'The model response is faithful to the input context.',
 *   source: new AssessmentSource({
 *     source_type: AssessmentSourceType.LLM_JUDGE,
 *     source_id: 'gpt-4'
 *   }),
 *   metadata: {
 *     model: 'gpt-4',
 *     temperature: '0.0'
 *   }
 * });
 *
 * // Log an error when feedback generation fails
 * const errorFeedback = await logFeedback('trace-123', {
 *   name: 'faithfulness',
 *   error: new Error('Rate limit exceeded'),
 *   source: new AssessmentSource({
 *     source_type: AssessmentSourceType.LLM_JUDGE,
 *     source_id: 'gpt-4'
 *   })
 * });
 * ```
 */
export async function logFeedback(
  trace_id: string,
  options: LogFeedbackOptions
): Promise<Feedback> {
  const feedback = new Feedback({
    ...options,
    trace_id
  });

  const client = new MlflowClient();
  return await client.logFeedback(trace_id, feedback);
}