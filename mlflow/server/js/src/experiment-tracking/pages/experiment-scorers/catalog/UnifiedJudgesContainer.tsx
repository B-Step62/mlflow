import { useMemo, useState, useCallback } from 'react';
import { useDesignSystemTheme } from '@databricks/design-system';
import type { ScheduledScorer } from '../types';
import type { CatalogEntry, CatalogProvider, JudgeCategory, RegisteredJudgeRow } from './types';
import {
  filterCatalogEntries,
  filterRegisteredScorers,
  groupByCategoryEntries,
  getCategoryForEntry,
} from './judgeCatalogUtils';
import { useAddCatalogScorerToExperiment } from './useAddCatalogScorerToExperiment';
import { useDeleteScheduledScorerMutation } from '../hooks/useDeleteScheduledScorer';
import { useUpdateScheduledScorerMutation } from '../hooks/useUpdateScheduledScorer';
import JudgeCatalogFiltersRenderer from './JudgeCatalogFiltersRenderer';
import UnifiedJudgesTableRenderer from './UnifiedJudgesTableRenderer';
import JudgeCatalogDetailModal from './JudgeCatalogDetailModal';
import JudgeSelectionActionBar from '../JudgeSelectionActionBar';
import ScorerModalRenderer from '../ScorerModalRenderer';
import { DeleteScorerModalRenderer } from '../DeleteScorerModalRenderer';
import { SCORER_FORM_MODE } from '../constants';
import { isNil } from 'lodash';
import catalogData from './judgeCatalogData.json';

interface UnifiedJudgesContainerProps {
  scorers: ScheduledScorer[];
  isLoadingScorers: boolean;
  experimentId: string;
  onOpenCreateModal: () => void;
  onOpenCreateCustomCodeModal: () => void;
}

