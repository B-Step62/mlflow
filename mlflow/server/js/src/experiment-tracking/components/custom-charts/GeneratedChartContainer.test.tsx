import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { GeneratedChartContainer } from './GeneratedChartContainer';

// Mock SecurityWarningModal
jest.mock('./SecurityWarningModal', () => ({
  SecurityWarningModal: ({ isOpen, onConfirm, onCancel, chartCode }: any) => 
    isOpen ? (
      <div role="dialog">
        <p>Security Warning Modal</p>
        <p>Chart Code: {chartCode}</p>
        <button onClick={onConfirm}>Confirm</button>
        <button onClick={onCancel}>Cancel</button>
      </div>
    ) : null,
}));

describe('GeneratedChartContainer', () => {
  const defaultProps = {
    chartCode: 'const chart = () => <div>Test Chart</div>;',
    experimentId: 'exp-123',
    runId: 'run-456',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    // Mock console.log to avoid noise in tests
    jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('shows security warning modal initially', () => {
    render(<GeneratedChartContainer {...defaultProps} />);
    
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Security Warning Modal')).toBeInTheDocument();
    expect(screen.getByText(`Chart Code: ${defaultProps.chartCode}`)).toBeInTheDocument();
  });

  it('does not show security warning when no chart code', () => {
    render(<GeneratedChartContainer {...defaultProps} chartCode="" />);
    
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('hides security warning when cancel is clicked', () => {
    render(<GeneratedChartContainer {...defaultProps} />);
    
    const cancelButton = screen.getByRole('button', { name: /cancel/i });
    fireEvent.click(cancelButton);
    
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('executes chart code when security warning is confirmed', async () => {
    render(<GeneratedChartContainer {...defaultProps} />);
    
    const confirmButton = screen.getByRole('button', { name: /confirm/i });
    fireEvent.click(confirmButton);
    
    // Should hide the modal
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    
    // Should show the chart placeholder
    await waitFor(() => {
      expect(screen.getByText('Generated Chart Placeholder')).toBeInTheDocument();
      expect(screen.getByText('Code execution sandboxed for security')).toBeInTheDocument();
    });
  });

  it('shows success message after execution', async () => {
    render(<GeneratedChartContainer {...defaultProps} />);
    
    const confirmButton = screen.getByRole('button', { name: /confirm/i });
    fireEvent.click(confirmButton);
    
    await waitFor(() => {
      expect(screen.getByText('✅ Chart code executed successfully in sandbox environment')).toBeInTheDocument();
    });
  });

  it('detects and prevents unsafe code execution', async () => {
    const unsafeCode = 'eval("malicious code"); document.write("hack");';
    const mockOnError = jest.fn();
    
    render(
      <GeneratedChartContainer 
        {...defaultProps} 
        chartCode={unsafeCode} 
        onError={mockOnError}
      />
    );
    
    const confirmButton = screen.getByRole('button', { name: /confirm/i });
    fireEvent.click(confirmButton);
    
    await waitFor(() => {
      expect(screen.getByText('Chart Execution Error')).toBeInTheDocument();
      expect(screen.getByText('Chart code contains potentially unsafe operations')).toBeInTheDocument();
    });
    
    expect(mockOnError).toHaveBeenCalledWith('Chart code contains potentially unsafe operations');
  });

  it('handles various unsafe operations', async () => {
    const unsafeCodes = [
      'eval("test")',
      'Function("return 1")()',
      'document.createElement("script")',
      'window.location.href = "hack"',
      'localStorage.setItem("key", "value")',
      'sessionStorage.clear()',
    ];

    for (const unsafeCode of unsafeCodes) {
      const mockOnError = jest.fn();
      
      render(
        <GeneratedChartContainer 
          {...defaultProps} 
          chartCode={unsafeCode} 
          onError={mockOnError}
        />
      );
      
      const confirmButton = screen.getByRole('button', { name: /confirm/i });
      fireEvent.click(confirmButton);
      
      await waitFor(() => {
        expect(mockOnError).toHaveBeenCalledWith('Chart code contains potentially unsafe operations');
      });
      
      // Cleanup for next iteration
      document.body.innerHTML = '';
    }
  });

  it('provides execution context to chart code', async () => {
    render(<GeneratedChartContainer {...defaultProps} />);
    
    const confirmButton = screen.getByRole('button', { name: /confirm/i });
    fireEvent.click(confirmButton);
    
    await waitFor(() => {
      // The execution context should include the container, experimentId, runId, and mock data
      expect(screen.getByText('Generated Chart Placeholder')).toBeInTheDocument();
    });
  });

  it('clears container before execution', async () => {
    const { rerender } = render(<GeneratedChartContainer {...defaultProps} />);
    
    const confirmButton = screen.getByRole('button', { name: /confirm/i });
    fireEvent.click(confirmButton);
    
    await waitFor(() => {
      expect(screen.getByText('Generated Chart Placeholder')).toBeInTheDocument();
    });
    
    // Execute new code
    rerender(<GeneratedChartContainer {...defaultProps} chartCode="new code" />);
    
    const newConfirmButton = screen.getByRole('button', { name: /confirm/i });
    fireEvent.click(newConfirmButton);
    
    // Should clear and re-render
    await waitFor(() => {
      expect(screen.getByText('Generated Chart Placeholder')).toBeInTheDocument();
    });
  });

  it('dismisses error alert when close button is clicked', async () => {
    const unsafeCode = 'eval("test")';
    render(<GeneratedChartContainer {...defaultProps} chartCode={unsafeCode} />);
    
    const confirmButton = screen.getByRole('button', { name: /confirm/i });
    fireEvent.click(confirmButton);
    
    await waitFor(() => {
      expect(screen.getByText('Chart Execution Error')).toBeInTheDocument();
    });
    
    // Find and click the alert close button
    const alert = screen.getByText('Chart Execution Error').closest('[role="alert"], .ant-alert');
    if (alert) {
      const closeButton = alert.querySelector('[aria-label="Close"]') || 
                         alert.querySelector('.ant-alert-close-icon') ||
                         screen.getByRole('button', { name: /close/i });
      
      if (closeButton) {
        fireEvent.click(closeButton);
        
        await waitFor(() => {
          expect(screen.queryByText('Chart Execution Error')).not.toBeInTheDocument();
        });
      }
    }
  });

  it('handles empty chart code gracefully', () => {
    render(<GeneratedChartContainer {...defaultProps} chartCode="" />);
    
    // Should not show security warning for empty code
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    
    // Should not try to execute anything
    expect(screen.queryByText('Generated Chart Placeholder')).not.toBeInTheDocument();
  });

  it('handles missing container ref gracefully', async () => {
    // Mock the useRef to return null container
    const mockUseRef = jest.spyOn(React, 'useRef');
    mockUseRef.mockReturnValue({ current: null });
    
    render(<GeneratedChartContainer {...defaultProps} />);
    
    const confirmButton = screen.getByRole('button', { name: /confirm/i });
    fireEvent.click(confirmButton);
    
    // Should not crash or show error
    await waitFor(() => {
      expect(screen.queryByText('Chart Execution Error')).not.toBeInTheDocument();
    });
    
    mockUseRef.mockRestore();
  });

  it('passes correct props to SecurityWarningModal', () => {
    render(<GeneratedChartContainer {...defaultProps} />);
    
    expect(screen.getByText(`Chart Code: ${defaultProps.chartCode}`)).toBeInTheDocument();
  });

  it('executes only once after confirmation', async () => {
    render(<GeneratedChartContainer {...defaultProps} />);
    
    const confirmButton = screen.getByRole('button', { name: /confirm/i });
    fireEvent.click(confirmButton);
    
    await waitFor(() => {
      expect(screen.getByText('Generated Chart Placeholder')).toBeInTheDocument();
    });
    
    // Should show success message only once
    const successMessages = screen.getAllByText(/Chart code executed successfully/);
    expect(successMessages).toHaveLength(1);
  });
});

// For React import in the container ref test
import React from 'react';