import { Feedback } from '../../../src/core/entities/feedback';
import { AssessmentSource, AssessmentSourceType } from '../../../src/core/entities/assessment_source';
import { AssessmentError } from '../../../src/core/entities/assessment_error';

describe('Feedback', () => {
  describe('constructor', () => {
    it('should create feedback with value', () => {
      const feedback = new Feedback({
        name: 'correctness',
        value: 0.9,
        source: new AssessmentSource({
          source_type: AssessmentSourceType.LLM_JUDGE,
          source_id: 'gpt-4'
        })
      });

      expect(feedback.name).toBe('correctness');
      expect(feedback.value).toBe(0.9);
      expect(feedback.source.source_type).toBe(AssessmentSourceType.LLM_JUDGE);
      expect(feedback.source.source_id).toBe('gpt-4');
      expect(feedback.create_time_ms).toBeDefined();
      expect(feedback.last_update_time_ms).toBeDefined();
    });

    it('should use default name and source when not provided', () => {
      const feedback = new Feedback({
        value: true
      });

      expect(feedback.name).toBe('feedback');
      expect(feedback.source.source_type).toBe(AssessmentSourceType.CODE);
      expect(feedback.source.source_id).toBe('default');
    });

    it('should handle Error objects', () => {
      const error = new Error('Test error');
      const feedback = new Feedback({
        name: 'evaluation',
        error: error
      });

      expect(feedback.error).toBeDefined();
      expect(feedback.error!.error_code).toBe('Error');
      expect(feedback.error!.error_message).toBe('Test error');
      expect(feedback.error!.stack_trace).toBeDefined();
    });

    it('should handle AssessmentError objects', () => {
      const error = new AssessmentError({
        error_code: 'TIMEOUT',
        error_message: 'Request timed out',
        stack_trace: 'stack trace here'
      });

      const feedback = new Feedback({
        name: 'evaluation',
        error: error
      });

      expect(feedback.error).toBe(error);
      expect(feedback.error!.error_code).toBe('TIMEOUT');
    });

    it('should throw error when neither value nor error is provided', () => {
      expect(() => {
        new Feedback({
          name: 'invalid'
        });
      }).toThrow('Either value or error must be provided');
    });

    it('should accept various value types', () => {
      // String value
      const feedback1 = new Feedback({ value: 'positive' });
      expect(feedback1.value).toBe('positive');

      // Boolean value
      const feedback2 = new Feedback({ value: false });
      expect(feedback2.value).toBe(false);

      // Array value
      const feedback3 = new Feedback({ value: ['cat1', 'cat2'] });
      expect(feedback3.value).toEqual(['cat1', 'cat2']);

      // Object value
      const feedback4 = new Feedback({
        value: { accuracy: 0.9, relevance: 0.8 }
      });
      expect(feedback4.value).toEqual({ accuracy: 0.9, relevance: 0.8 });
    });
  });

  describe('toJson', () => {
    it('should serialize feedback to JSON format', () => {
      const feedback = new Feedback({
        name: 'correctness',
        value: 0.95,
        trace_id: 'trace-123',
        span_id: 'span-456',
        rationale: 'The answer is correct',
        metadata: { model: 'gpt-4' }
      });

      const json = feedback.toJson();

      expect(json.assessment_name).toBe('correctness');
      expect(json.feedback.value).toBe(0.95);
      expect(json.trace_id).toBe('trace-123');
      expect(json.span_id).toBe('span-456');
      expect(json.rationale).toBe('The answer is correct');
      expect(json.metadata).toEqual({ model: 'gpt-4' });
      expect(json.source).toEqual({
        source_type: AssessmentSourceType.CODE,
        source_id: 'default'
      });
      expect(json.create_time).toBeDefined();
      expect(json.last_update_time).toBeDefined();
    });

    it('should include error in feedback JSON when present', () => {
      const error = new AssessmentError({
        error_code: 'RATE_LIMIT',
        error_message: 'Rate limit exceeded'
      });

      const feedback = new Feedback({
        name: 'evaluation',
        error: error
      });

      const json = feedback.toJson();

      expect(json.feedback.error).toEqual({
        error_code: 'RATE_LIMIT',
        error_message: 'Rate limit exceeded'
      });
    });
  });

  describe('fromJson', () => {
    it('should deserialize feedback from JSON', () => {
      const json = {
        assessment_name: 'helpfulness',
        feedback: {
          value: true
        },
        source: {
          source_type: AssessmentSourceType.HUMAN,
          source_id: 'user@example.com'
        },
        trace_id: 'trace-789',
        span_id: 'span-012',
        rationale: 'Very helpful response',
        metadata: { session: 'abc123' },
        assessment_id: 'assessment-001',
        create_time: '2024-01-01T00:00:00.000Z',
        last_update_time: '2024-01-01T00:00:00.000Z'
      };

      const feedback = Feedback.fromJson(json);

      expect(feedback.name).toBe('helpfulness');
      expect(feedback.value).toBe(true);
      expect(feedback.source.source_type).toBe(AssessmentSourceType.HUMAN);
      expect(feedback.source.source_id).toBe('user@example.com');
      expect(feedback.trace_id).toBe('trace-789');
      expect(feedback.span_id).toBe('span-012');
      expect(feedback.rationale).toBe('Very helpful response');
      expect(feedback.metadata).toEqual({ session: 'abc123' });
      expect(feedback.assessment_id).toBe('assessment-001');
      expect(feedback.create_time_ms).toBeDefined();
      expect(feedback.last_update_time_ms).toBeDefined();
    });

    it('should handle error in JSON', () => {
      const json = {
        assessment_id: 'assessment-001',
        assessment_name: 'sentiment',
        trace_id: 'trace-789',
        feedback: {
          error: {
            error_code: 'API_ERROR',
            error_message: 'External API failed',
            stack_trace: 'stack...'
          }
        },
        source: {
          source_type: AssessmentSourceType.CODE,
          source_id: 'sentiment_api'
        },
        create_time: '2024-01-01T00:00:00.000Z',
        last_update_time: '2024-01-01T00:00:00.000Z'
      };

      const feedback = Feedback.fromJson(json);

      expect(feedback.error).toBeDefined();
      expect(feedback.error!.error_code).toBe('API_ERROR');
      expect(feedback.error!.error_message).toBe('External API failed');
      expect(feedback.error!.stack_trace).toBe('stack...');
    });
  });

  describe('round-trip serialization', () => {
    it('should preserve all data through toJson/fromJson', () => {
      const original = new Feedback({
        name: 'test_feedback',
        value: { score: 0.85, tags: ['good', 'accurate'] },
        source: new AssessmentSource({
          source_type: AssessmentSourceType.LLM_JUDGE,
          source_id: 'claude-3'
        }),
        trace_id: 'trace-test',
        span_id: 'span-test',
        rationale: 'Test rationale',
        metadata: { version: '1.0' }
      });

      // Add backend-generated fields
      original.assessment_id = 'test-assessment-id';

      const json = original.toJson();
      const restored = Feedback.fromJson(json);

      expect(restored.name).toBe(original.name);
      expect(restored.value).toEqual(original.value);
      expect(restored.source.source_type).toBe(original.source.source_type);
      expect(restored.source.source_id).toBe(original.source.source_id);
      expect(restored.trace_id).toBe(original.trace_id);
      expect(restored.span_id).toBe(original.span_id);
      expect(restored.rationale).toBe(original.rationale);
      expect(restored.metadata).toEqual(original.metadata);
      expect(restored.assessment_id).toBe(original.assessment_id);
    });
  });
});

