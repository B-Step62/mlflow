import React, { useMemo, useRef, useState } from 'react';
import invariant from 'invariant';
import { useParams } from '../../../common/utils/RoutingUtils';
import {
  useDesignSystemTheme,
  Button,
  LegacySkeleton,
  LegacyTooltip,
  Header,
  ChevronDownIcon,
  ChevronUpIcon,
} from '@databricks/design-system';
import { ScrollablePageWrapper } from '../../../common/components/ScrollablePageWrapper';
import AiLogoUrl from './components/ai-logo.svg';
import { useInsightClusterDetails } from './hooks/useInsightClusterDetails';
import { IconButton } from '../../../common/components/IconButton';
import { RUNS_COLOR_PALETTE } from '../../../common/color-palette';
import { getAssessmentValueBarBackgroundColor } from '../../../shared/web-shared/genai-traces-table/utils/Colors';
import { KnownEvaluationResultAssessmentStringValue, type AssessmentInfo } from '../../../shared/web-shared/genai-traces-table';
import { InsightQueryBanner } from './components/InsightQueryBanner';
import type { InsightClusterNode } from './utils';

/**
 * Insight Details — skeleton-first implementation.
 * This page renders layout and placeholders per .agent/specs/insight-details.md.
 * Data wiring will be added later.
 */

const Chip: React.FC<{ label: string; value?: string }> = ({ label, value }) => {
  const { theme } = useDesignSystemTheme();
  return (
    <span
      css={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '2px 8px',
        borderRadius: 999,
        border: `1px solid ${theme.colors.borderDecorative}`,
        color: theme.colors.textSecondary,
        backgroundColor: theme.colors.backgroundDecorative,
        fontSize: 12,
        lineHeight: '18px',
        whiteSpace: 'nowrap',
      }}
    >
      <strong css={{ fontWeight: 600 }}>{label}</strong>
      {value ? <span>{value}</span> : null}
    </span>
  );
};

const SectionCard: React.FC<{ title: string; right?: React.ReactNode; children?: React.ReactNode }> = ({
  title,
  right,
  children,
}) => {
  const { theme } = useDesignSystemTheme();
  return (
    <section
      css={{
        border: `1px solid ${theme.colors.borderDecorative}`,
        borderRadius: theme.borders.borderRadiusMd,
        background: theme.colors.backgroundPrimary,
      }}
    >
      <header
        css={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: `${theme.spacing.md}px ${theme.spacing.md}px`,
        }}
      >
        <h3 css={{ margin: 0, fontSize: 14, fontWeight: 600 }}>{title}</h3>
        {right}
      </header>
      <div css={{ padding: theme.spacing.md }}>{children}</div>
    </section>
  );
};

const BarsSkeleton: React.FC<{ count?: number; height?: number }> = ({ count = 24, height = 80 }) => {
  const { theme } = useDesignSystemTheme();
  return (
    <div css={{ display: 'flex', gap: 8, alignItems: 'flex-end', height }}>
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          css={{
            width: 14,
            height: Math.max(12, ((i % 10) + 3) * 6),
            background: theme.colors.backgroundSecondary,
            borderRadius: 3,
          }}
        />
      ))}
    </div>
  );
};

