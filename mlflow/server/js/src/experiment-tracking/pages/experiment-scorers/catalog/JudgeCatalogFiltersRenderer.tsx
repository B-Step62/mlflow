import {
  DialogCombobox,
  DialogComboboxContent,
  DialogComboboxOptionList,
  DialogComboboxOptionListCheckboxItem,
  DialogComboboxTrigger,
  TableFilterInput,
  TableFilterLayout,
} from '@databricks/design-system';
import { useIntl } from '@databricks/i18n';
import type { CatalogProvider, CatalogTag } from './types';
import { ALL_PROVIDERS, ALL_TAGS, getProviderDisplayName, getTagDisplayName } from './judgeCatalogUtils';
import { COMPONENT_ID_PREFIX } from '../constants';

interface JudgeCatalogFiltersRendererProps {
  searchQuery: string;
  onSearchQueryChange: (query: string) => void;
  selectedTags: CatalogTag[];
  onSelectedTagsChange: (tags: CatalogTag[]) => void;
  selectedProviders: CatalogProvider[];
  onSelectedProvidersChange: (providers: CatalogProvider[]) => void;
}

const JudgeCatalogFiltersRenderer: React.FC<JudgeCatalogFiltersRendererProps> = ({
  searchQuery,
  onSearchQueryChange,
  selectedTags,
  onSelectedTagsChange,
  selectedProviders,
  onSelectedProvidersChange,
}) => {
  const intl = useIntl();

  const handleTagToggle = (tag: CatalogTag) => {
    if (selectedTags.includes(tag)) {
      onSelectedTagsChange(selectedTags.filter((t) => t !== tag));
    } else {
      onSelectedTagsChange([...selectedTags, tag]);
    }
  };

  const handleProviderToggle = (provider: CatalogProvider) => {
    if (selectedProviders.includes(provider)) {
      onSelectedProvidersChange(selectedProviders.filter((p) => p !== provider));
    } else {
      onSelectedProvidersChange([...selectedProviders, provider]);
    }
  };

  return (
    <TableFilterLayout>
      <TableFilterInput
        componentId={`${COMPONENT_ID_PREFIX}.catalog.search-input`}
        placeholder={intl.formatMessage({
          defaultMessage: 'Search judges by name or description',
          description: 'Placeholder for judge catalog search input',
        })}
        value={searchQuery}
        onChange={(e) => onSearchQueryChange(e.target.value)}
      />
      <DialogCombobox
        componentId={`${COMPONENT_ID_PREFIX}.catalog.tag-filter`}
        label={intl.formatMessage({
          defaultMessage: 'Tags',
          description: 'Label for tag filter in judge catalog',
        })}
        multiSelect
        value={selectedTags}
      >
        <DialogComboboxTrigger />
        <DialogComboboxContent>
          <DialogComboboxOptionList>
            {ALL_TAGS.map((tag) => (
              <DialogComboboxOptionListCheckboxItem
                key={tag}
                value={tag}
                checked={selectedTags.includes(tag)}
                onChange={() => handleTagToggle(tag)}
              >
                {getTagDisplayName(tag)}
              </DialogComboboxOptionListCheckboxItem>
            ))}
          </DialogComboboxOptionList>
        </DialogComboboxContent>
      </DialogCombobox>
      <DialogCombobox
        componentId={`${COMPONENT_ID_PREFIX}.catalog.provider-filter`}
        label={intl.formatMessage({
          defaultMessage: 'Provider',
          description: 'Label for provider filter in judge catalog',
        })}
        multiSelect
        value={selectedProviders}
      >
        <DialogComboboxTrigger />
        <DialogComboboxContent>
          <DialogComboboxOptionList>
            {ALL_PROVIDERS.map((provider) => (
              <DialogComboboxOptionListCheckboxItem
                key={provider}
                value={provider}
                checked={selectedProviders.includes(provider)}
                onChange={() => handleProviderToggle(provider)}
              >
                {getProviderDisplayName(provider)}
              </DialogComboboxOptionListCheckboxItem>
            ))}
          </DialogComboboxOptionList>
        </DialogComboboxContent>
      </DialogCombobox>
    </TableFilterLayout>
  );
};

export default JudgeCatalogFiltersRenderer;
