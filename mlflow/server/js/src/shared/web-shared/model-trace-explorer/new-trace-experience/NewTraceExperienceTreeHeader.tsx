import {
  Button,
  Checkbox,
  OverflowIcon,
  Popover,
  Typography,
  useDesignSystemTheme,
} from '@databricks/design-system';
import { FormattedMessage, useIntl } from '@databricks/i18n';

import type { SpanFilterState } from '../ModelTrace.types';
import { getDisplayNameForSpanType, getIconTypeForSpan } from '../ModelTraceExplorer.utils';
import { ModelTraceExplorerIcon } from '../ModelTraceExplorerIcon';

type Props = {
  isOpen: boolean;
  onToggle: () => void;
  spanFilterState: SpanFilterState;
  setSpanFilterState: (state: SpanFilterState) => void;
};

export const NewTraceExperienceTreeHeader = ({ isOpen, onToggle, spanFilterState, setSpanFilterState }: Props) => {
  const { theme } = useDesignSystemTheme();
  const intl = useIntl();

  const moreLabel = intl.formatMessage({
    defaultMessage: 'Tree options',
    description: 'Tooltip for the three-dot overflow menu on the trace tree header in the new trace experience',
  });

  return (
    <div
      css={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingLeft: theme.spacing.sm,
        paddingRight: theme.spacing.xs,
        paddingTop: theme.spacing.xs,
        paddingBottom: theme.spacing.xs,
        flexShrink: 0,
      }}
    >
      <Button
        componentId="mlflow.new-trace-experience.tree.toggle"
        size="small"
        onClick={onToggle}
        css={{
          // Default-typed button (bordered, neutral text color).
          color: `${theme.colors.textPrimary} !important`,
          fontWeight: theme.typography.typographyRegularFontWeight,
          // Force a visible bordered chip. DS Button hard-codes
          // `border: none`, so paint the outline with inset box-shadow.
          boxShadow: `inset 0 0 0 1px ${theme.colors.actionDefaultBorderDefault} !important`,
          borderRadius: `${theme.legacyBorders.borderRadiusMd}px !important`,
          backgroundColor: 'transparent !important',
        }}
      >
        <FormattedMessage
          defaultMessage="Trace breakdown"
          description="Label for the collapse/expand button at the top of the new trace experience left pane"
        />
      </Button>
      <Popover.Root componentId="mlflow.new-trace-experience.tree.filter-popover">
        <Popover.Trigger asChild>
          <Button
            componentId="mlflow.new-trace-experience.tree.filter-trigger"
            type="tertiary"
            size="small"
            icon={<OverflowIcon />}
            aria-label={moreLabel}
          />
        </Popover.Trigger>
        <Popover.Content align="end">
          <div
            css={{
              display: 'flex',
              flexDirection: 'column',
              gap: theme.spacing.sm,
              width: 240,
              paddingBottom: theme.spacing.xs,
            }}
          >
            <Typography.Text bold>
              <FormattedMessage
                defaultMessage="Filter spans"
                description="Heading for the span filter popover in the new trace experience"
              />
            </Typography.Text>
            <Typography.Text color="secondary">
              <FormattedMessage
                defaultMessage="Span type"
                description="Section label for span type filters in the new trace experience tree header popover"
              />
            </Typography.Text>
            {Object.entries(spanFilterState.spanTypeDisplayState).map(([spanType, shouldDisplay]) => (
              <Checkbox
                key={spanType}
                componentId="mlflow.new-trace-experience.tree.filter-span-type"
                isChecked={shouldDisplay}
                onChange={() =>
                  setSpanFilterState({
                    ...spanFilterState,
                    spanTypeDisplayState: {
                      ...spanFilterState.spanTypeDisplayState,
                      [spanType]: !shouldDisplay,
                    },
                  })
                }
              >
                <span css={{ display: 'inline-flex', alignItems: 'center', gap: theme.spacing.xs }}>
                  <ModelTraceExplorerIcon type={getIconTypeForSpan(spanType)} />
                  <Typography.Text>{getDisplayNameForSpanType(spanType)}</Typography.Text>
                </span>
              </Checkbox>
            ))}
            <Checkbox
              componentId="mlflow.new-trace-experience.tree.filter-show-parents"
              isChecked={spanFilterState.showParents}
              onChange={() => setSpanFilterState({ ...spanFilterState, showParents: !spanFilterState.showParents })}
            >
              <FormattedMessage
                defaultMessage="Always show parents"
                description="Checkbox label for showing parent spans regardless of filter in the new trace experience"
              />
            </Checkbox>
            <Checkbox
              componentId="mlflow.new-trace-experience.tree.filter-show-exceptions"
              isChecked={spanFilterState.showExceptions}
              onChange={() =>
                setSpanFilterState({ ...spanFilterState, showExceptions: !spanFilterState.showExceptions })
              }
            >
              <FormattedMessage
                defaultMessage="Always show exceptions"
                description="Checkbox label for showing spans with exceptions regardless of filter in the new trace experience"
              />
            </Checkbox>
          </div>
        </Popover.Content>
      </Popover.Root>
    </div>
  );
};
