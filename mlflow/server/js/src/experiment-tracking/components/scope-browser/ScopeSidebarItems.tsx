import {
  ArrowLeftIcon,
  ChartLineIcon,
  DatabaseIcon,
  FolderBranchIcon,
  ForkHorizontalIcon,
  GavelIcon,
  ListIcon,
  ModelsIcon,
  PlusMinusSquareIcon,
  Spinner,
  SpeechBubbleIcon,
  TextBoxIcon,
  Typography,
  useDesignSystemTheme,
} from '@databricks/design-system';
import { MlflowSidebarLink } from '../../../common/components/MlflowSidebarLink';
import { Link, matchPath, useLocation } from '../../../common/utils/RoutingUtils';
import { findScopeByPath } from './mockScopeData';
import { FormattedMessage } from 'react-intl';
import { Fragment } from 'react';

export type ScopeTabName = 'traces' | 'runs' | 'datasets' | 'judges' | 'prompts' | 'models' | 'evaluation-runs';

interface ScopeNavItem {
  componentId: string;
  label: React.ReactNode;
  icon: React.ReactNode;
  tabName: ScopeTabName;
}

interface ScopeNavSection {
  key: string;
  label?: React.ReactNode;
  items: ScopeNavItem[];
}

const SCOPE_NAV_SECTIONS: ScopeNavSection[] = [
  {
    key: 'observability',
    label: (
      <FormattedMessage
        defaultMessage="Observability"
        description="Label for the observability section in scope sidebar"
      />
    ),
    items: [
      {
        label: <FormattedMessage defaultMessage="Traces" description="Label for the traces tab in scope sidebar" />,
        icon: <ForkHorizontalIcon />,
        tabName: 'traces',
        componentId: 'mlflow.scope-side-nav.traces',
      },
    ],
  },
  {
    key: 'evaluation',
    label: (
      <FormattedMessage defaultMessage="Evaluation" description="Label for the evaluation section in scope sidebar" />
    ),
    items: [
      {
        label: <FormattedMessage defaultMessage="Judges" description="Label for the judges tab in scope sidebar" />,
        icon: <GavelIcon />,
        tabName: 'judges',
        componentId: 'mlflow.scope-side-nav.judges',
      },
      {
        label: <FormattedMessage defaultMessage="Datasets" description="Label for the datasets tab in scope sidebar" />,
        icon: <DatabaseIcon />,
        tabName: 'datasets',
        componentId: 'mlflow.scope-side-nav.datasets',
      },
      {
        label: (
          <FormattedMessage
            defaultMessage="Evaluation runs"
            description="Label for the evaluation runs tab in scope sidebar"
          />
        ),
        icon: <PlusMinusSquareIcon />,
        tabName: 'evaluation-runs',
        componentId: 'mlflow.scope-side-nav.evaluation-runs',
      },
    ],
  },
  {
    key: 'prompts-versions',
    label: (
      <FormattedMessage
        defaultMessage="Prompts & versions"
        description="Label for the prompts & versions section in scope sidebar"
      />
    ),
    items: [
      {
        label: <FormattedMessage defaultMessage="Prompts" description="Label for the prompts tab in scope sidebar" />,
        icon: <TextBoxIcon />,
        tabName: 'prompts',
        componentId: 'mlflow.scope-side-nav.prompts',
      },
      {
        label: (
          <FormattedMessage
            defaultMessage="Agent versions"
            description="Label for the agent versions tab in scope sidebar"
          />
        ),
        icon: <ModelsIcon />,
        tabName: 'models',
        componentId: 'mlflow.scope-side-nav.models',
      },
    ],
  },
  {
    key: 'training',
    label: <FormattedMessage defaultMessage="Training" description="Label for the training section in scope sidebar" />,
    items: [
      {
        label: <FormattedMessage defaultMessage="Runs" description="Label for the runs tab in scope sidebar" />,
        icon: <ListIcon />,
        tabName: 'runs',
        componentId: 'mlflow.scope-side-nav.runs',
      },
    ],
  },
];

interface ScopeSidebarItemsProps {
  collapsed: boolean;
  scopePath: string[];
  onBackClick?: () => void;
}

export const ScopeSidebarItems = ({ collapsed, scopePath, onBackClick }: ScopeSidebarItemsProps) => {
  const { theme } = useDesignSystemTheme();
  const location = useLocation();
  const scope = findScopeByPath(scopePath);
  const basePath = `/scopes/${scopePath.join('/')}`;

  // Determine active tab from URL
  const getActiveTab = (): ScopeTabName | null => {
    for (const section of SCOPE_NAV_SECTIONS) {
      for (const item of section.items) {
        if (matchPath(`/scopes/*`, location.pathname)) {
          const pathAfterScopes = location.pathname.replace(/^\/scopes\//, '');
          if (pathAfterScopes.endsWith(`/${item.tabName}`)) {
            return item.tabName;
          }
        }
      }
    }
    return null;
  };
  const activeTab = getActiveTab();

  return (
    <>
      <MlflowSidebarLink
        css={{ border: `1px solid ${theme.colors.actionDefaultBorderDefault}`, marginBottom: theme.spacing.sm }}
        to="/scopes"
        componentId="mlflow.scope-sidebar.back-button"
        isActive={() => false}
        onClick={onBackClick}
        icon={<ArrowLeftIcon />}
        collapsed={collapsed}
        tooltipContent={
          <FormattedMessage defaultMessage="Back to scopes" description="Tooltip for back to scopes button" />
        }
      >
        <FolderBranchIcon />
        {scope ? (
          <Typography.Text ellipsis>{scope.name}</Typography.Text>
        ) : (
          <Typography.Text ellipsis>{scopePath[scopePath.length - 1]}</Typography.Text>
        )}
      </MlflowSidebarLink>
      {SCOPE_NAV_SECTIONS.map((section) => (
        <Fragment key={section.key}>
          {section.label &&
            (collapsed ? (
              <div
                css={{
                  paddingLeft: theme.spacing.lg,
                  marginTop: theme.spacing.sm,
                  marginBottom: theme.spacing.sm,
                  borderBottom: `1px solid ${theme.colors.actionDefaultBorderDefault}`,
                }}
              />
            ) : (
              <li css={{ paddingLeft: theme.spacing.lg, marginTop: theme.spacing.sm, marginBottom: theme.spacing.sm }}>
                <Typography.Text size="sm" color="secondary">
                  {section.label}
                </Typography.Text>
              </li>
            ))}
          {section.items.map((item) => {
            const isActive = () => activeTab === item.tabName;
            return (
              <MlflowSidebarLink
                css={{ paddingLeft: collapsed ? undefined : theme.spacing.lg }}
                key={item.componentId}
                to={`${basePath}/${item.tabName}`}
                componentId={item.componentId}
                isActive={isActive}
                collapsed={collapsed}
                icon={item.icon}
              >
                {item.label}
              </MlflowSidebarLink>
            );
          })}
        </Fragment>
      ))}
      <div
        css={{
          borderBottom: `1px solid ${theme.colors.actionDefaultBorderDefault}`,
          width: '100%',
          paddingTop: theme.spacing.sm,
          marginBottom: theme.spacing.sm,
        }}
      />
    </>
  );
};
