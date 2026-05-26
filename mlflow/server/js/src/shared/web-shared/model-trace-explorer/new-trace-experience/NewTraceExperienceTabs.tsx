import { useState } from 'react';

import {
  BarsAscendingVerticalIcon,
  BranchIcon,
  Empty,
  ListBorderIcon,
  Tabs,
  WorkflowsIcon,
  useDesignSystemTheme,
} from '@databricks/design-system';
import { FormattedMessage, useIntl } from '@databricks/i18n';

import type { ModelTrace } from '../ModelTrace.types';

export type NewTraceExperienceTabKey = 'trace' | 'timeline' | 'graph' | 'lineage';

type Props = {
  modelTraceInfo: ModelTrace['info'];
  renderTraceTab: () => React.ReactNode;
};

export const NewTraceExperienceTabs = ({ renderTraceTab }: Props) => {
  const { theme } = useDesignSystemTheme();
  const intl = useIntl();
  const [activeTab, setActiveTab] = useState<NewTraceExperienceTabKey>('trace');

  const traceLabel = intl.formatMessage({
    defaultMessage: 'Trace',
    description: 'Tab label for the main trace view (tree + stacked detail) in the new trace experience',
  });
  const timelineLabel = intl.formatMessage({
    defaultMessage: 'Timeline',
    description: 'Tab label for the timeline (gantt) view of a trace in the new trace experience',
  });
  const graphLabel = intl.formatMessage({
    defaultMessage: 'Graph',
    description: 'Tab label for the graph (node/edge) view of a trace in the new trace experience',
  });
  const lineageLabel = intl.formatMessage({
    defaultMessage: 'Lineage',
    description: 'Tab label for the lineage view (linked prompts, runs, datasets) in the new trace experience',
  });

  const comingSoonEmptyState = (key: 'timeline' | 'graph' | 'lineage') => (
    <div
      css={{
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: 400,
        '& > div': {
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: 'center',
        },
      }}
    >
      <Empty
        title={
          key === 'timeline' ? (
            <FormattedMessage
              defaultMessage="Timeline view"
              description="Empty-state heading for the Timeline tab placeholder in the new trace experience"
            />
          ) : key === 'graph' ? (
            <FormattedMessage
              defaultMessage="Graph view"
              description="Empty-state heading for the Graph tab placeholder in the new trace experience"
            />
          ) : (
            <FormattedMessage
              defaultMessage="Lineage view"
              description="Empty-state heading for the Lineage tab placeholder in the new trace experience"
            />
          )
        }
        description={
          <FormattedMessage
            defaultMessage="Coming in a later step of the redesign."
            description="Empty-state body shown under tabs that have not been wired up yet in the new trace experience"
          />
        }
      />
    </div>
  );

  return (
    <Tabs.Root
      componentId="mlflow.new-trace-experience.tabs"
      value={activeTab}
      onValueChange={(value) => setActiveTab(value as NewTraceExperienceTabKey)}
      css={{
        display: 'flex',
        flex: 1,
        flexDirection: 'column',
        overflow: 'hidden',
        // The DS Tabs.List is wrapped in two fixed-height Radix ScrollArea
        // divs (~31-32 px). They clip a taller Tabs.List underneath. Force
        // the nav wrapper and its scroll-area child to match the taller
        // strip so labels and the underline indicator are not cropped.
        '& > div:nth-of-type(1)': {
          marginBottom: 0,
          flexShrink: 0,
          height: 52,
          '& > div': {
            height: 52,
            maxHeight: 52,
          },
        },
      }}
    >
      <Tabs.List
        css={{
          paddingLeft: theme.spacing.lg,
          flexShrink: 0,
          // DS Tabs paints the active indicator as a 4px inset box-shadow on
          // the very bottom of the trigger; the trigger's flex layout then
          // vertically centres the label, so the gap between text and the
          // colored underline is just a few pixels at the default height.
          // Make the strip taller and pin the label to the top of the cell so
          // text + indicator have real breathing room.
          minHeight: 52,
          '& [role="tab"]': {
            height: 52,
            marginRight: theme.spacing.lg,
            // Align label content to the top of the cell, leaving the active
            // underline well below it.
            alignItems: 'flex-start',
            paddingTop: theme.spacing.sm,
          },
        }}
      >
        <Tabs.Trigger value="trace">
          <span css={{ display: 'inline-flex', alignItems: 'center', gap: theme.spacing.sm }}>
            <ListBorderIcon />
            {traceLabel}
          </span>
        </Tabs.Trigger>
        <Tabs.Trigger value="timeline">
          <span css={{ display: 'inline-flex', alignItems: 'center', gap: theme.spacing.sm }}>
            <BarsAscendingVerticalIcon />
            {timelineLabel}
          </span>
        </Tabs.Trigger>
        <Tabs.Trigger value="graph">
          <span css={{ display: 'inline-flex', alignItems: 'center', gap: theme.spacing.sm }}>
            <WorkflowsIcon />
            {graphLabel}
          </span>
        </Tabs.Trigger>
        <Tabs.Trigger value="lineage">
          <span css={{ display: 'inline-flex', alignItems: 'center', gap: theme.spacing.sm }}>
            <BranchIcon />
            {lineageLabel}
          </span>
        </Tabs.Trigger>
      </Tabs.List>
      <Tabs.Content value="trace" css={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
        {renderTraceTab()}
      </Tabs.Content>
      <Tabs.Content value="timeline" css={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
        {comingSoonEmptyState('timeline')}
      </Tabs.Content>
      <Tabs.Content value="graph" css={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
        {comingSoonEmptyState('graph')}
      </Tabs.Content>
      <Tabs.Content value="lineage" css={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
        {comingSoonEmptyState('lineage')}
      </Tabs.Content>
    </Tabs.Root>
  );
};
