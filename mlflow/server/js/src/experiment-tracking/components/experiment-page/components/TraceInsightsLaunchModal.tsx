import { useEffect, useMemo, useState } from 'react';

import {
  AssistantIcon,
  Button,
  ChartLineIcon,
  CheckCircleIcon,
  Input,
  Modal,
  QuestionMarkIcon,
  SimpleSelect,
  SimpleSelectOption,
  Typography,
  useDesignSystemTheme,
} from '@databricks/design-system';
import AiLogoUrl from '../../../pages/experiment-insights/components/ai-logo.svg';

const { TextArea } = Input;

type TraceInsightsLaunchModalProps = {
  visible: boolean;
  initialPrompt: string;
  onCancel: () => void;
  onAnalyze?: (payload: { prompt: string; model: string }) => void;
  stats?: {
    traceCount?: number;
    estimatedCostUsd?: number;
    estimatedDurationSeconds?: number;
  };
};

const formatDuration = (seconds?: number) => {
  if (!seconds || Number.isNaN(seconds)) {
    return '~1 minute';
  }
  if (seconds < 60) {
    return '<1 minute';
  }
  if (seconds < 3600) {
    const minutes = Math.round(seconds / 60);
    return `${minutes} minute${minutes === 1 ? '' : 's'}`;
  }
  const hours = Math.round(seconds / 3600);
  return `${hours} hour${hours === 1 ? '' : 's'}`;
};

const StatTile = ({ label, value }: { label: string; value: string }) => {
  const { theme } = useDesignSystemTheme();
  return (
    <div
      css={{
        display: 'flex',
        flexDirection: 'column',
        gap: theme.spacing.xs,
        padding: `${theme.spacing.xs}px ${theme.spacing.sm}px`,
        borderRadius: theme.borders.borderRadiusSm,
        backgroundColor: theme.colors.backgroundTertiary,
      }}
    >
      <Typography.Text css={{ color: theme.colors.textSecondary }}>{label}</Typography.Text>
      <Typography.Title level={5} css={{ margin: 0 }}>
        {value}
      </Typography.Title>
    </div>
  );
};

