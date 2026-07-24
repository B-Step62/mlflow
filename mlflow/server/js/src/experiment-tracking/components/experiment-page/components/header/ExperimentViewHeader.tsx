import React, { useCallback, useMemo } from 'react';
import {
  ArrowLeftIcon,
  BeakerIcon,
  Breadcrumb,
  Button,
  InfoBookIcon,
  ParagraphSkeleton,
  Tag,
  TitleSkeleton,
  Tooltip,
  Typography,
  useDesignSystemTheme,
} from '@databricks/design-system';
import { FormattedMessage, useIntl } from 'react-intl';
import {
  createMLflowRoutePath,
  Link,
  matchPath,
  useLocation,
  useNavigate,
} from '../../../../../common/utils/RoutingUtils';
import Routes, { RoutePaths } from '../../../../routes';
import { ExperimentViewCopyTitle } from './ExperimentViewCopyTitle';
import type { ExperimentEntity } from '../../../../types';
import { ExperimentViewArtifactLocation } from '../ExperimentViewArtifactLocation';
import { ExperimentViewCopyExperimentId } from './ExperimentViewCopyExperimentId';
import { ExperimentViewCopyArtifactLocation } from './ExperimentViewCopyArtifactLocation';
import { InfoPopover } from '@databricks/design-system';
import { useExperimentKind, isGenAIExperimentKind } from '../../../../utils/ExperimentKindUtils';
import { ExperimentViewManagementMenu } from './ExperimentViewManagementMenu';
import { shouldEnableWorkflowBasedNavigation } from '@mlflow/mlflow/src/common/utils/FeatureUtils';
import { useHeaderVisibility } from '../../../../pages/experiment-page-tabs/ExperimentPageHeaderVisibilityContext';

import { ExperimentKind, ExperimentPageTabName } from '../../../../constants';
import { useGetExperimentPageActiveTabByRoute } from '../../hooks/useGetExperimentPageActiveTabByRoute';
import { useWorkflowType } from '@mlflow/mlflow/src/common/contexts/WorkflowTypeContext';
import { getTabDisplayIcon, getTabDisplayName } from './ExperimentViewHeader.utils';
import { formatTraceArchivalRetentionForDisplay } from '../../../../../common/utils/traceArchival';

const getDocLinkHref = (experimentKind: ExperimentKind) => {
  if (isGenAIExperimentKind(experimentKind)) {
    return 'https://mlflow.org/docs/latest/genai/?rel=mlflow_ui';
  }
  return 'https://mlflow.org/docs/latest/ml/getting-started/?rel=mlflow_ui';
};

// Routes where the page itself renders item-level edit/delete actions, so the
// experiment-level management menu would be a confusing duplicate.
const ROUTES_WITHOUT_MANAGEMENT_MENU = [RoutePaths.experimentPageTabPromptDetails];

/**
 * Header for a single experiment page. Displays title, breadcrumbs and provides
 * controls for renaming, deleting and editing permissions.
 */
