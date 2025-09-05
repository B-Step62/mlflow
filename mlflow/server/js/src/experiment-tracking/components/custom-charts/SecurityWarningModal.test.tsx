import { render, screen, fireEvent } from '@testing-library/react';
import { SecurityWarningModal } from './SecurityWarningModal';

// Mock Modal component from design system
jest.mock('@databricks/design-system', () => ({
  ...jest.requireActual('@databricks/design-system'),
  Modal: ({ title, visible, onCancel, footer, children }: any) => 
    visible ? (
      <div role="dialog" aria-label={title}>
        <h2>{title}</h2>
        {children}
        <div>{footer}</div>
      </div>
    ) : null,
}));

describe('SecurityWarningModal', () => {
  const defaultProps = {
    isOpen: true,
    onConfirm: jest.fn(),
    onCancel: jest.fn(),
    chartCode: 'const chart = () => <div>Sample Chart</div>;',
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders when isOpen is true', () => {
    render(<SecurityWarningModal {...defaultProps} />);
    
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('⚠️ Security Warning: Code Execution')).toBeInTheDocument();
  });

  it('does not render when isOpen is false', () => {
    render(<SecurityWarningModal {...defaultProps} isOpen={false} />);
    
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('shows security warning content', () => {
    render(<SecurityWarningModal {...defaultProps} />);
    
    expect(screen.getByText('This chart contains generated JavaScript code')).toBeInTheDocument();
    expect(screen.getByText(/The code will be executed in your browser to render the chart/)).toBeInTheDocument();
  });

  it('displays the chart code', () => {
    render(<SecurityWarningModal {...defaultProps} />);
    
    expect(screen.getByText('Generated Code:')).toBeInTheDocument();
    expect(screen.getByText('const chart = () => <div>Sample Chart</div>;')).toBeInTheDocument();
  });

  it('shows security best practices', () => {
    render(<SecurityWarningModal {...defaultProps} />);
    
    expect(screen.getByText('Security Best Practices:')).toBeInTheDocument();
    expect(screen.getByText('Review the code for any suspicious operations')).toBeInTheDocument();
    expect(screen.getByText('Ensure it only contains chart visualization code')).toBeInTheDocument();
    expect(screen.getByText('Look out for network requests or data access beyond MLflow APIs')).toBeInTheDocument();
    expect(screen.getByText('Avoid executing code that modifies global state or DOM outside the chart container')).toBeInTheDocument();
  });

  it('shows confirmation checkbox', () => {
    render(<SecurityWarningModal {...defaultProps} />);
    
    const checkbox = screen.getByRole('checkbox');
    expect(checkbox).toBeInTheDocument();
    expect(screen.getByText(/I have reviewed the code above and understand the security implications/)).toBeInTheDocument();
  });

  it('disables confirm button initially', () => {
    render(<SecurityWarningModal {...defaultProps} />);
    
    const confirmButton = screen.getByRole('button', { name: /execute chart code/i });
    expect(confirmButton).toBeDisabled();
  });

  it('enables confirm button when checkbox is checked', () => {
    render(<SecurityWarningModal {...defaultProps} />);
    
    const checkbox = screen.getByRole('checkbox');
    const confirmButton = screen.getByRole('button', { name: /execute chart code/i });
    
    fireEvent.click(checkbox);
    
    expect(confirmButton).not.toBeDisabled();
  });

  it('calls onConfirm when confirm button is clicked and checkbox is checked', () => {
    const mockOnConfirm = jest.fn();
    render(<SecurityWarningModal {...defaultProps} onConfirm={mockOnConfirm} />);
    
    const checkbox = screen.getByRole('checkbox');
    const confirmButton = screen.getByRole('button', { name: /execute chart code/i });
    
    fireEvent.click(checkbox);
    fireEvent.click(confirmButton);
    
    expect(mockOnConfirm).toHaveBeenCalledTimes(1);
  });

  it('does not call onConfirm when confirm button is clicked but checkbox is not checked', () => {
    const mockOnConfirm = jest.fn();
    render(<SecurityWarningModal {...defaultProps} onConfirm={mockOnConfirm} />);
    
    const confirmButton = screen.getByRole('button', { name: /execute chart code/i });
    
    // Try to click disabled button - should not call onConfirm
    fireEvent.click(confirmButton);
    
    expect(mockOnConfirm).not.toHaveBeenCalled();
  });

  it('calls onCancel when cancel button is clicked', () => {
    const mockOnCancel = jest.fn();
    render(<SecurityWarningModal {...defaultProps} onCancel={mockOnCancel} />);
    
    const cancelButton = screen.getByRole('button', { name: /cancel/i });
    fireEvent.click(cancelButton);
    
    expect(mockOnCancel).toHaveBeenCalledTimes(1);
  });

  it('shows both cancel and confirm buttons', () => {
    render(<SecurityWarningModal {...defaultProps} />);
    
    expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /execute chart code/i })).toBeInTheDocument();
  });

  it('handles checkbox state changes correctly', () => {
    render(<SecurityWarningModal {...defaultProps} />);
    
    const checkbox = screen.getByRole('checkbox') as HTMLInputElement;
    const confirmButton = screen.getByRole('button', { name: /execute chart code/i });
    
    // Initially unchecked
    expect(checkbox.checked).toBe(false);
    expect(confirmButton).toBeDisabled();
    
    // Check the checkbox
    fireEvent.click(checkbox);
    expect(checkbox.checked).toBe(true);
    expect(confirmButton).not.toBeDisabled();
    
    // Uncheck the checkbox
    fireEvent.click(checkbox);
    expect(checkbox.checked).toBe(false);
    expect(confirmButton).toBeDisabled();
  });

  it('displays long code with proper scrolling', () => {
    const longCode = 'const chart = () => {\n' + '  // Long code\n'.repeat(50) + '};';
    render(<SecurityWarningModal {...defaultProps} chartCode={longCode} />);
    
    const codeContainer = screen.getByText(longCode).closest('div');
    expect(codeContainer).toHaveStyle({ maxHeight: '300px', overflow: 'auto' });
  });

  it('preserves code formatting in pre element', () => {
    const formattedCode = `const chart = () => {
  return (
    <div>
      Hello World
    </div>
  );
};`;
    render(<SecurityWarningModal {...defaultProps} chartCode={formattedCode} />);
    
    const preElement = screen.getByText(formattedCode);
    expect(preElement.tagName).toBe('PRE');
    expect(preElement).toHaveStyle({ 
      whiteSpace: 'pre-wrap',
      wordBreak: 'break-word'
    });
  });
});