import React from 'react';
import {
  Button,
  Checkbox,
  Empty,
  HoverCard,
  NoIcon,
  ParagraphSkeleton,
  Switch,
  Tooltip,
  useDesignSystemTheme,
} from '@databricks/design-system';
import { FormattedMessage, useIntl } from '@databricks/i18n';
import type { ScheduledScorer } from '../types';
import type { CatalogEntry, CatalogProvider, CategoryGroup, JudgeCategory, RegisteredJudgeRow } from './types';
import { getProviderDisplayName } from './judgeCatalogUtils';
import { COMPONENT_ID_PREFIX } from '../constants';
import ProviderLogo from './ProviderLogo';
import { isNil } from 'lodash';

const CARDS_PER_ROW = 4;

interface UnifiedJudgesTableRendererProps {
  registeredRows: RegisteredJudgeRow[];
  categoryGroups: CategoryGroup[];
  expandedCategories: Set<string>;
  onToggleExpandCategory: (categoryKey: string) => void;
  activeCategories: Set<JudgeCategory>;
  isFiltered: boolean;
  isLoadingRegistered: boolean;
  selectedIds: Set<string>;
  onToggleSelection: (id: string) => void;
  onRegisteredRowClick: (scorer: ScheduledScorer) => void;
  onCatalogRowClick: (entry: CatalogEntry) => void;
  onToggleRegisteredActive: (scorer: ScheduledScorer, active: boolean) => void;
  onToggleCatalogActive: (entry: CatalogEntry) => void;
  registeredByEntryId: Map<string, RegisteredJudgeRow>;
}

const UnifiedJudgesTableRenderer: React.FC<UnifiedJudgesTableRendererProps> = ({
  registeredRows,
  categoryGroups,
  expandedCategories,
  onToggleExpandCategory,
  activeCategories,
  isFiltered,
  isLoadingRegistered,
  selectedIds,
  onToggleSelection,
  onRegisteredRowClick,
  onCatalogRowClick,
  onToggleRegisteredActive,
  onToggleCatalogActive,
  registeredByEntryId,
}) => {
  const { theme } = useDesignSystemTheme();
  const intl = useIntl();

  const hasAnyRows = registeredRows.length > 0 || categoryGroups.length > 0;

  if (isLoadingRegistered && !hasAnyRows) {
    return (
      <div
        css={{
          display: 'flex',
          flexDirection: 'column',
          width: '100%',
          gap: theme.spacing.sm,
          padding: theme.spacing.lg,
        }}
      >
        {[...Array(3).keys()].map((i) => (
          <ParagraphSkeleton
            label={intl.formatMessage({
              defaultMessage: 'Loading judges...',
              description: 'Loading message while fetching experiment judges',
            })}
            key={i}
            seed={`scorer-${i}`}
          />
        ))}
      </div>
    );
  }

  if (!hasAnyRows && isFiltered) {
    return (
      <div css={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 300 }}>
        <Empty
          image={<NoIcon />}
          title={
            <FormattedMessage
              defaultMessage="No judges found"
              description="Empty state title when no judges match the filters"
            />
          }
          description={null}
        />
      </div>
    );
  }

  const showAllCards = activeCategories.size > 0;

  return (
    <div css={{ display: 'flex', flexDirection: 'column', gap: theme.spacing.lg }}>
      {/* My Judges section */}
      {registeredRows.length > 0 && (
        <CategorySection
          title={intl.formatMessage({
            defaultMessage: 'My Judges',
            description: 'Section header for user-registered judges',
          })}
          count={registeredRows.length}
          showAll={showAllCards || expandedCategories.has('my-judges')}
          onToggleExpand={() => onToggleExpandCategory('my-judges')}
        >
          {registeredRows.map((row) => (
            <RegisteredJudgeCard
              key={row.rowKey}
              row={row}
              isSelected={selectedIds.has(row.rowKey)}
              onToggleSelection={() => onToggleSelection(row.rowKey)}
              onClick={() => onRegisteredRowClick(row.scorer)}
              onToggleActive={(active) => onToggleRegisteredActive(row.scorer, active)}
            />
          ))}
        </CategorySection>
      )}

      {/* Category sections */}
      {categoryGroups.map((group) => (
        <CategorySection
          key={group.category}
          title={group.displayName}
          count={group.entries.length}
          showAll={showAllCards || expandedCategories.has(group.category)}
          onToggleExpand={() => onToggleExpandCategory(group.category)}
        >
          {group.entries.map((entry) => {
            const registeredRow = registeredByEntryId.get(entry.id);
            return (
              <CatalogJudgeCard
                key={entry.id}
                entry={entry}
                registeredRow={registeredRow}
                isSelected={selectedIds.has(entry.id)}
                onToggleSelection={() => onToggleSelection(entry.id)}
                onClick={
                  registeredRow
                    ? () => onRegisteredRowClick(registeredRow.scorer)
                    : () => onCatalogRowClick(entry)
                }
                onToggleActive={(active) =>
                  registeredRow
                    ? onToggleRegisteredActive(registeredRow.scorer, active)
                    : onToggleCatalogActive(entry)
                }
              />
            );
          })}
        </CategorySection>
      ))}
    </div>
  );
};

