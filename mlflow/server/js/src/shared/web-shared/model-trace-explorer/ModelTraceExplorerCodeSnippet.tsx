import { isString } from 'lodash';
import { useEffect, useMemo, useState } from 'react';

import { ChevronDownIcon, DropdownMenu, Tag, Typography, useDesignSystemTheme } from '@databricks/design-system';

import type { SearchMatch } from './ModelTrace.types';
import { CodeSnippetRenderMode } from './ModelTrace.types';
import { ModelTraceExplorerCodeSnippetBody } from './ModelTraceExplorerCodeSnippetBody';
import { ModelTraceExplorerHighlightedSnippetTitle } from './ModelTraceExplorerHighlightedSnippetTitle';

// return the initial render mode if specified, otherwise
// default to markdown for string data and json for non-string data
function getInitialRenderMode(dataIsString: boolean, initialRenderMode?: CodeSnippetRenderMode) {
  if (initialRenderMode) {
    return initialRenderMode;
  }

  if (dataIsString) {
    return CodeSnippetRenderMode.MARKDOWN;
  }

  return CodeSnippetRenderMode.JSON;
}

const CommentBubbleIcon = ({ size = 16, color = 'currentColor' }: { size?: number; color?: string }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    role="img"
    aria-hidden
  >
    <path
      d="M21 12c0 4.418-4.03 8-9 8-1.1 0-2.15-.17-3.11-.48L4 21l1.5-3.6A8.4 8.4 0 0 1 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8Z"
      stroke={color}
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      fill="none"
    />
  </svg>
);

function getRenderModeDisplayText(renderMode: CodeSnippetRenderMode) {
  switch (renderMode) {
    case CodeSnippetRenderMode.JSON:
      return 'JSON';
    case CodeSnippetRenderMode.TEXT:
      return 'Text';
    case CodeSnippetRenderMode.MARKDOWN:
      return 'Markdown';
    case CodeSnippetRenderMode.PYTHON:
      return 'Python';
  }
}

