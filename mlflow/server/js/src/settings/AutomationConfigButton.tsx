import { useState } from 'react';
import { Button, LightningIcon, Modal, Typography, useDesignSystemTheme } from '@databricks/design-system';
import { FormattedMessage, useIntl } from '@databricks/i18n';
import WebhooksSettings from './WebhooksSettings';
import { eventKey } from './webhookConstants';

export interface AutomationConfigButtonProps {
  componentId: string;
  sourceType: 'experiment' | 'review_queue' | 'dataset' | 'trace';
  sourceId: string;
  experimentId?: string;
  eventFilter: string;
  defaultEventAction?: string;
  defaultCondition?: string;
  title: React.ReactNode;
  description?: React.ReactNode;
  buttonText?: React.ReactNode;
  size?: 'small' | 'middle';
}

export const AutomationConfigButton = ({
  componentId,
  sourceType,
  sourceId,
  experimentId,
  eventFilter,
  defaultEventAction,
  defaultCondition,
  title,
  description,
  buttonText,
  size = 'middle',
}: AutomationConfigButtonProps) => {
  const intl = useIntl();
  const { theme } = useDesignSystemTheme();
  const [isOpen, setIsOpen] = useState(false);
  const defaultEvents = defaultEventAction ? [eventKey(eventFilter, defaultEventAction)] : undefined;

  return (
    <>
      <Button
        componentId={componentId}
        icon={<LightningIcon />}
        size={size}
        onClick={() => setIsOpen(true)}
        aria-label={intl.formatMessage({
          defaultMessage: 'Automations',
          description: 'Button aria label for opening object-scoped Automations settings',
        })}
      >
        {buttonText ?? (
          <FormattedMessage defaultMessage="Automations" description="Button text for object-scoped Automations" />
        )}
      </Button>
      <Modal
        componentId={`${componentId}.modal`}
        visible={isOpen}
        title={
          <span css={{ display: 'inline-flex', alignItems: 'center', gap: theme.spacing.sm }}>
            <LightningIcon />
            {title}
          </span>
        }
        onCancel={() => setIsOpen(false)}
        footer={null}
        size="wide"
      >
        {description && (
          <Typography.Text
            color="secondary"
            css={{ display: 'block', marginTop: -theme.spacing.sm, marginBottom: theme.spacing.md }}
          >
            {description}
          </Typography.Text>
        )}
        <WebhooksSettings
          mode="automation"
          showTitle={false}
          showDescription={false}
          sourceType={sourceType}
          sourceId={sourceId}
          experimentId={experimentId}
          eventFilter={eventFilter}
          defaultEvents={defaultEvents}
          defaultCondition={defaultCondition}
          lockSource
          emptyDescription={
            <FormattedMessage
              defaultMessage="No automations configured for this object. Create one to get started."
              description="Empty state for object-scoped Automations modal"
            />
          }
        />
      </Modal>
    </>
  );
};
