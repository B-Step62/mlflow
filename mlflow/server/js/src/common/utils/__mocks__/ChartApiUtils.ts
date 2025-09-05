// Mock implementation of ChartApiUtils for testing
import type {
  GenerateChartRequest,
  GenerateChartResponse,
  ChartStatusResponse,
  SaveChartRequest,
  SaveChartResponse,
  ListChartsResponse,
  DeleteChartResponse,
} from '../ChartApiUtils';

// Mock data generators
export const createMockChartCode = (type: 'simple' | 'complex' | 'error' = 'simple'): string => {
  switch (type) {
    case 'simple':
      return `
import React from 'react';
import { LazyPlot } from '../components/LazyPlot';

export const GeneratedChart = ({ data }) => {
  const plotData = [{
    x: data?.metrics?.map(m => m.step) || [1, 2, 3, 4, 5],
    y: data?.metrics?.map(m => m.value) || [2, 4, 3, 5, 6],
    type: 'scatter',
    mode: 'lines+markers',
    name: 'Sample Metric',
    line: { color: '#1890ff' }
  }];
  
  const layout = {
    title: 'Generated Line Chart',
    xaxis: { title: 'Step' },
    yaxis: { title: 'Value' },
    autosize: true
  };
  
  return <LazyPlot data={plotData} layout={layout} />;
};`;

    case 'complex':
      return `
import React from 'react';
import { LazyPlot } from '../components/LazyPlot';

export const GeneratedChart = ({ data }) => {
  const processedData = data?.metrics?.reduce((acc, metric) => {
    const category = metric.category || 'default';
    if (!acc[category]) acc[category] = [];
    acc[category].push(metric);
    return acc;
  }, {}) || {};

  const plotData = Object.entries(processedData).map(([category, metrics], index) => ({
    x: metrics.map(m => m.step),
    y: metrics.map(m => m.value),
    type: 'scatter',
    mode: 'lines+markers',
    name: category,
    line: { color: \`hsl(\${index * 60}, 70%, 50%)\` }
  }));
  
  const layout = {
    title: 'Multi-Category Performance Metrics',
    xaxis: { title: 'Training Step' },
    yaxis: { title: 'Metric Value' },
    autosize: true,
    showlegend: true,
    margin: { t: 40, r: 20, b: 40, l: 60 }
  };
  
  return <LazyPlot data={plotData} layout={layout} config={{ responsive: true }} />;
};`;

    case 'error':
      return `
// This code intentionally has syntax errors for testing
export const BrokenChart = ({ data }) => {
  const invalid = syntax here ][;
  return <div>This won't compile</div>
};`;

    default:
      return createMockChartCode('simple');
  }
};

export const createMockGenerateResponse = (overrides: Partial<GenerateChartResponse> = {}): GenerateChartResponse => ({
  request_id: `mock-request-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
  status: 'pending',
  ...overrides,
});

export const createMockStatusResponse = (
  requestId: string, 
  status: ChartStatusResponse['status'] = 'completed',
  overrides: Partial<ChartStatusResponse> = {}
): ChartStatusResponse => {
  const baseResponse: ChartStatusResponse = {
    request_id: requestId,
    status,
  };

  switch (status) {
    case 'completed':
      return {
        ...baseResponse,
        result: {
          chart_code: createMockChartCode('simple'),
          chart_config: {
            title: 'Generated Chart',
            chart_type: 'line',
            data_sources: ['metrics'],
          },
          data_sources: [
            {
              type: 'metric' as const,
              name: 'accuracy',
              path: '/api/2.0/mlflow/runs/get-metric',
            },
            {
              type: 'metric' as const,
              name: 'loss',
              path: '/api/2.0/mlflow/runs/get-metric',
            },
          ],
        },
        ...overrides,
      };

    case 'failed':
      return {
        ...baseResponse,
        error_message: 'Mock error: Chart generation failed due to invalid prompt',
        ...overrides,
      };

    case 'processing':
    case 'pending':
    default:
      return {
        ...baseResponse,
        ...overrides,
      };
  }
};

export const createMockSaveResponse = (overrides: Partial<SaveChartResponse> = {}): SaveChartResponse => ({
  chart_id: `chart-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
  status: 'saved',
  created_at: new Date().toISOString(),
  ...overrides,
});

export const createMockListResponse = (count: number = 3, overrides: Partial<ListChartsResponse> = {}): ListChartsResponse => {
  const charts = Array.from({ length: count }, (_, index) => ({
    chart_id: `chart-${index + 1}`,
    name: `Generated Chart ${index + 1}`,
    description: `A sample chart generated for testing purposes #${index + 1}`,
    chart_code: createMockChartCode(index % 2 === 0 ? 'simple' : 'complex'),
    created_at: new Date(Date.now() - (count - index) * 86400000).toISOString(), // Spread over recent days
    updated_at: new Date(Date.now() - (count - index) * 43200000).toISOString(), // Half the age for updated
    run_id: `run-${index + 1}`,
    experiment_id: `exp-${index + 1}`,
    tags: {
      chart_type: index % 2 === 0 ? 'line' : 'bar',
      complexity: index % 3 === 0 ? 'simple' : 'complex',
    },
  }));

  return {
    charts,
    total_count: count,
    page: 1,
    page_size: 50,
    ...overrides,
  };
};