export function ModelTraceExplorerCodeSnippet({
  title,
  tokens,
  data,
  searchFilter = '',
  activeMatch = null,
  containsActiveMatch = false,
  initialRenderMode,
  jsonPath,
  spanId,
  feedbackCount,
}: {
  title: string;
  tokens?: number;
  data: string;
  searchFilter?: string;
  // the current active search match
  activeMatch?: SearchMatch | null;
  // whether the snippet being rendered contains the
  // current active match (either in the key or value)
  containsActiveMatch?: boolean;
  initialRenderMode?: CodeSnippetRenderMode;
  // optional metadata used when users select text for feedback
  jsonPath?: string;
  spanId?: string;
  // number of stored text-selection feedback comments for this field
  feedbackCount?: number;
}) {
  const parsedData = useMemo(() => JSON.parse(data), [data]);
  const dataIsString = isString(parsedData);
  const { theme } = useDesignSystemTheme();
  // string data can be rendered in multiple formats
  const [renderMode, setRenderMode] = useState<CodeSnippetRenderMode>(
    getInitialRenderMode(dataIsString, initialRenderMode),
  );
  const isTitleMatch = containsActiveMatch && (activeMatch?.isKeyMatch ?? false);
  const shouldShowRenderModeDropdown = dataIsString && !searchFilter;
  const selectionAttributes = useMemo(
    () => ({
      'data-json-path': jsonPath ?? '',
      ...(spanId ? { 'data-span-id': spanId } : {}),
    }),
    [jsonPath, spanId],
  );

  const hasFeedbackBadge = (feedbackCount ?? 0) > 0;

  // we need to reset the render mode when the data changes
  useEffect(() => {
    setRenderMode(getInitialRenderMode(dataIsString, initialRenderMode));
  }, [dataIsString, initialRenderMode]);

  return (
    <div
      css={{
        position: 'relative',
      }}
    >
      <div
        css={{
          borderRadius: theme.borders.borderRadiusSm,
          border: `1px solid ${theme.colors.border}`,
          boxShadow: hasFeedbackBadge ? `inset 0 0 0 2px ${theme.colors.actionPrimaryBorderDefault}` : undefined,
          backgroundColor: hasFeedbackBadge ? theme.colors.actionPrimaryBackgroundTransparent : undefined,
          overflow: 'hidden',
        }}
      >
        {(title || shouldShowRenderModeDropdown) && (
          <div
            css={{
              display: 'flex',
              flexDirection: 'row',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: theme.spacing.sm,
            }}
          >
            {/* TODO: support other types of formatting, e.g. markdown */}
            <Typography.Title
              css={{
                maxWidth: '100%',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
              level={4}
              color="secondary"
              withoutMargins
            >
              <ModelTraceExplorerHighlightedSnippetTitle
                title={title}
                searchFilter={searchFilter}
                isActiveMatch={isTitleMatch}
              />
            </Typography.Title>
            <div css={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: theme.spacing.xs }}>
              {hasFeedbackBadge && (
                <div
                  css={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: theme.spacing.xs / 2,
                    padding: `${theme.spacing.xs / 2}px ${theme.spacing.xs}px`,
                    borderRadius: theme.borders.borderRadiusLg,
                    backgroundColor: theme.colors.backgroundSecondary,
                    border: `1px solid ${theme.colors.border}`,
                  }}
                  title="Text selection feedback"
                >
                  <CommentBubbleIcon size={14} color={theme.colors.textSecondary} />
                  <div
                    css={{
                      minWidth: 18,
                      height: 18,
                      padding: '0 6px',
                      borderRadius: 12,
                      backgroundColor: theme.colors.actionPrimaryBackgroundDefault,
                      color: theme.colors.actionPrimaryTextDefault,
                      fontSize: 11,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      lineHeight: 1,
                    }}
                  >
                    {feedbackCount}
                  </div>
                </div>
              )}
              <div css={{ display: 'flex', flexDirection: 'row', alignItems: 'center' }}>
                {shouldShowRenderModeDropdown && (
                  <DropdownMenu.Root>
                    <DropdownMenu.Trigger asChild>
                      <Tag
                        componentId="shared.model-trace-explorer.snippet-render-mode-tag"
                        css={{
                          height: 'min-content',
                          margin: 0,
                        }}
                      >
                        {/* for some reason `cursor: pointer` doesn't work if you set it on the Tag css */}
                        <div css={{ paddingLeft: theme.spacing.xs, marginRight: theme.spacing.xs, cursor: 'pointer' }}>
                          <Typography.Text size="sm" color="secondary">
                            {getRenderModeDisplayText(renderMode)}
                          </Typography.Text>
                          <ChevronDownIcon />
                        </div>
                      </Tag>
                    </DropdownMenu.Trigger>
                    <DropdownMenu.Content>
                      <DropdownMenu.RadioGroup
                        componentId="shared.model-trace-explorer.snippet-render-mode-radio"
                        value={renderMode}
                        onValueChange={(value) => setRenderMode(value as CodeSnippetRenderMode)}
                      >
                        {Object.values(CodeSnippetRenderMode).map((mode) => {
                          if (mode === CodeSnippetRenderMode.PYTHON) {
                            return null;
                          }
                          return (
                            <DropdownMenu.RadioItem key={mode} value={mode}>
                              <DropdownMenu.ItemIndicator />
                              {getRenderModeDisplayText(mode)}
                            </DropdownMenu.RadioItem>
                          );
                        })}
                      </DropdownMenu.RadioGroup>
                      <DropdownMenu.Arrow />
                    </DropdownMenu.Content>
                  </DropdownMenu.Root>
                )}
              </div>
            </div>
          </div>
        )}
        <div {...selectionAttributes}>
          <ModelTraceExplorerCodeSnippetBody
            data={data}
            searchFilter={searchFilter}
            activeMatch={activeMatch}
            containsActiveMatch={containsActiveMatch}
            renderMode={renderMode}
            hasFeedback={hasFeedbackBadge}
          />
        </div>
      </div>
    </div>
  );
}
