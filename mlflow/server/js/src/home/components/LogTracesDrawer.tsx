import { useState } from 'react';
import { Drawer, Spacer, Typography, useDesignSystemTheme, CopyIcon } from '@databricks/design-system';
import { FormattedMessage } from 'react-intl';
import { TraceTableGenericQuickstart } from '@mlflow/mlflow/src/experiment-tracking/components/traces/quickstart/TraceTableGenericQuickstart';
import type { QUICKSTART_FLAVOR } from '@mlflow/mlflow/src/experiment-tracking/components/traces/quickstart/TraceTableQuickstart.utils';
import { CopyButton } from '@mlflow/mlflow/src/shared/building_blocks/CopyButton';
import { CodeSnippet } from '@databricks/web-shared/snippet';
import { Link } from '../../common/utils/RoutingUtils';
import Routes from '../../experiment-tracking/routes';
import OpenAiLogo from '../../common/static/logos/openai.svg';
import OpenAiLogoDark from '../../common/static/logos/openai-dark.svg';
import LangChainLogo from '../../common/static/logos/langchain.svg';
import LangChainLogoDark from '../../common/static/logos/langchain-dark.png';
import AnthropicLogo from '../../common/static/logos/anthropic.svg';
import AnthropicLogoDark from '../../common/static/logos/anthropic-dark.png';
import BedrockLogo from '../../common/static/logos/bedrock.svg';
import DspyLogo from '../../common/static/logos/dspy.png';
import LiteLLMLogo from '../../common/static/logos/litellm.png';
import GeminiLogo from '../../common/static/logos/gemini.png';
import LlamaIndexLogo from '../../common/static/logos/llamaindex.png';
import AutoGenLogo from '../../common/static/logos/autogen.png';
import CrewAILogo from '../../common/static/logos/crewai.png';

type SupportedQuickstartFlavor = QUICKSTART_FLAVOR;

type FrameworkDefinition = {
  id: SupportedQuickstartFlavor;
  message: string;
  logo?: string;
  selectedLogo?: string;
};

const frameworks: FrameworkDefinition[] = [
  {
    id: 'openai',
    message: 'OpenAI',
    logo: OpenAiLogo,
    selectedLogo: OpenAiLogoDark,
  },
  {
    id: 'langchain',
    message: 'LangChain',
    logo: LangChainLogo,
    selectedLogo: LangChainLogoDark,
  },
  {
    id: 'anthropic',
    message: 'Anthropic',
    logo: AnthropicLogo,
    selectedLogo: AnthropicLogoDark,
  },
  {
    id: 'dspy',
    message: 'DSPy',
    logo: DspyLogo,
  },
  {
    id: 'gemini',
    message: 'Gemini',
    logo: GeminiLogo,
  },
  {
    id: 'bedrock',
    message: 'Amazon Bedrock',
    logo: BedrockLogo,
  },
  {
    id: 'litellm',
    message: 'LiteLLM',
    logo: LiteLLMLogo,
  },
  {
    id: 'llama_index',
    message: 'LlamaIndex',
    logo: LlamaIndexLogo,
  },
  {
    id: 'autogen',
    message: 'AutoGen',
    logo: AutoGenLogo,
  },
  {
    id: 'crewai',
    message: 'CrewAI',
    logo: CrewAILogo,
  },
];

const CONFIGURE_EXPERIMENT_SNIPPET = `import mlflow

# Specify the tracking server URI, e.g. http://localhost:5000
mlflow.set_tracking_uri("http://<tracking-server-host>:<port>")
# If the experiment with the name "traces-quickstart" doesn't exist, MLflow will create it
mlflow.set_experiment("traces-quickstart")`;

