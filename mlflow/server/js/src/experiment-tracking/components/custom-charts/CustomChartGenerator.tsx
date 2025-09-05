import { Button, Input, Modal, useDesignSystemTheme } from '@databricks/design-system';
import React, { forwardRef, useImperativeHandle, useState } from 'react';

interface CustomChartGeneratorProps {
  runId?: string;
  experimentId?: string;
  onGenerate: (prompt: string) => void;
  isGenerating?: boolean;
  chartCode?: string;
  chartTitle?: string;
  error?: string;
  progress?: string | null;
  onAddChart?: (chartTitle?: string) => void;
  onResetChart?: () => void;
}

export const CustomChartGenerator = forwardRef<{ openModal: () => void }, CustomChartGeneratorProps>(({
  runId,
  experimentId,
  onGenerate,
  isGenerating = false,
  chartCode,
  chartTitle,
  error,
  progress,
  onAddChart,
  onResetChart,
}, ref) => {
  const { theme } = useDesignSystemTheme();
  const [prompt, setPrompt] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);

  // Expose openModal function via ref
  useImperativeHandle(ref, () => ({
    openModal
  }));

  const handleGenerate = () => {
    if (prompt.trim()) {
      onGenerate(prompt.trim());
      // Keep modal open to show loading state and results
      // Modal will close when user clicks "Add Chart" or "Cancel"
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleGenerate();
    }
  };

  const openModal = () => {
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setPrompt(''); // Clear prompt when closing without generating
    // Reset the chart state when closing modal
    if (onResetChart) {
      onResetChart();
    }
  };

  const handleAddChart = () => {
    if (onAddChart) {
      onAddChart(chartTitle);
    }
    // Close modal after adding chart
    setIsModalOpen(false);
    setPrompt('');
  };

  // Determine current modal state
  const getModalState = () => {
    if (error) return 'error';
    if (chartCode && !isGenerating) return 'generated';
    if (isGenerating) return 'loading';
    return 'input';
  };

  const renderModalContent = () => {
    const state = getModalState();

    if (state === 'loading') {
      return (
        <div
          css={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: '200px',
            textAlign: 'center',
          }}
        >
          <div>
            <div
              css={{
                width: '32px',
                height: '32px',
                border: `3px solid ${theme.colors.border}`,
                borderTop: `3px solid ${theme.colors.primary}`,
                borderRadius: '50%',
                animation: 'spin 1s linear infinite',
                margin: '0 auto 16px',
              }}
            />
            <p css={{ color: theme.colors.textSecondary, marginBottom: theme.spacing.sm }}>
              {progress || 'Generating your custom chart...'}
            </p>
            <p css={{ 
              color: theme.colors.textSecondary, 
              fontSize: theme.typography.fontSizeSm 
            }}>
              This may take a few moments
            </p>
          </div>
        </div>
      );
    }

    if (state === 'error') {
      return (
        <div
          css={{
            padding: theme.spacing.md,
            backgroundColor: theme.colors.backgroundDanger,
            borderRadius: theme.borders.borderRadiusMd,
            border: `1px solid ${theme.colors.borderDanger}`,
          }}
        >
          <h4 css={{ margin: '0 0 8px 0', color: theme.colors.textValidationDanger }}>
            Chart Generation Failed
          </h4>
          <p css={{ margin: 0, color: theme.colors.textValidationDanger, marginBottom: theme.spacing.sm }}>
            {error}
          </p>
          <p css={{ 
            margin: 0, 
            fontSize: theme.typography.fontSizeSm, 
            color: theme.colors.textSecondary 
          }}>
            Try rephrasing your request or check your data connection
          </p>
        </div>
      );
    }

    if (state === 'generated') {
      return (
        <div css={{ display: 'flex', flexDirection: 'column', gap: theme.spacing.md }}>
          {/* Security warning */}
          <div
            css={{
              padding: theme.spacing.md,
              backgroundColor: theme.colors.backgroundWarning,
              borderRadius: theme.borders.borderRadiusMd,
              border: `1px solid ${theme.colors.borderWarning}`,
            }}
          >
            <div css={{ display: 'flex', alignItems: 'flex-start', gap: theme.spacing.sm }}>
              <span css={{ fontSize: '18px' }}>⚠️</span>
              <div>
                <strong css={{ color: theme.colors.textValidationWarning, display: 'block', marginBottom: theme.spacing.xs }}>
                  Security Warning
                </strong>
                <p css={{ 
                  margin: 0, 
                  color: theme.colors.textValidationWarning, 
                  fontSize: theme.typography.fontSizeSm,
                  lineHeight: 1.4
                }}>
                  The generated code will be executed in your browser. Please review it carefully before adding to your charts.
                </p>
              </div>
            </div>
          </div>

          {/* Raw code display */}
          <div
            css={{
              border: `1px solid ${theme.colors.border}`,
              borderRadius: theme.borders.borderRadiusMd,
              overflow: 'hidden',
              backgroundColor: theme.colors.backgroundSecondary,
            }}
          >
            <div
              css={{
                padding: `${theme.spacing.xs}px ${theme.spacing.sm}px`,
                backgroundColor: theme.colors.backgroundPrimary,
                borderBottom: `1px solid ${theme.colors.border}`,
                fontSize: theme.typography.fontSizeSm,
                fontWeight: theme.typography.typographyBoldFontWeight,
                color: theme.colors.textSecondary,
              }}
            >
              Generated Chart Code
            </div>
            <pre
              css={{
                margin: 0,
                padding: theme.spacing.md,
                backgroundColor: theme.colors.backgroundSecondary,
                color: theme.colors.textPrimary,
                fontSize: theme.typography.fontSizeSm,
                fontFamily: 'Monaco, Menlo, "Ubuntu Mono", monospace',
                lineHeight: 1.4,
                overflow: 'auto',
                maxHeight: '300px',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}
            >
              {chartCode}
            </pre>
          </div>
        </div>
      );
    }

    // Default: input state
    return (
      <div
        css={{
          display: 'flex',
          flexDirection: 'column',
          gap: theme.spacing.md,
        }}
      >
        <div css={{ display: 'flex', flexDirection: 'column', gap: theme.spacing.xs }}>
          <p
            css={{
              margin: 0,
              fontSize: theme.typography.fontSizeBase,
              color: theme.colors.textPrimary,
            }}
          >
            Describe the chart you want to create using natural language
          </p>
          <div css={{ 
            fontSize: theme.typography.fontSizeSm, 
            color: theme.colors.textSecondary,
            lineHeight: 1.4
          }}>
            <strong>Examples:</strong>
            <ul css={{ margin: `${theme.spacing.xs}px 0`, paddingLeft: theme.spacing.md }}>
              <li>Show accuracy and loss trends over training steps</li>
              <li>Compare model performance metrics across epochs</li>
              <li>Create a scatter plot of precision vs recall</li>
            </ul>
          </div>
        </div>

        <Input.TextArea
          componentId="mlflow.custom-charts.modal-prompt-input"
          placeholder="Example: Show accuracy and loss over training steps as line charts"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={4}
          maxLength={1000}
          css={{
            resize: 'none',
          }}
        />

        <div
          css={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <span
            css={{
              fontSize: theme.typography.fontSizeSm,
              color: prompt.length > 800 
                ? theme.colors.textValidationWarning 
                : prompt.length > 950 
                ? theme.colors.textValidationDanger 
                : theme.colors.textSecondary,
            }}
          >
            {prompt.length}/1000 characters
            {prompt.length < 10 && (
              <span css={{ marginLeft: theme.spacing.xs, fontStyle: 'italic' }}>
                - Add more detail for better results
              </span>
            )}
          </span>
        </div>

        {(!runId && !experimentId) && (
          <div
            css={{
              padding: theme.spacing.sm,
              backgroundColor: theme.colors.backgroundWarning,
              borderRadius: theme.borders.borderRadiusMd,
              fontSize: theme.typography.fontSizeSm,
              color: theme.colors.textValidationWarning,
            }}
          >
            Warning: No run or experiment context available
          </div>
        )}
      </div>
    );
  };

  const getModalFooter = () => {
    const state = getModalState();

    if (state === 'loading') {
      return [
        <Button 
          componentId="mlflow.custom-charts.modal-cancel-loading"
          key="cancel" 
          onClick={closeModal}
        >
          Cancel
        </Button>,
      ];
    }

    if (state === 'error') {
      return [
        <Button 
          componentId="mlflow.custom-charts.modal-cancel-error"
          key="cancel" 
          onClick={closeModal}
        >
          Close
        </Button>,
        <Button
          componentId="mlflow.custom-charts.modal-retry"
          key="retry"
          type="primary"
          onClick={handleGenerate}
        >
          Try Again
        </Button>,
      ];
    }

    if (state === 'generated') {
      return [
        <Button 
          componentId="mlflow.custom-charts.modal-cancel-generated"
          key="cancel" 
          onClick={closeModal}
        >
          Cancel
        </Button>,
        <Button
          componentId="mlflow.custom-charts.modal-add-chart"
          key="add-chart"
          type="primary"
          onClick={handleAddChart}
        >
          Add Chart
        </Button>,
      ];
    }

    // Default: input state
    return [
      <Button 
        componentId="mlflow.custom-charts.modal-cancel"
        key="cancel" 
        onClick={closeModal}
      >
        Cancel
      </Button>,
      <Button
        componentId="mlflow.custom-charts.modal-generate"
        key="generate"
        type="primary"
        onClick={handleGenerate}
        loading={isGenerating}
        disabled={!prompt.trim() || isGenerating}
      >
        {isGenerating ? 'Generating...' : 'Generate Chart'}
      </Button>,
    ];
  };

  return (
    <>
      {/* Modal containing the chart generation form */}
      {isModalOpen && (
        <Modal
          componentId="mlflow.custom-charts.generator-modal"
          title="✨ Generate Custom Chart with AI"
          visible={isModalOpen}
          onCancel={closeModal}
          footer={getModalFooter()}
          css={{ '& .ant-modal': { width: '600px' } }}
        >
          {renderModalContent()}
        </Modal>
      )}
      <style>
        {`
          @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }
        `}
      </style>
    </>
  );
});