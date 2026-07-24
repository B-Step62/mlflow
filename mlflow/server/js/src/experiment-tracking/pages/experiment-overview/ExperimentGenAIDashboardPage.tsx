import { Button, CheckCircleIcon, PlusIcon, Typography, useDesignSystemTheme } from '@databricks/design-system';
import { FormattedMessage } from 'react-intl';

type DashboardThumbnailKind = 'traces' | 'quality' | 'tools' | 'failure-patterns' | 'topics' | 'custom';

type DashboardListItemDefinition = {
  id: string;
  title: string;
  subtitle: string;
  source: 'Preconfigured' | 'Custom from Analysis';
  widgets: number;
  verified?: boolean;
  thumbnail: DashboardThumbnailKind;
};

const DASHBOARD_LIST_ITEMS: DashboardListItemDefinition[] = [
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
    title: 'Common failures overview',
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
  const heights = [24, 44, 34, 52, 38, 60, 30, 48, 40, 54, 32, 46];

  return (
    <div css={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 60, minWidth: 0 }}>
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
  <svg viewBox="0 0 220 64" preserveAspectRatio="none" css={{ width: '100%', height: 60 }}>
    <polyline
      points="0,48 24,34 48,44 72,24 96,36 120,16 144,26 168,22 192,38 220,14"
      fill="none"
      stroke={color}
      strokeWidth="4"
    />
  </svg>
);

const FailurePatternThumbnail = () => {
  const { theme } = useDesignSystemTheme();

  return (
    <div css={{ display: 'grid', gridTemplateColumns: '56px 1fr', gap: theme.spacing.sm, alignItems: 'center' }}>
      <div
        css={{
          width: 50,
          height: 50,
          borderRadius: '50%',
          background: `conic-gradient(${theme.colors.blue500} 0 66%, ${theme.colors.yellow500} 66% 100%)`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <div
          css={{
            width: 28,
            height: 28,
            borderRadius: '50%',
            backgroundColor: theme.colors.backgroundPrimary,
          }}
        />
      </div>
      <div css={{ display: 'flex', alignItems: 'flex-end', gap: theme.spacing.xs, height: 60 }}>
        {[34, 52, 24, 58].map((height, index) => (
          <span
            key={index}
            css={{
              width: 18,
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
        height: 64,
        border: `1px solid ${theme.colors.border}`,
        borderRadius: theme.borders.borderRadiusMd,
        backgroundImage: `linear-gradient(${theme.colors.border} 1px, transparent 1px), linear-gradient(90deg, ${theme.colors.border} 1px, transparent 1px)`,
        backgroundSize: '24px 24px',
      }}
    >
      {points.map((point, index) => (
        <span
          key={index}
          css={{
            position: 'absolute',
            left: `${point.x}%`,
            top: `${point.y}%`,
            width: 8,
            height: 8,
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
    <div css={{ display: 'grid', gridTemplateColumns: '1fr 72px', gap: theme.spacing.sm, alignItems: 'center' }}>
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

const DashboardRow = ({ dashboard }: { dashboard: DashboardListItemDefinition }) => {
  const { theme } = useDesignSystemTheme();

  return (
    <article
      css={{
        display: 'grid',
        gridTemplateColumns: '132px minmax(0, 1fr) 160px 96px 72px',
        gap: theme.spacing.lg,
        alignItems: 'center',
        padding: `${theme.spacing.md}px ${theme.spacing.lg}px`,
        borderBottom: `1px solid ${theme.colors.border}`,
        backgroundColor: theme.colors.backgroundPrimary,
        minWidth: 0,
      }}
    >
      <div
        css={{
          height: 76,
          padding: theme.spacing.sm,
          borderRadius: theme.borders.borderRadiusMd,
          backgroundColor: theme.colors.backgroundSecondary,
          border: `1px solid ${theme.colors.border}`,
          overflow: 'hidden',
        }}
      >
        <DashboardThumbnail kind={dashboard.thumbnail} />
      </div>
      <div css={{ display: 'flex', flexDirection: 'column', gap: theme.spacing.xs, minWidth: 0 }}>
        <div css={{ display: 'flex', alignItems: 'center', gap: theme.spacing.sm, minWidth: 0 }}>
          <Typography.Title level={4} css={{ margin: 0 }} ellipsis>
            {dashboard.title}
          </Typography.Title>
          {dashboard.verified && <CheckCircleIcon css={{ color: theme.colors.blue500, flexShrink: 0 }} />}
        </div>
        <Typography.Text color="secondary" ellipsis>
          {dashboard.subtitle}
        </Typography.Text>
      </div>
      <Typography.Text color="secondary">{dashboard.source}</Typography.Text>
      <Typography.Text color="secondary" size="sm">
        <FormattedMessage
          defaultMessage="{count} widgets"
          description="Dashboard list widget count"
          values={{ count: dashboard.widgets }}
        />
      </Typography.Text>
      <Button componentId="mlflow.experiment-dashboard.open" size="small" type="tertiary">
        <FormattedMessage defaultMessage="Open" description="Open dashboard list item button" />
      </Button>
    </article>
  );
};

const DashboardListHeader = () => {
  const { theme } = useDesignSystemTheme();

  return (
    <div
      css={{
        display: 'grid',
        gridTemplateColumns: '132px minmax(0, 1fr) 160px 96px 72px',
        gap: theme.spacing.lg,
        padding: `${theme.spacing.sm}px ${theme.spacing.lg}px`,
        borderBottom: `1px solid ${theme.colors.border}`,
        backgroundColor: theme.colors.backgroundSecondary,
      }}
    >
      <Typography.Text color="secondary" size="sm" bold>
        <FormattedMessage defaultMessage="Preview" description="Dashboard list preview column heading" />
      </Typography.Text>
      <Typography.Text color="secondary" size="sm" bold>
        <FormattedMessage defaultMessage="Name" description="Dashboard list name column heading" />
      </Typography.Text>
      <Typography.Text color="secondary" size="sm" bold>
        <FormattedMessage defaultMessage="Source" description="Dashboard list source column heading" />
      </Typography.Text>
      <Typography.Text color="secondary" size="sm" bold>
        <FormattedMessage defaultMessage="Widgets" description="Dashboard list widgets column heading" />
      </Typography.Text>
      <span />
    </div>
  );
};

const ExperimentGenAIDashboardPage = () => {
  const { theme } = useDesignSystemTheme();

  return (
    <div
      css={{
        display: 'flex',
        flexDirection: 'column',
        gap: theme.spacing.md,
        flex: 1,
        minHeight: 0,
        overflow: 'auto',
        padding: theme.spacing.md,
      }}
    >
      <div css={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: theme.spacing.md }}>
        <Typography.Text color="secondary">
          <FormattedMessage
            defaultMessage="Preconfigured dashboards appear first. Widgets promoted from Analysis create custom dashboards next."
            description="Dashboard list page description"
          />
        </Typography.Text>
        <Button componentId="mlflow.experiment-dashboard.new" type="primary" icon={<PlusIcon />}>
          <FormattedMessage defaultMessage="New" description="Create new dashboard button" />
        </Button>
      </div>
      <div
        css={{
          border: `1px solid ${theme.colors.border}`,
          borderRadius: theme.borders.borderRadiusMd,
          backgroundColor: theme.colors.backgroundPrimary,
          overflow: 'hidden',
          minWidth: 760,
        }}
      >
        <DashboardListHeader />
        {DASHBOARD_LIST_ITEMS.map((dashboard) => (
          <DashboardRow key={dashboard.id} dashboard={dashboard} />
        ))}
      </div>
    </div>
  );
};

export default ExperimentGenAIDashboardPage;
