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
    chart_title?: string;  // Add chart title to the response
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
  chartTitle: string | null;
  error: string | null;
  progress: string | null;
}

interface UseCustomChartGenerationResult extends UseCustomChartGenerationState {
  generateCustomChart: (prompt: string, runId?: string, experimentId?: string) => Promise<void>;
  reset: () => void;
}

// API functions for chart generation
const generateChart = async (request: GenerateChartRequest): Promise<GenerateChartResponse> => {
  const response = await fetch('/ajax-api/2.0/mlflow/charts/generate', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.message || `HTTP ${response.status}: ${response.statusText}`);
  }

  return response.json();
};

const getChartStatus = async (requestId: string): Promise<ChartStatusResponse> => {
  const response = await fetch(`/ajax-api/2.0/mlflow/charts/status/${encodeURIComponent(requestId)}`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.message || `HTTP ${response.status}: ${response.statusText}`);
  }

  return response.json();
};

export const useCustomChartGeneration = (): UseCustomChartGenerationResult => {
  const [state, setState] = useState<UseCustomChartGenerationState>({
    isGenerating: false,
    requestId: null,
    chartCode: null,
    chartTitle: null,
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
        chartTitle: null,
        progress: 'Submitting request...', 
      }));

      const request: GenerateChartRequest = {
        prompt,
        ...(runId && { run_id: runId }),
        ...(experimentId && { experiment_id: experimentId }),
      };

      // Step 1: Submit generation request
      const generateResponse = await generateChart(request);
      
      setState(prev => ({
        ...prev,
        requestId: generateResponse.request_id,
        progress: 'Analyzing your request...',
      }));

      // Step 2: Poll for completion
      let attempts = 0;
      const maxAttempts = 30; // Increased for real backend
      
      while (attempts < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second
        
        const statusResponse: ChartStatusResponse = await getChartStatus(generateResponse.request_id);
        
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
            chartTitle: statusResponse.result?.chart_title || null,
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
      chartTitle: null,
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