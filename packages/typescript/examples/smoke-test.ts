#!/usr/bin/env npx tsx

/**
 * Simple integration test script for MLflow Tracing TypeScript SDK
 *
 * This script tests basic functionality with a real Databricks backend:
 * 1. Configuration and authentication
 * 2. Simple span creation and tracing
 * 3. Feedback logging and assessment API
 * 4. Verify backend connectivity
 *
 * Prerequisites:
 * - Valid Databricks workspace with MLflow
 * - ~/.databrickscfg file with credentials
 * - Experiment ID that exists in your workspace
 *
 * Usage:
 *   npm run build
 *   npx tsx examples/simple-test.ts
 *
 * Or set environment variables:
 *   DATABRICKS_HOST=https://your-workspace.databricks.com \
 *   DATABRICKS_TOKEN=your-token \
 *   EXPERIMENT_ID=your-experiment-id \
 *   npx tsx examples/simple-test.ts
 */

import { init, withSpan, startSpan, logFeedback, Feedback, AssessmentSource, AssessmentSourceType } from '../src/core';
import { getConfig } from '../src/core/config';
import { MlflowClient } from '../src/client';
import { SpanType } from '../src/core/constants';
import { convertHrTimeToNanoSeconds } from '../src/core/utils';
import { flushTraces } from '../src/core/api';

// Alert if tracking URI or experiment ID is not set
if (!process.env.MLFLOW_TRACKING_URI || !process.env.MLFLOW_EXPERIMENT_ID) {
  console.error(
    '❌ Please set the MLFLOW_TRACKING_URI and MLFLOW_EXPERIMENT_ID environment variables'
  );
  process.exit(1);
}

const TEST_CONFIG = {
  tracking_uri: process.env.MLFLOW_TRACKING_URI,
  experiment_id: process.env.MLFLOW_EXPERIMENT_ID
};

init(TEST_CONFIG);

