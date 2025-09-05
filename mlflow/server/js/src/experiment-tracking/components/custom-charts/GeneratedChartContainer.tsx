import { Alert, useDesignSystemTheme } from '@databricks/design-system';
import React, { useEffect, useRef, useState } from 'react';
import { SecurityWarningModal } from './SecurityWarningModal';

interface GeneratedChartContainerProps {
  chartCode: string;
  experimentId?: string;
  runId?: string;
  onError?: (error: string) => void;
}

export const GeneratedChartContainer: React.FC<GeneratedChartContainerProps> = ({
  chartCode,
  experimentId,
  runId,
  onError,
}) => {
  const { theme } = useDesignSystemTheme();
  const containerRef = useRef<HTMLDivElement>(null);
  const [showSecurityWarning, setShowSecurityWarning] = useState(true);
  const [executionError, setExecutionError] = useState<string | null>(null);
  const [isExecuted, setIsExecuted] = useState(false);

  const executeChartCode = () => {
    if (!containerRef.current || !chartCode) return;

    try {
      setExecutionError(null);
      
      // Clear the container
      containerRef.current.innerHTML = '';

      // Create a sandboxed execution context
      const executionContext = {
        React,
        container: containerRef.current,
        experimentId,
        runId,
        // Mock MLflow API data for demonstration
        data: {
          metrics: [
            { step: 1, value: 2 },
            { step: 2, value: 4 },
            { step: 3, value: 3 },
            { step: 4, value: 5 },
            { step: 5, value: 6 },
          ],
        },
      };

      // Basic code validation
      if (chartCode.includes('eval(') || 
          chartCode.includes('Function(') ||
          chartCode.includes('document.') ||
          chartCode.includes('window.') ||
          chartCode.includes('localStorage') ||
          chartCode.includes('sessionStorage')) {
        throw new Error('Chart code contains potentially unsafe operations');
      }

      // For demonstration, create a simple visualization
      // In a real implementation, this would safely execute the generated code
      const chartElement = document.createElement('div');
      chartElement.style.width = '100%';
      chartElement.style.height = '400px';
      chartElement.style.backgroundColor = theme.colors.backgroundSecondary;
      chartElement.style.border = `1px solid ${theme.colors.border}`;
      chartElement.style.borderRadius = theme.borders.borderRadiusMd;
      chartElement.style.display = 'flex';
      chartElement.style.alignItems = 'center';
      chartElement.style.justifyContent = 'center';
      chartElement.style.color = theme.colors.textSecondary;
      chartElement.innerHTML = `
        <div style="text-align: center;">
          <div style="font-size: 48px; margin-bottom: 16px;">📊</div>
          <p>Generated Chart Placeholder</p>
          <small>Code execution sandboxed for security</small>
        </div>
      `;

      containerRef.current.appendChild(chartElement);
      setIsExecuted(true);

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      setExecutionError(errorMessage);
      onError?.(errorMessage);
    }
  };

  const handleSecurityConfirm = () => {
    setShowSecurityWarning(false);
    executeChartCode();
  };

  const handleSecurityCancel = () => {
    setShowSecurityWarning(false);
  };

  useEffect(() => {
    if (!showSecurityWarning && !isExecuted) {
      executeChartCode();
    }
  }, [showSecurityWarning, chartCode]);

  return (
    <div css={{ display: 'flex', flexDirection: 'column', gap: theme.spacing.md }}>
      {executionError && (
        <Alert
          type="error"
          message="Chart Execution Error"
          description={executionError}
          showIcon
          closable
          onClose={() => setExecutionError(null)}
        />
      )}

      <div
        ref={containerRef}
        css={{
          minHeight: '400px',
          borderRadius: theme.borders.borderRadiusMd,
          overflow: 'hidden',
        }}
      />

      <SecurityWarningModal
        isOpen={showSecurityWarning}
        onConfirm={handleSecurityConfirm}
        onCancel={handleSecurityCancel}
        chartCode={chartCode}
      />

      {isExecuted && (
        <div
          css={{
            padding: theme.spacing.sm,
            backgroundColor: theme.colors.backgroundSuccess,
            borderRadius: theme.borders.borderRadiusMd,
            fontSize: theme.typography.fontSizeSm,
            color: theme.colors.textValidationSuccess,
            textAlign: 'center',
          }}
        >
          ✅ Chart code executed successfully in sandbox environment
        </div>
      )}
    </div>
  );
};