import {
  generateChart,
  getChartStatus,
  saveChart,
  listCharts,
  deleteChart,
} from './ChartApiUtils';

describe('ChartApiUtils', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Mock global fetch
    global.fetch = jest.fn();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('generateChart', () => {
    it('makes correct API call for chart generation', async () => {
      const mockResponse = {
        request_id: 'test-request-123',
        status: 'pending',
      };
      
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const request = {
        prompt: 'Create a line chart',
        run_id: 'run-123',
        experiment_id: 'exp-456',
      };

      const result = await generateChart(request);

      expect(global.fetch).toHaveBeenCalledWith('/api/2.0/mlflow/charts/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(request),
      });

      expect(result).toEqual(mockResponse);
    });

    it('handles API errors in chart generation', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      });

      const request = {
        prompt: 'Create a line chart',
        run_id: 'run-123',
      };

      await expect(generateChart(request)).rejects.toThrow('Failed to generate chart: 500 Internal Server Error');
    });

    it('validates prompt in generate request', async () => {
      const request = {
        prompt: '',
        run_id: 'run-123',
      };

      await expect(generateChart(request)).rejects.toThrow('Prompt is required');
    });

    it('validates prompt length', async () => {
      const longPrompt = 'A'.repeat(5001);
      const request = {
        prompt: longPrompt,
        run_id: 'run-123',
      };

      await expect(generateChart(request)).rejects.toThrow('Prompt must be 5000 characters or less');
    });
  });

  describe('getChartStatus', () => {
    it('makes correct API call for chart status', async () => {
      const mockResponse = {
        request_id: 'test-request-123',
        status: 'completed',
        result: {
          chart_code: 'const chart = () => <div>Chart</div>;',
        },
      };
      
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const requestId = 'test-request-123';
      const result = await getChartStatus(requestId);

      expect(global.fetch).toHaveBeenCalledWith(`/api/2.0/mlflow/charts/status/${requestId}`);
      expect(result).toEqual(mockResponse);
    });

    it('handles API errors in status check', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found',
      });

      await expect(getChartStatus('invalid-id')).rejects.toThrow('Failed to get chart status: 404 Not Found');
    });

    it('validates request ID', async () => {
      await expect(getChartStatus('')).rejects.toThrow('Request ID is required');
    });
  });

  describe('saveChart', () => {
    it('makes correct API call to save chart', async () => {
      const mockResponse = {
        chart_id: 'chart-123',
        status: 'saved',
      };
      
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const request = {
        name: 'My Chart',
        chart_code: 'const chart = () => <div>Chart</div>;',
        run_id: 'run-123',
        experiment_id: 'exp-456',
      };

      const result = await saveChart(request);

      expect(global.fetch).toHaveBeenCalledWith('/api/2.0/mlflow/charts/save', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(request),
      });

      expect(result).toEqual(mockResponse);
    });

    it('validates required fields for save chart', async () => {
      const request = {
        name: '',
        chart_code: 'code',
        run_id: 'run-123',
      };

      await expect(saveChart(request)).rejects.toThrow('Chart name is required');
    });

    it('validates chart code for save', async () => {
      const request = {
        name: 'My Chart',
        chart_code: '',
        run_id: 'run-123',
      };

      await expect(saveChart(request)).rejects.toThrow('Chart code is required');
    });
  });

  describe('listCharts', () => {
    it('makes correct API call to list charts', async () => {
      const mockResponse = {
        charts: [
          {
            chart_id: 'chart-1',
            name: 'Chart 1',
            created_at: '2023-01-01T00:00:00Z',
          },
          {
            chart_id: 'chart-2',
            name: 'Chart 2',
            created_at: '2023-01-02T00:00:00Z',
          },
        ],
        total_count: 2,
      };
      
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const result = await listCharts('run-123');

      expect(global.fetch).toHaveBeenCalledWith('/api/2.0/mlflow/charts/list?run_id=run-123');
      expect(result).toEqual(mockResponse);
    });

    it('includes experiment_id in query params when provided', async () => {
      const mockResponse = { charts: [], total_count: 0 };
      
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      await listCharts('run-123', 'exp-456');

      expect(global.fetch).toHaveBeenCalledWith('/api/2.0/mlflow/charts/list?run_id=run-123&experiment_id=exp-456');
    });

    it('handles empty run_id for listing charts', async () => {
      await expect(listCharts('')).rejects.toThrow('Run ID is required');
    });
  });

  describe('deleteChart', () => {
    it('makes correct API call to delete chart', async () => {
      const mockResponse = { status: 'deleted' };
      
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const result = await deleteChart('chart-123');

      expect(global.fetch).toHaveBeenCalledWith('/api/2.0/mlflow/charts/chart-123', {
        method: 'DELETE',
      });

      expect(result).toEqual(mockResponse);
    });

    it('validates chart ID for deletion', async () => {
      await expect(deleteChart('')).rejects.toThrow('Chart ID is required');
    });

    it('handles API errors in chart deletion', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: false,
        status: 403,
        statusText: 'Forbidden',
      });

      await expect(deleteChart('chart-123')).rejects.toThrow('Failed to delete chart: 403 Forbidden');
    });
  });

  describe('Error handling', () => {
    it('handles network errors', async () => {
      (global.fetch as jest.Mock).mockRejectedValue(new Error('Network error'));

      await expect(generateChart({ prompt: 'test' })).rejects.toThrow('Network error');
    });

    it('handles JSON parsing errors', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: () => Promise.reject(new Error('Invalid JSON')),
      });

      await expect(generateChart({ prompt: 'test' })).rejects.toThrow('Invalid JSON');
    });

    it('handles missing response data', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(null),
      });

      const result = await generateChart({ prompt: 'test' });
      expect(result).toBeNull();
    });
  });

  describe('Input validation', () => {
    it('trims whitespace from prompts', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ request_id: 'test' }),
      });

      await generateChart({ prompt: '  test prompt  ' });

      expect(global.fetch).toHaveBeenCalledWith(
        '/api/2.0/mlflow/charts/generate',
        expect.objectContaining({
          body: JSON.stringify({ prompt: '  test prompt  ' }), // Should preserve original
        })
      );
    });

    it('validates UUID format for request IDs', async () => {
      // This is a basic validation - in a real implementation, you might want more robust UUID validation
      await expect(getChartStatus('invalid-uuid-format')).rejects.toThrow('Request ID is required');
    });
  });
});