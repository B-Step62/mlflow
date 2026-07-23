import { useMemo, useState } from 'react';
import { useDesignSystemTheme } from '@databricks/design-system';

import { useParams } from '../../../common/utils/RoutingUtils';
import { RunViewIssuesContent } from '../../components/run-page/RunViewIssuesTab';
import type { Issue, IssueStatus } from '../../components/run-page/hooks/useSearchIssuesQuery';
import { MOCK_FAILURE_ANALYSIS_ISSUES } from '../experiment-overview/failureAnalysisMock';

const MOCK_EXISTING_ISSUES: Issue[] = [
  {
    issue_id: 'iss-existing-tool-timeout',
    experiment_id: '0',
    name: 'Search tool timeout causes incomplete answers',
    description:
      'The assistant sometimes returns a partial answer when the search tool times out instead of retrying or asking the user to narrow the request.',
    severity: 'medium',
    status: 'pending',
    source_run_id: 'job_91c24a8d',
    created_by: 'MLflow',
    created_timestamp: Date.UTC(2026, 6, 18, 15, 30, 0),
    last_updated_timestamp: Date.UTC(2026, 6, 18, 15, 30, 0),
    categories: ['execution', 'adherence'],
    trace_count: 9,
  },
  {
    issue_id: 'iss-existing-unsafe-financial-advice',
    experiment_id: '0',
    name: 'Financial advice missing required caveat',
    description:
      'Responses to investment questions occasionally omit the required caveat that answers are informational and not financial advice.',
    severity: 'low',
    status: 'pending',
    source_run_id: 'job_5b8e112f',
    created_by: 'MLflow',
    created_timestamp: Date.UTC(2026, 6, 15, 10, 0, 0),
    last_updated_timestamp: Date.UTC(2026, 6, 15, 10, 0, 0),
    categories: ['safety', 'adherence'],
    trace_count: 5,
  },
];

const truncateSourceJobId = (sourceRunId?: string) => {
  if (!sourceRunId) {
    return '';
  }
  const displayId = sourceRunId.replace(/^job_/, '');
  return displayId.length > 8 ? `${displayId.slice(0, 7)}...` : displayId;
};

const ExperimentIssuesPage = () => {
  const { theme } = useDesignSystemTheme();
  const { experimentId } = useParams<{ experimentId: string }>();
  const [statusOverrides, setStatusOverrides] = useState<Record<string, IssueStatus>>({});
  const safeExperimentId = experimentId ?? '';

  const baseIssues = useMemo<Issue[]>(
    () => [
      ...MOCK_FAILURE_ANALYSIS_ISSUES.map(
        ({
          issue_id,
          experiment_id,
          name,
          description,
          severity,
          status,
          source_run_id,
          created_by,
          created_timestamp,
          last_updated_timestamp,
          categories,
          trace_count,
          recommendation,
          example_trace_ids,
        }) => ({
          issue_id,
          experiment_id: safeExperimentId || experiment_id,
          name,
          description,
          severity,
          status,
          source_run_id,
          created_by,
          created_timestamp,
          last_updated_timestamp,
          categories: [...categories],
          trace_count,
          recommendation,
          example_trace_ids: [...example_trace_ids],
        }),
      ),
      ...MOCK_EXISTING_ISSUES.map((issue) => ({
        ...issue,
        experiment_id: safeExperimentId || issue.experiment_id,
        categories: issue.categories ? [...issue.categories] : undefined,
      })),
    ],
    [safeExperimentId],
  );

  const issues = useMemo(
    () =>
      baseIssues.map((issue) => ({
        ...issue,
        status: statusOverrides[issue.issue_id] ?? issue.status,
      })),
    [baseIssues, statusOverrides],
  );

  return (
    <div
      css={{
        display: 'flex',
        flexDirection: 'column',
        flex: 1,
        minHeight: 0,
        padding: theme.spacing.md,
      }}
    >
      <div
        css={{
          flex: 1,
          minHeight: 0,
          border: `1px solid ${theme.colors.border}`,
          borderRadius: theme.borders.borderRadiusMd,
        }}
      >
        <RunViewIssuesContent
          issues={issues}
          experimentId={safeExperimentId}
          hideIssueActions
          compactCards
          defaultSelectFirstIssue
          detailsPanel="details"
          getIssueSourceLabel={(issue) => truncateSourceJobId(issue.source_run_id)}
          getIssueSourceTagColor={() => 'charcoal'}
          onIssueStatusChange={(issueId, status) =>
            setStatusOverrides((current) => ({
              ...current,
              [issueId]: status,
            }))
          }
        />
      </div>
    </div>
  );
};

export default ExperimentIssuesPage;
