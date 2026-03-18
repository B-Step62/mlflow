import { ChevronRightIcon, useDesignSystemTheme } from '@databricks/design-system';
import { Link } from '../../../common/utils/RoutingUtils';

interface ScopeBreadcrumbProps {
  scopePath: string[];
}

export const ScopeBreadcrumb = ({ scopePath }: ScopeBreadcrumbProps) => {
  const { theme } = useDesignSystemTheme();

  const segments = [
    { name: 'Scopes', path: '/scopes' },
    ...scopePath.map((name, i) => ({
      name,
      path: `/scopes/${scopePath.slice(0, i + 1).join('/')}`,
    })),
  ];

  return (
    <nav
      aria-label="Scope breadcrumb"
      css={{
        display: 'flex',
        alignItems: 'center',
        gap: theme.spacing.xs,
        padding: `${theme.spacing.sm}px 0`,
        flexWrap: 'wrap',
      }}
    >
      {segments.map((segment, i) => (
        <span key={segment.path} css={{ display: 'flex', alignItems: 'center', gap: theme.spacing.xs }}>
          {i > 0 && <ChevronRightIcon css={{ color: theme.colors.textSecondary, fontSize: 12 }} />}
          {i < segments.length - 1 ? (
            <Link
              componentId={`mlflow.scope-browser.breadcrumb-${i}`}
              to={segment.path}
              css={{
                color: theme.colors.textSecondary,
                '&:hover': { color: theme.colors.actionLinkHover },
              }}
            >
              {segment.name}
            </Link>
          ) : (
            <span css={{ color: theme.colors.textPrimary, fontWeight: theme.typography.typographyBoldFontWeight }}>
              {segment.name}
            </span>
          )}
        </span>
      ))}
    </nav>
  );
};
