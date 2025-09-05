// Mock server setup for comprehensive API testing
import { rest } from 'msw';
import { setupServer } from 'msw/node';
import {
  createMockGenerateResponse,
  createMockStatusResponse,
  createMockSaveResponse,
  createMockListResponse,
  createMockDeleteResponse,
  MockStatusProgressSimulator,
  mockApiDelay,
} from '../../../common/utils/__mocks__/ChartApiUtils';

// API endpoints
const API_BASE = '/api/2.0/mlflow/charts';

// In-memory storage for testing
class MockDatabase {
  private requests: Map<string, any> = new Map();
  private charts: Map<string, any> = new Map();
  private statusSimulators: Map<string, MockStatusProgressSimulator> = new Map();

  // Request management
  addRequest(requestId: string, request: any): void {
    this.requests.set(requestId, {
      ...request,
      createdAt: new Date().toISOString(),
      status: 'pending',
    });
    this.statusSimulators.set(requestId, new MockStatusProgressSimulator());
  }

  getRequest(requestId: string): any {
    return this.requests.get(requestId);
  }

  updateRequestStatus(requestId: string, status: string, result?: any): void {
    const request = this.requests.get(requestId);
    if (request) {
      this.requests.set(requestId, {
        ...request,
        status,
        result,
        updatedAt: new Date().toISOString(),
      });
    }
  }

  getRequestStatus(requestId: string): any {
    const simulator = this.statusSimulators.get(requestId);
    return simulator ? simulator.getNextStatus(requestId) : null;
  }

