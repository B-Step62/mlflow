import { Modal, Typography } from '@databricks/design-system';
import { FormattedMessage, useIntl } from '@databricks/i18n';
import type { Webhook } from './webhooksApi';

interface WebhookDeleteModalProps {
  visible: boolean;
  webhook: Webhook | null;
  onCancel: () => void;
  onConfirm: () => void;
  mode?: 'webhook' | 'automation';
}

const WebhookDeleteModal = ({
  visible,
  webhook,
  onCancel,
  onConfirm,
  mode = 'webhook',
}: WebhookDeleteModalProps) => {
  const intl = useIntl();

  return (
    <Modal
      componentId="mlflow.settings.webhooks.delete-modal"
      title={
        mode === 'automation'
          ? intl.formatMessage({ defaultMessage: 'Delete automation', description: 'Delete automation modal title' })
          : intl.formatMessage({ defaultMessage: 'Delete webhook', description: 'Delete webhook modal title' })
      }
      visible={visible}
      onCancel={onCancel}
      onOk={onConfirm}
      okText={intl.formatMessage({ defaultMessage: 'Delete', description: 'Confirm delete webhook button' })}
      cancelText={intl.formatMessage({ defaultMessage: 'Cancel', description: 'Cancel delete webhook button' })}
      okButtonProps={{ danger: true }}
    >
      <Typography.Text>
        {mode === 'automation' ? (
          <FormattedMessage
            defaultMessage='Are you sure you want to delete the automation "{name}"? This action cannot be undone.'
            description="Delete automation confirmation message"
            values={{ name: webhook?.name ?? '' }}
          />
        ) : (
          <FormattedMessage
            defaultMessage='Are you sure you want to delete the webhook "{name}"? This action cannot be undone.'
            description="Delete webhook confirmation message"
            values={{ name: webhook?.name ?? '' }}
          />
        )}
      </Typography.Text>
    </Modal>
  );
};

export default WebhookDeleteModal;
