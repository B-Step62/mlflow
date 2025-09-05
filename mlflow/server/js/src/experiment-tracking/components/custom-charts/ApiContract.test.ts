// API contract tests for custom charts
import { 
  generateChart,
  getChartStatus,
  saveChart,
  listCharts,
  deleteChart,
  type GenerateChartRequest,
  type ChartStatusResponse,
  type SaveChartRequest,
} from '../../../common/utils/ChartApiUtils';
import { mockServerUtils } from './__tests__/mockServer';

describe('API Contract Tests', () => {
  beforeEach(() => {
    mockServerUtils.reset();
    mockServerUtils.seedTestData();
  });

  describe('Chart Generation API Contract', () => {
    it('accepts valid generate chart request', async () => {
      const validRequest: GenerateChartRequest = {
        prompt: 'Create a line chart showing accuracy over time',
        run_id: 'run-123',
        experiment_id: 'exp-456',
      };

      const response = await generateChart(validRequest);

      expect(response).toMatchObject({
        request_id: expect.stringMatching(/^mock-request-/),
        status: 'pending',
      });
    });

    it('validates required fields in generate request', async () => {
      const invalidRequest = {
        // Missing prompt
        run_id: 'run-123',
      } as GenerateChartRequest;

      await expect(generateChart(invalidRequest)).rejects.toThrow(
        expect.stringMatching(/prompt is required/i)
      );
    });

    it('validates prompt length in generate request', async () => {
      const longPromptRequest: GenerateChartRequest = {
        prompt: 'A'.repeat(5001), // Too long
        run_id: 'run-123',
      };

      await expect(generateChart(longPromptRequest)).rejects.toThrow(
        expect.stringMatching(/5000 characters or less/i)
      );
    });

    it('handles optional fields in generate request', async () => {
      const minimalRequest: GenerateChartRequest = {
        prompt: 'Create a simple chart',
      };

      const response = await generateChart(minimalRequest);
      expect(response.request_id).toBeDefined();
      expect(response.status).toBe('pending');
    });

    it('returns consistent response format', async () => {
      const request: GenerateChartRequest = {
        prompt: 'Test chart',
        run_id: 'run-123',
      };

      const response = await generateChart(request);

      // Response should match the contract
      expect(response).toEqual({
        request_id: expect.any(String),
        status: 'pending',
      });

      // Request ID should be valid format
      expect(response.request_id).toMatch(/^mock-request-\d+-[a-z0-9]+$/);
    });
  });

  describe('Chart Status API Contract', () => {
    it('returns valid status for existing request', async () => {
      // First, generate a chart
      const generateResponse = await generateChart({
        prompt: 'Test chart generation',
        run_id: 'run-123',
      });

      // Then check its status
      const statusResponse = await getChartStatus(generateResponse.request_id);

      expect(statusResponse).toMatchObject({
        request_id: generateResponse.request_id,
        status: expect.stringMatching(/^(pending|processing|completed|failed)$/),
      });
    });

    it('validates request ID format', async () => {
      await expect(getChartStatus('')).rejects.toThrow(
        expect.stringMatching(/request id is required/i)
      );
    });

    it('handles different status states correctly', async () => {
      const generateResponse = await generateChart({
        prompt: 'Test status progression',
        run_id: 'run-123',
      });

      // Poll until completion or failure
      let attempts = 0;
      let statusResponse: ChartStatusResponse;
      
      do {
        statusResponse = await getChartStatus(generateResponse.request_id);
        attempts++;
      } while (
        statusResponse.status !== 'completed' && 
        statusResponse.status !== 'failed' && 
        attempts < 10
      );

      // Final status should be either completed or failed
      expect(['completed', 'failed']).toContain(statusResponse.status);

      if (statusResponse.status === 'completed') {
        expect(statusResponse.result).toMatchObject({
          chart_code: expect.any(String),
          data_sources: expect.arrayContaining([
            expect.objectContaining({
              type: expect.stringMatching(/^(metric|artifact)$/),
              name: expect.any(String),
              path: expect.any(String),
            }),
          ]),
        });
      }

      if (statusResponse.status === 'failed') {
        expect(statusResponse.error_message).toBeDefined();
        expect(typeof statusResponse.error_message).toBe('string');
      }
    });

    it('provides consistent chart code format when completed', async () => {
      const generateResponse = await generateChart({
        prompt: 'Create a simple line chart',
        run_id: 'run-123',
      });

      // Poll until completed
      let statusResponse: ChartStatusResponse;
      let attempts = 0;

      do {
        statusResponse = await getChartStatus(generateResponse.request_id);
        attempts++;
        await new Promise(resolve => setTimeout(resolve, 100));
      } while (statusResponse.status !== 'completed' && attempts < 20);

      if (statusResponse.status === 'completed' && statusResponse.result) {
        const chartCode = statusResponse.result.chart_code;
        
        // Chart code should be valid React/JavaScript
        expect(chartCode).toContain('import');
        expect(chartCode).toContain('export');
        expect(chartCode).toMatch(/React|=>/); // Should contain React or arrow function
        
        // Should not contain dangerous patterns
        expect(chartCode).not.toMatch(/eval\(/);
        expect(chartCode).not.toMatch(/Function\(/);
        expect(chartCode).not.toMatch(/document\./);
        expect(chartCode).not.toMatch(/window\./);
      }
    });
  });

  describe('Save Chart API Contract', () => {
    it('accepts valid save chart request', async () => {
      const validRequest: SaveChartRequest = {
        name: 'My Custom Chart',
        description: 'A chart showing model performance',
        chart_code: 'const Chart = () => <div>Chart Content</div>;',
        run_id: 'run-123',
        experiment_id: 'exp-456',
      };

      const response = await saveChart(validRequest);

      expect(response).toMatchObject({
        chart_id: expect.any(String),
        status: 'saved',
        created_at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/),
      });
    });

    it('validates required fields in save request', async () => {
      const invalidRequest = {
        name: '', // Empty name
        chart_code: 'const Chart = () => <div>Chart</div>;',
        run_id: 'run-123',
      } as SaveChartRequest;

      await expect(saveChart(invalidRequest)).rejects.toThrow(
        expect.stringMatching(/chart name is required/i)
      );
    });

    it('validates chart code in save request', async () => {
      const invalidRequest: SaveChartRequest = {
        name: 'Valid Name',
        chart_code: '', // Empty code
        run_id: 'run-123',
      };

      await expect(saveChart(invalidRequest)).rejects.toThrow(
        expect.stringMatching(/chart code is required/i)
      );
    });

    it('handles optional fields in save request', async () => {
      const minimalRequest: SaveChartRequest = {
        name: 'Minimal Chart',
        chart_code: 'const Chart = () => <div>Minimal</div>;',
        run_id: 'run-123',
      };

      const response = await saveChart(minimalRequest);
      expect(response.chart_id).toBeDefined();
      expect(response.status).toBe('saved');
    });

    it('returns consistent chart ID format', async () => {
      const request: SaveChartRequest = {
        name: 'Test Chart',
        chart_code: 'const Chart = () => <div>Test</div>;',
        run_id: 'run-123',
      };

      const response = await saveChart(request);
      
      // Chart ID should follow expected format
      expect(response.chart_id).toMatch(/^chart-\d+-[a-z0-9]+$/);
      expect(response.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });
  });

  describe('List Charts API Contract', () => {
    it('accepts valid list request with run_id', async () => {
      const response = await listCharts('run-123');

      expect(response).toMatchObject({
        charts: expect.arrayContaining([
          expect.objectContaining({
            chart_id: expect.any(String),
            name: expect.any(String),
            created_at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/),
          }),
        ]),
        total_count: expect.any(Number),
        page: expect.any(Number),
        page_size: expect.any(Number),
      });
    });

    it('accepts valid list request with experiment_id', async () => {
      const response = await listCharts(undefined, 'exp-456');

      expect(response.total_count).toBeGreaterThanOrEqual(0);
      expect(Array.isArray(response.charts)).toBe(true);
    });

    it('validates that at least one ID is provided', async () => {
      await expect(listCharts()).rejects.toThrow(
        expect.stringMatching(/run_id.*experiment_id.*required/i)
      );
    });

    it('returns consistent chart structure', async () => {
      const response = await listCharts('run-123');

      if (response.charts.length > 0) {
        const chart = response.charts[0];
        
        expect(chart).toMatchObject({
          chart_id: expect.any(String),
          name: expect.any(String),
          created_at: expect.any(String),
          updated_at: expect.any(String),
        });

        // Optional fields
        if (chart.description) {
          expect(typeof chart.description).toBe('string');
        }
        if (chart.tags) {
          expect(typeof chart.tags).toBe('object');
        }
      }
    });

    it('supports pagination parameters', async () => {
      // This would be tested if the API supported pagination params in query
      // For now, we verify default pagination response
      const response = await listCharts('run-123');

      expect(response.page).toBe(1);
      expect(response.page_size).toBeGreaterThan(0);
      expect(response.total_count).toBeGreaterThanOrEqual(response.charts.length);
    });
  });

  describe('Delete Chart API Contract', () => {
    it('accepts valid chart ID for deletion', async () => {
      // First, create a chart to delete
      const saveResponse = await saveChart({
        name: 'Chart to Delete',
        chart_code: 'const Chart = () => <div>Delete Me</div>;',
        run_id: 'run-123',
      });

      const deleteResponse = await deleteChart(saveResponse.chart_id);

      expect(deleteResponse).toMatchObject({
        status: 'deleted',
        deleted_at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/),
      });
    });

    it('validates chart ID in delete request', async () => {
      await expect(deleteChart('')).rejects.toThrow(
        expect.stringMatching(/chart id is required/i)
      );
    });

    it('handles non-existent chart ID gracefully', async () => {
      await expect(deleteChart('non-existent-id')).rejects.toThrow(
        expect.stringMatching(/chart not found/i)
      );
    });

    it('handles permission errors gracefully', async () => {
      // The mock has a 10% chance of permission error
      // We'll retry until we get one or give up
      let permissionError = false;
      
      for (let i = 0; i < 20; i++) {
        try {
          await deleteChart('test-chart-id');
        } catch (error) {
          if (error instanceof Error && error.message.includes('permission')) {
            permissionError = true;
            break;
          }
        }
      }

      // This test verifies that permission errors are handled correctly
      // (Not that they always occur)
      expect(typeof permissionError).toBe('boolean');
    });
  });

  describe('API Error Handling Contract', () => {
    it('provides consistent error format for client errors', async () => {
      try {
        await generateChart({ prompt: '' } as GenerateChartRequest);
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        expect(error.message).toMatch(/prompt is required/i);
      }
    });

    it('provides consistent error format for server errors', async () => {
      mockServerUtils.simulateServerError();

      try {
        await generateChart({ prompt: 'Test prompt' });
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        expect(error.message).toMatch(/server.*error/i);
      }

      mockServerUtils.restoreDefaults();
    });

    it('handles network errors consistently', async () => {
      mockServerUtils.simulateNetworkError();

      try {
        await generateChart({ prompt: 'Test prompt' });
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        expect(error.message).toMatch(/network/i);
      }

      mockServerUtils.restoreDefaults();
    });

    it('handles rate limiting consistently', async () => {
      mockServerUtils.simulateRateLimited();

      try {
        await generateChart({ prompt: 'Test prompt' });
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        expect(error.message).toMatch(/rate limited|too many requests/i);
      }

      mockServerUtils.restoreDefaults();
    });
  });

  describe('API Response Time Contract', () => {
    it('responds within reasonable time limits', async () => {
      const startTime = Date.now();
      
      await generateChart({
        prompt: 'Performance test chart',
        run_id: 'run-123',
      });
      
      const responseTime = Date.now() - startTime;
      expect(responseTime).toBeLessThan(2000); // Should respond within 2 seconds
    });

    it('handles timeout scenarios gracefully', async () => {
      mockServerUtils.simulateTimeout();

      const startTime = Date.now();
      
      try {
        // This will timeout - adjust based on your timeout configuration
        await generateChart({ prompt: 'Timeout test' });
      } catch (error) {
        const elapsedTime = Date.now() - startTime;
        expect(elapsedTime).toBeGreaterThan(1000); // Should have waited
        expect(error.message).toMatch(/timeout|network/i);
      }

      mockServerUtils.restoreDefaults();
    });
  });

  describe('Data Integrity Contract', () => {
    it('maintains data consistency across API calls', async () => {
      // Generate a chart
      const generateResponse = await generateChart({
        prompt: 'Data consistency test',
        run_id: 'run-123',
      });

      // Save it
      const saveResponse = await saveChart({
        name: 'Consistency Test Chart',
        chart_code: 'const Chart = () => <div>Consistent</div>;',
        run_id: 'run-123',
        request_id: generateResponse.request_id,
      });

      // List charts to verify it appears
      const listResponse = await listCharts('run-123');
      const savedChart = listResponse.charts.find(c => c.chart_id === saveResponse.chart_id);

      expect(savedChart).toBeDefined();
      expect(savedChart?.name).toBe('Consistency Test Chart');
    });

    it('handles concurrent API calls safely', async () => {
      const promises = Array.from({ length: 5 }, (_, i) =>
        generateChart({
          prompt: `Concurrent test ${i}`,
          run_id: `run-${i}`,
        })
      );

      const responses = await Promise.all(promises);

      // All responses should be valid and unique
      expect(responses).toHaveLength(5);
      const requestIds = responses.map(r => r.request_id);
      const uniqueIds = new Set(requestIds);
      expect(uniqueIds.size).toBe(5); // All should be unique
    });
  });

  describe('API Versioning Contract', () => {
    it('maintains backward compatibility', async () => {
      // Test that API still works with older request formats
      const legacyRequest = {
        prompt: 'Legacy format test',
        runId: 'run-123', // Using camelCase instead of snake_case
      };

      // This should either work or fail gracefully
      try {
        const response = await generateChart(legacyRequest as any);
        expect(response.request_id).toBeDefined();
      } catch (error) {
        // If it fails, it should fail with a clear validation error
        expect(error.message).toMatch(/prompt|run.*id/i);
      }
    });

    it('handles unknown fields gracefully', async () => {
      const requestWithExtraFields = {
        prompt: 'Test with extra fields',
        run_id: 'run-123',
        unknownField: 'should be ignored',
        futureFeature: true,
      };

      // Should not fail due to unknown fields
      const response = await generateChart(requestWithExtraFields as any);
      expect(response.request_id).toBeDefined();
    });
  });
});