export const createMockDeleteResponse = (overrides: Partial<DeleteChartResponse> = {}): DeleteChartResponse => ({
  status: 'deleted',
  deleted_at: new Date().toISOString(),
  ...overrides,
});

// Mock API delay simulation
export const mockApiDelay = (min: number = 100, max: number = 500): Promise<void> => {
  const delay = Math.random() * (max - min) + min;
  return new Promise(resolve => setTimeout(resolve, delay));
};

// Mock error scenarios
export const mockApiError = (type: 'network' | 'server' | 'validation' | 'timeout' = 'server'): Error => {
  switch (type) {
    case 'network':
      return new Error('Network error: Unable to connect to the server');
    case 'server':
      return new Error('Server error: Internal server error occurred');
    case 'validation':
      return new Error('Validation error: Invalid request parameters');
    case 'timeout':
      return new Error('Timeout error: Request timed out');
    default:
      return new Error('Unknown error occurred');
  }
};

// Progressive status simulation for realistic polling
export class MockStatusProgressSimulator {
  private currentAttempt = 0;
  private readonly maxAttempts: number;
  private readonly failureRate: number;

  constructor(maxAttempts: number = 5, failureRate: number = 0.1) {
    this.maxAttempts = maxAttempts;
    this.failureRate = failureRate;
  }

  getNextStatus(requestId: string): ChartStatusResponse {
    this.currentAttempt++;
    
    // Simulate random failures
    if (Math.random() < this.failureRate) {
      return createMockStatusResponse(requestId, 'failed', {
        error_message: 'Simulated random failure during processing',
      });
    }

    // Simulate progression
    if (this.currentAttempt === 1) {
      return createMockStatusResponse(requestId, 'pending');
    } else if (this.currentAttempt <= this.maxAttempts / 2) {
      return createMockStatusResponse(requestId, 'processing');
    } else if (this.currentAttempt <= this.maxAttempts) {
      return createMockStatusResponse(requestId, 'completed');
    } else {
      // Timeout scenario
      return createMockStatusResponse(requestId, 'failed', {
        error_message: 'Chart generation timed out',
      });
    }
  }

  reset(): void {
    this.currentAttempt = 0;
  }
}

// Mock implementations
let statusSimulator = new MockStatusProgressSimulator();

export const generateChart = jest.fn(async (request: GenerateChartRequest): Promise<GenerateChartResponse> => {
  // Input validation
  if (!request.prompt || request.prompt.trim().length === 0) {
    throw mockApiError('validation');
  }
  if (request.prompt.length > 5000) {
    throw mockApiError('validation');
  }

  await mockApiDelay();
  
  // Simulate occasional network errors
  if (Math.random() < 0.05) {
    throw mockApiError('network');
  }

  return createMockGenerateResponse();
});

export const getChartStatus = jest.fn(async (requestId: string): Promise<ChartStatusResponse> => {
  if (!requestId) {
    throw mockApiError('validation');
  }

  await mockApiDelay(50, 200);
  
  return statusSimulator.getNextStatus(requestId);
});

export const saveChart = jest.fn(async (request: SaveChartRequest): Promise<SaveChartResponse> => {
  // Input validation
  if (!request.name || request.name.trim().length === 0) {
    throw mockApiError('validation');
  }
  if (!request.chart_code || request.chart_code.trim().length === 0) {
    throw mockApiError('validation');
  }

  await mockApiDelay(200, 800);
  
  return createMockSaveResponse({
    name: request.name,
  });
});

export const listCharts = jest.fn(async (runId?: string, experimentId?: string): Promise<ListChartsResponse> => {
  if (!runId && !experimentId) {
    throw mockApiError('validation');
  }

  await mockApiDelay(100, 300);
  
  const count = Math.floor(Math.random() * 8) + 1; // 1-8 charts
  return createMockListResponse(count);
});

export const deleteChart = jest.fn(async (chartId: string): Promise<DeleteChartResponse> => {
  if (!chartId) {
    throw mockApiError('validation');
  }

  await mockApiDelay(150, 400);
  
  // Simulate occasional permission errors
  if (Math.random() < 0.1) {
    throw new Error('Permission denied: You do not have permission to delete this chart');
  }
  
  return createMockDeleteResponse();
});

// Test utilities
export const resetMocks = (): void => {
  jest.clearAllMocks();
  statusSimulator.reset();
  statusSimulator = new MockStatusProgressSimulator();
};

export const setupMockScenario = (scenario: 'success' | 'failure' | 'timeout' | 'slow'): void => {
  resetMocks();
  
  switch (scenario) {
    case 'failure':
      generateChart.mockRejectedValue(mockApiError('server'));
      break;
    
    case 'timeout':
      statusSimulator = new MockStatusProgressSimulator(15, 0); // Long polling
      break;
    
    case 'slow':
      generateChart.mockImplementation(async (request) => {
        await mockApiDelay(2000, 5000); // Very slow response
        return createMockGenerateResponse();
      });
      break;
    
    case 'success':
    default:
      // Use default implementations
      break;
  }
};

// Export types for test files
export type {
  GenerateChartRequest,
  GenerateChartResponse,
  ChartStatusResponse,
  SaveChartRequest,
  SaveChartResponse,
  ListChartsResponse,
  DeleteChartResponse,
} from '../ChartApiUtils';