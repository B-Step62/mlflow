import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation } from '@docusaurus/router';
import Link from '@docusaurus/Link';
import OriginalTOC from '@theme-original/TOC';
import clsx from 'clsx';
import { ArrowUp } from 'lucide-react';
import type { TOCItem } from '@docusaurus/mdx-loader';
import type { Props } from '@theme/TOC';

function normalizePathname(pathname: string) {
  return pathname.replace(/\/$/, '');
}

function isTracingOverview(pathname: string) {
  return normalizePathname(pathname).endsWith('/genai/tracing');
}

function isGenAIPath(pathname: string) {
  const normalizedPathname = normalizePathname(pathname);

  return (
    normalizedPathname === '/genai' || normalizedPathname.endsWith('/genai') || normalizedPathname.includes('/genai/')
  );
}

function isDesktopDocToc(className?: string) {
  return className?.split(/\s+/).includes('theme-doc-toc-desktop') ?? false;
}

const tracingIntroTocItems: TOCItem[] = [
  { value: 'Public Demo', id: 'public-demo', level: 2 },
  { value: 'Starting from UI', id: 'starting-from-ui', level: 2 },
  { value: 'Starting from CLI', id: 'starting-from-cli', level: 2 },
];

const tracingUseCaseChild: TOCItem = {
  value: 'Debug Issues in Your IDE or Notebook',
  id: 'debug-issues-in-your-ide-or-notebook',
  level: 3,
};

const tracingOverviewInjectedIds = new Set([
  ...tracingIntroTocItems.map((item) => item.id),
  tracingUseCaseChild.id,
  'track-annotation-and-human-feedback',
  'evaluate-and-enhance-quality',
  'monitor-applications-in-production',
  'create-a-high-quality-dataset-from-real-world-traffic',
]);

function getTracingOverviewToc(toc: readonly TOCItem[]) {
  const normalizedToc = toc.filter((item) => !tracingOverviewInjectedIds.has(item.id));

  return [
    ...tracingIntroTocItems,
    ...normalizedToc.flatMap((item) =>
      item.id === 'llm-and-agent-tracing-use-cases' ? [item, tracingUseCaseChild] : [item],
    ),
  ];
}

function getVisibleHeading(id: string) {
  const element = document.getElementById(id);

  if (!element || element.getClientRects().length === 0) {
    return undefined;
  }

  return element;
}

function getMintlifyToc(toc: readonly TOCItem[], tracingOverview: boolean) {
  return tracingOverview ? getTracingOverviewToc(toc) : toc;
}

function MintlifyTOC({
  toc,
  className,
  minHeadingLevel = 2,
  maxHeadingLevel = 3,
  tracingOverview = false,
}: Props & { tracingOverview?: boolean }): React.ReactNode {
  const tocItems = useMemo(
    () =>
      getMintlifyToc(toc, tracingOverview).filter(
        (item) => item.level >= minHeadingLevel && item.level <= maxHeadingLevel,
      ),
    [maxHeadingLevel, minHeadingLevel, toc, tracingOverview],
  );
  const [activeId, setActiveId] = useState<string>();
  const [showScrollTop, setShowScrollTop] = useState(false);

  const updateActiveItem = useCallback(() => {
    let nextActiveId: string | undefined;
    const activationY = 170;

    for (const item of tocItems) {
      const heading = getVisibleHeading(item.id);
      if (!heading) {
        continue;
      }

      if (heading.getBoundingClientRect().top <= activationY) {
        nextActiveId = item.id;
      }
    }

    setActiveId(nextActiveId);
    setShowScrollTop(
      window.scrollY > 520 || Boolean(nextActiveId && tocItems.findIndex((item) => item.id === nextActiveId) > 0),
    );
  }, [tocItems]);

  useEffect(() => {
    updateActiveItem();
    window.addEventListener('scroll', updateActiveItem, { passive: true });
    window.addEventListener('resize', updateActiveItem);

    return () => {
      window.removeEventListener('scroll', updateActiveItem);
      window.removeEventListener('resize', updateActiveItem);
    };
  }, [updateActiveItem]);

  const handleItemClick = useCallback((event: React.MouseEvent<HTMLAnchorElement>, id: string) => {
    const heading = getVisibleHeading(id);
    if (!heading) {
      return;
    }

    event.preventDefault();
    heading.scrollIntoView({ behavior: 'smooth', block: 'start' });
    window.history.pushState(null, '', `#${id}`);
    setActiveId(id);
  }, []);

  const handleScrollToTop = useCallback(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  return (
    <nav className={clsx('mintlify-page-toc', className)} aria-label="On this page">
      <div className="mintlify-page-toc-title">On this page</div>
      <div className="mintlify-page-toc-body">
        <ul className="table-of-contents mintlify-page-toc-list">
          {tocItems.map((item) => {
            const isActive = item.id === activeId;

            return (
              <li key={item.id} className={`mintlify-page-toc-item mintlify-page-toc-item-level-${item.level}`}>
                <Link
                  to={`#${item.id}`}
                  className={clsx(
                    'table-of-contents__link toc-highlight',
                    isActive && 'table-of-contents__link--active',
                  )}
                  onClick={(event) => handleItemClick(event, item.id)}
                  dangerouslySetInnerHTML={{ __html: item.value }}
                />
              </li>
            );
          })}
        </ul>
      </div>
      <button
        className={clsx('mintlify-page-toc-scroll-top', showScrollTop && 'mintlify-page-toc-scroll-top-visible')}
        type="button"
        onClick={handleScrollToTop}
        aria-hidden={!showScrollTop}
        tabIndex={showScrollTop ? 0 : -1}
      >
        <span>Scroll to top</span>
        <ArrowUp size={18} strokeWidth={2} aria-hidden="true" />
      </button>
    </nav>
  );
}

export default function TOC({ toc, className, ...props }: Props): React.ReactNode {
  const { pathname } = useLocation();

  if (isGenAIPath(pathname) && isDesktopDocToc(className)) {
    return <MintlifyTOC {...props} toc={toc} className={className} tracingOverview={isTracingOverview(pathname)} />;
  }

  return <OriginalTOC {...props} toc={toc} className={className} />;
}
