import { ScrollablePageWrapper } from '@mlflow/mlflow/src/common/components/ScrollablePageWrapper';
import { useSkillsListQuery } from './hooks/useSkillsListQuery';
import {
  Alert,
  Button,
  Checkbox,
  ChevronDownIcon,
  ChevronRightIcon,
  CloudDownloadIcon,
  FolderIcon,
  Header,
  Input,
  LightningIcon,
  Modal,
  Spacer,
  Spinner,
  Tag,
  Typography,
  UserCircleIcon,
  useDesignSystemTheme,
} from '@databricks/design-system';
import { FormattedMessage } from 'react-intl';
import { useState, useCallback, useMemo, useRef } from 'react';
import { useRegisterSkillModal } from './hooks/useRegisterSkillModal';
import Routes from '../../routes';
import { useNavigate } from '../../../common/utils/RoutingUtils';
import { withErrorBoundary } from '../../../common/utils/withErrorBoundary';
import ErrorUtils from '../../../common/utils/ErrorUtils';
import { useDebounce } from 'use-debounce';
import { SkillUsageBreakdown } from './components/SkillUsageBreakdown';
import type { RegisteredSkill } from './types';
import { RegisteredSkillsApi } from './api';

const INTERNAL_TAG_PREFIX = 'mlflow.';

const getUserTags = (tags?: Record<string, string>): string[] => {
  if (!tags) return [];
  return Object.keys(tags).filter((key) => !key.startsWith(INTERNAL_TAG_PREFIX));
};

const formatRelativeTime = (timestamp?: number): string | null => {
  if (!timestamp) return null;
  const now = Date.now();
  const diffMs = now - timestamp;
  const seconds = Math.floor(diffMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (days > 30) {
    return new Date(timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }
  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (minutes > 0) return `${minutes}m ago`;
  return 'just now';
};

const GitHubIcon = ({ size = 14 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor">
    <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
  </svg>
);

const InstallCommandModal = ({
  skillNames,
  visible,
  onClose,
}: {
  skillNames: string[];
  visible: boolean;
  onClose: () => void;
}) => {
  const { theme } = useDesignSystemTheme();
  const command = `mlflow skills load ${skillNames.join(' ')}`;
  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(command);
  }, [command]);
  if (!visible) return null;
  const label = skillNames.length === 1 ? <strong>{skillNames[0]}</strong> : `${skillNames.length} skills`;
  return (
    <Modal
      componentId="mlflow.skills.install_modal"
      title={skillNames.length === 1 ? 'Install skill' : `Install ${skillNames.length} skills`}
      visible
      onCancel={onClose}
      onOk={onClose}
      okText="Done"
      cancelButtonProps={{ style: { display: 'none' } }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: theme.spacing.md }}>
        <Typography.Text>Run this command in your terminal to install {label} for Claude Code:</Typography.Text>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: theme.spacing.sm,
            backgroundColor: theme.colors.backgroundSecondary,
            borderRadius: theme.borders.borderRadiusSm,
            padding: theme.spacing.sm,
            fontFamily: 'monospace',
            fontSize: theme.typography.fontSizeSm,
          }}
        >
          <code style={{ flex: 1, wordBreak: 'break-all' }}>{command}</code>
          <Button componentId="mlflow.skills.install_modal.copy" type="tertiary" onClick={handleCopy}>
            Copy
          </Button>
        </div>
        <Typography.Text style={{ color: theme.colors.textSecondary, fontSize: theme.typography.fontSizeSm }}>
          Use <code>--scope project</code> to install into the current project instead of globally.
        </Typography.Text>
      </div>
    </Modal>
  );
};

