import React from 'react';
import Link from '@docusaurus/Link';
import { useLocation } from '@docusaurus/router';
import useBaseUrl from '@docusaurus/useBaseUrl';
import OriginalNavbar from '@theme-original/Navbar';
import SearchBar from '@theme/SearchBar';

type ProductTab = 'tracing' | 'evaluation' | 'prompt' | 'gateway' | 'selfHosting';
type ContextualProductTab = Exclude<ProductTab, 'selfHosting'>;

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

function getProductPath(pathname: string) {
  const normalizedPathname = normalizePathname(pathname);
  const genAIIndex = normalizedPathname.indexOf('/genai');
  const selfHostingIndex = normalizedPathname.indexOf('/self-hosting');

  if (genAIIndex >= 0) {
    return normalizedPathname.slice(genAIIndex);
  }

  if (selfHostingIndex >= 0) {
    return normalizedPathname.slice(selfHostingIndex);
  }

  return normalizedPathname;
}

function isNewDocsPath(pathname: string) {
  const productPath = getProductPath(pathname);

  return productPath.startsWith('/genai') || productPath.startsWith('/self-hosting');
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

function MaskIcon({ icon }: { icon: string }): React.ReactNode {
  const iconUrl = `${fontAwesomeBase}/${icon}.svg`;
  return (
    <span
      aria-hidden="true"
      className="mintlify-mask-icon"
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
  const contextualProductTab = getContextualProductTab(pathname, search);
  const logoSrc = useBaseUrl('/images/logo-light.svg');
  const OriginalNavbarComponent = OriginalNavbar as React.ComponentType<Record<string, unknown>>;

  if (!isNewDocsPath(pathname)) {
    return <OriginalNavbarComponent {...props} />;
  }

  const isTabActive = (href: string) => {
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

    return currentPath === normalizedHref || currentPath.startsWith(`${normalizedHref}/`);
  };

  const getTabClassName = (href: string) =>
    isTabActive(href) ? 'mintlify-navbar-tab mintlify-navbar-tab-active' : 'mintlify-navbar-tab';

  return (
    <header className="navbar mintlify-navbar">
      <div className="mintlify-navbar-primary">
        <Link className="mintlify-navbar-logo" href={useBaseUrl('/')}>
          <span className="sr-only">MLflow Docs home page</span>
          <img src={logoSrc} alt="MLflow Docs" />
        </Link>

        <div className="mintlify-navbar-search">
          <SearchBar />
        </div>

        <nav className="mintlify-navbar-links" aria-label="Main">
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

      <nav className="mintlify-navbar-tabs" aria-label="Product">
        <Link className={getTabClassName('/genai/tracing')} href={useBaseUrl('/genai/tracing')}>
          <MaskIcon icon="regular/telescope" />
          <span>Trace / Observe</span>
        </Link>
        <Link className={getTabClassName('/genai/eval-monitor')} href={useBaseUrl('/genai/eval-monitor')}>
          <MaskIcon icon="regular/clipboard-check" />
          <span>Evaluation</span>
        </Link>
        <Link className={getTabClassName('/genai/prompt-registry')} href={useBaseUrl('/genai/prompt-registry')}>
          <MaskIcon icon="regular/wand-magic-sparkles" />
          <span>Prompt Management</span>
        </Link>
        <Link
          className={getTabClassName('/genai/governance/ai-gateway')}
          href={useBaseUrl('/genai/governance/ai-gateway')}
        >
          <MaskIcon icon="regular/gear-complex" />
          <span>AI Gateway</span>
        </Link>
        <Link className={getTabClassName('/genai')} href={useBaseUrl('/genai')}>
          <MaskIcon icon="regular/sparkles" />
          <span>More</span>
        </Link>
        <Link className={getTabClassName('/self-hosting')} href={useBaseUrl('/self-hosting')}>
          <MaskIcon icon="regular/server" />
          <span>Self hosting</span>
        </Link>
      </nav>
    </header>
  );
}
