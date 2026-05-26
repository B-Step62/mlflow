import React, { useCallback, useEffect, useMemo, useState } from 'react';

import {
  ApplyDesignSystemContextOverrides,
  Button,
  ChevronLeftIcon,
  ChevronRightIcon,
  PlusIcon,
  Notification,
  Tooltip,
  useDesignSystemTheme,
} from '@databricks/design-system';
import { FormattedMessage } from '@databricks/i18n';

import { shouldUseNewTraceExperience } from './FeatureUtils';
import { ModelTraceExplorerSkeleton } from './ModelTraceExplorerSkeleton';
import { useModelTraceExplorerContext } from './ModelTraceExplorerContext';
import type { ModelTraceInfoV3 } from './ModelTrace.types';
import { NewTraceExperienceShellProvider } from './new-trace-experience/NewTraceExperienceShellContext';

export interface ModelTraceExplorerDrawerProps {
  children: React.ReactNode;
  selectPreviousEval: () => void;
  selectNextEval: () => void;
  isPreviousAvailable: boolean;
  isNextAvailable: boolean;
  renderModalTitle: () => React.ReactNode;
  handleClose: () => void;
  isLoading?: boolean;
  experimentId?: string;
  traceInfo?: ModelTraceInfoV3;
}

export const ModelTraceExplorerDrawer = ({
  selectPreviousEval,
  selectNextEval,
  isPreviousAvailable,
  isNextAvailable,
  renderModalTitle,
  handleClose,
  children,
  isLoading,
  experimentId,
  traceInfo,
}: ModelTraceExplorerDrawerProps) => {
  const { theme } = useDesignSystemTheme();
  const [showDatasetModal, setShowDatasetModal] = useState(false);
  const [showCopiedNotification, setShowCopiedNotification] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const {
    renderExportTracesToDatasetsModal,
    DrawerComponent,
    drawerWidth: contextDrawerWidth,
  } = useModelTraceExplorerContext();
  const isNewTraceExperience = shouldUseNewTraceExperience();
  // The new shell renders narrower by default and ignores any width supplied by
  // upstream context (e.g. TracesV3View passes 80vw, which is too wide for the
  // new layout). Legacy mode keeps the previous behaviour.
  const newExperienceDrawerWidth = '70vw';
  const legacyDrawerWidth = contextDrawerWidth ?? '60vw';
  const restingDrawerWidth = isNewTraceExperience ? newExperienceDrawerWidth : legacyDrawerWidth;
  const drawerWidth = isFullscreen ? '100vw' : restingDrawerWidth;

  const handleShareClick = useCallback(() => {
    navigator.clipboard.writeText(window.location.href);
    setShowCopiedNotification(true);
    setTimeout(() => setShowCopiedNotification(false), 2000);
  }, []);

  const toggleFullscreen = useCallback(() => setIsFullscreen((prev) => !prev), []);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement) {
        if (e.target.role === 'tab') {
          return;
        }
        const tagName = e.target?.tagName?.toLowerCase();
        if (tagName === 'input' || tagName === 'textarea' || e.target.isContentEditable) {
          return;
        }
      }
      const previousKey = isNewTraceExperience ? 'ArrowUp' : 'ArrowLeft';
      const nextKey = isNewTraceExperience ? 'ArrowDown' : 'ArrowRight';
      if (e.key === previousKey && isPreviousAvailable) {
        e.stopPropagation();
        selectPreviousEval();
      } else if (e.key === nextKey && isNextAvailable) {
        e.stopPropagation();
        selectNextEval();
      }
    },
    [isNewTraceExperience, isPreviousAvailable, isNextAvailable, selectPreviousEval, selectNextEval],
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [handleKeyDown]);

  const showAddToDatasetButton = Boolean(renderExportTracesToDatasetsModal && experimentId && traceInfo);
  const handleAddToDatasetClick = useCallback(() => setShowDatasetModal(true), []);

  const newShellContextValue = useMemo(
    () => ({
      selectPreviousTrace: selectPreviousEval,
      selectNextTrace: selectNextEval,
      isPreviousAvailable,
      isNextAvailable,
      onShare: handleShareClick,
      onClose: handleClose,
      isFullscreen,
      toggleFullscreen,
    }),
    [
      selectPreviousEval,
      selectNextEval,
      isPreviousAvailable,
      isNextAvailable,
      handleShareClick,
      handleClose,
      isFullscreen,
      toggleFullscreen,
    ],
  );

  const legacyTitleBar = (
    <div css={{ display: 'flex', gap: theme.spacing.sm, alignItems: 'center' }}>
      <Button
        componentId="mlflow.evaluations_review.modal.previous_eval"
        disabled={!isPreviousAvailable}
        onClick={() => selectPreviousEval()}
      >
        <ChevronLeftIcon />
      </Button>
      <Button
        componentId="mlflow.evaluations_review.modal.next_eval"
        disabled={!isNextAvailable}
        onClick={() => selectNextEval()}
      >
        <ChevronRightIcon />
      </Button>
      <div css={{ flex: 1, overflow: 'hidden' }}>{renderModalTitle()}</div>
      {showAddToDatasetButton && (
        <Button
          componentId="mlflow.evaluations_review.modal.add_to_dataset"
          onClick={handleAddToDatasetClick}
          icon={<PlusIcon />}
        >
          <FormattedMessage defaultMessage="Add to dataset" description="Button text for adding a trace to a dataset" />
        </Button>
      )}
      <Tooltip
        componentId="mlflow.evaluations_review.modal.share-tooltip"
        content={
          <FormattedMessage defaultMessage="Copy link to trace" description="Tooltip for the share trace button" />
        }
      >
        <Button componentId="mlflow.evaluations_review.modal.share-button" onClick={handleShareClick}>
          <FormattedMessage defaultMessage="Share" description="Label for the share trace button" />
        </Button>
      </Tooltip>
    </div>
  );

  const renderedChildren = isLoading ? <ModelTraceExplorerSkeleton /> : children;
  const wrappedChildren = isNewTraceExperience ? (
    <NewTraceExperienceShellProvider value={newShellContextValue}>{renderedChildren}</NewTraceExperienceShellProvider>
  ) : (
    renderedChildren
  );

  return (
    <DrawerComponent.Root
      open
      onOpenChange={(open) => {
        if (!open) {
          handleClose();
        }
      }}
    >
      <DrawerComponent.Content
        componentId="mlflow.evaluations_review.modal"
        width={drawerWidth}
        title={isNewTraceExperience ? null : legacyTitleBar}
        hideClose={isNewTraceExperience}
        expandContentToFullHeight
        css={[
          {
            '&>div': {
              overflow: 'hidden',
            },
            '&>div:first-child': {
              paddingLeft: theme.spacing.md,
              paddingTop: 1,
              paddingBottom: 1,
              '&>button': {
                flexShrink: 0,
              },
            },
          },
          isNewTraceExperience && {
            // Hide the design-system drawer header row (title + side close button)
            // when the new shell owns the top bar.
            '&>div:first-child': {
              display: 'none',
            },
          },
        ]}
      >
        <ApplyDesignSystemContextOverrides zIndexBase={2 * theme.options.zIndexBase}>
          {wrappedChildren}
        </ApplyDesignSystemContextOverrides>
        {renderExportTracesToDatasetsModal?.({
          selectedTraceInfos: traceInfo ? [traceInfo] : [],
          experimentId: experimentId ?? '',
          visible: showDatasetModal,
          setVisible: setShowDatasetModal,
        })}
      </DrawerComponent.Content>
      {showCopiedNotification && (
        <Notification.Provider>
          <Notification.Root severity="success" componentId="mlflow.evaluations_review.modal.share-notification">
            <Notification.Title>
              <FormattedMessage
                defaultMessage="Copied to clipboard"
                description="Success message after copying trace link"
              />
            </Notification.Title>
          </Notification.Root>
          <Notification.Viewport />
        </Notification.Provider>
      )}
    </DrawerComponent.Root>
  );
};
