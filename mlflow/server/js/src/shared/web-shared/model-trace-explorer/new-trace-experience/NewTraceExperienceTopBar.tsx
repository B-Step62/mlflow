import {
  Button,
  ChevronDownIcon,
  ChevronUpIcon,
  CloseIcon,
  FullscreenExitIcon,
  FullscreenIcon,
  LinkIcon,
  NewWindowIcon,
  SearchIcon,
  Tooltip,
  useDesignSystemTheme,
} from '@databricks/design-system';
import { FormattedMessage, useIntl } from '@databricks/i18n';

import { useNewTraceExperienceShellContext } from './NewTraceExperienceShellContext';

type Props = {
  traceId: string;
};

export const NewTraceExperienceTopBar = ({ traceId }: Props) => {
  const { theme } = useDesignSystemTheme();
  const intl = useIntl();
  const shell = useNewTraceExperienceShellContext();

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
        padding: `${theme.spacing.xs}px ${theme.spacing.sm}px`,
        flexShrink: 0,
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
        {traceId}
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
      {!shell && (
        <FormattedMessage
          defaultMessage="(unwired)"
          description="Inline label rendered next to the trace id when the new trace experience shell is not yet wired to drawer-level actions"
        />
      )}
    </div>
  );
};