export const LogTracesDrawer = ({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) => {
  const { theme } = useDesignSystemTheme();
  const [selectedFramework, setSelectedFramework] = useState<SupportedQuickstartFlavor>('openai');

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      setSelectedFramework('openai');
      onClose();
    }
  };

  return (
    <Drawer.Root modal open={isOpen} onOpenChange={handleOpenChange}>
      <Drawer.Content
        componentId="mlflow.home.log_traces.drawer"
        width="70vw"
        title={
          <FormattedMessage
            defaultMessage="Log traces"
            description="Title for the log traces drawer on the Home page"
          />
        }
      >
        <Typography.Text color="secondary">
          <FormattedMessage
            defaultMessage="Select a framework and follow the instructions to log traces with MLflow"
            description="Helper text shown at the top of the log traces drawer"
          />
        </Typography.Text>
        <Spacer size="md" />
        <div
          css={{
            display: 'flex',
            flexDirection: 'row',
            gap: theme.spacing.lg,
            minHeight: 0,
          }}
        >
          <aside
            css={{
              minWidth: 220,
              maxWidth: 260,
              display: 'flex',
              flexDirection: 'column',
              gap: theme.spacing.sm,
            }}
          >
            <Typography.Title level={3} css={{ margin: 0 }}>
              <FormattedMessage
                defaultMessage="Select a framework"
                description="Section title for selecting an LLM tracing framework"
              />
            </Typography.Title>
            {frameworks.map((framework) => {
              const isSelected = framework.id === selectedFramework;
              const logoSrc = isSelected && framework.selectedLogo ? framework.selectedLogo : framework.logo;
              return (
                <button
                  key={framework.id}
                  type="button"
                  onClick={() => setSelectedFramework(framework.id)}
                  data-component-id={`mlflow.home.log_traces.drawer.framework.${framework.id}`}
                  aria-pressed={isSelected}
                  css={{
                    border: 0,
                    borderRadius: theme.borders.borderRadiusSm,
                    padding: `${theme.spacing.sm}px ${theme.spacing.md}px`,
                    textAlign: 'left' as const,
                    cursor: 'pointer',
                    backgroundColor: isSelected
                      ? theme.colors.actionPrimaryBackgroundDefault
                      : theme.colors.backgroundSecondary,
                    color: isSelected ? theme.colors.actionPrimaryTextDefault : theme.colors.textPrimary,
                    boxShadow: theme.shadows.sm,
                    transition: 'background 150ms ease',
                    display: 'flex',
                    alignItems: 'center',
                    gap: theme.spacing.sm,
                    '&:hover': {
                      backgroundColor: isSelected
                        ? theme.colors.actionPrimaryBackgroundHover
                        : theme.colors.actionDefaultBackgroundHover,
                    },
                    '&:focus-visible': {
                      outline: `2px solid ${theme.colors.actionPrimaryBackgroundHover}`,
                      outlineOffset: 2,
                    },
                  }}
                >
                  {logoSrc && (
                    <img
                      src={logoSrc}
                      width={28}
                      height={28}
                      alt=""
                      aria-hidden
                      css={{ display: 'block' }}
                    />
                  )}
                  {framework.message}
                </button>
              );
            })}
          </aside>
          <div
            css={{
              flex: 1,
              minWidth: 0,
              maxWidth: 860,
              display: 'flex',
              flexDirection: 'column',
              gap: theme.spacing.lg,
              border: `1px solid ${theme.colors.border}`,
              borderRadius: theme.borders.borderRadiusLg,
              padding: theme.spacing.lg,
              backgroundColor: theme.colors.backgroundPrimary,
              boxShadow: theme.shadows.xs,
            }}
          >
            <section
              css={{
                display: 'flex',
                flexDirection: 'column',
                gap: theme.spacing.sm,
              }}
            >
              <Typography.Title level={4} css={{ margin: 0 }}>
                <FormattedMessage
                  defaultMessage="1. Configure experiment and tracking URI"
                  description="Section title for configuring experiment and tracking URI before logging traces"
                />
              </Typography.Title>
              <div css={{ position: 'relative', width: 'min(100%, 800px)' }}>
                <CopyButton
                  componentId="mlflow.home.log_traces.drawer.configure.copy"
                  css={{ zIndex: 1, position: 'absolute', top: theme.spacing.xs, right: theme.spacing.xs }}
                  showLabel={false}
                  copyText={CONFIGURE_EXPERIMENT_SNIPPET}
                  icon={<CopyIcon />}
                />
                <CodeSnippet
                  showLineNumbers
                  language="python"
                  theme={theme.isDarkMode ? 'duotoneDark' : 'light'}
                  style={{
                    padding: `${theme.spacing.sm}px ${theme.spacing.md}px`,
                    marginTop: theme.spacing.xs,
                  }}
                >
                  {CONFIGURE_EXPERIMENT_SNIPPET}
                </CodeSnippet>
              </div>
            </section>

            <section
              css={{
                display: 'flex',
                flexDirection: 'column',
                gap: theme.spacing.sm,
              }}
            >
              <Typography.Title level={4} css={{ margin: 0 }}>
                <FormattedMessage
                  defaultMessage="2. Trace your code"
                  description="Section title introducing the tracing quickstart example"
                />
              </Typography.Title>
              <TraceTableGenericQuickstart
                flavorName={selectedFramework}
                baseComponentId={`mlflow.home.log_traces.drawer.${selectedFramework}`}
              />
            </section>

            <section
              css={{
                display: 'flex',
                flexDirection: 'column',
                gap: theme.spacing.sm,
              }}
            >
              <Typography.Title level={4} css={{ margin: 0 }}>
                <FormattedMessage
                  defaultMessage="3. Access the MLflow UI"
                  description="Section title explaining how to access traces in the MLflow UI"
                />
              </Typography.Title>
              <Typography.Text color="secondary" css={{ margin: 0 }}>
                <FormattedMessage
                  defaultMessage="After your script runs, open the MLflow UI to review the recorded traces."
                  description="Introductory text for viewing traces in the MLflow UI"
                />
                <Spacer size="sm" />
                <ol
                  css={{
                    margin: 0,
                    paddingLeft: theme.spacing.lg,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: theme.spacing.xs,
                  }}
                >
                  <li>
                    <FormattedMessage
                      defaultMessage="Open the {experimentsLink} page."
                      description="Instruction to open the experiments page from the log traces drawer"
                      values={{
                        experimentsLink: (
                          <Link to={Routes.experimentsObservatoryRoute}>
                            <FormattedMessage
                              defaultMessage="Experiments"
                              description="Link label for the experiments page"
                            />
                          </Link>
                        ),
                      }}
                    />
                  </li>
                  <li>
                    <FormattedMessage
                      defaultMessage="Select the experiment you configured for tracing."
                        description="Instruction to select the experiment configured for traces"
                      />
                  </li>
                  <li>
                    <FormattedMessage
                      defaultMessage="Switch to the {tracesTab} tab to inspect trace inputs, outputs, and tokens."
                      description="Instruction to open the traces tab in the experiment page"
                      values={{ tracesTab: <strong>Traces</strong> }}
                      />
                  </li>
                </ol>
              </Typography.Text>
            </section>
          </div>
        </div>
      </Drawer.Content>
    </Drawer.Root>
  );
};

export default LogTracesDrawer;
