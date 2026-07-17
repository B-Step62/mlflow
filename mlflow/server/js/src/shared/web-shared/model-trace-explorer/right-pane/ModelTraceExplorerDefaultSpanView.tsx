import { isNil } from 'lodash';
import { useMemo, useState } from 'react';

import { Button, ChevronDownIcon, DropdownMenu, useDesignSystemTheme } from '@databricks/design-system';
import { FormattedMessage } from '@databricks/i18n';

import type { ModelTraceExplorerRenderMode, ModelTraceSpanNode, SearchMatch } from '../ModelTrace.types';
import { createListFromObject } from '../ModelTraceExplorer.utils';
import { ModelTraceExplorerCollapsibleSection } from '../ModelTraceExplorerCollapsibleSection';
import { ModelTraceExplorerFieldRenderer } from '../field-renderers/ModelTraceExplorerFieldRenderer';

export function ModelTraceExplorerDefaultSpanView({
  activeSpan,
  className,
  searchFilter,
  activeMatch,
  defaultRenderMode,
}: {
  activeSpan: ModelTraceSpanNode | undefined;
  className?: string;
  searchFilter: string;
  activeMatch: SearchMatch | null;
  defaultRenderMode: ModelTraceExplorerRenderMode;
}) {
  const { theme } = useDesignSystemTheme();
  const [fieldRenderModes, setFieldRenderModes] = useState<Record<string, ModelTraceExplorerRenderMode>>({});
  const inputList = useMemo(() => createListFromObject(activeSpan?.inputs), [activeSpan]);
  const outputList = useMemo(() => createListFromObject(activeSpan?.outputs), [activeSpan]);

  if (isNil(activeSpan)) {
    return null;
  }

  const containsInputs = inputList.length > 0;
  const containsOutputs = outputList.length > 0;

  const isActiveMatchSpan = !isNil(activeMatch) && activeMatch.span.key === activeSpan.key;

  const renderModeDropdown = (
    renderMode: ModelTraceExplorerRenderMode,
    setRenderMode: (mode: ModelTraceExplorerRenderMode) => void,
  ) => (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <Button
          size="small"
          componentId="shared.model-trace-explorer.default-span-view.render-mode"
          type="tertiary"
          endIcon={<ChevronDownIcon />}
        >
          {renderMode === 'default' ? (
            <FormattedMessage
              defaultMessage="Default"
              description="Label for the default render mode in the model trace explorer inputs/outputs section"
            />
          ) : renderMode === 'json' ? (
            <FormattedMessage
              defaultMessage="JSON"
              description="Label for the JSON render mode in the model trace explorer inputs/outputs section"
            />
          ) : (
            <FormattedMessage
              defaultMessage="Table"
              description="Label for the Table render mode in the model trace explorer inputs/outputs section"
            />
          )}
        </Button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Content align="end">
        <DropdownMenu.RadioGroup
          componentId="shared.model-trace-explorer.default-span-view.render-mode-radio"
          value={renderMode}
          onValueChange={(value) => setRenderMode(value as ModelTraceExplorerRenderMode)}
        >
          <DropdownMenu.RadioItem value="default">
            <DropdownMenu.ItemIndicator />
            <FormattedMessage
              defaultMessage="Default"
              description="Label for the default render mode dropdown item in the model trace explorer inputs/outputs section"
            />
          </DropdownMenu.RadioItem>
          <DropdownMenu.RadioItem value="json">
            <DropdownMenu.ItemIndicator />
            <FormattedMessage
              defaultMessage="JSON"
              description="Label for the JSON render mode dropdown item in the model trace explorer inputs/outputs section"
            />
          </DropdownMenu.RadioItem>
          <DropdownMenu.RadioItem value="table">
            <DropdownMenu.ItemIndicator />
            <FormattedMessage
              defaultMessage="Table"
              description="Label for the Table render mode dropdown item in the model trace explorer inputs/outputs section"
            />
          </DropdownMenu.RadioItem>
        </DropdownMenu.RadioGroup>
      </DropdownMenu.Content>
    </DropdownMenu.Root>
  );

  const getFieldRenderMode = (fieldId: string) => fieldRenderModes[fieldId] ?? defaultRenderMode;

  const renderFields = (section: 'inputs' | 'outputs', fields: typeof inputList) => (
    <div css={{ display: 'flex', flexDirection: 'column', gap: theme.spacing.sm }}>
      {fields.map(({ key, value }, index) => {
        const fieldId = `${section}:${key || index}`;
        const renderMode = getFieldRenderMode(fieldId);

        return (
          <ModelTraceExplorerFieldRenderer
            key={key || index}
            title={key}
            data={value}
            renderMode={renderMode}
            assessments={activeSpan?.assessments}
            searchFilter={searchFilter}
            activeMatch={activeMatch}
            containsActiveMatch={isActiveMatchSpan && activeMatch.section === section && activeMatch.key === key}
            titleSuffix={renderModeDropdown(renderMode, (mode) =>
              setFieldRenderModes((current) => ({ ...current, [fieldId]: mode })),
            )}
          />
        );
      })}
    </div>
  );

  return (
    <div data-testid="model-trace-explorer-default-span-view">
      {containsInputs && (
        <ModelTraceExplorerCollapsibleSection
          withBorder
          css={{ marginBottom: theme.spacing.sm }}
          sectionKey="input"
          title={
            <div
              css={{
                display: 'flex',
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                width: '100%',
              }}
            >
              <FormattedMessage
                defaultMessage="Inputs"
                description="Model trace explorer > selected span > inputs header"
              />
            </div>
          }
        >
          {renderFields('inputs', inputList)}
        </ModelTraceExplorerCollapsibleSection>
      )}
      {containsOutputs && (
        <ModelTraceExplorerCollapsibleSection
          withBorder
          sectionKey="output"
          title={
            <div css={{ display: 'flex', flexDirection: 'row', justifyContent: 'space-between', width: '100%' }}>
              <FormattedMessage
                defaultMessage="Outputs"
                description="Model trace explorer > selected span > outputs header"
              />
            </div>
          }
        >
          {renderFields('outputs', outputList)}
        </ModelTraceExplorerCollapsibleSection>
      )}
    </div>
  );
}
