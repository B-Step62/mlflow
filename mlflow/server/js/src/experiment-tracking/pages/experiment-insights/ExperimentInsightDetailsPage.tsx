import React, { useMemo, useState } from 'react';
import invariant from 'invariant';
import { useSearchParams } from '../../../common/utils/RoutingUtils';
import {
  useDesignSystemTheme,
  LegacySkeleton,
  Tag,
  Typography,
  Button,
  BookIcon,
  QuestionMarkIcon,
  ChevronRightIcon,
  SchemaIcon,
  SpeechBubbleIcon,
} from '@databricks/design-system';
import { ScrollablePageWrapper } from '../../../common/components/ScrollablePageWrapper';
import { useInsightReport } from './hooks/useInsightReport';
import { useQuery } from '@tanstack/react-query';
import { MlflowService } from '../../sdk/MlflowService';
import Utils from '../../../common/utils/Utils';
import AiLogoUrl from './components/ai-logo.svg';
import { LazyPlot } from '../../components/LazyPlot';
import { SeverityIcon } from './components/SeverityIcon';
import { InsightIssueDrawer } from './components/InsightIssueDrawer';

type ExperimentInsightDetailsPageProps = {
  experimentId: string;
  insightId: string;
};

const InsightHeader: React.FC<{
  title: string;
  runName?: string;
  createdAt?: number;
  tracesTotal?: number;
  onBack: () => void;
}> = ({ title, runName, createdAt, tracesTotal, onBack }) => {
  const { theme } = useDesignSystemTheme();
  return (
    <div css={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 16 }}>
      <div css={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
        <div>
          <Typography.Title level={2} css={{ marginBottom: 0, display: 'flex', alignItems: 'center', gap: theme.spacing.sm }}>
              <img src={AiLogoUrl} alt="" width={20} height={20} css={{ display: 'block' }} />
              {title}
          </Typography.Title>
          <Typography.Text color="secondary">
            {createdAt ? Utils.formatTimestamp(createdAt) : ''}
            {tracesTotal ? ` • ${tracesTotal.toLocaleString()} traces` : ''}
          </Typography.Text>
        </div>
      </div>
      <div css={{ display: 'flex', gap: 8 }}>
          <Button componentId="download-report-btn" disabled>Download</Button>
        <Button componentId="share-report-btn" disabled>Share</Button>
      </div>
    </div>
  );
};

const IssueCard: React.FC<{
  name: string;
  description?: string;
  severity?: string;
  traceCount: number;
  evidences: { assessment_id?: string; trace_id?: string }[];
  onClick?: () => void;
}> = ({ name, description, severity, traceCount, evidences, onClick }) => {
  const { theme } = useDesignSystemTheme();
  return (
    <div
      onClick={onClick}
      css={{
        display: 'grid',
        gridTemplateColumns: 'auto 1fr auto auto',
        gap: theme.spacing.md,
        alignItems: 'center',
        padding: theme.spacing.md,
        border: `1px solid ${theme.colors.borderDecorative}`,
        borderRadius: theme.borders.borderRadiusMd,
        background: theme.colors.backgroundPrimary,
        boxShadow: theme.shadows.xs,
        cursor: onClick ? 'pointer' : 'default',
        transition: 'box-shadow 0.2s',
        '&:hover': onClick
          ? {
              boxShadow: theme.shadows.sm,
            }
          : {},
      }}
    >
      <div>
        <SeverityIcon severity={severity} />
      </div>
      <div>
        <Typography.Text bold css={{ display: 'block', marginBottom: 4 }}>
          {name}
        </Typography.Text>
        {description ? (
        <Typography.Text color="secondary" css={{ display: 'block' }}>
          {description}
        </Typography.Text>
        ) : null}
      </div>
      <div>
        <Tag componentId="insight-issue-tracecount">
          <SchemaIcon css={{ width: 14, height: 14, fontSize: 14, color: theme.colors.textSecondary, marginRight: theme.spacing.xs }} />{traceCount.toLocaleString()}
        </Tag>
        {evidences.length > 0 && (
          <Tag componentId="insight-issue-evidencecount">
            <SpeechBubbleIcon css={{ width: 14, height: 14, fontSize: 14, color: theme.colors.textSecondary, marginRight: theme.spacing.xs }} /> {evidences.length}
          </Tag>
        )}
      </div>
      <div css={{ color: theme.colors.textSecondary }}>›</div>
    </div>
  );
};

