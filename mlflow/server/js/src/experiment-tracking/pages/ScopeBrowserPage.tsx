import { useState } from 'react';
import {
  Typography,
  useDesignSystemTheme,
  FolderIcon,
  FolderOpenIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  StarFillIcon,
  ClockIcon,
  SearchIcon,
  Button,
  Input,
} from '@databricks/design-system';
import { useParams } from '../../common/utils/RoutingUtils';
import { Link } from '../../common/utils/RoutingUtils';
import { ScopeBreadcrumb } from '../components/scope-browser/ScopeBreadcrumb';
import { ScopeResourceView } from '../components/scope-browser/ScopeResourceView';
import { ScopeSearchPanel } from '../components/scope-browser/ScopeSearchPanel';
import {
  findScopeByPath,
  findScopeById,
  MOCK_SCOPES,
  MOCK_FAVORITES,
  MOCK_RECENTS,
  countResourcesInScope,
  getScopePath,
} from '../components/scope-browser/mockScopeData';
import type { MockScope } from '../components/scope-browser/mockScopeData';

// Horizontal folder bar: shows child scopes of the current scope as clickable chips
const ScopeFolderBar = ({ scope }: { scope: MockScope | null }) => {
  const { theme } = useDesignSystemTheme();
  const children = scope ? scope.children : MOCK_SCOPES;

  if (children.length === 0) return null;

  return (
    <div
      css={{
        display: 'flex',
        alignItems: 'center',
        gap: theme.spacing.sm,
        flexWrap: 'wrap',
      }}
    >
      <Typography.Text size="sm" color="secondary" css={{ flexShrink: 0 }}>
        Sub-scopes:
      </Typography.Text>
      {children.map((child) => {
        const path = getScopePath(child.id);
        const count = countResourcesInScope(child.id);
        return (
          <Link
            key={child.id}
            componentId={`mlflow.scope-browser.folder-chip-${child.id}`}
            to={`/scopes/${path.join('/')}`}
            css={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: theme.spacing.xs,
              padding: `${theme.spacing.xs}px ${theme.spacing.sm}px`,
              border: `1px solid ${theme.colors.borderDecorative}`,
              borderRadius: theme.borders.borderRadiusMd,
              color: theme.colors.textPrimary,
              fontSize: theme.typography.fontSizeSm,
              '&:hover': {
                borderColor: theme.colors.actionDefaultBorderHover,
                backgroundColor: theme.colors.actionDefaultBackgroundHover,
                color: theme.colors.actionLinkHover,
              },
            }}
          >
            <FolderIcon css={{ fontSize: 14 }} />
            {child.name}
            {child.children.length > 0 && (
              <ChevronRightIcon css={{ fontSize: 10, color: theme.colors.textSecondary }} />
            )}
            {count > 0 && (
              <Typography.Text size="sm" color="secondary" css={{ fontSize: 11 }}>
                ({count})
              </Typography.Text>
            )}
          </Link>
        );
      })}
    </div>
  );
};

// Favorites + Recents as a horizontal pill bar
const QuickAccessBar = () => {
  const { theme } = useDesignSystemTheme();
  const [showRecents, setShowRecents] = useState(false);

  const items = showRecents ? MOCK_RECENTS : MOCK_FAVORITES;

  return (
    <div css={{ display: 'flex', alignItems: 'center', gap: theme.spacing.sm, flexWrap: 'wrap' }}>
      <div css={{ display: 'flex', gap: theme.spacing.xs, flexShrink: 0 }}>
        <Button
          componentId="mlflow.scope-browser.quick-favorites"
          type={!showRecents ? 'primary' : 'tertiary'}
          size="small"
          icon={<StarFillIcon css={{ fontSize: 12 }} />}
          onClick={() => setShowRecents(false)}
        >
          Favorites
        </Button>
        <Button
          componentId="mlflow.scope-browser.quick-recents"
          type={showRecents ? 'primary' : 'tertiary'}
          size="small"
          icon={<ClockIcon css={{ fontSize: 12 }} />}
          onClick={() => setShowRecents(true)}
        >
          Recent
        </Button>
      </div>
      {items.map((scopeId) => {
        const scope = findScopeById(scopeId);
        if (!scope) return null;
        const path = getScopePath(scopeId);
        return (
          <Link
            key={scopeId}
            componentId={`mlflow.scope-browser.quick-${scopeId}`}
            to={`/scopes/${path.join('/')}`}
            css={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: theme.spacing.xs,
              padding: `${theme.spacing.xs}px ${theme.spacing.sm}px`,
              borderRadius: theme.borders.borderRadiusSm,
              color: theme.colors.textSecondary,
              fontSize: theme.typography.fontSizeSm,
              '&:hover': {
                backgroundColor: theme.colors.actionDefaultBackgroundHover,
                color: theme.colors.actionLinkHover,
              },
            }}
          >
            <FolderIcon css={{ fontSize: 12 }} />
            <span>{scope.name}</span>
            {path.length > 1 && (
              <Typography.Text color="secondary" css={{ fontSize: 10 }}>
                ({path.slice(0, -1).join('/')})
              </Typography.Text>
            )}
          </Link>
        );
      })}
    </div>
  );
};

