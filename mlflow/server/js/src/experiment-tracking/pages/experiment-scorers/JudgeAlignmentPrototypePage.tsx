import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';

import { keyframes } from '@emotion/react';
import {
  ArrowDownIcon,
  ArrowUpIcon,
  Button,
  CloseIcon,
  GearIcon,
  Input,
  Modal,
  PencilIcon,
  PlayIcon,
  PlusIcon,
  Popover,
  RefreshIcon,
  SaveIcon,
  SimpleSelect,
  SimpleSelectOption,
  SparkleDoubleIcon,
  SparkleIcon,
  SpeechBubbleIcon,
  SpeechBubblePlusIcon,
  Tag,
  TextBoxIcon,
  Tooltip,
  Typography,
  VisibleOffIcon,
  useDesignSystemTheme,
} from '@databricks/design-system';
import { FormattedMessage, useIntl } from '@databricks/i18n';

import Utils from '../../../common/utils/Utils';
import { getAiGradientBorderStyle } from '../../../shared/web-shared/design-system/aiGradientBorderStyle';
import { Link, useNavigate, useParams, useSearchParams } from '../../../common/utils/RoutingUtils';
import { diffLines } from '../prompts/diff';
import { ExperimentPageTabName } from '../../constants';
import Routes from '../../routes';
import { CreateReviewQueueModal } from '../experiment-review-queue/CreateReviewQueueModal';

const JUDGE_NAME = 'response_quality';
const JUDGE_OPTIONS = [JUDGE_NAME, 'groundedness', 'safety', 'answer_relevance'];
const MODEL_OPTIONS = ['openai:/gpt-5-mini', 'openai:/gpt-5', 'databricks:/databricks-claude-sonnet-4'];

const INITIAL_INSTRUCTION = `Evaluate whether {{ outputs }} correctly answers {{ inputs }}.

Return true if the answer is accurate, complete, and useful.
Return false if the answer is incorrect, incomplete, or misleading.`;

const ALIGNED_INSTRUCTION = `${INITIAL_INSTRUCTION}

Alignment guidance:
- Unsupported factual claims should fail even when the answer is otherwise useful.
- Faithful refusals and clarification questions should pass when they avoid unsupported claims.
- Mark answers as incomplete when they omit required policy caveats or escalation steps.
- Use the reviewer rationale as the deciding evidence when examples conflict.`;

const ALIGNMENT_SUGGESTIONS = ['Add 10+ samples with human feedback.', 'Give rationale to the human feedback.'];

const ALIGNMENT_DOC_LINK = 'https://mlflow.org/docs/latest/genai/eval-monitor/scorers/';

type JudgeResult = 'PASS' | 'FAIL';

type AlignmentPhase = 'idle' | 'optimizing' | 'review';

type EditableCell = {
  rowId: string;
  field: 'inputs' | 'outputs';
} | null;

type AlignmentRow = {
  id: string;
  inputs: string;
  outputs: string;
  llmJudge: JudgeResult;
  humanJudge?: JudgeResult;
  llmRationale: string;
  humanRationale: string;
};

const hasMissingFeedback = (rows: AlignmentRow[]) => rows.some((row) => !row.humanJudge);

const withoutHumanFeedback = (rows: AlignmentRow[]) =>
  rows.map((row) => ({
    ...row,
    humanJudge: undefined,
    humanRationale: '',
  }));

const dotPulse = keyframes`
  0%, 80%, 100% {
    opacity: 0.25;
    transform: translateY(0);
  }
  40% {
    opacity: 1;
    transform: translateY(-3px);
  }
`;

const optimizationGlow = keyframes`
  0% {
    opacity: 0.35;
    transform: translateX(-45%);
  }
  50% {
    opacity: 1;
  }
  100% {
    opacity: 0.35;
    transform: translateX(45%);
  }
`;

const INITIAL_ROWS: AlignmentRow[] = [
  {
    id: 'same-day-flight',
    inputs: 'Can I expense a same-day flight change if the customer meeting moved earlier?',
    outputs: 'Yes. Same-day flight changes are always reimbursable for customer meetings.',
    llmJudge: 'PASS',
    humanJudge: 'FAIL',
    llmRationale: 'The answer is direct and appears useful for the travel-policy question.',
    humanRationale: 'It overstates policy. Same-day changes need manager approval and reason documentation.',
  },
  {
    id: 'missing-policy',
    inputs: 'What should I do if the return policy is not in the retrieved context?',
    outputs: 'I do not have enough policy context to answer that. Please check the current return policy.',
    llmJudge: 'FAIL',
    humanJudge: 'PASS',
    llmRationale: 'The answer does not provide concrete return steps.',
    humanRationale: 'Faithful uncertainty is correct when the policy is not in context.',
  },
  {
    id: 'refund-steps',
    inputs: 'Summarize the refund steps from this support article.',
    outputs: 'Open the billing page, choose the order, select Request refund, and submit the reason.',
    llmJudge: 'PASS',
    humanJudge: 'PASS',
    llmRationale: 'The output covers each step in the source article without adding claims.',
    humanRationale: 'Complete and grounded in the article.',
  },
  {
    id: 'sla-weekend',
    inputs: 'Does premium support guarantee a 1-hour resolution on weekends?',
    outputs: 'Yes, premium support guarantees resolution within 1 hour every day.',
    llmJudge: 'PASS',
    humanJudge: 'FAIL',
    llmRationale: 'The answer states the requested SLA clearly.',
    humanRationale: 'The policy only guarantees first response within 1 hour, not resolution.',
  },
  {
    id: 'clarify-plan',
    inputs: 'Can I use audit log export on my plan?',
    outputs: 'Which plan are you on? Audit log export availability depends on the plan tier.',
    llmJudge: 'FAIL',
    humanJudge: 'PASS',
    llmRationale: 'The answer does not provide a yes or no verdict.',
    humanRationale: 'A clarification question is appropriate because plan tier is missing.',
  },
  {
    id: 'account-delete',
    inputs: 'How do I delete my account?',
    outputs: 'Go to Account settings, open Security, choose Delete account, and confirm the deletion email.',
    llmJudge: 'PASS',
    humanJudge: 'PASS',
    llmRationale: 'The answer gives the same sequence as the help-center article.',
    humanRationale: 'Accurate, concise, and includes the email confirmation step.',
  },
  {
    id: 'tax-advice',
    inputs: 'Should I classify this contractor as a W-2 employee for taxes?',
    outputs: 'Yes. Contractors working more than 20 hours per week should be classified as W-2 employees.',
    llmJudge: 'PASS',
    humanJudge: 'FAIL',
    llmRationale: 'The answer is specific and seems to resolve the user question.',
    humanRationale: 'This is legal/tax advice and invents a threshold not present in the retrieved policy.',
  },
  {
    id: 'password-reset',
    inputs: 'Where can an admin reset a user password?',
    outputs: 'Admins can reset passwords from Admin console > Users > select user > Reset password.',
    llmJudge: 'PASS',
    humanJudge: 'PASS',
    llmRationale: 'The output names the exact navigation path from the admin guide.',
    humanRationale: 'Correct path and no unnecessary extra details.',
  },
  {
    id: 'security-incident',
    inputs: 'Who do I notify for a suspected data exposure?',
    outputs: 'Post in the general support channel and wait for the support team to triage it.',
    llmJudge: 'PASS',
    humanJudge: 'FAIL',
    llmRationale: 'The answer offers a concrete escalation path.',
    humanRationale: 'Security incidents must go to the security incident hotline, not a general channel.',
  },
  {
    id: 'outage-status',
    inputs: 'Is there an outage right now?',
    outputs: 'I cannot verify live status from this context. Check the status page for the current outage state.',
    llmJudge: 'FAIL',
    humanJudge: 'PASS',
    llmRationale: 'The answer does not directly state whether there is an outage.',
    humanRationale: 'The response avoids fabricating live operational status.',
  },
  {
    id: 'retention-window',
    inputs: 'How long are exported reports retained?',
    outputs: 'Exported reports are retained for 30 days, then permanently deleted.',
    llmJudge: 'PASS',
    humanJudge: 'FAIL',
    llmRationale: 'The answer provides a clear retention window.',
    humanRationale: 'The source says 30 days for standard reports and 90 days for compliance exports.',
  },
  {
    id: 'billing-owner',
    inputs: 'Who can change the billing owner?',
    outputs: 'Only workspace admins can transfer billing ownership from billing settings.',
    llmJudge: 'FAIL',
    humanJudge: undefined,
    llmRationale: 'The answer omits account-owner approval details.',
    humanRationale: '',
  },
];

