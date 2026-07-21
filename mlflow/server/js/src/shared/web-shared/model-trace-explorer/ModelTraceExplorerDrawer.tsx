import React, { useCallback, useEffect, useState } from 'react';

import {
  ApplyDesignSystemContextOverrides,
  ArrowDownIcon,
  ArrowUpIcon,
  Button,
  DatabaseIcon,
  FlagPointerIcon,
  FullscreenExitIcon,
  FullscreenIcon,
  LinkIcon,
  Notification,
  SearchIcon,
  SendIcon,
  SparkleIcon,
  Tooltip,
  useDesignSystemTheme,
} from '@databricks/design-system';
import { FormattedMessage } from '@databricks/i18n';
import { Global } from '@emotion/react';
import { useAssistant } from '@mlflow/mlflow/src/assistant';

import { ModelTraceExplorerCustomViewSelector } from './ModelTraceExplorerCustomViewSelector';
import { ModelTraceExplorerSkeleton } from './ModelTraceExplorerSkeleton';
import {
  ModelTraceExplorerRightPaneHeaderActionsProvider,
  useModelTraceExplorerContext,
} from './ModelTraceExplorerContext';
import type { ModelTraceInfoV3 } from './ModelTrace.types';
import { getAiGradientBorderStyle } from '../design-system/aiGradientBorderStyle';
import { copyToClipboard } from '../../../common/utils/copyToClipboard';
import { useLocalStorage } from '../hooks/useLocalStorage';

const FLAG_FOR_REVIEW_GUIDANCE_STORAGE_KEY = 'mlflow.flagForReview.guidanceShown';

