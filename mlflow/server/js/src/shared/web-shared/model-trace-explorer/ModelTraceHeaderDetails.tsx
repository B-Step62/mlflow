import {
  Overflow,
  Tag,
  TagColors,
  Typography,
  useDesignSystemTheme,
  Tooltip,
  ClockIcon,
  Button,
  ListBorderIcon,
} from '@databricks/design-system';
import { Notification } from '@databricks/design-system';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { FormattedMessage, useIntl } from 'react-intl';
import type { ModelTrace, ModelTraceInfoV3 } from './ModelTrace.types';
import { getModelTraceId } from './ModelTraceExplorer.utils';
import { spanTimeFormatter } from './timeline-tree/TimelineTree.utils';
import { ChevronDownIcon, DropdownMenu, GearIcon } from '@databricks/design-system';
import { getSavedViews, getLastAppliedSavedViewId, setLastAppliedSavedViewId } from './mock_saved_views';
import { useModelTraceExplorerViewState } from './ModelTraceExplorerViewStateContext';
import { isUserFacingTag, parseJSONSafe, truncateToFirstLineWithMaxLength } from './TagUtils';

const BASE_TAG_COMPONENT_ID = 'mlflow.model_trace_explorer.header_details';
const BASE_NOTIFICATION_COMPONENT_ID = 'mlflow.model_trace_explorer.header_details.notification';

const ModelTraceHeaderMetricSection = ({
  label,
  value,
  icon,
  tagKey,
  color = 'teal',
  getTruncatedLabel,
  getComponentId,
  onCopy,
}: {
  label: React.ReactNode;
  value: string;
  icon?: React.ReactNode;
  tagKey: string;
  color?: TagColors;
  getTruncatedLabel: (label: string) => string;
  getComponentId: (key: string) => string;
  onCopy: () => void;
}) => {
  const { theme } = useDesignSystemTheme();

  const handleClick = () => {
    navigator.clipboard.writeText(value);
    onCopy();
  };

  return (
    <div
      css={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: 'row',
        gap: theme.spacing.sm,
      }}
    >
      <Typography.Text size="md" color="secondary">
        {label}
      </Typography.Text>
      <Tooltip componentId={getComponentId(tagKey)} content={value} maxWidth={400}>
        <Tag componentId={getComponentId(tagKey)} color={color} onClick={handleClick} css={{ cursor: 'pointer' }}>
          <span css={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: theme.spacing.xs }}>
            {icon && <span>{icon}</span>}
            <span>{getTruncatedLabel(value)}</span>
          </span>
        </Tag>
      </Tooltip>
    </div>
  );
};

