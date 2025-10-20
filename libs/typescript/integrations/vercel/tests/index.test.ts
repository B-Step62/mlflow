/**
 * Tests for MLflow OpenAI integration with MSW mock server
 */

import * as mlflow from 'mlflow-tracing';
import { generateText } from "ai";
import { createOpenAI } from '@ai-sdk/openai';
import { setupServer } from 'msw/node';
import { openAIMockHandlers } from './mockOpenAIServer';

const TEST_TRACKING_URI = 'http://localhost:5000';

describe('vercel autologging integration', () => {
  let experimentId: string;
  let client: mlflow.MlflowClient;
  let server: ReturnType<typeof setupServer>;

  beforeAll(async () => {
    // Setup MSW mock server
    server = setupServer(...openAIMockHandlers);
    server.listen();

    // Setup MLflow client and experiment
    client = new mlflow.MlflowClient({ trackingUri: TEST_TRACKING_URI, host: TEST_TRACKING_URI });

    // Create a new experiment
    const experimentName = `test-experiment-${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;
    experimentId = await client.createExperiment(experimentName);
    mlflow.init({
      trackingUri: TEST_TRACKING_URI,
      experimentId: experimentId
    });
  });

  afterAll(async () => {
    server.close();
    await client.deleteExperiment(experimentId);
  });

  const getLastActiveTrace = async (): Promise<mlflow.Trace> => {
    await mlflow.flushTraces();
    const traceId = mlflow.getLastActiveTraceId();
    const trace = await client.getTrace(traceId!);
    return trace;
  };

  beforeEach(() => {
    // Reset MSW handlers for each test
    server.resetHandlers();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('generateText', () => {
    it('should trace ai.generatetext()', async () => {
      const openai = createOpenAI({ apiKey: 'test-key' });
      const result = await generateText({
        model: openai("gpt-4o-mini"),
        prompt: "What is mlflow?",
        experimental_telemetry: { isEnabled: true },
      });
      console.log(result.text);

      const trace = await getLastActiveTrace();
      expect(trace.info.state).toBe('OK');

      const tokenUsage = trace.info.tokenUsage;
      expect(tokenUsage).toBeDefined();
      expect(typeof tokenUsage?.input_tokens).toBe('number');
      expect(typeof tokenUsage?.output_tokens).toBe('number');
      expect(typeof tokenUsage?.total_tokens).toBe('number');

      const span = trace.data.spans[0];
      expect(span.name).toBe('Completions');
      expect(span.spanType).toBe(mlflow.SpanType.LLM);
      expect(span.status.statusCode).toBe(mlflow.SpanStatusCode.OK);
      expect(span.inputs).toEqual({
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Hello!' }]
      });
      expect(span.outputs).toEqual(result);
      expect(span.startTime).toBeDefined();
      expect(span.endTime).toBeDefined();

      // Check that token usage is stored at span level
      const spanTokenUsage = span.attributes[mlflow.SpanAttributeKey.TOKEN_USAGE];
      expect(spanTokenUsage).toBeDefined();
      expect(typeof spanTokenUsage[mlflow.TokenUsageKey.INPUT_TOKENS]).toBe('number');
      expect(typeof spanTokenUsage[mlflow.TokenUsageKey.OUTPUT_TOKENS]).toBe('number');
      expect(typeof spanTokenUsage[mlflow.TokenUsageKey.TOTAL_TOKENS]).toBe('number');
    });

    it('should handle chat completion errors properly', async () => {

    });

    it('should trace request wrapped in a parent span', async () => {
    });
  });
});
