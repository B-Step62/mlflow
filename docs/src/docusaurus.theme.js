const defaultAdmonitionTitles = new Set(['caution', 'danger', 'important', 'info', 'note', 'tip', 'warning']);

function updateMintlifyAdmonitions() {
  document
    .querySelectorAll('.mlflow-genai-section .theme-admonition [class*="admonitionHeading"]')
    .forEach((heading) => {
      const title = heading.textContent?.trim().toLowerCase();
      heading.classList.toggle('mintlify-admonition-default-title', defaultAdmonitionTitles.has(title));
    });
}

function scheduleMintlifyAdmonitionUpdate() {
  updateMintlifyAdmonitions();
  requestAnimationFrame(updateMintlifyAdmonitions);
  setTimeout(updateMintlifyAdmonitions, 100);
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

  if (isGenAIPath || isSelfHostingPath) {
    document.documentElement.setAttribute('data-genai-theme', 'true');
    document.body.classList.add('mlflow-genai-section');
  } else if (isMLPath) {
    document.documentElement.removeAttribute('data-genai-theme');
    document.body.classList.add('mlflow-ml-section');
  } else {
    document.documentElement.removeAttribute('data-genai-theme');
  }

  if (normalizedPathname.endsWith('/genai/tracing')) {
    document.body.classList.add('mlflow-tracing-overview-page');
    document.documentElement.setAttribute('data-mlflow-doc-route', 'genai-tracing-overview');
  }

  scheduleMintlifyAdmonitionUpdate();
}
