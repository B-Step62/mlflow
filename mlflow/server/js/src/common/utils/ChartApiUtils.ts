/**
 * Utilities for Custom Chart Generation API calls.
 * This file contains mock implementations that will be replaced with actual API calls in Phase 4.
 */

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

export interface SaveChartRequest {
  chart_code: string;
  chart_config?: any;
  experiment_id: string;
  name: string;
  data_sources?: Array<any>;
}

export interface SaveChartResponse {
  chart_id: string;
  artifact_uri: string;
}

export interface DeleteChartResponse {
  success: boolean;
  message?: string;
}

export interface ListChartsResponse {
  charts: Array<{
    chart_id: string;
    name: string;
    artifact_uri: string;
    created_at: string;
    created_by: string;
  }>;
}

/**
 * Mock implementation: Generate a custom chart from natural language prompt
 */
export const generateChart = async (request: GenerateChartRequest): Promise<GenerateChartResponse> => {
  // TODO: Replace with actual API call to POST /api/2.0/mlflow/charts/generate
  await new Promise(resolve => setTimeout(resolve, 500)); // Simulate network delay
  
  return {
    request_id: `mock-request-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    status: 'pending' as const,
  };
};

/**
 * Mock implementation: Get the status of a chart generation request
 */
export const getChartStatus = async (requestId: string): Promise<ChartStatusResponse> => {
  // TODO: Replace with actual API call to GET /api/2.0/mlflow/charts/status/{request_id}
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

/**
 * Mock implementation: Save a generated chart as an artifact
 */
export const saveChart = async (request: SaveChartRequest): Promise<SaveChartResponse> => {
  // TODO: Replace with actual API call to POST /api/2.0/mlflow/charts/save
  await new Promise(resolve => setTimeout(resolve, 400)); // Simulate network delay
  
  return {
    chart_id: `mock-chart-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    artifact_uri: `mlflow-artifacts:/${request.experiment_id}/charts/${request.name.replace(/\s+/g, '-').toLowerCase()}.json`
  };
};

/**
 * Mock implementation: List saved charts for an experiment
 */
export const listCharts = async (experimentId: string): Promise<ListChartsResponse> => {
  // TODO: Replace with actual API call to GET /api/2.0/mlflow/charts/list/{experiment_id}
  await new Promise(resolve => setTimeout(resolve, 200)); // Simulate network delay
  
  return {
    charts: [
      {
        chart_id: 'mock-chart-1',
        name: 'Sample Accuracy Chart',
        artifact_uri: `mlflow-artifacts:/${experimentId}/charts/sample-accuracy-chart.json`,
        created_at: new Date(Date.now() - 86400000).toISOString(), // 1 day ago
        created_by: 'mock-user@example.com'
      },
      {
        chart_id: 'mock-chart-2', 
        name: 'Loss Comparison',
        artifact_uri: `mlflow-artifacts:/${experimentId}/charts/loss-comparison.json`,
        created_at: new Date(Date.now() - 3600000).toISOString(), // 1 hour ago
        created_by: 'mock-user@example.com'
      }
    ]
  };
};

/**
 * Helper function to validate chart generation request
 */
export const validateChartRequest = (request: GenerateChartRequest): string | null => {
  if (!request.prompt || request.prompt.trim().length === 0) {
    return 'Prompt is required';
  }
  
  if (request.prompt.length > 1000) {
    return 'Prompt must be less than 1000 characters';
  }
  
  if (!request.run_id && !request.experiment_id) {
    return 'Either run_id or experiment_id must be provided';
  }
  
  return null;
};

/**
 * Helper function to validate save chart request
 */
export const validateSaveChartRequest = (request: SaveChartRequest): string | null => {
  if (!request.chart_code || request.chart_code.trim().length === 0) {
    return 'Chart code is required';
  }
  
  if (!request.experiment_id || request.experiment_id.trim().length === 0) {
    return 'Experiment ID is required';
  }
  
  if (!request.name || request.name.trim().length === 0) {
    return 'Chart name is required';
  }
  
  if (request.name.length > 100) {
    return 'Chart name must be less than 100 characters';
  }
  
  return null;
};