import React, { useEffect, useState } from 'react';
import Link from '@docusaurus/Link';
import { useLocation } from '@docusaurus/router';
import useBaseUrl from '@docusaurus/useBaseUrl';
import OriginalDocSidebar from '@theme-original/DocSidebar';
import type { Props } from '@theme/DocSidebar';

type ProductSidebarKey = 'tracing' | 'evaluation' | 'prompt' | 'gateway' | 'more' | 'selfHosting' | 'classic';

const contextualSidebarKeys: ProductSidebarKey[] = ['tracing', 'evaluation', 'prompt', 'gateway'];
const contextualSidebarPaths = new Set(['/genai/demo', '/genai/getting-started/try-assistant']);

interface SidebarLinkItem {
  type: 'link';
  href: string;
  label: string;
  icon?: string;
  activePaths?: string[];
}

interface SidebarDisclosureItem {
  type: 'disclosure';
  label: string;
  links: SidebarLinkItem[];
}

type SidebarItem = SidebarLinkItem | SidebarDisclosureItem;

interface SidebarGroupConfig {
  title: string;
  items: SidebarItem[];
}

function normalizePath(path: string) {
  const normalizedPath = path.replace(/\/+$/, '');

  return normalizedPath || '/';
}

function getSectionPath(pathname: string, section: string) {
  const sectionPattern = new RegExp(`/${section}(?=/|$)`);
  const match = pathname.match(sectionPattern);

  return match?.index === undefined ? undefined : pathname.slice(match.index);
}

