import { useState, useCallback } from 'react';

export interface GenerateChartRequest {
  prompt: string;
  run_id?: string;
  experiment_id?: string;
}

export interface GenerateChartResponse {
  request_id: string;
  status: 'pending';
}

export interface ChartStatusResponse {
  request_id: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  result?: {
    chart_code: string;
    chart_config?: any;
    data_sources?: Array<{
      type: 'metric' | 'artifact';
      name: string;
      path: string;
    }>;
  };
  error_message?: string;
}

interface UseCustomChartGenerationState {
  isGenerating: boolean;
  requestId: string | null;
  chartCode: string | null;
  error: string | null;
  progress: string | null;
}

interface UseCustomChartGenerationResult extends UseCustomChartGenerationState {
  generateCustomChart: (prompt: string, runId?: string, experimentId?: string) => Promise<void>;
  reset: () => void;
}

// Mock API functions (will be replaced with real API calls in Phase 4)
const mockGenerateChart = async (request: GenerateChartRequest): Promise<GenerateChartResponse> => {
  await new Promise(resolve => setTimeout(resolve, 500)); // Simulate network delay
  
  return {
    request_id: `mock-request-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    status: 'pending' as const,
  };
};

const mockGetChartStatus = async (requestId: string): Promise<ChartStatusResponse> => {
  await new Promise(resolve => setTimeout(resolve, 300)); // Simulate network delay
  
  // Mock progressive status updates
  const mockStatuses = ['pending', 'processing', 'completed'] as const;
  const randomStatus = mockStatuses[Math.floor(Math.random() * mockStatuses.length)];
  
  if (randomStatus === 'completed') {
    return {
      request_id: requestId,
      status: 'completed',
      result: {
        chart_code: `
// Mock generated chart code
import React from 'react';
import { LazyPlot } from '../components/LazyPlot';

export const GeneratedChart = ({ data }) => {
  const plotlyConfig = {
    data: [{
      x: data?.metrics?.map(m => m.step) || [1, 2, 3, 4, 5],
      y: data?.metrics?.map(m => m.value) || [1, 4, 2, 8, 5],
      type: 'scatter',
      mode: 'lines+markers',
      name: 'Sample Metric',
      line: { color: '#1890ff' }
    }],
    layout: {
      title: 'Generated Chart Example',
      xaxis: { title: 'Step' },
      yaxis: { title: 'Value' }
    }
  };
  
  return <LazyPlot data={plotlyConfig.data} layout={plotlyConfig.layout} />;
};`,
        data_sources: [
          {
            type: 'metric' as const,
            name: 'example_metric',
            path: '/api/2.0/mlflow/runs/get-metric'
          }
        ]
      }
    };
  }
  
  return {
    request_id: requestId,
    status: randomStatus,
    ...(randomStatus === 'failed' && { error_message: 'Mock error: Chart generation failed' })
  };
};

export const useCustomChartGeneration = (): UseCustomChartGenerationResult => {
  const [state, setState] = useState<UseCustomChartGenerationState>({
    isGenerating: false,
    requestId: null,
    chartCode: null,
    error: null,
    progress: null,
  });

  const generateCustomChart = useCallback(async (
    prompt: string,
    runId?: string,
    experimentId?: string
  ) => {
    try {
      setState(prev => ({
        ...prev,
        isGenerating: true,
        error: null,
        requestId: null,
        chartCode: null,
        progress: 'Submitting request...',
      }));

      const request: GenerateChartRequest = {
        prompt,
        ...(runId && { run_id: runId }),
        ...(experimentId && { experiment_id: experimentId }),
      };

      // Step 1: Submit generation request
      const generateResponse = await mockGenerateChart(request);
      
      setState(prev => ({
        ...prev,
        requestId: generateResponse.request_id,
        progress: 'Analyzing your request...',
      }));

      // Step 2: Poll for completion (mock implementation)
      let attempts = 0;
      const maxAttempts = 10;
      
      while (attempts < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second
        
        const statusResponse: ChartStatusResponse = await mockGetChartStatus(generateResponse.request_id);
        
        // Update progress based on status
        if (statusResponse.status === 'pending') {
          setState(prev => ({ ...prev, progress: 'Queued for processing...' }));
        } else if (statusResponse.status === 'processing') {
          setState(prev => ({ ...prev, progress: 'Generating chart code...' }));
        }
        
        if (statusResponse.status === 'completed') {
          setState(prev => ({
            ...prev,
            isGenerating: false,
            chartCode: statusResponse.result?.chart_code || null,
            progress: null,
          }));
          return;
        }
        
        if (statusResponse.status === 'failed') {
          throw new Error(statusResponse.error_message || 'Chart generation failed');
        }
        
        attempts++;
      }
      
      // Timeout
      throw new Error('Chart generation timed out');
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      setState(prev => ({
        ...prev,
        isGenerating: false,
        error: errorMessage,
        progress: null,
      }));
    }
  }, []);

  const reset = useCallback(() => {
    setState({
      isGenerating: false,
      requestId: null,
      chartCode: null,
      error: null,
      progress: null,
    });
  }, []);

  return {
    ...state,
    generateCustomChart,
    reset,
  };
};