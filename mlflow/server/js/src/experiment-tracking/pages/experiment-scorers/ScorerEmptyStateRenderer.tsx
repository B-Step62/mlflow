import React from 'react';
import {
  Button,
  ChevronRightIcon,
  CodeIcon,
  GavelIcon,
  PlusIcon,
  ShieldIcon,
  SparkleDoubleIcon,
  SpeechBubbleIcon,
  Tag,
  TargetIcon,
  Typography,
  useDesignSystemTheme,
  WrenchIcon,
} from '@databricks/design-system';
import { FormattedMessage, useIntl } from '@databricks/i18n';
import { ScorerEvaluationScope } from './constants';
import { LLM_TEMPLATE } from './types';

const getScorersDocUrl = () => {
  return 'https://mlflow.org/docs/latest/genai/eval-monitor/scorers/';
};

export interface BuiltInJudgeCatalogItem {
  template: LLM_TEMPLATE;
  label: string;
  description: string;
  defaultName: string;
  scope: ScorerEvaluationScope;
  requirement?: string;
  componentId: string;
}

interface JudgeCatalogSection {
  title: string;
  icon: React.ReactNode;
  items: BuiltInJudgeCatalogItem[];
}

interface ScorerEmptyStateRendererProps {
  onUseBuiltInJudgeClick: (judge: BuiltInJudgeCatalogItem) => void;
  onAddLLMScorerClick: () => void;
  onAddCustomCodeScorerClick: () => void;
}

