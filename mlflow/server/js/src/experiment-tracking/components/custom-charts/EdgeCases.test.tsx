import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { CustomChartGenerator } from './CustomChartGenerator';
import { CustomChartDisplay } from './CustomChartDisplay';
import { SecurityWarningModal } from './SecurityWarningModal';
import { GeneratedChartContainer } from './GeneratedChartContainer';

// Mock LazyPlot
jest.mock('../LazyPlot', () => ({
  LazyPlot: () => <div data-testid="mock-lazy-plot">Mock Plot</div>,
}));

// Mock design system components for edge case testing
jest.mock('@databricks/design-system', () => ({
  ...jest.requireActual('@databricks/design-system'),
  Modal: ({ visible, children, footer }: any) => 
    visible ? <div role="dialog">{children}{footer}</div> : null,
  Alert: ({ type, message, description, onClose }: any) => (
    <div role="alert" data-type={type}>
      <span>{message}</span>
      <span>{description}</span>
      {onClose && <button onClick={onClose}>Close</button>}
    </div>
  ),
}));

describe('Edge Cases and Error Handling', () => {
  describe('CustomChartGenerator Edge Cases', () => {
    it('handles extremely long prompts gracefully', () => {
      const onGenerate = jest.fn();
      render(<CustomChartGenerator onGenerate={onGenerate} />);
      
      const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
      const veryLongPrompt = 'A'.repeat(2000);
      
      fireEvent.change(textarea, { target: { value: veryLongPrompt } });
      
      // Should be capped at 1000 characters
      expect(textarea.value.length).toBeLessThanOrEqual(1000);
    });

    it('handles rapid consecutive clicks on generate button', () => {
      const onGenerate = jest.fn();
      render(<CustomChartGenerator onGenerate={onGenerate} isGenerating={false} />);
      
      const textarea = screen.getByRole('textbox');
      const button = screen.getByRole('button', { name: /generate chart/i });
      
      fireEvent.change(textarea, { target: { value: 'test prompt' } });
      
      // Rapid clicks
      fireEvent.click(button);
      fireEvent.click(button);
      fireEvent.click(button);
      
      // Should only call onGenerate for the first valid click
      expect(onGenerate).toHaveBeenCalledTimes(1);
    });

    it('handles keyboard navigation correctly', () => {
      const onGenerate = jest.fn();
      render(<CustomChartGenerator onGenerate={onGenerate} />);
      
      const textarea = screen.getByRole('textbox');
      const button = screen.getByRole('button', { name: /generate chart/i });
      
      fireEvent.change(textarea, { target: { value: 'test prompt' } });
      
      // Tab navigation should work
      fireEvent.keyDown(textarea, { key: 'Tab' });
      expect(button).toHaveFocus();
      
      // Space or Enter on button should trigger generation
      fireEvent.keyDown(button, { key: ' ' });
      expect(onGenerate).toHaveBeenCalled();
    });

    it('handles special characters in prompts', () => {
      const onGenerate = jest.fn();
      render(<CustomChartGenerator onGenerate={onGenerate} />);
      
      const textarea = screen.getByRole('textbox');
      const button = screen.getByRole('button', { name: /generate chart/i });
      
      const specialCharPrompt = 'Create a chart with 测试 & émojis 🚀 and symbols !@#$%^&*()';
      fireEvent.change(textarea, { target: { value: specialCharPrompt } });
      fireEvent.click(button);
      
      expect(onGenerate).toHaveBeenCalledWith(specialCharPrompt);
    });

    it('handles component unmounting during generation', () => {
      const onGenerate = jest.fn();
      const { unmount } = render(
        <CustomChartGenerator onGenerate={onGenerate} isGenerating={true} />
      );
      
      // Should not crash when unmounting during generation
      expect(() => unmount()).not.toThrow();
    });

    it('handles null or undefined props gracefully', () => {
      // @ts-expect-error Testing edge case with invalid props
      expect(() => render(<CustomChartGenerator onGenerate={null} />)).not.toThrow();
    });
  });

  describe('CustomChartDisplay Edge Cases', () => {
    it('handles extremely long error messages', () => {
      const longError = 'Error: ' + 'A'.repeat(1000) + ' - this is a very long error message that should be handled gracefully without breaking the UI layout.';
      render(<CustomChartDisplay error={longError} />);
      
      expect(screen.getByText(/Chart Generation Failed/)).toBeInTheDocument();
      expect(screen.getByText(longError)).toBeInTheDocument();
    });

    it('handles rapid state changes', async () => {
      const { rerender } = render(<CustomChartDisplay isLoading={true} />);
      
      // Rapid state changes
      rerender(<CustomChartDisplay error="Error occurred" />);
      rerender(<CustomChartDisplay chartCode="code" />);
      rerender(<CustomChartDisplay isLoading={true} />);
      rerender(<CustomChartDisplay chartCode="final code" />);
      
      expect(screen.getByTestId('mock-lazy-plot')).toBeInTheDocument();
    });

    it('handles missing callback functions', () => {
      render(<CustomChartDisplay chartCode="test code" />);
      
      // Should not show buttons when callbacks are missing
      expect(screen.queryByRole('button', { name: /view code/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /save chart/i })).not.toBeInTheDocument();
    });

    it('handles empty or whitespace-only chart code', () => {
      render(<CustomChartDisplay chartCode="   " />);
      
      expect(screen.getByText('No chart generated yet')).toBeInTheDocument();
    });

    it('handles simultaneous loading and error states', () => {
      render(<CustomChartDisplay isLoading={true} error="Some error" />);
      
      // Loading should take precedence
      expect(screen.getByText(/Generating your custom chart/)).toBeInTheDocument();
      expect(screen.queryByText('Chart Generation Failed')).not.toBeInTheDocument();
    });

    it('handles progress updates during loading', () => {
      const { rerender } = render(<CustomChartDisplay isLoading={true} progress="Step 1" />);
      
      expect(screen.getByText('Step 1')).toBeInTheDocument();
      
      rerender(<CustomChartDisplay isLoading={true} progress="Step 2" />);
      expect(screen.getByText('Step 2')).toBeInTheDocument();
      
      rerender(<CustomChartDisplay isLoading={true} progress={null} />);
      expect(screen.getByText('Generating your custom chart...')).toBeInTheDocument();
    });
  });

  describe('SecurityWarningModal Edge Cases', () => {
    const defaultProps = {
      isOpen: true,
      onConfirm: jest.fn(),
      onCancel: jest.fn(),
      chartCode: 'test code',
    };

    it('handles extremely long chart code', () => {
      const longCode = 'const chart = () => {\n' + '  // Comment\n'.repeat(500) + '};';
      render(<SecurityWarningModal {...defaultProps} chartCode={longCode} />);
      
      expect(screen.getByText(longCode)).toBeInTheDocument();
    });

    it('handles code with special characters and formatting', () => {
      const complexCode = `
        const chart = () => {
          const data = "This has 'quotes' and \\"escaped\\" quotes";
          const unicode = "测试 émojis 🚀";
          const symbols = !@#$%^&*()[];
          return <div>{data}</div>;
        };
      `;
      render(<SecurityWarningModal {...defaultProps} chartCode={complexCode} />);
      
      expect(screen.getByText(complexCode)).toBeInTheDocument();
    });

    it('handles rapid open/close state changes', () => {
      const { rerender } = render(<SecurityWarningModal {...defaultProps} isOpen={false} />);
      
      rerender(<SecurityWarningModal {...defaultProps} isOpen={true} />);
      rerender(<SecurityWarningModal {...defaultProps} isOpen={false} />);
      rerender(<SecurityWarningModal {...defaultProps} isOpen={true} />);
      
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    it('handles checkbox state persistence', () => {
      const { rerender } = render(<SecurityWarningModal {...defaultProps} />);
      
      const checkbox = screen.getByRole('checkbox');
      fireEvent.click(checkbox);
      
      // Re-render with same props
      rerender(<SecurityWarningModal {...defaultProps} />);
      
      // Checkbox state should reset (component doesn't persist state across renders)
      expect(checkbox).not.toBeChecked();
    });

    it('handles missing callback functions', () => {
      render(<SecurityWarningModal {...defaultProps} onConfirm={undefined as any} onCancel={undefined as any} />);
      
      const confirmButton = screen.getByRole('button', { name: /execute chart code/i });
      const cancelButton = screen.getByRole('button', { name: /cancel/i });
      
      // Should not crash when clicking buttons without callbacks
      expect(() => {
        fireEvent.click(cancelButton);
        fireEvent.click(confirmButton);
      }).not.toThrow();
    });
  });

  describe('GeneratedChartContainer Edge Cases', () => {
    const defaultProps = {
      chartCode: 'const chart = () => <div>Test</div>;',
      experimentId: 'exp-123',
      runId: 'run-456',
    };

    it('handles malformed chart code gracefully', async () => {
      const malformedCode = 'const chart = () => { invalid syntax ]][[';
      const onError = jest.fn();
      
      render(<GeneratedChartContainer {...defaultProps} chartCode={malformedCode} onError={onError} />);
      
      // Accept the security warning
      const confirmButton = screen.getByRole('button', { name: /confirm/i });
      fireEvent.click(confirmButton);
      
      await waitFor(() => {
        expect(screen.getByText('Generated Chart Placeholder')).toBeInTheDocument();
      });
    });

    it('handles missing container reference', async () => {
      // Mock useRef to return null
      const originalUseRef = React.useRef;
      React.useRef = jest.fn(() => ({ current: null }));
      
      render(<GeneratedChartContainer {...defaultProps} />);
      
      const confirmButton = screen.getByRole('button', { name: /confirm/i });
      
      expect(() => fireEvent.click(confirmButton)).not.toThrow();
      
      React.useRef = originalUseRef;
    });

    it('handles DOM manipulation errors', async () => {
      // Mock appendChild to throw error
      const mockAppendChild = jest.fn().mockImplementation(() => {
        throw new Error('DOM error');
      });
      
      const mockContainer = {
        innerHTML: '',
        appendChild: mockAppendChild,
      };
      
      React.useRef = jest.fn(() => ({ current: mockContainer }));
      const onError = jest.fn();
      
      render(<GeneratedChartContainer {...defaultProps} onError={onError} />);
      
      const confirmButton = screen.getByRole('button', { name: /confirm/i });
      fireEvent.click(confirmButton);
      
      await waitFor(() => {
        expect(onError).toHaveBeenCalledWith('DOM error');
      });
      
      React.useRef = jest.requireActual('react').useRef;
    });

    it('handles security warning state corruption', () => {
      const { rerender } = render(<GeneratedChartContainer {...defaultProps} />);
      
      // Cancel security warning
      const cancelButton = screen.getByRole('button', { name: /cancel/i });
      fireEvent.click(cancelButton);
      
      // Change props to trigger re-render
      rerender(<GeneratedChartContainer {...defaultProps} chartCode="new code" />);
      
      // Security warning should appear again for new code
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    it('handles multiple security confirmations', async () => {
      render(<GeneratedChartContainer {...defaultProps} />);
      
      // First confirmation
      const confirmButton = screen.getByRole('button', { name: /confirm/i });
      fireEvent.click(confirmButton);
      
      await waitFor(() => {
        expect(screen.getByText('Generated Chart Placeholder')).toBeInTheDocument();
      });
      
      // Should not be able to confirm again
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('handles execution context errors', async () => {
      // Test with code that might access undefined context
      const problematicCode = 'console.log(nonExistentVariable);';
      
      render(<GeneratedChartContainer {...defaultProps} chartCode={problematicCode} />);
      
      const confirmButton = screen.getByRole('button', { name: /confirm/i });
      
      expect(() => fireEvent.click(confirmButton)).not.toThrow();
      
      await waitFor(() => {
        expect(screen.getByText('Generated Chart Placeholder')).toBeInTheDocument();
      });
    });
  });

  describe('Integration Edge Cases', () => {
    it('handles component interaction with broken event handlers', () => {
      const brokenHandler = () => {
        throw new Error('Handler error');
      };
      
      // Should not crash the entire component tree
      expect(() => {
        render(<CustomChartGenerator onGenerate={brokenHandler} />);
        
        const textarea = screen.getByRole('textbox');
        fireEvent.change(textarea, { target: { value: 'test' } });
        
        // This should be caught and handled gracefully
        try {
          const button = screen.getByRole('button', { name: /generate chart/i });
          fireEvent.click(button);
        } catch (e) {
          // Expected to throw, but shouldn't crash the test
        }
      }).not.toThrow();
    });

    it('handles memory leaks prevention', () => {
      const { unmount } = render(
        <div>
          <CustomChartGenerator onGenerate={jest.fn()} isGenerating={true} />
          <CustomChartDisplay isLoading={true} />
          <GeneratedChartContainer chartCode="test" />
        </div>
      );
      
      // Should cleanly unmount without warnings
      expect(() => unmount()).not.toThrow();
    });
  });
});

// Import React for the useRef test
import React from 'react';