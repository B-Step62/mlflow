import { Button, useDesignSystemTheme } from '@databricks/design-system';
import React, { useState } from 'react';
import { LazyPlot } from '../LazyPlot';

interface CustomChartDisplayProps {
  chartCode?: string;
  isLoading?: boolean;
  error?: string;
  progress?: string | null;
  onSave?: () => void;
  onViewCode?: () => void;
  onRegenerate?: () => void;
  onAddChart?: () => void;
}

export const CustomChartDisplay: React.FC<CustomChartDisplayProps> = ({
  chartCode,
  isLoading = false,
  error,
  progress,
  onSave,
  onViewCode,
  onRegenerate,
  onAddChart,
}) => {
  const { theme } = useDesignSystemTheme();
  const [showSecurityWarning, setShowSecurityWarning] = useState(true);

  // Sample chart data for demonstration
  const sampleChartData = {
    data: [
      {
        x: [1, 2, 3, 4, 5],
        y: [2, 4, 3, 5, 6],
        type: 'scatter' as const,
        mode: 'lines+markers' as const,
        name: 'Sample Metric',
        line: { color: theme.colors.primary },
      },
    ],
    layout: {
      title: 'Generated Chart Preview',
      xaxis: { title: 'Step' },
      yaxis: { title: 'Value' },
      autosize: true,
      margin: { t: 40, r: 20, b: 40, l: 60 },
    },
  };

  const renderContent = () => {
    if (isLoading) {
      return (
        <div
          css={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            height: '300px',
            backgroundColor: theme.colors.backgroundSecondary,
            borderRadius: theme.borders.borderRadiusMd,
          }}
        >
          <div css={{ textAlign: 'center' }}>
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
            <p css={{ color: theme.colors.textSecondary }}>
              {progress || 'Generating your custom chart...'}
            </p>
            <p css={{ 
              color: theme.colors.textSecondary, 
              fontSize: theme.typography.fontSizeSm,
              marginTop: theme.spacing.sm 
            }}>
              This may take a few moments
            </p>
          </div>
        </div>
      );
    }

    if (error) {
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
          <div css={{ display: 'flex', gap: theme.spacing.sm, alignItems: 'center' }}>
            {onRegenerate && (
              <Button
                componentId="mlflow.custom-charts.regenerate-button"
                type="primary"
                onClick={onRegenerate}
              >
                Try Again
              </Button>
            )}
            <p css={{ 
              margin: 0, 
              fontSize: theme.typography.fontSizeSm, 
              color: theme.colors.textSecondary 
            }}>
              Try rephrasing your request or check your data connection
            </p>
          </div>
        </div>
      );
    }

    if (!chartCode) {
      return (
        <div
          css={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            height: '200px',
            backgroundColor: theme.colors.backgroundSecondary,
            borderRadius: theme.borders.borderRadiusMd,
            color: theme.colors.textSecondary,
          }}
        >
          No chart generated yet
        </div>
      );
    }

    return (
      <div>
        {/* Security warning */}
        <div
          css={{
            padding: theme.spacing.md,
            marginBottom: theme.spacing.md,
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
                marginBottom: theme.spacing.sm,
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
              maxHeight: '400px',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}
          >
            {chartCode}
          </pre>
        </div>

        {/* Add Chart button */}
        {onAddChart && (
          <div css={{ marginTop: theme.spacing.md, textAlign: 'right' }}>
            <Button
              componentId="mlflow.custom-charts.add-chart-button"
              type="primary"
              onClick={onAddChart}
            >
              Add Chart
            </Button>
          </div>
        )}
      </div>
    );
  };

  return (
    <div
      css={{
        display: 'flex',
        flexDirection: 'column',
        gap: theme.spacing.md,
      }}
    >
      {renderContent()}

      {chartCode && !error && !isLoading && (
        <div
          css={{
            display: 'flex',
            gap: theme.spacing.sm,
            justifyContent: 'flex-end',
          }}
        >
          {onViewCode && (
            <Button componentId="mlflow.custom-charts.view-code-button" onClick={onViewCode}>
              View Code
            </Button>
          )}
          {onSave && (
            <Button componentId="mlflow.custom-charts.save-button" type="primary" onClick={onSave}>
              Save Chart
            </Button>
          )}
        </div>
      )}

      <style>
        {`
          @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }
        `}
      </style>
    </div>
  );
};