const UnifiedJudgesContainer: React.FC<UnifiedJudgesContainerProps> = ({
  scorers,
  isLoadingScorers,
  experimentId,
  onOpenCreateModal,
  onOpenCreateCustomCodeModal,
}) => {
  const { theme } = useDesignSystemTheme();

  // Filter state
  const [searchQuery, setSearchQuery] = useState('');
  const [activeCategories, setActiveCategories] = useState<Set<JudgeCategory>>(new Set());
  const [selectedProviders, setSelectedProviders] = useState<CatalogProvider[]>(['custom', 'mlflow']);

  // Selection state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Expanded categories (show all cards vs default 4)
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());

  // Modal state
  const [activeModal, setActiveModal] = useState<'edit' | 'delete' | 'catalog-detail' | null>(null);
  const [selectedScorer, setSelectedScorer] = useState<ScheduledScorer | null>(null);
  const [selectedCatalogEntry, setSelectedCatalogEntry] = useState<CatalogEntry | null>(null);

  const entries = catalogData as CatalogEntry[];

  const filteredScorers = useMemo(() => {
    return filterRegisteredScorers(scorers, searchQuery, [], selectedProviders);
  }, [scorers, searchQuery, selectedProviders]);

  const filteredCatalogEntries = useMemo(() => {
    const base = filterCatalogEntries(entries, searchQuery, [], selectedProviders);
    if (activeCategories.size === 0) return base;
    return base.filter((entry) => {
      const category = getCategoryForEntry(entry);
      return category !== null && activeCategories.has(category);
    });
  }, [entries, searchQuery, activeCategories, selectedProviders]);

  // Build a lookup from catalog entry name → entry for matching registered scorers to catalog
  const catalogEntryByName = useMemo(() => {
    const map = new Map<string, CatalogEntry>();
    for (const entry of entries) {
      map.set(entry.name, entry);
    }
    return map;
  }, [entries]);

  // Split registered scorers: built-in (matching catalog) vs custom ("My Judges")
  const { customRegisteredRows, registeredByEntryId } = useMemo(() => {
    const custom: RegisteredJudgeRow[] = [];
    const byEntryId = new Map<string, RegisteredJudgeRow>();
    for (const scorer of filteredScorers) {
      const row: RegisteredJudgeRow = {
        kind: 'registered' as const,
        rowKey: `registered-${scorer.name}`,
        scorer,
        status: (!isNil(scorer.sampleRate) && scorer.sampleRate > 0 ? 'active' : 'inactive') as 'active' | 'inactive',
      };
      const catalogEntry = catalogEntryByName.get(scorer.name);
      if (catalogEntry) {
        byEntryId.set(catalogEntry.id, row);
      } else {
        custom.push(row);
      }
    }
    return { customRegisteredRows: custom, registeredByEntryId: byEntryId };
  }, [filteredScorers, catalogEntryByName]);

  const registeredRows = customRegisteredRows;

  const categoryGroups = useMemo(() => groupByCategoryEntries(filteredCatalogEntries), [filteredCatalogEntries]);

  const isFiltered = searchQuery !== '' || activeCategories.size > 0 || selectedProviders.length > 0;

  const { addScorerToExperiment } = useAddCatalogScorerToExperiment({ experimentId, onOpenCreateModal });
  const deleteScorerMutation = useDeleteScheduledScorerMutation();
  const updateScorerMutation = useUpdateScheduledScorerMutation();

  const handleToggleSelection = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const handleClearSelection = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  const handleRegisteredRowClick = useCallback((scorer: ScheduledScorer) => {
    setSelectedScorer(scorer);
    setActiveModal('edit');
  }, []);

  const handleCatalogRowClick = useCallback((entry: CatalogEntry) => {
    setSelectedCatalogEntry(entry);
    setActiveModal('catalog-detail');
  }, []);

  const handleToggleRegisteredActive = useCallback(
    (scorer: ScheduledScorer, active: boolean) => {
      updateScorerMutation.mutate({
        experimentId,
        scheduledScorers: [{ ...scorer, sampleRate: active ? 100 : 0 }],
      });
    },
    [experimentId, updateScorerMutation],
  );

  const handleToggleCatalogActive = useCallback(
    (entry: CatalogEntry) => {
      addScorerToExperiment(entry, { activate: true });
    },
    [addScorerToExperiment],
  );

  const handleBulkDelete = useCallback(() => {
    const selectedRegistered = registeredRows.find((r) => selectedIds.has(r.rowKey));
    if (selectedRegistered) {
      setSelectedScorer(selectedRegistered.scorer);
      setActiveModal('delete');
    }
  }, [registeredRows, selectedIds]);

  const handleDeleteConfirm = useCallback(() => {
    if (!selectedScorer) return;
    deleteScorerMutation.mutate(
      { experimentId, scorerNames: [selectedScorer.name] },
      { onSuccess: () => setActiveModal(null) },
    );
  }, [deleteScorerMutation, experimentId, selectedScorer]);

  const handleToggleExpandCategory = useCallback((categoryKey: string) => {
    setExpandedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(categoryKey)) {
        next.delete(categoryKey);
      } else {
        next.add(categoryKey);
      }
      return next;
    });
  }, []);

  const handleCloseModal = useCallback(() => {
    setActiveModal(null);
    deleteScorerMutation.reset();
  }, [deleteScorerMutation]);

  // Get selected scorers for the action bar
  const selectedScorers = useMemo(() => {
    return registeredRows.filter((r) => selectedIds.has(r.rowKey)).map((r) => r.scorer);
  }, [registeredRows, selectedIds]);

  return (
    <div
      css={{
        display: 'flex',
        flexDirection: 'column',
        gap: theme.spacing.md,
        padding: theme.spacing.sm,
      }}
    >
      <JudgeCatalogFiltersRenderer
        searchQuery={searchQuery}
        onSearchQueryChange={setSearchQuery}
        activeCategories={activeCategories}
        onActiveCategoriesChange={setActiveCategories}
        selectedProviders={selectedProviders}
        onSelectedProvidersChange={setSelectedProviders}
        onNewLLMJudge={onOpenCreateModal}
        onNewCustomCodeJudge={onOpenCreateCustomCodeModal}
      />
      {selectedIds.size > 0 && (
        <JudgeSelectionActionBar
          selectedScorers={selectedScorers}
          experimentId={experimentId}
          onDelete={handleBulkDelete}
          onClearSelection={handleClearSelection}
        />
      )}
      <UnifiedJudgesTableRenderer
        registeredRows={registeredRows}
        categoryGroups={categoryGroups}
        expandedCategories={expandedCategories}
        onToggleExpandCategory={handleToggleExpandCategory}
        activeCategories={activeCategories}
        isFiltered={isFiltered}
        isLoadingRegistered={isLoadingScorers}
        selectedIds={selectedIds}
        onToggleSelection={handleToggleSelection}
        onRegisteredRowClick={handleRegisteredRowClick}
        onCatalogRowClick={handleCatalogRowClick}
        onToggleRegisteredActive={handleToggleRegisteredActive}
        onToggleCatalogActive={handleToggleCatalogActive}
        registeredByEntryId={registeredByEntryId}
      />
      {selectedScorer && (
        <>
          <ScorerModalRenderer
            visible={activeModal === 'edit'}
            onClose={handleCloseModal}
            experimentId={experimentId}
            mode={SCORER_FORM_MODE.EDIT}
            existingScorer={selectedScorer}
          />
          <DeleteScorerModalRenderer
            isOpen={activeModal === 'delete'}
            onClose={handleCloseModal}
            onConfirm={handleDeleteConfirm}
            scorer={selectedScorer}
            isLoading={deleteScorerMutation.isLoading}
            error={deleteScorerMutation.error}
          />
        </>
      )}
      <JudgeCatalogDetailModal
        entry={selectedCatalogEntry}
        visible={activeModal === 'catalog-detail'}
        onClose={handleCloseModal}
      />
    </div>
  );
};

export default UnifiedJudgesContainer;
