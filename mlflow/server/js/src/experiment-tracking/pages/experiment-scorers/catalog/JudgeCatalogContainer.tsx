import { useMemo, useState } from 'react';
import { useDesignSystemTheme } from '@databricks/design-system';
import type { CatalogEntry, CatalogProvider, JudgeCategory } from './types';
import { filterCatalogEntries, getCategoryForEntry } from './judgeCatalogUtils';
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
  const [activeCategories, setActiveCategories] = useState<Set<JudgeCategory>>(new Set());
  const [selectedProviders, setSelectedProviders] = useState<CatalogProvider[]>(['custom', 'mlflow']);
  const [detailEntry, setDetailEntry] = useState<CatalogEntry | null>(null);

  const entries = catalogData as CatalogEntry[];

  const filteredEntries = useMemo(() => {
    const base = filterCatalogEntries(entries, searchQuery, [], selectedProviders);
    if (activeCategories.size === 0) return base;
    return base.filter((entry) => {
      const category = getCategoryForEntry(entry);
      return category !== null && activeCategories.has(category);
    });
  }, [entries, searchQuery, activeCategories, selectedProviders]);

  const isFiltered = searchQuery !== '' || activeCategories.size > 0 || selectedProviders.length > 0;

  const { addScorerToExperiment } = useAddCatalogScorerToExperiment({
    experimentId,
    onOpenCreateModal,
  });

  return (
    <div css={{ display: 'flex', flexDirection: 'column', gap: theme.spacing.md, padding: theme.spacing.sm }}>
      <JudgeCatalogFiltersRenderer
        searchQuery={searchQuery}
        onSearchQueryChange={setSearchQuery}
        activeCategories={activeCategories}
        onActiveCategoriesChange={setActiveCategories}
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
