import { useState } from 'react';

import {
  Button,
  ChevronDownIcon,
  DropdownMenu,
  LayerIcon,
  PlusIcon,
  useDesignSystemTheme,
} from '@databricks/design-system';
import { FormattedMessage } from '@databricks/i18n';

// Dummy custom views. In a real implementation these would be persisted on the
// experiment and fetched from the backend.
const DUMMY_CUSTOM_VIEWS = ['Default view', 'Errors only', 'Latency deep-dive'];

/**
 * Dummy selector for switching between custom trace views stored on the
 * experiment, or creating a new one. Not yet wired up to any backend.
 */
export const ModelTraceExplorerCustomViewSelector = ({ size }: { size?: 'small' }) => {
  const { theme } = useDesignSystemTheme();
  const [selectedView, setSelectedView] = useState(DUMMY_CUSTOM_VIEWS[0]);

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <Button
          componentId="mlflow.evaluations_review.modal.custom_view_selector"
          icon={<LayerIcon />}
          endIcon={<ChevronDownIcon />}
          size={size}
          css={{ flexShrink: 0 }}
        >
          {selectedView}
        </Button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Content align="start">
        <DropdownMenu.RadioGroup
          componentId="mlflow.evaluations_review.modal.custom_view_selector.radio"
          value={selectedView}
          onValueChange={setSelectedView}
        >
          {DUMMY_CUSTOM_VIEWS.map((view) => (
            <DropdownMenu.RadioItem key={view} value={view}>
              <DropdownMenu.ItemIndicator />
              {view}
            </DropdownMenu.RadioItem>
          ))}
        </DropdownMenu.RadioGroup>
        <DropdownMenu.Separator />
        <DropdownMenu.Item
          componentId="mlflow.evaluations_review.modal.custom_view_selector.create"
          onClick={() => {
            // Dummy: creating a new view is not wired up yet.
          }}
        >
          <PlusIcon css={{ marginRight: theme.spacing.sm }} />
          <FormattedMessage
            defaultMessage="Create new view"
            description="Menu item that creates a new custom trace view from the trace drawer header"
          />
        </DropdownMenu.Item>
      </DropdownMenu.Content>
    </DropdownMenu.Root>
  );
};
