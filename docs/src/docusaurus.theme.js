const defaultAdmonitionTitles = new Set(['caution', 'danger', 'important', 'info', 'note', 'tip', 'warning']);

function updateMLflowDocsAdmonitions() {
  document
    .querySelectorAll('.mlflow-genai-section .theme-admonition [class*="admonitionHeading"]')
    .forEach((heading) => {
      const title = heading.textContent?.trim().toLowerCase();
      heading.classList.toggle('mlflow-docs-admonition-default-title', defaultAdmonitionTitles.has(title));
    });
}

function scheduleMLflowDocsAdmonitionUpdate() {
  updateMLflowDocsAdmonitions();
  requestAnimationFrame(updateMLflowDocsAdmonitions);
  setTimeout(updateMLflowDocsAdmonitions, 100);
}

export function onRouteDidUpdate({ location }) {
  const { pathname } = location;
  const normalizedPathname = pathname.replace(/\/$/, '');
  const isGenAIPath =
    normalizedPathname === '/genai' || normalizedPathname.endsWith('/genai') || normalizedPathname.includes('/genai/');
  const isSelfHostingPath =
    normalizedPathname === '/self-hosting' ||
    normalizedPathname.endsWith('/self-hosting') ||
    normalizedPathname.includes('/self-hosting/');
  const isMLPath =
    normalizedPathname === '/ml' || normalizedPathname.endsWith('/ml') || normalizedPathname.includes('/ml/');

  document.body.classList.remove('mlflow-ml-section', 'mlflow-genai-section', 'mlflow-tracing-overview-page');
  document.documentElement.removeAttribute('data-mlflow-doc-route');

  if (isGenAIPath || isSelfHostingPath || isMLPath) {
    document.documentElement.setAttribute('data-genai-theme', 'true');
    document.body.classList.add('mlflow-genai-section');
  } else {
    document.documentElement.removeAttribute('data-genai-theme');
  }

  if (normalizedPathname.endsWith('/genai/tracing')) {
    document.body.classList.add('mlflow-tracing-overview-page');
    document.documentElement.setAttribute('data-mlflow-doc-route', 'genai-tracing-overview');
  }

  scheduleMLflowDocsAdmonitionUpdate();
}