const getJudgeCatalogSections = (intl: ReturnType<typeof useIntl>): JudgeCatalogSection[] => [
  {
    title: intl.formatMessage({
      defaultMessage: 'Quality',
      description: 'Catalog section title for quality judges',
    }),
    icon: <TargetIcon />,
    items: [
      {
        template: LLM_TEMPLATE.CORRECTNESS,
        label: intl.formatMessage({ defaultMessage: 'Correctness', description: 'Built-in judge name' }),
        description: intl.formatMessage({
          defaultMessage: 'Checks whether expected facts are supported by the response.',
          description: 'Built-in correctness judge description',
        }),
        defaultName: 'correctness',
        scope: ScorerEvaluationScope.TRACES,
        requirement: intl.formatMessage({
          defaultMessage: 'Needs expectations',
          description: 'Requirement badge for correctness judge',
        }),
        componentId: 'mlflow.experiment-scorers.catalog.correctness',
      },
      {
        template: LLM_TEMPLATE.RELEVANCE_TO_QUERY,
        label: intl.formatMessage({ defaultMessage: 'Relevance to query', description: 'Built-in judge name' }),
        description: intl.formatMessage({
          defaultMessage: "Checks whether the app's response addresses the user input.",
          description: 'Built-in relevance to query judge description',
        }),
        defaultName: 'relevance_to_query',
        scope: ScorerEvaluationScope.TRACES,
        componentId: 'mlflow.experiment-scorers.catalog.relevance-to-query',
      },
      {
        template: LLM_TEMPLATE.COMPLETENESS,
        label: intl.formatMessage({ defaultMessage: 'Completeness', description: 'Built-in judge name' }),
        description: intl.formatMessage({
          defaultMessage: 'Checks whether every explicit request was handled.',
          description: 'Built-in completeness judge description',
        }),
        defaultName: 'completeness',
        scope: ScorerEvaluationScope.TRACES,
        componentId: 'mlflow.experiment-scorers.catalog.completeness',
      },
      {
        template: LLM_TEMPLATE.FLUENCY,
        label: intl.formatMessage({ defaultMessage: 'Fluency', description: 'Built-in judge name' }),
        description: intl.formatMessage({
          defaultMessage: 'Checks grammar, naturalness, and writing quality.',
          description: 'Built-in fluency judge description',
        }),
        defaultName: 'fluency',
        scope: ScorerEvaluationScope.TRACES,
        componentId: 'mlflow.experiment-scorers.catalog.fluency',
      },
    ],
  },
  {
    title: intl.formatMessage({
      defaultMessage: 'Retrieval',
      description: 'Catalog section title for retrieval judges',
    }),
    icon: <SparkleDoubleIcon />,
    items: [
      {
        template: LLM_TEMPLATE.RETRIEVAL_GROUNDEDNESS,
        label: intl.formatMessage({ defaultMessage: 'Retrieval groundedness', description: 'Built-in judge name' }),
        description: intl.formatMessage({
          defaultMessage: 'Checks whether the response is grounded in retrieved context.',
          description: 'Built-in retrieval groundedness judge description',
        }),
        defaultName: 'groundedness',
        scope: ScorerEvaluationScope.TRACES,
        componentId: 'mlflow.experiment-scorers.catalog.retrieval-groundedness',
      },
      {
        template: LLM_TEMPLATE.RETRIEVAL_RELEVANCE,
        label: intl.formatMessage({ defaultMessage: 'Retrieval relevance', description: 'Built-in judge name' }),
        description: intl.formatMessage({
          defaultMessage: 'Checks whether retrieved documents match the request.',
          description: 'Built-in retrieval relevance judge description',
        }),
        defaultName: 'retrieval_relevance',
        scope: ScorerEvaluationScope.TRACES,
        componentId: 'mlflow.experiment-scorers.catalog.retrieval-relevance',
      },
      {
        template: LLM_TEMPLATE.RETRIEVAL_SUFFICIENCY,
        label: intl.formatMessage({ defaultMessage: 'Retrieval sufficiency', description: 'Built-in judge name' }),
        description: intl.formatMessage({
          defaultMessage: 'Checks whether retrieved context contains enough information.',
          description: 'Built-in retrieval sufficiency judge description',
        }),
        defaultName: 'context_sufficiency',
        scope: ScorerEvaluationScope.TRACES,
        componentId: 'mlflow.experiment-scorers.catalog.retrieval-sufficiency',
      },
    ],
  },
  {
    title: intl.formatMessage({
      defaultMessage: 'Safety and policy',
      description: 'Catalog section title for safety and policy judges',
    }),
    icon: <ShieldIcon />,
    items: [
      {
        template: LLM_TEMPLATE.SAFETY,
        label: intl.formatMessage({ defaultMessage: 'Safety', description: 'Built-in judge name' }),
        description: intl.formatMessage({
          defaultMessage: 'Checks for harmful, offensive, or unsafe content.',
          description: 'Built-in safety judge description',
        }),
        defaultName: 'safety',
        scope: ScorerEvaluationScope.TRACES,
        componentId: 'mlflow.experiment-scorers.catalog.safety',
      },
      {
        template: LLM_TEMPLATE.GUIDELINES,
        label: intl.formatMessage({ defaultMessage: 'Guidelines', description: 'Built-in judge name' }),
        description: intl.formatMessage({
          defaultMessage: 'Checks whether responses follow rules you provide.',
          description: 'Built-in guidelines judge description',
        }),
        defaultName: 'guidelines',
        scope: ScorerEvaluationScope.TRACES,
        requirement: intl.formatMessage({
          defaultMessage: 'Needs guidelines',
          description: 'Requirement badge for guidelines judge',
        }),
        componentId: 'mlflow.experiment-scorers.catalog.guidelines',
      },
      {
        template: LLM_TEMPLATE.EXPECTATIONS_GUIDELINES,
        label: intl.formatMessage({ defaultMessage: 'Expectations guidelines', description: 'Built-in judge name' }),
        description: intl.formatMessage({
          defaultMessage: 'Checks per-example requirements from expectations.',
          description: 'Built-in expectations guidelines judge description',
        }),
        defaultName: 'expectations_guidelines',
        scope: ScorerEvaluationScope.TRACES,
        requirement: intl.formatMessage({
          defaultMessage: 'Needs expectations',
          description: 'Requirement badge for expectations guidelines judge',
        }),
        componentId: 'mlflow.experiment-scorers.catalog.expectations-guidelines',
      },
    ],
  },
  {
    title: intl.formatMessage({
      defaultMessage: 'Agent and tools',
      description: 'Catalog section title for agent and tool judges',
    }),
    icon: <WrenchIcon />,
    items: [
      {
        template: LLM_TEMPLATE.TOOL_CALL_CORRECTNESS,
        label: intl.formatMessage({ defaultMessage: 'Tool call correctness', description: 'Built-in judge name' }),
        description: intl.formatMessage({
          defaultMessage: 'Checks whether tool calls and arguments are correct.',
          description: 'Built-in tool call correctness judge description',
        }),
        defaultName: 'tool_call_correctness',
        scope: ScorerEvaluationScope.TRACES,
        componentId: 'mlflow.experiment-scorers.catalog.tool-call-correctness',
      },
      {
        template: LLM_TEMPLATE.TOOL_CALL_EFFICIENCY,
        label: intl.formatMessage({ defaultMessage: 'Tool call efficiency', description: 'Built-in judge name' }),
        description: intl.formatMessage({
          defaultMessage: 'Checks whether tool usage avoids redundant calls.',
          description: 'Built-in tool call efficiency judge description',
        }),
        defaultName: 'tool_call_efficiency',
        scope: ScorerEvaluationScope.TRACES,
        componentId: 'mlflow.experiment-scorers.catalog.tool-call-efficiency',
      },
      {
        template: LLM_TEMPLATE.SUMMARIZATION,
        label: intl.formatMessage({ defaultMessage: 'Summarization', description: 'Built-in judge name' }),
        description: intl.formatMessage({
          defaultMessage: 'Checks whether a summary is faithful, complete, and concise.',
          description: 'Built-in summarization judge description',
        }),
        defaultName: 'summarization',
        scope: ScorerEvaluationScope.TRACES,
        componentId: 'mlflow.experiment-scorers.catalog.summarization',
      },
    ],
  },
  {
    title: intl.formatMessage({
      defaultMessage: 'Conversations',
      description: 'Catalog section title for conversation judges',
    }),
    icon: <SpeechBubbleIcon />,
    items: [
      {
        template: LLM_TEMPLATE.CONVERSATION_COMPLETENESS,
        label: intl.formatMessage({ defaultMessage: 'Conversation completeness', description: 'Built-in judge name' }),
        description: intl.formatMessage({
          defaultMessage: 'Checks whether a session resolved the user request.',
          description: 'Built-in conversation completeness judge description',
        }),
        defaultName: 'conversation_completeness',
        scope: ScorerEvaluationScope.SESSIONS,
        componentId: 'mlflow.experiment-scorers.catalog.conversation-completeness',
      },
      {
        template: LLM_TEMPLATE.CONVERSATIONAL_SAFETY,
        label: intl.formatMessage({ defaultMessage: 'Conversational safety', description: 'Built-in judge name' }),
        description: intl.formatMessage({
          defaultMessage: 'Checks safety across assistant responses in a session.',
          description: 'Built-in conversational safety judge description',
        }),
        defaultName: 'conversational_safety',
        scope: ScorerEvaluationScope.SESSIONS,
        componentId: 'mlflow.experiment-scorers.catalog.conversational-safety',
      },
      {
        template: LLM_TEMPLATE.KNOWLEDGE_RETENTION,
        label: intl.formatMessage({ defaultMessage: 'Knowledge retention', description: 'Built-in judge name' }),
        description: intl.formatMessage({
          defaultMessage: 'Checks whether earlier user context is remembered.',
          description: 'Built-in knowledge retention judge description',
        }),
        defaultName: 'knowledge_retention',
        scope: ScorerEvaluationScope.SESSIONS,
        componentId: 'mlflow.experiment-scorers.catalog.knowledge-retention',
      },
      {
        template: LLM_TEMPLATE.USER_FRUSTRATION,
        label: intl.formatMessage({ defaultMessage: 'User frustration', description: 'Built-in judge name' }),
        description: intl.formatMessage({
          defaultMessage: 'Detects unresolved frustration in a conversation.',
          description: 'Built-in user frustration judge description',
        }),
        defaultName: 'user_frustration',
        scope: ScorerEvaluationScope.SESSIONS,
        componentId: 'mlflow.experiment-scorers.catalog.user-frustration',
      },
    ],
  },
];

