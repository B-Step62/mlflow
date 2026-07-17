import type { ReactNode } from 'react';

import { Button, PencilIcon } from '@databricks/design-system';
import { FormattedMessage } from '@databricks/i18n';

import { useModelTraceExplorerViewState } from '../ModelTraceExplorerViewStateContext';

export const AssessmentPaneToggle = ({ children }: { children?: ReactNode }) => {
  const { assessmentsPaneExpanded, setAssessmentsPaneExpanded, assessmentsPaneEnabled } =
    useModelTraceExplorerViewState();

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
      {children ?? (
        <FormattedMessage
          defaultMessage="Show assessments"
          description="Label for the button to show the assessments pane"
        />
      )}
    </Button>
  );
};
