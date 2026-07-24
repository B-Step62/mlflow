import { Button, CheckCircleIcon, PlusIcon, Typography, useDesignSystemTheme } from '@databricks/design-system';
import { FormattedMessage } from 'react-intl';

type DashboardThumbnailKind = 'traces' | 'quality' | 'tools' | 'failure-patterns' | 'topics' | 'custom';

type DashboardCardDefinition = {
  id: string;
  title: string;
  subtitle: string;
  source: 'Preconfigured' | 'Custom from Analysis';
  widgets: number;
  verified?: boolean;
  thumbnail: DashboardThumbnailKind;
};

const DASHBOARD_CARDS: DashboardCardDefinition[] = [
  {
    id: 'traces',
    title: 'Traces',
    subtitle: 'Trace volume, latency, errors, and span activity',
    source: 'Preconfigured',
    widgets: 6,
    thumbnail: 'traces',
  },
  {
    id: 'quality',
    title: 'Quality',
    subtitle: 'Assessment scores, pass rates, and quality trends',
    source: 'Preconfigured',
    widgets: 5,
    thumbnail: 'quality',
  },
  {
    id: 'tool-calls',
    title: 'Tool calls',
    subtitle: 'Tool usage, latency, errors, and performance summary',
    source: 'Preconfigured',
    widgets: 4,
    thumbnail: 'tools',
  },
  {
    id: 'failure-patterns',
    title: 'Failure Pattern Overview',
    subtitle: 'Issues Found, Issues Over Time, and detected issue detail',
    source: 'Custom from Analysis',
    widgets: 2,
    thumbnail: 'failure-patterns',
  },
  {
    id: 'topics',
    title: 'Topic Explorer',
    subtitle: 'Topic scatterplot, topic list, and automation status',
    source: 'Custom from Analysis',
    widgets: 3,
    thumbnail: 'topics',
  },
  {
    id: 'tool-p95',
    title: 'Tool p95 Analysis',
    subtitle: 'Custom SQL-like analysis with latency chart and tool summary',
    source: 'Custom from Analysis',
    widgets: 2,
    verified: true,
    thumbnail: 'custom',
  },
];

const MiniBars = ({ color }: { color: string }) => {
  const heights = [34, 62, 48, 72, 52, 84, 42, 68, 58, 76, 44, 64];

  return (
    <div css={{ display: 'flex', alignItems: 'flex-end', gap: 5, height: 88, minWidth: 0 }}>
      {heights.map((height, index) => (
        <span
          key={index}
          css={{
            width: 10,
            height,
            borderRadius: '3px 3px 0 0',
            backgroundColor: color,
            opacity: index % 3 === 0 ? 0.55 : 0.9,
          }}
        />
      ))}
    </div>
  );
};

const MiniLine = ({ color }: { color: string }) => (
  <svg viewBox="0 0 220 86" preserveAspectRatio="none" css={{ width: '100%', height: 86 }}>
    <polyline
      points="0,62 24,46 48,58 72,32 96,48 120,22 144,36 168,30 192,50 220,18"
      fill="none"
      stroke={color}
      strokeWidth="4"
    />
  </svg>
);

