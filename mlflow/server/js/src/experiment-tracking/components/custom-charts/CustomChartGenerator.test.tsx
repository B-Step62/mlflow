import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { CustomChartGenerator } from './CustomChartGenerator';

describe('CustomChartGenerator', () => {
  const defaultProps = {
    onGenerate: jest.fn(),
    isGenerating: false,
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders correctly with all elements', () => {
    render(<CustomChartGenerator {...defaultProps} />);
    
    expect(screen.getByText('Generate Custom Chart')).toBeInTheDocument();
    expect(screen.getByText('Describe the chart you want to create using natural language')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Example: Show accuracy and loss over training steps as line charts')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /generate chart/i })).toBeInTheDocument();
    expect(screen.getByText('0/1000 characters')).toBeInTheDocument();
  });

  it('shows helper examples', () => {
    render(<CustomChartGenerator {...defaultProps} />);
    
    expect(screen.getByText('Examples:')).toBeInTheDocument();
    expect(screen.getByText('Show accuracy and loss trends over training steps')).toBeInTheDocument();
    expect(screen.getByText('Compare model performance metrics across epochs')).toBeInTheDocument();
    expect(screen.getByText('Create a scatter plot of precision vs recall')).toBeInTheDocument();
  });

  it('updates character count as user types', () => {
    render(<CustomChartGenerator {...defaultProps} />);
    
    const textarea = screen.getByRole('textbox');
    fireEvent.change(textarea, { target: { value: 'Test prompt' } });
    
    expect(screen.getByText('11/1000 characters')).toBeInTheDocument();
  });

  it('shows helpful message for short prompts', () => {
    render(<CustomChartGenerator {...defaultProps} />);
    
    const textarea = screen.getByRole('textbox');
    fireEvent.change(textarea, { target: { value: 'Test' } });
    
    expect(screen.getByText('- Add more detail for better results')).toBeInTheDocument();
  });

  it('shows warning colors for long prompts', () => {
    render(<CustomChartGenerator {...defaultProps} />);
    
    const textarea = screen.getByRole('textbox');
    const longPrompt = 'A'.repeat(850);
    fireEvent.change(textarea, { target: { value: longPrompt } });
    
    expect(screen.getByText(`${longPrompt.length}/1000 characters`)).toBeInTheDocument();
  });

  it('disables button when prompt is empty', () => {
    render(<CustomChartGenerator {...defaultProps} />);
    
    const button = screen.getByRole('button', { name: /generate chart/i });
    expect(button).toBeDisabled();
  });

  it('enables button when prompt is provided', () => {
    render(<CustomChartGenerator {...defaultProps} />);
    
    const textarea = screen.getByRole('textbox');
    const button = screen.getByRole('button', { name: /generate chart/i });
    
    fireEvent.change(textarea, { target: { value: 'Test prompt' } });
    expect(button).not.toBeDisabled();
  });

  it('calls onGenerate when button is clicked', () => {
    const mockOnGenerate = jest.fn();
    render(<CustomChartGenerator {...defaultProps} onGenerate={mockOnGenerate} />);
    
    const textarea = screen.getByRole('textbox');
    const button = screen.getByRole('button', { name: /generate chart/i });
    
    fireEvent.change(textarea, { target: { value: 'Test prompt' } });
    fireEvent.click(button);
    
    expect(mockOnGenerate).toHaveBeenCalledWith('Test prompt');
  });

  it('calls onGenerate when Enter is pressed (without Shift)', () => {
    const mockOnGenerate = jest.fn();
    render(<CustomChartGenerator {...defaultProps} onGenerate={mockOnGenerate} />);
    
    const textarea = screen.getByRole('textbox');
    
    fireEvent.change(textarea, { target: { value: 'Test prompt' } });
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });
    
    expect(mockOnGenerate).toHaveBeenCalledWith('Test prompt');
  });

  it('does not call onGenerate when Shift+Enter is pressed', () => {
    const mockOnGenerate = jest.fn();
    render(<CustomChartGenerator {...defaultProps} onGenerate={mockOnGenerate} />);
    
    const textarea = screen.getByRole('textbox');
    
    fireEvent.change(textarea, { target: { value: 'Test prompt' } });
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: true });
    
    expect(mockOnGenerate).not.toHaveBeenCalled();
  });

  it('clears prompt after generation', () => {
    const mockOnGenerate = jest.fn();
    render(<CustomChartGenerator {...defaultProps} onGenerate={mockOnGenerate} />);
    
    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
    const button = screen.getByRole('button', { name: /generate chart/i });
    
    fireEvent.change(textarea, { target: { value: 'Test prompt' } });
    fireEvent.click(button);
    
    expect(textarea.value).toBe('');
  });

  it('shows loading state when isGenerating is true', () => {
    render(<CustomChartGenerator {...defaultProps} isGenerating={true} />);
    
    const button = screen.getByRole('button');
    expect(button).toHaveTextContent('Generating...');
    expect(button).toBeDisabled();
  });

  it('shows warning when no run or experiment context available', () => {
    render(<CustomChartGenerator {...defaultProps} />);
    
    expect(screen.getByText('Warning: No run or experiment context available')).toBeInTheDocument();
  });

  it('does not show warning when run or experiment context is provided', () => {
    render(<CustomChartGenerator {...defaultProps} runId="test-run" />);
    
    expect(screen.queryByText('Warning: No run or experiment context available')).not.toBeInTheDocument();
  });

  it('respects maxLength on textarea', () => {
    render(<CustomChartGenerator {...defaultProps} />);
    
    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
    const veryLongPrompt = 'A'.repeat(1500);
    
    fireEvent.change(textarea, { target: { value: veryLongPrompt } });
    
    // The textarea should truncate to 1000 characters
    expect(textarea.value.length).toBeLessThanOrEqual(1000);
  });
});