export const ExperimentViewHeader = React.memo(
  // eslint-disable-next-line react-component-name/react-component-name -- TODO(FEINF-4716)
  ({
    experiment,
    inferredExperimentKind,
    setEditing,
    experimentKindSelector,
    savedViewsSlot,
  }: {
    experiment: ExperimentEntity;
    inferredExperimentKind?: ExperimentKind;
    setEditing: (editing: boolean) => void;
    experimentKindSelector?: React.ReactNode;
    // Tab-aware saved-views controls rendered in the header action cluster. Filled by the tab-aware
    // caller (ExperimentPageTabs), which knows the active tab; the header stays presentational.
    savedViewsSlot?: React.ReactNode;
  }) => {
    const { theme } = useDesignSystemTheme();
    const intl = useIntl();
    const navigate = useNavigate();
    const location = useLocation();
    const { headerActionsHidden, breadcrumbChild, titleOverride, titleAdjacent, titleMetadata, actionSlot } =
      useHeaderVisibility();
    const handleBack = useCallback(() => {
      const pathSegments = location.pathname.split('/').filter(Boolean);

      // Unlike /chat-sessions/:sessionId where popping a segment lands on a
      // valid list page, /dashboard/:overviewTab has no /dashboard landing page.
      // Strip the sub-tab so back navigation treats it like other top-level tabs.
      if (pathSegments[0] === 'experiments' && pathSegments[2] === 'dashboard') {
        pathSegments.splice(3);
      }

      // Navigate to /experiments for tab pages (up to 3 segments: /experiments/ID/tab)
      // For deeper paths, remove last segment to navigate to parent
      if (pathSegments.length <= 3 && pathSegments[0] === 'experiments') {
        navigate(Routes.experimentsObservatoryRoute);
      } else {
        pathSegments.pop();
        navigate(createMLflowRoutePath('/') + pathSegments.join('/'));
      }
    }, [location.pathname, navigate]);

    // In OSS, we don't need to show the docs link anymore as the link is in the sidebar
    const showDocsLink = false;

    // Extract the last part of the experiment name
    const { tabName: activeTabByRoute } = useGetExperimentPageActiveTabByRoute();
    const { workflowType } = useWorkflowType();
    const tabDisplayName = activeTabByRoute ? getTabDisplayName(activeTabByRoute, workflowType) : undefined;
    const normalizedExperimentName = useMemo(() => experiment.name.split('/').pop(), [experiment.name]);
    const traceArchivalRetention =
      formatTraceArchivalRetentionForDisplay(experiment.effectiveTraceArchivalRetention?.trim(), intl) || undefined;
    const shouldShowTraceArchivalBadge =
      activeTabByRoute === ExperimentPageTabName.Traces ||
      activeTabByRoute === ExperimentPageTabName.ChatSessions ||
      activeTabByRoute === ExperimentPageTabName.SingleChatSession;
    const experimentTitle =
      shouldEnableWorkflowBasedNavigation() && tabDisplayName ? tabDisplayName : normalizedExperimentName;
    const headerTitle = titleOverride ?? experimentTitle;
    const headerTitleTooltip = typeof headerTitle === 'string' ? headerTitle : normalizedExperimentName;

    const breadcrumbs: React.ReactNode[] = useMemo(() => {
      const items: React.ReactNode[] = [
        // eslint-disable-next-line react/jsx-key
        <Link
          key="observatory"
          componentId="mlflow.experiment_tracking.header.experiments_breadcrumb_link"
          to={Routes.experimentsObservatoryRoute}
          data-testid="experiment-observatory-link"
        >
          <FormattedMessage
            defaultMessage="Experiments"
            description="Breadcrumb nav item to link to the list of experiments page"
          />
        </Link>,
        <Link
          key="experiment"
          componentId="mlflow.experiment_tracking.header.experiment_name_breadcrumb_link"
          to={Routes.getExperimentPageRoute(experiment.experimentId ?? '')}
          data-testid="experiment-link"
        >
          {normalizedExperimentName}
        </Link>,
      ];

      if (activeTabByRoute === ExperimentPageTabName.EvaluationRuns) {
        items.push(
          <Link
            key="evaluation-runs"
            componentId="mlflow.experiment_tracking.header.evaluation_runs_breadcrumb_link"
            to={Routes.getExperimentPageTabRoute(experiment.experimentId ?? '', ExperimentPageTabName.EvaluationRuns)}
            data-testid="evaluation-runs-link"
          >
            <FormattedMessage
              defaultMessage="Evaluation runs"
              description="Breadcrumb nav item for the evaluation runs tab on an experiment"
            />
          </Link>,
        );
      }

      if (activeTabByRoute === ExperimentPageTabName.EvaluationRuns && breadcrumbChild) {
        items.push(breadcrumbChild);
      }

      return items;
    }, [activeTabByRoute, breadcrumbChild, experiment.experimentId, normalizedExperimentName]);

    const getInfoTooltip = () => {
      return (
        <div style={{ display: 'flex', marginRight: theme.spacing.sm }}>
          <InfoPopover iconTitle="Info">
            <div
              css={{
                display: 'flex',
                flexDirection: 'column',
                gap: theme.spacing.xs,
                flexWrap: 'nowrap',
              }}
              data-testid="experiment-view-header-info-tooltip-content"
            >
              <div style={{ whiteSpace: 'nowrap' }}>
                <FormattedMessage
                  defaultMessage="Path"
                  description="Label for displaying the current experiment path"
                />
                : {experiment.name + ' '}
                <ExperimentViewCopyTitle experiment={experiment} size="md" />
              </div>
              <div style={{ whiteSpace: 'nowrap' }}>
                <FormattedMessage
                  defaultMessage="Experiment ID"
                  description="Label for displaying the current experiment in view"
                />
                : {experiment.experimentId + ' '}
                <ExperimentViewCopyExperimentId experiment={experiment} />
              </div>
              <div style={{ whiteSpace: 'nowrap' }}>
                <FormattedMessage
                  defaultMessage="Artifact Location"
                  description="Label for displaying the experiment artifact location"
                />
                : <ExperimentViewArtifactLocation artifactLocation={experiment.artifactLocation} />{' '}
                <ExperimentViewCopyArtifactLocation experiment={experiment} />
              </div>
              {traceArchivalRetention && (
                <div style={{ whiteSpace: 'nowrap' }}>
                  <FormattedMessage
                    defaultMessage="Trace Archival Retention"
                    description="Label for displaying the experiment trace archival retention"
                  />
                  : {traceArchivalRetention}
                </div>
              )}
            </div>
          </InfoPopover>
        </div>
      );
    };

    const experimentKindFromContext = useExperimentKind(experiment.tags);
    const experimentKind = inferredExperimentKind ?? experimentKindFromContext;
    const docLinkHref = getDocLinkHref(experimentKind ?? ExperimentKind.NO_INFERRED_TYPE);
    const showBreadcrumbs = shouldEnableWorkflowBasedNavigation();

    return (
      <div
        css={{
          display: 'flex',
          flexDirection: 'column',
          gap: showBreadcrumbs ? theme.spacing.md : theme.spacing.xs,
          marginBottom: theme.spacing.xs,
        }}
      >
        {showBreadcrumbs && (
          <Breadcrumb includeTrailingCaret>
            {breadcrumbs.map((breadcrumb, index) => (
              <Breadcrumb.Item key={index}>{breadcrumb}</Breadcrumb.Item>
            ))}
          </Breadcrumb>
        )}
        <div
          css={{
            display: 'grid',
            gridTemplateColumns: '1fr auto auto',
          }}
        >
          <div
            css={{
              display: 'flex',
              gap: theme.spacing.sm,
              alignItems: titleMetadata ? 'flex-start' : 'center',
              overflow: 'hidden',
              minWidth: 250,
            }}
          >
            {!shouldEnableWorkflowBasedNavigation() && (
              <Button
                componentId="mlflow.experiment-page.header.back-icon-button"
                data-testid="experiment-view-header-back-button"
                type="tertiary"
                icon={<ArrowLeftIcon />}
                onClick={handleBack}
              />
            )}
            <div
              css={{
                borderRadius: theme.borders.borderRadiusSm,
                backgroundColor: theme.colors.backgroundSecondary,
                padding: theme.spacing.sm,
                flexShrink: 0,
              }}
            >
              {getTabDisplayIcon(activeTabByRoute)}
            </div>
            <div
              css={{
                display: 'flex',
                flexDirection: 'column',
                gap: theme.spacing.xs,
                minWidth: 0,
                maxWidth: '100%',
              }}
            >
              <div
                css={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: theme.spacing.sm,
                  overflow: 'hidden',
                  minWidth: 0,
                }}
              >
                <Tooltip
                  content={headerTitleTooltip}
                  open={shouldEnableWorkflowBasedNavigation() ? false : undefined}
                  componentId="mlflow.experiment_view.header.experiment-name-tooltip"
                >
                  <span
                    css={{
                      maxWidth: '100%',
                      minWidth: 0,
                      flexShrink: 1,
                      overflow: 'hidden',
                    }}
                  >
                    <Typography.Title
                      withoutMargins
                      level={2}
                      css={{
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {headerTitle}
                    </Typography.Title>
                  </span>
                </Tooltip>
                {titleAdjacent}
                {experimentKindSelector}
                {traceArchivalRetention && shouldShowTraceArchivalBadge && (
                  <div css={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
                    <Tooltip
                      componentId="mlflow.experiment_view.header.trace_archival_badge_tooltip"
                      content={
                        <FormattedMessage
                          defaultMessage="Archived traces remain accessible, but searching within span content no longer works after archival."
                          description="Tooltip explaining the trace archival badge behavior"
                        />
                      }
                    >
                      <Tag
                        componentId="mlflow.experiment_view.header.trace_archival_badge"
                        color="turquoise"
                        css={{ margin: 0 }}
                      >
                        <FormattedMessage
                          defaultMessage="Archive after: {retention}"
                          description="Badge showing the active trace archival retention for the experiment"
                          values={{ retention: traceArchivalRetention }}
                        />
                      </Tag>
                    </Tooltip>
                  </div>
                )}
                {getInfoTooltip()}
              </div>
              {titleMetadata}
            </div>
          </div>
          <div />
          <div
            css={{ display: 'flex', gap: theme.spacing.sm, justifyContent: 'flex-end', marginLeft: theme.spacing.sm }}
          >
            {actionSlot}
            {!headerActionsHidden && (
              <>
                {savedViewsSlot}
                {!ROUTES_WITHOUT_MANAGEMENT_MENU.some((route) => matchPath(route, location.pathname)) && (
                  <ExperimentViewManagementMenu experiment={experiment} setEditing={setEditing} />
                )}
              </>
            )}
            {showDocsLink && (
              <Typography.Link
                componentId="mlflow.experiment-page.header.docs-link"
                href={docLinkHref}
                target="_blank"
                rel="noopener noreferrer"
              >
                <Button componentId="mlflow.experiment-page.header.docs-link-button" icon={<InfoBookIcon />}>
                  <FormattedMessage
                    defaultMessage="View docs"
                    description="Text for docs link button on experiment view page header"
                  />
                </Button>
              </Typography.Link>
            )}
          </div>
        </div>
      </div>
    );
  },
);

export function ExperimentViewHeaderSkeleton() {
  const { theme } = useDesignSystemTheme();

  return (
    <div css={{ display: 'flex', flexDirection: 'column', gap: theme.spacing.xs }}>
      <ParagraphSkeleton css={{ width: 100 }} loading />
      <div css={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr' }}>
        <TitleSkeleton css={{ width: 150, height: theme.general.heightSm }} loading />
        <TitleSkeleton css={{ height: theme.general.heightSm, alignSelf: 'center' }} loading />
        <TitleSkeleton css={{ width: theme.spacing.lg, height: theme.general.heightSm, alignSelf: 'right' }} loading />
      </div>
    </div>
  );
}
