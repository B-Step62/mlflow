import { useState } from 'react';
import type { ReactNode } from 'react';

import { ChevronDownIcon, ChevronRightIcon, Empty, Typography, useDesignSystemTheme } from '@databricks/design-system';
import { FormattedMessage } from '@databricks/i18n';

import type { ModelTrace } from '../ModelTrace.types';
import { useModelTraceExplorerViewState } from '../ModelTraceExplorerViewStateContext';
import { AssessmentsPane } from '../assessments-pane/AssessmentsPane';
import { ModelTraceExplorerAttributesTab } from '../right-pane/ModelTraceExplorerAttributesTab';
import { ModelTraceExplorerDefaultSpanView } from '../right-pane/ModelTraceExplorerDefaultSpanView';
import { ModelTraceExplorerEventsTab } from '../right-pane/ModelTraceExplorerEventsTab';

type Props = {
  modelTraceInfo: ModelTrace['info'];
};

type SectionProps = {
  title: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
};

const Section = ({ title, defaultOpen = true, children }: SectionProps) => {
  const { theme } = useDesignSystemTheme();
  const [open, setOpen] = useState(defaultOpen);

  return (
    <section
      css={{
        borderTop: `1px solid ${theme.colors.borderDecorative}`,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        css={{
          display: 'flex',
          alignItems: 'center',
          gap: theme.spacing.xs,
          width: '100%',
          background: 'transparent',
          border: 'none',
          padding: `${theme.spacing.sm}px ${theme.spacing.md}px`,
          cursor: 'pointer',
          color: theme.colors.textPrimary,
          textAlign: 'left',
        }}
      >
        {open ? <ChevronDownIcon /> : <ChevronRightIcon />}
        <Typography.Text bold>{title}</Typography.Text>
      </button>
      {open && (
        <div
          css={{
            padding: `0 ${theme.spacing.md}px ${theme.spacing.md}px`,
          }}
        >
          {children}
        </div>
      )}
    </section>
  );
};

export const NewTraceExperienceRightPane = ({ modelTraceInfo }: Props) => {
  const { theme } = useDesignSystemTheme();
  const { selectedNode } = useModelTraceExplorerViewState();
  const activeSpan = selectedNode;

  if (!activeSpan) {
    return (
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
          description={
            <FormattedMessage
              defaultMessage="Select a span to see its details."
              description="Empty state for the new trace experience right pane before a span is selected"
            />
          }
        />
      </div>
    );
  }

  const traceId =
    (modelTraceInfo as { trace_id?: string } | undefined)?.trace_id ??
    (modelTraceInfo as { request_id?: string } | undefined)?.request_id ??
    '';
  const assessments = activeSpan.assessments ?? [];

  return (
    <div
      css={{
        flex: 1,
        minWidth: 0,
        overflowY: 'auto',
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: theme.colors.backgroundPrimary,
      }}
    >
      <AssessmentsPane
        assessments={assessments}
        traceId={traceId}
        activeSpanId={String(activeSpan.key)}
        disableCloseButton
      />
      <Section
        title={
          <FormattedMessage
            defaultMessage="Inputs / Outputs"
            description="Section heading for the inputs+outputs section in the new trace experience right pane"
          />
        }
      >
        <ModelTraceExplorerDefaultSpanView activeSpan={activeSpan} searchFilter="" activeMatch={null} />
      </Section>
      <Section
        title={
          <FormattedMessage
            defaultMessage="Attributes"
            description="Section heading for the attributes section in the new trace experience right pane"
          />
        }
        defaultOpen={false}
      >
        <ModelTraceExplorerAttributesTab activeSpan={activeSpan} searchFilter="" activeMatch={null} />
      </Section>
      <Section
        title={
          <FormattedMessage
            defaultMessage="Events"
            description="Section heading for the events section in the new trace experience right pane"
          />
        }
        defaultOpen={false}
      >
        <ModelTraceExplorerEventsTab activeSpan={activeSpan} searchFilter="" activeMatch={null} />
      </Section>
    </div>
  );
};
