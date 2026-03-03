import {
  CodeIcon,
  DialogCombobox,
  DialogComboboxContent,
  DialogComboboxOptionList,
  DialogComboboxOptionListCheckboxItem,
  DialogComboboxTrigger,
  DropdownMenu,
  PlusIcon,
  SplitButton,
  TableFilterInput,
  ToggleButton,
  useDesignSystemTheme,
} from '@databricks/design-system';
import { FormattedMessage, useIntl } from '@databricks/i18n';
import type { CatalogProvider, JudgeCategory } from './types';
import { ALL_PROVIDERS, getProviderDisplayName, JUDGE_CATEGORIES } from './judgeCatalogUtils';
import { COMPONENT_ID_PREFIX } from '../constants';

interface JudgeCatalogFiltersRendererProps {
  searchQuery: string;
  onSearchQueryChange: (query: string) => void;
  activeCategories: Set<JudgeCategory>;
  onActiveCategoriesChange: (categories: Set<JudgeCategory>) => void;
  selectedProviders: CatalogProvider[];
  onSelectedProvidersChange: (providers: CatalogProvider[]) => void;
  onNewLLMJudge?: () => void;
  onNewCustomCodeJudge?: () => void;
}

const JudgeCatalogFiltersRenderer: React.FC<JudgeCatalogFiltersRendererProps> = ({
  searchQuery,
  onSearchQueryChange,
  activeCategories,
  onActiveCategoriesChange,
  selectedProviders,
  onSelectedProvidersChange,
  onNewLLMJudge,
  onNewCustomCodeJudge,
}) => {
  const intl = useIntl();
  const { theme } = useDesignSystemTheme();

  return (
    <div css={{ display: 'flex', flexDirection: 'column', gap: theme.spacing.sm }}>
      <div css={{ display: 'flex', gap: theme.spacing.sm, alignItems: 'center' }}>
        <div css={{ flex: 1 }}>
          <TableFilterInput
            css={{ width: '100%' }}
            componentId={`${COMPONENT_ID_PREFIX}.catalog.search-input`}
            placeholder={intl.formatMessage({
              defaultMessage: 'Search judges by name...',
              description: 'Placeholder for judge catalog search input',
            })}
            value={searchQuery}
            onChange={(e) => onSearchQueryChange(e.target.value)}
          />
        </div>
        <DialogCombobox
          componentId={`${COMPONENT_ID_PREFIX}.catalog.provider-filter`}
          label={intl.formatMessage({
            defaultMessage: 'Provider',
            description: 'Label for provider filter dropdown in judge catalog',
          })}
          value={selectedProviders}
          multiSelect
        >
          <DialogComboboxTrigger
            allowClear={selectedProviders.length > 0}
            onClear={() => onSelectedProvidersChange([])}
          />
          <DialogComboboxContent>
            <DialogComboboxOptionList>
              {ALL_PROVIDERS.map((provider) => (
                <DialogComboboxOptionListCheckboxItem
                  key={provider}
                  value={provider}
                  checked={selectedProviders.includes(provider)}
                  onChange={() => {
                    if (selectedProviders.includes(provider)) {
                      onSelectedProvidersChange(selectedProviders.filter((p) => p !== provider));
                    } else {
                      onSelectedProvidersChange([...selectedProviders, provider]);
                    }
                  }}
                >
                  {getProviderDisplayName(provider)}
                </DialogComboboxOptionListCheckboxItem>
              ))}
            </DialogComboboxOptionList>
          </DialogComboboxContent>
        </DialogCombobox>
        {onNewLLMJudge && (
          <SplitButton
            type="primary"
            icon={<PlusIcon />}
            componentId={`${COMPONENT_ID_PREFIX}.new-scorer-button`}
            onClick={onNewLLMJudge}
            css={{ marginLeft: 'auto', flexShrink: 0 }}
            menu={
              onNewCustomCodeJudge ? (
                <DropdownMenu.Content>
                  <DropdownMenu.Item
                    componentId={`${COMPONENT_ID_PREFIX}.new-custom-code-scorer-menu-item`}
                    onClick={onNewCustomCodeJudge}
                    css={{ display: 'flex', alignItems: 'center', gap: theme.spacing.xs }}
                  >
                    <CodeIcon />
                    <FormattedMessage
                      defaultMessage="Custom code judge"
                      description="Menu item text to create a new custom code judge"
                    />
                  </DropdownMenu.Item>
                </DropdownMenu.Content>
              ) : undefined
            }
          >
            <FormattedMessage defaultMessage="New LLM judge" description="Button text to create a new LLM judge" />
          </SplitButton>
        )}
      </div>
      <div css={{ display: 'flex', gap: theme.spacing.xs, flexWrap: 'wrap', alignItems: 'center' }}>
        {JUDGE_CATEGORIES.map((cat) => (
          <ToggleButton
            key={cat.key}
            componentId={`${COMPONENT_ID_PREFIX}.catalog.category.${cat.key}`}
            pressed={activeCategories.has(cat.key)}
            onPressedChange={() => {
              const next = new Set(activeCategories);
              if (next.has(cat.key)) {
                next.delete(cat.key);
              } else {
                next.add(cat.key);
              }
              onActiveCategoriesChange(next);
            }}
            css={{ borderRadius: 9999 }}
          >
            {cat.displayName}
          </ToggleButton>
        ))}
      </div>
    </div>
  );
};

export default JudgeCatalogFiltersRenderer;
