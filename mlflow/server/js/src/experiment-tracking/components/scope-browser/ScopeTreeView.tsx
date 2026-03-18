import { useState, useCallback } from 'react';
import {
  ArrowLeftIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  FolderIcon,
  FolderOpenIcon,
  Typography,
  useDesignSystemTheme,
} from '@databricks/design-system';
import { Link, useLocation, matchPath } from '../../../common/utils/RoutingUtils';
import { MlflowSidebarLink } from '../../../common/components/MlflowSidebarLink';
import type { MockScope } from './mockScopeData';
import { MOCK_SCOPES, countResourcesInScope } from './mockScopeData';
import ExperimentTrackingRoutes from '../../routes';
import { FormattedMessage } from 'react-intl';
import { getScopePath } from './mockScopeData';

interface ScopeTreeNodeProps {
  scope: MockScope;
  collapsed: boolean;
  activeScopePath: string[];
}

const ScopeTreeNode = ({ scope, collapsed, activeScopePath }: ScopeTreeNodeProps) => {
  const { theme } = useDesignSystemTheme();
  const location = useLocation();
  const scopePath = getScopePath(scope.id);
  const scopeUrl = `/scopes/${scopePath.join('/')}`;
  const hasChildren = scope.children.length > 0;
  const resourceCount = countResourcesInScope(scope.id);

  // Check if this node or its descendants match the active path
  const isOnPath = activeScopePath.length > 0 && scopePath.every((s, i) => activeScopePath[i] === s);
  const isActive = scopePath.length === activeScopePath.length && isOnPath;

  const [expanded, setExpanded] = useState(isOnPath);

  const handleToggle = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setExpanded((prev) => !prev);
  }, []);

  return (
    <li>
      <Link
        componentId={`mlflow.scope-browser.tree-node-${scope.id}`}
        to={scopeUrl}
        css={{
          display: 'flex',
          alignItems: 'center',
          gap: theme.spacing.xs,
          paddingBlock: theme.spacing.xs + 2,
          paddingLeft: collapsed ? theme.spacing.xs : theme.spacing.sm + scope.depth * theme.spacing.md,
          paddingRight: theme.spacing.sm,
          borderRadius: theme.borders.borderRadiusSm,
          color: theme.colors.textPrimary,
          textDecoration: 'none',
          fontSize: theme.typography.fontSizeSm,
          fontWeight: isActive ? theme.typography.typographyBoldFontWeight : 'normal',
          backgroundColor: isActive ? theme.colors.actionDefaultBackgroundPress : 'transparent',
          ...(isActive && {
            color: theme.isDarkMode ? theme.colors.blue300 : theme.colors.blue700,
          }),
          '&:hover': {
            backgroundColor: theme.colors.actionDefaultBackgroundHover,
            color: theme.colors.actionLinkHover,
          },
        }}
      >
        {!collapsed && hasChildren && (
          <span
            role="button"
            tabIndex={0}
            onClick={handleToggle}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                setExpanded((prev) => !prev);
              }
            }}
            css={{
              display: 'flex',
              alignItems: 'center',
              cursor: 'pointer',
              flexShrink: 0,
            }}
          >
            {expanded ? <ChevronDownIcon css={{ fontSize: 12 }} /> : <ChevronRightIcon css={{ fontSize: 12 }} />}
          </span>
        )}
        {!collapsed && !hasChildren && <span css={{ width: 12, flexShrink: 0 }} />}
        {expanded ? (
          <FolderOpenIcon css={{ fontSize: 14, flexShrink: 0 }} />
        ) : (
          <FolderIcon css={{ fontSize: 14, flexShrink: 0 }} />
        )}
        {!collapsed && (
          <>
            <Typography.Text ellipsis css={{ flex: 1, fontSize: 'inherit', fontWeight: 'inherit', color: 'inherit' }}>
              {scope.name}
            </Typography.Text>
            {resourceCount > 0 && (
              <Typography.Text size="sm" color="secondary" css={{ flexShrink: 0, fontSize: 11 }}>
                {resourceCount}
              </Typography.Text>
            )}
          </>
        )}
      </Link>
      {!collapsed && expanded && hasChildren && (
        <ul css={{ listStyleType: 'none', padding: 0, margin: 0 }}>
          {scope.children.map((child) => (
            <ScopeTreeNode key={child.id} scope={child} collapsed={collapsed} activeScopePath={activeScopePath} />
          ))}
        </ul>
      )}
    </li>
  );
};

interface ScopeTreeViewProps {
  collapsed: boolean;
  onBackClick?: () => void;
}

export const ScopeTreeView = ({ collapsed, onBackClick }: ScopeTreeViewProps) => {
  const { theme } = useDesignSystemTheme();
  const location = useLocation();

  // Parse current scope path from URL
  const scopeMatch = matchPath('/scopes/*', location.pathname);
  const activeScopePath = scopeMatch?.params['*']?.split('/').filter(Boolean) ?? [];

  return (
    <>
      <MlflowSidebarLink
        css={{ border: `1px solid ${theme.colors.actionDefaultBorderDefault}`, marginBottom: theme.spacing.sm }}
        to={ExperimentTrackingRoutes.experimentsObservatoryRoute}
        componentId="mlflow.scope-browser.back-button"
        isActive={() => false}
        onClick={onBackClick}
        icon={<ArrowLeftIcon />}
        collapsed={collapsed}
        tooltipContent={
          <FormattedMessage defaultMessage="Back to experiments" description="Tooltip for back to experiments button" />
        }
      >
        <FormattedMessage defaultMessage="Experiments" description="Back to experiments label" />
      </MlflowSidebarLink>
      <li css={{ paddingLeft: collapsed ? 0 : theme.spacing.sm, marginBottom: theme.spacing.xs }}>
        <Link
          componentId="mlflow.scope-browser.scopes-header"
          to="/scopes"
          css={{
            color: theme.colors.textSecondary,
            fontSize: theme.typography.fontSizeSm,
            fontWeight: theme.typography.typographyBoldFontWeight,
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            '&:hover': { color: theme.colors.actionLinkHover },
          }}
        >
          {!collapsed && 'Scopes'}
        </Link>
      </li>
      <ul css={{ listStyleType: 'none', padding: 0, margin: 0 }}>
        {MOCK_SCOPES.map((scope) => (
          <ScopeTreeNode key={scope.id} scope={scope} collapsed={collapsed} activeScopePath={activeScopePath} />
        ))}
      </ul>
    </>
  );
};
