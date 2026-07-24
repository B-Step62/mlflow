import {
  Button,
  ForkHorizontalIcon,
  SparkleIcon,
  TargetIcon,
  Typography,
  useDesignSystemTheme,
} from '@databricks/design-system';
import { FormattedMessage } from 'react-intl';

type IssuesTabEmptyStateProps = {
  containsTraces?: boolean;
  onRunDetection?: () => void;
  onScheduleDetection?: () => void;
  onGoToTraces?: () => void;
  isDetectionScheduled?: boolean;
};

const IssueDetectionEmptyVisual = () => {
  const { theme } = useDesignSystemTheme();

  return (
    <div
      css={{
        width: 156,
        height: 116,
        position: 'relative',
        border: `1px solid ${theme.colors.border}`,
        borderRadius: theme.borders.borderRadiusMd,
        backgroundColor: theme.colors.backgroundSecondary,
        overflow: 'hidden',
      }}
    >
      <div
        css={{
          position: 'absolute',
          left: theme.spacing.md,
          right: theme.spacing.md,
          top: theme.spacing.md,
          display: 'flex',
          justifyContent: 'space-between',
        }}
      >
        {[0, 1, 2].map((index) => (
          <span
            key={index}
            css={{
              width: 28,
              height: 28,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: theme.borders.borderRadiusSm,
              border: `1px solid ${theme.colors.border}`,
              backgroundColor: theme.colors.backgroundPrimary,
              color: theme.colors.textSecondary,
            }}
          >
            <ForkHorizontalIcon css={{ fontSize: 14 }} />
          </span>
        ))}
      </div>
      <span
        css={{
          position: 'absolute',
          left: 26,
          right: 26,
          top: 52,
          height: 1,
          backgroundColor: theme.colors.border,
        }}
      />
      <span
        css={{
          position: 'absolute',
          left: '50%',
          top: 52,
          bottom: 34,
          width: 1,
          backgroundColor: theme.colors.border,
        }}
      />
      <div
        css={{
          position: 'absolute',
          left: '50%',
          bottom: theme.spacing.md,
          transform: 'translateX(-50%)',
          width: 48,
          height: 36,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 2,
          borderRadius: theme.borders.borderRadiusMd,
          border: `1px solid ${theme.colors.border}`,
          backgroundColor: theme.colors.backgroundPrimary,
          boxShadow: theme.shadows.sm,
        }}
      >
        <TargetIcon css={{ fontSize: 16, color: theme.colors.textSecondary }} />
        <SparkleIcon color="ai" css={{ fontSize: 14 }} />
      </div>
    </div>
  );
};

export const IssuesTabEmptyState = ({
  containsTraces,
  onRunDetection,
  onScheduleDetection,
  onGoToTraces,
  isDetectionScheduled,
}: IssuesTabEmptyStateProps) => {
  const { theme } = useDesignSystemTheme();
  const shouldPromptForTraces = containsTraces === false;
  const showTraceAwareActions = containsTraces !== undefined;

  return (
    <div
      css={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: theme.spacing.md,
        maxWidth: 480,
        textAlign: 'center',
      }}
    >
      <IssueDetectionEmptyVisual />
      <div css={{ display: 'flex', flexDirection: 'column', gap: theme.spacing.sm, alignItems: 'center' }}>
        <Typography.Title level={3} css={{ margin: 0 }}>
          {shouldPromptForTraces ? (
            <FormattedMessage
              defaultMessage="Add traces to analyze issues"
              description="Issues empty state title when the experiment has no traces"
            />
          ) : showTraceAwareActions ? (
            <FormattedMessage
              defaultMessage="Find common issues in your traces"
              description="Issues empty state title when traces exist but no issues have been detected"
            />
          ) : (
            <FormattedMessage
              defaultMessage="No issues found"
              description="Issue detection run details > Issues tab > Empty state title"
            />
          )}
        </Typography.Title>
        <Typography.Text color="secondary">
          {shouldPromptForTraces ? (
            <FormattedMessage
              defaultMessage="Issues are detected from trace data. Ingest traces for this experiment, then return here to find recurring failures."
              description="Issues empty state description when the experiment has no traces"
            />
          ) : showTraceAwareActions ? (
            <FormattedMessage
              defaultMessage="Run detection to cluster recurring failure patterns and summarize likely root causes across recent traces."
              description="Issues empty state description when traces exist but no issues have been detected"
            />
          ) : (
            <FormattedMessage
              defaultMessage="Issues identified from traces will appear here."
              description="Issue detection run details > Issues tab > Empty state description"
            />
          )}
        </Typography.Text>
      </div>
      {showTraceAwareActions && (
        <div
          css={{
            display: 'flex',
            gap: theme.spacing.sm,
            alignItems: 'center',
            justifyContent: 'center',
            flexWrap: 'wrap',
          }}
        >
          {shouldPromptForTraces ? (
            <Button
              componentId="mlflow.issues.empty-state.go-to-traces"
              type="primary"
              icon={<ForkHorizontalIcon />}
              onClick={onGoToTraces}
            >
              <FormattedMessage defaultMessage="Go to Traces" description="Issues empty state go to traces action" />
            </Button>
          ) : (
            <>
              <Button
                componentId="mlflow.issues.empty-state.run-detection"
                type="primary"
                icon={<SparkleIcon color="ai" />}
                onClick={onRunDetection}
              >
                <FormattedMessage
                  defaultMessage="Run one-time detection"
                  description="Issues empty state run detection action"
                />
              </Button>
              <Button
                componentId="mlflow.issues.empty-state.schedule-detection"
                onClick={onScheduleDetection}
                disabled={isDetectionScheduled}
              >
                <FormattedMessage
                  defaultMessage="Schedule detection job"
                  description="Issues empty state schedule detection action"
                />
              </Button>
            </>
          )}
        </div>
      )}
    </div>
  );
};