// --- CategorySection ---

const CategorySection: React.FC<{
  title: string;
  count: number;
  showAll: boolean;
  onToggleExpand: () => void;
  children: React.ReactNode;
}> = ({ title, count, showAll, onToggleExpand, children }) => {
  const { theme } = useDesignSystemTheme();

  const childArray = React.Children.toArray(children);
  const visibleChildren = showAll ? childArray : childArray.slice(0, CARDS_PER_ROW);
  const hasMore = childArray.length > CARDS_PER_ROW;

  return (
    <div css={{ display: 'flex', flexDirection: 'column', gap: theme.spacing.sm }}>
      <div
        css={{
          display: 'flex',
          alignItems: 'center',
          gap: theme.spacing.sm,
          borderBottom: `1px solid ${theme.colors.borderDecorative}`,
          paddingBottom: theme.spacing.xs,
        }}
      >
        <span
          css={{
            fontWeight: theme.typography.typographyBoldFontWeight,
            fontSize: theme.typography.fontSizeSm,
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            color: theme.colors.textSecondary,
          }}
        >
          {title}
        </span>
        <span css={{ color: theme.colors.textSecondary, fontSize: theme.typography.fontSizeSm }}>({count})</span>
      </div>
      <div
        css={{
          display: 'grid',
          gridTemplateColumns: `repeat(${CARDS_PER_ROW}, 1fr)`,
          gap: theme.spacing.md,
        }}
      >
        {visibleChildren}
      </div>
      {hasMore && (
        <Button
          componentId={`${COMPONENT_ID_PREFIX}.unified.show-all`}
          type="link"
          size="small"
          onClick={onToggleExpand}
          css={{ alignSelf: 'flex-start' }}
        >
          {showAll ? (
            <FormattedMessage defaultMessage="Show less" description="Button to show fewer judges in a category" />
          ) : (
            <FormattedMessage
              defaultMessage="Show all ({count}) >"
              description="Button to show all judges in a category"
              values={{ count }}
            />
          )}
        </Button>
      )}
    </div>
  );
};

// --- RegisteredJudgeCard ---

