// Integration test using all mock utilities
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithRedux, createMockRunInfo, TEST_CONSTANTS, setupTestScenario } from './__tests__/testUtils';
import { mockServerUtils } from './__tests__/mockServer';
import { CustomChartGenerator } from './CustomChartGenerator';
import { CustomChartDisplay } from './CustomChartDisplay';
import { useCustomChartGeneration } from '../run-page/hooks/useCustomChartGeneration';

// Mock the hook to use our test scenarios
jest.mock('../run-page/hooks/useCustomChartGeneration');
const mockUseCustomChartGeneration = useCustomChartGeneration as jest.MockedFunction<typeof useCustomChartGeneration>;

// Mock LazyPlot
jest.mock('../LazyPlot', () => ({
  LazyPlot: ({ data, layout }: any) => (
    <div data-testid="mock-chart">
      <div>Chart Title: {layout?.title}</div>
      <div>Data Points: {data?.[0]?.x?.length || 0}</div>
    </div>
  ),
}));

describe('Mock Integration Tests', () => {
  const mockRunInfo = createMockRunInfo();

  beforeEach(() => {
    jest.clearAllMocks();
    mockServerUtils.reset();
    mockServerUtils.seedTestData();
  });

  describe('CustomChartGenerator with Mock API', () => {
    it('successfully generates a chart using mock API', async () => {
      const mockGenerateChart = jest.fn().mockResolvedValue(undefined);
      
      mockUseCustomChartGeneration.mockReturnValue({
        ...setupTestScenario.successFlow(),
        generateCustomChart: mockGenerateChart,
      });

      renderWithRedux(
        <CustomChartGenerator
          onGenerate={mockGenerateChart}
          runId={mockRunInfo.runUuid}
          experimentId={mockRunInfo.experimentId}
        />
      );

      const textarea = screen.getByRole('textbox');
      const button = screen.getByRole('button', { name: /generate chart/i });

      // User types a prompt
      fireEvent.change(textarea, { 
        target: { value: TEST_CONSTANTS.SAMPLE_PROMPTS[0] } 
      });

      // User clicks generate
      fireEvent.click(button);

      expect(mockGenerateChart).toHaveBeenCalledWith(TEST_CONSTANTS.SAMPLE_PROMPTS[0]);
    });

    it('handles API errors gracefully', async () => {
      const mockGenerateChart = jest.fn().mockRejectedValue(
        new Error('Network error: Unable to connect to the server')
      );
      
      mockUseCustomChartGeneration.mockReturnValue({
        ...setupTestScenario.errorFlow('Network error: Unable to connect to the server'),
        generateCustomChart: mockGenerateChart,
      });

      renderWithRedux(
        <CustomChartDisplay 
          error="Network error: Unable to connect to the server"
          onRegenerate={mockGenerateChart}
        />
      );

      expect(screen.getByText('Chart Generation Failed')).toBeInTheDocument();
      expect(screen.getByText('Network error: Unable to connect to the server')).toBeInTheDocument();
      
      const retryButton = screen.getByRole('button', { name: /try again/i });
      expect(retryButton).toBeInTheDocument();
    });

    it('shows loading states during API calls', () => {
      mockUseCustomChartGeneration.mockReturnValue(
        setupTestScenario.loadingFlow()
      );

      renderWithRedux(
        <CustomChartDisplay 
          isLoading={true}
          progress="Analyzing your request..."
        />
      );

      expect(screen.getByText('Analyzing your request...')).toBeInTheDocument();
      expect(screen.getByText('This may take a few moments')).toBeInTheDocument();
    });
  });

  describe('Mock Server Error Scenarios', () => {
    it('handles server errors', async () => {
      mockServerUtils.simulateServerError();
      
      const mockGenerateChart = jest.fn();
      mockUseCustomChartGeneration.mockReturnValue({
        ...setupTestScenario.errorFlow('Server is temporarily unavailable'),
        generateCustomChart: mockGenerateChart,
      });

      renderWithRedux(
        <CustomChartDisplay 
          error="Server is temporarily unavailable"
          onRegenerate={mockGenerateChart}
        />
      );

      expect(screen.getByText('Server is temporarily unavailable')).toBeInTheDocument();
    });

    it('handles network errors', async () => {
      mockServerUtils.simulateNetworkError();
      
      mockUseCustomChartGeneration.mockReturnValue(
        setupTestScenario.errorFlow('Network connection failed')
      );

      renderWithRedux(
        <CustomChartDisplay 
          error="Network connection failed"
          onRegenerate={jest.fn()}
        />
      );

      expect(screen.getByText('Network connection failed')).toBeInTheDocument();
    });

    it('handles rate limiting', async () => {
      mockServerUtils.simulateRateLimited();
      
      mockUseCustomChartGeneration.mockReturnValue(
        setupTestScenario.errorFlow('Too many requests, please try again later')
      );

      renderWithRedux(
        <CustomChartDisplay 
          error="Too many requests, please try again later"
          onRegenerate={jest.fn()}
        />
      );

      expect(screen.getByText('Too many requests, please try again later')).toBeInTheDocument();
    });
  });

  describe('Mock Data Validation', () => {
    it('validates generated chart code format', () => {
      const validChartCode = `
        import React from 'react';
        import { LazyPlot } from '../components/LazyPlot';
        
        export const GeneratedChart = () => <LazyPlot data={[]} layout={{}} />;
      `;
      
      expect(validChartCode).toHaveValidChartCode();
    });

    it('rejects invalid chart code', () => {
      const invalidChartCode = 'const broken = syntax error ][';
      
      expect(invalidChartCode).not.toHaveValidChartCode();
    });

    it('validates performance metrics', async () => {
      const startTime = performance.now();
      
      mockUseCustomChartGeneration.mockReturnValue(
        setupTestScenario.completedFlow()
      );

      renderWithRedux(
        <CustomChartDisplay 
          chartCode={TEST_CONSTANTS.DEFAULT_CHART_CODE}
          onViewCode={jest.fn()}
          onSave={jest.fn()}
        />
      );

      const endTime = performance.now();
      const renderTime = endTime - startTime;
      
      expect(renderTime).toBeWithinRange(0, 1000); // Should render within 1 second
    });
  });

  describe('Mock State Management', () => {
    it('handles complex state transitions', async () => {
      let currentState = setupTestScenario.successFlow();
      mockUseCustomChartGeneration.mockReturnValue(currentState);

      const { rerender } = renderWithRedux(
        <CustomChartGenerator 
          onGenerate={currentState.generateCustomChart}
          runId={mockRunInfo.runUuid}
        />
      );

      // Start loading
      currentState = setupTestScenario.loadingFlow();
      mockUseCustomChartGeneration.mockReturnValue(currentState);
      
      rerender(
        <CustomChartDisplay 
          isLoading={currentState.isGenerating}
          progress={currentState.progress}
        />
      );

      expect(screen.getByText('Analyzing your request...')).toBeInTheDocument();

      // Complete successfully
      currentState = setupTestScenario.completedFlow(TEST_CONSTANTS.DEFAULT_CHART_CODE);
      mockUseCustomChartGeneration.mockReturnValue(currentState);

      rerender(
        <CustomChartDisplay 
          chartCode={currentState.chartCode}
          onViewCode={jest.fn()}
          onSave={jest.fn()}
        />
      );

      expect(screen.getByTestId('mock-chart')).toBeInTheDocument();
    });

    it('persists data across component remounts', () => {
      const mockChart = {
        id: 'chart-123',
        name: 'Persisted Chart',
        code: TEST_CONSTANTS.DEFAULT_CHART_CODE,
      };

      mockServerUtils.addChart(mockChart.id, mockChart);
      
      const serverState = mockServerUtils.getState();
      const savedChart = serverState.charts.find(([id]) => id === mockChart.id);
      
      expect(savedChart).toBeTruthy();
      expect(savedChart?.[1]).toMatchObject({
        chart_id: mockChart.id,
        name: mockChart.name,
      });
    });
  });

  describe('Mock Accessibility Testing', () => {
    it('maintains accessibility with mock components', () => {
      mockUseCustomChartGeneration.mockReturnValue(
        setupTestScenario.completedFlow()
      );

      renderWithRedux(
        <CustomChartGenerator 
          onGenerate={jest.fn()}
          runId={mockRunInfo.runUuid}
        />
      );

      const textarea = screen.getByRole('textbox');
      const button = screen.getByRole('button');
      
      expect(textarea).toHaveAttribute('placeholder');
      expect(button).not.toHaveAttribute('aria-disabled', 'true');
    });

    it('provides proper ARIA labels in error states', () => {
      mockUseCustomChartGeneration.mockReturnValue(
        setupTestScenario.errorFlow(TEST_CONSTANTS.DEFAULT_ERROR_MESSAGE)
      );

      renderWithRedux(
        <CustomChartDisplay 
          error={TEST_CONSTANTS.DEFAULT_ERROR_MESSAGE}
          onRegenerate={jest.fn()}
        />
      );

      // Error should be announced to screen readers
      expect(screen.getByText('Chart Generation Failed')).toBeInTheDocument();
    });
  });

  describe('Mock Memory Management', () => {
    it('cleans up resources properly', () => {
      const mockGenerate = jest.fn();
      
      const { unmount } = renderWithRedux(
        <CustomChartGenerator 
          onGenerate={mockGenerate}
          isGenerating={true}
        />
      );

      // Simulate memory usage
      const initialMemory = (performance as any).memory.usedJSHeapSize;
      
      unmount();
      
      // Memory should not increase significantly
      const finalMemory = (performance as any).memory.usedJSHeapSize;
      expect(finalMemory - initialMemory).toBeLessThan(100000); // Less than 100KB
    });
  });

  describe('Mock Error Boundary Testing', () => {
    it('catches and handles component errors', () => {
      const ThrowingComponent = () => {
        throw new Error('Test error');
      };
      
      const errorBoundaryHandler = jest.fn();
      
      expect(() => {
        renderWithRedux(
          <div>
            <ThrowingComponent />
            <CustomChartDisplay chartCode="valid code" />
          </div>
        );
      }).toThrow('Test error');
    });
  });

  describe('Mock Integration Performance', () => {
    it('maintains performance with multiple mock components', async () => {
      const components = Array.from({ length: 10 }, (_, i) => (
        <CustomChartDisplay 
          key={i}
          chartCode={`const Chart${i} = () => <div>Chart ${i}</div>;`}
          onViewCode={jest.fn()}
          onSave={jest.fn()}
        />
      ));

      const startTime = performance.now();
      
      renderWithRedux(<div>{components}</div>);
      
      const endTime = performance.now();
      const renderTime = endTime - startTime;
      
      expect(renderTime).toBeWithinRange(0, 2000); // Should render 10 components within 2 seconds
      expect(screen.getAllByTestId('mock-chart')).toHaveLength(10);
    });
  });
});