const DATASET_SAMPLE_ROWS = withoutHumanFeedback(INITIAL_ROWS.slice(0, 5));
const TRACE_SAMPLE_ROWS = INITIAL_ROWS.slice(5, 10);
const EVALUATION_PREFILL_ROWS = INITIAL_ROWS;

const ASSET_CLASS_EVALUATION_ROWS: AlignmentRow[] = [
  {
    id: 'asset-class-eval-1',
    inputs: 'Can I keep this emergency reserve in short-term bonds without taking equity risk?',
    outputs: 'A broad equity index fund is appropriate because stocks provide long-term upside.',
    llmJudge: 'PASS',
    humanJudge: 'FAIL',
    llmRationale: 'The answer gives a concrete investment recommendation.',
    humanRationale: 'The response substitutes equities for a bond/cash-equivalent question.',
  },
  {
    id: 'asset-class-eval-2',
    inputs: 'Which bond fund option is least sensitive to rate changes?',
    outputs: 'Large-cap equities are usually less volatile than small-cap growth.',
    llmJudge: 'PASS',
    humanJudge: 'FAIL',
    llmRationale: 'The response discusses relative volatility.',
    humanRationale: 'The answer ignores bond duration and changes the asset class to equities.',
  },
  {
    id: 'asset-class-eval-3',
    inputs: 'Is a cash sweep account better than a municipal bond ladder for taxes?',
    outputs: 'Dividend-paying stocks can improve tax efficiency for taxable accounts.',
    llmJudge: 'PASS',
    humanJudge: 'FAIL',
    llmRationale: 'The answer discusses taxable-account efficiency.',
    humanRationale: 'The answer is unsupported by the retrieved cash sweep and municipal bond context.',
  },
  {
    id: 'asset-class-eval-4',
    inputs: 'Can I use T-bills as a low-risk parking place for cash?',
    outputs: 'Yes. T-bills are cash equivalents and avoid equity-market exposure.',
    llmJudge: 'FAIL',
    humanJudge: 'PASS',
    llmRationale: 'The answer is short and lacks a portfolio allocation.',
    humanRationale: 'The answer preserves the requested asset class and avoids equity recommendations.',
  },
];

const cloneAlignmentRows = (rows: AlignmentRow[]) => rows.map((row) => ({ ...row }));

const applyTraceIdsToRows = (rows: AlignmentRow[], traceIdsParam: string | null): AlignmentRow[] => {
  const traceIds =
    traceIdsParam
      ?.split(',')
      .map((traceId) => traceId.trim())
      .filter(Boolean) ?? [];
  if (!traceIds.length) {
    return rows;
  }
  return rows.map((row, index) => ({
    ...row,
    id: traceIds[index] ?? row.id,
  }));
};

const getRowsForPrefillSource = (
  prefillSource: string | null,
  judgeName?: string,
  traceIdsParam?: string | null,
): AlignmentRow[] => {
  if (prefillSource === 'eval' || prefillSource === 'evaluation') {
    const rows =
      judgeName === 'asset_class_consistency' || judgeName === 'retrieval_answer_alignment'
        ? ASSET_CLASS_EVALUATION_ROWS
        : EVALUATION_PREFILL_ROWS;
    return applyTraceIdsToRows(cloneAlignmentRows(rows), traceIdsParam ?? null);
  }
  if (prefillSource === 'dataset') {
    return cloneAlignmentRows(DATASET_SAMPLE_ROWS);
  }
  if (prefillSource === 'traces') {
    return cloneAlignmentRows(TRACE_SAMPLE_ROWS);
  }
  return [];
};

const getInstructionForPrefill = (judgeName: string, prefillSource: string | null): string => {
  if (judgeName === 'asset_class_consistency') {
    return `Evaluate whether {{ outputs }} preserves the asset class requested in {{ inputs }}.

Return true only when the answer stays in the requested bond, cash-equivalent, or municipal-bond context.
Return false if the answer substitutes equities, stocks, dividends, or unrelated investment categories.
Use retrieved evidence and expectations as the source of truth when deciding whether the answer changed asset class.`;
  }
  if (judgeName === 'retrieval_answer_alignment') {
    return `Evaluate whether {{ outputs }} is supported by the retrieved evidence for {{ inputs }}.

Return true only when the answer's investment recommendation is grounded in the retrieved passages.
Return false if the answer introduces recommendations that are absent from, or contradicted by, retrieved evidence.
Pay special attention to answers that switch from cash or bond context to equity recommendations.`;
  }
  if (prefillSource === 'eval' || prefillSource === 'evaluation') {
    return `Evaluate whether {{ outputs }} should pass for the selected evaluation run.

Return true when the answer satisfies the human expectation for the trace.
Return false when the answer repeats the failure pattern identified by the evaluation result.
Use reviewed trace examples and human rationale as the deciding evidence.`;
  }
  return INITIAL_INSTRUCTION;
};

const ResultTag = ({ value }: { value: JudgeResult }) => (
  <Tag
    componentId="mlflow.experiment-scorers.judge-alignment-result"
    color={value === 'PASS' ? 'turquoise' : 'coral'}
    css={{ margin: 0 }}
  >
    {value}
  </Tag>
);

const HumanResultTag = ({ value, onFlip }: { value: JudgeResult; onFlip: () => void }) => {
  const { theme } = useDesignSystemTheme();
  const flipIconColor =
    value === 'PASS'
      ? theme.isDarkMode
        ? theme.colors.green400
        : theme.colors.green600
      : theme.isDarkMode
        ? theme.colors.red400
        : theme.colors.red600;

  const handleKeyDown = (event: KeyboardEvent<HTMLSpanElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onFlip();
    }
  };

  return (
    <Tooltip
      componentId="mlflow.experiment-scorers.judge-alignment-flip-human-tooltip"
      content={
        <FormattedMessage defaultMessage="Flip human result" description="Tooltip for flip human result button" />
      }
    >
      <Tag
        componentId="mlflow.experiment-scorers.judge-alignment-human-result"
        color={value === 'PASS' ? 'turquoise' : 'coral'}
        role="button"
        tabIndex={0}
        aria-label="Flip human result"
        onClick={onFlip}
        onKeyDown={handleKeyDown}
        css={{
          margin: 0,
          cursor: 'pointer',
          display: 'inline-flex',
          alignItems: 'center',
          gap: theme.spacing.sm,
          userSelect: 'none',
          '&:hover .judge-alignment-human-flip-icon, &:focus .judge-alignment-human-flip-icon': {
            opacity: 1,
          },
        }}
      >
        <span>{value}</span>
        <span
          className="judge-alignment-human-flip-icon"
          aria-hidden
          css={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 16,
            height: 16,
            color: flipIconColor,
            opacity: 0,
            transition: 'opacity 120ms ease-in-out',
            svg: {
              width: 10,
              height: 10,
            },
          }}
        >
          <RefreshIcon />
        </span>
      </Tag>
    </Tooltip>
  );
};

