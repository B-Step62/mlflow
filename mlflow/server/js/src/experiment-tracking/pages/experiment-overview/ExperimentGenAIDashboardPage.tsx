import {
  ChartLineIcon,
  CheckCircleIcon,
  ColumnsIcon,
  Table,
  TableCell,
  TableHeader,
  TableIcon,
  TableRow,
  TableRowAction,
  Tag,
  Typography,
  UserIcon,
  useDesignSystemTheme,
} from '@databricks/design-system';
import { FormattedMessage } from 'react-intl';

type DashboardListItemDefinition = {
  id: string;
  title: string;
  modified: string;
  owner: string;
  tags: string[];
  verified?: boolean;
};

const DASHBOARD_LIST_ITEMS: DashboardListItemDefinition[] = [
  {
    id: 'traces',
    title: 'Traces',
    modified: '5 months ago',
    owner: 'MLflow',
    tags: [],
  },
  {
    id: 'quality',
    title: 'Quality',
    modified: '4 months ago',
    owner: 'MLflow',
    tags: [],
  },
  {
    id: 'tool-calls',
    title: 'Tool calls',
    modified: '3 days ago',
    owner: 'MLflow',
    tags: [],
  },
  {
    id: 'common-failures',
    title: 'Common failures overview',
    modified: '2 days ago',
    owner: 'MLflow',
    tags: ['Analysis'],
    verified: true,
  },
  {
    id: 'topics',
    title: 'Topic Explorer',
    modified: '13 days ago',
    owner: 'MLflow',
    tags: ['Analysis'],
  },
  {
    id: 'tool-p95',
    title: 'Tool p95 Analysis',
    modified: '1 day ago',
    owner: 'MLflow',
    tags: ['Custom'],
  },
];

const cellStyles = { verticalAlign: 'middle' as const };
const nameCellStyles = { ...cellStyles, flex: 2.4 };
const nameHeaderStyles = { ...cellStyles, flex: 2.4 };
const tagsCellStyles = { ...cellStyles, flex: 1.5 };
const tagsHeaderStyles = { ...cellStyles, flex: 1.5 };

const DashboardNameCell = ({ dashboard }: { dashboard: DashboardListItemDefinition }) => {
  const { theme } = useDesignSystemTheme();

  return (
    <div css={{ display: 'flex', alignItems: 'center', gap: theme.spacing.sm, minWidth: 0 }}>
      <TableIcon css={{ color: theme.colors.textSecondary, flexShrink: 0 }} />
      <Typography.Text ellipsis>{dashboard.title}</Typography.Text>
      <ChartLineIcon css={{ color: theme.colors.textSecondary, flexShrink: 0 }} />
      {dashboard.verified && <CheckCircleIcon css={{ color: theme.colors.blue500, flexShrink: 0 }} />}
    </div>
  );
};

const DashboardOwnerCell = ({ owner }: { owner: string }) => {
  const { theme } = useDesignSystemTheme();

  return (
    <div css={{ display: 'flex', alignItems: 'center', gap: theme.spacing.xs, minWidth: 0 }}>
      <UserIcon css={{ color: theme.colors.textSecondary, flexShrink: 0 }} />
      <Typography.Text ellipsis>{owner}</Typography.Text>
    </div>
  );
};

const DashboardTagsCell = ({ tags }: { tags: string[] }) => {
  const { theme } = useDesignSystemTheme();

  if (tags.length === 0) {
    return <Typography.Text>-</Typography.Text>;
  }

  return (
    <div css={{ display: 'flex', alignItems: 'center', gap: theme.spacing.xs, minWidth: 0 }}>
      {tags.slice(0, 1).map((tag) => (
        <Tag key={tag} componentId="mlflow.experiment-dashboard.tag" color="turquoise">
          {tag}
        </Tag>
      ))}
      {tags.length > 1 && (
        <Tag componentId="mlflow.experiment-dashboard.more-tags" color="charcoal">
          +{tags.length - 1}
        </Tag>
      )}
    </div>
  );
};

const ExperimentGenAIDashboardPage = () => {
  const { theme } = useDesignSystemTheme();

  return (
    <div
      css={{
        flex: 1,
        minHeight: 0,
        overflow: 'auto',
        padding: theme.spacing.md,
      }}
    >
      <Table>
        <TableRow isHeader>
          <TableHeader componentId="mlflow.experiment-dashboard.header.name" css={nameHeaderStyles}>
            <FormattedMessage defaultMessage="Name" description="Dashboard table name column header" />
          </TableHeader>
          <TableHeader componentId="mlflow.experiment-dashboard.header.modified" css={cellStyles}>
            <FormattedMessage defaultMessage="Modified" description="Dashboard table modified column header" />
          </TableHeader>
          <TableHeader componentId="mlflow.experiment-dashboard.header.owner" css={cellStyles}>
            <FormattedMessage defaultMessage="Owner" description="Dashboard table owner column header" />
          </TableHeader>
          <TableHeader componentId="mlflow.experiment-dashboard.header.tags" css={tagsHeaderStyles}>
            <FormattedMessage defaultMessage="Tags" description="Dashboard table tags column header" />
          </TableHeader>
          <TableRowAction>
            <ColumnsIcon css={{ color: theme.colors.textSecondary }} />
          </TableRowAction>
        </TableRow>
        {DASHBOARD_LIST_ITEMS.map((dashboard) => (
          <TableRow key={dashboard.id}>
            <TableCell css={nameCellStyles}>
              <DashboardNameCell dashboard={dashboard} />
            </TableCell>
            <TableCell css={cellStyles}>{dashboard.modified}</TableCell>
            <TableCell css={cellStyles}>
              <DashboardOwnerCell owner={dashboard.owner} />
            </TableCell>
            <TableCell css={tagsCellStyles}>
              <DashboardTagsCell tags={dashboard.tags} />
            </TableCell>
            <TableRowAction />
          </TableRow>
        ))}
      </Table>
    </div>
  );
};

export default ExperimentGenAIDashboardPage;