const EvidenceChips: React.FC<{ evidences: { assessment_id?: string; trace_id?: string }[] }> = ({ evidences }) => {
  if (!evidences.length) {
    return <Typography.Text color="secondary">No feedback samples</Typography.Text>;
  }
  return (
    <div css={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      {evidences.slice(0, 12).map((ev, idx) => (
        <Tag key={`${ev.trace_id}-${idx}`} componentId="insight-evidence-tag">
          {ev.assessment_id || ev.trace_id || 'feedback'}
        </Tag>
      ))}
    </div>
  );
};

const ExperimentInsightDetailsPage: React.FC<ExperimentInsightDetailsPageProps> = ({ experimentId, insightId }) => {
  invariant(experimentId, 'Experiment ID must be defined');
  invariant(insightId, 'Insight ID must be defined');

  const { theme } = useDesignSystemTheme();
  const [, setSearchParams] = useSearchParams();
  const { report, isLoading, error } = useInsightReport(insightId);
  const [selectedIssue, setSelectedIssue] = useState<any>(null);

  const runQuery = useQuery({
    queryKey: ['run-info', insightId],
    enabled: Boolean(insightId),
    queryFn: async () => {
      const response = (await MlflowService.getRun({ run_id: insightId })) as any;
      return response.run;
    },
    staleTime: 5 * 60 * 1000,
  });

  const categories = useMemo(() => report?.categories ?? [], [report]);

  const runInfo = runQuery.data?.info;
  const runName = runInfo?.runName ?? runInfo?.run_name;
  const createdAt = runInfo?.startTime ?? runInfo?.start_time;

  const handleBack = () => {
    setSearchParams((params) => {
      params.delete('selectedInsightId');
      return params;
    });
  };

  if (isLoading) {
    return (
      <ScrollablePageWrapper css={{ padding: theme.spacing.lg }}>
        <LegacySkeleton active paragraph={{ rows: 6 }} />
      </ScrollablePageWrapper>
    );
  }

  if (error || !report) {
    return (
      <ScrollablePageWrapper css={{ padding: theme.spacing.lg }}>
        <Typography.Text color="error">Failed to load Insight report.</Typography.Text>
      </ScrollablePageWrapper>
    );
  }

  const totalIssues = categories.length;
  const topIssues = [...categories]
    .map((c) => ({ name: c.name, count: c.impactedCount || c.traceIds.length || c.evidences.length }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);
  
  const maxIssueCount = Math.max(...topIssues.map((i) => i.count), 1);

  return (
    <ScrollablePageWrapper css={{ padding: theme.spacing.lg, display: 'flex', flexDirection: 'column', gap: theme.spacing.lg }}>
      <InsightHeader
        title={report.title || 'Insight Report'}
        runName={runName}
        createdAt={createdAt}
        tracesTotal={report.traces_total}
        onBack={handleBack}
      />

      <div css={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: theme.spacing.md }}>
        <div css={{ border: `1px solid ${theme.colors.borderDecorative}`, borderRadius: theme.borders.borderRadiusMd, padding: theme.spacing.md, height: 320, display: 'flex', flexDirection: 'column' }}>
          <Typography.Title level={3}>Top Categories</Typography.Title>
          <div css={{ flex: 1, minHeight: 0, marginTop: theme.spacing.sm, overflowY: 'auto' }}>
            {topIssues.length > 0 ? (
              topIssues.map((issue) => (
                <div 
                  key={issue.name} 
                  css={{ 
                    marginBottom: theme.spacing.md,
                    cursor: 'pointer',
                    '&:hover .issue-name': {
                      color: theme.colors.textPrimary,
                    },
                    '&:hover .issue-count': {
                      color: theme.colors.textPrimary,
                    },
                    '&:hover .issue-bar': {
                      backgroundColor: theme.colors.primary,
                    }
                  }}
                  onClick={() => {
                    const category = categories.find((c) => c.name === issue.name);
                    if (category) {
                      setSelectedIssue(category);
                    }
                  }}
                >
                  <div css={{ display: 'flex', justifyContent: 'space-between', marginBottom: theme.spacing.xs, gap: theme.spacing.sm }}>
                    <Typography.Text 
                      className="issue-name"
                      color="secondary"
                      ellipsis 
                      title={issue.name}
                      css={{ transition: 'color 0.2s' }}
                    >
                      {issue.name}
                    </Typography.Text>
                    <Typography.Text 
                      className="issue-count"
                      bold 
                      color="secondary"
                      css={{ transition: 'color 0.2s' }}
                    >
                      {issue.count}
                    </Typography.Text>
                  </div>
                  <div
                    css={{
                      height: 8,
                      backgroundColor: theme.colors.backgroundSecondary,
                      borderRadius: theme.borders.borderRadiusMd,
                      overflow: 'hidden',
                    }}
                  >
                    <div
                      className="issue-bar"
                      css={{
                        width: `${(issue.count / maxIssueCount) * 100}%`,
                        height: '100%',
                        backgroundColor: theme.colors.blue500,
                        borderRadius: theme.borders.borderRadiusMd,
                        transition: 'background-color 0.2s',
                      }}
                    />
                  </div>
                </div>
              ))
            ) : (
              <div css={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Typography.Text color="secondary">No data</Typography.Text>
              </div>
            )}
          </div>
        </div>
        <div css={{ border: `1px solid ${theme.colors.borderDecorative}`, borderRadius: theme.borders.borderRadiusMd, padding: theme.spacing.md, height: 320 }}>
          <Typography.Title level={3}>Target traces</Typography.Title>
          <Typography.Text color="secondary" css={{ marginBottom: theme.spacing.md, display: 'block' }}>
            Daily count of traces matching filters
          </Typography.Text>
          <div css={{ height: 'calc(100% - 60px)', width: '100%' }}>
            <LazyPlot
              data={[
                {
                  type: 'bar',
                  x: Array.from({ length: 14 }, (_, i) => {
                    const d = new Date();
                    d.setDate(d.getDate() - (13 - i));
                    return d.toISOString().split('T')[0];
                  }),
                  y: [45, 52, 38, 65, 48, 55, 62, 70, 58, 65, 75, 82, 95, 88], // Dummy total counts
                  marker: {
                    color: Array.from({ length: 14 }, (_, i) => 
                      i >= 10 ? theme.colors.primary : theme.colors.grey200
                    ),
                  },
                  hoverinfo: 'x+y',
                },
              ]}
              layout={{
                margin: { t: 10, b: 30, l: 40, r: 10 },
                xaxis: {
                  showgrid: false,
                  zeroline: false,
                  tickfont: { size: 10, color: theme.colors.textSecondary },
                  tickformat: '%b %d',
                },
                yaxis: {
                  showgrid: true,
                  gridcolor: theme.colors.borderDecorative,
                  zeroline: false,
                  tickfont: { size: 10, color: theme.colors.textSecondary },
                },
                paper_bgcolor: 'transparent',
                plot_bgcolor: 'transparent',
                autosize: true,
                bargap: 0.2,
              }}
              useResizeHandler
              style={{ width: '100%', height: '100%' }}
              config={{ displayModeBar: false }}
            />
          </div>
        </div>
      </div>

      <div>
        <Typography.Title level={3} css={{ display: 'flex', alignItems: 'center', gap: theme.spacing.xs }}>
          Issues
          <Typography.Text color="secondary">({totalIssues})</Typography.Text>
        </Typography.Title>
        <div css={{ display: 'flex', flexDirection: 'column', gap: theme.spacing.md, marginTop: theme.spacing.sm }}>
          {categories.map((cat) => (
            <IssueCard
              key={cat.id}
              name={cat.name}
              description={cat.description}
              severity={cat.severity}
              traceCount={cat.impactedCount || cat.traceIds.length || cat.evidences.length}
              evidences={cat.evidences}
              onClick={() => setSelectedIssue(cat)}
            />
          ))}
        </div>
      </div>

      <InsightIssueDrawer
        isOpen={!!selectedIssue}
        onClose={() => setSelectedIssue(null)}
        issue={selectedIssue}
        experimentId={experimentId}
        totalTraces={report.traces_total}
      />

      <div css={{ marginTop: theme.spacing.lg }}>
        <Typography.Title level={4}>Recommended Actions</Typography.Title>
        <div css={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: theme.spacing.md }}>
          <div css={{ border: `1px solid ${theme.colors.borderDecorative}`, borderRadius: theme.borders.borderRadiusMd, padding: theme.spacing.md }}>
            <Typography.Text bold>Create Automatic LLM Tester</Typography.Text>
            <Typography.Paragraph color="secondary">Evaluate traces at scale with automated testing to catch issues early.</Typography.Paragraph>
            <Button componentId="create-tester-btn" disabled>Create Tester</Button>
          </div>
          <div css={{ border: `1px solid ${theme.colors.borderDecorative}`, borderRadius: theme.borders.borderRadiusMd, padding: theme.spacing.md }}>
            <Typography.Text bold>Provide More Feedback on Traces</Typography.Text>
            <Typography.Paragraph color="secondary">Add quality scores and comments to improve issue detection accuracy.</Typography.Paragraph>
            <Button componentId="add-feedback-btn" disabled>Add Feedback</Button>
          </div>
          <div css={{ border: `1px solid ${theme.colors.borderDecorative}`, borderRadius: theme.borders.borderRadiusMd, padding: theme.spacing.md }}>
            <Typography.Text bold>Evaluate Tool Calling Accuracy</Typography.Text>
            <Typography.Paragraph color="secondary">Analyze how well your LLM is using available tools and functions.</Typography.Paragraph>
            <Button componentId="eval-tools-btn" disabled>Evaluate Tools</Button>
          </div>
        </div>
      </div>
    </ScrollablePageWrapper>
  );
};

export default ExperimentInsightDetailsPage;
