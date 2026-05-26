import {
  Button,
  Checkbox,
  ChevronDownIcon,
  ChevronUpIcon,
  CloseIcon,
  FilterIcon,
  FullscreenExitIcon,
  FullscreenIcon,
  LinkIcon,
  NewWindowIcon,
  Popover,
  SearchIcon,
  Tooltip,
  Typography,
  useDesignSystemTheme,
} from '@databricks/design-system';
import { FormattedMessage, useIntl } from '@databricks/i18n';

import type { SpanFilterState } from '../ModelTrace.types';
import { getDisplayNameForSpanType, getIconTypeForSpan } from '../ModelTraceExplorer.utils';
import { ModelTraceExplorerIcon } from '../ModelTraceExplorerIcon';
import { useNewTraceExperienceShellContext } from './NewTraceExperienceShellContext';

const TRACE_ID_DISPLAY_PREFIX_LENGTH = 12;

const truncateTraceId = (id: string) =>
  id.length > TRACE_ID_DISPLAY_PREFIX_LENGTH + 1 ? `${id.slice(0, TRACE_ID_DISPLAY_PREFIX_LENGTH)}…` : id;

type Props = {
  traceId: string;
  spanFilterState: SpanFilterState;
  setSpanFilterState: (state: SpanFilterState) => void;
};

