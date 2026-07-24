import { CheckCircleIcon, Typography, useDesignSystemTheme } from '@databricks/design-system';
import { FormattedMessage } from 'react-intl';

import reviewQueueFocusModeImg from '@mlflow/mlflow/src/common/static/review-queue-focus-mode.png';

/**
 * Onboarding empty state shared by the review queue panels (no queues, no queue
 * selected, empty queue). The preview image is an interim stand-in for the
 * product walkthrough video.
 */
export const ReviewQueueEmptyState = ({
  title,
  description,
  button,
}: {
  title: React.ReactNode;
  description: React.ReactNode;
  button?: React.ReactNode;
}) => {
  const { theme } = useDesignSystemTheme();

  return (
    <div
      css={{
        display: 'flex',
        justifyContent: 'center',
        height: '100%',
        minHeight: 400,
        width: '100%',
        overflow: 'auto',
      }}
    >
      <div
        css={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          width: '100%',
          maxWidth: 900,
          padding: `${theme.spacing.xl}px ${theme.spacing.md}px ${theme.spacing.lg}px`,
          gap: theme.spacing.lg,
        }}
      >
        <div css={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
          <Typography.Title level={3} withoutMargins css={{ marginBottom: theme.spacing.sm }}>
            {title}
          </Typography.Title>
          <Typography.Paragraph color="secondary" css={{ maxWidth: 680, marginBottom: 0 }}>
            {description}
          </Typography.Paragraph>
        </div>

        <div
          css={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: theme.spacing.sm,
            flexWrap: 'wrap',
          }}
        >
          {button}
          <Typography.Link
            componentId="mlflow.experiment-review-queue.empty-state.learn-more"
            href="https://mlflow.org/docs/latest/genai/assessments/review-queues"
            openInNewTab
          >
            <FormattedMessage defaultMessage="Learn more" description="Review queue: empty state learn-more link" />
          </Typography.Link>
        </div>

        <div
          css={{
            width: '100%',
            maxWidth: 760,
            padding: theme.spacing.xs,
            border: `1px solid ${theme.colors.border}`,
            borderRadius: theme.borders.borderRadiusMd,
            backgroundColor: theme.colors.backgroundSecondary,
          }}
        >
          <img
            src={reviewQueueFocusModeImg}
            alt=""
            css={{
              display: 'block',
              width: '100%',
              borderRadius: theme.borders.borderRadiusSm,
              border: `1px solid ${theme.colors.border}`,
            }}
          />
        </div>

        <div css={{ width: '100%', maxWidth: 760 }}>
          <Typography.Text bold>
            <FormattedMessage defaultMessage="Quick guide" description="Review queue: empty state guide title" />
          </Typography.Text>
          <ol
            css={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
              gap: theme.spacing.md,
              listStyle: 'none',
              padding: 0,
              margin: `${theme.spacing.sm}px 0 0`,
            }}
          >
            <li css={{ display: 'flex', gap: theme.spacing.sm, minWidth: 0 }}>
              <StepNumber>1</StepNumber>
              <div css={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                <Typography.Text bold>
                  <FormattedMessage defaultMessage="Create a queue" description="Review queue: empty state step 1" />
                </Typography.Text>
                <Typography.Text color="secondary">
                  <FormattedMessage
                    defaultMessage="Group traces for a project, issue, or review pass."
                    description="Review queue: empty state step 1 description"
                  />
                </Typography.Text>
              </div>
            </li>
            <li css={{ display: 'flex', gap: theme.spacing.sm, minWidth: 0 }}>
              <StepNumber>2</StepNumber>
              <div css={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                <Typography.Text bold>
                  <FormattedMessage
                    defaultMessage="Configure questions and reviewers"
                    description="Review queue: empty state step 2"
                  />
                </Typography.Text>
                <Typography.Text color="secondary">
                  <FormattedMessage
                    defaultMessage="Choose what reviewers answer and who should review."
                    description="Review queue: empty state step 2 description"
                  />
                </Typography.Text>
              </div>
            </li>
            <li css={{ display: 'flex', gap: theme.spacing.sm, minWidth: 0 }}>
              <StepNumber>3</StepNumber>
              <div css={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                <Typography.Text bold>
                  <FormattedMessage defaultMessage="Select traces" description="Review queue: empty state step 3" />
                </Typography.Text>
                <Typography.Text color="secondary">
                  <FormattedMessage
                    defaultMessage="Add the examples reviewers should inspect."
                    description="Review queue: empty state step 3 description"
                  />
                </Typography.Text>
              </div>
            </li>
          </ol>
        </div>
      </div>
    </div>
  );
};

const StepNumber = ({ children }: { children: React.ReactNode }) => {
  const { theme } = useDesignSystemTheme();

  return (
    <span
      css={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: theme.spacing.lg,
        height: theme.spacing.lg,
        flexShrink: 0,
        borderRadius: '50%',
        backgroundColor: theme.colors.actionDefaultBackgroundPress,
        color: theme.colors.textPrimary,
        fontWeight: theme.typography.typographyBoldFontWeight,
      }}
    >
      {children}
    </span>
  );
};

