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
        chart_title: 'Test F1 Score by Step',
        chart_code: `
// Generated chart code that fetches real MLflow metrics
const GeneratedChart = ({ runId, experimentId }) => {
  const [metrics, setMetrics] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  
  useEffect(() => {
    const fetchMetrics = async () => {
      try {
        setLoading(true);
        
        // First, get the run details to see available metrics
        const runResponse = await fetch(\`/ajax-api/2.0/mlflow/runs/get?run_id=\${runId}\`, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          }
        });
        
        if (!runResponse.ok) {
          throw new Error('Failed to fetch run details. Error: ' + runResponse.statusText);
        }
        
        const runData = await runResponse.json();
        const availableMetrics = runData.run?.data?.metrics || [];
        
        // Look for test_f1 metric specifically
        const targetMetricKey = 'test_f1';
        const targetMetric = availableMetrics.find(m => m.key === targetMetricKey);
        
        if (!targetMetric) {
          // If test_f1 not found, list available metrics for debugging
          const availableKeys = availableMetrics.map(m => m.key).join(', ');
          throw new Error(
            availableKeys.length > 0 
              ? \`Metric '\${targetMetricKey}' not found. Available metrics: \${availableKeys}\`
              : 'No metrics found in this run'
          );
        }
        
        // Fetch the test_f1 metric history
        const historyParams = new URLSearchParams({
          run_id: runId,
          metric_key: targetMetricKey,
          max_results: '1000'
        });
        const historyResponse = await fetch(\`/ajax-api/2.0/mlflow/metrics/get-history?\${historyParams}\`, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          }
        });
        
        if (!historyResponse.ok) {
          throw new Error(\`Failed to fetch metric history for '\${targetMetricKey}': \${historyResponse.statusText}\`);
        }
        
        const historyData = await historyResponse.json();
        const metricValues = historyData.metrics || [];
        
        if (metricValues.length === 0) {
          throw new Error(\`No values found for metric '\${targetMetricKey}'\`);
        }
        
        setMetrics(metricValues);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };
    
    if (runId) {
      fetchMetrics();
    }
  }, [runId]);
  
  if (loading) {
    return React.createElement('div', {
      style: { 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'center', 
        height: '400px',
        border: '1px solid #d9d9d9',
        borderRadius: '6px'
      }
    }, 'Loading metrics...');
  }
  
  if (error) {
    return React.createElement('div', {
      style: { 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'center', 
        height: '400px',
        border: '1px solid #ff4d4f',
        borderRadius: '6px',
        color: '#ff4d4f'
      }
    }, 'Error: ' + error);
  }
  
  // Prepare data for Plotly bar chart
  const plotlyConfig = {
    data: [{
      x: metrics.map((m, i) => m.step !== undefined ? m.step : i),
      y: metrics.map(m => m.value),
      type: 'bar',
      name: 'test_f1',
      marker: { 
        color: metrics.map(m => m.value),
        colorscale: [
          [0, '#ff4444'],
          [0.5, '#ffaa00'],
          [1, '#00aa00']
        ],
        cmin: 0,
        cmax: 1,
        showscale: true,
        colorbar: {
          title: 'F1 Score',
          thickness: 15,
          len: 0.7
        }
      },
      text: metrics.map(m => m.value.toFixed(4)),
      textposition: 'outside',
      hovertemplate: 'Step: %{x}<br>F1 Score: %{y:.4f}<extra></extra>'
    }],
    layout: {
      // Not adding title here because we want to make it configurable via MLflow UI.
      xaxis: {
        title: 'Step',
        gridcolor: '#e0e0e0',
        type: 'category'
      },
      yaxis: {
        title: 'F1 Score',
        gridcolor: '#e0e0e0',
        range: [0, 1.1]
      },
      margin: { l: 60, r: 100, b: 50, t: 20 },
      paper_bgcolor: 'transparent',
      plot_bgcolor: 'transparent',
      hovermode: 'x unified',
      bargap: 0.2
    }
  };
  
  return React.createElement(LazyPlot, {
    data: plotlyConfig.data,
    layout: plotlyConfig.layout,
    style: { width: '100%', height: '100%' },
    useResizeHandler: true
  });
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