export const NewTraceExperienceTopBar = ({ traceId, spanFilterState, setSpanFilterState }: Props) => {
  const { theme } = useDesignSystemTheme();
  const intl = useIntl();
  const shell = useNewTraceExperienceShellContext();
  const displayedTraceId = truncateTraceId(traceId);

  const previousLabel = intl.formatMessage({
    defaultMessage: 'Previous trace',
    description: 'Tooltip for the up-arrow button that navigates to the previous trace in the list',
  });
  const nextLabel = intl.formatMessage({
    defaultMessage: 'Next trace',
    description: 'Tooltip for the down-arrow button that navigates to the next trace in the list',
  });
  const fullscreenEnterLabel = intl.formatMessage({
    defaultMessage: 'Enter full screen',
    description: 'Tooltip for the button that expands the trace drawer to full screen',
  });
  const fullscreenExitLabel = intl.formatMessage({
    defaultMessage: 'Exit full screen',
    description: 'Tooltip for the button that shrinks the trace drawer back from full screen',
  });
  const searchLabel = intl.formatMessage({
    defaultMessage: 'Search in trace',
    description: 'Tooltip for the search button that reveals the in-trace search field',
  });
  const filterLabel = intl.formatMessage({
    defaultMessage: 'Filter spans',
    description: 'Tooltip for the filter button in the new trace experience top bar',
  });
  const shareLabel = intl.formatMessage({
    defaultMessage: 'Copy link to trace',
    description: 'Tooltip for the share button that copies the trace URL to the clipboard',
  });
  const openInNewTabLabel = intl.formatMessage({
    defaultMessage: 'Open trace in new tab',
    description: 'Tooltip for the button that opens the current trace in a new browser tab',
  });
  const closeLabel = intl.formatMessage({
    defaultMessage: 'Close trace',
    description: 'Tooltip for the button that closes the trace drawer',
  });

  return (
    <div
      css={{
        display: 'flex',
        alignItems: 'center',
        gap: theme.spacing.xs,
        // Align the left edge of the top-bar buttons with the left edge of the
        // tab strip labels below (Tabs.List uses paddingLeft: lg).
        paddingLeft: theme.spacing.lg,
        paddingRight: theme.spacing.md,
        paddingTop: theme.spacing.sm,
        paddingBottom: theme.spacing.sm,
        flexShrink: 0,
        // Give every icon-button in the top bar a subtle rounded outline.
        // DS Button hard-sets `border: none`, so paint the outline with an
        // inset box-shadow and compound the selector for enough specificity
        // to beat DS's own !important rule.
        '& button.du-bois-light-btn': {
          boxShadow: `inset 0 0 0 1px ${theme.colors.actionDefaultBorderDefault} !important`,
          borderRadius: `${theme.legacyBorders.borderRadiusMd}px !important`,
          backgroundColor: 'transparent !important',
        },
      }}
    >
      {shell && (
        <Tooltip
          componentId="mlflow.new-trace-experience.fullscreen.tooltip"
          content={shell.isFullscreen ? fullscreenExitLabel : fullscreenEnterLabel}
        >
          <Button
            componentId="mlflow.new-trace-experience.fullscreen"
            aria-label={shell.isFullscreen ? fullscreenExitLabel : fullscreenEnterLabel}
            icon={shell.isFullscreen ? <FullscreenExitIcon /> : <FullscreenIcon />}
            onClick={shell.toggleFullscreen}
            size="small"
          />
        </Tooltip>
      )}
      {shell && (
        <Tooltip componentId="mlflow.new-trace-experience.previous.tooltip" content={previousLabel}>
          <Button
            componentId="mlflow.new-trace-experience.previous"
            aria-label={previousLabel}
            icon={<ChevronUpIcon />}
            disabled={!shell.isPreviousAvailable}
            onClick={shell.selectPreviousTrace}
            size="small"
          />
        </Tooltip>
      )}
      {shell && (
        <Tooltip componentId="mlflow.new-trace-experience.next.tooltip" content={nextLabel}>
          <Button
            componentId="mlflow.new-trace-experience.next"
            aria-label={nextLabel}
            icon={<ChevronDownIcon />}
            disabled={!shell.isNextAvailable}
            onClick={shell.selectNextTrace}
            size="small"
          />
        </Tooltip>
      )}
      <div
        css={{
          marginLeft: theme.spacing.sm,
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          fontSize: theme.typography.fontSizeSm,
          color: theme.colors.textSecondary,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          flex: 1,
        }}
        title={traceId}
      >
        {displayedTraceId}
      </div>
      <Tooltip componentId="mlflow.new-trace-experience.search.tooltip" content={searchLabel}>
        <Button
          componentId="mlflow.new-trace-experience.search"
          aria-label={searchLabel}
          icon={<SearchIcon />}
          size="small"
          disabled
        />
      </Tooltip>
      <Popover.Root componentId="mlflow.new-trace-experience.filter-popover">
        <Popover.Trigger asChild>
          <Tooltip componentId="mlflow.new-trace-experience.filter.tooltip" content={filterLabel}>
            <Button
              componentId="mlflow.new-trace-experience.filter"
              aria-label={filterLabel}
              icon={<FilterIcon />}
              size="small"
            />
          </Tooltip>
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
                description="Section label for span type filters in the new trace experience"
              />
            </Typography.Text>
            {Object.entries(spanFilterState.spanTypeDisplayState).map(([spanType, shouldDisplay]) => (
              <Checkbox
                key={spanType}
                componentId="mlflow.new-trace-experience.filter.span-type"
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
              componentId="mlflow.new-trace-experience.filter.show-parents"
              isChecked={spanFilterState.showParents}
              onChange={() => setSpanFilterState({ ...spanFilterState, showParents: !spanFilterState.showParents })}
            >
              <FormattedMessage
                defaultMessage="Always show parents"
                description="Checkbox label for showing parent spans regardless of filter in the new trace experience"
              />
            </Checkbox>
            <Checkbox
              componentId="mlflow.new-trace-experience.filter.show-exceptions"
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
      {shell && (
        <Tooltip componentId="mlflow.new-trace-experience.share.tooltip" content={shareLabel}>
          <Button
            componentId="mlflow.new-trace-experience.share"
            aria-label={shareLabel}
            icon={<LinkIcon />}
            onClick={shell.onShare}
            size="small"
          />
        </Tooltip>
      )}
      {shell?.onOpenInNewTab && (
        <Tooltip componentId="mlflow.new-trace-experience.open-in-new-tab.tooltip" content={openInNewTabLabel}>
          <Button
            componentId="mlflow.new-trace-experience.open-in-new-tab"
            aria-label={openInNewTabLabel}
            icon={<NewWindowIcon />}
            onClick={shell.onOpenInNewTab}
            size="small"
          />
        </Tooltip>
      )}
      {shell && (
        <Tooltip componentId="mlflow.new-trace-experience.close.tooltip" content={closeLabel}>
          <Button
            componentId="mlflow.new-trace-experience.close"
            aria-label={closeLabel}
            icon={<CloseIcon />}
            onClick={shell.onClose}
            size="small"
          />
        </Tooltip>
      )}
    </div>
  );
};
