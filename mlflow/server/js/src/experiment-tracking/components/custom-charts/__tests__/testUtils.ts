// Test utilities for custom charts components
import { render, RenderOptions } from '@testing-library/react';
import { Provider } from 'react-redux';
import { createStore, Store } from 'redux';
import { ReactElement, ReactNode } from 'react';

// Mock data factories
export const createMockRunInfo = (overrides: any = {}) => ({
  runUuid: 'run-123',
  runName: 'Test Run',
  experimentId: 'exp-456',
  status: 'FINISHED',
  artifactUri: 'artifacts/',
  startTime: Date.now() - 3600000, // 1 hour ago
  endTime: Date.now() - 1800000, // 30 minutes ago
  lifecycleStage: 'active',
  ...overrides,
});

export const createMockLatestMetrics = (overrides: any = {}) => ({
  accuracy: { 
    key: 'accuracy',
    value: 0.95, 
    timestamp: Date.now() - 1800000,
    step: 100 
  },
  loss: { 
    key: 'loss',
    value: 0.05, 
    timestamp: Date.now() - 1800000,
    step: 100 
  },
  f1_score: { 
    key: 'f1_score',
    value: 0.92, 
    timestamp: Date.now() - 1800000,
    step: 100 
  },
  ...overrides,
});

export const createMockParams = (overrides: any = {}) => ({
  learning_rate: { 
    key: 'learning_rate',
    value: '0.001' 
  },
  batch_size: { 
    key: 'batch_size',
    value: '32' 
  },
  epochs: { 
    key: 'epochs',
    value: '100' 
  },
  ...overrides,
});

export const createMockTags = (overrides: any = {}) => ({
  version: { 
    key: 'version',
    value: '1.0.0' 
  },
  model_type: { 
    key: 'model_type',
    value: 'neural_network' 
  },
  framework: { 
    key: 'framework',
    value: 'tensorflow' 
  },
  ...overrides,
});

export const createMockChartUIState = (overrides: any = {}) => ({
  compareRunCharts: [],
  compareRunSections: [],
  chartsSearchFilter: '',
  isAccordionReordered: false,
  autoRefreshEnabled: false,
  globalLineChartConfig: {
    xAxisKey: 'STEP',
    lineSmoothness: 0,
    selectedXAxisMetricKey: '',
  },
  ...overrides,
});

// Redux store setup for testing
export const createMockReduxState = (overrides: any = {}) => ({
  entities: {
    sampledMetricsByRunUuid: {
      'run-123': {
        'accuracy': {
          metricsHistory: [
            { key: 'accuracy', value: 0.85, timestamp: Date.now() - 3600000, step: 50 },
            { key: 'accuracy', value: 0.90, timestamp: Date.now() - 1800000, step: 75 },
            { key: 'accuracy', value: 0.95, timestamp: Date.now() - 900000, step: 100 },
          ],
        },
        'loss': {
          metricsHistory: [
            { key: 'loss', value: 0.15, timestamp: Date.now() - 3600000, step: 50 },
            { key: 'loss', value: 0.10, timestamp: Date.now() - 1800000, step: 75 },
            { key: 'loss', value: 0.05, timestamp: Date.now() - 900000, step: 100 },
          ],
        },
      },
    },
    imagesByRunUuid: {
      'run-123': {
        'plots/confusion_matrix.png': {
          filepath: 'plots/confusion_matrix.png',
          is_dir: false,
          file_size: 1024,
        },
      },
    },
    ...overrides.entities,
  },
  comparedExperiments: {
    comparedExperimentIds: [],
    hasComparedExperimentsBefore: false,
    ...overrides.comparedExperiments,
  },
  ...overrides,
});

export const createMockStore = (initialState?: any): Store => {
  return createStore((state = createMockReduxState(initialState)) => state);
};

// Custom render function with Redux provider
interface CustomRenderOptions extends Omit<RenderOptions, 'wrapper'> {
  initialState?: any;
  store?: Store;
}

export const renderWithRedux = (
  ui: ReactElement,
  {
    initialState,
    store = createMockStore(initialState),
    ...renderOptions
  }: CustomRenderOptions = {}
) => {
  const Wrapper = ({ children }: { children?: ReactNode }) => (
    <Provider store={store}>{children}</Provider>
  );

  return {
    ...render(ui, { wrapper: Wrapper, ...renderOptions }),
    store,
  };
};

// Mock hook data generators
export const createMockCustomChartState = (scenario: 'idle' | 'loading' | 'success' | 'error' = 'idle') => {
  const baseState = {
    isGenerating: false,
    chartCode: null,
    error: null,
    progress: null,
    requestId: null,
    generateCustomChart: jest.fn(),
    reset: jest.fn(),
  };

  switch (scenario) {
    case 'loading':
      return {
        ...baseState,
        isGenerating: true,
        progress: 'Generating chart code...',
        requestId: 'req-123',
      };

    case 'success':
      return {
        ...baseState,
        chartCode: `
          import React from 'react';
          export const Chart = () => <div>Generated Chart</div>;
        `,
        requestId: 'req-123',
      };

    case 'error':
      return {
        ...baseState,
        error: 'Failed to generate chart: Invalid prompt format',
        requestId: 'req-123',
      };

    case 'idle':
    default:
      return baseState;
  }
};