export const ModelTraceHeaderDetails = ({ modelTrace }: { modelTrace: ModelTrace }) => {
  const intl = useIntl();
  const { theme } = useDesignSystemTheme();
  const [showNotification, setShowNotification] = useState(false);
  const { rootNode, setAppliedSavedView, selectedSavedViewId, setSelectedSavedViewId, setShowSavedViewEditor } =
    useModelTraceExplorerViewState();

  const tags = Object.entries(modelTrace.info.tags ?? {}).filter(([key]) => isUserFacingTag(key));

  const modelTraceId = getModelTraceId(modelTrace);

  // Extract experiment id if available (v3), fallback to "global"
  const experimentId = useMemo(() => {
    const info = modelTrace.info as any;
    if (info?.trace_location?.type === 'MLFLOW_EXPERIMENT') {
      return info?.trace_location?.mlflow_experiment?.experiment_id ?? 'global';
    }
    return info?.experiment_id ?? 'global';
  }, [modelTrace.info]);

  const savedViews = useMemo(() => getSavedViews(experimentId), [experimentId]);

  const tokenUsage = useMemo(() => {
    const tokenUsage = parseJSONSafe(
      (modelTrace.info as ModelTraceInfoV3)?.trace_metadata?.['mlflow.trace.tokenUsage'] ?? '{}',
    );

    return tokenUsage;
  }, [modelTrace.info]);

  const totalTokens = useMemo(() => tokenUsage?.total_tokens, [tokenUsage]);

  const latency = useMemo((): string | undefined => {
    if (rootNode) {
      return spanTimeFormatter(rootNode.end - rootNode.start);
    }

    return undefined;
  }, [rootNode]);

  const getComponentId = useCallback((key: string) => `${BASE_TAG_COMPONENT_ID}.tag-${key}`, []);

  const handleTagClick = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  const getTruncatedLabel = (label: string) => truncateToFirstLineWithMaxLength(label, 40);

  // auto-apply last used view per experiment on mount
  useEffect(() => {
    const lastId = getLastAppliedSavedViewId(experimentId);
    if (!lastId) return;
    const view = savedViews.find((v) => v.id === lastId);
    if (!view) return;
    setSelectedSavedViewId(view.id);
    setAppliedSavedView(view);
  }, [experimentId, savedViews, setAppliedSavedView, setSelectedSavedViewId]);

  const currentViewName = useMemo(() => {
    if (!selectedSavedViewId) return undefined;
    return savedViews.find((v) => v.id === selectedSavedViewId)?.name;
  }, [selectedSavedViewId, savedViews]);

  const CLEAR_VALUE = '__clear__';
  const applyView = useCallback(
    (idOrClear: string) => {
      if (idOrClear === CLEAR_VALUE) {
        setSelectedSavedViewId(undefined);
        setAppliedSavedView(undefined);
        setLastAppliedSavedViewId(experimentId, undefined);
        return;
      }
      const view = savedViews.find((v) => v.id === idOrClear);
      if (!view) return;
      setSelectedSavedViewId(view.id);
      setAppliedSavedView(view);
      setLastAppliedSavedViewId(experimentId, view.id);
    },
    [experimentId, savedViews, setAppliedSavedView, setSelectedSavedViewId],
  );

  const handleCopy = useCallback(() => {
    setShowNotification(true);
    setTimeout(() => setShowNotification(false), 2000);
  }, []);

  // side panel visibility controlled from context in parent container

  return (
    <>
      <div
        css={{
          display: 'flex',
          flexDirection: 'row',
          gap: theme.spacing.md,
          flexWrap: 'wrap',
          alignItems: 'center',
          paddingRight: theme.spacing.sm,
        }}
      >
        {modelTraceId && (
          <ModelTraceHeaderMetricSection
            label={<FormattedMessage defaultMessage="ID" description="Label for the ID section" />}
            value={modelTraceId}
            tagKey={modelTraceId}
            color="pink"
            getTruncatedLabel={getTruncatedLabel}
            getComponentId={getComponentId}
            onCopy={handleCopy}
          />
        )}
        {totalTokens && (
          <ModelTraceHeaderMetricSection
            label={<FormattedMessage defaultMessage="Token count" description="Label for the token count section" />}
            value={totalTokens.toString()}
            tagKey="token-count"
            color="default"
            getTruncatedLabel={getTruncatedLabel}
            getComponentId={getComponentId}
            onCopy={handleCopy}
          />
        )}
        {latency && (
          <ModelTraceHeaderMetricSection
            label={<FormattedMessage defaultMessage="Latency" description="Label for the latency section" />}
            icon={<ClockIcon css={{ fontSize: 12, display: 'flex', alignItems: 'center', justifyContent: 'center' }} />}
            value={latency}
            tagKey="latency"
            color="default"
            getTruncatedLabel={getTruncatedLabel}
            getComponentId={getComponentId}
            onCopy={handleCopy}
          />
        )}
        {tags.length > 0 && (
          <div
            css={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexDirection: 'row',
              gap: theme.spacing.sm,
            }}
          >
            <Typography.Text size="md" color="secondary">
              <FormattedMessage defaultMessage="Tags" description="Label for the tags section" />
            </Typography.Text>
            <Overflow noMargin>
              {tags.map(([key, value]) => {
                const tagKey = `${key}-${value}`;
                const fullText = `${key}: ${value}`;

                return (
                  <Tooltip key={key} componentId={getComponentId(tagKey)} content={fullText}>
                    <Tag
                      componentId={getComponentId(tagKey)}
                      color="teal"
                      onClick={() => {
                        handleTagClick(fullText);
                        handleCopy();
                      }}
                      css={{ cursor: 'pointer' }}
                    >
                      {getTruncatedLabel(`${key}: ${value}`)}
                    </Tag>
                  </Tooltip>
                );
              })}
            </Overflow>
          </div>
        )}

        {/* Saved View selector (moved to the right) */}
        <div css={{ marginLeft: 'auto', paddingRight: theme.spacing.xs }}>
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <Button
                componentId={`${BASE_TAG_COMPONENT_ID}.saved-view`}
                icon={<ListBorderIcon />}
                endIcon={<ChevronDownIcon />}
              >
                {currentViewName ??
                  intl.formatMessage({ defaultMessage: 'Saved View', description: 'Saved View dropdown label' })}
              </Button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Content align="end">
              <DropdownMenu.RadioGroup componentId={`${BASE_TAG_COMPONENT_ID}.saved-view-radio-group`} value={selectedSavedViewId ?? CLEAR_VALUE} onValueChange={(value) => applyView(value)}>
                <DropdownMenu.RadioItem value={CLEAR_VALUE}>
                  <DropdownMenu.ItemIndicator />
                  <FormattedMessage defaultMessage="Clear view" description="Trace header: clear saved view option" />
                </DropdownMenu.RadioItem>
                {savedViews.map((v) => (
                  <DropdownMenu.RadioItem key={v.id} value={v.id}>
                    <DropdownMenu.ItemIndicator />
                    {v.name}
                  </DropdownMenu.RadioItem>
                ))}
              </DropdownMenu.RadioGroup>
              <DropdownMenu.Separator />
              <DropdownMenu.Item
                style={{ margin: theme.spacing.xs, gap: theme.spacing.sm }}
                componentId={`${BASE_TAG_COMPONENT_ID}.create-edit-view`} onClick={() => setShowSavedViewEditor(true)}>
                <GearIcon style={{ color: theme.colors.textSecondary }} />
                <FormattedMessage defaultMessage="Create/Edit View" description="Open saved view editor" />
              </DropdownMenu.Item>
              <DropdownMenu.Arrow />
            </DropdownMenu.Content>
          </DropdownMenu.Root>
        </div>
      </div>

      {showNotification && (
        <Notification.Provider>
          <Notification.Root severity="success" componentId={BASE_NOTIFICATION_COMPONENT_ID}>
            <Notification.Title>
              <FormattedMessage
                defaultMessage="Copied to clipboard"
                description="Success message for the notification"
              />
            </Notification.Title>
          </Notification.Root>
          <Notification.Viewport />
        </Notification.Provider>
      )}

      {/* SavedTraceViewPanel is rendered in ModelTraceExplorerContent to stay within viewer */}
    </>
  );
};
