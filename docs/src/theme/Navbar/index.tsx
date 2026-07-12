import React from 'react';
import Link from '@docusaurus/Link';
import { useLocation } from '@docusaurus/router';
import useBaseUrl from '@docusaurus/useBaseUrl';
import OriginalNavbar from '@theme-original/Navbar';
import { Search } from 'lucide-react';
import type { Props } from '@theme/Navbar';

function isTracingOverview(pathname: string) {
  return pathname.replace(/\/$/, '').endsWith('/genai/tracing');
}

const fontAwesomeBase = 'https://d3gk2c5xim1je2.cloudfront.net/fontawesome/v7.2.0';

function MaskIcon({ icon }: { icon: string }): JSX.Element {
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

function ThemeIcon(): JSX.Element {
  return (
    <svg aria-hidden="true" focusable="false" width="16" height="16" viewBox="0 0 16 16" fill="none">
      <g clipPath="url(#mintlify-theme-icon-clip)">
        <path
          d="M5.11133 14.4444C5.78511 14.232 6.78066 14 8.00022 14C8.70688 14 9.72555 14.0782 10.8891 14.4444"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M8 11.7778V14.0001"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M12.6668 2.44434H3.33344C2.3516 2.44434 1.55566 3.24027 1.55566 4.22211V9.99989C1.55566 10.9817 2.3516 11.7777 3.33344 11.7777H12.6668C13.6486 11.7777 14.4446 10.9817 14.4446 9.99989V4.22211C14.4446 3.24027 13.6486 2.44434 12.6668 2.44434Z"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </g>
      <defs>
        <clipPath id="mintlify-theme-icon-clip">
          <rect width="16" height="16" fill="white" />
        </clipPath>
      </defs>
    </svg>
  );
}

export default function Navbar(props: Props): JSX.Element {
  const { pathname } = useLocation();
  const logoSrc = useBaseUrl('/images/logo-light.svg');

  if (!isTracingOverview(pathname)) {
    return <OriginalNavbar {...props} />;
  }

  return (
    <header className="navbar mintlify-navbar">
      <div className="mintlify-navbar-primary">
        <Link className="mintlify-navbar-logo" href={useBaseUrl('/')}>
          <span className="sr-only">MLflow Docs home page</span>
          <img src={logoSrc} alt="MLflow Docs" />
        </Link>

        <button className="mintlify-navbar-search" type="button" aria-label="Open search">
          <span className="mintlify-navbar-search-left">
            <Search size={16} />
            <span>Search...</span>
          </span>
          <span className="mintlify-navbar-shortcut">⌘K</span>
        </button>

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
          <button className="mintlify-navbar-theme" type="button" aria-label="Change theme preference">
            <ThemeIcon />
          </button>
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