// --- Results table skeleton -------------------------------------------------
const TraceCountBar: React.FC<{ percent: number; color?: string }> = ({ percent, color }) => {
  const { theme } = useDesignSystemTheme();
  return (
    <div css={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div
        aria-hidden
        css={{
          position: 'relative',
          height: 8,
          borderRadius: 8,
          background: theme.colors.backgroundSecondary,
          flex: 1,
          overflow: 'hidden',
        }}
      >
        <div
          css={{
            position: 'absolute',
            inset: 0,
            width: `${Math.max(6, Math.min(100, percent))}%`,
            background: color || theme.colors.primary,
          }}
        />
      </div>
      <span css={{ color: theme.colors.textSecondary, fontSize: 12 }}>{percent.toFixed(1)}%</span>
    </div>
  );
};

const MetricMiniBar: React.FC<{ value: number }> = ({ value }) => {
  const { theme } = useDesignSystemTheme();
  // Treat value as pass ratio (0..1)
  const passPct = Math.max(0, Math.min(1, value));
  const passWidth = Math.round(passPct * 100);
  const failWidth = 100 - passWidth;
  const passFailInfo: AssessmentInfo = {
    name: 'pass-fail',
    displayName: 'Assessment',
    isKnown: true,
    isOverall: true,
    metricName: 'assessment',
    source: undefined,
    isCustomMetric: false,
    isEditable: false,
    isRetrievalAssessment: false,
    dtype: 'pass-fail',
    uniqueValues: new Set(),
    docsLink: '',
    missingTooltip: '',
    description: '',
  };
  const green = getAssessmentValueBarBackgroundColor(
    theme,
    passFailInfo,
    KnownEvaluationResultAssessmentStringValue.YES,
  );
  const red = getAssessmentValueBarBackgroundColor(
    theme,
    passFailInfo,
    KnownEvaluationResultAssessmentStringValue.NO,
  );
  return (
    <div css={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span css={{ width: 28, textAlign: 'right', color: theme.colors.textSecondary, fontSize: 12 }}>
        {passPct.toFixed(2)}
      </span>
      <div
        aria-hidden
        css={{
          display: 'flex',
          gap: 2,
          width: '100%',
          height: 8,
          borderRadius: 8,
          background: theme.colors.backgroundSecondary,
          overflow: 'hidden',
        }}
      >
        <div css={{ width: `${passWidth}%`, background: green }} />
        <div css={{ width: `${failWidth}%`, background: red }} />
      </div>
    </div>
  );
};

const ResultsTableSkeleton: React.FC = () => {
  const { theme } = useDesignSystemTheme();

  // Static shape to mimic hierarchy in mock
  const rows = [
    { id: 'r1', label: 'Usage of MLflow Tracing', level: 0, expanded: true, isGroup: true, highlight: true },
    { id: 'r2', label: 'Different between autologging and manual tracing', level: 0 },
    { id: 'r3', label: 'Multi-thread handling', level: 0 },
    { id: 'r4', label: 'LangGraph Support', level: 0, expanded: true, isGroup: true },
    { id: 'r4-1', label: 'Is MLflow support Async Agent', level: 1 },
    { id: 'r4-2', label: 'How to trace custom nodes', level: 1 },
    { id: 'r5', label: 'MLflow Tracking Server Setup', level: 0 },
    { id: 'r6', label: 'Installation Problems', level: 0 },
    { id: 'r7', label: 'Tracking URI Configuration…', level: 0 },
  ];

  return (
    <div
      role="table"
      css={{
        border: `1px solid ${theme.colors.borderDecorative}`,
        borderRadius: theme.borders.borderRadiusSm,
        overflow: 'hidden',
      }}
    >
      {/* Header (two rows to group Assessments) */}
      <div
        role="rowgroup"
        css={{
          position: 'sticky',
          top: 0,
          zIndex: 1,
          background: theme.colors.backgroundPrimary,
          borderBottom: `1px solid ${theme.colors.borderStrong}`,
        }}
      >
        <div
          role="row"
          css={{
            display: 'grid',
            gridTemplateColumns: 'minmax(320px, 1.2fr) minmax(260px, 1fr) 260px 1fr 1fr',
            alignItems: 'center',
            columnGap: 12,
            padding: `${theme.spacing.xs}px ${theme.spacing.md}px`,
            color: theme.colors.textSecondary,
            fontWeight: 600,
          }}
        >
          <div>Category</div>
          <div>Description</div>
          <div>Trace Count</div>
          <div css={{ gridColumn: '4 / span 2', textAlign: 'center' }}>Assessments</div>
        </div>
        <div
          role="row"
          css={{
            display: 'grid',
            gridTemplateColumns: 'minmax(320px, 1.2fr) minmax(260px, 1fr) 260px 1fr 1fr',
            alignItems: 'center',
            columnGap: 12,
            padding: `0 ${theme.spacing.md}px ${theme.spacing.xs}px`,
            color: theme.colors.textSecondary,
            fontSize: 12,
          }}
        >
          <div />
          <div />
          <div />
          <div>Correctness</div>
          <div>Groundedness</div>
        </div>
      </div>

      {/* Body */}
      <div role="rowgroup">
        {rows.map((row, idx) => (
          <div
            key={row.id}
            role="row"
            className="insight-results-row"
            css={{
              display: 'grid',
              gridTemplateColumns: 'minmax(320px, 1.2fr) minmax(260px, 1fr) 260px 1fr 1fr',
              columnGap: 12,
              alignItems: 'center',
              padding: `${theme.spacing.sm}px ${theme.spacing.md}px`,
              borderTop: `1px solid ${theme.colors.borderDecorative}`,
              backgroundColor: row.highlight ? theme.colors.primaryBackgroundHover : 'transparent',
            }}
          >
            {/* Category with tree chevrons and indent */}
            <div css={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span css={{ width: row.level * 16 }} aria-hidden />
              {row.isGroup ? (
                <ChevronDownIcon css={{ color: theme.colors.textSecondary }} />
              ) : (
                <span css={{ width: 16 }} />
              )}
              <LegacySkeleton css={{ height: 16, width: 240 }} />
            </div>

            {/* Description */}
            <LegacySkeleton css={{ height: 14, width: '70%' }} />

            {/* Trace Count inline bar */}
            <TraceCountBar percent={32 - (idx % 5) * 3 + 18} />

            {/* Assessments two metrics */}
            <MetricMiniBar value={0.66} />
            <MetricMiniBar value={0.66} />
          </div>
        ))}
      </div>
    </div>
  );
};

const countTraces = (node: InsightClusterNode): number => {
  const own = (node.traceIds?.length ?? 0) as number;
  const child = (node.children ?? []).reduce((acc, n) => acc + countTraces(n), 0);
  return own + child;
};

const flattenWithDepth = (nodes: InsightClusterNode[], depth = 0): Array<InsightClusterNode & { depth: number; topId: string }> =>
  nodes.flatMap((n) => [
    { ...n, depth, topId: depth === 0 ? n.id : (n as any).topId },
    ...flattenWithDepth((n.children ?? []).map((c) => ({ ...c, topId: (n as any).topId ?? n.id } as any)), depth + 1),
  ]);

const sortClustersByCount = (nodes: InsightClusterNode[]): InsightClusterNode[] => {
  const sorted = [...nodes]
    .map((n) => ({ ...n, children: sortClustersByCount(n.children ?? []) }))
    .sort((a, b) => countTraces(b) - countTraces(a));
  return sorted;
};

const ResultsTable: React.FC<{ clusters: InsightClusterNode[] }> = ({ clusters }) => {
  const { theme } = useDesignSystemTheme();
  const sortedClusters = useMemo(() => sortClustersByCount(clusters), [clusters]);
  const total = useMemo(() => sortedClusters.reduce((acc, n) => acc + countTraces(n), 0) || 1, [sortedClusters]);
  const rows = useMemo(() => flattenWithDepth(sortedClusters), [sortedClusters]);
  const topLevelColors = useMemo(() => {
    const map = new Map<string, string>();
    sortedClusters.forEach((node, idx) => {
      map.set(node.id, RUNS_COLOR_PALETTE[idx % RUNS_COLOR_PALETTE.length]);
    });
    return map;
  }, [sortedClusters]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggleExpanded = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });

  return (
    <div
      role="table"
      css={{
        border: `1px solid ${theme.colors.borderDecorative}`,
        borderRadius: theme.borders.borderRadiusSm,
        overflow: 'hidden',
      }}
    >
      <div
        role="rowgroup"
        css={{
          position: 'sticky',
          top: 0,
          zIndex: 1,
          background: theme.colors.backgroundPrimary,
          borderBottom: `1px solid ${theme.colors.borderStrong}`,
        }}
      >
        <div
          role="row"
          css={{
            display: 'grid',
            gridTemplateColumns: 'minmax(320px, 1.2fr) minmax(260px, 1fr) 260px 1fr 1fr',
            alignItems: 'center',
            columnGap: 12,
            padding: `${theme.spacing.xs}px ${theme.spacing.md}px`,
            color: theme.colors.textSecondary,
            fontWeight: 600,
          }}
        >
          <div>Category</div>
          <div>Description</div>
          <div>Trace Count</div>
          <div css={{ gridColumn: '4 / span 2', textAlign: 'center' }}>Assessments</div>
        </div>
        <div
          role="row"
          css={{
            display: 'grid',
            gridTemplateColumns: 'minmax(320px, 1.2fr) minmax(260px, 1fr) 260px 1fr 1fr',
            alignItems: 'center',
            columnGap: 12,
            padding: `0 ${theme.spacing.md}px ${theme.spacing.xs}px`,
            color: theme.colors.textSecondary,
            fontSize: 12,
          }}
        >
          <div />
          <div />
          <div />
          <div>Correctness</div>
          <div>Groundedness</div>
        </div>
      </div>

      <div role="rowgroup">
        {rows.map((row) => {
          const traceCount = countTraces(row);
          const percent = (traceCount / total) * 100;
          return (
            <div
              key={row.id}
              role="row"
              className="insight-results-row"
              css={{
                display: 'grid',
                gridTemplateColumns: 'minmax(320px, 1.2fr) minmax(260px, 1fr) 260px 1fr 1fr',
                columnGap: 12,
                alignItems: 'center',
                padding: `${theme.spacing.sm}px ${theme.spacing.md}px`,
                borderTop: `1px solid ${theme.colors.borderDecorative}`,
              }}
            >
              <div css={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                <span css={{ width: row.depth * 16 }} aria-hidden />
                {/* Show chevron placeholder for groups; v1 can toggle expansion */}
                {(row.children?.length ?? 0) > 0 ? (
                  <ChevronDownIcon css={{ color: theme.colors.textSecondary }} />
                ) : (
                  <span css={{ width: 16 }} />
                )}
                <span css={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {row.title}
                </span>
              </div>

              <div css={{ display: 'flex', gap: theme.spacing.xs, alignItems: 'baseline', minWidth: 0 }}>
                <span
                  css={{
                    color: theme.colors.textSecondary,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    display: expanded.has(row.id) ? 'block' : '-webkit-box',
                    WebkitLineClamp: expanded.has(row.id) ? 'unset' : 2,
                    WebkitBoxOrient: 'vertical',
                    whiteSpace: expanded.has(row.id) ? 'normal' : 'unset',
                    wordBreak: 'break-word',
                    flex: 1,
                  }}
                >
                  {row.summary || '—'}
                </span>
                {row.summary && row.summary.length > 140 && (
                  <IconButton
                    onClick={() => toggleExpanded(row.id)}
                    icon={expanded.has(row.id) ? <ChevronUpIcon /> : <ChevronDownIcon />}
                    style={{ lineHeight: 1 }}
                    aria-label={expanded.has(row.id) ? 'Collapse description' : 'Expand description'}
                  />
                )}
              </div>

              <TraceCountBar percent={percent} color={topLevelColors.get((row as any).topId) || undefined} />

              {/* Metrics not yet provided by artifact; show placeholders */}
              <MetricMiniBar value={0.66} />
              <MetricMiniBar value={0.66} />
            </div>
          );
        })}
      </div>
    </div>
  );
};

const ExperimentInsightDetailsPage: React.FC<{
  experimentId?: string;
  insightId?: string;
}> = ({ experimentId: experimentIdProp, insightId: insightIdProp }) => {
  const params = useParams<{ experimentId?: string; insightId?: string }>();
  const experimentId = experimentIdProp ?? params.experimentId ?? '';
  const insightId = insightIdProp ?? params.insightId ?? '';
  invariant(experimentId, 'experimentId must be provided');
  invariant(insightId, 'insightId must be provided');

  const { theme } = useDesignSystemTheme();
  const { data: clusterDetails, isLoading: isLoadingClusters } = useInsightClusterDetails(insightId);

  // Placeholder header metadata from route params
  const metaChips = useMemo(
    () => [
      <Chip key="id" label="ID" value={insightId} />,
      <Chip key="total" label="Total Traces" value="1000" />,
      <Chip key="start" label="start" value="Nov 25, 2025" />,
      <Chip key="end" label="end" value="Dec 7, 2025" />,
      <Chip key="version" label="version" value="1" />,
      <Chip key="prompt" label="prompt" value="…" />,
      <Chip key="more" label="+3" />,
    ],
    [insightId],
  );

  

  return (
    <ScrollablePageWrapper>
      <div
        data-testid="insight-details-page"
        css={{
          display: 'flex',
          flexDirection: 'column',
          gap: theme.spacing.md,
          padding: `${theme.spacing.md}px 0`,
        }}
      >
        {/* Page header with title + actions to match mocks */}
        <Header
          title={
            <span css={{ display: 'inline-flex', alignItems: 'center', gap: theme.spacing.sm }}>
              <img src={AiLogoUrl} alt="" width={20} height={20} css={{ display: 'block' }} />
              Question Topic Analysis
            </span>
          }
        />

        {/* Meta chips + description under title */}
        <div>
          <div css={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>{metaChips}</div>
          <p css={{ color: theme.colors.textSecondary, marginTop: 16, marginBottom: 0 }}>
            This insight report was created from 1000 traces generated from November 25th, 2025 to
            December 7th. Traces are clustered based on the user's question topics.
          </p>
        </div>

        {/* Charts row */}
        <div css={{ display: 'grid', gridTemplateColumns: '1fr 420px', gap: theme.spacing.md, alignItems: 'start' }}>
        <div css={{ alignSelf: 'start' }}>
          <SectionCard title="Traces">
            <BarsSkeleton height={240} count={28} />
          </SectionCard>
        </div>

        <SectionCard title="Suggested Actions">
          <div css={{ display: 'grid', gap: 8 }}>
            <LegacySkeleton css={{ height: 36 }} />
          </div>
        </SectionCard>
        </div>

      {/* Q&A strip (shared) */}
      <InsightQueryBanner
        placeholder={'Ask questions about the insight report. E.g., "what are the top three question topics with the lowest user groundedness?"'}
        ariaLabel="Ask question about the insight"
        size="compact"
      />
      {/* Results table */}
        <SectionCard title="Cluster Analysis">
          {isLoadingClusters && <ResultsTableSkeleton />}
          {!isLoadingClusters && clusterDetails?.clusters?.length ? (
            <ResultsTable clusters={clusterDetails.clusters} />
          ) : null}
        </SectionCard>
      </div>
    </ScrollablePageWrapper>
  );
};

export default ExperimentInsightDetailsPage;