const BenefitRow = ({ title, description, icon }: { title: string; description: string; icon: React.ReactNode }) => {
  const { theme } = useDesignSystemTheme();
  return (
    <div
      css={{
        display: 'grid',
        gridTemplateColumns: 'auto 1fr',
        gap: theme.spacing.sm,
        alignItems: 'flex-start',
      }}
    >
      <span
        css={{
          width: 28,
          height: 28,
          borderRadius: '50%',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: theme.colors.textSecondary,
        }}
      >
        {icon}
      </span>
      <div css={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <Typography.Text strong>{title}</Typography.Text>
        <Typography.Text color="secondary">
          {description}
        </Typography.Text>
      </div>
    </div>
  );
};

export const TraceInsightsLaunchModal = ({
  visible,
  initialPrompt,
  onCancel,
  onAnalyze,
  stats,
}: TraceInsightsLaunchModalProps) => {
  const { theme } = useDesignSystemTheme();
  const [prompt, setPrompt] = useState(initialPrompt);
  const [model, setModel] = useState('gpt-5');

  useEffect(() => {
    setPrompt(initialPrompt);
  }, [initialPrompt, visible]);

  const statValues = useMemo(
    () => ({
      traces: stats?.traceCount !== undefined ? stats.traceCount.toLocaleString() : '—',
      cost:
        stats?.estimatedCostUsd !== undefined
          ? `$${stats.estimatedCostUsd.toFixed(2)}`
          : '$—',
      time: formatDuration(stats?.estimatedDurationSeconds),
    }),
    [stats],
  );

  const benefits = useMemo(
    () => [
      {
        title: 'Issue Discovery',
        description: 'Automatically identify and categorize problems by severity',
        icon: <QuestionMarkIcon />,
      },
      {
        title: 'Impact Visualization',
        description: 'Understand which issues affect the most traces',
        icon: <ChartLineIcon />,
      },
      {
        title: 'Actionable Recommendations',
        description: 'Get suggested next steps to improve quality',
        icon: <AssistantIcon />,
      },
    ],
    [],
  );

  const handleAnalyze = () => {
    const trimmedPrompt = prompt.trim();
    if (!trimmedPrompt) {
      return;
    }
    onAnalyze?.({ prompt: trimmedPrompt, model });
  };

  return (
    <Modal
      componentId="mlflow.experiment.trace-insights-launch-modal"
      title={
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <img src={AiLogoUrl} alt="AI Logo" height={24} width={24} />
          Generate AI Insights
        </span>
      }
      visible={visible}
      onCancel={onCancel}
      footer={null}
      width={1040}
    >
      <div
        css={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 7fr) minmax(0, 6fr)',
          gap: theme.spacing.lg,
          alignItems: 'start',
        }}
      >
        <div css={{ display: 'flex', flexDirection: 'column', gap: theme.spacing.sm }}>
          <Typography.Paragraph css={{ marginTop: theme.spacing.xs }} color="secondary">
            Analyze selected traces with AI to identify issues and patterns
          </Typography.Paragraph>
          <div css={{ display: 'flex', flexDirection: 'column', gap: theme.spacing.xs }}>
            <Typography.Text strong>What would you like to analyze?</Typography.Text>
            <TextArea
              autoSize={{ minRows: 6, maxRows: 10 }}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Find common error patterns"
            />
          </div>

          <div css={{ display: 'flex', flexDirection: 'column', gap: theme.spacing.xs }}>
            <Typography.Text strong>LLM Model</Typography.Text>
            <SimpleSelect
              componentId="mlflow.experiment.trace-insights-launch-modal.model-select"
              value={model}
              onChange={(value) => setModel(value)}
            >
              <SimpleSelectOption value="gpt-4o">GPT-4o (Recommended)</SimpleSelectOption>
              <SimpleSelectOption value="gpt-4o-mini">GPT-4o mini</SimpleSelectOption>
              <SimpleSelectOption value="gpt-35-turbo">GPT-3.5 Turbo</SimpleSelectOption>
            </SimpleSelect>
          </div>

          <div
            css={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
              gap: theme.spacing.sm,
              border: `1px solid ${theme.colors.border}`,
              borderRadius: theme.borders.borderRadiusMd,
              padding: theme.spacing.md,
              backgroundColor: theme.colors.backgroundPrimary,
            }}
          >
            <StatTile label="Traces" value={statValues.traces} />
            <StatTile label="Est. Cost" value={statValues.cost} />
            <StatTile label="Est. Time" value={statValues.time} />
          </div>

          <div css={{ display: 'flex', justifyContent: 'flex-end', gap: theme.spacing.sm }}>
            <Button onClick={onCancel}>Cancel</Button>
            <Button type="primary" onClick={handleAnalyze} disabled={!prompt.trim()}>
              Analyze
            </Button>
          </div>
        </div>

        <div css={{ display: 'flex', flexDirection: 'column', gap: theme.spacing.md, borderLeft: `1px solid ${theme.colors.border}`, paddingLeft: theme.spacing.md }}>
          <div
            css={{
              position: 'relative',
              width: '100%',
              minHeight: 260,
              borderRadius: theme.borders.borderRadiusMd,
              overflow: 'hidden',
              border: `1px solid ${theme.colors.border}`,
              background: `linear-gradient(135deg, ${theme.colors.backgroundSecondary}, ${theme.colors.backgroundTertiary})`,
            }}
            aria-hidden
          >
            <div
              css={{
                position: 'absolute',
                inset: theme.spacing.md,
                borderRadius: theme.borders.borderRadiusSm,
                backgroundColor: theme.colors.backgroundPrimary,
                opacity: 0.7,
                boxShadow: `0 10px 30px rgba(15, 23, 42, 0.08)`,
              }}
            />
            <div
              css={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: theme.colors.textSecondary,
              }}
            >
              <Typography.Text>Insight preview placeholder</Typography.Text>
            </div>
          </div>

          <div css={{ display: 'flex', flexDirection: 'column', gap: theme.spacing.sm }}>
            <Typography.Text strong>What you&apos;ll get:</Typography.Text>
            <div css={{ display: 'flex', flexDirection: 'column', gap: theme.spacing.md }}>
              {benefits.map((benefit) => (
                <BenefitRow key={benefit.title} title={benefit.title} description={benefit.description} icon={benefit.icon} />
              ))}
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
};

export default TraceInsightsLaunchModal;