// Simple assertion helper functions for testing
function assertEqual<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${expected}, got ${actual}`);
  }
}

function assertGreaterThan(actual: number, expected: number, message: string): void {
  if (actual <= expected) {
    throw new Error(`${message}: expected > ${expected}, got ${actual}`);
  }
}

function assertArrayLength<T>(array: T[], expectedLength: number, message: string): void {
  if (array.length !== expectedLength) {
    throw new Error(`${message}: expected length ${expectedLength}, got ${array.length}`);
  }
}

function assertNotNull<T>(value: T | null | undefined, message: string): asserts value is T {
  if (value === null || value === undefined) {
    throw new Error(`${message}: expected non-null value, got ${value}`);
  }
}

function assertDeepEqual(actual: any, expected: any, message: string): void {
  const actualStr = JSON.stringify(actual);
  const expectedStr = JSON.stringify(expected);
  if (actualStr !== expectedStr) {
    throw new Error(`${message}: expected ${expectedStr}, got ${actualStr}`);
  }
}

function assertTimestampValid(timestamp: bigint | null, message: string): void {
  assertNotNull(timestamp, `${message} (timestamp should not be null)`);
  const now = Date.now() * 1000000; // Convert to nanoseconds
  const oneHourAgo = now - 60 * 60 * 1000 * 1000000; // 1 hour ago in nanoseconds

  if (timestamp < oneHourAgo || timestamp > now) {
    throw new Error(`${message}: timestamp ${timestamp} is not within reasonable range`);
  }
}

function assertContainsKeys(obj: any, expectedKeys: string[], message: string): void {
  if (!obj) {
    throw new Error(`${message}: object is null or undefined`);
  }

  for (const key of expectedKeys) {
    if (!(key in obj)) {
      throw new Error(`${message}: missing expected key '${key}'`);
    }
  }
}

// Comprehensive validation functions
function validateTraceInfo(traceInfo: any, expectedTraceId: string, testName: string): void {
  console.log(`🔍 Validating trace info for ${testName}...`);

  // Basic trace info validation
  assertEqual(traceInfo.traceId, expectedTraceId, `${testName} trace ID`);
  assertNotNull(traceInfo.requestTime, `${testName} request time`);
  assertNotNull(traceInfo.executionDuration, `${testName} execution duration`);
  assertNotNull(traceInfo.state, `${testName} trace state`);

  // Validate timestamps are reasonable
  const requestTimeMs = traceInfo.requestTime;
  const now = Date.now();
  const oneHourAgo = now - 60 * 60 * 1000; // 1 hour ago

  if (requestTimeMs < oneHourAgo || requestTimeMs > now) {
    throw new Error(`${testName} request time ${requestTimeMs} is not within reasonable range`);
  }

  // Validate execution duration is positive
  assertGreaterThan(
    traceInfo.executionDuration,
    0,
    `${testName} execution duration should be positive`
  );

  console.log(`✅ Trace info validation passed for ${testName}`);
}

function validateSpanDetails(
  span: any,
  expected: {
    name: string;
    spanType?: string;
    inputs?: any;
    outputs?: any;
    attributes?: any;
    hasEvents?: boolean;
  },
  testName: string
): void {
  console.log(`🔍 Validating span details for ${testName}...`);

  // 1. Basic span properties
  assertEqual(span.name, expected.name, `${testName} span name`);
  assertNotNull(span.spanId, `${testName} span ID`);

  // 2. Timestamps validation
  const startTimeNs = convertHrTimeToNanoSeconds(span.startTime);
  const endTimeNs = span.endTime ? convertHrTimeToNanoSeconds(span.endTime) : null;

  assertTimestampValid(startTimeNs, `${testName} start time`);
  assertTimestampValid(endTimeNs, `${testName} end time`);

  // Validate end time is after start time
  if (endTimeNs && endTimeNs <= startTimeNs) {
    throw new Error(`${testName}: end time ${endTimeNs} should be after start time ${startTimeNs}`);
  }

  // 3. Inputs validation
  if (expected.inputs) {
    assertNotNull(span.inputs, `${testName} span inputs`);
    assertDeepEqual(span.inputs, expected.inputs, `${testName} span inputs content`);
  }

  // 4. Outputs validation
  if (expected.outputs) {
    assertNotNull(span.outputs, `${testName} span outputs`);
    assertDeepEqual(span.outputs, expected.outputs, `${testName} span outputs content`);
  }

  // 5. Status validation
  assertNotNull(span.status, `${testName} span status`);
  if (span.status.statusCode) {
    // Should be OK for successful spans
    assertEqual(span.status.statusCode, 'STATUS_CODE_OK', `${testName} span status code`);
  }

  // 6. Attributes validation
  if (expected.attributes) {
    assertNotNull(span.attributes, `${testName} span attributes`);
    const expectedKeys = Object.keys(expected.attributes);
    assertContainsKeys(span.attributes, expectedKeys, `${testName} span attributes keys`);

    // Validate specific attribute values
    for (const [key, expectedValue] of Object.entries(expected.attributes)) {
      assertEqual(span.attributes[key], expectedValue, `${testName} attribute '${key}'`);
    }
  }

  // 7. Events validation
  assertNotNull(span.events, `${testName} span events array`);
  if (expected.hasEvents) {
    assertGreaterThan(span.events.length, 0, `${testName} should have events`);
  }

  // 8. Span type validation (if provided)
  if (expected.spanType) {
    assertEqual(span.spanType, expected.spanType, `${testName} span type`);
  }

  console.log(`✅ Span details validation passed for ${testName}`);
}

async function testWithSpanCreation() {
  console.log('📊 Testing withSpan creation and retrieval...');

  try {
    let createdTraceId: string | null = null;

    // Test: withSpan with automatic lifecycle
    const result = await withSpan(
      {
        name: 'test-calculation',
        span_type: SpanType.LLM,
        inputs: { operation: 'addition', a: 5, b: 3 }
      },
      async (span) => {
        // Capture trace ID for later retrieval
        createdTraceId = span.traceId;
        console.log(`📝 Created trace ID: ${createdTraceId}`);

        // Simulate some work
        await new Promise((resolve) => setTimeout(resolve, 100));

        const result = 5 + 3;
        span.setOutputs({ result });
        span.setAttribute('calculation_type', 'arithmetic');

        return result;
      }
    );

    console.log('✅ withSpan test completed, result:', result);

    // Wait for trace to be exported to backend
    console.log('⏳ Waiting for trace to be exported to backend...');
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Retrieve and validate trace from backend
    const config = getConfig();
    const client = new MlflowClient({ config });

    console.log(`🔍 Retrieving trace ${createdTraceId} from backend...`);
    const retrievedTrace = await client.getTrace(createdTraceId!);
    console.log(`✅ Retrieved trace with ${retrievedTrace.data.spans.length} spans`);

    // Comprehensive validation
    validateTraceInfo(retrievedTrace.info, createdTraceId!, 'WithSpan');
    assertGreaterThan(retrievedTrace.data.spans.length, 0, 'WithSpan trace should have spans');

    // Validate the main span details
    const mainSpan = retrievedTrace.data.spans[0];
    validateSpanDetails(
      mainSpan,
      {
        name: 'test-calculation',
        spanType: SpanType.LLM,
        inputs: { operation: 'addition', a: 5, b: 3 },
        outputs: { result: 8 },
        attributes: { calculation_type: 'arithmetic' },
        hasEvents: false
      },
      'WithSpan main span'
    );

    console.log(`✅ WithSpan comprehensive validation passed`);

    return true;
  } catch (error) {
    console.error('❌ WithSpan creation and retrieval failed:', error);
    return false;
  }
}

async function testManualSpanCreation() {
  console.log('📊 Testing manual span creation and retrieval...');

  try {
    // Test: Manual span with startSpan
    const span = startSpan({
      name: 'test-manual-span',
      span_type: SpanType.CHAIN,
      inputs: { message: 'Hello, MLflow!' }
    });

    let manualTraceId: string | null = null;

    try {
      // Capture trace ID for manual span
      manualTraceId = span.traceId;
      console.log(`📝 Created manual trace ID: ${manualTraceId}`);

      // Simulate some processing
      await new Promise((resolve) => setTimeout(resolve, 50));

      span.setOutputs({ processed_message: 'Hello, MLflow! [PROCESSED]' });
      span.setAttribute('processing_time_ms', 50);

      console.log('✅ Manual span test completed');
    } finally {
      span.end();

      // Wait for trace to be exported to backend
      console.log('⏳ Waiting for trace to be exported to backend...');
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }

    // Retrieve and validate trace from backend
    const config = getConfig();
    const client = new MlflowClient({ config });

    console.log(`🔍 Retrieving trace ${manualTraceId} from backend...`);
    const retrievedTrace = await client.getTrace(manualTraceId);
    console.log(`✅ Retrieved trace with ${retrievedTrace.data.spans.length} spans`);

    // Comprehensive validation
    validateTraceInfo(retrievedTrace.info, manualTraceId, 'Manual Span');
    assertGreaterThan(retrievedTrace.data.spans.length, 0, 'Manual trace should have spans');

    // Validate the main span details
    const mainSpan = retrievedTrace.data.spans[0];
    validateSpanDetails(
      mainSpan,
      {
        name: 'test-manual-span',
        spanType: SpanType.CHAIN,
        inputs: { message: 'Hello, MLflow!' },
        outputs: { processed_message: 'Hello, MLflow! [PROCESSED]' },
        attributes: { processing_time_ms: 50 },
        hasEvents: false
      },
      'Manual main span'
    );

    console.log(`✅ Manual span comprehensive validation passed`);

    return true;
  } catch (error) {
    console.error('❌ Manual span creation and retrieval failed:', error);
    return false;
  }
}

async function testNestedSpans() {
  console.log('🔗 Testing nested spans and retrieval...');

  try {
    let parentTraceId: string | null = null;

    const result = await withSpan(
      {
        name: 'parent-operation',
        span_type: SpanType.CHAIN,
        inputs: { task: 'process_data' }
      },
      async (parentSpan) => {
        // Capture trace ID for later validation
        parentTraceId = parentSpan.traceId;
        console.log(`📝 Created nested trace ID: ${parentTraceId}`);

        // Child span 1
        const step1Result = await withSpan(
          {
            name: 'data-validation',
            span_type: SpanType.TOOL,
            inputs: { data: ['item1', 'item2', 'item3'] }
          },
          async (childSpan) => {
            await new Promise((resolve) => setTimeout(resolve, 30));
            childSpan.setOutputs({ valid: true, item_count: 3 });
            return { valid: true, items: 3 };
          }
        );

        // Child span 2
        const step2Result = await withSpan(
          {
            name: 'data-processing',
            span_type: SpanType.LLM,
            inputs: { validated_data: step1Result }
          },
          async (childSpan) => {
            await new Promise((resolve) => setTimeout(resolve, 80));
            const processed = { processed_items: step1Result.items * 2 };
            childSpan.setOutputs(processed);
            return processed;
          }
        );

        parentSpan.setOutputs({
          validation_result: step1Result,
          processing_result: step2Result,
          total_time_ms: 110
        });

        return {
          success: true,
          processed_count: step2Result.processed_items
        };
      }
    );

    console.log('✅ Nested spans test completed, result:', result);

    // Wait for trace to be exported
    console.log('⏳ Waiting for nested trace to be exported to backend...');
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Validate nested trace structure
    if (parentTraceId) {
      console.log(`🔍 Retrieving nested trace ${parentTraceId} from backend...`);
      const config = getConfig();
      const client = new MlflowClient({ config });

      const retrievedTrace = await client.getTrace(parentTraceId);
      console.log(`✅ Retrieved nested trace with ${retrievedTrace.data.spans.length} spans`);

      // Basic validation - should have 3 spans (parent + 2 children)
      assertArrayLength(retrievedTrace.data.spans, 3, 'Nested trace span count');

      // Should have one parent span (no parentId) and two child spans
      const parentSpans = retrievedTrace.data.spans.filter((s) => !s.parentId);
      const childSpans = retrievedTrace.data.spans.filter((s) => s.parentId);

      assertArrayLength(parentSpans, 1, 'Parent spans count');
      assertArrayLength(childSpans, 2, 'Child spans count');

      console.log(`✅ Nested trace structure validation passed`);
    }

    return true;
  } catch (error) {
    console.error('❌ Nested spans test failed:', error);
    return false;
  }
}

async function testErrorHandling() {
  console.log('⚠️ Testing error handling...');

  try {
    await withSpan(
      {
        name: 'error-test-span',
        span_type: SpanType.TOOL,
        inputs: { will_fail: true }
      },
      async (span) => {
        await new Promise((resolve) => setTimeout(resolve, 25));

        // Simulate an error
        span.setAttribute('error_simulation', true);
        throw new Error('Simulated error for testing');
      }
    );

    console.log('❌ Error handling test failed - exception should have been thrown');
    return false;
  } catch (error) {
    if (error instanceof Error && error.message === 'Simulated error for testing') {
      console.log(
        '✅ Error handling test completed - exception properly caught and span should be marked as ERROR'
      );
      return true;
    } else {
      console.error('❌ Unexpected error in error handling test:', error);
      return false;
    }
  }
}

async function testLogFeedback() {
  console.log('📝 Testing logFeedback functionality...');

  try {
    let traceId: string | null = null;

    // First, create a trace with a span
    const result = await withSpan(
      {
        name: 'feedback-test-span',
        span_type: SpanType.LLM,
        inputs: { question: 'What is the capital of France?', model: 'gpt-4' }
      },
      async (span) => {
        traceId = span.traceId;
        console.log(`📝 Created trace ID for feedback test: ${traceId}`);

        // Simulate LLM processing
        await new Promise((resolve) => setTimeout(resolve, 100));

        const answer = 'The capital of France is Paris.';
        span.setOutputs({ answer });
        span.setAttribute('model_used', 'gpt-4');
        span.setAttribute('confidence', 0.95);

        return answer;
      }
    );

    console.log('✅ Created span for feedback testing, result:', result);

    // Wait for trace to be exported
    console.log('⏳ Flushing traces...');
    await flushTraces();

    // Test 1: Log human feedback
    console.log('📝 Logging human feedback...');
    const humanFeedback = new Feedback({
      name: 'correctness',
      value: 5,
      source: new AssessmentSource({
        source_type: AssessmentSourceType.HUMAN,
        source_id: 'user_123'
      }),
      rationale: 'The answer is factually correct and well-formatted.',
      metadata: { reviewer: 'john.doe', review_time: '2024-01-15T10:30:00Z' }
    });

    const loggedHumanFeedback = await logFeedback(traceId!, humanFeedback);
    console.log('✅ Human feedback logged successfully:', loggedHumanFeedback.name);

    // Test 2: Log LLM judge feedback
    console.log('📝 Logging LLM judge feedback...');
    const llmJudgeFeedback = new Feedback({
      name: 'helpfulness',
      value: 4.2,
      source: new AssessmentSource({
        source_type: AssessmentSourceType.LLM_JUDGE,
        source_id: 'judge_model_v1'
      }),
      rationale: 'Answer directly addresses the question with accurate information.',
      metadata: { judge_model: 'gpt-4-judge', evaluation_prompt: 'helpfulness_v2' }
    });

    const loggedLlmFeedback = await logFeedback(traceId!, llmJudgeFeedback);
    console.log('✅ LLM judge feedback logged successfully:', loggedLlmFeedback.name);

    // Validate that all feedbacks have assessment IDs (backend-generated)
    if (!loggedHumanFeedback.assessment_id) {
      throw new Error('Human feedback should have assessment_id from backend');
    }
    if (!loggedLlmFeedback.assessment_id) {
      throw new Error('LLM feedback should have assessment_id from backend');
    }

    console.log('✅ All feedback tests completed successfully');
    console.log(`   - Human feedback ID: ${loggedHumanFeedback.assessment_id}`);
    console.log(`   - LLM judge feedback ID: ${loggedLlmFeedback.assessment_id}`);

    return true;
  } catch (error) {
    console.error('❌ LogFeedback test failed:', error);
    return false;
  }
}

async function main() {
  console.log('🚀 Starting MLflow Tracing TypeScript SDK Integration Test\n');

  // Display configuration
  console.log('📋 Configuration:');
  console.log(`   Tracking URI: ${getConfig().tracking_uri}`);
  console.log(`   Experiment ID: ${getConfig().experiment_id}`);

  const tests = [
    // { name: 'WithSpan Creation & Retrieval', fn: testWithSpanCreation },
    // { name: 'Manual Span Creation & Retrieval', fn: testManualSpanCreation },
    // { name: 'Nested Spans & Retrieval', fn: testNestedSpans },
    // { name: 'Error Handling', fn: testErrorHandling },
    { name: 'LogFeedback Functionality', fn: testLogFeedback }
  ];

  let passed = 0;
  let failed = 0;

  for (const test of tests) {
    console.log(`\n--- ${test.name} ---`);

    try {
      const success = await test.fn();
      if (success) {
        passed++;
      } else {
        failed++;
      }
    } catch (error) {
      console.error(`❌ Test "${test.name}" threw unexpected error:`, error);
      failed++;
    }

    // Wait a bit between tests to avoid rate limiting
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  console.log('\n' + '='.repeat(50));
  console.log('📊 TEST SUMMARY');
  console.log('='.repeat(50));
  console.log(`✅ Passed: ${passed}`);
  console.log(`❌ Failed: ${failed}`);
  console.log(`📈 Success Rate: ${Math.round((passed / (passed + failed)) * 100)}%`);

  if (failed === 0) {
    console.log(
      '\n🎉 All tests passed! Your MLflow Tracing TypeScript SDK is working correctly with Databricks backend.'
    );
  } else {
    console.log('\n⚠️  Some tests failed. Please check the error messages above.');
    console.log('\n🔍 Common issues:');
    console.log('   - Invalid experiment ID (check your Databricks workspace)');
    console.log('   - Missing or invalid ~/.databrickscfg credentials');
    console.log('   - Network connectivity issues');
    console.log('   - MLflow not enabled in your Databricks workspace');
  }

  console.log('\n💡 To view traces:');
  console.log(`   1. Go to your Databricks workspace`);
  console.log(`   2. Navigate to MLflow → Experiments → Experiment ${getConfig().experiment_id}`);
  console.log(`   3. Look for traces from this test run`);

  process.exit(failed === 0 ? 0 : 1);
}

// Handle uncaught errors gracefully
process.on('unhandledRejection', (error) => {
  console.error('\n❌ Unhandled promise rejection:', error);
  process.exit(1);
});

process.on('uncaughtException', (error) => {
  console.error('\n❌ Uncaught exception:', error);
  process.exit(1);
});

// Run the test
main().catch((error) => {
  console.error('\n❌ Test script failed:', error);
  process.exit(1);
});
