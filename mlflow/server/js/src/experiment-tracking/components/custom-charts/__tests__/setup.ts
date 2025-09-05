// Jest setup file for custom charts tests
import '@testing-library/jest-dom';
import { setupMockServer, teardownMockServer, resetMockServer } from './mockServer';

// Setup mock server for all tests
beforeAll(() => {
  setupMockServer();
});

afterEach(() => {
  resetMockServer();
});

afterAll(() => {
  teardownMockServer();
});

// Global test configuration
global.ResizeObserver = jest.fn().mockImplementation(() => ({
  observe: jest.fn(),
  unobserve: jest.fn(),
  disconnect: jest.fn(),
}));

// Mock window.matchMedia
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: jest.fn().mockImplementation(query => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: jest.fn(), // deprecated
    removeListener: jest.fn(), // deprecated
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    dispatchEvent: jest.fn(),
  })),
});

// Mock performance API for memory testing
Object.defineProperty(performance, 'memory', {
  writable: true,
  value: {
    usedJSHeapSize: 1000000,
    totalJSHeapSize: 2000000,
    jsHeapSizeLimit: 10000000,
  },
});

// Mock IntersectionObserver
global.IntersectionObserver = jest.fn().mockImplementation(() => ({
  observe: jest.fn(),
  unobserve: jest.fn(),
  disconnect: jest.fn(),
}));

// Console error/warn suppression for expected test errors
const originalError = console.error;
const originalWarn = console.warn;

console.error = (...args: any[]) => {
  // Suppress specific warnings that are expected in tests
  if (
    args[0]?.includes?.('Warning: ReactDOM.render is no longer supported') ||
    args[0]?.includes?.('Warning: componentWillReceiveProps has been renamed') ||
    args[0]?.includes?.('Warning: Failed prop type')
  ) {
    return;
  }
  originalError.call(console, ...args);
};

console.warn = (...args: any[]) => {
  // Suppress specific warnings that are expected in tests
  if (
    args[0]?.includes?.('componentWillReceiveProps') ||
    args[0]?.includes?.('Legacy context API')
  ) {
    return;
  }
  originalWarn.call(console, ...args);
};

// Global error handler for unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// Global test constants
global.__TEST_CONSTANTS__ = {
  DEFAULT_TIMEOUT: 5000,
  API_BASE_URL: '/api/2.0/mlflow/charts',
  MOCK_RUN_ID: 'run-123',
  MOCK_EXPERIMENT_ID: 'exp-456',
};

// Mock local storage
const localStorageMock = {
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
  clear: jest.fn(),
  length: 0,
  key: jest.fn(),
};

Object.defineProperty(window, 'localStorage', {
  value: localStorageMock,
});

// Mock session storage
Object.defineProperty(window, 'sessionStorage', {
  value: localStorageMock,
});

// Mock fetch for tests that don't use MSW
if (!global.fetch) {
  global.fetch = jest.fn();
}

// Add custom matchers
expect.extend({
  toBeWithinRange(received: number, floor: number, ceiling: number) {
    const pass = received >= floor && received <= ceiling;
    if (pass) {
      return {
        message: () =>
          `expected ${received} not to be within range ${floor} - ${ceiling}`,
        pass: true,
      };
    } else {
      return {
        message: () =>
          `expected ${received} to be within range ${floor} - ${ceiling}`,
        pass: false,
      };
    }
  },
  
  toHaveValidChartCode(received: string) {
    const hasImports = received.includes('import');
    const hasExport = received.includes('export');
    const hasReactComponent = received.includes('React') || received.includes('=>');
    
    const pass = hasImports && hasExport && hasReactComponent;
    
    if (pass) {
      return {
        message: () => `expected chart code not to be valid`,
        pass: true,
      };
    } else {
      return {
        message: () => `expected chart code to be valid (should have imports, exports, and React components)`,
        pass: false,
      };
    }
  },
});

// Declare custom matchers for TypeScript
declare global {
  namespace jest {
    interface Matchers<R> {
      toBeWithinRange(floor: number, ceiling: number): R;
      toHaveValidChartCode(): R;
    }
  }
}

export {};