export const ReviewQueueNoTracesEmptyState = ({
  button,
  questionCount,
}: {
  button?: React.ReactNode;
  questionCount?: number;
}) => {
  const { theme } = useDesignSystemTheme();

  return (
    <div
      css={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        minHeight: 320,
        width: '100%',
        overflow: 'auto',
        padding: theme.spacing.md,
      }}
    >
      <div
        css={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          textAlign: 'center',
          width: '100%',
          maxWidth: 520,
          gap: theme.spacing.md,
        }}
      >
        <div>
          <Typography.Title level={3} withoutMargins css={{ marginBottom: theme.spacing.sm }}>
            <FormattedMessage defaultMessage="Add traces to this queue" description="Review queue: empty trace title" />
          </Typography.Title>
          <Typography.Paragraph color="secondary" css={{ marginBottom: 0 }}>
            <FormattedMessage
              defaultMessage="Select traces from the Traces tab and add them here so reviewers can answer this queue's configured questions."
              description="Review queue: empty trace description"
            />
          </Typography.Paragraph>
        </div>

        {button}

        <div
          css={{
            width: '100%',
            display: 'flex',
            flexDirection: 'column',
            gap: theme.spacing.sm,
            padding: theme.spacing.md,
            border: `1px solid ${theme.colors.border}`,
            borderRadius: theme.borders.borderRadiusMd,
            textAlign: 'left',
            backgroundColor: theme.colors.backgroundSecondary,
          }}
        >
          <Typography.Text bold>
            <FormattedMessage
              defaultMessage="This queue is ready for traces"
              description="Review queue: trace setup status title"
            />
          </Typography.Text>
          <SetupStatusItem complete>
            <FormattedMessage
              defaultMessage="{count, plural, one {# question configured} other {# questions configured}}"
              description="Review queue: trace setup status questions"
              values={{ count: questionCount ?? 0 }}
            />
          </SetupStatusItem>
          <SetupStatusItem complete>
            <FormattedMessage
              defaultMessage="Reviewers assigned"
              description="Review queue: trace setup status reviewers"
            />
          </SetupStatusItem>
          <SetupStatusItem>
            <FormattedMessage defaultMessage="Traces selected" description="Review queue: trace setup status traces" />
          </SetupStatusItem>
        </div>
      </div>
    </div>
  );
};

const SetupStatusItem = ({ children, complete = false }: { children: React.ReactNode; complete?: boolean }) => {
  const { theme } = useDesignSystemTheme();

  return (
    <div css={{ display: 'flex', alignItems: 'center', gap: theme.spacing.sm }}>
      {complete ? (
        <CheckCircleIcon css={{ color: theme.colors.textValidationSuccess, flexShrink: 0 }} />
      ) : (
        <span
          css={{
            width: theme.spacing.md,
            height: theme.spacing.md,
            borderRadius: '50%',
            border: `1px solid ${theme.colors.border}`,
            flexShrink: 0,
          }}
        />
      )}
      {complete ? (
        <Typography.Text>{children}</Typography.Text>
      ) : (
        <Typography.Text color="secondary">{children}</Typography.Text>
      )}
    </div>
  );
};
