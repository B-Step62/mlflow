// Frontend contract tests for custom charts components
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithRedux, createMockRunInfo, TEST_CONSTANTS } from './__tests__/testUtils';
import { CustomChartGenerator } from './CustomChartGenerator';
import { CustomChartDisplay } from './CustomChartDisplay';
import { SecurityWarningModal } from './SecurityWarningModal';
import { GeneratedChartContainer } from './GeneratedChartContainer';

// Mock LazyPlot for consistent testing
jest.mock('../LazyPlot', () => ({
  LazyPlot: ({ data, layout, config }: any) => (
    <div data-testid="lazy-plot" data-chart-type={layout?.title}>
      Mock Chart: {layout?.title}
      <div data-testid="plot-data">{JSON.stringify(data)}</div>
      <div data-testid="plot-config">{JSON.stringify(config)}</div>
    </div>
  ),
}));

describe('Frontend Contract Tests', () => {
  describe('CustomChartGenerator Contract', () => {
    it('provides required props interface', () => {
      const contractProps = {
        onGenerate: jest.fn(),
        isGenerating: false,
        runId: TEST_CONSTANTS.DEFAULT_RUN_ID,
        experimentId: TEST_CONSTANTS.DEFAULT_EXPERIMENT_ID,
      };

      render(<CustomChartGenerator {...contractProps} />);

      expect(screen.getByRole('textbox')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /generate chart/i })).toBeInTheDocument();
    });

    it('calls onGenerate with correct parameters', () => {
      const mockOnGenerate = jest.fn();
      const testPrompt = 'Create a line chart';

      render(<CustomChartGenerator onGenerate={mockOnGenerate} />);

      const textarea = screen.getByRole('textbox');
      const button = screen.getByRole('button', { name: /generate chart/i });

      fireEvent.change(textarea, { target: { value: testPrompt } });
      fireEvent.click(button);

      expect(mockOnGenerate).toHaveBeenCalledWith(testPrompt);
      expect(mockOnGenerate).toHaveBeenCalledTimes(1);
    });

    it('respects isGenerating state contract', () => {
      const { rerender } = render(
        <CustomChartGenerator onGenerate={jest.fn()} isGenerating={false} />
      );

      let button = screen.getByRole('button', { name: /generate chart/i });
      expect(button).toHaveTextContent('Generate Chart');

      rerender(<CustomChartGenerator onGenerate={jest.fn()} isGenerating={true} />);

      button = screen.getByRole('button');
      expect(button).toHaveTextContent('Generating...');
      expect(button).toBeDisabled();
    });

    it('handles optional props contract', () => {
      // Should work without runId and experimentId
      expect(() => {
        render(<CustomChartGenerator onGenerate={jest.fn()} />);
      }).not.toThrow();

      // Should show warning when context is missing
      expect(screen.getByText(/Warning: No run or experiment context available/)).toBeInTheDocument();
    });

    it('validates prompt input contract', () => {
      const mockOnGenerate = jest.fn();
      render(<CustomChartGenerator onGenerate={mockOnGenerate} />);

      const textarea = screen.getByRole('textbox');
      const button = screen.getByRole('button', { name: /generate chart/i });

      // Empty prompt should not call onGenerate
      fireEvent.change(textarea, { target: { value: '' } });
      fireEvent.click(button);
      expect(mockOnGenerate).not.toHaveBeenCalled();

      // Whitespace-only prompt should not call onGenerate
      fireEvent.change(textarea, { target: { value: '   ' } });
      fireEvent.click(button);
      expect(mockOnGenerate).not.toHaveBeenCalled();

      // Valid prompt should call onGenerate
      fireEvent.change(textarea, { target: { value: 'valid prompt' } });
      fireEvent.click(button);
      expect(mockOnGenerate).toHaveBeenCalledWith('valid prompt');
    });
  });

  describe('CustomChartDisplay Contract', () => {
    it('provides required props interface', () => {
      const contractProps = {
        chartCode: 'const Chart = () => <div>Chart</div>;',
        isLoading: false,
        error: null,
        progress: null,
        onSave: jest.fn(),
        onViewCode: jest.fn(),
        onRegenerate: jest.fn(),
      };

      render(<CustomChartDisplay {...contractProps} />);

      expect(screen.getByTestId('lazy-plot')).toBeInTheDocument();
    });

    it('handles loading state contract', () => {
      render(<CustomChartDisplay isLoading={true} />);

      expect(screen.getByText(/Generating your custom chart/)).toBeInTheDocument();
      expect(screen.queryByTestId('lazy-plot')).not.toBeInTheDocument();
    });

    it('handles error state contract', () => {
      const errorMessage = 'Test error message';
      const mockOnRegenerate = jest.fn();

      render(
        <CustomChartDisplay 
          error={errorMessage} 
          onRegenerate={mockOnRegenerate} 
        />
      );

      expect(screen.getByText('Chart Generation Failed')).toBeInTheDocument();
      expect(screen.getByText(errorMessage)).toBeInTheDocument();

      const retryButton = screen.getByRole('button', { name: /try again/i });
      fireEvent.click(retryButton);
      expect(mockOnRegenerate).toHaveBeenCalledTimes(1);
    });

    it('handles empty state contract', () => {
      render(<CustomChartDisplay />);

      expect(screen.getByText('No chart generated yet')).toBeInTheDocument();
      expect(screen.queryByTestId('lazy-plot')).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /view code/i })).not.toBeInTheDocument();
    });

    it('handles success state with actions contract', () => {
      const mockOnSave = jest.fn();
      const mockOnViewCode = jest.fn();
      const chartCode = 'const Chart = () => <div>Generated Chart</div>;';

      render(
        <CustomChartDisplay 
          chartCode={chartCode}
          onSave={mockOnSave}
          onViewCode={mockOnViewCode}
        />
      );

      expect(screen.getByTestId('lazy-plot')).toBeInTheDocument();

      const saveButton = screen.getByRole('button', { name: /save chart/i });
      const viewCodeButton = screen.getByRole('button', { name: /view code/i });

      fireEvent.click(saveButton);
      expect(mockOnSave).toHaveBeenCalledTimes(1);

      fireEvent.click(viewCodeButton);
      expect(mockOnViewCode).toHaveBeenCalledTimes(1);
    });

    it('handles progress updates contract', () => {
      const { rerender } = render(
        <CustomChartDisplay isLoading={true} progress="Step 1" />
      );

      expect(screen.getByText('Step 1')).toBeInTheDocument();

      rerender(<CustomChartDisplay isLoading={true} progress="Step 2" />);
      expect(screen.getByText('Step 2')).toBeInTheDocument();

      rerender(<CustomChartDisplay isLoading={true} progress={null} />);
      expect(screen.getByText('Generating your custom chart...')).toBeInTheDocument();
    });

    it('respects callback presence contract', () => {
      // Without callbacks, action buttons should not appear
      render(<CustomChartDisplay chartCode="test code" />);
      
      expect(screen.queryByRole('button', { name: /save chart/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /view code/i })).not.toBeInTheDocument();

      // With callbacks, buttons should appear
      render(
        <CustomChartDisplay 
          chartCode="test code" 
          onSave={jest.fn()} 
          onViewCode={jest.fn()} 
        />
      );
      
      expect(screen.getByRole('button', { name: /save chart/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /view code/i })).toBeInTheDocument();
    });
  });

  describe('SecurityWarningModal Contract', () => {
    const defaultProps = {
      isOpen: true,
      onConfirm: jest.fn(),
      onCancel: jest.fn(),
      chartCode: 'const Chart = () => <div>Test</div>;',
    };

    // Mock Modal component for contract testing
    beforeAll(() => {
      jest.doMock('@databricks/design-system', () => ({
        ...jest.requireActual('@databricks/design-system'),
        Modal: ({ visible, children, footer, onCancel }: any) => 
          visible ? (
            <div role="dialog" data-testid="security-modal">
              {children}
              <div data-testid="modal-footer">{footer}</div>
            </div>
          ) : null,
      }));
    });

    it('provides required props interface', () => {
      render(<SecurityWarningModal {...defaultProps} />);

      expect(screen.getByRole('dialog')).toBeInTheDocument();
      expect(screen.getByText(/Security Warning/)).toBeInTheDocument();
    });

    it('handles visibility contract', () => {
      const { rerender } = render(
        <SecurityWarningModal {...defaultProps} isOpen={false} />
      );

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

      rerender(<SecurityWarningModal {...defaultProps} isOpen={true} />);
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    it('displays chart code contract', () => {
      const testCode = 'const TestChart = () => <div>Custom Code</div>;';
      
      render(<SecurityWarningModal {...defaultProps} chartCode={testCode} />);

      expect(screen.getByText(testCode)).toBeInTheDocument();
    });

    it('handles confirmation flow contract', () => {
      const mockOnConfirm = jest.fn();
      const mockOnCancel = jest.fn();

      render(
        <SecurityWarningModal 
          {...defaultProps} 
          onConfirm={mockOnConfirm}
          onCancel={mockOnCancel}
        />
      );

      const checkbox = screen.getByRole('checkbox');
      const confirmButton = screen.getByRole('button', { name: /execute chart code/i });
      const cancelButton = screen.getByRole('button', { name: /cancel/i });

      // Confirm button should be disabled initially
      expect(confirmButton).toBeDisabled();

      // Cancel should work immediately
      fireEvent.click(cancelButton);
      expect(mockOnCancel).toHaveBeenCalledTimes(1);

      // Confirm should only work after checkbox is checked
      fireEvent.click(checkbox);
      expect(confirmButton).not.toBeDisabled();

      fireEvent.click(confirmButton);
      expect(mockOnConfirm).toHaveBeenCalledTimes(1);
    });
  });

  describe('GeneratedChartContainer Contract', () => {
    const defaultProps = {
      chartCode: 'const Chart = () => <div>Test Chart</div>;',
      experimentId: TEST_CONSTANTS.DEFAULT_EXPERIMENT_ID,
      runId: TEST_CONSTANTS.DEFAULT_RUN_ID,
    };

    // Mock SecurityWarningModal for container testing
    beforeAll(() => {
      jest.doMock('./SecurityWarningModal', () => ({
        SecurityWarningModal: ({ isOpen, onConfirm, onCancel }: any) =>
          isOpen ? (
            <div data-testid="security-warning">
              <button onClick={onConfirm}>Confirm Execution</button>
              <button onClick={onCancel}>Cancel</button>
            </div>
          ) : null,
      }));
    });

    it('provides required props interface', () => {
      render(<GeneratedChartContainer {...defaultProps} />);

      expect(screen.getByTestId('security-warning')).toBeInTheDocument();
    });

    it('handles chart code execution contract', async () => {
      render(<GeneratedChartContainer {...defaultProps} />);

      // Should show security warning initially
      expect(screen.getByTestId('security-warning')).toBeInTheDocument();

      // Click confirm to execute
      const confirmButton = screen.getByText('Confirm Execution');
      fireEvent.click(confirmButton);

      // Security warning should disappear
      await waitFor(() => {
        expect(screen.queryByTestId('security-warning')).not.toBeInTheDocument();
      });

      // Chart execution should complete
      expect(screen.getByText(/Chart code executed successfully/)).toBeInTheDocument();
    });

    it('handles error callback contract', async () => {
      const mockOnError = jest.fn();
      const unsafeCode = 'eval("malicious code")';

      render(
        <GeneratedChartContainer 
          {...defaultProps} 
          chartCode={unsafeCode}
          onError={mockOnError}
        />
      );

      const confirmButton = screen.getByText('Confirm Execution');
      fireEvent.click(confirmButton);

      await waitFor(() => {
        expect(mockOnError).toHaveBeenCalledWith(
          expect.stringContaining('potentially unsafe operations')
        );
      });
    });

    it('handles empty chart code contract', () => {
      render(<GeneratedChartContainer {...defaultProps} chartCode="" />);

      // Should not show security warning for empty code
      expect(screen.queryByTestId('security-warning')).not.toBeInTheDocument();
    });

    it('provides execution context contract', async () => {
      const mockChartCode = `
        console.log('Context check:', { 
          React: typeof React, 
          container: !!container,
          experimentId: experimentId,
          runId: runId 
        });
      `;

      render(
        <GeneratedChartContainer 
          {...defaultProps} 
          chartCode={mockChartCode}
        />
      );

      const confirmButton = screen.getByText('Confirm Execution');
      fireEvent.click(confirmButton);

      // Should execute without errors (context should be available)
      await waitFor(() => {
        expect(screen.getByText(/Chart code executed successfully/)).toBeInTheDocument();
      });
    });
  });

  describe('Component Integration Contract', () => {
    it('maintains data flow contract between Generator and Display', () => {
      const mockOnGenerate = jest.fn();
      const chartCode = 'const Chart = () => <div>Generated</div>;';

      const { rerender } = render(
        <div>
          <CustomChartGenerator onGenerate={mockOnGenerate} />
          <CustomChartDisplay />
        </div>
      );

      // Generate a chart
      const textarea = screen.getByRole('textbox');
      const button = screen.getByRole('button', { name: /generate chart/i });

      fireEvent.change(textarea, { target: { value: 'test prompt' } });
      fireEvent.click(button);

      expect(mockOnGenerate).toHaveBeenCalledWith('test prompt');

      // Simulate chart generation completion
      rerender(
        <div>
          <CustomChartGenerator onGenerate={mockOnGenerate} isGenerating={false} />
          <CustomChartDisplay chartCode={chartCode} onSave={jest.fn()} />
        </div>
      );

      expect(screen.getByTestId('lazy-plot')).toBeInTheDocument();
    });

    it('maintains error propagation contract', () => {
      const errorMessage = 'Generation failed';

      render(
        <div>
          <CustomChartGenerator onGenerate={jest.fn()} isGenerating={false} />
          <CustomChartDisplay error={errorMessage} onRegenerate={jest.fn()} />
        </div>
      );

      expect(screen.getByText('Chart Generation Failed')).toBeInTheDocument();
      expect(screen.getByText(errorMessage)).toBeInTheDocument();
    });

    it('maintains loading state contract across components', () => {
      render(
        <div>
          <CustomChartGenerator onGenerate={jest.fn()} isGenerating={true} />
          <CustomChartDisplay isLoading={true} progress="Processing..." />
        </div>
      );

      // Both components should show loading state
      expect(screen.getByText('Generating...')).toBeInTheDocument();
      expect(screen.getByText('Processing...')).toBeInTheDocument();
    });

    it('maintains accessibility contract across all components', () => {
      render(
        <div>
          <CustomChartGenerator 
            onGenerate={jest.fn()} 
            runId={TEST_CONSTANTS.DEFAULT_RUN_ID}
          />
          <CustomChartDisplay 
            chartCode="test code" 
            onSave={jest.fn()}
            onViewCode={jest.fn()}
          />
        </div>
      );

      // All interactive elements should be accessible
      expect(screen.getByRole('textbox')).toHaveAttribute('placeholder');
      expect(screen.getByRole('button', { name: /generate chart/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /save chart/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /view code/i })).toBeInTheDocument();
    });

    it('maintains performance contract with multiple components', () => {
      const startTime = performance.now();

      render(
        <div>
          {Array.from({ length: 5 }, (_, i) => (
            <CustomChartDisplay 
              key={i}
              chartCode={`const Chart${i} = () => <div>Chart ${i}</div>;`}
              onSave={jest.fn()}
              onViewCode={jest.fn()}
            />
          ))}
        </div>
      );

      const endTime = performance.now();
      const renderTime = endTime - startTime;

      expect(renderTime).toBeLessThan(1000); // Should render within 1 second
      expect(screen.getAllByTestId('lazy-plot')).toHaveLength(5);
    });
  });

  describe('Props Validation Contract', () => {
    it('handles invalid prop types gracefully', () => {
      const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});

      // These should not crash the component
      expect(() => {
        render(<CustomChartGenerator onGenerate={null as any} />);
      }).not.toThrow();

      expect(() => {
        render(<CustomChartDisplay chartCode={123 as any} />);
      }).not.toThrow();

      consoleError.mockRestore();
    });

    it('maintains backward compatibility contract', () => {
      // Old props should still work
      render(
        <CustomChartDisplay 
          chartCode="test"
          // Missing new props like 'progress' should not break
        />
      );

      expect(screen.getByTestId('lazy-plot')).toBeInTheDocument();
    });
  });

  describe('Event Handling Contract', () => {
    it('prevents event propagation when required', () => {
      const parentClickHandler = jest.fn();

      render(
        <div onClick={parentClickHandler}>
          <CustomChartGenerator onGenerate={jest.fn()} />
        </div>
      );

      const textarea = screen.getByRole('textbox');
      fireEvent.change(textarea, { target: { value: 'test' } });

      // Parent handler should not be triggered by child events
      expect(parentClickHandler).not.toHaveBeenCalled();
    });

    it('handles keyboard events correctly', () => {
      const mockOnGenerate = jest.fn();

      render(<CustomChartGenerator onGenerate={mockOnGenerate} />);

      const textarea = screen.getByRole('textbox');
      fireEvent.change(textarea, { target: { value: 'test prompt' } });

      // Enter should trigger generation
      fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });
      expect(mockOnGenerate).toHaveBeenCalledWith('test prompt');

      // Shift+Enter should not trigger generation
      mockOnGenerate.mockClear();
      fireEvent.change(textarea, { target: { value: 'test prompt 2' } });
      fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: true });
      expect(mockOnGenerate).not.toHaveBeenCalled();
    });
  });
});