import { render, screen, fireEvent } from '@testing-library/react';
import { CustomChartDisplay } from './CustomChartDisplay';

// Mock LazyPlot component
jest.mock('../LazyPlot', () => ({
  LazyPlot: ({ data, layout }: any) => (
    <div data-testid="mock-lazy-plot">
      Mock Plot - {layout?.title}
    </div>
  ),
}));

describe('CustomChartDisplay', () => {
  const defaultProps = {
    onSave: jest.fn(),
    onViewCode: jest.fn(),
    onRegenerate: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('shows loading state when isLoading is true', () => {
    render(<CustomChartDisplay isLoading={true} {...defaultProps} />);
    
    expect(screen.getByText('Generating your custom chart...')).toBeInTheDocument();
    expect(screen.getByText('This may take a few moments')).toBeInTheDocument();
    
    // Should show spinner
    const spinnerContainer = screen.getByText('Generating your custom chart...').closest('div');
    expect(spinnerContainer?.querySelector('div')).toHaveStyle({
      animation: 'spin 1s linear infinite',
    });
  });

  it('shows progress message when provided', () => {
    render(<CustomChartDisplay isLoading={true} progress="Analyzing your request..." {...defaultProps} />);
    
    expect(screen.getByText('Analyzing your request...')).toBeInTheDocument();
    expect(screen.queryByText('Generating your custom chart...')).not.toBeInTheDocument();
  });

  it('shows error state with error message', () => {
    render(<CustomChartDisplay error="Something went wrong" {...defaultProps} />);
    
    expect(screen.getByText('Chart Generation Failed')).toBeInTheDocument();
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
    expect(screen.getByText('Try rephrasing your request or check your data connection')).toBeInTheDocument();
  });

  it('calls onRegenerate when Try Again button is clicked', () => {
    const mockOnRegenerate = jest.fn();
    render(<CustomChartDisplay error="Error" onRegenerate={mockOnRegenerate} />);
    
    const tryAgainButton = screen.getByRole('button', { name: /try again/i });
    fireEvent.click(tryAgainButton);
    
    expect(mockOnRegenerate).toHaveBeenCalledTimes(1);
  });

  it('shows empty state when no chart code is provided', () => {
    render(<CustomChartDisplay {...defaultProps} />);
    
    expect(screen.getByText('No chart generated yet')).toBeInTheDocument();
  });

  it('shows chart when chart code is provided', () => {
    const mockChartCode = 'const chart = () => <div>Chart</div>';
    render(<CustomChartDisplay chartCode={mockChartCode} {...defaultProps} />);
    
    // Should show the mock plot
    expect(screen.getByTestId('mock-lazy-plot')).toBeInTheDocument();
    expect(screen.getByText(/Generated Chart Preview/)).toBeInTheDocument();
    
    // Should show action buttons
    expect(screen.getByRole('button', { name: /view code/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /save chart/i })).toBeInTheDocument();
  });

  it('shows security warning initially', () => {
    const mockChartCode = 'const chart = () => <div>Chart</div>';
    render(<CustomChartDisplay chartCode={mockChartCode} {...defaultProps} />);
    
    expect(screen.getByText(/This chart contains generated code that will be executed in your browser/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /dismiss/i })).toBeInTheDocument();
  });

  it('dismisses security warning when dismiss button is clicked', () => {
    const mockChartCode = 'const chart = () => <div>Chart</div>';
    render(<CustomChartDisplay chartCode={mockChartCode} {...defaultProps} />);
    
    const dismissButton = screen.getByRole('button', { name: /dismiss/i });
    fireEvent.click(dismissButton);
    
    expect(screen.queryByText(/This chart contains generated code that will be executed in your browser/)).not.toBeInTheDocument();
  });

  it('calls onViewCode when View Code button is clicked', () => {
    const mockOnViewCode = jest.fn();
    const mockChartCode = 'const chart = () => <div>Chart</div>';
    render(<CustomChartDisplay chartCode={mockChartCode} onViewCode={mockOnViewCode} />);
    
    const viewCodeButton = screen.getByRole('button', { name: /view code/i });
    fireEvent.click(viewCodeButton);
    
    expect(mockOnViewCode).toHaveBeenCalledTimes(1);
  });

  it('calls onSave when Save Chart button is clicked', () => {
    const mockOnSave = jest.fn();
    const mockChartCode = 'const chart = () => <div>Chart</div>';
    render(<CustomChartDisplay chartCode={mockChartCode} onSave={mockOnSave} />);
    
    const saveButton = screen.getByRole('button', { name: /save chart/i });
    fireEvent.click(saveButton);
    
    expect(mockOnSave).toHaveBeenCalledTimes(1);
  });

  it('does not show action buttons when chart code is not provided', () => {
    render(<CustomChartDisplay {...defaultProps} />);
    
    expect(screen.queryByRole('button', { name: /view code/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /save chart/i })).not.toBeInTheDocument();
  });

  it('does not show action buttons when there is an error', () => {
    render(<CustomChartDisplay error="Error" {...defaultProps} />);
    
    expect(screen.queryByRole('button', { name: /view code/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /save chart/i })).not.toBeInTheDocument();
  });

  it('does not show action buttons when loading', () => {
    render(<CustomChartDisplay isLoading={true} {...defaultProps} />);
    
    expect(screen.queryByRole('button', { name: /view code/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /save chart/i })).not.toBeInTheDocument();
  });

  it('handles missing onViewCode and onSave callbacks gracefully', () => {
    const mockChartCode = 'const chart = () => <div>Chart</div>';
    render(<CustomChartDisplay chartCode={mockChartCode} />);
    
    // Should not show buttons when callbacks are not provided
    expect(screen.queryByRole('button', { name: /view code/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /save chart/i })).not.toBeInTheDocument();
  });

  it('handles missing onRegenerate callback gracefully', () => {
    render(<CustomChartDisplay error="Error" />);
    
    // Should not show Try Again button when callback is not provided
    expect(screen.queryByRole('button', { name: /try again/i })).not.toBeInTheDocument();
  });
});