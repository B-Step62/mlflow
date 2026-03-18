import { useState } from 'react';
import {
  ChevronDownIcon,
  ChevronRightIcon,
  ClockIcon,
  StarFillIcon,
  Typography,
  useDesignSystemTheme,
} from '@databricks/design-system';
import { Link, matchPath, useLocation } from '../../../common/utils/RoutingUtils';
import { MOCK_FAVORITES, MOCK_RECENTS, findScopeById, getScopePath } from './mockScopeData';

interface CollapsibleSectionProps {
  title: string;
  icon: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
  collapsed: boolean;
}

const CollapsibleSection = ({ title, icon, defaultOpen = true, children, collapsed }: CollapsibleSectionProps) => {
  const { theme } = useDesignSystemTheme();
  const [open, setOpen] = useState(defaultOpen);

  if (collapsed) return null;

  return (
    <div css={{ marginTop: theme.spacing.sm }}>
      <div
        role="button"
        tabIndex={0}
        onClick={() => setOpen(!open)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setOpen(!open);
          }
        }}
        css={{
          display: 'flex',
          alignItems: 'center',
          gap: theme.spacing.xs,
          padding: `${theme.spacing.xs}px ${theme.spacing.sm}px`,
          cursor: 'pointer',
          color: theme.colors.textSecondary,
          '&:hover': { color: theme.colors.textPrimary },
        }}
      >
        {open ? <ChevronDownIcon css={{ fontSize: 12 }} /> : <ChevronRightIcon css={{ fontSize: 12 }} />}
        {icon}
        <Typography.Text size="sm" color="secondary" css={{ fontWeight: theme.typography.typographyBoldFontWeight }}>
          {title}
        </Typography.Text>
      </div>
      {open && <ul css={{ listStyleType: 'none', padding: 0, margin: 0 }}>{children}</ul>}
    </div>
  );
};

interface ScopeFavoritesRecentsProps {
  collapsed: boolean;
}

export const ScopeFavoritesRecents = ({ collapsed }: ScopeFavoritesRecentsProps) => {
  const { theme } = useDesignSystemTheme();
  const location = useLocation();

  const renderScopeItem = (scopeId: string) => {
    const scope = findScopeById(scopeId);
    if (!scope) return null;
    const path = getScopePath(scopeId);
    const url = `/scopes/${path.join('/')}`;
    const isActive = Boolean(matchPath(url, location.pathname));

    return (
      <li key={scopeId}>
        <Link
          componentId={`mlflow.scope-browser.fav-recent-${scopeId}`}
          to={url}
          css={{
            display: 'flex',
            flexDirection: 'column',
            padding: `${theme.spacing.xs}px ${theme.spacing.sm}px`,
            paddingLeft: theme.spacing.lg,
            borderRadius: theme.borders.borderRadiusSm,
            color: theme.colors.textPrimary,
            fontSize: theme.typography.fontSizeSm,
            textDecoration: 'none',
            backgroundColor: isActive ? theme.colors.actionDefaultBackgroundPress : 'transparent',
            '&:hover': {
              backgroundColor: theme.colors.actionDefaultBackgroundHover,
              color: theme.colors.actionLinkHover,
            },
          }}
        >
          <Typography.Text ellipsis css={{ fontSize: 'inherit', color: 'inherit' }}>
            {scope.name}
          </Typography.Text>
          {path.length > 1 && (
            <Typography.Text ellipsis size="sm" color="secondary" css={{ fontSize: 11 }}>
              {path.slice(0, -1).join(' / ')}
            </Typography.Text>
          )}
        </Link>
      </li>
    );
  };

  return (
    <>
      <div
        css={{
          borderBottom: `1px solid ${theme.colors.actionDefaultBorderDefault}`,
          width: '100%',
          paddingTop: theme.spacing.sm,
          marginBottom: theme.spacing.xs,
        }}
      />
      <CollapsibleSection
        title="Favorites"
        icon={<StarFillIcon css={{ fontSize: 12, color: theme.colors.yellow500 }} />}
        collapsed={collapsed}
      >
        {MOCK_FAVORITES.map(renderScopeItem)}
      </CollapsibleSection>
      <CollapsibleSection
        title="Recent"
        icon={<ClockIcon css={{ fontSize: 12 }} />}
        defaultOpen={false}
        collapsed={collapsed}
      >
        {MOCK_RECENTS.map(renderScopeItem)}
      </CollapsibleSection>
    </>
  );
};
