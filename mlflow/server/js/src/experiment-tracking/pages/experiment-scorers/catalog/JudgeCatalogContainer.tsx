import { useMemo, useState } from 'react';
import { useDesignSystemTheme } from '@databricks/design-system';
import type { CatalogEntry, CatalogProvider, CatalogTag } from './types';
import { filterCatalogEntries } from './judgeCatalogUtils';
import JudgeCatalogFiltersRenderer from './JudgeCatalogFiltersRenderer';
import JudgeCatalogTableRenderer from './JudgeCatalogTableRenderer';
import JudgeCatalogDetailModal from './JudgeCatalogDetailModal';
import { useAddCatalogScorerToExperiment } from './useAddCatalogScorerToExperiment';
import catalogData from './judgeCatalogData.json';

interface JudgeCatalogContainerProps {
  experimentId: string;
  onOpenCreateModal: () => void;
}

const JudgeCatalogContainer: React.FC<JudgeCatalogContainerProps> = ({ experimentId, onOpenCreateModal }) => {
  const { theme } = useDesignSystemTheme();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTags, setSelectedTags] = useState<CatalogTag[]>([]);
  const [selectedProviders, setSelectedProviders] = useState<CatalogProvider[]>([]);
  const [detailEntry, setDetailEntry] = useState<CatalogEntry | null>(null);

  const entries = catalogData as CatalogEntry[];

  const filteredEntries = useMemo(
    () => filterCatalogEntries(entries, searchQuery, selectedTags, selectedProviders),
    [entries, searchQuery, selectedTags, selectedProviders],
  );

  const isFiltered = searchQuery !== '' || selectedTags.length > 0 || selectedProviders.length > 0;

  const { addScorerToExperiment } = useAddCatalogScorerToExperiment({
    experimentId,
    onOpenCreateModal,
  });

  return (
    <div css={{ display: 'flex', flexDirection: 'column', gap: theme.spacing.md, padding: theme.spacing.sm }}>
      <JudgeCatalogFiltersRenderer
        searchQuery={searchQuery}
        onSearchQueryChange={setSearchQuery}
        selectedTags={selectedTags}
        onSelectedTagsChange={setSelectedTags}
        selectedProviders={selectedProviders}
        onSelectedProvidersChange={setSelectedProviders}
      />
      <JudgeCatalogTableRenderer
        entries={filteredEntries}
        onRowClick={setDetailEntry}
        onSchedule={addScorerToExperiment}
        isFiltered={isFiltered}
      />
      <JudgeCatalogDetailModal
        entry={detailEntry}
        visible={detailEntry !== null}
        onClose={() => setDetailEntry(null)}
      />
    </div>
  );
};

export default JudgeCatalogContainer;
