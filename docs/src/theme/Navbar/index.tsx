import React from 'react';
import Link from '@docusaurus/Link';
import { useLocation } from '@docusaurus/router';
import useBaseUrl from '@docusaurus/useBaseUrl';
import OriginalNavbar from '@theme-original/Navbar';
import SearchBar from '@theme/SearchBar';

type DocsFamily = 'genai' | 'classic';
type ProductTab = 'tracing' | 'evaluation' | 'prompt' | 'gateway' | 'selfHosting';
type ContextualProductTab = Exclude<ProductTab, 'selfHosting'>;
interface ProductTabConfig {
  href: string;
  icon: string;
  label: string;
  activePaths?: string[];
}

const contextualProductTabs: ContextualProductTab[] = ['tracing', 'evaluation', 'prompt', 'gateway'];
const contextualProductPaths = new Set(['/genai/demo', '/genai/getting-started/try-assistant']);
const productTabPaths: Record<ProductTab, string> = {
  tracing: '/genai/tracing',
  evaluation: '/genai/eval-monitor',
  prompt: '/genai/prompt-registry',
  gateway: '/genai/governance/ai-gateway',
  selfHosting: '/self-hosting',
};

function normalizePathname(pathname: string) {
  return pathname.replace(/\/$/, '');
}

function getSectionPath(pathname: string, section: string) {
  const sectionPattern = new RegExp(`/${section}(?=/|$)`);
  const match = pathname.match(sectionPattern);

  return match?.index === undefined ? undefined : pathname.slice(match.index);
}

function getProductPath(pathname: string) {
  const normalizedPathname = normalizePathname(pathname);
  const genAIPath = getSectionPath(normalizedPathname, 'genai');
  const selfHostingPath = getSectionPath(normalizedPathname, 'self-hosting');
  const mlPath = getSectionPath(normalizedPathname, 'ml');

  if (genAIPath) {
    return genAIPath;
  }

  if (selfHostingPath) {
    return selfHostingPath;
  }

  if (mlPath) {
    return mlPath;
  }

  return normalizedPathname;
}

function isNewDocsPath(pathname: string) {
  const productPath = getProductPath(pathname);

  return productPath.startsWith('/genai') || productPath.startsWith('/self-hosting') || productPath.startsWith('/ml');
}

function getDocsFamily(pathname: string): DocsFamily {
  return getProductPath(pathname).startsWith('/ml') ? 'classic' : 'genai';
}

function getContextualProductTab(pathname: string, search: string): ContextualProductTab | undefined {
  const currentPath = getProductPath(pathname);

  if (!contextualProductPaths.has(currentPath)) {
    return undefined;
  }

  const section = new URLSearchParams(search).get('section') as ContextualProductTab | null;

  return section && contextualProductTabs.includes(section) ? section : undefined;
}

const fontAwesomeBase = 'https://d3gk2c5xim1je2.cloudfront.net/fontawesome/v7.2.0';

const genAIProductTabs: ProductTabConfig[] = [
  { href: '/genai/tracing', icon: 'regular/telescope', label: 'Trace / Observe' },
  { href: '/genai/eval-monitor', icon: 'regular/clipboard-check', label: 'Evaluation' },
  { href: '/genai/prompt-registry', icon: 'regular/wand-magic-sparkles', label: 'Prompt Management' },
  { href: '/genai/governance/ai-gateway', icon: 'regular/gear-complex', label: 'AI Gateway' },
  { href: '/genai', icon: 'regular/sparkles', label: 'More' },
  { href: '/self-hosting', icon: 'regular/server', label: 'Self hosting' },
];

const classicMLProductTabs: ProductTabConfig[] = [
  { href: '/ml', icon: 'regular/chart-simple', label: 'Overview' },
  { href: '/ml/getting-started', icon: 'regular/rocket', label: 'Get Started' },
  { href: '/ml/tracking', icon: 'regular/chart-line', label: 'Tracking', activePaths: ['/ml/search'] },
  {
    href: '/ml/model',
    icon: 'regular/cube',
    label: 'Models',
    activePaths: ['/ml/traditional-ml', '/ml/deep-learning', '/ml/community-model-flavors', '/ml/dataset'],
  },
  { href: '/ml/evaluation', icon: 'regular/clipboard-check', label: 'Evaluation' },
  {
    href: '/ml/deployment',
    icon: 'regular/cloud-arrow-up',
    label: 'Deployment',
    activePaths: ['/ml/model-registry', '/ml/docker'],
  },
  {
    href: '/ml/tutorials-and-examples',
    icon: 'regular/ellipsis',
    label: 'More',
    activePaths: ['/ml/projects', '/ml/plugins', '/ml/mlflow-3'],
  },
];

