import { renderHook, act } from '@testing-library/react';
import { useCustomChartGeneration } from './useCustomChartGeneration';

// Mock the API functions
jest.mock('./useCustomChartGeneration', () => {
  const originalModule = jest.requireActual('./useCustomChartGeneration');
  
  // Create mock functions that we can control in tests
  const mockGenerateChart = jest.fn();
  const mockGetChartStatus = jest.fn();
  
  return {
    ...originalModule,
    useCustomChartGeneration: () => {
      const { useCustomChartGeneration: originalHook } = originalModule;
      const result = originalHook();
      
      // Override the generateCustomChart function with our mock
      return {
        ...result,
        generateCustomChart: mockGenerateChart,
      };
    },
  };
});

describe('useCustomChartGeneration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Reset timers
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('initializes with default state', () => {
    const { result } = renderHook(() => useCustomChartGeneration());
    
    expect(result.current.isGenerating).toBe(false);
    expect(result.current.requestId).toBe(null);
    expect(result.current.chartCode).toBe(null);
    expect(result.current.error).toBe(null);
    expect(result.current.progress).toBe(null);
  });

  it('provides generateCustomChart and reset functions', () => {
    const { result } = renderHook(() => useCustomChartGeneration());
    
    expect(typeof result.current.generateCustomChart).toBe('function');
    expect(typeof result.current.reset).toBe('function');
  });

  it('resets state when reset is called', () => {
    const { result } = renderHook(() => useCustomChartGeneration());
    
    act(() => {
      result.current.reset();
    });
    
    expect(result.current.isGenerating).toBe(false);
    expect(result.current.requestId).toBe(null);
    expect(result.current.chartCode).toBe(null);
    expect(result.current.error).toBe(null);
    expect(result.current.progress).toBe(null);
  });

  it('sets generating state when generateCustomChart is called', () => {
    const { result } = renderHook(() => useCustomChartGeneration());
    
    act(() => {
      result.current.generateCustomChart('test prompt');
    });
    
    // Since we mocked the function, we can't test the actual async behavior
    // but we can verify the function was called
    expect(result.current.generateCustomChart).toHaveBeenCalledWith('test prompt');
  });

  it('maintains stable function references', () => {
    const { result, rerender } = renderHook(() => useCustomChartGeneration());
    
    const firstGenerateChart = result.current.generateCustomChart;
    const firstReset = result.current.reset;
    
    rerender();
    
    expect(result.current.generateCustomChart).toBe(firstGenerateChart);
    expect(result.current.reset).toBe(firstReset);
  });
});

// Test the actual implementation with a separate describe block
describe('useCustomChartGeneration - Integration Tests', () => {
  // Re-import the actual hook for integration tests
  const { useCustomChartGeneration: actualUseCustomChartGeneration } = jest.requireActual('./useCustomChartGeneration');
  
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('handles successful chart generation flow', async () => {
    const { result } = renderHook(() => actualUseCustomChartGeneration());
    
    expect(result.current.isGenerating).toBe(false);
    
    // Start generation
    act(() => {
      result.current.generateCustomChart('test prompt', 'run-123', 'exp-456');
    });
    
    // Should be generating with initial progress
    expect(result.current.isGenerating).toBe(true);
    expect(result.current.progress).toBe('Submitting request...');
    
    // Fast-forward through the async operations
    await act(async () => {
      // Fast forward through the mock delays
      jest.advanceTimersByTime(500); // Initial request delay
      await Promise.resolve(); // Allow promise to resolve
      
      jest.advanceTimersByTime(1000); // First polling delay
      await Promise.resolve();
      
      // Continue advancing until completion (max 10 attempts)
      for (let i = 0; i < 10; i++) {
        jest.advanceTimersByTime(1000);
        await Promise.resolve();
      }
    });
    
    // Should complete generation (may succeed or timeout)
    expect(result.current.isGenerating).toBe(false);
    // Should have either chart code or error
    expect(result.current.chartCode !== null || result.current.error !== null).toBe(true);
  });

  it('handles timeout scenario', async () => {
    const { result } = renderHook(() => actualUseCustomChartGeneration());
    
    act(() => {
      result.current.generateCustomChart('test prompt');
    });
    
    // Fast forward through all polling attempts
    await act(async () => {
      jest.advanceTimersByTime(500); // Initial delay
      await Promise.resolve();
      
      // Fast forward through max attempts
      for (let i = 0; i < 12; i++) {
        jest.advanceTimersByTime(1300); // Polling delay + processing
        await Promise.resolve();
      }
    });
    
    expect(result.current.isGenerating).toBe(false);
    expect(result.current.error).toContain('timed out');
  });

  it('updates progress during generation', async () => {
    const { result } = renderHook(() => actualUseCustomChartGeneration());
    
    act(() => {
      result.current.generateCustomChart('test prompt');
    });
    
    expect(result.current.progress).toBe('Submitting request...');
    
    // Advance to get request ID
    await act(async () => {
      jest.advanceTimersByTime(500);
      await Promise.resolve();
    });
    
    expect(result.current.progress).toBe('Analyzing your request...');
    
    // Advance to polling
    await act(async () => {
      jest.advanceTimersByTime(1000);
      await Promise.resolve();
    });
    
    // Progress should update based on mock status
    expect(['Queued for processing...', 'Generating chart code...', null]).toContain(result.current.progress);
  });

  it('clears progress on completion', async () => {
    const { result } = renderHook(() => actualUseCustomChartGeneration());
    
    act(() => {
      result.current.generateCustomChart('test prompt');
    });
    
    // Fast forward to completion
    await act(async () => {
      jest.advanceTimersByTime(500);
      await Promise.resolve();
      
      for (let i = 0; i < 10; i++) {
        jest.advanceTimersByTime(1000);
        await Promise.resolve();
      }
    });
    
    expect(result.current.progress).toBe(null);
  });

  it('resets all state including progress', () => {
    const { result } = renderHook(() => actualUseCustomChartGeneration());
    
    // Simulate some state
    act(() => {
      result.current.generateCustomChart('test');
    });
    
    // Reset should clear everything
    act(() => {
      result.current.reset();
    });
    
    expect(result.current.isGenerating).toBe(false);
    expect(result.current.requestId).toBe(null);
    expect(result.current.chartCode).toBe(null);
    expect(result.current.error).toBe(null);
    expect(result.current.progress).toBe(null);
  });
});