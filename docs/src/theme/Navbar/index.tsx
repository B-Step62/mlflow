import React from 'react';
import Link from '@docusaurus/Link';
import { useLocation } from '@docusaurus/router';
import useBaseUrl from '@docusaurus/useBaseUrl';
import OriginalNavbar from '@theme-original/Navbar';
import SearchBar from '@theme/SearchBar';

function isTracingOverview(pathname: string) {
  return pathname.replace(/\/$/, '').endsWith('/genai/tracing');
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
  const { pathname } = useLocation();
  const logoSrc = useBaseUrl('/images/logo-light.svg');
  const OriginalNavbarComponent = OriginalNavbar as React.ComponentType<Record<string, unknown>>;

  if (!isTracingOverview(pathname)) {
    return <OriginalNavbarComponent {...props} />;
  }

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
        <Link className="mintlify-navbar-tab mintlify-navbar-tab-active" href={useBaseUrl('/genai/tracing')}>
          <MaskIcon icon="regular/telescope" />
          <span>Trace / Observe</span>
        </Link>
        <Link className="mintlify-navbar-tab" href={useBaseUrl('/genai/eval-monitor')}>
          <MaskIcon icon="regular/clipboard-check" />
          <span>Evaluation</span>
        </Link>
        <Link className="mintlify-navbar-tab" href={useBaseUrl('/genai/prompt-registry')}>
          <MaskIcon icon="regular/wand-magic-sparkles" />
          <span>Prompt Management</span>
        </Link>
        <Link className="mintlify-navbar-tab" href={useBaseUrl('/genai/governance/ai-gateway')}>
          <MaskIcon icon="regular/gear-complex" />
          <span>AI Gateway</span>
        </Link>
        <Link className="mintlify-navbar-tab" href={useBaseUrl('/genai')}>
          <MaskIcon icon="regular/sparkles" />
          <span>More</span>
        </Link>
        <Link className="mintlify-navbar-tab" href={useBaseUrl('/self-hosting')}>
          <MaskIcon icon="regular/server" />
          <span>Self hosting</span>
        </Link>
      </nav>
    </header>
  );
}
