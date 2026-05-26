import { keys, uniqBy } from 'lodash';
import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';

import { ChevronDownIcon, ChevronRightIcon, Empty, Typography, useDesignSystemTheme } from '@databricks/design-system';
import { FormattedMessage } from '@databricks/i18n';

import { shouldUseTracesV4API } from '../FeatureUtils';
import type {
  ExpectationAssessment,
  FeedbackAssessment,
  IssueReferenceAssessment,
  ModelTrace,
} from '../ModelTrace.types';
import { createListFromObject } from '../ModelTraceExplorer.utils';
import { useModelTraceExplorerViewState } from '../ModelTraceExplorerViewStateContext';
import { AssessmentsPaneExpectationsSection } from '../assessments-pane/AssessmentsPaneExpectationsSection';
import { AssessmentsPaneFeedbackSection } from '../assessments-pane/AssessmentsPaneFeedbackSection';
import { AssessmentsPaneIssuesSection } from '../assessments-pane/AssessmentsPaneIssuesSection';
import { AssessmentsPaneNotesSection } from '../assessments-pane/AssessmentsPaneNotesSection';
import { ModelTraceExplorerFieldRenderer } from '../field-renderers/ModelTraceExplorerFieldRenderer';
import { useTraceCachedActions } from '../hooks/useTraceCachedActions';
import { ModelTraceExplorerAttributesTab } from '../right-pane/ModelTraceExplorerAttributesTab';
import { ModelTraceExplorerChatTab } from '../right-pane/ModelTraceExplorerChatTab';
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
      {open && <div css={{ padding: `0 ${theme.spacing.md}px ${theme.spacing.md}px` }}>{children}</div>}
    </section>
  );
};

export const NewTraceExperienceRightPane = ({ modelTraceInfo }: Props) => {
  const { theme } = useDesignSystemTheme();
  const { selectedNode } = useModelTraceExplorerViewState();
  const activeSpan = selectedNode;

  const reconstructAssessments = useTraceCachedActions((state) => state.reconstructAssessments);
  const traceId =
    (modelTraceInfo as { trace_id?: string } | undefined)?.trace_id ??
    (modelTraceInfo as { request_id?: string } | undefined)?.request_id ??
    '';
  const cachedActions = useTraceCachedActions((state) => state.assessmentActions[traceId]);
  const rawAssessments = activeSpan?.assessments ?? [];
  const allAssessments = useMemo(() => {
    if (!shouldUseTracesV4API()) {
      return rawAssessments;
    }
    const reconstructed = reconstructAssessments(rawAssessments, cachedActions);
    return uniqBy(reconstructed, ({ assessment_id }) => assessment_id);
  }, [rawAssessments, reconstructAssessments, cachedActions]);

  const { feedbacks, expectations, issues } = useMemo(() => {
    const feedbacks: FeedbackAssessment[] = [];
    const expectations: ExpectationAssessment[] = [];
    const issues: IssueReferenceAssessment[] = [];
    for (const assessment of allAssessments) {
      if ('feedback' in assessment) {
        feedbacks.push(assessment);
      } else if ('issue' in assessment) {
        issues.push(assessment);
      } else if ('expectation' in assessment) {
        expectations.push(assessment);
      }
    }
    return { feedbacks, expectations, issues };
  }, [allAssessments]);

  const inputList = useMemo(() => createListFromObject(activeSpan?.inputs), [activeSpan]);
  const outputList = useMemo(() => createListFromObject(activeSpan?.outputs), [activeSpan]);
  const hasAttributes = keys(activeSpan?.attributes).length > 0;
  const hasEvents = Array.isArray(activeSpan?.events) && (activeSpan?.events?.length ?? 0) > 0;
  const hasChat = Boolean(activeSpan?.chatMessages);

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

  const activeSpanId = String(activeSpan.key);

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
      <Section
        title={
          <FormattedMessage
            defaultMessage="Feedback"
            description="Section heading for the Feedback section in the new trace experience right pane"
          />
        }
      >
        <AssessmentsPaneFeedbackSection
          enableRunScorer
          feedbacks={feedbacks}
          activeSpanId={activeSpanId}
          traceId={traceId}
        />
      </Section>
      <Section
        title={
          <FormattedMessage
            defaultMessage="Expectations"
            description="Section heading for the Expectations section in the new trace experience right pane"
          />
        }
      >
        <AssessmentsPaneExpectationsSection
          expectations={expectations}
          activeSpanId={activeSpanId}
          traceId={traceId}
        />
      </Section>
      <Section
        title={
          <FormattedMessage
            defaultMessage="Notes"
            description="Section heading for the Notes section in the new trace experience right pane"
          />
        }
        defaultOpen={false}
      >
        <AssessmentsPaneNotesSection traceId={traceId} feedbacks={feedbacks} />
      </Section>
      {issues.length > 0 && (
        <Section
          title={
            <FormattedMessage
              defaultMessage="Issues"
              description="Section heading for the Issues section in the new trace experience right pane"
            />
          }
        >
          <AssessmentsPaneIssuesSection issues={issues} />
        </Section>
      )}
      {hasChat && (
        <Section
          title={
            <FormattedMessage
              defaultMessage="Chat"
              description="Section heading for the chat (messages + tools) section in the new trace experience right pane"
            />
          }
        >
          <ModelTraceExplorerChatTab activeSpan={activeSpan} />
        </Section>
      )}
      {inputList.length > 0 && (
        <Section
          title={
            <FormattedMessage
              defaultMessage="Inputs"
              description="Section heading for the span inputs section in the new trace experience right pane"
            />
          }
        >
          <div css={{ display: 'flex', flexDirection: 'column', gap: theme.spacing.sm }}>
            {inputList.map(({ key, value }, index) => (
              <ModelTraceExplorerFieldRenderer
                key={key || index}
                title={key}
                data={value}
                renderMode="default"
                assessments={activeSpan?.assessments}
              />
            ))}
          </div>
        </Section>
      )}
      {outputList.length > 0 && (
        <Section
          title={
            <FormattedMessage
              defaultMessage="Outputs"
              description="Section heading for the span outputs section in the new trace experience right pane"
            />
          }
        >
          <div css={{ display: 'flex', flexDirection: 'column', gap: theme.spacing.sm }}>
            {outputList.map(({ key, value }, index) => (
              <ModelTraceExplorerFieldRenderer
                key={key || index}
                title={key}
                data={value}
                renderMode="default"
                assessments={activeSpan?.assessments}
              />
            ))}
          </div>
        </Section>
      )}
      {hasAttributes && (
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
      )}
      {hasEvents && (
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
      )}
    </div>
  );
};
