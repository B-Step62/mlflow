import React, { useState } from 'react';
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

interface SidebarChildLink {
  href: string;
  label: string;
}

function SidebarChevron({ expanded = false }: { expanded?: boolean }) {
  return (
    <svg
      className={expanded ? 'mintlify-sidebar-chevron-expanded' : undefined}
      width="8"
      height="24"
      viewBox="0 -9 3 24"
      aria-hidden="true"
      focusable="false"
    >
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
      <Link
        className={active ? 'mintlify-sidebar-link mintlify-sidebar-link-active' : 'mintlify-sidebar-link'}
        href={href}
      >
        {icon && <span className="mintlify-sidebar-icon">{icon}</span>}
        <span>{label}</span>
      </Link>
    </li>
  );
}

function SidebarDisclosure({
  label,
  links,
  highlightFirst = false,
}: {
  label: string;
  links: SidebarChildLink[];
  highlightFirst?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <li className="mintlify-sidebar-item">
      <button
        className="mintlify-sidebar-link mintlify-sidebar-button"
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded((current) => !current)}
      >
        <span>{label}</span>
        <SidebarChevron expanded={expanded} />
      </button>
      {expanded && (
        <ul className="mintlify-sidebar-nested-list">
          {links.map((link, index) => (
            <SidebarLink key={link.href} href={link.href} label={link.label} active={highlightFirst && index === 0} />
          ))}
        </ul>
      )}
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
  const handleWheel = (event: React.WheelEvent<HTMLElement>) => {
    const sidebar = event.currentTarget;
    const canScroll = sidebar.scrollHeight > sidebar.clientHeight;
    if (!canScroll) {
      return;
    }

    const atTop = sidebar.scrollTop <= 0;
    const atBottom = Math.ceil(sidebar.scrollTop + sidebar.clientHeight) >= sidebar.scrollHeight;
    if ((event.deltaY < 0 && atTop) || (event.deltaY > 0 && atBottom)) {
      event.preventDefault();
    }
  };

  const traceAppLinks = [
    { href: useBaseUrl('/genai/tracing/app-instrumentation/automatic'), label: 'Automatic tracing' },
    { href: useBaseUrl('/genai/tracing/app-instrumentation/manual-tracing'), label: 'Manual tracing' },
    { href: useBaseUrl('/genai/tracing/app-instrumentation/opentelemetry'), label: 'Tracing with OpenTelemetry' },
    { href: useBaseUrl('/genai/tracing/app-instrumentation/distributed-tracing'), label: 'Distributed tracing' },
  ];
  const viewTraceLinks = [
    { href: useBaseUrl('/genai/tracing/observe-with-traces/dashboard'), label: 'Dashboard (Overview)' },
    { href: useBaseUrl('/genai/tracing/observe-with-traces/ui'), label: 'View Traces' },
    { href: useBaseUrl('/genai/tracing/search-traces'), label: 'Search Traces' },
    { href: useBaseUrl('/genai/tracing/observe-with-traces/archive-traces'), label: 'Archive Traces' },
    { href: useBaseUrl('/genai/tracing/observe-with-traces/delete-traces'), label: 'Delete Traces' },
    { href: useBaseUrl('/genai/tracing/observe-with-traces/multimodal'), label: 'Multimodal Content & Attachments' },
  ];
  const enhanceTraceLinks = [
    { href: useBaseUrl('/genai/tracing/token-usage-cost'), label: 'Token Usage and Cost' },
    { href: useBaseUrl('/genai/tracing/track-users-sessions'), label: 'Track Users and Sessions' },
    { href: useBaseUrl('/genai/tracing/attach-tags'), label: 'Tag Traces' },
    { href: useBaseUrl('/genai/tracing/collect-user-feedback'), label: 'Collect User Feedback' },
    { href: useBaseUrl('/genai/tracing/observe-with-traces/masking'), label: 'Redact Sensitive Data' },
    { href: useBaseUrl('/genai/tracing/app-instrumentation/logging'), label: 'Setting Log Levels' },
    { href: useBaseUrl('/genai/tracing/track-environments-context'), label: 'Track Application Versions' },
  ];
  const productionLinks = [
    { href: useBaseUrl('/genai/tracing/prod-tracing'), label: 'Production Monitoring' },
    { href: useBaseUrl('/genai/tracing/lightweight-sdk'), label: 'Production Tracing SDK' },
  ];

  return (
    <nav className="mintlify-doc-sidebar" aria-label="Pages" onWheel={handleWheel}>
      <div className="mintlify-doc-sidebar-fade" />
      <div className="mintlify-doc-sidebar-content">
        <SidebarGroup title="Overview">
          <SidebarLink href={useBaseUrl('/genai/tracing')} label="What's Tracing?" active />
          <SidebarLink href={useBaseUrl('/genai/tracing/quickstart')} label="Quickstart" />
          <SidebarLink
            href={useBaseUrl('/genai/demo')}
            label="Try Live Demo"
            icon={<SidebarMaskIcon icon="regular/play" />}
          />
          <SidebarLink
            href={useBaseUrl('/genai/getting-started/try-assistant')}
            label="MLflow Assistant"
            icon={<SidebarMaskIcon icon="regular/sparkles" />}
          />
        </SidebarGroup>

        <SidebarGroup title="Guides">
          <SidebarDisclosure label="Trace your app and agents" links={traceAppLinks} highlightFirst />
          <SidebarDisclosure label="View and manage traces" links={viewTraceLinks} />
          <SidebarDisclosure label="Enhance your traces" links={enhanceTraceLinks} />
          <SidebarDisclosure label="Deploy to production" links={productionLinks} />
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
