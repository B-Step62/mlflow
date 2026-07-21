import type { ReactNode } from 'react';

import { Button, GavelIcon, PencilIcon, Tag, Typography, useDesignSystemTheme } from '@databricks/design-system';
import { FormattedMessage } from '@databricks/i18n';

import { useModelTraceExplorerViewState } from '../ModelTraceExplorerViewStateContext';

export const AssessmentPaneToggle = ({
  assessmentCount = 0,
  children,
}: {
  assessmentCount?: number;
  children?: ReactNode;
}) => {
  const { theme } = useDesignSystemTheme();
  const { assessmentsPaneExpanded, setAssessmentsPaneExpanded, assessmentsPaneEnabled } =
    useModelTraceExplorerViewState();
  const hasAssessments = assessmentCount > 0;

  if (assessmentsPaneExpanded) {
    return null;
  }

  return (
    <Button
      disabled={!assessmentsPaneEnabled}
      componentId="shared.model-trace-explorer.assessments-pane-toggle"
      size="small"
      icon={<PencilIcon />}
      onClick={() => setAssessmentsPaneExpanded?.(true)}
    >
      <span css={{ display: 'inline-flex', alignItems: 'center', gap: theme.spacing.xs }}>
        {children ?? (
          <FormattedMessage
            defaultMessage="Show assessments"
            description="Label for the button to show the assessments pane"
          />
        )}
        {hasAssessments && (
          <Tag
            color="indigo"
            componentId="shared.model-trace-explorer.assessments-pane-toggle-count"
            css={{
              margin: 0,
              borderRadius: theme.borders.borderRadiusSm,
            }}
          >
            <GavelIcon />
            <Typography.Text css={{ marginLeft: theme.spacing.xs }}>{assessmentCount}</Typography.Text>
          </Tag>
        )}
      </span>
    </Button>
  );
};