const RegisteredJudgeCard: React.FC<{
  row: RegisteredJudgeRow;
  isSelected: boolean;
  onToggleSelection: () => void;
  onClick: () => void;
  onToggleActive: (active: boolean) => void;
}> = ({ row, isSelected, onToggleSelection, onClick, onToggleActive }) => {
  const { theme } = useDesignSystemTheme();
  const intl = useIntl();
  const { scorer, status } = row;
  const isActive = status === 'active';
  const provider: CatalogProvider = 'custom';

  const tooltipTitle = isActive
    ? intl.formatMessage({
        defaultMessage: 'Automatic evaluation: ON — This judge automatically scores new traces.',
        description: 'Tooltip for active auto-evaluation toggle on registered judge card',
      })
    : intl.formatMessage({
        defaultMessage: 'Automatic evaluation: OFF — Toggle to enable automatic scoring.',
        description: 'Tooltip for inactive auto-evaluation toggle on registered judge card',
      });

  return (
    <HoverCard
      openDelay={400}
      closeDelay={100}
      trigger={
        <div
          css={{
            border: `1px solid ${isSelected ? theme.colors.actionPrimaryBackgroundDefault : theme.colors.borderDecorative}`,
            borderRadius: theme.borders.borderRadiusMd,
            padding: theme.spacing.md,
            display: 'flex',
            alignItems: 'center',
            gap: theme.spacing.xs,
            cursor: 'pointer',
            position: 'relative',
            '&:hover': {
              borderColor: theme.colors.actionPrimaryBackgroundDefault,
            },
          }}
          onClick={onClick}
        >
          {isSelected && (
            <div onClick={(e) => e.stopPropagation()} role="presentation">
              <Checkbox
                componentId={`${COMPONENT_ID_PREFIX}.unified.card-checkbox`}
                isChecked={isSelected}
                onChange={() => onToggleSelection()}
              />
            </div>
          )}
          <div css={{ flex: 1, minWidth: 0 }}>
            <div css={{ display: 'flex', alignItems: 'baseline', gap: theme.spacing.xs }}>
              <span
                css={{
                  fontWeight: theme.typography.typographyBoldFontWeight,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {scorer.name}
              </span>
              {!isNil(scorer.version) && (
                <span
                  css={{
                    color: theme.colors.textSecondary,
                    fontSize: theme.typography.fontSizeSm,
                    flexShrink: 0,
                  }}
                >
                  (v{scorer.version})
                </span>
              )}
            </div>
            <div
              css={{
                display: 'flex',
                alignItems: 'center',
                gap: theme.spacing.xs,
                color: theme.colors.textSecondary,
                fontSize: theme.typography.fontSizeSm,
              }}
            >
              <ProviderLogo provider={provider} size={12} />
              <span css={{ color: theme.colors.textPlaceholder }}>{getProviderDisplayName(provider)}</span>
            </div>
          </div>
          <Tooltip componentId={`${COMPONENT_ID_PREFIX}.unified.card-switch-tooltip`} content={tooltipTitle}>
            <div onClick={(e) => e.stopPropagation()} role="presentation">
              <Switch
                componentId={`${COMPONENT_ID_PREFIX}.unified.card-switch`}
                checked={isActive}
                onChange={() => onToggleActive(!isActive)}
              />
            </div>
          </Tooltip>
        </div>
      }
      content={
        <div css={{ padding: theme.spacing.sm, maxWidth: 300 }}>
          <div css={{ fontWeight: theme.typography.typographyBoldFontWeight, marginBottom: theme.spacing.xs }}>
            {scorer.name}
          </div>
          <div css={{ color: theme.colors.textSecondary, fontSize: theme.typography.fontSizeSm }}>
            {getProviderDisplayName(provider)}
          </div>
        </div>
      }
      side="bottom"
      align="start"
    />
  );
};

// --- CatalogJudgeCard ---

const CatalogJudgeCard: React.FC<{
  entry: CatalogEntry;
  registeredRow?: RegisteredJudgeRow;
  isSelected: boolean;
  onToggleSelection: () => void;
  onClick: () => void;
  onToggleActive: (active: boolean) => void;
}> = ({ entry, registeredRow, isSelected, onToggleSelection, onClick, onToggleActive }) => {
  const { theme } = useDesignSystemTheme();
  const intl = useIntl();

  const isRegistered = !!registeredRow;
  const isActive = registeredRow?.status === 'active';
  const canToggle = isRegistered || entry.canAddToExperiment;

  const tooltipTitle = isActive
    ? intl.formatMessage({
        defaultMessage: 'Automatic evaluation: ON — This judge automatically scores new traces.',
        description: 'Tooltip for active auto-evaluation toggle on catalog judge card',
      })
    : canToggle
      ? intl.formatMessage({
          defaultMessage: 'Toggle to add this judge and enable automatic scoring.',
          description: 'Tooltip for auto-evaluation toggle on catalog judge card',
        })
      : intl.formatMessage({
          defaultMessage: 'This judge cannot be added to automatic evaluation.',
          description: 'Tooltip for disabled auto-evaluation toggle on catalog judge card',
        });

  return (
    <HoverCard
      openDelay={400}
      closeDelay={100}
      trigger={
        <div
          css={{
            border: `1px solid ${isSelected ? theme.colors.actionPrimaryBackgroundDefault : theme.colors.borderDecorative}`,
            borderRadius: theme.borders.borderRadiusMd,
            padding: theme.spacing.md,
            display: 'flex',
            alignItems: 'center',
            gap: theme.spacing.xs,
            cursor: 'pointer',
            position: 'relative',
            '&:hover': {
              borderColor: theme.colors.actionPrimaryBackgroundDefault,
            },
          }}
          onClick={onClick}
        >
          {isSelected && (
            <div onClick={(e) => e.stopPropagation()} role="presentation">
              <Checkbox
                componentId={`${COMPONENT_ID_PREFIX}.unified.card-checkbox`}
                isChecked={isSelected}
                onChange={() => onToggleSelection()}
              />
            </div>
          )}
          <div css={{ flex: 1, minWidth: 0 }}>
            <div
              css={{
                fontWeight: theme.typography.typographyBoldFontWeight,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {entry.name}
            </div>
            <div
              css={{
                display: 'flex',
                alignItems: 'center',
                gap: theme.spacing.xs,
                color: theme.colors.textSecondary,
                fontSize: theme.typography.fontSizeSm,
              }}
            >
              <ProviderLogo provider={entry.provider} size={12} />
              <span css={{ color: theme.colors.textPlaceholder }}>
                {getProviderDisplayName(entry.provider)}
              </span>
            </div>
          </div>
          <Tooltip componentId={`${COMPONENT_ID_PREFIX}.unified.card-switch-tooltip`} content={tooltipTitle}>
            <div onClick={(e) => e.stopPropagation()} role="presentation">
              <Switch
                componentId={`${COMPONENT_ID_PREFIX}.unified.card-switch`}
                checked={isActive}
                disabled={!canToggle}
                onChange={() => onToggleActive(!isActive)}
              />
            </div>
          </Tooltip>
        </div>
      }
      content={
        <div css={{ padding: theme.spacing.sm, maxWidth: 300 }}>
          <div css={{ fontWeight: theme.typography.typographyBoldFontWeight, marginBottom: theme.spacing.xs }}>
            {entry.name}
          </div>
          <div css={{ color: theme.colors.textSecondary, fontSize: theme.typography.fontSizeSm }}>
            {entry.description}
          </div>
        </div>
      }
      side="bottom"
      align="start"
    />
  );
};

export default UnifiedJudgesTableRenderer;
