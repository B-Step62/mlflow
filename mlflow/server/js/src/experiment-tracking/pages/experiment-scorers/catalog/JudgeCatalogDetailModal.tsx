import { Button, CopyIcon, Modal, Tag, Typography, useDesignSystemTheme } from '@databricks/design-system';
import { FormattedMessage } from '@databricks/i18n';
import type { CatalogEntry } from './types';
import { getProviderDisplayName, getTagDisplayName } from './judgeCatalogUtils';
import { COMPONENT_ID_PREFIX } from '../constants';
import ProviderLogo from './ProviderLogo';

interface JudgeCatalogDetailModalProps {
  entry: CatalogEntry | null;
  visible: boolean;
  onClose: () => void;
}

const JudgeCatalogDetailModal: React.FC<JudgeCatalogDetailModalProps> = ({ entry, visible, onClose }) => {
  const { theme } = useDesignSystemTheme();

  if (!entry) {
    return null;
  }

  const handleCopyCode = () => {
    navigator.clipboard.writeText(entry.codeSnippet);
  };

  return (
    <Modal
      componentId={`${COMPONENT_ID_PREFIX}.catalog.detail-modal`}
      title={entry.name}
      visible={visible}
      onCancel={onClose}
      footer={null}
      destroyOnClose
      size="wide"
    >
      <div css={{ display: 'flex', flexDirection: 'column', gap: theme.spacing.md }}>
        {/* Provider + Tags row */}
        <div css={{ display: 'flex', alignItems: 'center', gap: theme.spacing.sm, flexWrap: 'wrap' }}>
          <div css={{ display: 'flex', alignItems: 'center', gap: theme.spacing.xs }}>
            <ProviderLogo provider={entry.provider} size={20} />
            <Typography.Text bold>{getProviderDisplayName(entry.provider)}</Typography.Text>
          </div>
          <div css={{ display: 'flex', gap: theme.spacing.xs, flexWrap: 'wrap' }}>
            {entry.tags.map((tag) => (
              <Tag key={tag} componentId={`${COMPONENT_ID_PREFIX}.catalog.detail-tag`} css={{ margin: 0 }}>
                {getTagDisplayName(tag)}
              </Tag>
            ))}
          </div>
          {entry.evaluationLevel === 'session' && (
            <Tag
              componentId={`${COMPONENT_ID_PREFIX}.catalog.detail-session-tag`}
              css={{ margin: 0 }}
              color="turquoise"
            >
              <FormattedMessage defaultMessage="Session-level" description="Tag for session-level scorer in catalog" />
            </Tag>
          )}
        </div>

        {/* Description */}
        <div>
          <Typography.Title level={4}>
            <FormattedMessage
              defaultMessage="Description"
              description="Section title for judge description in catalog detail modal"
            />
          </Typography.Title>
          <Typography.Paragraph>{entry.description}</Typography.Paragraph>
        </div>

        {/* Prompt / Instructions (built-in judges only) */}
        {entry.instructions && (
          <div>
            <Typography.Title level={4}>
              <FormattedMessage
                defaultMessage="Prompt"
                description="Section title for judge prompt in catalog detail modal"
              />
            </Typography.Title>
            <pre
              css={{
                backgroundColor: theme.colors.backgroundSecondary,
                padding: theme.spacing.sm,
                borderRadius: theme.borders.borderRadiusMd,
                overflow: 'auto',
                maxHeight: 300,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                fontSize: theme.typography.fontSizeSm,
              }}
            >
              {entry.instructions}
            </pre>
          </div>
        )}

        {/* Code snippet */}
        <div>
          <div css={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Typography.Title level={4}>
              <FormattedMessage
                defaultMessage="Usage"
                description="Section title for code snippet in catalog detail modal"
              />
            </Typography.Title>
            <Button
              componentId={`${COMPONENT_ID_PREFIX}.catalog.detail-copy-code`}
              type="tertiary"
              icon={<CopyIcon />}
              onClick={handleCopyCode}
              size="small"
            >
              <FormattedMessage
                defaultMessage="Copy"
                description="Button text to copy code snippet in catalog detail modal"
              />
            </Button>
          </div>
          {entry.installCommand && (
            <pre
              css={{
                backgroundColor: theme.colors.backgroundSecondary,
                padding: theme.spacing.sm,
                borderRadius: theme.borders.borderRadiusMd,
                marginBottom: theme.spacing.xs,
                overflow: 'auto',
              }}
            >
              <code>{entry.installCommand}</code>
            </pre>
          )}
          <pre
            css={{
              backgroundColor: theme.colors.backgroundSecondary,
              padding: theme.spacing.sm,
              borderRadius: theme.borders.borderRadiusMd,
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

export default JudgeCatalogDetailModal;