  // Chart management
  addChart(chartId: string, chart: any): void {
    this.charts.set(chartId, {
      ...chart,
      chart_id: chartId,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
  }

  getChart(chartId: string): any {
    return this.charts.get(chartId);
  }

  listCharts(runId?: string, experimentId?: string): any[] {
    return Array.from(this.charts.values()).filter(chart => {
      if (runId && chart.run_id !== runId) return false;
      if (experimentId && chart.experiment_id !== experimentId) return false;
      return true;
    });
  }

  deleteChart(chartId: string): boolean {
    return this.charts.delete(chartId);
  }

  clear(): void {
    this.requests.clear();
    this.charts.clear();
    this.statusSimulators.clear();
  }

  // Test data setup
  seedTestData(): void {
    // Add some sample charts
    for (let i = 1; i <= 3; i++) {
      this.addChart(`chart-${i}`, {
        name: `Test Chart ${i}`,
        description: `A sample chart for testing #${i}`,
        chart_code: `const Chart${i} = () => <div>Chart ${i}</div>;`,
        run_id: `run-${i}`,
        experiment_id: `exp-${Math.ceil(i / 2)}`,
        tags: { type: i % 2 === 0 ? 'line' : 'bar' },
      });
    }
  }
}

const mockDb = new MockDatabase();

// Mock handlers
const handlers = [
  // Generate chart
  rest.post(`${API_BASE}/generate`, async (req, res, ctx) => {
    try {
      const body = await req.json() as any;
      
      // Input validation
      if (!body.prompt || body.prompt.trim().length === 0) {
        return res(
          ctx.status(400),
          ctx.json({ 
            error_code: 'INVALID_REQUEST',
            message: 'Prompt is required' 
          })
        );
      }

      if (body.prompt.length > 5000) {
        return res(
          ctx.status(400),
          ctx.json({ 
            error_code: 'INVALID_REQUEST',
            message: 'Prompt must be 5000 characters or less' 
          })
        );
      }

      // Simulate processing delay
      await mockApiDelay(100, 500);

      // Create request
      const response = createMockGenerateResponse();
      mockDb.addRequest(response.request_id, body);

      return res(
        ctx.status(200),
        ctx.json(response)
      );
    } catch (error) {
      return res(
        ctx.status(500),
        ctx.json({ 
          error_code: 'INTERNAL_ERROR',
          message: 'Internal server error occurred' 
        })
      );
    }
  }),

  // Get chart status
  rest.get(`${API_BASE}/status/:requestId`, async (req, res, ctx) => {
    try {
      const { requestId } = req.params;

      if (!requestId) {
        return res(
          ctx.status(400),
          ctx.json({ 
            error_code: 'INVALID_REQUEST',
            message: 'Request ID is required' 
          })
        );
      }

      const request = mockDb.getRequest(requestId as string);
      if (!request) {
        return res(
          ctx.status(404),
          ctx.json({ 
            error_code: 'NOT_FOUND',
            message: 'Request not found' 
          })
        );
      }

      // Simulate processing delay
      await mockApiDelay(50, 200);

      const status = mockDb.getRequestStatus(requestId as string);
      return res(
        ctx.status(200),
        ctx.json(status)
      );
    } catch (error) {
      return res(
        ctx.status(500),
        ctx.json({ 
          error_code: 'INTERNAL_ERROR',
          message: 'Internal server error occurred' 
        })
      );
    }
  }),

  // Save chart
  rest.post(`${API_BASE}/save`, async (req, res, ctx) => {
    try {
      const body = await req.json() as any;
      
      // Input validation
      if (!body.name || body.name.trim().length === 0) {
        return res(
          ctx.status(400),
          ctx.json({ 
            error_code: 'INVALID_REQUEST',
            message: 'Chart name is required' 
          })
        );
      }

      if (!body.chart_code || body.chart_code.trim().length === 0) {
        return res(
          ctx.status(400),
          ctx.json({ 
            error_code: 'INVALID_REQUEST',
            message: 'Chart code is required' 
          })
        );
      }

      // Simulate processing delay
      await mockApiDelay(200, 800);

      const response = createMockSaveResponse();
      mockDb.addChart(response.chart_id, {
        ...body,
        status: 'saved',
      });

      return res(
        ctx.status(200),
        ctx.json(response)
      );
    } catch (error) {
      return res(
        ctx.status(500),
        ctx.json({ 
          error_code: 'INTERNAL_ERROR',
          message: 'Internal server error occurred' 
        })
      );
    }
  }),

  // List charts
  rest.get(`${API_BASE}/list`, async (req, res, ctx) => {
    try {
      const runId = req.url.searchParams.get('run_id');
      const experimentId = req.url.searchParams.get('experiment_id');
      const page = parseInt(req.url.searchParams.get('page') || '1');
      const pageSize = parseInt(req.url.searchParams.get('page_size') || '50');

      if (!runId && !experimentId) {
        return res(
          ctx.status(400),
          ctx.json({ 
            error_code: 'INVALID_REQUEST',
            message: 'Either run_id or experiment_id is required' 
          })
        );
      }

      // Simulate processing delay
      await mockApiDelay(100, 300);

      const charts = mockDb.listCharts(runId || undefined, experimentId || undefined);
      const startIndex = (page - 1) * pageSize;
      const endIndex = startIndex + pageSize;
      const paginatedCharts = charts.slice(startIndex, endIndex);

      return res(
        ctx.status(200),
        ctx.json({
          charts: paginatedCharts,
          total_count: charts.length,
          page,
          page_size: pageSize,
        })
      );
    } catch (error) {
      return res(
        ctx.status(500),
        ctx.json({ 
          error_code: 'INTERNAL_ERROR',
          message: 'Internal server error occurred' 
        })
      );
    }
  }),

  // Delete chart
  rest.delete(`${API_BASE}/:chartId`, async (req, res, ctx) => {
    try {
      const { chartId } = req.params;

      if (!chartId) {
        return res(
          ctx.status(400),
          ctx.json({ 
            error_code: 'INVALID_REQUEST',
            message: 'Chart ID is required' 
          })
        );
      }

      const chart = mockDb.getChart(chartId as string);
      if (!chart) {
        return res(
          ctx.status(404),
          ctx.json({ 
            error_code: 'NOT_FOUND',
            message: 'Chart not found' 
          })
        );
      }

      // Simulate processing delay
      await mockApiDelay(150, 400);

      // Simulate permission check (10% chance of failure)
      if (Math.random() < 0.1) {
        return res(
          ctx.status(403),
          ctx.json({ 
            error_code: 'PERMISSION_DENIED',
            message: 'You do not have permission to delete this chart' 
          })
        );
      }

      mockDb.deleteChart(chartId as string);
      
      return res(
        ctx.status(200),
        ctx.json(createMockDeleteResponse())
      );
    } catch (error) {
      return res(
        ctx.status(500),
        ctx.json({ 
          error_code: 'INTERNAL_ERROR',
          message: 'Internal server error occurred' 
        })
      );
    }
  }),

  // Health check endpoint
  rest.get(`${API_BASE}/health`, (req, res, ctx) => {
    return res(
      ctx.status(200),
      ctx.json({ 
        status: 'healthy',
        timestamp: new Date().toISOString() 
      })
    );
  }),
];

// Create and configure server
export const mockServer = setupServer(...handlers);

// Test utilities
export const mockServerUtils = {
  // Reset all data
  reset: () => {
    mockDb.clear();
  },

  // Seed with test data
  seedTestData: () => {
    mockDb.seedTestData();
  },

  // Add custom chart
  addChart: (chartId: string, chart: any) => {
    mockDb.addChart(chartId, chart);
  },

  // Get database state
  getState: () => ({
    requests: Array.from(mockDb['requests'].entries()),
    charts: Array.from(mockDb['charts'].entries()),
  }),

  // Configure error scenarios
  simulateNetworkError: () => {
    mockServer.use(
      rest.post(`${API_BASE}/generate`, (req, res, ctx) => {
        return res.networkError('Network connection failed');
      })
    );
  },

  simulateServerError: () => {
    mockServer.use(
      rest.post(`${API_BASE}/generate`, (req, res, ctx) => {
        return res(
          ctx.status(500),
          ctx.json({ 
            error_code: 'INTERNAL_ERROR',
            message: 'Server is temporarily unavailable' 
          })
        );
      })
    );
  },

  simulateTimeout: () => {
    mockServer.use(
      rest.post(`${API_BASE}/generate`, async (req, res, ctx) => {
        await new Promise(resolve => setTimeout(resolve, 10000)); // 10 second delay
        return res(ctx.status(200), ctx.json(createMockGenerateResponse()));
      })
    );
  },

  simulateRateLimited: () => {
    mockServer.use(
      rest.post(`${API_BASE}/generate`, (req, res, ctx) => {
        return res(
          ctx.status(429),
          ctx.json({ 
            error_code: 'RATE_LIMITED',
            message: 'Too many requests, please try again later',
            retry_after: 60 
          })
        );
      })
    );
  },

  // Restore default handlers
  restoreDefaults: () => {
    mockServer.resetHandlers();
  },
};

// Setup and teardown functions
export const setupMockServer = () => {
  mockServer.listen({ onUnhandledRequest: 'warn' });
  mockServerUtils.seedTestData();
};

export const teardownMockServer = () => {
  mockServer.close();
};

export const resetMockServer = () => {
  mockServer.resetHandlers();
  mockServerUtils.reset();
  mockServerUtils.seedTestData();
};

export default mockServer;