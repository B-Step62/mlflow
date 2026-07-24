import { Button, CheckCircleIcon, PlusIcon, Typography, useDesignSystemTheme } from '@databricks/design-system';
import { FormattedMessage } from 'react-intl';

type DashboardListItemDefinition = {
  id: string;
  title: string;
  subtitle: string;
  source: 'Preconfigured' | 'Custom from Analysis';
  widgets: number;
  verified?: boolean;
};

const DASHBOARD_LIST_ITEMS: DashboardListItemDefinition[] = [
  {
    id: 'traces',
    title: 'Traces',
    subtitle: 'Trace volume, latency, errors, and span activity',
    source: 'Preconfigured',
    widgets: 6,
  },
  {
    id: 'quality',
    title: 'Quality',
    subtitle: 'Assessment scores, pass rates, and quality trends',
    source: 'Preconfigured',
    widgets: 5,
  },
  {
    id: 'tool-calls',
    title: 'Tool calls',
    subtitle: 'Tool usage, latency, errors, and performance summary',
    source: 'Preconfigured',
    widgets: 4,
  },
  {
    id: 'failure-patterns',
    title: 'Common failures overview',
    subtitle: 'Issues Found, Issues Over Time, and detected issue detail',
    source: 'Custom from Analysis',
    widgets: 2,
  },
  {
    id: 'topics',
    title: 'Topic Explorer',
    subtitle: 'Topic scatterplot, topic list, and automation status',
    source: 'Custom from Analysis',
    widgets: 3,
  },
  {
    id: 'tool-p95',
    title: 'Tool p95 Analysis',
    subtitle: 'Custom SQL-like analysis with latency chart and tool summary',
    source: 'Custom from Analysis',
    widgets: 2,
    verified: true,
  },
];

const DashboardRow = ({ dashboard }: { dashboard: DashboardListItemDefinition }) => {
  const { theme } = useDesignSystemTheme();

  return (
    <article
      css={{
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1fr) 180px 96px 72px',
        gap: theme.spacing.lg,
        alignItems: 'center',
        padding: `${theme.spacing.md}px ${theme.spacing.lg}px`,
        borderBottom: `1px solid ${theme.colors.border}`,
        backgroundColor: theme.colors.backgroundPrimary,
        minWidth: 0,
      }}
    >
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
        gridTemplateColumns: 'minmax(0, 1fr) 180px 96px 72px',
        gap: theme.spacing.lg,
        padding: `${theme.spacing.sm}px ${theme.spacing.lg}px`,
        borderBottom: `1px solid ${theme.colors.border}`,
        backgroundColor: theme.colors.backgroundSecondary,
      }}
    >
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
          minWidth: 640,
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
