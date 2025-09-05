import React, { useState, useEffect } from 'react';
import { Modal, Input, Button, useDesignSystemTheme } from '@databricks/design-system';
import { RunsChartsAIGeneratedCardConfig } from '../../runs-charts.types';
import Editor from '@monaco-editor/react';

interface RunsChartsAIGeneratedChartConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
  config: RunsChartsAIGeneratedCardConfig;
  onSave: (updatedConfig: RunsChartsAIGeneratedCardConfig) => void;
}

export const RunsChartsAIGeneratedChartConfigModal: React.FC<RunsChartsAIGeneratedChartConfigModalProps> = ({
  isOpen,
  onClose,
  config,
  onSave,
}) => {
  const { theme } = useDesignSystemTheme();
  const [title, setTitle] = useState(config.displayName || 'AI Generated Chart');
  const [chartCode, setChartCode] = useState(config.chartCode || '');
  const [codeError, setCodeError] = useState<string | null>(null);

  useEffect(() => {
    setTitle(config.displayName || 'AI Generated Chart');
    setChartCode(config.chartCode || '');
    setCodeError(null);
  }, [config, isOpen]);

  const validateCode = (code: string) => {
    try {
      // Basic validation - check if it's valid JavaScript
      // In production, you might want more sophisticated validation
      new Function('React', 'useState', 'useEffect', 'LazyPlot', 'useDesignSystemTheme', code);
      setCodeError(null);
      return true;
    } catch (error) {
      setCodeError(error instanceof Error ? error.message : 'Invalid code');
      return false;
    }
  };

  const handleSave = () => {
    if (validateCode(chartCode)) {
      const updatedConfig = {
        ...config,
        displayName: title,
        chartCode: chartCode,
      };
      onSave(updatedConfig);
      onClose();
    }
  };

  const handleCodeChange = (value: string | undefined) => {
    setChartCode(value || '');
    // Clear error when user starts typing
    if (codeError) {
      setCodeError(null);
    }
  };

  return (
    <Modal
      visible={isOpen}
      onCancel={onClose}
      title="Configure AI Generated Chart"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="primary" onClick={handleSave}>
            Save Changes
          </Button>
        </>
      }
      size="wide"
    >
      <div
        css={{
          display: 'flex',
          flexDirection: 'column',
          gap: theme.spacing.md,
        }}
      >
        {/* Title Input */}
        <div>
          <label
            css={{
              display: 'block',
              marginBottom: theme.spacing.xs,
              fontWeight: theme.typography.typographyBoldFontWeight,
            }}
          >
            Chart Title
          </label>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Enter chart title"
            css={{ width: '100%' }}
          />
        </div>

        {/* Code Editor */}
        <div>
          <label
            css={{
              display: 'block',
              marginBottom: theme.spacing.xs,
              fontWeight: theme.typography.typographyBoldFontWeight,
            }}
          >
            Chart Code
          </label>
          <div
            css={{
              border: `1px solid ${theme.colors.border}`,
              borderRadius: theme.borders.borderRadiusMd,
              overflow: 'hidden',
              height: '400px',
            }}
          >
            <Editor
              height="400px"
              defaultLanguage="javascript"
              value={chartCode}
              onChange={handleCodeChange}
              theme={theme.isDarkMode ? 'vs-dark' : 'light'}
              options={{
                minimap: { enabled: false },
                fontSize: 14,
                lineNumbers: 'on',
                scrollBeyondLastLine: false,
                wordWrap: 'on',
                automaticLayout: true,
                tabSize: 2,
              }}
            />
          </div>
          {codeError && (
            <div
              css={{
                marginTop: theme.spacing.xs,
                color: theme.colors.textValidationDanger,
                fontSize: theme.typography.fontSizeSm,
              }}
            >
              {codeError}
            </div>
          )}
        </div>

        {/* Help Text */}
        <div
          css={{
            padding: theme.spacing.sm,
            backgroundColor: theme.colors.backgroundSecondary,
            borderRadius: theme.borders.borderRadiusMd,
            fontSize: theme.typography.fontSizeSm,
            color: theme.colors.textSecondary,
          }}
        >
          <strong>Tips:</strong>
          <ul css={{ marginTop: theme.spacing.xs, paddingLeft: theme.spacing.md }}>
            <li>The chart component receives props: runId, experimentId</li>
            <li>Available libraries: React, useState, useEffect, LazyPlot (for Plotly charts)</li>
            <li>Return a React component named 'GeneratedChart'</li>
            <li>Use LazyPlot for creating interactive Plotly charts</li>
          </ul>
        </div>
      </div>
    </Modal>
  );
};