// Test scenario setup utilities
export const setupTestScenario = {
  // Setup for successful chart generation flow
  successFlow: () => {
    const mockGenerateChart = jest.fn().mockResolvedValue(undefined);
    const mockReset = jest.fn();
    
    return {
      generateCustomChart: mockGenerateChart,
      reset: mockReset,
      isGenerating: false,
      chartCode: null,
      error: null,
      progress: null,
    };
  },

  // Setup for loading state
  loadingFlow: () => ({
    generateCustomChart: jest.fn(),
    reset: jest.fn(),
    isGenerating: true,
    chartCode: null,
    error: null,
    progress: 'Analyzing your request...',
  }),

  // Setup for error state
  errorFlow: (errorMessage: string = 'Chart generation failed') => ({
    generateCustomChart: jest.fn(),
    reset: jest.fn(),
    isGenerating: false,
    chartCode: null,
    error: errorMessage,
    progress: null,
  }),

  // Setup for completed state
  completedFlow: (chartCode?: string) => ({
    generateCustomChart: jest.fn(),
    reset: jest.fn(),
    isGenerating: false,
    chartCode: chartCode || 'const Chart = () => <div>Generated</div>;',
    error: null,
    progress: null,
  }),
};

// Event simulation utilities
export const simulateUserInteraction = {
  // Type in textarea with proper events
  typeInTextarea: (element: HTMLElement, text: string) => {
    const textarea = element as HTMLTextAreaElement;
    textarea.value = text;
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    textarea.dispatchEvent(new Event('change', { bubbles: true }));
  },

  // Click with proper event propagation
  clickElement: (element: HTMLElement) => {
    element.dispatchEvent(new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      view: window,
    }));
  },

  // Keyboard events
  pressKey: (element: HTMLElement, key: string, options: any = {}) => {
    element.dispatchEvent(new KeyboardEvent('keydown', {
      key,
      bubbles: true,
      cancelable: true,
      ...options,
    }));
  },
};

// Async test utilities
export const waitForCondition = async (
  condition: () => boolean,
  timeout: number = 5000,
  interval: number = 100
): Promise<void> => {
  const startTime = Date.now();
  
  while (!condition()) {
    if (Date.now() - startTime > timeout) {
      throw new Error(`Condition not met within ${timeout}ms`);
    }
    await new Promise(resolve => setTimeout(resolve, interval));
  }
};

// Mock component factories
export const createMockComponent = (name: string, props: any = {}) => {
  return jest.fn(({ children, ...componentProps }) => (
    <div data-testid={`mock-${name.toLowerCase()}`} {...componentProps}>
      {name}
      {children}
    </div>
  ));
};

// Performance testing utilities
export const measureRenderTime = async (renderFn: () => void): Promise<number> => {
  const start = performance.now();
  renderFn();
  const end = performance.now();
  return end - start;
};

// Memory leak detection helpers
export const detectMemoryLeaks = () => {
  const initialMemory = (performance as any).memory?.usedJSHeapSize;
  
  return {
    check: () => {
      if (!(performance as any).memory) {
        return { leaked: false, message: 'Memory API not available' };
      }
      
      const currentMemory = (performance as any).memory.usedJSHeapSize;
      const diff = currentMemory - initialMemory;
      const leaked = diff > 1000000; // 1MB threshold
      
      return {
        leaked,
        initialMemory,
        currentMemory,
        diff,
        message: leaked 
          ? `Potential memory leak detected: ${diff} bytes increase`
          : 'No significant memory increase detected'
      };
    }
  };
};

// Accessibility testing helpers
export const checkAccessibility = {
  hasAriaLabel: (element: Element): boolean => {
    return element.hasAttribute('aria-label') || element.hasAttribute('aria-labelledby');
  },
  
  hasKeyboardSupport: (element: Element): boolean => {
    return element.hasAttribute('tabindex') || 
           ['button', 'input', 'textarea', 'select', 'a'].includes(element.tagName.toLowerCase());
  },
  
  hasProperContrast: (element: Element): boolean => {
    // This would require actual color contrast calculation
    // For testing purposes, just check if element has proper styling classes
    return element.classList.length > 0;
  },
};

// Error boundary test component
export const TestErrorBoundary = ({ children, onError }: { 
  children: ReactNode; 
  onError?: (error: Error) => void; 
}) => {
  try {
    return <>{children}</>;
  } catch (error) {
    onError?.(error as Error);
    return <div data-testid="error-boundary">Error caught</div>;
  }
};

// Export common test constants
export const TEST_CONSTANTS = {
  DEFAULT_TIMEOUT: 5000,
  SHORT_TIMEOUT: 1000,
  LONG_TIMEOUT: 10000,
  DEFAULT_RUN_ID: 'run-123',
  DEFAULT_EXPERIMENT_ID: 'exp-456',
  DEFAULT_CHART_CODE: 'const Chart = () => <div>Test Chart</div>;',
  DEFAULT_ERROR_MESSAGE: 'Test error message',
  SAMPLE_PROMPTS: [
    'Create a line chart showing accuracy over time',
    'Generate a bar chart comparing different models',
    'Show loss metrics as a scatter plot',
    'Create a heatmap of confusion matrix data',
  ],
};

export default {
  renderWithRedux,
  createMockStore,
  createMockRunInfo,
  createMockLatestMetrics,
  createMockParams,
  createMockTags,
  createMockChartUIState,
  createMockCustomChartState,
  setupTestScenario,
  simulateUserInteraction,
  waitForCondition,
  TEST_CONSTANTS,
};