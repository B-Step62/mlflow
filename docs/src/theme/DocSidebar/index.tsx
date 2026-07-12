import React from 'react';
import Link from '@docusaurus/Link';
import { useLocation } from '@docusaurus/router';
import useBaseUrl from '@docusaurus/useBaseUrl';
import OriginalDocSidebar from '@theme-original/DocSidebar';
import type { Props } from '@theme/DocSidebar';

function isTracingOverview(pathname: string) {
  return pathname.replace(/\/$/, '').endsWith('/genai/tracing');
}

const fontAwesomeBase = 'https://d3gk2c5xim1je2.cloudfront.net/fontawesome/v7.2.0';

function SidebarMaskIcon({ icon }: { icon: string }) {
  const iconUrl = `${fontAwesomeBase}/${icon}.svg`;
  return (
    <span
      aria-hidden="true"
      className="mintlify-sidebar-mask-icon"
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

function SidebarChevron() {
  return (
    <svg width="8" height="24" viewBox="0 -9 3 24" aria-hidden="true" focusable="false">
      <path d="M0 0L3 3L0 6" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function SidebarLink({
  href,
  label,
  active = false,
  icon,
}: {
  href: string;
  label: string;
  active?: boolean;
  icon?: React.ReactNode;
}) {
  return (
    <li className="mintlify-sidebar-item">
      <Link className={active ? 'mintlify-sidebar-link mintlify-sidebar-link-active' : 'mintlify-sidebar-link'} href={href}>
        {icon && <span className="mintlify-sidebar-icon">{icon}</span>}
        <span>{label}</span>
      </Link>
    </li>
  );
}

function SidebarButton({ label }: { label: string }) {
  return (
    <li className="mintlify-sidebar-item">
      <button className="mintlify-sidebar-link mintlify-sidebar-button" type="button" aria-expanded="false">
        <span>{label}</span>
        <SidebarChevron />
      </button>
    </li>
  );
}

function SidebarGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mintlify-sidebar-group">
      <h3>{title}</h3>
      <ul>{children}</ul>
    </div>
  );
}

function MintlifyTracingSidebar() {
  return (
    <nav className="mintlify-doc-sidebar" aria-label="Pages">
      <div className="mintlify-doc-sidebar-fade" />
      <div className="mintlify-doc-sidebar-content">
        <SidebarGroup title="Overview">
          <SidebarLink href={useBaseUrl('/genai/tracing')} label="What's Tracing?" active />
          <SidebarLink href={useBaseUrl('/genai/tracing/quickstart')} label="Quickstart" />
          <SidebarLink href={useBaseUrl('/genai/demo')} label="Try Live Demo" icon={<SidebarMaskIcon icon="regular/play" />} />
          <SidebarLink
            href={useBaseUrl('/genai/getting-started/try-assistant')}
            label="MLflow Assistant"
            icon={<SidebarMaskIcon icon="regular/sparkles" />}
          />
        </SidebarGroup>

        <SidebarGroup title="Guides">
          <SidebarButton label="Trace your app and agents" />
          <SidebarButton label="View and manage traces" />
          <SidebarButton label="Enhance your traces" />
          <SidebarButton label="Deploy to production" />
        </SidebarGroup>

        <SidebarGroup title="OpenTelemetry">
          <SidebarLink href={useBaseUrl('/genai/tracing/opentelemetry')} label="Opentelemetry" />
          <SidebarLink href={useBaseUrl('/genai/tracing/opentelemetry/ingest')} label="Ingest traces" />
          <SidebarLink href={useBaseUrl('/genai/tracing/opentelemetry/export')} label="Export traces" />
          <SidebarLink
            href={useBaseUrl('/genai/tracing/opentelemetry/genai-semconv')}
            label="GenAI semantic conventions"
          />
          <SidebarLink href={useBaseUrl('/genai/tracing/opentelemetry/attribute-mapping')} label="Attribute mapping" />
        </SidebarGroup>

        <SidebarGroup title="FAQ">
          <SidebarLink href={useBaseUrl('/genai/tracing/faq')} label="Tracing FAQ" />
        </SidebarGroup>
      </div>
    </nav>
  );
}

export default function DocSidebar(props: Props): React.ReactNode {
  const { pathname } = useLocation();

  if (!isTracingOverview(pathname)) {
    return <OriginalDocSidebar {...props} />;
  }

  return <MintlifyTracingSidebar />;
}
