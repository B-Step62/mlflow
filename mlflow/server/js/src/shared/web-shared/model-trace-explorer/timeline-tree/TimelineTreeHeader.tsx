import {
  BarsAscendingVerticalIcon,
  Button,
  ConnectIcon,
  ListBorderIcon,
  SegmentedControlButton,
  SegmentedControlGroup,
  Tag,
  Tooltip,
  Typography,
  useDesignSystemTheme,
} from '@databricks/design-system';
import { FormattedMessage } from '@databricks/i18n';

import { TimelineTreeFilterButton } from './TimelineTreeFilterButton';
import type { SpanFilterState } from '../ModelTrace.types';
import { copyToClipboard } from '../../../../common/utils/copyToClipboard';

const getCompactTraceId = (traceId?: string) => {
  if (!traceId) {
    return undefined;
  }
  return traceId.startsWith('tr-') ? traceId.slice(3, 11) : traceId.slice(0, 8);
};

export const TimelineTreeHeader = ({
  showTimelineInfo,
  setShowTimelineInfo,
  spanFilterState,
  setSpanFilterState,
  showGraph,
  onToggleGraph,
  traceId,
}: {
  showTimelineInfo: boolean;
  setShowTimelineInfo: (showTimelineInfo: boolean) => void;
  spanFilterState: SpanFilterState;
  setSpanFilterState: (state: SpanFilterState) => void;
  showGraph?: boolean;
  onToggleGraph?: () => void;
  traceId?: string;
}) => {
  const { theme } = useDesignSystemTheme();
  const compactTraceId = getCompactTraceId(traceId);
  const handleCopyTraceId = async () => {
    if (traceId) {
      await copyToClipboard(traceId);
    }
  };

  return (
    <div
      css={{
        padding: `${theme.spacing.xs}px ${theme.spacing.sm}px`,
        paddingBottom: 3,
        borderTop: `2px solid ${theme.colors.border}`,
        borderBottom: `1px solid ${theme.colors.border}`,
        boxSizing: 'border-box',
        minHeight: theme.spacing.xl + 2 * theme.spacing.sm,
        paddingLeft: theme.spacing.sm,
        alignItems: 'center',
        display: 'flex',
        justifyContent: 'space-between',
        gap: theme.spacing.xs,
      }}
    >
      <div
        css={{
          display: 'flex',
          alignItems: 'center',
          gap: theme.spacing.xs,
          minWidth: 0,
        }}
      >
        <Typography.Text bold css={{ whiteSpace: 'nowrap' }}>
          <FormattedMessage
            defaultMessage="Trace"
            description="Header for the trace column within the MLflow trace UI"
          />
        </Typography.Text>
        {traceId && compactTraceId && (
          <Tooltip
            componentId="shared.model-trace-explorer.trace-id-badge-tooltip"
            content={
              <FormattedMessage
                defaultMessage="Copy trace ID: {traceId}"
                description="Tooltip for copying the trace ID from the trace column header"
                values={{ traceId }}
              />
            }
            maxWidth={400}
          >
            <Tag
              componentId="shared.model-trace-explorer.trace-id-badge"
              onClick={handleCopyTraceId}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  handleCopyTraceId();
                }
              }}
              role="button"
              tabIndex={0}
              css={{
                cursor: 'pointer',
                margin: 0,
                maxWidth: 96,
              }}
            >
              <Typography.Text size="sm" color="secondary" css={{ fontFamily: 'monospace', whiteSpace: 'nowrap' }}>
                {compactTraceId}
              </Typography.Text>
            </Tag>
          </Tooltip>
        )}
      </div>
      <div css={{ display: 'flex', flexDirection: 'row', gap: theme.spacing.sm, flexShrink: 0 }}>
        {onToggleGraph && (
          <Tooltip
            componentId="shared.model-trace-explorer.toggle-graph-tooltip"
            content={
              showGraph ? (
                <FormattedMessage
                  defaultMessage="Hide graph"
                  description="Tooltip for the button that hides the graph in the trace explorer."
                />
              ) : (
                <FormattedMessage
                  defaultMessage="Show graph"
                  description="Tooltip for the button that shows the graph in the trace explorer."
                />
              )
            }
          >
            <Button
              componentId="shared.model-trace-explorer.toggle-graph-button"
              icon={<ConnectIcon />}
              size="small"
              type={showGraph ? 'primary' : undefined}
              aria-label={showGraph ? 'Hide graph' : 'Show graph'}
              onClick={onToggleGraph}
            />
          </Tooltip>
        )}
        <TimelineTreeFilterButton spanFilterState={spanFilterState} setSpanFilterState={setSpanFilterState} />
        <SegmentedControlGroup
          name="size-story"
          value={showTimelineInfo}
          onChange={(event) => {
            setShowTimelineInfo(event.target.value);
          }}
          size="small"
          componentId="shared.model-trace-explorer.toggle-show-timeline"
        >
          <SegmentedControlButton
            data-testid="hide-timeline-info-button"
            icon={
              <Tooltip
                componentId="shared.model-trace-explorer.hide-timeline-info-tooltip"
                content={
                  <FormattedMessage
                    defaultMessage="Show span tree"
                    description="Tooltip for a button that show the span tree view of the trace UI."
                  />
                }
              >
                <ListBorderIcon />
              </Tooltip>
            }
            value={false}
          />
          <SegmentedControlButton
            data-testid="show-timeline-info-button"
            icon={
              <Tooltip
                componentId="shared.model-trace-explorer.show-timeline-info-tooltip"
                content={
                  <FormattedMessage
                    defaultMessage="Show execution timeline"
                    description="Tooltip for a button that shows execution timeline info in the trace UI."
                  />
                }
              >
                <BarsAscendingVerticalIcon />
              </Tooltip>
            }
            value
          />
        </SegmentedControlGroup>
      </div>
    </div>
  );
};