const ScopeTag = ({ scope }: { scope: ScorerEvaluationScope }) => (
  <Tag componentId="mlflow.experiment-scorers.catalog.scope-tag" css={{ margin: 0 }}>
    {scope === ScorerEvaluationScope.SESSIONS ? (
      <FormattedMessage defaultMessage="Session" description="Catalog tag for session-level judges" />
    ) : (
      <FormattedMessage defaultMessage="Trace" description="Catalog tag for trace-level judges" />
    )}
  </Tag>
);

const CatalogRow = ({
  item,
  onUseBuiltInJudgeClick,
}: {
  item: BuiltInJudgeCatalogItem;
  onUseBuiltInJudgeClick: (judge: BuiltInJudgeCatalogItem) => void;
}) => {
  const { theme } = useDesignSystemTheme();

  return (
    <button
      type="button"
      data-component-id={item.componentId}
      onClick={() => onUseBuiltInJudgeClick(item)}
      css={{
        appearance: 'none',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: theme.spacing.sm,
        width: '100%',
        padding: `${theme.spacing.sm}px ${theme.spacing.md}px`,
        color: theme.colors.textPrimary,
        background: 'transparent',
        border: 'none',
        borderBottom: `1px solid ${theme.colors.border}`,
        cursor: 'pointer',
        textAlign: 'left',
        font: 'inherit',
        transition: 'background-color 0.15s',
        '&:hover': {
          backgroundColor: theme.colors.actionTertiaryBackgroundHover,
        },
        '&:focus-visible': {
          outline: `2px solid ${theme.colors.actionPrimaryBackgroundDefault}`,
          outlineOffset: '-2px',
        },
        '&:last-of-type': {
          borderBottom: 'none',
        },
      }}
    >
      <div css={{ display: 'flex', alignItems: 'flex-start', gap: theme.spacing.sm, minWidth: 0 }}>
        <SparkleDoubleIcon color="ai" css={{ flexShrink: 0, marginTop: 2 }} />
        <div css={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
          <div css={{ display: 'flex', alignItems: 'center', gap: theme.spacing.xs, flexWrap: 'wrap' }}>
            <Typography.Text bold>{item.label}</Typography.Text>
            <ScopeTag scope={item.scope} />
            {item.requirement && (
              <Tag componentId="mlflow.experiment-scorers.catalog.requirement-tag" color="indigo" css={{ margin: 0 }}>
                {item.requirement}
              </Tag>
            )}
          </div>
          <Typography.Text color="secondary" css={{ fontSize: theme.typography.fontSizeSm }}>
            {item.description}
          </Typography.Text>
        </div>
      </div>
      <div css={{ display: 'flex', alignItems: 'center', gap: theme.spacing.xs, flexShrink: 0 }}>
        <Typography.Text color="secondary" css={{ fontSize: theme.typography.fontSizeSm }}>
          <FormattedMessage defaultMessage="Use" description="Catalog action label for using a built-in judge" />
        </Typography.Text>
        <ChevronRightIcon css={{ color: theme.colors.textSecondary, fontSize: 14 }} />
      </div>
    </button>
  );
};

const CatalogSectionCard = ({
  section,
  onUseBuiltInJudgeClick,
}: {
  section: JudgeCatalogSection;
  onUseBuiltInJudgeClick: (judge: BuiltInJudgeCatalogItem) => void;
}) => {
  const { theme } = useDesignSystemTheme();

  return (
    <div
      css={{
        display: 'flex',
        flexDirection: 'column',
        border: `1px solid ${theme.colors.border}`,
        borderRadius: theme.borders.borderRadiusMd,
        overflow: 'hidden',
        minWidth: 0,
      }}
    >
      <div
        css={{
          display: 'flex',
          alignItems: 'center',
          gap: theme.spacing.sm,
          padding: `${theme.spacing.sm}px ${theme.spacing.md}px`,
          borderBottom: `1px solid ${theme.colors.border}`,
          backgroundColor: theme.colors.backgroundSecondary,
        }}
      >
        <div css={{ color: theme.colors.textSecondary, display: 'flex', fontSize: 16 }}>{section.icon}</div>
        <Typography.Text bold>{section.title}</Typography.Text>
      </div>
      <div css={{ display: 'flex', flexDirection: 'column' }}>
        {section.items.map((item) => (
          <CatalogRow key={item.template} item={item} onUseBuiltInJudgeClick={onUseBuiltInJudgeClick} />
        ))}
      </div>
    </div>
  );
};

const CustomJudgesCard = ({
  onAddLLMScorerClick,
  onAddCustomCodeScorerClick,
}: {
  onAddLLMScorerClick: () => void;
  onAddCustomCodeScorerClick: () => void;
}) => {
  const { theme } = useDesignSystemTheme();

  const rowStyles = {
    justifyContent: 'space-between',
    width: '100%',
    padding: `${theme.spacing.sm}px ${theme.spacing.md}px`,
    borderRadius: 0,
  } as const;

  return (
    <div
      css={{
        display: 'flex',
        flexDirection: 'column',
        border: `1px solid ${theme.colors.border}`,
        borderRadius: theme.borders.borderRadiusMd,
        overflow: 'hidden',
        minWidth: 0,
      }}
    >
      <div
        css={{
          display: 'flex',
          alignItems: 'center',
          gap: theme.spacing.sm,
          padding: `${theme.spacing.sm}px ${theme.spacing.md}px`,
          borderBottom: `1px solid ${theme.colors.border}`,
          backgroundColor: theme.colors.backgroundSecondary,
        }}
      >
        <GavelIcon css={{ color: theme.colors.textSecondary, fontSize: 16 }} />
        <Typography.Text bold>
          <FormattedMessage defaultMessage="Create your own" description="Catalog section title for custom judges" />
        </Typography.Text>
      </div>
      <Button
        componentId="mlflow.experiment-scorers.catalog.custom-llm"
        type="tertiary"
        icon={<PlusIcon />}
        onClick={onAddLLMScorerClick}
        css={rowStyles}
      >
        <div css={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', minWidth: 0 }}>
          <Typography.Text bold>
            <FormattedMessage defaultMessage="Custom LLM judge" description="Catalog row title for custom LLM judge" />
          </Typography.Text>
          <Typography.Text color="secondary" css={{ fontSize: theme.typography.fontSizeSm }}>
            <FormattedMessage
              defaultMessage="Write instructions with trace or session variables."
              description="Catalog row description for custom LLM judge"
            />
          </Typography.Text>
        </div>
      </Button>
      <Button
        componentId="mlflow.experiment-scorers.catalog.custom-code"
        type="tertiary"
        icon={<CodeIcon />}
        onClick={onAddCustomCodeScorerClick}
        css={{
          ...rowStyles,
          borderTop: `1px solid ${theme.colors.border}`,
        }}
      >
        <div css={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', minWidth: 0 }}>
          <Typography.Text bold>
            <FormattedMessage
              defaultMessage="Custom code judge"
              description="Catalog row title for custom code judge"
            />
          </Typography.Text>
          <Typography.Text color="secondary" css={{ fontSize: theme.typography.fontSizeSm }}>
            <FormattedMessage
              defaultMessage="Bring a Python scorer function for custom metrics."
              description="Catalog row description for custom code judge"
            />
          </Typography.Text>
        </div>
      </Button>
    </div>
  );
};

const ScorerEmptyStateRenderer: React.FC<ScorerEmptyStateRendererProps> = ({
  onUseBuiltInJudgeClick,
  onAddLLMScorerClick,
  onAddCustomCodeScorerClick,
}) => {
  const { theme } = useDesignSystemTheme();
  const intl = useIntl();
  const sections = getJudgeCatalogSections(intl);

  return (
    <div
      css={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        overflow: 'auto',
        padding: theme.spacing.lg,
        gap: theme.spacing.lg,
      }}
    >
      <div css={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: theme.spacing.sm }}>
        <GavelIcon css={{ fontSize: 36, color: theme.colors.textSecondary }} />
        <Typography.Title level={3} css={{ margin: 0 }}>
          <FormattedMessage
            defaultMessage="Use a judge to evaluate your GenAI app"
            description="Title for the empty state when no judges exist"
          />
        </Typography.Title>
        <Typography.Text color="secondary" css={{ textAlign: 'center', maxWidth: 620 }}>
          <FormattedMessage
            defaultMessage="Start from a built-in scorer catalog, or create a custom LLM or code judge for experiment-specific quality signals. {learnMore}"
            description="Description for the catalog empty state when no judges exist"
            values={{
              learnMore: (
                <Typography.Link
                  componentId="mlflow.experiment-scorers.catalog.learn-more"
                  href={getScorersDocUrl()}
                  openInNewTab
                >
                  <FormattedMessage defaultMessage="Learn more" description="Link text for scorers documentation" />
                </Typography.Link>
              ),
            }}
          />
        </Typography.Text>
      </div>

      <div
        css={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
          gap: theme.spacing.sm,
          width: '100%',
        }}
      >
        {sections.map((section) => (
          <CatalogSectionCard key={section.title} section={section} onUseBuiltInJudgeClick={onUseBuiltInJudgeClick} />
        ))}
        <CustomJudgesCard
          onAddLLMScorerClick={onAddLLMScorerClick}
          onAddCustomCodeScorerClick={onAddCustomCodeScorerClick}
        />
      </div>
    </div>
  );
};

export default ScorerEmptyStateRenderer;
