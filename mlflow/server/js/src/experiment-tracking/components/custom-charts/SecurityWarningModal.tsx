import { Button, Checkbox, Modal, useDesignSystemTheme } from '@databricks/design-system';
import React, { useState } from 'react';

interface SecurityWarningModalProps {
  isOpen: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  chartCode: string;
}

export const SecurityWarningModal: React.FC<SecurityWarningModalProps> = ({
  isOpen,
  onConfirm,
  onCancel,
  chartCode,
}) => {
  const { theme } = useDesignSystemTheme();
  const [understood, setUnderstood] = useState(false);

  const handleConfirm = () => {
    if (understood) {
      onConfirm();
    }
  };

  return (
    <Modal
      title="⚠️ Security Warning: Code Execution"
      visible={isOpen}
      onCancel={onCancel}
      footer={[
        <Button key="cancel" componentId="mlflow.custom-charts.security-cancel" onClick={onCancel}>
          Cancel
        </Button>,
        <Button
          key="confirm"
          componentId="mlflow.custom-charts.security-confirm"
          type="primary"
          onClick={handleConfirm}
          disabled={!understood}
        >
          Execute Chart Code
        </Button>,
      ]}
      width={600}
    >
      <div css={{ display: 'flex', flexDirection: 'column', gap: theme.spacing.md }}>
        <div
          css={{
            padding: theme.spacing.md,
            backgroundColor: theme.colors.backgroundWarning,
            borderRadius: theme.borders.borderRadiusMd,
            border: `1px solid ${theme.colors.borderWarning}`,
          }}
        >
          <h4 css={{ margin: '0 0 8px 0', color: theme.colors.textValidationWarning }}>
            This chart contains generated JavaScript code
          </h4>
          <p css={{ margin: 0, color: theme.colors.textPrimary }}>
            The code will be executed in your browser to render the chart. Please review the code below
            to ensure it's safe before proceeding.
          </p>
        </div>

        <div>
          <h4 css={{ margin: '0 0 8px 0' }}>Generated Code:</h4>
          <div
            css={{
              maxHeight: '300px',
              overflow: 'auto',
              padding: theme.spacing.sm,
              backgroundColor: theme.colors.backgroundSecondary,
              borderRadius: theme.borders.borderRadiusMd,
              border: `1px solid ${theme.colors.border}`,
              fontSize: theme.typography.fontSizeCode || theme.typography.fontSizeSm,
              fontFamily: 'monospace',
            }}
          >
            <pre
              css={{
                margin: 0,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}
            >
              {chartCode}
            </pre>
          </div>
        </div>

        <div
          css={{
            padding: theme.spacing.sm,
            backgroundColor: theme.colors.backgroundInfo,
            borderRadius: theme.borders.borderRadiusMd,
            border: `1px solid ${theme.colors.borderInfo}`,
          }}
        >
          <h4 css={{ margin: '0 0 8px 0', color: theme.colors.textValidationInfo }}>
            Security Best Practices:
          </h4>
          <ul css={{ margin: 0, paddingLeft: theme.spacing.md, color: theme.colors.textPrimary }}>
            <li>Review the code for any suspicious operations</li>
            <li>Ensure it only contains chart visualization code</li>
            <li>Look out for network requests or data access beyond MLflow APIs</li>
            <li>Avoid executing code that modifies global state or DOM outside the chart container</li>
          </ul>
        </div>

        <Checkbox
          checked={understood}
          onChange={(e) => setUnderstood(e.target.checked)}
        >
          I have reviewed the code above and understand the security implications of executing it
        </Checkbox>
      </div>
    </Modal>
  );
};