// Targets the Radix popper wrapper that contains the tooltip background, arrow,
// and content so the entire tooltip fades in together. If Radix renames this
// internal attribute the animation silently stops — no functional breakage.
const RADIX_POPPER_WRAPPER_SELECTOR = '[data-radix-popper-content-wrapper]:has([data-flag-guidance])';
const FLAG_FOR_REVIEW_GUIDANCE_STORAGE_VERSION = 1;

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
  handleClose,
  children,
  isLoading,
  experimentId,
  traceInfo,
}: ModelTraceExplorerDrawerProps) => {
  const { theme } = useDesignSystemTheme();
  const { isLocalServer, isStreaming, openPanel, sendMessage } = useAssistant();
  const [showDatasetModal, setShowDatasetModal] = useState(false);
  const [showCopiedNotification, setShowCopiedNotification] = useState(false);
  const [showCopyError, setShowCopyError] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isSearchVisible, setSearchVisible] = useState(false);
  const [assistantPrompt, setAssistantPrompt] = useState('');
  const [isAssistantPromptFocused, setAssistantPromptFocused] = useState(false);
  const {
    renderExportTracesToDatasetsModal,
    renderAddToReviewQueueDropdown,
    DrawerComponent,
    drawerWidth = '60vw',
  } = useModelTraceExplorerContext();

  const [hasSeenFlagGuidance, setHasSeenFlagGuidance] = useLocalStorage({
    key: FLAG_FOR_REVIEW_GUIDANCE_STORAGE_KEY,
    version: FLAG_FOR_REVIEW_GUIDANCE_STORAGE_VERSION,
    initialValue: false,
  });

  const [isDrawerAnimationDone, setIsDrawerAnimationDone] = useState(false);

  const showFlagForReviewButton = Boolean(renderAddToReviewQueueDropdown && experimentId && traceInfo);

  useEffect(() => {
    if (!showFlagForReviewButton || hasSeenFlagGuidance) {
      return;
    }
    const timer = setTimeout(() => setIsDrawerAnimationDone(true), 500);
    return () => clearTimeout(timer);
  }, [showFlagForReviewButton, hasSeenFlagGuidance]);

  const handleDismissFlagGuidance = useCallback(() => {
    setHasSeenFlagGuidance(true);
  }, [setHasSeenFlagGuidance]);

  const handleShareClick = useCallback(async () => {
    const success = await copyToClipboard(window.location.href);
    if (success) {
      setShowCopiedNotification(true);
      setTimeout(() => setShowCopiedNotification(false), 2000);
    } else {
      setShowCopyError(true);
      setTimeout(() => setShowCopyError(false), 2000);
    }
  }, []);

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
      if (e.key === 'ArrowUp' && isPreviousAvailable) {
        e.preventDefault();
        e.stopPropagation();
        selectPreviousEval();
      } else if (e.key === 'ArrowDown' && isNextAvailable) {
        e.preventDefault();
        e.stopPropagation();
        selectNextEval();
      }
    },
    [isPreviousAvailable, isNextAvailable, selectPreviousEval, selectNextEval],
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [handleKeyDown]);

  const showAddToDatasetButton = Boolean(renderExportTracesToDatasetsModal && experimentId && traceInfo);
  const handleAddToDatasetClick = useCallback(() => setShowDatasetModal(true), []);
  const handleToggleFullscreen = useCallback(() => setIsFullscreen((value) => !value), []);
  const handleFindClick = useCallback(() => setSearchVisible((visible) => !visible), []);
  const assistantPlaceholder = traceInfo?.state === 'ERROR' ? 'Debug error in this trace' : 'Analyze this trace. ';

  const handleAssistantSubmit = useCallback(() => {
    const prompt = assistantPrompt.trim() || assistantPlaceholder.trim();
    if (!prompt || isStreaming) {
      return;
    }
    openPanel();
    sendMessage(prompt);
    setAssistantPrompt('');
  }, [assistantPlaceholder, assistantPrompt, isStreaming, openPanel, sendMessage]);

  const handleAssistantKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key !== 'Enter' || e.nativeEvent.isComposing) {
        return;
      }
      e.preventDefault();
      handleAssistantSubmit();
    },
    [handleAssistantSubmit],
  );

  const showFlagGuidance = showFlagForReviewButton && !hasSeenFlagGuidance && isDrawerAnimationDone;

  const flagForReviewButton =
    showFlagForReviewButton && renderAddToReviewQueueDropdown
      ? React.createElement(renderAddToReviewQueueDropdown, {
          selectedTraceInfos: traceInfo ? [traceInfo] : [],
          experimentId: experimentId ?? '',
          onOpenChange: (open: boolean) => {
            if (open && !hasSeenFlagGuidance) {
              handleDismissFlagGuidance();
            }
          },
          popoverAlign: 'end',
          children: (
            <Button
              componentId="mlflow.evaluations_review.modal.flag_for_review"
              icon={<FlagPointerIcon />}
              size="small"
            >
              <FormattedMessage
                defaultMessage="Review"
                description="Button text for assigning a trace to reviewers via a review queue"
              />
            </Button>
          ),
        })
      : null;

  const hasRightPaneHeaderActions = showAddToDatasetButton || showFlagForReviewButton;
  const rightPaneHeaderActions = hasRightPaneHeaderActions ? (
    <div css={{ display: 'flex', alignItems: 'center', gap: theme.spacing.xs, flexShrink: 0 }}>
      {showAddToDatasetButton && (
        <Tooltip
          componentId="mlflow.evaluations_review.modal.add_to_dataset.tooltip"
          content={
            <FormattedMessage defaultMessage="Add to dataset" description="Tooltip for adding a trace to a dataset" />
          }
        >
          <Button
            componentId="mlflow.evaluations_review.modal.add_to_dataset"
            onClick={handleAddToDatasetClick}
            icon={<DatabaseIcon />}
            size="small"
          >
            <FormattedMessage
              defaultMessage="Dataset"
              description="Short button text for adding a trace to a dataset"
            />
          </Button>
        </Tooltip>
      )}
      {showFlagForReviewButton && (
        <>
          {showFlagGuidance && (
            <Global
              styles={{
                '@keyframes flagGuidanceFadeIn': {
                  from: { opacity: 0 },
                  to: { opacity: 1 },
                },
                [RADIX_POPPER_WRAPPER_SELECTOR]: {
                  animation: 'flagGuidanceFadeIn 300ms ease-in',
                },
              }}
            />
          )}
          <Tooltip
            componentId="mlflow.evaluations_review.modal.flag_for_review.guidance"
            open={showFlagGuidance || undefined}
            content={
              showFlagGuidance ? (
                <div data-flag-guidance onClick={handleDismissFlagGuidance} css={{ cursor: 'pointer' }}>
                  <FormattedMessage
                    defaultMessage="New! Flag traces for review and add them to a review queue."
                    description="Guidance tooltip message for the flag for review button in the trace drawer"
                  />
                </div>
              ) : (
                <FormattedMessage
                  defaultMessage="Flag for review"
                  description="Tooltip for assigning a trace to reviewers via a review queue"
                />
              )
            }
          >
            <div>{flagForReviewButton}</div>
          </Tooltip>
        </>
      )}
    </div>
  ) : null;

  return (
    <DrawerComponent.Root
      open
      onOpenChange={(open) => {
        if (!open) {
          handleClose();
        }
      }}
    >
      {isFullscreen && (
        <Global
          styles={{
            '[data-component-id="mlflow.evaluations_review.modal"]': {
              left: '0 !important',
              right: '0 !important',
              width: '100vw !important',
              minWidth: '100vw !important',
              maxWidth: 'none !important',
              height: '100vh !important',
            },
            '[data-drawer-resize-handle="true"]': {
              display: 'none !important',
            },
          }}
        />
      )}
      <DrawerComponent.Content
        componentId="mlflow.evaluations_review.modal"
        width={isFullscreen ? '100vw' : drawerWidth}
        title={
          <div css={{ display: 'flex', gap: theme.spacing.sm, alignItems: 'center' }}>
            <Tooltip
              componentId="mlflow.evaluations_review.modal.fullscreen-tooltip"
              content={
                isFullscreen ? (
                  <FormattedMessage
                    defaultMessage="Exit full screen"
                    description="Tooltip for collapsing the trace drawer from full screen"
                  />
                ) : (
                  <FormattedMessage
                    defaultMessage="Full screen"
                    description="Tooltip for expanding the trace drawer to full screen"
                  />
                )
              }
            >
              <Button
                componentId="mlflow.evaluations_review.modal.fullscreen"
                aria-label={isFullscreen ? 'Exit full screen' : 'Full screen'}
                icon={isFullscreen ? <FullscreenExitIcon /> : <FullscreenIcon />}
                onClick={handleToggleFullscreen}
              />
            </Tooltip>
            <Button
              componentId="mlflow.evaluations_review.modal.previous_eval"
              aria-label="Previous trace"
              icon={<ArrowUpIcon />}
              disabled={!isPreviousAvailable}
              onClick={() => selectPreviousEval()}
            />
            <Button
              componentId="mlflow.evaluations_review.modal.next_eval"
              aria-label="Next trace"
              icon={<ArrowDownIcon />}
              disabled={!isNextAvailable}
              onClick={() => selectNextEval()}
            />
            <ModelTraceExplorerCustomViewSelector />
            <div
              css={{
                width: 1,
                alignSelf: 'stretch',
                backgroundColor: theme.colors.border,
                marginLeft: theme.spacing.xs,
                marginRight: theme.spacing.xs,
              }}
            />
            <div css={{ flex: 1, overflow: 'hidden', minWidth: 0 }} />
            {isLocalServer && (
              <div
                data-assistant-ui="true"
                onFocusCapture={() => setAssistantPromptFocused(true)}
                onBlurCapture={(e) => {
                  if (!e.currentTarget.contains(e.relatedTarget)) {
                    setAssistantPromptFocused(false);
                  }
                }}
                css={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: theme.spacing.xs,
                  flex: '0 1 408px',
                  minWidth: 240,
                  height: 32,
                  padding: `0 ${theme.spacing.sm}px`,
                  borderRadius: theme.borders.borderRadiusSm,
                  ...getAiGradientBorderStyle(theme),
                }}
              >
                <SparkleIcon color="ai" css={{ flexShrink: 0, fontSize: 16 }} />
                <input
                  aria-label="Ask the MLflow assistant about this trace"
                  placeholder={assistantPlaceholder}
                  value={assistantPrompt}
                  onChange={(e) => setAssistantPrompt(e.target.value)}
                  onKeyDown={handleAssistantKeyDown}
                  css={{
                    minWidth: 0,
                    flex: 1,
                    height: '100%',
                    padding: 0,
                    border: 'none',
                    outline: 'none',
                    background: 'transparent',
                    color: theme.colors.textPrimary,
                    fontFamily: 'inherit',
                    fontSize: theme.typography.fontSizeBase,
                    lineHeight: 'normal',
                    '&::placeholder': {
                      color: theme.colors.textPlaceholder,
                    },
                  }}
                />
                {isAssistantPromptFocused && (
                  <Button
                    componentId="mlflow.assistant.trace_header_send"
                    aria-label="Send message to assistant"
                    data-assistant-ui="true"
                    icon={<SendIcon />}
                    onClick={handleAssistantSubmit}
                    disabled={isStreaming}
                    size="small"
                    css={{
                      flexShrink: 0,
                      minWidth: 24,
                      width: 24,
                      height: 24,
                      padding: 0,
                    }}
                  />
                )}
              </div>
            )}
            <Tooltip
              componentId="mlflow.evaluations_review.modal.find-tooltip"
              content={
                <FormattedMessage
                  defaultMessage="Find in trace"
                  description="Tooltip for opening the trace search row"
                />
              }
            >
              <Button
                componentId="mlflow.evaluations_review.modal.find-button"
                icon={<SearchIcon />}
                onClick={handleFindClick}
                aria-pressed={isSearchVisible}
              >
                <FormattedMessage defaultMessage="Find" description="Label for the trace search button" />
              </Button>
            </Tooltip>
            <Tooltip
              componentId="mlflow.evaluations_review.modal.share-tooltip"
              content={
                <FormattedMessage
                  defaultMessage="Copy link to trace"
                  description="Tooltip for the share trace button"
                />
              }
            >
              <Button
                componentId="mlflow.evaluations_review.modal.share-button"
                icon={<LinkIcon />}
                onClick={handleShareClick}
              >
                <FormattedMessage defaultMessage="Share" description="Label for the share trace button" />
              </Button>
            </Tooltip>
          </div>
        }
        expandContentToFullHeight
        css={[
          {
            ...(isFullscreen
              ? {
                  left: 0,
                  right: 0,
                  bottom: 0,
                  width: '100vw !important',
                  minWidth: '100vw !important',
                  maxWidth: 'none !important',
                  height: '100vh',
                }
              : {}),
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
        ]}
      >
        <ApplyDesignSystemContextOverrides zIndexBase={2 * theme.options.zIndexBase}>
          <ModelTraceExplorerRightPaneHeaderActionsProvider
            openAddToDatasetModal={showAddToDatasetButton ? handleAddToDatasetClick : undefined}
            rightPaneHeaderActions={rightPaneHeaderActions}
            isSearchVisible={isSearchVisible}
            setSearchVisible={setSearchVisible}
          >
            {isLoading ? <ModelTraceExplorerSkeleton /> : <>{children}</>}
          </ModelTraceExplorerRightPaneHeaderActionsProvider>
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
      {showCopyError && (
        <Notification.Provider>
          <Notification.Root severity="error" componentId="mlflow.evaluations_review.modal.share-error-notification">
            <Notification.Title>
              <FormattedMessage
                defaultMessage="Failed to copy to clipboard"
                description="Error message when clipboard copy fails"
              />
            </Notification.Title>
          </Notification.Root>
          <Notification.Viewport />
        </Notification.Provider>
      )}
    </DrawerComponent.Root>
  );
};