function MaskIcon({ icon }: { icon: string }): React.ReactNode {
  const iconUrl = `${fontAwesomeBase}/${icon}.svg`;
  return (
    <span
      aria-hidden="true"
      className="mlflow-docs-mask-icon"
      style={{
        WebkitMaskImage: `url(${iconUrl})`,
        WebkitMaskPosition: 'center',
        WebkitMaskRepeat: 'no-repeat',
        maskImage: `url(${iconUrl})`,
        maskPosition: 'center',
        maskRepeat: 'no-repeat',
      }}
    />
  );
}

export default function Navbar(props: Record<string, unknown>): React.ReactNode {
  const { pathname, search } = useLocation();
  const currentPath = getProductPath(pathname);
  const docsFamily = getDocsFamily(pathname);
  const contextualProductTab = getContextualProductTab(pathname, search);
  const logoSrc = useBaseUrl('/images/logo-light.svg');
  const OriginalNavbarComponent = OriginalNavbar as React.ComponentType<Record<string, unknown>>;

  if (!isNewDocsPath(pathname)) {
    return <OriginalNavbarComponent {...props} />;
  }

  const isTabActive = (href: string, activePaths: string[] = []) => {
    const normalizedHref = normalizePathname(href);

    if (contextualProductTab) {
      return productTabPaths[contextualProductTab] === normalizedHref;
    }

    if (normalizedHref === '/genai') {
      return (
        currentPath === '/genai' ||
        (currentPath.startsWith('/genai/') &&
          !currentPath.startsWith('/genai/tracing') &&
          !currentPath.startsWith('/genai/eval-monitor') &&
          !currentPath.startsWith('/genai/prompt-registry') &&
          !currentPath.startsWith('/genai/governance/ai-gateway'))
      );
    }

    if (normalizedHref === '/ml') {
      return currentPath === '/ml';
    }

    return (
      currentPath === normalizedHref ||
      currentPath.startsWith(`${normalizedHref}/`) ||
      activePaths.some((activePath) => currentPath === activePath || currentPath.startsWith(`${activePath}/`))
    );
  };

  const getTabClassName = (href: string, activePaths: string[] = []) =>
    isTabActive(href, activePaths) ? 'mlflow-docs-navbar-tab mlflow-docs-navbar-tab-active' : 'mlflow-docs-navbar-tab';
  const getFamilyClassName = (family: DocsFamily) =>
    docsFamily === family ? 'mlflow-docs-family-option mlflow-docs-family-option-active' : 'mlflow-docs-family-option';
  const productTabs = docsFamily === 'classic' ? classicMLProductTabs : genAIProductTabs;

  return (
    <header className="navbar mlflow-docs-navbar">
      <div className="mlflow-docs-navbar-primary">
        <div className="mlflow-docs-navbar-brand-group">
          <Link className="mlflow-docs-navbar-logo" href={useBaseUrl('/')}>
            <span className="sr-only">MLflow Docs home page</span>
            <img src={logoSrc} alt="MLflow Docs" />
          </Link>

          <nav className="mlflow-docs-family-switcher" aria-label="Documentation family">
            <Link className={getFamilyClassName('genai')} href={useBaseUrl('/genai/tracing')}>
              GenAI
            </Link>
            <Link className={getFamilyClassName('classic')} href={useBaseUrl('/ml')}>
              Classical ML
            </Link>
          </nav>
        </div>

        <div className="mlflow-docs-navbar-search">
          <SearchBar />
        </div>

        <nav className="mlflow-docs-navbar-links" aria-label="Main">
          <Link href={useBaseUrl('/community')}>
            <MaskIcon icon="regular/users" />
            <span>Community</span>
          </Link>
          <a href="https://github.com/mlflow/mlflow" target="_blank" rel="noreferrer">
            <MaskIcon icon="brands/github" />
            <span>GitHub</span>
          </a>
          <a href="https://mlflow.org/slack" target="_blank" rel="noreferrer">
            <MaskIcon icon="brands/slack" />
            <span>Slack</span>
          </a>
        </nav>
      </div>

      <nav className="mlflow-docs-navbar-tabs" aria-label="Product">
        {productTabs.map((tab) => (
          <Link key={tab.href} className={getTabClassName(tab.href, tab.activePaths)} href={useBaseUrl(tab.href)}>
            <MaskIcon icon={tab.icon} />
            <span>{tab.label}</span>
          </Link>
        ))}
      </nav>
    </header>
  );
}
