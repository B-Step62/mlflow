import React from 'react';
import {
  Button,
  Typography,
  useDesignSystemTheme,
  Table,
  TableRow,
  TableHeader,
  TableCell,
  CheckCircleIcon,
  WarningIcon,
  XCircleIcon,
  ZoomMarqueeSelection,
} from '@databricks/design-system';
import type { RunEntity } from '../../../types';
import moment from 'moment';
import { useInsightReport } from '../hooks/useInsightReport';
import AiLogoUrl from '../components/ai-logo.svg';

type InsightReportsTableProps = {
  runs: RunEntity[];
  loading?: boolean;
  onSelect: (runUuid: string) => void;
  onCreateInsight?: () => void;
};

type SparkSeverity = { high: number; medium: number; low: number };

const mapSeverity = (severity?: string): keyof SparkSeverity => {
  const s = (severity || '').toLowerCase();
  if (s === 'high') return 'high';
  if (s === 'medium') return 'medium';
  return 'low';
};

const SeveritySpark: React.FC<{ severities: SparkSeverity; total: number }> = ({ severities, total }) => {
  const { theme } = useDesignSystemTheme();
  const width = 80;
  const segments: { key: keyof SparkSeverity; color: string }[] = [
    { key: 'high', color: theme.colors.error },
    { key: 'medium', color: theme.colors.warning },
    { key: 'low', color: theme.colors.textSecondary },
  ];
  return (
    <div css={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div
        css={{
          display: 'flex',
          width,
          height: 10,
          borderRadius: 999,
          overflow: 'hidden',
          background: theme.colors.backgroundSecondary,
        }}
      >
        {segments.map(({ key, color }) => {
          const pct = total > 0 ? (severities[key] / total) * 100 : key === 'low' ? 100 : 0;
          return <div key={key} css={{ width: `${pct}%`, background: color }} />;
        })}
      </div>
      <Typography.Text type="secondary">{total}</Typography.Text>
    </div>
  );
};

const StatusPill: React.FC<{ status?: string }> = ({ status }) => {
  const { theme } = useDesignSystemTheme();
  const label = (status || '').toLowerCase();
  const config = (() => {
    if (label === 'finished' || label === 'complete' || label === 'completed') {
      return { bg: '#e8f5ec', fg: '#1a6633', icon: <CheckCircleIcon css={{ color: '#1a6633' }} />, text: 'Complete' };
    }
    if (label === 'running') {
      return { bg: '#fff5e0', fg: '#5c4b26', icon: <WarningIcon css={{ color: '#5c4b26' }} />, text: 'Running' };
    }
    return { bg: '#fdecef', fg: '#8c1f2f', icon: <XCircleIcon css={{ color: '#8c1f2f' }} />, text: 'Failed' };
  })();

  return (
    <span
      css={{
        display: 'inline-flex',
        alignItems: 'center',
        padding: `0 ${theme.spacing.xs}px`,
        background: config.bg,
        borderRadius: theme.borders.borderRadiusSm,
        color: config.fg,
        border: 'none',
        gap: theme.spacing.sm,
      }}
    >
      {config.icon}
      {config.text}
    </span>
  );
};

const InsightRow: React.FC<{ run: RunEntity; onSelect: (runUuid: string) => void }> = ({ run, onSelect }) => {
  const { theme } = useDesignSystemTheme();
  const { report } = useInsightReport(run.info.runUuid);
  const name = report?.title || run.info.runName || run.info.runUuid;
  const createdLabel = run.info.startTime ? moment(run.info.startTime).fromNow() : '—';
  const totalTraces = report?.traces_total || 10;
  const issuesTotal = report?.categories?.length || 0;
  const severities = (report?.categories || []).reduce<SparkSeverity>(
    (acc, cat) => {
      acc[mapSeverity(cat.severity)] += 1;
      return acc;
    },
    { high: 0, medium: 0, low: 0 },
  );

  return (
    <TableRow
      onClick={() => onSelect(run.info.runUuid)}
      css={{ cursor: 'pointer', '&:hover': { background: theme.colors.actionPrimaryBackgroundHover }, marginTop: theme.spacing.sm, marginBottom: theme.spacing.sm, marginLeft: theme.spacing.sm, marginRight: theme.spacing.sm}}
    >
      <TableCell css={{ width: 32, minWidth: 32, maxWidth: 32, textAlign: 'center', paddingLeft: theme.spacing.sm }}>
        <ZoomMarqueeSelection css={{ color: theme.colors.textSecondary }} />
      </TableCell>
      <TableCell css={{ paddingLeft: theme.spacing.md }}>
        <Button
          type="link"
          css={{ padding: 0, height: 'auto', color: theme.colors.primary, fontWeight: 600 }}
          onClick={(e) => {
            e.stopPropagation();
            onSelect(run.info.runUuid);
          }}
        >
          {name}
        </Button>
      </TableCell>
      <TableCell>{createdLabel}</TableCell>
      <TableCell>
        <SeveritySpark severities={severities} total={issuesTotal} />
      </TableCell>
      <TableCell>{totalTraces ?? '—'}</TableCell>
      <TableCell>
        <StatusPill status={run.info.status} />
      </TableCell>
      <TableCell css={{ paddingRight: theme.spacing.lg }}>
        <Button
          type="link"
          onClick={(e) => {
            e.stopPropagation();
            onSelect(run.info.runUuid);
          }}
          css={{ fontSize: 18, lineHeight: 1 }}
        >
          ⋯
        </Button>
      </TableCell>
    </TableRow>
  );
};

export const InsightReportsTable: React.FC<InsightReportsTableProps> = ({ runs, loading, onSelect, onCreateInsight }) => {
  const { theme } = useDesignSystemTheme();
  const sorted = [...runs].sort((a, b) => (b.info.startTime || 0) - (a.info.startTime || 0));

  return (
    <div css={{ display: 'flex', flexDirection: 'column', gap: theme.spacing.md }}>
      <div css={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <Typography.Title level={2} css={{ marginBottom: 0, display: 'flex', alignItems: 'center', gap: theme.spacing.sm }}>
              <img src={AiLogoUrl} alt="" width={20} height={20} css={{ display: 'block' }} />
              Insight Reports
          </Typography.Title>
          <Typography.Text color="secondary">View and manage historical trace analysis reports</Typography.Text>
        </div>
        {onCreateInsight && (
          <Button iconPosition="left" icon={<span style={{ fontWeight: 700 }}>+</span>} onClick={onCreateInsight} size="large">
            New Report
          </Button>
        )}
      </div>

      <div
        css={{
          border: `1px solid ${theme.colors.borderDecorative}`,
          borderRadius: theme.borders.borderRadiusMd,
          overflow: 'hidden',
          background: theme.colors.backgroundPrimary,
        }}
      >
        <Table>
          <TableRow isHeader>
            <TableHeader css={{ width: 32, minWidth: 32, maxWidth: 32 }} />
            <TableHeader css={{ paddingLeft: theme.spacing.lg }}>Report Name</TableHeader>
            <TableHeader>Created</TableHeader>
            <TableHeader>Issues Found</TableHeader>
            <TableHeader>Traces</TableHeader>
            <TableHeader>Status</TableHeader>
            <TableHeader css={{ paddingRight: theme.spacing.lg }}>Actions</TableHeader>
          </TableRow>
          {loading && !sorted.length ? (
            [0, 1, 2].map((idx) => (
              <TableRow key={`skeleton-${idx}`}>
                <TableCell colSpan={7} css={{ paddingLeft: theme.spacing.lg, paddingRight: theme.spacing.lg }}>
                  <Typography.Text color="secondary">Loading…</Typography.Text>
                </TableCell>
              </TableRow>
            ))
          ) : (
            sorted.map((run) => <InsightRow key={run.info.runUuid} run={run} onSelect={onSelect} />)
          )}
        </Table>
      </div>
    </div>
  );
};

export default InsightReportsTable;
