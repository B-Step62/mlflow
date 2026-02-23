import { Button, CopyIcon, Modal, Typography, useDesignSystemTheme } from '@databricks/design-system';
import { FormattedMessage } from '@databricks/i18n';
import type { CatalogEntry } from './types';
import { getProviderDisplayName } from './judgeCatalogUtils';
import { COMPONENT_ID_PREFIX } from '../constants';

interface JudgeCatalogCodeSnippetModalProps {
  entry: CatalogEntry | null;
  visible: boolean;
  onClose: () => void;
}

const JudgeCatalogCodeSnippetModal: React.FC<JudgeCatalogCodeSnippetModalProps> = ({ entry, visible, onClose }) => {
  const { theme } = useDesignSystemTheme();

  if (!entry) {
    return null;
  }

  const handleCopy = () => {
    navigator.clipboard.writeText(entry.codeSnippet);
  };

  return (
    <Modal
      componentId={`${COMPONENT_ID_PREFIX}.catalog.code-snippet-modal`}
      title={entry.name}
      visible={visible}
      onCancel={onClose}
      footer={null}
      destroyOnClose
    >
      <div css={{ display: 'flex', flexDirection: 'column', gap: theme.spacing.md }}>
        {entry.installCommand && (
          <div>
            <Typography.Text bold>
              <FormattedMessage
                defaultMessage="Install"
                description="Label for install command in judge catalog code snippet modal"
              />
            </Typography.Text>
            <pre
              css={{
                backgroundColor: theme.colors.backgroundSecondary,
                padding: theme.spacing.sm,
                borderRadius: theme.borders.borderRadiusMd,
                marginTop: theme.spacing.xs,
                overflow: 'auto',
              }}
            >
              <code>{entry.installCommand}</code>
            </pre>
          </div>
        )}
        <div>
          <div css={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Typography.Text bold>
              <FormattedMessage
                defaultMessage="Usage ({providerName})"
                description="Label for usage code snippet in judge catalog code snippet modal"
                values={{ providerName: getProviderDisplayName(entry.provider) }}
              />
            </Typography.Text>
            <Button
              componentId={`${COMPONENT_ID_PREFIX}.catalog.copy-code-snippet`}
              type="tertiary"
              icon={<CopyIcon />}
              onClick={handleCopy}
              size="small"
            >
              <FormattedMessage
                defaultMessage="Copy"
                description="Button text to copy code snippet in judge catalog modal"
              />
            </Button>
          </div>
          <pre
            css={{
              backgroundColor: theme.colors.backgroundSecondary,
              padding: theme.spacing.sm,
              borderRadius: theme.borders.borderRadiusMd,
              marginTop: theme.spacing.xs,
              overflow: 'auto',
            }}
          >
            <code>{entry.codeSnippet}</code>
          </pre>
        </div>
      </div>
    </Modal>
  );
};

export default JudgeCatalogCodeSnippetModal;