const FailurePatternThumbnail = () => {
  const { theme } = useDesignSystemTheme();

  return (
    <div css={{ display: 'grid', gridTemplateColumns: '88px 1fr', gap: theme.spacing.md, alignItems: 'center' }}>
      <div
        css={{
          width: 76,
          height: 76,
          borderRadius: '50%',
          background: `conic-gradient(${theme.colors.blue500} 0 66%, ${theme.colors.yellow500} 66% 100%)`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <div
          css={{
            width: 42,
            height: 42,
            borderRadius: '50%',
            backgroundColor: theme.colors.backgroundPrimary,
          }}
        />
      </div>
      <div css={{ display: 'flex', alignItems: 'flex-end', gap: theme.spacing.sm, height: 92 }}>
        {[46, 70, 32, 88].map((height, index) => (
          <span
            key={index}
            css={{
              width: 26,
              height,
              borderRadius: `${theme.borders.borderRadiusSm} ${theme.borders.borderRadiusSm} 0 0`,
              backgroundColor: index === 1 ? theme.colors.yellow500 : theme.colors.blue500,
            }}
          />
        ))}
      </div>
    </div>
  );
};

const TopicsThumbnail = () => {
  const { theme } = useDesignSystemTheme();
  const points = [
    { x: 18, y: 62, color: '#4466ff' },
    { x: 25, y: 38, color: '#f28b20' },
    { x: 35, y: 70, color: '#21c7d9' },
    { x: 44, y: 44, color: '#8f5cf7' },
    { x: 56, y: 76, color: '#72cf25' },
    { x: 70, y: 36, color: '#b53a00' },
    { x: 82, y: 58, color: '#b600b8' },
  ];

  return (
    <div
      css={{
        position: 'relative',
        height: 120,
        border: `1px solid ${theme.colors.border}`,
        borderRadius: theme.borders.borderRadiusMd,
        backgroundImage: `linear-gradient(${theme.colors.border} 1px, transparent 1px), linear-gradient(90deg, ${theme.colors.border} 1px, transparent 1px)`,
        backgroundSize: '34px 34px',
      }}
    >
      {points.map((point, index) => (
        <span
          key={index}
          css={{
            position: 'absolute',
            left: `${point.x}%`,
            top: `${point.y}%`,
            width: 12,
            height: 12,
            borderRadius: '50%',
            backgroundColor: point.color,
            border: `2px solid ${theme.colors.backgroundPrimary}`,
          }}
        />
      ))}
    </div>
  );
};

const CustomThumbnail = () => {
  const { theme } = useDesignSystemTheme();

  return (
    <div css={{ display: 'grid', gridTemplateColumns: '1fr 108px', gap: theme.spacing.md, alignItems: 'center' }}>
      <MiniLine color={theme.colors.blue500} />
      <div css={{ display: 'flex', flexDirection: 'column', gap: theme.spacing.sm }}>
        {[82, 64, 92, 54].map((width, index) => (
          <span
            key={index}
            css={{
              width: `${width}%`,
              height: 10,
              borderRadius: theme.borders.borderRadiusSm,
              backgroundColor: index === 1 ? theme.colors.green500 : theme.colors.actionTertiaryBackgroundHover,
            }}
          />
        ))}
      </div>
    </div>
  );
};

const DashboardThumbnail = ({ kind }: { kind: DashboardThumbnailKind }) => {
  const { theme } = useDesignSystemTheme();

  if (kind === 'failure-patterns') {
    return <FailurePatternThumbnail />;
  }

  if (kind === 'topics') {
    return <TopicsThumbnail />;
  }

  if (kind === 'custom') {
    return <CustomThumbnail />;
  }

  return (
    <div css={{ display: 'flex', flexDirection: 'column', gap: theme.spacing.md }}>
      {kind === 'traces' && <MiniBars color={theme.colors.blue500} />}
      {kind === 'quality' && <MiniLine color={theme.colors.green500} />}
      {kind === 'tools' && <MiniBars color={theme.colors.yellow500} />}
      <div css={{ display: 'flex', gap: theme.spacing.sm }}>
        {[48, 64, 38].map((width, index) => (
          <span
            key={index}
            css={{
              height: 8,
              width,
              borderRadius: theme.borders.borderRadiusSm,
              backgroundColor: theme.colors.actionTertiaryBackgroundHover,
            }}
          />
        ))}
      </div>
    </div>
  );
};

const DashboardCard = ({ dashboard }: { dashboard: DashboardCardDefinition }) => {
  const { theme } = useDesignSystemTheme();

  return (
    <article
      css={{
        display: 'flex',
        flexDirection: 'column',
        minHeight: 330,
        border: `1px solid ${theme.colors.border}`,
        borderRadius: theme.borders.borderRadiusMd,
        backgroundColor: theme.colors.backgroundPrimary,
        overflow: 'hidden',
      }}
    >
      <div css={{ padding: theme.spacing.lg, paddingBottom: theme.spacing.md }}>
        <div
          css={{ display: 'flex', justifyContent: 'space-between', gap: theme.spacing.sm, alignItems: 'flex-start' }}
        >
          <div css={{ minWidth: 0 }}>
            <Typography.Title level={3} css={{ margin: 0 }} ellipsis>
              {dashboard.title}
            </Typography.Title>
            <Typography.Text color="secondary" size="lg">
              {dashboard.source}
            </Typography.Text>
          </div>
          {dashboard.verified && <CheckCircleIcon css={{ color: theme.colors.blue500, flexShrink: 0 }} />}
        </div>
      </div>
      <div
        css={{
          margin: `0 ${theme.spacing.lg}px`,
          padding: theme.spacing.md,
          minHeight: 142,
          borderRadius: theme.borders.borderRadiusMd,
          backgroundColor: theme.colors.backgroundSecondary,
          border: `1px solid ${theme.colors.border}`,
        }}
      >
        <DashboardThumbnail kind={dashboard.thumbnail} />
      </div>
      <div
        css={{
          display: 'flex',
          flexDirection: 'column',
          gap: theme.spacing.sm,
          padding: theme.spacing.lg,
          paddingTop: theme.spacing.md,
          flex: 1,
        }}
      >
        <Typography.Text color="secondary">{dashboard.subtitle}</Typography.Text>
        <div css={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 'auto' }}>
          <Typography.Text color="secondary" size="sm">
            <FormattedMessage
              defaultMessage="{count} widgets"
              description="Dashboard card widget count"
              values={{ count: dashboard.widgets }}
            />
          </Typography.Text>
          <Button componentId="mlflow.experiment-dashboard.open" size="small" type="tertiary">
            <FormattedMessage defaultMessage="Open" description="Open dashboard card button" />
          </Button>
        </div>
      </div>
    </article>
  );
};

const ExperimentGenAIDashboardPage = () => {
  const { theme } = useDesignSystemTheme();

  return (
    <div
      css={{
        display: 'flex',
        flexDirection: 'column',
        gap: theme.spacing.lg,
        flex: 1,
        minHeight: 0,
        overflow: 'auto',
        padding: theme.spacing.md,
      }}
    >
      <div css={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: theme.spacing.md }}>
        <div css={{ display: 'flex', flexDirection: 'column', gap: theme.spacing.xs }}>
          <Typography.Title level={2} css={{ margin: 0 }}>
            <FormattedMessage defaultMessage="Dashboard" description="Dashboard gallery page title" />
          </Typography.Title>
          <Typography.Text color="secondary">
            <FormattedMessage
              defaultMessage="Preconfigured dashboards appear first. Widgets promoted from Analysis create custom dashboards next."
              description="Dashboard gallery page description"
            />
          </Typography.Text>
        </div>
        <Button componentId="mlflow.experiment-dashboard.new" type="primary" icon={<PlusIcon />}>
          <FormattedMessage defaultMessage="New" description="Create new dashboard button" />
        </Button>
      </div>
      <div
        css={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
          gap: theme.spacing.lg,
          paddingBottom: theme.spacing.lg,
        }}
      >
        {DASHBOARD_CARDS.map((dashboard) => (
          <DashboardCard key={dashboard.id} dashboard={dashboard} />
        ))}
      </div>
    </div>
  );
};

export default ExperimentGenAIDashboardPage;