function getProductPath(pathname: string) {
  const normalizedPathname = normalizePath(pathname);
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

function getContextualSidebarKey(currentPath: string, search: string): ProductSidebarKey | undefined {
  if (!contextualSidebarPaths.has(currentPath)) {
    return undefined;
  }

  const section = new URLSearchParams(search).get('section') as ProductSidebarKey | null;

  return section && contextualSidebarKeys.includes(section) ? section : undefined;
}

function getProductSidebarKey(pathname: string, search = ''): ProductSidebarKey | undefined {
  const currentPath = getProductPath(pathname);
  const contextualSidebarKey = getContextualSidebarKey(currentPath, search);

  if (contextualSidebarKey) {
    return contextualSidebarKey;
  }

  if (currentPath === '/self-hosting' || currentPath.startsWith('/self-hosting/')) {
    return 'selfHosting';
  }

  if (currentPath === '/ml' || currentPath.startsWith('/ml/')) {
    return 'classic';
  }

  if (currentPath === '/genai/tracing' || currentPath.startsWith('/genai/tracing/')) {
    return 'tracing';
  }

  if (
    currentPath === '/genai/eval-monitor' ||
    currentPath.startsWith('/genai/eval-monitor/') ||
    currentPath === '/genai/datasets' ||
    currentPath.startsWith('/genai/datasets/') ||
    currentPath.startsWith('/genai/assessments/')
  ) {
    return 'evaluation';
  }

  if (currentPath === '/genai/prompt-registry' || currentPath.startsWith('/genai/prompt-registry/')) {
    return 'prompt';
  }

  if (currentPath === '/genai/governance/ai-gateway' || currentPath.startsWith('/genai/governance/ai-gateway/')) {
    return 'gateway';
  }

  if (currentPath === '/genai' || currentPath.startsWith('/genai/')) {
    return 'more';
  }

  return undefined;
}

function splitHref(href: string) {
  const [pathAndSearch, hash = ''] = href.split('#');
  const [path] = pathAndSearch.split('?');

  return {
    path: normalizePath(path),
    hash: hash ? `#${hash}` : '',
  };
}

function isPathWithin(currentPath: string, targetPath: string) {
  return currentPath === targetPath || currentPath.startsWith(`${targetPath}/`);
}

function isLinkActive(item: SidebarLinkItem, currentPath: string, currentHash: string) {
  const { path, hash } = splitHref(item.href);

  if (hash) {
    return currentPath === path && currentHash === hash;
  }

  if (currentPath === path && !currentHash) {
    return true;
  }

  return item.activePaths?.some((activePath) => isPathWithin(currentPath, normalizePath(activePath))) ?? false;
}

function hasActiveDisclosureLink(item: SidebarDisclosureItem, currentPath: string, currentHash: string) {
  return item.links.some((link) => isLinkActive(link, currentPath, currentHash));
}

const fontAwesomeBase = 'https://d3gk2c5xim1je2.cloudfront.net/fontawesome/v7.2.0';

function SidebarMaskIcon({ icon }: { icon: string }) {
  const iconUrl = `${fontAwesomeBase}/${icon}.svg`;

  return (
    <span
      aria-hidden="true"
      className="mlflow-docs-sidebar-mask-icon"
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

function SidebarChevron({ expanded = false }: { expanded?: boolean }) {
  return (
    <svg
      className={expanded ? 'mlflow-docs-sidebar-chevron-expanded' : undefined}
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

function SidebarLink({ item, active = false }: { item: SidebarLinkItem; active?: boolean }) {
  const href = useBaseUrl(item.href);

  return (
    <li className="mlflow-docs-sidebar-item">
      <Link
        className={active ? 'mlflow-docs-sidebar-link mlflow-docs-sidebar-link-active' : 'mlflow-docs-sidebar-link'}
        href={href}
        aria-current={active ? 'page' : undefined}
      >
        {item.icon && (
          <span className="mlflow-docs-sidebar-icon">
            <SidebarMaskIcon icon={item.icon} />
          </span>
        )}
        <span>{item.label}</span>
      </Link>
    </li>
  );
}

function SidebarDisclosure({
  item,
  currentPath,
  currentHash,
}: {
  item: SidebarDisclosureItem;
  currentPath: string;
  currentHash: string;
}) {
  const containsActiveLink = hasActiveDisclosureLink(item, currentPath, currentHash);
  const [expanded, setExpanded] = useState(containsActiveLink);

  useEffect(() => {
    if (containsActiveLink) {
      setExpanded(true);
    }
  }, [containsActiveLink]);

  return (
    <li className="mlflow-docs-sidebar-item">
      <button
        className={
          containsActiveLink
            ? 'mlflow-docs-sidebar-link mlflow-docs-sidebar-button mlflow-docs-sidebar-link-ancestor'
            : 'mlflow-docs-sidebar-link mlflow-docs-sidebar-button'
        }
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded((current) => !current)}
      >
        <span>{item.label}</span>
        <SidebarChevron expanded={expanded} />
      </button>
      {expanded && (
        <ul className="mlflow-docs-sidebar-nested-list">
          {item.links.map((link) => (
            <SidebarLink
              key={`${item.label}-${link.href}`}
              item={link}
              active={isLinkActive(link, currentPath, currentHash)}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

function SidebarGroup({
  title,
  items,
  currentPath,
  currentHash,
}: {
  title: string;
  items: SidebarItem[];
  currentPath: string;
  currentHash: string;
}) {
  return (
    <div className="mlflow-docs-sidebar-group">
      <h3>{title}</h3>
      <ul>
        {items.map((item) =>
          item.type === 'link' ? (
            <SidebarLink key={item.href} item={item} active={isLinkActive(item, currentPath, currentHash)} />
          ) : (
            <SidebarDisclosure
              key={`${title}-${item.label}`}
              item={item}
              currentPath={currentPath}
              currentHash={currentHash}
            />
          ),
        )}
      </ul>
    </div>
  );
}

function link(
  label: string,
  href: string,
  options: Omit<SidebarLinkItem, 'type' | 'label' | 'href'> = {},
): SidebarLinkItem {
  return { type: 'link', label, href, ...options };
}

function disclosure(label: string, links: SidebarLinkItem[]): SidebarDisclosureItem {
  return { type: 'disclosure', label, links };
}

function sharedOverviewLinks(productKey?: ProductSidebarKey) {
  const sectionSuffix = productKey && productKey !== 'more' ? `?section=${productKey}` : '';

  return [
    link('Try Live Demo', `/genai/demo${sectionSuffix}`, { icon: 'regular/play' }),
    link('MLflow Assistant', `/genai/getting-started/try-assistant${sectionSuffix}`, {
      icon: 'regular/sparkles',
    }),
  ];
}

const productSidebars: Record<ProductSidebarKey, SidebarGroupConfig[]> = {
  tracing: [
    {
      title: 'Overview',
      items: [
        link("What's Tracing?", '/genai/tracing'),
        link('Quickstart', '/genai/tracing/quickstart'),
        ...sharedOverviewLinks('tracing'),
      ],
    },
    {
      title: 'Instrument',
      items: [
        disclosure('Trace your app and agents', [
          link('Automatic tracing', '/genai/tracing/app-instrumentation/automatic', {
            activePaths: ['/genai/tracing/integrations'],
          }),
          link('Manual tracing', '/genai/tracing/app-instrumentation/manual-tracing'),
          link('Tracing with OpenTelemetry', '/genai/tracing/app-instrumentation/opentelemetry'),
        ]),
        link('Distributed tracing', '/genai/tracing/app-instrumentation/distributed-tracing'),
        disclosure('Add context', [
          link('Track Users and Sessions', '/genai/tracing/track-users-sessions'),
          link('Tag Traces', '/genai/tracing/attach-tags'),
          link('Track Application Versions', '/genai/tracing/track-environments-context'),
          link('Setting Log Levels', '/genai/tracing/app-instrumentation/logging'),
        ]),
        disclosure('Capture inputs and feedback', [
          link('Collect User Feedback', '/genai/tracing/collect-user-feedback'),
          link('Multimodal Content & Attachments', '/genai/tracing/observe-with-traces/multimodal'),
        ]),
      ],
    },
    {
      title: 'Observe',
      items: [
        link('Dashboard', '/genai/tracing/observe-with-traces/dashboard'),
        link('View Traces', '/genai/tracing/observe-with-traces/ui'),
        link('Search Traces', '/genai/tracing/search-traces'),
        link('Delete Traces', '/genai/tracing/observe-with-traces/delete-traces'),
        link('Token Usage and Cost', '/genai/tracing/token-usage-cost'),
      ],
    },
    {
      title: 'Production Monitoring',
      items: [
        link('Production Monitoring', '/genai/tracing/prod-tracing', {
          activePaths: ['/genai/tracing/lightweight-sdk'],
        }),
        link('Redact Sensitive Data', '/genai/tracing/observe-with-traces/masking'),
        link('Archive old traces', '/genai/tracing/observe-with-traces/archive-traces'),
      ],
    },
    {
      title: 'OpenTelemetry',
      items: [
        link('Opentelemetry', '/genai/tracing/opentelemetry'),
        link('Ingest traces', '/genai/tracing/opentelemetry/ingest', {
          activePaths: ['/genai/tracing/opentelemetry/ingest-shared'],
        }),
        link('Export traces', '/genai/tracing/opentelemetry/export'),
        link('GenAI semantic conventions', '/genai/tracing/opentelemetry/genai-semconv'),
        link('Attribute mapping', '/genai/tracing/opentelemetry/attribute-mapping'),
      ],
    },
    {
      title: 'FAQ',
      items: [link('Tracing FAQ', '/genai/tracing/faq')],
    },
  ],
  evaluation: [
    {
      title: 'Overview',
      items: [
        link("What's Evaluation?", '/genai/eval-monitor'),
        link('Quickstart', '/genai/eval-monitor/quickstart', {
          activePaths: ['/genai/eval-monitor/notebooks/quickstart-eval-ipynb'],
        }),
        ...sharedOverviewLinks('evaluation'),
      ],
    },
    {
      title: 'Offline Evaluation',
      items: [
        disclosure('Run evaluations', [
          link('Evaluation examples', '/genai/eval-monitor/running-evaluation/eval-examples', {
            activePaths: ['/genai/eval-monitor/legacy-llm-evaluation'],
          }),
          link('Evaluate prompts', '/genai/eval-monitor/running-evaluation/prompts'),
          link('Evaluate agents', '/genai/eval-monitor/running-evaluation/agents'),
          link('Evaluate traces', '/genai/eval-monitor/running-evaluation/traces'),
          link('Evaluate conversations', '/genai/eval-monitor/running-evaluation/multi-turn', {
            activePaths: ['/genai/eval-monitor/running-evaluation/conversation-simulation'],
          }),
        ]),
        link('Regression Testing and CI/CD', '/genai/eval-monitor/regression-testing'),
      ],
    },
    {
      title: 'Annotation',
      items: [
        link('Human Feedback', '/genai/assessments/feedback'),
        link('Ground Truth', '/genai/assessments/expectations'),
        link('Review Queues', '/genai/assessments/review-queues'),
      ],
    },
    {
      title: 'Dataset',
      items: [
        link('Evaluation Datasets', '/genai/datasets'),
        link('SDK Guide', '/genai/datasets/sdk-guide'),
        link('Conversation Simulation', '/genai/datasets/conversation-simulation'),
        link('End-to-End Workflow', '/genai/datasets/end-to-end-workflow'),
      ],
    },
    {
      title: 'Scorers',
      items: [
        link('Judges and Scorers', '/genai/eval-monitor/scorers', {
          activePaths: ['/genai/eval-monitor/scorers/versioning'],
        }),
        link('Built-in Judges', '/genai/eval-monitor/scorers/llm-judge/predefined', {
          activePaths: [
            '/genai/eval-monitor/scorers/llm-judge/guidelines',
            '/genai/eval-monitor/scorers/llm-judge/prompt',
            '/genai/eval-monitor/scorers/llm-judge/rag',
            '/genai/eval-monitor/scorers/llm-judge/response-quality',
            '/genai/eval-monitor/scorers/llm-judge/tool-call',
            '/genai/eval-monitor/scorers/llm-judge/workflow',
          ],
        }),
        link('Custom Judges', '/genai/eval-monitor/scorers/llm-judge/custom-judges', {
          activePaths: [
            '/genai/eval-monitor/scorers/llm-judge/alignment',
            '/genai/eval-monitor/scorers/llm-judge/custom-judges',
            '/genai/eval-monitor/scorers/llm-judge/custom-optimizers',
            '/genai/eval-monitor/scorers/llm-judge/gepa',
            '/genai/eval-monitor/scorers/llm-judge/memalign',
            '/genai/eval-monitor/scorers/llm-judge/simba',
          ],
        }),
        link('Code-based Scorers', '/genai/eval-monitor/scorers/custom', {
          activePaths: ['/genai/eval-monitor/scorers/custom'],
        }),
        link('Third-party Judges', '/genai/eval-monitor/scorers/third-party', {
          activePaths: ['/genai/eval-monitor/scorers/third-party'],
        }),
      ],
    },
    {
      title: 'Production Monitoring',
      items: [
        link('Online Evaluation', '/genai/eval-monitor/automatic-evaluations'),
        link('Automatic Issue Detection', '/genai/eval-monitor/ai-insights/detect-issues', {
          activePaths: ['/genai/eval-monitor/ai-insights/ai-issue-discovery'],
        }),
      ],
    },
    {
      title: 'FAQ',
      items: [link('Evaluation FAQ', '/genai/eval-monitor/faq')],
    },
  ],
  prompt: [
    {
      title: 'Overview',
      items: [
        link("What's Prompt Management?", '/genai/prompt-registry'),
        link('Quickstart', '/genai/prompt-registry#getting-started'),
        ...sharedOverviewLinks('prompt'),
      ],
    },
    {
      title: 'Playground',
      items: [
        link('LLM Playground', '/genai/prompt-registry/playground', {
          activePaths: ['/genai/prompt-registry/prompt-engineering'],
        }),
      ],
    },
    {
      title: 'Manage',
      items: [
        link('Create and Edit Prompts', '/genai/prompt-registry/create-and-edit-prompts'),
        link('Manage Prompt Lifecycles', '/genai/prompt-registry/manage-prompt-lifecycles-with-aliases'),
        link('Use Prompts in Apps', '/genai/prompt-registry/use-prompts-in-apps'),
        link('Log with Model', '/genai/prompt-registry/log-with-model'),
        link('Structured Output', '/genai/prompt-registry/structured-output'),
      ],
    },
    {
      title: 'Evaluate',
      items: [link('Evaluate Prompts', '/genai/prompt-registry/evaluate-prompts')],
    },
    {
      title: 'Optimize',
      items: [
        link('Optimize Prompts', '/genai/prompt-registry/optimize-prompts'),
        link('Auto-rewrite Prompts for New Models', '/genai/prompt-registry/rewrite-prompts'),
        disclosure('Integrations', [
          link('LangChain Optimization', '/genai/prompt-registry/optimize-prompts/langchain-optimization'),
          link('LangGraph Optimization', '/genai/prompt-registry/optimize-prompts/langgraph-optimization'),
          link('OpenAI Agent Optimization', '/genai/prompt-registry/optimize-prompts/openai-agent-optimization'),
          link('Pydantic AI Optimization', '/genai/prompt-registry/optimize-prompts/pydantic-ai-optimization'),
        ]),
      ],
    },
  ],
  gateway: [
    {
      title: 'Overview',
      items: [
        link("What's AI Gateway?", '/genai/governance/ai-gateway'),
        link('Quickstart', '/genai/governance/ai-gateway/quickstart'),
        ...sharedOverviewLinks('gateway'),
      ],
    },
    {
      title: 'Manage',
      items: [
        disclosure('API Keys', [
          link('Create and Manage LLM Connections', '/genai/governance/ai-gateway/api-keys/create-and-manage'),
          link('Encryption & Rotation', '/genai/governance/ai-gateway/api-keys/key-rotation'),
        ]),
        disclosure('Endpoints', [
          link('Create and Manage Endpoints', '/genai/governance/ai-gateway/endpoints/create-and-manage'),
          link('Query Endpoints', '/genai/governance/ai-gateway/endpoints/query-endpoints'),
          link('Model Providers', '/genai/governance/ai-gateway/endpoints/model-providers'),
          link('Traffic Routing & Fallbacks', '/genai/governance/ai-gateway/traffic-routing-fallbacks'),
        ]),
        link('Performance & Benchmarks', '/genai/governance/ai-gateway/benchmarks'),
      ],
    },
    {
      title: 'Governance and Safety',
      items: [
        link('Usage Tracking', '/genai/governance/ai-gateway/usage-tracking'),
        link('Budget Alerts & Limits', '/genai/governance/ai-gateway/budget-alerts-limits'),
        link('Guardrails', '/genai/governance/ai-gateway/guardrails'),
      ],
    },
    {
      title: 'Coding Agents',
      items: [
        link('Coding Agents & Long-Running Agents', '/genai/governance/ai-gateway/coding-agents'),
        link('Claude Code', '/genai/governance/ai-gateway/coding-agents/claude-code'),
        link('OpenAI Codex', '/genai/governance/ai-gateway/coding-agents/codex'),
        link('Gemini CLI', '/genai/governance/ai-gateway/coding-agents/gemini-cli'),
        link('Hermes Agent', '/genai/governance/ai-gateway/coding-agents/hermes-agent'),
      ],
    },
  ],
  more: [
    {
      title: 'Overview',
      items: [
        link('GenAI Overview', '/genai'),
        link('Set Up MLflow Server', '/genai/getting-started/connect-environment'),
        link('Try Live Demo', '/genai/demo', { icon: 'regular/play' }),
        link('MLflow Assistant', '/genai/getting-started/try-assistant', { icon: 'regular/sparkles' }),
        link('Managed MLflow', '/genai/getting-started/databricks-trial'),
      ],
    },
    {
      title: 'More Features',
      items: [
        disclosure('Version Tracking', [
          link('Overview', '/genai/version-tracking'),
          link('Quickstart', '/genai/version-tracking/quickstart'),
          link('Track Application Versions', '/genai/version-tracking/track-application-versions-with-mlflow'),
          link('Compare App Versions', '/genai/version-tracking/compare-app-versions'),
        ]),
        disclosure('Packaging & Deployment', [
          link('Overview', '/genai/flavors'),
          link('DSPy', '/genai/flavors/dspy', { activePaths: ['/genai/flavors/dspy'] }),
          link('LangChain', '/genai/flavors/langchain', { activePaths: ['/genai/flavors/langchain'] }),
          link('LlamaIndex', '/genai/flavors/llama-index', { activePaths: ['/genai/flavors/llama-index'] }),
          link('Custom Applications', '/genai/flavors/custom-pyfunc-for-llms', {
            activePaths: ['/genai/flavors/custom-pyfunc-for-llms'],
          }),
          link('ChatModel', '/genai/flavors/chat-model-intro', {
            activePaths: ['/genai/flavors/chat-model-intro', '/genai/flavors/chat-model-guide'],
          }),
          link('ResponsesAgent', '/genai/flavors/responses-agent-intro'),
        ]),
        link('MCP', '/genai/mcp'),
        disclosure('Agent Serving', [
          link('Overview', '/genai/serving'),
          link('Agent Server', '/genai/serving/agent-server'),
          link('Responses Agent', '/genai/serving/responses-agent'),
          link('Custom Apps', '/genai/serving/custom-apps'),
        ]),
      ],
    },
    {
      title: 'References',
      items: [
        disclosure('Concepts', [
          link('Trace', '/genai/concepts/trace', { activePaths: ['/genai/concepts/trace'] }),
          link('Span', '/genai/concepts/span'),
          link('Feedback', '/genai/concepts/feedback'),
          link('Expectations', '/genai/concepts/expectations'),
          link('Scorers', '/genai/concepts/scorers'),
          link('Evaluation Datasets', '/genai/concepts/evaluation-datasets'),
        ]),
        link('Request Features', '/genai/references/request-features'),
      ],
    },
  ],
  selfHosting: [
    {
      title: 'Overview',
      items: [
        link("What's Self Hosting?", '/self-hosting'),
        link('Quickstart', '/self-hosting#the-quickest-path-run-mlflow-command'),
        link('Architecture Overview', '/self-hosting/architecture/overview'),
      ],
    },
    {
      title: 'Architecture',
      items: [
        link('Tracking Server', '/self-hosting/architecture/tracking-server'),
        link('Backend Store', '/self-hosting/architecture/backend-store'),
        link('Artifact Store', '/self-hosting/architecture/artifact-store'),
      ],
    },
    {
      title: 'Deploy',
      items: [
        link('Kubernetes with Helm', '/self-hosting/kubernetes-helm'),
        disclosure('Cloud Deployment', [
          link('AWS', '/self-hosting/deploy-to-cloud/aws'),
          link('Azure', '/self-hosting/deploy-to-cloud/azure'),
          link('GCP', '/self-hosting/deploy-to-cloud/gcp'),
        ]),
      ],
    },
    {
      title: 'Workspaces',
      items: [
        link('Workspaces Overview', '/self-hosting/workspaces'),
        link('Getting Started', '/self-hosting/workspaces/getting-started'),
        link('Configuration', '/self-hosting/workspaces/configuration'),
        link('Workspace Providers', '/self-hosting/workspaces/workspace-providers'),
        link('Permissions', '/self-hosting/workspaces/permissions'),
      ],
    },
    {
      title: 'Security',
      items: [
        link('Network Protection', '/self-hosting/security/network'),
        link('Username and Password', '/self-hosting/security/basic-http-auth'),
        link('Role-Based Access Control', '/self-hosting/security/role-based-access-control'),
        link('SSO', '/self-hosting/security/sso'),
        link('Custom Authentication', '/self-hosting/security/custom'),
        link('Kubernetes Authentication', '/self-hosting/security/kubernetes'),
        link('Secure Installs', '/self-hosting/security/secure-installs'),
      ],
    },
    {
      title: 'Operate',
      items: [
        link('Webhooks', '/self-hosting/webhooks'),
        link('Upgrade', '/self-hosting/migration'),
        link('Migrate from File Store', '/self-hosting/migrate-from-file-store'),
        link('Troubleshooting & FAQs', '/self-hosting/troubleshooting'),
      ],
    },
  ],
  classic: [
    {
      title: 'Overview',
      items: [link('MLflow Overview', '/ml'), link('MLflow 3.0 Migration', '/ml/mlflow-3')],
    },
    {
      title: 'Get Started',
      items: [
        link('Set Up MLflow', '/ml/getting-started/running-notebooks'),
        link('Quickstart', '/ml/getting-started/quickstart'),
        link('Hyperparameter Tuning', '/ml/getting-started/hyperparameter-tuning'),
        link('Deep Learning', '/ml/getting-started/deep-learning'),
      ],
    },
    {
      title: 'Train',
      items: [
        disclosure('Traditional ML', [
          link('Overview', '/ml/traditional-ml'),
          link('Scikit-learn', '/ml/traditional-ml/sklearn'),
          link('XGBoost', '/ml/traditional-ml/xgboost'),
          link('SparkML', '/ml/traditional-ml/sparkml'),
          link('Prophet', '/ml/traditional-ml/prophet'),
        ]),
        disclosure('Deep Learning', [
          link('Overview', '/ml/deep-learning'),
          link('PyTorch', '/ml/deep-learning/pytorch'),
          link('TensorFlow', '/ml/deep-learning/tensorflow'),
          link('Keras', '/ml/deep-learning/keras'),
          link('Transformers', '/ml/deep-learning/transformers'),
          link('Sentence Transformers', '/ml/deep-learning/sentence-transformers'),
          link('spaCy', '/ml/deep-learning/spacy'),
        ]),
      ],
    },
    {
      title: 'Track',
      items: [
        link('Tracking Overview', '/ml/tracking'),
        link('Quickstart', '/ml/tracking/quickstart'),
        link('Auto Logging', '/ml/tracking/autolog'),
        disclosure('Search', [
          link('Search Runs', '/ml/search/search-runs'),
          link('Search Experiments', '/ml/search/search-experiments'),
          link('Search Models', '/ml/search/search-models'),
        ]),
        link('System Metrics', '/ml/tracking/system-metrics'),
        link('Tracking APIs', '/ml/tracking/tracking-api'),
        link('Tracking Server', '/self-hosting/architecture/tracking-server'),
      ],
    },
    {
      title: 'Models',
      items: [
        link('Models Overview', '/ml/model'),
        link('Model Signatures', '/ml/model/signatures'),
        link('Dependencies', '/ml/model/dependencies'),
        link('Models From Code', '/ml/model/models-from-code'),
        link('Python Model', '/ml/model/python_model'),
        link('Community Model Integrations', '/ml/community-model-flavors'),
        link('Pickle-Free Model Format', '/ml/tracking/pickle-free-models'),
        link('Datasets', '/ml/dataset'),
      ],
    },
    {
      title: 'Evaluate',
      items: [link('MLflow Evaluation', '/ml/evaluation')],
    },
    {
      title: 'Deploy',
      items: [
        disclosure('Model Registry', [
          link('Overview', '/ml/model-registry'),
          link('Workflow', '/ml/model-registry/workflow'),
          link('Tutorial', '/ml/model-registry/tutorial'),
        ]),
        disclosure('Model Serving', [
          link('Overview', '/ml/deployment'),
          link('Deploy Locally', '/ml/deployment/deploy-model-locally'),
          link('Deploy to SageMaker', '/ml/deployment/deploy-model-to-sagemaker'),
          link('Deploy to Modal', '/ml/deployment/deploy-model-to-modal'),
        ]),
        link('Docker', '/ml/docker'),
      ],
    },
    {
      title: 'More',
      items: [
        link('Projects', '/ml/projects'),
        link('Plugins', '/ml/plugins'),
        link('External Tutorials', '/ml/tutorials-and-examples'),
        link('Self-Hosting', '/self-hosting'),
      ],
    },
  ],
};

function MLflowDocsProductSidebar({
  groups,
  currentPath,
  currentHash,
}: {
  groups: SidebarGroupConfig[];
  currentPath: string;
  currentHash: string;
}) {
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

  return (
    <nav className="mlflow-docs-sidebar" aria-label="Pages" onWheel={handleWheel}>
      <div className="mlflow-docs-sidebar-fade" />
      <div className="mlflow-docs-sidebar-content">
        {groups.map((group) => (
          <SidebarGroup
            key={group.title}
            title={group.title}
            items={group.items}
            currentPath={currentPath}
            currentHash={currentHash}
          />
        ))}
      </div>
    </nav>
  );
}

export default function DocSidebar(props: Props): React.ReactNode {
  const location = useLocation();
  const sidebarKey = getProductSidebarKey(location.pathname, location.search);

  if (!sidebarKey) {
    return <OriginalDocSidebar {...props} />;
  }

  return (
    <MLflowDocsProductSidebar
      groups={productSidebars[sidebarKey]}
      currentPath={getProductPath(location.pathname)}
      currentHash={location.hash}
    />
  );
}
