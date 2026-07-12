export function onRouteDidUpdate({ location }) {
  const { pathname } = location;

  document.body.classList.remove('mlflow-ml-section', 'mlflow-genai-section', 'mlflow-tracing-overview-page');
  document.documentElement.removeAttribute('data-mlflow-doc-route');

  if (pathname.startsWith('/genai')) {
    document.documentElement.setAttribute('data-genai-theme', 'true');
    document.body.classList.add('mlflow-genai-section');
  } else if (pathname.startsWith('/ml')) {
    document.documentElement.removeAttribute('data-genai-theme');
    document.body.classList.add('mlflow-ml-section');
  } else {
    document.documentElement.removeAttribute('data-genai-theme');
  }

  if (pathname.replace(/\/$/, '').endsWith('/genai/tracing')) {
    document.body.classList.add('mlflow-tracing-overview-page');
    document.documentElement.setAttribute('data-mlflow-doc-route', 'genai-tracing-overview');
  }
}