describe('AssessmentSource', () => {
  it('should create source with type and id', () => {
    const source = new AssessmentSource({
      source_type: AssessmentSourceType.HUMAN,
      source_id: 'reviewer@example.com'
    });

    expect(source.source_type).toBe(AssessmentSourceType.HUMAN);
    expect(source.source_id).toBe('reviewer@example.com');
  });

  it('should use default source_id when not provided', () => {
    const source = new AssessmentSource({
      source_type: AssessmentSourceType.CODE
    });

    expect(source.source_id).toBe('default');
  });

  it('should serialize and deserialize correctly', () => {
    const original = new AssessmentSource({
      source_type: AssessmentSourceType.LLM_JUDGE,
      source_id: 'gpt-4-turbo'
    });

    const json = original.toJson();
    const restored = AssessmentSource.fromJson(json);

    expect(restored.source_type).toBe(original.source_type);
    expect(restored.source_id).toBe(original.source_id);
  });
});

describe('AssessmentError', () => {
  it('should create error with all fields', () => {
    const error = new AssessmentError({
      error_code: 'VALIDATION_ERROR',
      error_message: 'Invalid input format',
      stack_trace: 'Error at line 42...'
    });

    expect(error.error_code).toBe('VALIDATION_ERROR');
    expect(error.error_message).toBe('Invalid input format');
    expect(error.stack_trace).toBe('Error at line 42...');
  });

  it('should create from JavaScript Error', () => {
    const jsError = new Error('Something went wrong');
    jsError.name = 'CustomError';

    const assessmentError = AssessmentError.fromError(jsError);

    expect(assessmentError.error_code).toBe('CustomError');
    expect(assessmentError.error_message).toBe('Something went wrong');
    expect(assessmentError.stack_trace).toBeDefined();
  });

  it('should truncate long stack traces', () => {
    const longStackTrace = 'A'.repeat(2000);
    const error = new AssessmentError({
      error_code: 'ERROR',
      stack_trace: longStackTrace
    });

    const json = error.toJson();

    expect(json.stack_trace!.length).toBe(1000);
    expect(json.stack_trace!.startsWith('[Stack trace is truncated]')).toBe(true);
  });

  it('should serialize and deserialize correctly', () => {
    const original = new AssessmentError({
      error_code: 'TIMEOUT',
      error_message: 'Operation timed out',
      stack_trace: 'Stack trace here'
    });

    const json = original.toJson();
    const restored = AssessmentError.fromJson(json);

    expect(restored.error_code).toBe(original.error_code);
    expect(restored.error_message).toBe(original.error_message);
    expect(restored.stack_trace).toBe(original.stack_trace);
  });
});