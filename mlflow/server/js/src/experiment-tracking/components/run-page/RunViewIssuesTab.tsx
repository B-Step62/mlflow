import { useMemo, useState, useEffect, useRef, useCallback, type ReactNode } from 'react';
import type { TagColors } from '@databricks/design-system';
import { TableSkeleton, useDesignSystemTheme } from '@databricks/design-system';
import { IssuesTabEmptyState } from './IssuesTabEmptyState';
import { IssueCard } from './IssueCard';
import { IssueDetailsPanel, type IssueEvalSetupStatus } from './IssueDetailsPanel';
import { IssueStatusFilter, type IssueStatusFilterValue } from './IssueStatusFilter';
import { IssueTracesPanel } from './IssueTracesPanel';
import { useSearchIssuesQuery, type Issue } from './hooks/useSearchIssuesQuery';
import { useSelectedIssueId } from './hooks/useSelectedIssueId';

export interface RunViewIssuesTabProps {
  runUuid: string;
  experimentId: string;
}

export const RunViewIssuesContent = ({
  issues,
  isLoading,
  experimentId,
  hideIssueActions = false,
  getIssueSourceLabel,
  getIssueSourceTagColor,
  compactCards = false,
  defaultSelectFirstIssue = false,
  detailsPanel = 'traces',
  onIssueStatusChange,
  getIssueEvalSetupStatus,
  onIssueEvalSetupStatusChange,
  getIssueEvalSetupDatasetMode,
  onIssueEvalSetupDatasetModeChange,
  statusFilter: controlledStatusFilter,
  onStatusFilterChange,
  hideStatusFilter = false,
}: {
  issues: Issue[];
  isLoading?: boolean;
  experimentId: string;
  hideIssueActions?: boolean;
  getIssueSourceLabel?: (issue: Issue) => ReactNode;
  getIssueSourceTagColor?: (issue: Issue) => TagColors;
  compactCards?: boolean;
  defaultSelectFirstIssue?: boolean;
  detailsPanel?: 'traces' | 'details';
  onIssueStatusChange?: (issueId: string, status: Issue['status']) => void;
  getIssueEvalSetupStatus?: (issue: Issue) => IssueEvalSetupStatus;
  onIssueEvalSetupStatusChange?: (issueId: string, status: IssueEvalSetupStatus) => void;
  getIssueEvalSetupDatasetMode?: (issue: Issue) => 'new' | 'golden';
  onIssueEvalSetupDatasetModeChange?: (issueId: string, mode: 'new' | 'golden') => void;
  statusFilter?: IssueStatusFilterValue;
  onStatusFilterChange?: (value: IssueStatusFilterValue) => void;
  hideStatusFilter?: boolean;
}) => {
  const { theme } = useDesignSystemTheme();
  const [uncontrolledStatusFilter, setUncontrolledStatusFilter] = useState<IssueStatusFilterValue>('pending');
  const statusFilter = controlledStatusFilter ?? uncontrolledStatusFilter;
  const setStatusFilter = onStatusFilterChange ?? setUncontrolledStatusFilter;
  const issueCardRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const autoSwitchedForIssueRef = useRef<string | null>(null);

  const filteredIssues = useMemo(() => {
    if (statusFilter === 'all') {
      return issues;
    }
    return issues.filter((issue) => issue.status === statusFilter);
  }, [issues, statusFilter]);

  // Scroll to the selected issue card
  const scrollToSelectedIssue = useCallback((issueId: string) => {
    // Use requestAnimationFrame to ensure scroll happens after DOM updates
    // This is especially important when the list reorders after an update
    requestAnimationFrame(() => {
      const cardElement = issueCardRefs.current[issueId];
      if (cardElement) {
        cardElement.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    });
  }, []);

  const [selectedIssueId, setSelectedIssueId] = useSelectedIssueId({
    onSelect: scrollToSelectedIssue,
  });

  // Auto-select issue from URL parameter when issues load.
  // Also switch to the correct status filter so the issue is visible.
  useEffect(() => {
    // Reset tracking when selectedIssueId changes, so navigating back to the same issue
    // (e.g., via browser back button) will re-trigger the auto-switch if needed.
    if (autoSwitchedForIssueRef.current && autoSwitchedForIssueRef.current !== selectedIssueId) {
      autoSwitchedForIssueRef.current = null;
    }

    if (selectedIssueId && issues.length > 0) {
      const issue = issues.find((i) => i.issue_id === selectedIssueId);
      if (issue) {
        if (autoSwitchedForIssueRef.current !== selectedIssueId) {
          autoSwitchedForIssueRef.current = selectedIssueId;
          if (issue.status !== statusFilter) {
            setStatusFilter(issue.status);
          }
        }
        scrollToSelectedIssue(selectedIssueId);
      }
    }
  }, [selectedIssueId, issues, scrollToSelectedIssue, statusFilter, setStatusFilter]);

  const handleSelect = (issue: Issue) => {
    const isDeselecting = selectedIssueId === issue.issue_id;
    setSelectedIssueId(isDeselecting ? undefined : issue.issue_id);
  };

  const selectedIssue = useMemo(
    () => issues.find((i) => i.issue_id === selectedIssueId) || (defaultSelectFirstIssue ? filteredIssues[0] : null),
    [defaultSelectFirstIssue, filteredIssues, issues, selectedIssueId],
  );

  if (isLoading) {
    return (
      <div css={{ padding: theme.spacing.md }}>
        <TableSkeleton lines={5} />
      </div>
    );
  }

  if (issues.length === 0) {
    return (
      <div
        css={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: theme.spacing.md,
        }}
      >
        <IssuesTabEmptyState />
      </div>
    );
  }

  return (
    <div
      css={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        minWidth: 320,
        backgroundColor: theme.colors.backgroundPrimary,
      }}
    >
      {!compactCards && !hideStatusFilter && (
        <IssueStatusFilter issues={issues} value={statusFilter} onChange={setStatusFilter} />
      )}
      <div
        css={{
          flex: 1,
          display: 'grid',
          gridTemplateColumns: selectedIssue
            ? compactCards
              ? 'minmax(300px, 360px) minmax(0, 1fr)'
              : 'minmax(280px, 1fr) 2fr'
            : '1fr',
          overflow: 'hidden',
          minHeight: 0,
        }}
      >
        <div
          css={{
            display: 'flex',
            flexDirection: 'column',
            gap: compactCards ? theme.spacing.xs : theme.spacing.sm,
            padding: compactCards
              ? `${theme.spacing.xs}px ${theme.spacing.sm}px ${theme.spacing.sm}px`
              : theme.spacing.md,
            borderRight: compactCards && selectedIssue ? `1px solid ${theme.colors.border}` : undefined,
            overflow: 'auto',
            minHeight: 0,
          }}
        >
          {compactCards && !hideStatusFilter && (
            <IssueStatusFilter issues={issues} value={statusFilter} onChange={setStatusFilter} />
          )}
          {filteredIssues.map((issue) => (
            <div key={issue.issue_id} ref={(el) => (issueCardRefs.current[issue.issue_id] = el)}>
              <IssueCard
                issue={issue}
                isSelected={selectedIssue?.issue_id === issue.issue_id}
                onSelect={() => handleSelect(issue)}
                hideActions={hideIssueActions}
                sourceLabel={getIssueSourceLabel?.(issue)}
                sourceTagColor={getIssueSourceTagColor?.(issue)}
                compact={compactCards}
              />
            </div>
          ))}
        </div>
        {selectedIssue && (
          <div
            css={{
              flex: 1,
              display: 'flex',
              borderLeft: compactCards ? undefined : `1px solid ${theme.colors.border}`,
              minHeight: 0,
              minWidth: 0,
              overflowY: 'auto',
            }}
          >
            {detailsPanel === 'details' ? (
              <IssueDetailsPanel
                issue={selectedIssue}
                experimentId={experimentId}
                onStatusChange={onIssueStatusChange}
                evalSetupStatus={getIssueEvalSetupStatus?.(selectedIssue)}
                evalSetupDatasetMode={getIssueEvalSetupDatasetMode?.(selectedIssue)}
                onEvalSetupStatusChange={onIssueEvalSetupStatusChange}
                onEvalSetupDatasetModeChange={onIssueEvalSetupDatasetModeChange}
              />
            ) : (
              <IssueTracesPanel issue={selectedIssue} experimentId={experimentId} />
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export const RunViewIssuesTab = ({ runUuid, experimentId }: RunViewIssuesTabProps) => {
  const { issues, isLoading } = useSearchIssuesQuery({
    experimentId,
    sourceRunId: runUuid,
  });

  return <RunViewIssuesContent issues={issues} isLoading={isLoading} experimentId={experimentId} />;
};
