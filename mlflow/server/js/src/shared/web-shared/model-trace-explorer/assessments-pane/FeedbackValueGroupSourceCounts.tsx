import { FormattedMessage } from '@databricks/i18n';
import { countBy } from 'lodash';

import {
  Button,
  CodeIcon,
  HoverCard,
  SparkleIcon,
  Tag,
  Tooltip,
  Typography,
  useDesignSystemTheme,
  UserIcon,
} from '@databricks/design-system';

import type { AssessmentSourceType, FeedbackAssessment } from '../ModelTrace.types';
import { Link, useParams } from '../RoutingUtils';
import { getExperimentPageJudgesAlignmentRoute } from '../routes';

const getSourceTypeIcon = (sourceType: AssessmentSourceType, iconColor?: string) => {
  const smallIconStyles = {
    color: iconColor,
    '& > svg': {
      width: 12,
      height: 12,
    },
  };
  switch (sourceType) {
    case 'HUMAN':
      return <UserIcon css={smallIconStyles} />;
    case 'LLM_JUDGE':
      return <SparkleIcon css={smallIconStyles} />;
    case 'CODE':
      return <CodeIcon css={smallIconStyles} />;
    default:
      return null;
  }
};

const getSourceTypeLabel = (sourceType: AssessmentSourceType) => {
  switch (sourceType) {
    case 'HUMAN':
      return <FormattedMessage defaultMessage="Human feedback" description="Tooltip content for human feedback" />;
    case 'LLM_JUDGE':
      return (
        <FormattedMessage defaultMessage="LLM judge" description="Tooltip content for LLM judge feedback source" />
      );
    case 'CODE':
      return (
        <FormattedMessage
          defaultMessage="Custom code judge feedback"
          description="Tooltip content for custom code judge feedback"
        />
      );
  }
  return null;
};

const JudgeAlignmentNudge = () => {
  const { theme } = useDesignSystemTheme();
  const { experimentId } = useParams();

  return (
    <div
      css={{
        display: 'flex',
        flexDirection: 'column',
        gap: theme.spacing.sm,
        maxWidth: 220,
      }}
    >
      <Typography.Text bold>
        <FormattedMessage defaultMessage="LLM judge" description="Hover card title for LLM judge feedback source" />
      </Typography.Text>
      <div css={{ display: 'flex', alignItems: 'center', gap: theme.spacing.sm }}>
        <Typography.Text size="sm" css={{ flex: 1 }}>
          <FormattedMessage
            defaultMessage="Low quality judge?"
            description="Nudge shown when hovering an LLM judge feedback source"
          />
        </Typography.Text>
        {experimentId ? (
          <Link
            componentId="shared.model-trace-explorer.fix-low-quality-judge-link"
            to={getExperimentPageJudgesAlignmentRoute(experimentId)}
            css={{ textDecoration: 'none' }}
          >
            <Button componentId="shared.model-trace-explorer.fix-low-quality-judge" size="small">
              <FormattedMessage defaultMessage="Fix" description="Button label for fixing low quality judge feedback" />
            </Button>
          </Link>
        ) : (
          <Button componentId="shared.model-trace-explorer.fix-low-quality-judge" size="small" disabled>
            <FormattedMessage defaultMessage="Fix" description="Button label for fixing low quality judge feedback" />
          </Button>
        )}
      </div>
    </div>
  );
};

export const FeedbackValueGroupSourceCounts = ({ feedbacks }: { feedbacks: FeedbackAssessment[] }) => {
  const { theme } = useDesignSystemTheme();

  if (feedbacks.length < 1) {
    return null;
  }

  const sourceCounts = countBy(feedbacks, (feedback) => feedback.source.source_type);
  return (
    <div
      css={{
        display: 'flex',
        gap: theme.spacing.xs,
        alignItems: 'center',
        marginLeft: theme.spacing.xs,
      }}
    >
      {Object.entries(sourceCounts).map(([sourceType, count]) => {
        const typedSourceType = sourceType as AssessmentSourceType;
        const isLlmJudge = typedSourceType === 'LLM_JUDGE';
        const aiColor = theme.colors.purple;
        const tag = (
          <Tag
            componentId="shared.model-trace-explorer.feedback-source-count"
            css={{
              margin: 0,
              '&>*': {
                cursor: 'default',
              },
            }}
          >
            <div css={{ display: 'flex', alignItems: 'center', gap: theme.spacing.xs }}>
              {getSourceTypeIcon(typedSourceType, isLlmJudge ? aiColor : undefined)}
              {count > 1 && (
                <Typography.Text css={isLlmJudge ? { color: aiColor } : undefined}>{count}</Typography.Text>
              )}
            </div>
          </Tag>
        );

        if (isLlmJudge) {
          return (
            <HoverCard key={sourceType} trigger={tag} content={<JudgeAlignmentNudge />} side="bottom" align="start" />
          );
        }

        return (
          <Tooltip
            key={sourceType}
            componentId="shared.model-trace-explorer.feedback-source-tooltip"
            content={getSourceTypeLabel(typedSourceType)}
          >
            {tag}
          </Tooltip>
        );
      })}
    </div>
  );
};