// Scope card for root grid view
const ScopeCard = ({ scope }: { scope: MockScope }) => {
  const { theme } = useDesignSystemTheme();
  const path = getScopePath(scope.id);
  const resourceCount = countResourcesInScope(scope.id);

  return (
    <Link
      componentId={`mlflow.scope-browser.scope-card-${scope.id}`}
      to={`/scopes/${path.join('/')}`}
      css={{
        display: 'flex',
        flexDirection: 'column',
        gap: theme.spacing.sm,
        padding: theme.spacing.lg,
        border: `1px solid ${theme.colors.borderDecorative}`,
        borderRadius: theme.borders.borderRadiusMd,
        color: theme.colors.textPrimary,
        textDecoration: 'none',
        '&:hover': {
          borderColor: theme.colors.actionDefaultBorderHover,
          backgroundColor: theme.colors.actionDefaultBackgroundHover,
        },
      }}
    >
      <div css={{ display: 'flex', alignItems: 'center', gap: theme.spacing.sm }}>
        <FolderIcon css={{ fontSize: 20, color: theme.colors.textSecondary }} />
        <Typography.Title level={4} css={{ margin: 0 }}>
          {scope.name}
        </Typography.Title>
      </div>
      {scope.description && (
        <Typography.Text color="secondary" size="sm">
          {scope.description}
        </Typography.Text>
      )}
      <div css={{ display: 'flex', gap: theme.spacing.md }}>
        <Typography.Text size="sm" color="secondary">
          {scope.children.length} sub-scope{scope.children.length !== 1 ? 's' : ''}
        </Typography.Text>
        <Typography.Text size="sm" color="secondary">
          {resourceCount} resource{resourceCount !== 1 ? 's' : ''}
        </Typography.Text>
      </div>
    </Link>
  );
};

// Root view: grid of top-level scopes + quick access
const ScopeRootView = () => {
  const { theme } = useDesignSystemTheme();

  return (
    <div css={{ padding: theme.spacing.lg, display: 'flex', flexDirection: 'column', gap: theme.spacing.lg }}>
      <div css={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <Typography.Title level={2} css={{ margin: 0 }}>
            Scopes
          </Typography.Title>
          <Typography.Text color="secondary">
            Browse your hierarchical scope tree to find experiments, traces, and datasets.
          </Typography.Text>
        </div>
        <Link
          componentId="mlflow.scope-browser.search-link"
          to="/scopes/search"
          css={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: theme.spacing.xs,
            color: theme.colors.textSecondary,
            '&:hover': { color: theme.colors.actionLinkHover },
          }}
        >
          <SearchIcon css={{ fontSize: 14 }} />
          Search all
        </Link>
      </div>

      <QuickAccessBar />

      <div
        css={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
          gap: theme.spacing.md,
        }}
      >
        {MOCK_SCOPES.map((scope) => (
          <ScopeCard key={scope.id} scope={scope} />
        ))}
      </div>
    </div>
  );
};

const SCOPE_TAB_NAMES = new Set(['traces', 'runs', 'datasets', 'judges', 'prompts', 'models', 'evaluation-runs']);

export const ScopeBrowserPage = () => {
  const { theme } = useDesignSystemTheme();
  const params = useParams();
  const wildcardPath = params['*'] ?? '';
  const pathSegments = wildcardPath.split('/').filter(Boolean);

  // Handle search route
  if (pathSegments[0] === 'search') {
    return <ScopeSearchPanel />;
  }

  // Root view: no path segments
  if (pathSegments.length === 0) {
    return <ScopeRootView />;
  }

  // Separate scope path from optional tab suffix
  const lastSegment = pathSegments[pathSegments.length - 1];
  const hasTab = SCOPE_TAB_NAMES.has(lastSegment);
  const scopeSegments = hasTab ? pathSegments.slice(0, -1) : pathSegments;
  const activeTab = hasTab
    ? (lastSegment as import('../components/scope-browser/ScopeSidebarItems').ScopeTabName)
    : undefined;

  // Resolve scope from path
  const scope = findScopeByPath(scopeSegments);

  if (!scope) {
    return (
      <div css={{ padding: theme.spacing.lg }}>
        <Typography.Title level={3}>Scope not found</Typography.Title>
        <Typography.Text color="secondary">
          The scope path <code>{scopeSegments.join(' / ')}</code> does not exist.
        </Typography.Text>
      </div>
    );
  }

  return (
    <div css={{ padding: theme.spacing.lg, display: 'flex', flexDirection: 'column', gap: theme.spacing.md }}>
      <ScopeBreadcrumb scopePath={scopeSegments} />
      <ScopeFolderBar scope={scope} />
      <ScopeResourceView scope={scope} activeTab={activeTab} />
    </div>
  );
};

export default ScopeBrowserPage;