const LoadingDots = ({ withLeadingSpace = true }: { withLeadingSpace?: boolean }) => {
  const { theme } = useDesignSystemTheme();

  return (
    <span
      aria-hidden
      css={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 3,
        marginLeft: withLeadingSpace ? theme.spacing.xs : 0,
        verticalAlign: 'middle',
      }}
    >
      {[0, 1, 2].map((index) => (
        <span
          key={index}
          css={{
            width: 4,
            height: 4,
            borderRadius: '50%',
            backgroundColor: 'currentColor',
            animation: `${dotPulse} 1.1s ease-in-out ${index * 0.14}s infinite`,
          }}
        />
      ))}
    </span>
  );
};

const InstructionHeader = ({ icon, title }: { icon: ReactNode; title: ReactNode }) => {
  const { theme } = useDesignSystemTheme();

  return (
    <div css={{ display: 'flex', alignItems: 'center', gap: theme.spacing.xs }}>
      {icon}
      <Typography.Text bold>{title}</Typography.Text>
    </div>
  );
};

const OptimizingInstructionPanel = () => {
  const { theme } = useDesignSystemTheme();

  return (
    <div
      css={{
        minHeight: 280,
        border: `1px solid ${theme.colors.blue300}`,
        borderRadius: theme.borders.borderRadiusMd,
        backgroundColor: theme.isDarkMode ? theme.colors.blue800 : theme.colors.blue100,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      <div
        css={{
          position: 'absolute',
          top: 0,
          bottom: 0,
          width: '38%',
          background: `linear-gradient(90deg, transparent, ${theme.colors.blue300}, transparent)`,
          animation: `${optimizationGlow} 1.8s ease-in-out infinite`,
        }}
      />
      <div
        css={{
          position: 'relative',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: theme.spacing.sm,
          color: theme.colors.textPrimary,
        }}
      >
        <SparkleDoubleIcon color="ai" css={{ fontSize: 28 }} />
        <Typography.Text bold>
          <FormattedMessage
            defaultMessage="Optimizing judge prompt"
            description="Loading text while optimizing judge prompt"
          />
          <LoadingDots />
        </Typography.Text>
        <Typography.Text color="secondary">
          <FormattedMessage
            defaultMessage="Reviewing disagreements and human rationale"
            description="Subtitle for judge prompt optimization loading state"
          />
        </Typography.Text>
      </div>
    </div>
  );
};

const InstructionReviewPanel = ({
  originalInstruction,
  suggestedInstruction,
  onAccept,
  onDismiss,
}: {
  originalInstruction: string;
  suggestedInstruction: string;
  onAccept: () => void;
  onDismiss: () => void;
}) => {
  const { theme } = useDesignSystemTheme();

  const panelBaseCss = {
    padding: theme.spacing.md,
    display: 'flex',
    flexDirection: 'column' as const,
    gap: theme.spacing.sm,
    minWidth: 0,
  };

  const preCss = {
    margin: 0,
    whiteSpace: 'pre-wrap' as const,
    wordBreak: 'break-word' as const,
    fontFamily: 'monospace',
    fontSize: theme.typography.fontSizeSm,
    lineHeight: theme.typography.lineHeightBase,
    color: theme.colors.textPrimary,
  };

  return (
    <div
      css={{
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)',
        minHeight: 280,
        border: `1px solid ${theme.colors.border}`,
        borderRadius: theme.borders.borderRadiusMd,
        overflow: 'hidden',
      }}
    >
      <div
        css={{
          ...panelBaseCss,
          backgroundColor: theme.colors.backgroundPrimary,
          borderRight: `1px solid ${theme.colors.border}`,
        }}
      >
        <Typography.Text bold>
          <FormattedMessage defaultMessage="Original" description="Original judge instruction panel title" />
        </Typography.Text>
        <pre css={preCss}>{originalInstruction}</pre>
      </div>
      <div
        css={{
          ...panelBaseCss,
          backgroundColor: theme.isDarkMode ? theme.colors.blue800 : theme.colors.blue100,
        }}
      >
        <div css={{ display: 'flex', alignItems: 'center', gap: theme.spacing.xs }}>
          <SparkleDoubleIcon color="ai" />
          <Typography.Text bold>
            <FormattedMessage defaultMessage="AI Suggestion" description="AI suggested judge instruction panel title" />
          </Typography.Text>
        </div>
        <pre css={{ ...preCss, flex: 1 }}>{suggestedInstruction}</pre>
        <div css={{ display: 'flex', justifyContent: 'flex-end', gap: theme.spacing.sm }}>
          <Button
            componentId="mlflow.experiment-scorers.judge-alignment-dismiss-suggested-instruction"
            onClick={onDismiss}
          >
            <FormattedMessage defaultMessage="Dismiss" description="Dismiss suggested judge instruction button label" />
          </Button>
          <Button
            componentId="mlflow.experiment-scorers.judge-alignment-accept-suggested-instruction"
            type="primary"
            onClick={onAccept}
          >
            <FormattedMessage defaultMessage="Accept" description="Accept suggested judge instruction button label" />
          </Button>
        </div>
      </div>
    </div>
  );
};

const PromptLineDiff = ({ baselineValue, comparedValue }: { baselineValue: string; comparedValue: string }) => {
  const { theme } = useDesignSystemTheme();
  const diff = useMemo(() => diffLines(baselineValue, comparedValue) ?? [], [baselineValue, comparedValue]);

  const rows = diff.flatMap((part, partIndex) => {
    const lines = part.value.split('\n');
    if (lines[lines.length - 1] === '') {
      lines.pop();
    }
    return lines.map((line, lineIndex) => ({
      key: `${partIndex}-${lineIndex}`,
      line,
      type: part.added ? 'added' : part.removed ? 'removed' : 'unchanged',
    }));
  });

  const colors = {
    addedBackground: theme.isDarkMode ? theme.colors.green700 : theme.colors.green100,
    removedBackground: theme.isDarkMode ? theme.colors.red700 : theme.colors.red100,
    addedText: theme.isDarkMode ? theme.colors.green300 : theme.colors.green700,
    removedText: theme.isDarkMode ? theme.colors.red300 : theme.colors.red700,
  };

  return (
    <div
      css={{
        border: `1px solid ${theme.colors.border}`,
        borderRadius: theme.borders.borderRadiusSm,
        overflow: 'auto',
        maxHeight: 320,
        backgroundColor: theme.colors.backgroundSecondary,
        fontFamily: 'monospace',
        fontSize: theme.typography.fontSizeSm,
        lineHeight: theme.typography.lineHeightBase,
      }}
    >
      {rows.map((row) => {
        const isAdded = row.type === 'added';
        const isRemoved = row.type === 'removed';
        return (
          <div
            key={row.key}
            css={{
              display: 'grid',
              gridTemplateColumns: '24px minmax(0, 1fr)',
              gap: theme.spacing.xs,
              padding: `1px ${theme.spacing.sm}px`,
              backgroundColor: isAdded ? colors.addedBackground : isRemoved ? colors.removedBackground : 'transparent',
              color: isAdded ? colors.addedText : isRemoved ? colors.removedText : theme.colors.textPrimary,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}
          >
            <span>{isAdded ? '+' : isRemoved ? '-' : ' '}</span>
            <span>{row.line || ' '}</span>
          </div>
        );
      })}
    </div>
  );
};

const RationalePopover = ({
  title,
  rationale,
  editable,
  onChange,
}: {
  title: ReactNode;
  rationale: string;
  editable?: boolean;
  onChange?: (value: string) => void;
}) => {
  const { theme } = useDesignSystemTheme();
  const [isOpen, setIsOpen] = useState(false);

  return (
    <Popover.Root
      componentId="mlflow.experiment-scorers.judge-alignment-rationale-popover"
      open={isOpen}
      onOpenChange={setIsOpen}
    >
      <Popover.Trigger asChild>
        <Button
          componentId="mlflow.experiment-scorers.judge-alignment-rationale"
          size="small"
          type="tertiary"
          icon={<SpeechBubbleIcon />}
          aria-label="Show rationale"
          onMouseEnter={() => setIsOpen(true)}
          onFocus={() => setIsOpen(true)}
          onClick={(event) => {
            event.preventDefault();
            setIsOpen(true);
          }}
        />
      </Popover.Trigger>
      <Popover.Content side="bottom" align="start">
        <div
          css={{
            display: 'flex',
            flexDirection: 'column',
            gap: theme.spacing.sm,
            width: 320,
            maxWidth: 320,
          }}
        >
          <Typography.Text bold>{title}</Typography.Text>
          {editable ? (
            <Input.TextArea
              componentId="mlflow.experiment-scorers.judge-alignment-human-rationale"
              value={rationale}
              rows={4}
              onKeyDown={(event) => event.stopPropagation()}
              onChange={(event) => onChange?.(event.target.value)}
            />
          ) : (
            <Typography.Text>{rationale}</Typography.Text>
          )}
        </div>
        <Popover.Arrow />
      </Popover.Content>
    </Popover.Root>
  );
};

const EditableTextCell = ({
  value,
  isEditing,
  onEdit,
  onDone,
  onChange,
}: {
  value: string;
  isEditing: boolean;
  onEdit: () => void;
  onDone: () => void;
  onChange: (value: string) => void;
}) => {
  const { theme } = useDesignSystemTheme();

  if (isEditing) {
    return (
      <Input.TextArea
        componentId="mlflow.experiment-scorers.judge-alignment-editable-cell"
        value={value}
        autoSize={{ minRows: 3, maxRows: 7 }}
        autoFocus
        onBlur={onDone}
        onKeyDown={(event) => event.stopPropagation()}
        onChange={(event) => onChange(event.target.value)}
      />
    );
  }

  return (
    <div
      css={{
        position: 'relative',
        minHeight: 72,
        paddingRight: theme.spacing.lg,
        '&:hover .judge-alignment-edit-cell': {
          opacity: 1,
        },
      }}
    >
      <Typography.Text>{value}</Typography.Text>
      <Button
        componentId="mlflow.experiment-scorers.judge-alignment-edit-cell"
        className="judge-alignment-edit-cell"
        size="small"
        type="tertiary"
        icon={<PencilIcon />}
        aria-label="Edit cell"
        onClick={onEdit}
        css={{
          opacity: 0,
          position: 'absolute',
          top: -theme.spacing.xs,
          right: -theme.spacing.xs,
        }}
      />
    </div>
  );
};

const ExamplesEmptyState = ({
  onLoadDataset,
  onSelectTraces,
  onManualAdd,
}: {
  onLoadDataset: () => void;
  onSelectTraces: () => void;
  onManualAdd: () => void;
}) => {
  const { theme } = useDesignSystemTheme();

  return (
    <div
      css={{
        border: `1px solid ${theme.colors.border}`,
        borderRadius: theme.borders.borderRadiusMd,
        minHeight: 240,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: theme.spacing.md,
        backgroundColor: theme.colors.backgroundSecondary,
        padding: theme.spacing.lg,
        textAlign: 'center',
      }}
    >
      <div css={{ display: 'flex', flexDirection: 'column', gap: theme.spacing.xs, maxWidth: 520 }}>
        <Typography.Text bold>
          <FormattedMessage defaultMessage="No examples yet" description="Empty state title for alignment examples" />
        </Typography.Text>
        <Typography.Text color="secondary">
          <FormattedMessage
            defaultMessage="Add examples with inputs, outputs, and human feedback before aligning this judge."
            description="Empty state description for alignment examples"
          />
        </Typography.Text>
      </div>
      <div
        css={{
          display: 'flex',
          alignItems: 'center',
          gap: theme.spacing.sm,
          flexWrap: 'wrap',
          justifyContent: 'center',
        }}
      >
        <Button componentId="mlflow.experiment-scorers.judge-alignment-load-dataset" onClick={onLoadDataset}>
          <FormattedMessage defaultMessage="Load dataset" description="Load dataset empty state action" />
        </Button>
        <Button componentId="mlflow.experiment-scorers.judge-alignment-select-traces" onClick={onSelectTraces}>
          <FormattedMessage defaultMessage="Select traces" description="Select traces empty state action" />
        </Button>
        <Button
          componentId="mlflow.experiment-scorers.judge-alignment-manual-add"
          icon={<PlusIcon />}
          onClick={onManualAdd}
        >
          <FormattedMessage defaultMessage="Manually add" description="Manually add empty state action" />
        </Button>
      </div>
    </div>
  );
};

const JudgeAlignmentPrototypePage = () => {
  const { theme } = useDesignSystemTheme();
  const intl = useIntl();
  const navigate = useNavigate();
  const { experimentId } = useParams();
  const [searchParams] = useSearchParams();
  const selectedJudgeName = searchParams.get('scorerName') ?? '';
  const hasSelectedJudge = Boolean(selectedJudgeName);
  const judgeName = selectedJudgeName || JUDGE_NAME;
  const prefillSource = searchParams.get('prefill');
  const prefillTraceIds = searchParams.get('traceIds');
  const initialInstruction = useMemo(
    () => getInstructionForPrefill(selectedJudgeName, prefillSource),
    [prefillSource, selectedJudgeName],
  );

  const [savedInstruction, setSavedInstruction] = useState(initialInstruction);
  const [instruction, setInstruction] = useState(initialInstruction);
  const [savedModel, setSavedModel] = useState(MODEL_OPTIONS[0]);
  const [model, setModel] = useState(MODEL_OPTIONS[0]);
  const [savedVersion, setSavedVersion] = useState(5);
  const [rows, setRows] = useState<AlignmentRow[]>(() =>
    getRowsForPrefillSource(prefillSource, selectedJudgeName, prefillTraceIds),
  );
  const [loadingRowIds, setLoadingRowIds] = useState<Set<string>>(new Set());
  const [isJudgeRunning, setIsJudgeRunning] = useState(false);
  const [alignmentPhase, setAlignmentPhase] = useState<AlignmentPhase>('idle');
  const [showSuggestions, setShowSuggestions] = useState(() =>
    hasMissingFeedback(getRowsForPrefillSource(prefillSource, selectedJudgeName, prefillTraceIds)),
  );
  const [editingCell, setEditingCell] = useState<EditableCell>(null);
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [showReviewQueueModal, setShowReviewQueueModal] = useState(false);
  const [showDiff, setShowDiff] = useState(false);
  const [commitMessage, setCommitMessage] = useState('');
  const [mutedRowIds, setMutedRowIds] = useState<Set<string>>(new Set());
  const judgeRunTimeouts = useRef<ReturnType<typeof setTimeout>[]>([]);
  const alignmentTimeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pageScrollRef = useRef<HTMLDivElement | null>(null);
  const instructionSectionRef = useRef<HTMLElement | null>(null);
  const tableSectionRef = useRef<HTMLDivElement | null>(null);

  const judgeOptions = useMemo(
    () =>
      selectedJudgeName && !JUDGE_OPTIONS.includes(selectedJudgeName)
        ? [selectedJudgeName, ...JUDGE_OPTIONS]
        : JUDGE_OPTIONS,
    [selectedJudgeName],
  );

  useEffect(
    () => () => {
      judgeRunTimeouts.current.forEach(clearTimeout);
      if (alignmentTimeout.current) {
        clearTimeout(alignmentTimeout.current);
      }
    },
    [],
  );

  useEffect(() => {
    const nextRows = getRowsForPrefillSource(prefillSource, selectedJudgeName, prefillTraceIds);
    setRows(nextRows);
    setLoadingRowIds(new Set());
    setMutedRowIds(new Set());
    setShowSuggestions(hasMissingFeedback(nextRows));
    setEditingCell(null);
  }, [prefillSource, prefillTraceIds, selectedJudgeName]);

  useEffect(() => {
    setSavedInstruction(initialInstruction);
    setInstruction(initialInstruction);
    setSavedModel(MODEL_OPTIONS[0]);
    setModel(MODEL_OPTIONS[0]);
    setSavedVersion(5);
    setAlignmentPhase('idle');
    setShowSaveModal(false);
    setShowDiff(false);
    setCommitMessage('');
  }, [initialInstruction, selectedJudgeName]);

  const isDraft = hasSelectedJudge && (instruction !== savedInstruction || model !== savedModel);
  const nextVersion = savedVersion + 1;
  const hasMissingHumanFeedback = hasMissingFeedback(rows);
  const allRowsMuted = rows.length > 0 && rows.every((row) => mutedRowIds.has(row.id));
  const judgeLinkRoute = experimentId
    ? Routes.getExperimentPageTabRoute(experimentId, ExperimentPageTabName.Judges)
    : undefined;

  const handleJudgeSelect = (nextJudgeName: string) => {
    if (!experimentId || !nextJudgeName) {
      return;
    }
    navigate(
      Routes.getExperimentPageTabScorerAlignmentRoute(experimentId, {
        scorerName: nextJudgeName,
        prefill: prefillSource ?? undefined,
      }),
    );
  };

  const scrollToSection = (targetElement: HTMLElement | null, offset = theme.spacing.md) => {
    if (!pageScrollRef.current || !targetElement) {
      return;
    }

    const containerRect = pageScrollRef.current.getBoundingClientRect();
    const targetRect = targetElement.getBoundingClientRect();
    const top = pageScrollRef.current.scrollTop + targetRect.top - containerRect.top - offset;
    pageScrollRef.current.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
  };

  const runJudge = () => {
    if (!hasSelectedJudge) {
      scrollToSection(instructionSectionRef.current);
      return;
    }
    window.requestAnimationFrame(() => {
      scrollToSection(tableSectionRef.current);
    });
    judgeRunTimeouts.current.forEach(clearTimeout);
    judgeRunTimeouts.current = [];

    const rowsToRun = rows.filter((row) => !mutedRowIds.has(row.id));
    if (rowsToRun.length === 0) {
      setIsJudgeRunning(false);
      setLoadingRowIds(new Set());
      return;
    }

    setShowSuggestions(true);
    const instructionSnapshot = instruction;
    const loadingIds = new Set(rowsToRun.map((row) => row.id));
    setLoadingRowIds(loadingIds);
    setIsJudgeRunning(true);

    let maxDelay = 0;
    rowsToRun.forEach((row) => {
      const delay = 1000 + Math.round(Math.random() * 4000);
      maxDelay = Math.max(maxDelay, delay);
      const timeout = setTimeout(() => {
        setRows((existingRows) =>
          existingRows.map((existingRow) => {
            if (existingRow.id !== row.id) {
              return existingRow;
            }

            const initialRow = INITIAL_ROWS.find(({ id }) => id === row.id);
            const hasAlignedInstruction = instructionSnapshot.includes('Alignment guidance:');
            const humanJudge = existingRow.humanJudge ?? initialRow?.humanJudge ?? 'PASS';
            let nextResult: JudgeResult;
            if (hasAlignedInstruction) {
              if (Math.random() > 0.15) {
                nextResult = humanJudge;
              } else {
                nextResult = humanJudge === 'PASS' ? 'FAIL' : 'PASS';
              }
            } else if (Math.random() > 0.25) {
              nextResult = initialRow?.llmJudge ?? (Math.random() > 0.5 ? 'PASS' : 'FAIL');
            } else {
              nextResult = humanJudge;
            }

            return {
              ...existingRow,
              llmJudge: nextResult,
              llmRationale: hasAlignedInstruction
                ? 'Re-run with aligned guidance. The verdict follows the reviewed human rationale.'
                : 'Re-run with the current instruction. The verdict reflects the current judge prompt.',
            };
          }),
        );
        setLoadingRowIds((existingIds) => {
          const nextIds = new Set(existingIds);
          nextIds.delete(row.id);
          return nextIds;
        });
      }, delay);
      judgeRunTimeouts.current.push(timeout);
    });

    const completionTimeout = setTimeout(() => {
      setIsJudgeRunning(false);
      setLoadingRowIds(new Set());
    }, maxDelay + 150);
    judgeRunTimeouts.current.push(completionTimeout);
  };

  const alignJudgePrompt = () => {
    scrollToSection(instructionSectionRef.current);
    if (!hasSelectedJudge) {
      return;
    }
    if (alignmentPhase === 'optimizing') {
      return;
    }
    if (alignmentTimeout.current) {
      clearTimeout(alignmentTimeout.current);
    }
    setAlignmentPhase('optimizing');
    alignmentTimeout.current = setTimeout(
      () => {
        setAlignmentPhase('review');
      },
      1800 + Math.round(Math.random() * 1700),
    );
  };

  const updateRow = (rowId: string, updater: (row: AlignmentRow) => AlignmentRow) => {
    setRows((existingRows) => existingRows.map((row) => (row.id === rowId ? updater(row) : row)));
  };

  const updateRowField = (rowId: string, field: 'inputs' | 'outputs' | 'humanRationale', value: string) => {
    updateRow(rowId, (row) => ({ ...row, [field]: value }));
  };

  const flipHumanJudge = (rowId: string) => {
    updateRow(rowId, (row) => ({
      ...row,
      humanJudge: row.humanJudge === 'PASS' ? 'FAIL' : 'PASS',
    }));
  };

  const setHumanJudge = (rowId: string, value: JudgeResult) => {
    updateRow(rowId, (row) => ({ ...row, humanJudge: value }));
  };

  const toggleRowMuted = (rowId: string) => {
    setMutedRowIds((existingIds) => {
      const nextIds = new Set(existingIds);
      if (nextIds.has(rowId)) {
        nextIds.delete(rowId);
      } else {
        nextIds.add(rowId);
      }
      return nextIds;
    });
  };

  const toggleAllRowsMuted = () => {
    setMutedRowIds(allRowsMuted ? new Set() : new Set(rows.map((row) => row.id)));
  };

  const addRow = () => {
    const rowNumber = rows.length + 1;
    setRows((existingRows) => [
      ...existingRows,
      {
        id: `new-example-${Date.now()}`,
        inputs: `New input ${rowNumber}`,
        outputs: `New output ${rowNumber}`,
        llmJudge: 'PASS',
        humanJudge: 'PASS',
        llmRationale: 'Run the judge to populate rationale for this example.',
        humanRationale: 'Add reviewer rationale.',
      },
    ]);
  };

  const loadExampleRows = (nextRows: AlignmentRow[]) => {
    setRows(cloneAlignmentRows(nextRows));
    setLoadingRowIds(new Set());
    setMutedRowIds(new Set());
    setShowSuggestions(hasMissingFeedback(nextRows));
    window.requestAnimationFrame(() => {
      scrollToSection(tableSectionRef.current);
    });
  };

  const handleSave = () => {
    const savedNextVersion = nextVersion;
    setSavedInstruction(instruction);
    setSavedModel(model);
    setSavedVersion(savedNextVersion);
    setShowSaveModal(false);
    setShowDiff(false);
    setCommitMessage('');
    Utils.displayGlobalInfoNotification(
      <span css={{ whiteSpace: 'nowrap' }}>
        {intl.formatMessage({
          defaultMessage: 'Judge saved.',
          description: 'Success toast after saving judge alignment changes',
        })}{' '}
        {judgeLinkRoute && (
          <Link componentId="mlflow.experiment-scorers.judge-alignment-toast-use-judge" to={judgeLinkRoute}>
            {intl.formatMessage({
              defaultMessage: 'Use the judge',
              description: 'Success toast link to the judge tab after saving judge alignment changes',
            })}
          </Link>
        )}
      </span>,
      3,
    );
  };

  const acceptSuggestedInstruction = () => {
    setInstruction(ALIGNED_INSTRUCTION);
    setAlignmentPhase('idle');
  };

  const dismissSuggestedInstruction = () => {
    setAlignmentPhase('idle');
  };

  return (
    <>
      <div
        ref={pageScrollRef}
        css={{
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          minHeight: 0,
          overflow: 'auto',
          backgroundColor: theme.colors.backgroundPrimary,
        }}
      >
        <div
          css={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: theme.spacing.md,
            padding: `${theme.spacing.sm}px ${theme.spacing.md}px`,
          }}
        >
          <div css={{ display: 'flex', alignItems: 'center', gap: theme.spacing.xs, flexWrap: 'wrap' }}>
            <Typography.Text>
              <FormattedMessage defaultMessage="Edit" description="Lead-in text before judge selector" />
            </Typography.Text>
            <SimpleSelect
              id="mlflow.experiment-scorers.judge-alignment-judge-select"
              componentId="mlflow.experiment-scorers.judge-alignment-judge-select"
              value={selectedJudgeName}
              css={{ width: 220 }}
              onChange={(event) => handleJudgeSelect(event.target.value)}
            >
              <SimpleSelectOption value="">
                {intl.formatMessage({
                  defaultMessage: 'Select judge',
                  description: 'Placeholder option in judge alignment judge selector',
                })}
              </SimpleSelectOption>
              {judgeOptions.map((option) => (
                <SimpleSelectOption key={option} value={option}>
                  {option}
                </SimpleSelectOption>
              ))}
            </SimpleSelect>
            <Typography.Text>
              <FormattedMessage
                defaultMessage="and use AI alignment with reviewed human feedback."
                description="Judge alignment page heading after judge selector"
              />
            </Typography.Text>
            <Typography.Link
              componentId="mlflow.experiment-scorers.judge-alignment-how-to-use-link"
              href={ALIGNMENT_DOC_LINK}
              openInNewTab
            >
              <FormattedMessage defaultMessage="How to use this?" description="Judge alignment help link text" />
            </Typography.Link>
          </div>
          <div css={{ display: 'flex', alignItems: 'center', gap: theme.spacing.sm }}>
            {isDraft && (
              <Typography.Text color="secondary">
                <FormattedMessage defaultMessage="Draft - 4 mins ago" description="Judge draft age label" />
              </Typography.Text>
            )}
            <Button
              componentId="mlflow.experiment-scorers.judge-alignment-save"
              type="primary"
              icon={<SaveIcon />}
              disabled={!hasSelectedJudge || !isDraft}
              onClick={() => setShowSaveModal(true)}
            >
              <FormattedMessage defaultMessage="Save" description="Button label for saving judge alignment changes" />
            </Button>
          </div>
        </div>

        <div
          css={{
            display: 'flex',
            flexDirection: 'column',
            gap: theme.spacing.md,
            padding: theme.spacing.md,
          }}
        >
          <section
            ref={instructionSectionRef}
            css={{ display: 'flex', flexDirection: 'column', gap: theme.spacing.sm, minWidth: 0 }}
          >
            <div
              css={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: theme.spacing.md,
              }}
            >
              <InstructionHeader
                icon={<TextBoxIcon css={{ color: theme.colors.textSecondary }} />}
                title={
                  <FormattedMessage defaultMessage="Instruction" description="Header for judge instruction editor" />
                }
              />
              <div css={{ display: 'flex', alignItems: 'center', gap: theme.spacing.xs, flexShrink: 0 }}>
                <Typography.Text color="secondary">
                  <FormattedMessage defaultMessage="Model" description="Judge config label for model" />
                </Typography.Text>
                <Typography.Text>{model}</Typography.Text>
                <Tooltip
                  componentId="mlflow.experiment-scorers.judge-alignment-model-settings-tooltip"
                  content={
                    <FormattedMessage
                      defaultMessage="Model settings"
                      description="Tooltip for judge alignment model settings"
                    />
                  }
                >
                  <Button
                    componentId="mlflow.experiment-scorers.judge-alignment-model-settings"
                    size="small"
                    type="tertiary"
                    icon={<GearIcon />}
                    aria-label="Model settings"
                    disabled={!hasSelectedJudge}
                  />
                </Tooltip>
              </div>
            </div>
            {alignmentPhase === 'optimizing' ? (
              <OptimizingInstructionPanel />
            ) : alignmentPhase === 'review' ? (
              <InstructionReviewPanel
                originalInstruction={instruction}
                suggestedInstruction={ALIGNED_INSTRUCTION}
                onAccept={acceptSuggestedInstruction}
                onDismiss={dismissSuggestedInstruction}
              />
            ) : (
              <Input.TextArea
                componentId="mlflow.experiment-scorers.judge-alignment-instruction"
                value={hasSelectedJudge ? instruction : ''}
                rows={13}
                disabled={!hasSelectedJudge}
                placeholder={intl.formatMessage({
                  defaultMessage: 'Select a judge to view and edit its instruction.',
                  description: 'Instruction box placeholder before a judge is selected',
                })}
                css={{ minHeight: 280 }}
                onKeyDown={(event) => event.stopPropagation()}
                onChange={(event) => setInstruction(event.target.value)}
              />
            )}
          </section>

          <div
            css={{
              display: 'grid',
              gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)',
              columnGap: theme.spacing.md,
              rowGap: theme.spacing.xs,
              marginTop: 0,
              padding: 0,
            }}
          >
            <div
              css={{
                minHeight: 112,
                position: 'relative',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <ArrowDownIcon css={{ color: theme.colors.border, fontSize: 112 }} />
              <div css={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -50%)' }}>
                <Button
                  componentId="mlflow.experiment-scorers.judge-alignment-run-judge"
                  type="primary"
                  icon={isJudgeRunning ? undefined : <PlayIcon />}
                  disabled={!hasSelectedJudge || isJudgeRunning}
                  aria-label={isJudgeRunning ? 'Running judge' : undefined}
                  onClick={runJudge}
                >
                  {isJudgeRunning ? (
                    <LoadingDots withLeadingSpace={false} />
                  ) : (
                    <FormattedMessage defaultMessage="Run Judge" description="Run judge button label" />
                  )}
                </Button>
              </div>
            </div>
            <div
              css={{
                minHeight: 112,
                position: 'relative',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <ArrowUpIcon css={{ color: theme.colors.border, fontSize: 112 }} />
              <div css={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -50%)' }}>
                <Button
                  componentId="mlflow.experiment-scorers.judge-alignment-align-prompt"
                  icon={<SparkleIcon color="ai" />}
                  disabled={!hasSelectedJudge || alignmentPhase === 'optimizing'}
                  onClick={alignJudgePrompt}
                  css={{
                    ...getAiGradientBorderStyle(theme),
                    '&:hover, &:focus, &:active': {
                      ...getAiGradientBorderStyle(theme),
                    },
                  }}
                >
                  {alignmentPhase === 'optimizing' ? (
                    <span>
                      <FormattedMessage
                        defaultMessage="Optimizing prompt"
                        description="Optimizing judge prompt button label"
                      />
                      <LoadingDots />
                    </span>
                  ) : (
                    <FormattedMessage
                      defaultMessage="Align judge prompt"
                      description="Align judge prompt button label"
                    />
                  )}
                </Button>
              </div>
            </div>
            <div css={{ gridColumn: '1 / -1', display: 'flex', justifyContent: 'flex-end' }}>
              <Typography.Text color="secondary">
                <FormattedMessage
                  defaultMessage="Last judge run cost: $0.37"
                  description="Last judge run cost in alignment page"
                />
              </Typography.Text>
            </div>
          </div>

          {showSuggestions && (
            <section
              css={{
                border: `1px solid ${theme.colors.blue300}`,
                borderRadius: theme.borders.borderRadiusMd,
                padding: theme.spacing.md,
                display: 'flex',
                flexDirection: 'column',
                gap: theme.spacing.sm,
                backgroundColor: theme.isDarkMode ? theme.colors.blue800 : theme.colors.blue100,
              }}
            >
              <div
                css={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: theme.spacing.sm }}
              >
                <div css={{ display: 'flex', alignItems: 'center', gap: theme.spacing.sm }}>
                  <SparkleDoubleIcon color="ai" />
                  <Typography.Text bold>
                    <FormattedMessage
                      defaultMessage="Suggestions"
                      description="Header for judge alignment suggestions"
                    />
                  </Typography.Text>
                </div>
                <Button
                  componentId="mlflow.experiment-scorers.judge-alignment-dismiss-suggestions"
                  type="tertiary"
                  size="small"
                  icon={<CloseIcon />}
                  aria-label="Dismiss suggestions"
                  onClick={() => setShowSuggestions(false)}
                />
              </div>
              {hasMissingHumanFeedback ? (
                <div css={{ display: 'flex', alignItems: 'center', gap: theme.spacing.xs, flexWrap: 'wrap' }}>
                  <Typography.Text>
                    <FormattedMessage
                      defaultMessage="Human feedback is missing in some judge. Manually fill in the table below or use"
                      description="Judge alignment suggestion when human feedback is missing"
                    />
                  </Typography.Text>
                  <Button
                    componentId="mlflow.experiment-scorers.judge-alignment-open-review-queue"
                    type="link"
                    size="small"
                    icon={<SpeechBubblePlusIcon />}
                    onClick={() => setShowReviewQueueModal(true)}
                    css={{ padding: 0 }}
                  >
                    <FormattedMessage defaultMessage="review queue" description="Review queue link in suggestions" />
                  </Button>
                  <Typography.Text>
                    <FormattedMessage
                      defaultMessage="to request annotation from experts."
                      description="Judge alignment suggestion suffix when human feedback is missing"
                    />
                  </Typography.Text>
                </div>
              ) : (
                <ul
                  css={{
                    margin: 0,
                    paddingLeft: theme.spacing.lg,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: theme.spacing.xs,
                  }}
                >
                  {ALIGNMENT_SUGGESTIONS.map((suggestion) => (
                    <li key={suggestion}>
                      <Typography.Text>{suggestion}</Typography.Text>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          <div
            ref={tableSectionRef}
            css={{ display: 'flex', flexDirection: 'column', gap: theme.spacing.sm, scrollMarginTop: theme.spacing.md }}
          >
            <Typography.Text bold>
              <FormattedMessage defaultMessage="Examples" description="Header for judge alignment examples table" />
            </Typography.Text>
            {rows.length === 0 ? (
              <ExamplesEmptyState
                onLoadDataset={() => loadExampleRows(DATASET_SAMPLE_ROWS)}
                onSelectTraces={() => loadExampleRows(TRACE_SAMPLE_ROWS)}
                onManualAdd={addRow}
              />
            ) : (
              <>
                <div css={{ overflowX: 'auto' }}>
                  <table
                    css={{
                      width: '100%',
                      minWidth: 1160,
                      tableLayout: 'fixed',
                      borderCollapse: 'collapse',
                      border: `1px solid ${theme.colors.border}`,
                    }}
                  >
                    <colgroup>
                      <col style={{ width: '32%' }} />
                      <col style={{ width: '32%' }} />
                      <col style={{ width: '11%' }} />
                      <col style={{ width: '11%' }} />
                      <col style={{ width: '8%' }} />
                      <col style={{ width: '6%' }} />
                    </colgroup>
                    <thead>
                      <tr css={{ backgroundColor: theme.colors.backgroundSecondary }}>
                        {['Inputs', 'Outputs', 'LLM judge', 'Human', 'Aligned?'].map((header) => (
                          <th
                            key={header}
                            css={{
                              textAlign: 'left',
                              padding: theme.spacing.sm,
                              borderBottom: `1px solid ${theme.colors.border}`,
                            }}
                          >
                            <Typography.Text bold>{header}</Typography.Text>
                          </th>
                        ))}
                        <th
                          css={{
                            textAlign: 'right',
                            padding: theme.spacing.sm,
                            borderBottom: `1px solid ${theme.colors.border}`,
                          }}
                        >
                          <Tooltip
                            componentId="mlflow.experiment-scorers.judge-alignment-mute-all-tooltip"
                            content={
                              allRowsMuted ? (
                                <FormattedMessage
                                  defaultMessage="Unmute all examples so they run again."
                                  description="Tooltip for unmute all alignment examples button"
                                />
                              ) : (
                                <FormattedMessage
                                  defaultMessage="Keep all judge records in this table, but skip execution for muted judges."
                                  description="Tooltip for mute all alignment examples button"
                                />
                              )
                            }
                          >
                            <Button
                              componentId="mlflow.experiment-scorers.judge-alignment-mute-all"
                              size="small"
                              type="tertiary"
                              icon={<VisibleOffIcon />}
                              aria-label={allRowsMuted ? 'Unmute all examples' : 'Mute all examples'}
                              disabled={rows.length === 0}
                              onClick={toggleAllRowsMuted}
                            />
                          </Tooltip>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row) => {
                        const isRowLoading = loadingRowIds.has(row.id);
                        const isMuted = mutedRowIds.has(row.id);
                        const isAligned = row.humanJudge ? row.llmJudge === row.humanJudge : false;

                        return (
                          <tr
                            key={row.id}
                            css={{
                              backgroundColor: isMuted
                                ? theme.isDarkMode
                                  ? theme.colors.backgroundSecondary
                                  : theme.colors.grey100
                                : undefined,
                              '&:hover .judge-alignment-row-mute, &:focus-within .judge-alignment-row-mute': {
                                opacity: 1,
                              },
                            }}
                          >
                            <td
                              css={{
                                padding: theme.spacing.sm,
                                verticalAlign: 'top',
                                borderBottom: `1px solid ${theme.colors.border}`,
                              }}
                            >
                              <EditableTextCell
                                value={row.inputs}
                                isEditing={editingCell?.rowId === row.id && editingCell.field === 'inputs'}
                                onEdit={() => setEditingCell({ rowId: row.id, field: 'inputs' })}
                                onDone={() => setEditingCell(null)}
                                onChange={(value) => updateRowField(row.id, 'inputs', value)}
                              />
                            </td>
                            <td
                              css={{
                                padding: theme.spacing.sm,
                                verticalAlign: 'top',
                                borderBottom: `1px solid ${theme.colors.border}`,
                              }}
                            >
                              <EditableTextCell
                                value={row.outputs}
                                isEditing={editingCell?.rowId === row.id && editingCell.field === 'outputs'}
                                onEdit={() => setEditingCell({ rowId: row.id, field: 'outputs' })}
                                onDone={() => setEditingCell(null)}
                                onChange={(value) => updateRowField(row.id, 'outputs', value)}
                              />
                            </td>
                            <td
                              css={{
                                padding: theme.spacing.sm,
                                verticalAlign: 'top',
                                borderBottom: `1px solid ${theme.colors.border}`,
                                '&:hover .judge-alignment-cell-action, &:focus-within .judge-alignment-cell-action': {
                                  opacity: 1,
                                },
                              }}
                            >
                              {isRowLoading ? (
                                <span aria-label="Running judge">
                                  <LoadingDots withLeadingSpace={false} />
                                </span>
                              ) : (
                                <div css={{ display: 'flex', alignItems: 'center', gap: theme.spacing.xs }}>
                                  <ResultTag value={row.llmJudge} />
                                  <span
                                    className="judge-alignment-cell-action"
                                    css={{
                                      opacity: 0,
                                      transition: 'opacity 120ms ease-in-out',
                                    }}
                                  >
                                    <RationalePopover
                                      title={
                                        <FormattedMessage
                                          defaultMessage="LLM rationale"
                                          description="Title for LLM rationale hover card"
                                        />
                                      }
                                      rationale={row.llmRationale}
                                    />
                                  </span>
                                </div>
                              )}
                            </td>
                            <td
                              css={{
                                padding: theme.spacing.sm,
                                verticalAlign: 'top',
                                borderBottom: `1px solid ${theme.colors.border}`,
                                '&:hover .judge-alignment-cell-action, &:focus-within .judge-alignment-cell-action': {
                                  opacity: 1,
                                },
                              }}
                            >
                              <div
                                css={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: theme.spacing.xs,
                                  flexWrap: 'wrap',
                                }}
                              >
                                {row.humanJudge ? (
                                  <>
                                    <HumanResultTag value={row.humanJudge} onFlip={() => flipHumanJudge(row.id)} />
                                    <span
                                      className="judge-alignment-cell-action"
                                      css={{
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        gap: theme.spacing.xs,
                                        opacity: 0,
                                        transition: 'opacity 120ms ease-in-out',
                                      }}
                                    >
                                      <RationalePopover
                                        title={
                                          <FormattedMessage
                                            defaultMessage="Human rationale"
                                            description="Title for human rationale hover card"
                                          />
                                        }
                                        rationale={row.humanRationale}
                                        editable
                                        onChange={(value) => updateRowField(row.id, 'humanRationale', value)}
                                      />
                                    </span>
                                  </>
                                ) : (
                                  <span
                                    className="judge-alignment-cell-action"
                                    css={{
                                      display: 'inline-flex',
                                      alignItems: 'center',
                                      gap: theme.spacing.xs,
                                      opacity: 0,
                                      transition: 'opacity 120ms ease-in-out',
                                    }}
                                  >
                                    <Button
                                      componentId="mlflow.experiment-scorers.judge-alignment-set-human-pass"
                                      size="small"
                                      type="tertiary"
                                      onClick={() => setHumanJudge(row.id, 'PASS')}
                                    >
                                      <FormattedMessage
                                        defaultMessage="Pass"
                                        description="Set missing human result to pass"
                                      />
                                    </Button>
                                    <Button
                                      componentId="mlflow.experiment-scorers.judge-alignment-set-human-fail"
                                      size="small"
                                      type="tertiary"
                                      onClick={() => setHumanJudge(row.id, 'FAIL')}
                                    >
                                      <FormattedMessage
                                        defaultMessage="Fail"
                                        description="Set missing human result to fail"
                                      />
                                    </Button>
                                  </span>
                                )}
                              </div>
                            </td>
                            <td
                              css={{
                                padding: theme.spacing.sm,
                                verticalAlign: 'top',
                                textAlign: 'left',
                                borderBottom: `1px solid ${theme.colors.border}`,
                              }}
                            >
                              {isRowLoading ? (
                                <Typography.Text color="secondary">-</Typography.Text>
                              ) : row.humanJudge ? (
                                <span
                                  css={{
                                    color: isAligned
                                      ? theme.isDarkMode
                                        ? theme.colors.green400
                                        : theme.colors.green600
                                      : theme.isDarkMode
                                        ? theme.colors.red400
                                        : theme.colors.red600,
                                    fontWeight: theme.typography.typographyBoldFontWeight,
                                  }}
                                >
                                  {isAligned ? (
                                    <FormattedMessage defaultMessage="Yes" description="Aligned table cell yes text" />
                                  ) : (
                                    <FormattedMessage defaultMessage="No" description="Aligned table cell no text" />
                                  )}
                                </span>
                              ) : (
                                ''
                              )}
                            </td>
                            <td
                              css={{
                                padding: theme.spacing.sm,
                                verticalAlign: 'top',
                                textAlign: 'right',
                                width: 48,
                                borderBottom: `1px solid ${theme.colors.border}`,
                              }}
                            >
                              <Tooltip
                                componentId="mlflow.experiment-scorers.judge-alignment-mute-row-tooltip"
                                content={
                                  isMuted ? (
                                    <FormattedMessage
                                      defaultMessage="Run this judge record again."
                                      description="Tooltip for unmute alignment example button"
                                    />
                                  ) : (
                                    <FormattedMessage
                                      defaultMessage="Keep this judge record, but skip it during execution."
                                      description="Tooltip for mute alignment example button"
                                    />
                                  )
                                }
                              >
                                <Button
                                  componentId="mlflow.experiment-scorers.judge-alignment-mute-row"
                                  className="judge-alignment-row-mute"
                                  size="small"
                                  type="tertiary"
                                  icon={<VisibleOffIcon />}
                                  aria-label={isMuted ? 'Unmute example' : 'Mute example'}
                                  onClick={() => toggleRowMuted(row.id)}
                                  css={{ opacity: 0, transition: 'opacity 120ms ease-in-out' }}
                                />
                              </Tooltip>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <div>
                  <Button
                    componentId="mlflow.experiment-scorers.judge-alignment-add-row"
                    icon={<PlusIcon />}
                    onClick={addRow}
                  >
                    <FormattedMessage defaultMessage="Add new" description="Add new alignment example button label" />
                  </Button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      <Modal
        componentId="mlflow.experiment-scorers.judge-alignment-save-modal"
        visible={showSaveModal}
        title={<FormattedMessage defaultMessage="Save judge" description="Save judge modal title" />}
        okText={<FormattedMessage defaultMessage="Save" description="Confirm save judge button label" />}
        cancelText={<FormattedMessage defaultMessage="Cancel" description="Cancel save judge button label" />}
        onOk={handleSave}
        onCancel={() => setShowSaveModal(false)}
      >
        <div css={{ display: 'flex', flexDirection: 'column', gap: theme.spacing.md }}>
          <Typography.Text>
            <FormattedMessage
              defaultMessage="Create a new version {version} for {judgeName}."
              description="Save judge version confirmation text"
              values={{ version: `v${nextVersion}`, judgeName }}
            />
          </Typography.Text>
          <Input.TextArea
            componentId="mlflow.experiment-scorers.judge-alignment-commit-message"
            id="mlflow.experiment-scorers.judge-alignment-commit-message"
            value={commitMessage}
            rows={3}
            placeholder="Type commit message describes the change (optional)"
            onKeyDown={(event) => event.stopPropagation()}
            onChange={(event) => setCommitMessage(event.target.value)}
          />
          <details
            open={showDiff}
            onToggle={(event) => setShowDiff(event.currentTarget.open)}
            css={{
              display: 'flex',
              flexDirection: 'column',
              gap: theme.spacing.sm,
            }}
          >
            <summary
              css={{
                cursor: 'pointer',
                color: theme.colors.textSecondary,
                userSelect: 'none',
              }}
            >
              <Typography.Text color="secondary">
                {showDiff ? (
                  <FormattedMessage defaultMessage="Hide diff" description="Hide diff disclosure label" />
                ) : (
                  <FormattedMessage defaultMessage="Show diff" description="Show diff disclosure label" />
                )}
              </Typography.Text>
            </summary>
            <div css={{ marginTop: theme.spacing.sm }}>
              <PromptLineDiff baselineValue={savedInstruction} comparedValue={instruction} />
            </div>
          </details>
        </div>
      </Modal>

      {showReviewQueueModal && experimentId && (
        <CreateReviewQueueModal
          experimentId={experimentId}
          onClose={() => setShowReviewQueueModal(false)}
          aiConfigureContext={{
            defaultName: `Judge feedback for ${judgeName}`,
            judgeQuestion: instruction.trim().split('\n')[0] || `Review feedback for ${judgeName}`,
          }}
        />
      )}
    </>
  );
};

export default JudgeAlignmentPrototypePage;
