import React, { useEffect, useMemo, useState } from 'react';
import invariant from 'invariant';
import { useSearchParams } from '../../../common/utils/RoutingUtils';
import {
  useDesignSystemTheme,
  LegacySkeleton,
  LegacyTooltip,
  Header,
  Tag,
  Typography,
  WarningIcon,
  CheckCircleIcon,
  InfoIcon,
  ErrorIcon,
} from '@databricks/design-system';
import { ScrollablePageWrapper } from '../../../common/components/ScrollablePageWrapper';
import { useInsightReport } from './hooks/useInsightReport';
import { useQuery } from '@tanstack/react-query';
import { MlflowService } from '../../sdk/MlflowService';
import Utils from '../../../common/utils/Utils';
import { IconButton } from '../../../common/components/IconButton';
import { ChevronLeftIcon } from '@databricks/design-system';

type ExperimentInsightDetailsPageProps = {
  experimentId: string;
  insightId: string;
};

const severityIcon = (severity?: string) => {
  switch ((severity || '').toLowerCase()) {
    case 'high':
      return <ErrorIcon />;
    case 'medium':
      return <WarningIcon />;
    case 'low':
      return <InfoIcon />;
    default:
      return <CheckCircleIcon />;
  }
};

const InsightHeader: React.FC<{
  title: string;
  runName?: string;
  createdAt?: number;
  tracesTotal?: number;
  onBack: () => void;
}> = ({ title, runName, createdAt, tracesTotal, onBack }) => {
  return (
    <div css={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 8 }}>
      <div css={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <IconButton icon={<ChevronLeftIcon />} onClick={onBack} aria-label="Back to Reports" />
        <div>
          <Header level={2}>{title}</Header>
          <Typography.Text type="secondary">
            {runName ? `${runName} • ` : ''}
            {createdAt ? Utils.formatTimestamp(createdAt) : ''}
            {tracesTotal ? ` • ${tracesTotal.toLocaleString()} traces` : ''}
          </Typography.Text>
        </div>
      </div>
    </div>
  );
};

const IssueCard: React.FC<{
  name: string;
  description?: string;
  severity?: string;
  traceCount: number;
  selected: boolean;
  onClick: () => void;
}> = ({ name, description, severity, traceCount, selected, onClick }) => {
  const { theme } = useDesignSystemTheme();
  return (
    <button
      onClick={onClick}
      css={{
        width: '100%',
        textAlign: 'left',
        border: `1px solid ${selected ? theme.colors.primary : theme.colors.borderDecorative}`,
        borderRadius: theme.borders.borderRadiusMd,
        padding: theme.spacing.md,
        background: selected ? theme.colors.primaryBackgroundHover : theme.colors.backgroundPrimary,
        cursor: 'pointer',
      }}
    >
      <div css={{ display: 'flex', alignItems: 'center', gap: theme.spacing.sm }}>
        {severityIcon(severity)}
        <div>
          <Typography.Text strong>{name}</Typography.Text>
          <div>
            <Typography.Text type="secondary">{traceCount.toLocaleString()} traces</Typography.Text>
          </div>
        </div>
      </div>
      {description ? (
        <Typography.Paragraph type="secondary" css={{ marginTop: theme.spacing.sm, marginBottom: 0 }}>
          {description}
        </Typography.Paragraph>
      ) : null}
    </button>
  );
};

const EvidenceChips: React.FC<{ evidences: { assessment_id?: string; trace_id?: string }[] }> = ({ evidences }) => {
  if (!evidences.length) {
    return <Typography.Text type="secondary">No feedback samples</Typography.Text>;
  }
  return (
    <div css={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      {evidences.slice(0, 12).map((ev, idx) => (
        <Tag key={`${ev.trace_id}-${idx}`}>{ev.assessment_id || ev.trace_id || 'feedback'}</Tag>
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
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | undefined>(categories[0]?.id);
  useEffect(() => {
    if (!selectedCategoryId && categories[0]) {
      setSelectedCategoryId(categories[0].id);
    }
  }, [categories, selectedCategoryId]);
  const selectedCategory = useMemo(() => {
    if (!categories.length) {
      return undefined;
    }
    const found = categories.find((cat) => cat.id === selectedCategoryId);
    return found ?? categories[0];
  }, [categories, selectedCategoryId]);

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
        <Typography.Text type="danger">Failed to load Insight report.</Typography.Text>
      </ScrollablePageWrapper>
    );
  }

  return (
    <ScrollablePageWrapper css={{ padding: theme.spacing.lg, display: 'flex', flexDirection: 'column', gap: theme.spacing.lg }}>
      <InsightHeader
        title={report.title || 'Insight Report'}
        runName={runName}
        createdAt={createdAt}
        tracesTotal={report.traces_total}
        onBack={handleBack}
      />

      <section css={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: theme.spacing.lg, alignItems: 'start' }}>
        <div css={{ display: 'flex', flexDirection: 'column', gap: theme.spacing.md }}>
          <Typography.Text strong css={{ fontSize: 16 }}>
            Issues
          </Typography.Text>
          {categories.map((cat) => (
            <IssueCard
              key={cat.id}
              name={cat.name}
              description={cat.description}
              severity={cat.severity}
              traceCount={cat.impactedCount || cat.traceIds.length || cat.evidences.length}
              selected={selectedCategory?.id === cat.id}
              onClick={() => setSelectedCategoryId(cat.id)}
            />
          ))}
        </div>

        <div
          css={{
            border: `1px solid ${theme.colors.borderDecorative}`,
            borderRadius: theme.borders.borderRadiusMd,
            padding: theme.spacing.lg,
            background: theme.colors.backgroundPrimary,
          }}
        >
          <Typography.Text strong css={{ fontSize: 16 }}>
            {selectedCategory?.name || 'Issue detail'}
          </Typography.Text>
          {selectedCategory?.description && (
            <Typography.Paragraph css={{ marginTop: theme.spacing.sm }}>
              {selectedCategory.description}
            </Typography.Paragraph>
          )}

          <div css={{ display: 'flex', gap: theme.spacing.md, marginTop: theme.spacing.md, flexWrap: 'wrap' }}>
            <Tag>{selectedCategory?.impactedCount ?? 0} impacted traces</Tag>
            {selectedCategory?.severity ? <Tag>Severity: {selectedCategory.severity}</Tag> : null}
          </div>

          <div css={{ marginTop: theme.spacing.lg }}>
            <Typography.Text strong>Sample feedback</Typography.Text>
            <div css={{ marginTop: theme.spacing.sm }}>
              <EvidenceChips evidences={selectedCategory?.evidences ?? []} />
            </div>
          </div>

          <div css={{ marginTop: theme.spacing.lg }}>
            <Typography.Text strong>Trace IDs</Typography.Text>
            {selectedCategory?.traceIds?.length ? (
              <div css={{ marginTop: theme.spacing.sm, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {selectedCategory.traceIds.slice(0, 30).map((id) => (
                  <LegacyTooltip key={id} title={id}>
                    <Tag>{id}</Tag>
                  </LegacyTooltip>
                ))}
                {selectedCategory.traceIds.length > 30 ? (
                  <Tag>+{selectedCategory.traceIds.length - 30} more</Tag>
                ) : null}
              </div>
            ) : (
              <Typography.Text type="secondary">No linked traces</Typography.Text>
            )}
          </div>
        </div>
      </section>
    </ScrollablePageWrapper>
  );
};

export default ExperimentInsightDetailsPage;
