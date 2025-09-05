import { useState, useEffect, useCallback, useRef } from 'react';
import { ChartStatusResponse } from './useCustomChartGeneration';

interface UseCustomChartPollingOptions {
  requestId: string | null;
  onComplete: (chartCode: string) => void;
  onError: (error: string) => void;
  pollingInterval?: number;
  maxAttempts?: number;
}

interface UseCustomChartPollingResult {
  isPolling: boolean;
  attempts: number;
  status: 'idle' | 'pending' | 'processing' | 'completed' | 'failed';
  startPolling: () => void;
  stopPolling: () => void;
}

// Mock API function (will be replaced with real API calls in Phase 4)
const mockGetChartStatus = async (requestId: string): Promise<ChartStatusResponse> => {
  await new Promise(resolve => setTimeout(resolve, 500)); // Simulate network delay
  
  // Simulate progressive status updates
  const random = Math.random();
  if (random < 0.3) {
    return {
      request_id: requestId,
      status: 'pending',
    };
  } else if (random < 0.6) {
    return {
      request_id: requestId,
      status: 'processing',
    };
  } else if (random < 0.9) {
    return {
      request_id: requestId,
      status: 'completed',
      result: {
        chart_code: `
// Mock generated chart code for request ${requestId}
import React from 'react';
import { LazyPlot } from '../components/LazyPlot';

export const GeneratedChart = ({ data }) => {
  const plotlyConfig = {
    data: [{
      x: data?.metrics?.map(m => m.step) || [1, 2, 3, 4, 5],
      y: data?.metrics?.map(m => m.value) || [${Math.floor(Math.random() * 10)}, ${Math.floor(Math.random() * 10)}, ${Math.floor(Math.random() * 10)}, ${Math.floor(Math.random() * 10)}, ${Math.floor(Math.random() * 10)}],
      type: 'scatter',
      mode: 'lines+markers',
      name: 'Generated Metric',
      line: { color: '#${Math.floor(Math.random()*16777215).toString(16)}' }
    }],
    layout: {
      title: 'Custom Generated Chart',
      xaxis: { title: 'Steps' },
      yaxis: { title: 'Values' }
    }
  };
  
  return <LazyPlot data={plotlyConfig.data} layout={plotlyConfig.layout} />;
};`,
      },
    };
  } else {
    return {
      request_id: requestId,
      status: 'failed',
      error_message: 'Mock error: Chart generation failed randomly',
    };
  }
};

export const useCustomChartPolling = ({
  requestId,
  onComplete,
  onError,
  pollingInterval = 2000,
  maxAttempts = 30,
}: UseCustomChartPollingOptions): UseCustomChartPollingResult => {
  const [isPolling, setIsPolling] = useState(false);
  const [attempts, setAttempts] = useState(0);
  const [status, setStatus] = useState<'idle' | 'pending' | 'processing' | 'completed' | 'failed'>('idle');
  
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const attemptsRef = useRef(0);

  const poll = useCallback(async () => {
    if (!requestId || attemptsRef.current >= maxAttempts) {
      stopPolling();
      if (attemptsRef.current >= maxAttempts) {
        onError('Polling timeout: Chart generation took too long');
      }
      return;
    }

    try {
      const response = await mockGetChartStatus(requestId);
      setStatus(response.status);
      attemptsRef.current += 1;
      setAttempts(attemptsRef.current);

      switch (response.status) {
        case 'completed':
          if (response.result?.chart_code) {
            onComplete(response.result.chart_code);
          } else {
            onError('Chart generation completed but no code was returned');
          }
          stopPolling();
          break;

        case 'failed':
          onError(response.error_message || 'Chart generation failed');
          stopPolling();
          break;

        case 'pending':
        case 'processing':
          // Continue polling
          break;

        default:
          onError(`Unknown status: ${response.status}`);
          stopPolling();
          break;
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown polling error';
      onError(`Polling error: ${errorMessage}`);
      stopPolling();
    }
  }, [requestId, onComplete, onError, maxAttempts]);

  const startPolling = useCallback(() => {
    if (!requestId || isPolling) return;

    setIsPolling(true);
    setAttempts(0);
    setStatus('pending');
    attemptsRef.current = 0;

    // Start immediate poll
    poll();

    // Set up interval
    intervalRef.current = setInterval(poll, pollingInterval);
  }, [requestId, isPolling, poll, pollingInterval]);

  const stopPolling = useCallback(() => {
    setIsPolling(false);
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  // Auto-start polling when requestId changes
  useEffect(() => {
    if (requestId && !isPolling) {
      startPolling();
    }
    
    return () => {
      stopPolling();
    };
  }, [requestId, startPolling, stopPolling, isPolling]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopPolling();
    };
  }, [stopPolling]);

  return {
    isPolling,
    attempts,
    status,
    startPolling,
    stopPolling,
  };
};