const SkillCard = ({
  skill,
  selected,
  onToggleSelect,
}: {
  skill: RegisteredSkill;
  selected: boolean;
  onToggleSelect: (name: string, shiftKey: boolean) => void;
}) => {
  const { theme } = useDesignSystemTheme();
  const navigate = useNavigate();
  const userTags = getUserTags(skill.tags);
  const [installModalVisible, setInstallModalVisible] = useState(false);
  const [isHovered, setIsHovered] = useState(false);

  const handleCardClick = useCallback(() => {
    navigate(Routes.getSkillDetailsPageRoute(skill.name));
  }, [navigate, skill.name]);

  const handleCheckbox = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onToggleSelect(skill.name, e.shiftKey);
    },
    [skill.name, onToggleSelect],
  );

  const handleInstall = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setInstallModalVisible(true);
  }, []);

  const sourceLabel = useMemo(() => {
    if (!skill.source) return null;
    return skill.source.replace(/^https?:\/\/(www\.)?github\.com\//, '');
  }, [skill.source]);

  const isGitHub = skill.source?.includes('github.com');

  return (
    <>
      <div
        onClick={handleCardClick}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        css={{
          position: 'relative',
          border: `1px solid ${selected ? theme.colors.actionPrimaryBackgroundDefault : theme.colors.borderDecorative}`,
          borderRadius: theme.borders.borderRadiusMd,
          padding: theme.spacing.md,
          cursor: 'pointer',
          display: 'flex',
          flexDirection: 'column',
          gap: theme.spacing.sm,
          transition: 'box-shadow 0.15s ease-in-out, border-color 0.15s ease-in-out',
          backgroundColor: theme.colors.backgroundPrimary,
          '&:hover': {
            borderColor: theme.colors.actionPrimaryBackgroundDefault,
            boxShadow: `0 2px 8px ${theme.colors.borderDecorative}`,
          },
        }}
      >
        {/* Top-right overlay: only mounted on hover or when selected — zero DOM presence otherwise */}
        {(isHovered || selected) && (
          <div
            css={{
              position: 'absolute',
              top: theme.spacing.md,
              right: theme.spacing.md,
              display: 'flex',
              alignItems: 'center',
              gap: theme.spacing.xs,
            }}
          >
            <button
              type="button"
              onClick={handleInstall}
              css={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                padding: 2,
                color: theme.colors.textSecondary,
                display: 'flex',
                '&:hover': { color: theme.colors.textPrimary },
              }}
            >
              <CloudDownloadIcon />
            </button>
            <div onClick={handleCheckbox}>
              <Checkbox componentId="mlflow.skills.card.checkbox" isChecked={selected} onChange={() => {}} />
            </div>
          </div>
        )}

        {/* Top row: name + version */}
        <div css={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
          <span
            css={{
              fontWeight: 600,
              fontSize: theme.typography.fontSizeMd,
              color: theme.colors.textPrimary,
              wordBreak: 'break-word',
            }}
          >
            {skill.name}
          </span>
          {skill.latest_version != null && (
            <span
              css={{
                backgroundColor: theme.colors.actionPrimaryBackgroundDefault,
                color: theme.colors.actionPrimaryTextDefault,
                borderRadius: theme.borders.borderRadiusSm,
                padding: `0 ${theme.spacing.xs}px`,
                fontSize: 11,
                fontWeight: 600,
                lineHeight: '18px',
              }}
            >
              v{skill.latest_version}
            </span>
          )}
        </div>

        {/* Description */}
        <div
          css={{
            color: theme.colors.textSecondary,
            fontSize: theme.typography.fontSizeSm,
            lineHeight: 1.4,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {skill.description || 'No description'}
        </div>

        {/* Meta row: author, source + updated date */}
        <div
          css={{
            display: 'flex',
            alignItems: 'center',
            gap: theme.spacing.sm,
            fontSize: theme.typography.fontSizeSm,
            color: theme.colors.textSecondary,
            flexWrap: 'wrap',
          }}
        >
          {skill.created_by && (
            <span css={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              <UserCircleIcon css={{ width: 14, height: 14 }} />
              {skill.created_by}
            </span>
          )}
          {sourceLabel && (
            <span css={{ display: 'inline-flex', alignItems: 'center', gap: 5, lineHeight: 1 }}>
              {isGitHub && <GitHubIcon />}
              <span
                css={{
                  maxWidth: 140,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  fontFamily: 'monospace',
                  fontSize: 11,
                  lineHeight: 'normal',
                }}
              >
                {sourceLabel}
              </span>
            </span>
          )}
          {skill.last_updated_timestamp && (
            <span css={{ lineHeight: 'normal' }}>Updated {formatRelativeTime(skill.last_updated_timestamp)}</span>
          )}
        </div>

        {/* Tags (user-facing only) */}
        {userTags.length > 0 && (
          <div css={{ display: 'flex', gap: theme.spacing.xs, flexWrap: 'wrap' }}>
            {userTags.slice(0, 5).map((tag) => (
              <Tag componentId={`mlflow.skills.card.tag.${tag}`} key={tag}>
                {tag}
              </Tag>
            ))}
            {userTags.length > 5 && (
              <span css={{ fontSize: theme.typography.fontSizeSm, color: theme.colors.textSecondary }}>
                +{userTags.length - 5} more
              </span>
            )}
          </div>
        )}
      </div>
      <InstallCommandModal
        skillNames={[skill.name]}
        visible={installModalVisible}
        onClose={() => setInstallModalVisible(false)}
      />
    </>
  );
};

const getRepoKey = (source?: string): string => {
  const match = source?.match(/github\.com\/([^/]+\/[^/]+)/);
  return match ? match[1] : '';
};

const SkillsCardGrid = ({
  skills,
  isLoading,
  selectedSkills,
  onToggleSelect,
}: {
  skills: RegisteredSkill[];
  isLoading: boolean;
  selectedSkills: Set<string>;
  onToggleSelect: (name: string, shiftKey: boolean) => void;
}) => {
  const { theme } = useDesignSystemTheme();
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

  const toggleGroup = useCallback((repo: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(repo)) {
        next.delete(repo);
      } else {
        next.add(repo);
      }
      return next;
    });
  }, []);

  const groupedSkills = useMemo(() => {
    const groups = new Map<string, RegisteredSkill[]>();
    for (const skill of skills) {
      const repo = getRepoKey(skill.source);
      const list = groups.get(repo);
      if (list) {
        list.push(skill);
      } else {
        groups.set(repo, [skill]);
      }
    }
    return groups;
  }, [skills]);

  if (isLoading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: theme.spacing.lg }}>
        <Spinner label="Loading skills" />
      </div>
    );
  }

  if (!skills.length) {
    return (
      <div style={{ textAlign: 'center', padding: theme.spacing.lg, color: theme.colors.textSecondary }}>
        <FormattedMessage
          defaultMessage="No skills registered yet. Click '+ New Skill' to get started."
          description="Empty state message for skills list"
        />
      </div>
    );
  }

  return (
    <div css={{ overflow: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: theme.spacing.md }}>
      {[...groupedSkills.entries()].map(([repo, groupSkills]) => {
        const collapsed = !expandedGroups.has(repo);
        return (
          <div key={repo}>
            {/* Folder header */}
            <div
              role="button"
              onClick={() => toggleGroup(repo)}
              css={{
                display: 'flex',
                alignItems: 'center',
                gap: theme.spacing.sm,
                padding: `${theme.spacing.sm}px 0`,
                cursor: 'pointer',
                userSelect: 'none',
                borderBottom: `1px solid ${theme.colors.borderDecorative}`,
                '&:hover': { color: theme.colors.actionPrimaryBackgroundDefault },
              }}
            >
              {collapsed ? (
                <ChevronRightIcon css={{ fontSize: 14, color: theme.colors.textSecondary }} />
              ) : (
                <ChevronDownIcon css={{ fontSize: 14, color: theme.colors.textSecondary }} />
              )}
              <FolderIcon css={{ fontSize: 16, color: theme.colors.textSecondary }} />
              {repo ? (
                <>
                  <a
                    href={`https://github.com/${repo}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    css={{
                      fontFamily: 'monospace',
                      fontSize: theme.typography.fontSizeSm,
                      fontWeight: 600,
                      color: theme.colors.textPrimary,
                      textDecoration: 'none',
                      '&:hover': { textDecoration: 'underline', color: theme.colors.actionPrimaryBackgroundDefault },
                    }}
                  >
                    {repo}
                  </a>
                  <GitHubIcon size={12} />
                </>
              ) : (
                <span
                  css={{
                    fontSize: theme.typography.fontSizeSm,
                    fontWeight: 600,
                    color: theme.colors.textPrimary,
                  }}
                >
                  Other
                </span>
              )}
              <span
                css={{
                  fontSize: theme.typography.fontSizeSm,
                  color: theme.colors.textSecondary,
                  marginLeft: 'auto',
                }}
              >
                {groupSkills.length} skill{groupSkills.length !== 1 ? 's' : ''}
              </span>
            </div>
            {/* Skill cards */}
            {!collapsed && (
              <div
                css={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
                  gap: theme.spacing.md,
                  paddingTop: theme.spacing.md,
                  alignContent: 'start',
                }}
              >
                {groupSkills.map((skill) => (
                  <SkillCard
                    key={skill.name}
                    skill={skill}
                    selected={selectedSkills.has(skill.name)}
                    onToggleSelect={onToggleSelect}
                  />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

const SkillsPage = () => {
  const { theme } = useDesignSystemTheme();
  const [searchFilter, setSearchFilter] = useState('');
  const [debouncedSearchFilter] = useDebounce(searchFilter, 500);
  const [selectedSkills, setSelectedSkills] = useState<Set<string>>(new Set());
  const [bulkUseModalVisible, setBulkUseModalVisible] = useState(false);

  const { data, error, isLoading, refetch } = useSkillsListQuery({
    searchFilter: debouncedSearchFilter || undefined,
  });

  const { RegisterSkillModal, openModal } = useRegisterSkillModal({ onSuccess: refetch });

  const lastSelectedRef = useRef<string | null>(null);

  const handleToggleSelect = useCallback(
    (name: string, shiftKey: boolean) => {
      setSelectedSkills((prev) => {
        const next = new Set(prev);

        if (shiftKey && lastSelectedRef.current && lastSelectedRef.current !== name) {
          const allNames = data.map((s) => s.name);
          const lastIdx = allNames.indexOf(lastSelectedRef.current);
          const curIdx = allNames.indexOf(name);
          if (lastIdx !== -1 && curIdx !== -1) {
            const [start, end] = lastIdx < curIdx ? [lastIdx, curIdx] : [curIdx, lastIdx];
            for (let i = start; i <= end; i++) {
              next.add(allNames[i]);
            }
            lastSelectedRef.current = name;
            return next;
          }
        }

        if (next.has(name)) {
          next.delete(name);
        } else {
          next.add(name);
        }
        lastSelectedRef.current = name;
        return next;
      });
    },
    [data],
  );

  const handleBulkDelete = useCallback(async () => {
    if (!selectedSkills.size) return;
    const names = Array.from(selectedSkills);
    if (!window.confirm(`Delete ${names.length} selected skill(s) and all their versions?`)) return;
    await Promise.all(names.map((name) => RegisteredSkillsApi.deleteRegisteredSkill(name)));
    setSelectedSkills(new Set());
    refetch();
  }, [selectedSkills, refetch]);

  return (
    <ScrollablePageWrapper css={{ overflow: 'hidden', display: 'flex', flexDirection: 'column', flex: 1 }}>
      <Spacer shrinks={false} />
      <Header
        title={
          <span css={{ display: 'flex', alignItems: 'center', gap: theme.spacing.sm }}>
            <span
              css={{
                display: 'flex',
                borderRadius: theme.borders.borderRadiusSm,
                backgroundColor: theme.colors.backgroundSecondary,
                padding: theme.spacing.sm,
              }}
            >
              <LightningIcon />
            </span>
            <FormattedMessage defaultMessage="Skills" description="Header title for the skills page" />
          </span>
        }
        buttons={
          <Button
            componentId="mlflow.skills.list.register"
            data-testid="register-skill-button"
            type="primary"
            onClick={openModal}
          >
            <FormattedMessage defaultMessage="+ New Skill" description="Register skill button" />
          </Button>
        }
      />
      <Spacer shrinks={false} />
      <div css={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <SkillUsageBreakdown />
        <div css={{ display: 'flex', alignItems: 'center', gap: theme.spacing.sm, marginBottom: theme.spacing.md, marginTop: theme.spacing.md }}>
          <div css={{ flex: 1 }}>
            <Input
              componentId="mlflow.skills.list.search"
              placeholder="Search skills..."
              value={searchFilter}
              onChange={(e) => setSearchFilter(e.target.value)}
              allowClear
            />
          </div>
          {selectedSkills.size > 0 && (
            <>
              <Button
                componentId="mlflow.skills.list.bulk_use"
                type="primary"
                onClick={() => setBulkUseModalVisible(true)}
              >
                <FormattedMessage
                  defaultMessage="Use ({count})"
                  description="Bulk use button"
                  values={{ count: selectedSkills.size }}
                />
              </Button>
              <Button componentId="mlflow.skills.list.bulk_delete" type="primary" onClick={handleBulkDelete} danger>
                <FormattedMessage
                  defaultMessage="Delete ({count})"
                  description="Bulk delete button"
                  values={{ count: selectedSkills.size }}
                />
              </Button>
            </>
          )}
        </div>
        {!isLoading && data.length > 0 && (
          <div
            css={{
              marginBottom: theme.spacing.sm,
              color: theme.colors.textSecondary,
              fontSize: theme.typography.fontSizeSm,
            }}
          >
            {data.length} skill{data.length !== 1 ? 's' : ''}
          </div>
        )}
        {error && (
          <>
            <Alert
              type="error"
              message={(error as Error).message}
              componentId="mlflow.skills.list.error"
              closable={false}
            />
            <Spacer />
          </>
        )}
        <SkillsCardGrid
          skills={data}
          isLoading={isLoading}
          selectedSkills={selectedSkills}
          onToggleSelect={handleToggleSelect}
        />
      </div>
      {RegisterSkillModal}
      <InstallCommandModal
        skillNames={Array.from(selectedSkills)}
        visible={bulkUseModalVisible}
        onClose={() => setBulkUseModalVisible(false)}
      />
    </ScrollablePageWrapper>
  );
};

export default withErrorBoundary(ErrorUtils.mlflowServices.EXPERIMENTS, SkillsPage);
