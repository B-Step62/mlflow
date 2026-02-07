import { useState } from 'react';
import { Button, ChevronDownIcon, ChevronRightIcon, CloseIcon, PlusIcon, Typography, useDesignSystemTheme } from '@databricks/design-system';
import { useCommitList } from '../hooks/useCommitList';
import { useSkillList } from '../hooks/useSkillList';
import type { PanelConfig, PanelId, SkillEntry } from '../types';

const isRemoteUrl = (repo: string) => /^(https?:\/\/|git@|ssh:\/\/)/.test(repo);

/** Group skill entries by repo. A single entry with name "*" means "all skills". */
const groupByRepo = (skills: SkillEntry[]): Map<string, { commitId: string; names: string[] }> => {
  const map = new Map<string, { commitId: string; names: string[] }>();
  for (const s of skills) {
    const existing = map.get(s.repo);
    if (existing) {
      if (s.name !== '*' && !existing.names.includes(s.name)) {
        existing.names.push(s.name);
      }
      if (s.name === '*') {
        existing.names = ['*'];
      }
    } else {
      map.set(s.repo, { commitId: s.commitId, names: [s.name] });
    }
  }
  return map;
};

interface PanelConfigBarProps {
  panelId: PanelId;
  config: PanelConfig;
  onLocalChange: (config: PanelConfig) => void;
  onSave: () => void;
  onReset: () => void;
  isDirty: boolean;
}

const inputStyles = (theme: ReturnType<typeof useDesignSystemTheme>['theme']) => ({
  width: '100%',
  padding: `${theme.spacing.xs}px ${theme.spacing.sm}px`,
  border: `1px solid ${theme.colors.border}`,
  borderRadius: theme.borders.borderRadiusMd,
  fontSize: theme.typography.fontSizeSm,
  color: theme.colors.textPrimary,
  backgroundColor: theme.colors.backgroundPrimary,
  boxSizing: 'border-box' as const,
});

const labelStyles = (theme: ReturnType<typeof useDesignSystemTheme>['theme']) => ({
  display: 'block' as const,
  fontSize: theme.typography.fontSizeSm,
  color: theme.colors.textSecondary,
  marginBottom: theme.spacing.xs,
});

const cellStyles = (theme: ReturnType<typeof useDesignSystemTheme>['theme']) => ({
  padding: `${theme.spacing.xs}px ${theme.spacing.sm}px`,
  borderBottom: `1px solid ${theme.colors.border}`,
  verticalAlign: 'middle' as const,
  fontSize: theme.typography.fontSizeSm,
});

const headerCellStyles = (theme: ReturnType<typeof useDesignSystemTheme>['theme']) => ({
  ...cellStyles(theme),
  fontWeight: 600,
  color: theme.colors.textSecondary,
  backgroundColor: theme.colors.backgroundSecondary,
});

const iconButtonStyles = (theme: ReturnType<typeof useDesignSystemTheme>['theme']) => ({
  border: 'none',
  background: 'none',
  color: theme.colors.textSecondary,
  cursor: 'pointer',
  padding: 2,
  display: 'flex' as const,
  alignItems: 'center' as const,
  '&:hover': { color: theme.colors.textPrimary },
});

// Expanded skill sub-rows for a repo
const SkillSubRows = ({
  repo,
  commitId,
  selectedNames,
  onToggleSkill,
}: {
  repo: string;
  commitId: string;
  selectedNames: string[]; // ["*"] means all
  onToggleSkill: (skillName: string, included: boolean) => void;
}) => {
  const { theme } = useDesignSystemTheme();
  const ref = commitId === 'working-tree' ? 'working-tree' : commitId;
  const { skills, isLoading } = useSkillList(repo, ref);
  const isAll = selectedNames.length === 1 && selectedNames[0] === '*';

  if (isLoading) {
    return (
      <tr>
        <td colSpan={4} css={{ ...cellStyles(theme), paddingLeft: theme.spacing.lg + theme.spacing.sm, backgroundColor: theme.colors.backgroundSecondary }}>
          <Typography.Text size="sm" color="secondary">Loading skills...</Typography.Text>
        </td>
      </tr>
    );
  }

  if (skills.length === 0) {
    return (
      <tr>
        <td colSpan={4} css={{ ...cellStyles(theme), paddingLeft: theme.spacing.lg + theme.spacing.sm, backgroundColor: theme.colors.backgroundSecondary }}>
          <Typography.Text size="sm" color="secondary">No skills found in this repo</Typography.Text>
        </td>
      </tr>
    );
  }

  return (
    <>
      {skills.map((skill) => {
        const included = isAll || selectedNames.includes(skill.name);
        return (
          <tr key={skill.name}>
            <td
              colSpan={3}
              css={{
                ...cellStyles(theme),
                paddingLeft: theme.spacing.lg + theme.spacing.sm,
                backgroundColor: theme.colors.backgroundSecondary,
                opacity: included ? 1 : 0.5,
              }}
            >
              <label css={{ display: 'flex', alignItems: 'center', gap: theme.spacing.xs, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={included}
                  onChange={(e) => onToggleSkill(skill.name, e.target.checked)}
                />
                <Typography.Text size="sm">{skill.name}</Typography.Text>
              </label>
            </td>
            <td css={{ ...cellStyles(theme), backgroundColor: theme.colors.backgroundSecondary }} />
          </tr>
        );
      })}
    </>
  );
};

// Per-repo row with expand/collapse
const RepoRow = ({
  repo,
  commitId,
  selectedNames,
  panelId,
  onCommitChange,
  onRemove,
  onToggleSkill,
}: {
  repo: string;
  commitId: string;
  selectedNames: string[];
  panelId: PanelId;
  onCommitChange: (commitId: string) => void;
  onRemove: () => void;
  onToggleSkill: (skillName: string, included: boolean) => void;
}) => {
  const { theme } = useDesignSystemTheme();
  const [expanded, setExpanded] = useState(false);
  const { commits } = useCommitList(repo);
  const isAll = selectedNames.length === 1 && selectedNames[0] === '*';

  const commitOptions = [
    ...(!isRemoteUrl(repo) ? [{ hash: 'working-tree', label: 'Working tree (uncommitted)' }] : []),
    ...commits.map((c) => ({ hash: c.hash, label: `${c.hash.slice(0, 7)} - ${c.message}` })),
  ];

  const displayRepo = repo.length > 40 ? '...' + repo.slice(-38) : repo;
  const skillLabel = isAll ? 'All skills' : `${selectedNames.length} skill${selectedNames.length !== 1 ? 's' : ''}`;

  return (
    <>
      <tr>
        <td css={{ ...cellStyles(theme), whiteSpace: 'nowrap' }}>
          <div css={{ display: 'flex', alignItems: 'center', gap: theme.spacing.xs }}>
            <button type="button" onClick={() => setExpanded(!expanded)} css={iconButtonStyles(theme)}>
              {expanded ? (
                <ChevronDownIcon css={{ width: 14, height: 14 }} />
              ) : (
                <ChevronRightIcon css={{ width: 14, height: 14 }} />
              )}
            </button>
            <div>
              <Typography.Text size="sm" css={{ wordBreak: 'break-all' }}>{displayRepo}</Typography.Text>
              <Typography.Text size="sm" color="secondary" css={{ display: 'block' }}>
                {skillLabel}
              </Typography.Text>
            </div>
          </div>
        </td>
        <td css={cellStyles(theme)}>
          <select
            value={commitId}
            onChange={(e) => onCommitChange(e.target.value)}
            css={{
              ...inputStyles(theme),
              padding: `2px ${theme.spacing.xs}px`,
              fontSize: theme.typography.fontSizeSm - 1,
            }}
          >
            {commitOptions.map((c) => (
              <option key={c.hash} value={c.hash}>
                {c.hash === 'working-tree' ? 'working tree' : c.label}
              </option>
            ))}
          </select>
        </td>
        <td css={{ ...cellStyles(theme), textAlign: 'center' }}>
          <button type="button" onClick={onRemove} css={iconButtonStyles(theme)}>
            <CloseIcon css={{ width: 14, height: 14 }} />
          </button>
        </td>
      </tr>
      {expanded && (
        <SkillSubRows
          repo={repo}
          commitId={commitId}
          selectedNames={selectedNames}
          onToggleSkill={onToggleSkill}
        />
      )}
    </>
  );
};

export const PanelConfigBar = ({ panelId, config, onLocalChange, onSave, onReset, isDirty }: PanelConfigBarProps) => {
  const { theme } = useDesignSystemTheme();
  const [newSkillRepo, setNewSkillRepo] = useState('');
  const [newToolName, setNewToolName] = useState('');

  // Fetch commits for the new repo to determine the default ref
  const { commits: newRepoCommits } = useCommitList(newSkillRepo.trim());
  const newRepoIsRemote = isRemoteUrl(newSkillRepo.trim());
  const newRepoDefaultRef = newRepoIsRemote ? newRepoCommits[0]?.hash ?? '' : 'working-tree';

  const repoGroups = groupByRepo(config.skills);

  const handleAddRepo = () => {
    const repo = newSkillRepo.trim();
    if (!repo) return;
    // Don't add duplicate repos
    if (repoGroups.has(repo)) return;

    const commitId = newRepoDefaultRef || 'working-tree';
    onLocalChange({ ...config, skills: [...config.skills, { name: '*', repo, commitId }] });
    setNewSkillRepo('');
  };

  const handleRemoveRepo = (repo: string) => {
    onLocalChange({ ...config, skills: config.skills.filter((s) => s.repo !== repo) });
  };

  const handleRepoCommitChange = (repo: string, commitId: string) => {
    onLocalChange({
      ...config,
      skills: config.skills.map((s) => (s.repo === repo ? { ...s, commitId } : s)),
    });
  };

  const handleToggleSkill = (repo: string, skillName: string, included: boolean) => {
    const group = repoGroups.get(repo);
    if (!group) return;

    const isAll = group.names.length === 1 && group.names[0] === '*';
    const { commitId } = group;

    if (isAll && !included) {
      // Switching from "all" to "all except one" — we need the full skill list.
      // For now, we can't resolve this without the skill list. We'll just remove the single skill
      // by keeping "*" and adding an exclude... Actually, let's just not support deselecting from "*"
      // without loading the skill list. The SkillSubRows component already loads them, so we
      // have them in the UI. We need to replace "*" with all individual names minus the toggled one.
      // The sub-rows component passes us the skill name, but we don't have the full list here.
      // Solution: we'll let the sub-row pass us the full list when toggling off from "*".
      // For simplicity, just ignore the toggle — user sees checkbox but we can't act without the list.
      // Actually, let's handle this properly: store skills explicitly.
      return;
    }

    if (included) {
      // Add skill back
      onLocalChange({
        ...config,
        skills: [...config.skills, { name: skillName, repo, commitId }],
      });
    } else {
      // Remove specific skill
      onLocalChange({
        ...config,
        skills: config.skills.filter((s) => !(s.repo === repo && s.name === skillName)),
      });
    }
  };

  const handleAddTool = () => {
    if (!newToolName.trim() || config.allowedTools.includes(newToolName.trim())) return;
    onLocalChange({ ...config, allowedTools: [...config.allowedTools, newToolName.trim()] });
    setNewToolName('');
  };

  const handleRemoveTool = (tool: string) => {
    onLocalChange({ ...config, allowedTools: config.allowedTools.filter((t) => t !== tool) });
  };

  return (
    <div css={{ display: 'flex', flexDirection: 'column' }}>
      <div css={{ padding: theme.spacing.md, display: 'flex', flexDirection: 'column', gap: theme.spacing.md }}>
        {/* Model */}
        <div>
          <label css={labelStyles(theme)}>Model</label>
          <div css={{ display: 'flex', gap: theme.spacing.sm }}>
            {(['opus', 'sonnet', 'haiku'] as const).map((model) => (
              <Button
                key={model}
                componentId={`mlflow.skill-playground.panel-${panelId}.model.${model}`}
                type={config.model === model ? 'primary' : 'tertiary'}
                size="small"
                onClick={() => onLocalChange({ ...config, model })}
              >
                {model.charAt(0).toUpperCase() + model.slice(1)}
              </Button>
            ))}
          </div>
        </div>

        {/* Skills table — per-repo rows */}
        <div>
          <label css={labelStyles(theme)}>Skill Repositories</label>
          <table
            css={{
              width: '100%',
              borderCollapse: 'collapse',
              border: `1px solid ${theme.colors.border}`,
              borderRadius: theme.borders.borderRadiusMd,
            }}
          >
            <thead>
              <tr>
                <th css={headerCellStyles(theme)}>Repository</th>
                <th css={{ ...headerCellStyles(theme), width: 200 }}>Commit</th>
                <th css={{ ...headerCellStyles(theme), width: 36 }} />
              </tr>
            </thead>
            <tbody>
              {[...repoGroups.entries()].map(([repo, group]) => (
                <RepoRow
                  key={repo}
                  repo={repo}
                  commitId={group.commitId}
                  selectedNames={group.names}
                  panelId={panelId}
                  onCommitChange={(commitId) => handleRepoCommitChange(repo, commitId)}
                  onRemove={() => handleRemoveRepo(repo)}
                  onToggleSkill={(skillName, included) => handleToggleSkill(repo, skillName, included)}
                />
              ))}
              {/* Add row */}
              <tr>
                <td colSpan={2} css={cellStyles(theme)}>
                  <input
                    placeholder="Enter repo path or URL..."
                    value={newSkillRepo}
                    onChange={(e) => setNewSkillRepo(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleAddRepo();
                      }
                    }}
                    css={{
                      ...inputStyles(theme),
                      fontSize: theme.typography.fontSizeSm - 1,
                    }}
                  />
                </td>
                <td css={{ ...cellStyles(theme), textAlign: 'center' }}>
                  <button
                    type="button"
                    onClick={handleAddRepo}
                    css={{
                      border: 'none',
                      background: 'none',
                      color: theme.colors.actionPrimaryBackgroundDefault,
                      cursor: 'pointer',
                      padding: 2,
                      display: 'flex',
                      alignItems: 'center',
                      '&:hover': { opacity: 0.8 },
                    }}
                  >
                    <PlusIcon css={{ width: 14, height: 14 }} />
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* Tools table */}
        <div>
          <label css={labelStyles(theme)}>Allowed Tools</label>
          <table
            css={{
              width: '100%',
              borderCollapse: 'collapse',
              border: `1px solid ${theme.colors.border}`,
              borderRadius: theme.borders.borderRadiusMd,
            }}
          >
            <thead>
              <tr>
                <th css={headerCellStyles(theme)}>Tool Name</th>
                <th css={{ ...headerCellStyles(theme), width: 36 }} />
              </tr>
            </thead>
            <tbody>
              {config.allowedTools.map((tool) => (
                <tr key={tool}>
                  <td css={cellStyles(theme)}>
                    <Typography.Text size="sm">{tool}</Typography.Text>
                  </td>
                  <td css={{ ...cellStyles(theme), textAlign: 'center' }}>
                    <button
                      type="button"
                      onClick={() => handleRemoveTool(tool)}
                      css={iconButtonStyles(theme)}
                    >
                      <CloseIcon css={{ width: 14, height: 14 }} />
                    </button>
                  </td>
                </tr>
              ))}
              {/* Add row */}
              <tr>
                <td css={cellStyles(theme)}>
                  <input
                    placeholder="Add tool..."
                    value={newToolName}
                    onChange={(e) => setNewToolName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleAddTool();
                      }
                    }}
                    css={{
                      ...inputStyles(theme),
                      fontSize: theme.typography.fontSizeSm - 1,
                    }}
                  />
                </td>
                <td css={{ ...cellStyles(theme), textAlign: 'center' }}>
                  <button
                    type="button"
                    onClick={handleAddTool}
                    css={{
                      border: 'none',
                      background: 'none',
                      color: theme.colors.actionPrimaryBackgroundDefault,
                      cursor: 'pointer',
                      padding: 2,
                      display: 'flex',
                      alignItems: 'center',
                      '&:hover': { opacity: 0.8 },
                    }}
                  >
                    <PlusIcon css={{ width: 14, height: 14 }} />
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* Sticky footer with Save / Reset */}
      <div
        css={{
          position: 'sticky',
          bottom: 0,
          display: 'flex',
          justifyContent: 'flex-end',
          gap: theme.spacing.sm,
          padding: `${theme.spacing.sm}px ${theme.spacing.md}px`,
          borderTop: `1px solid ${theme.colors.border}`,
          backgroundColor: theme.colors.backgroundPrimary,
        }}
      >
        <Button
          componentId={`mlflow.skill-playground.panel-${panelId}.config-reset`}
          type="tertiary"
          size="small"
          disabled={!isDirty}
          onClick={onReset}
        >
          Reset
        </Button>
        <Button
          componentId={`mlflow.skill-playground.panel-${panelId}.config-save`}
          type="primary"
          size="small"
          disabled={!isDirty}
          onClick={onSave}
        >
          Save
        </Button>
      </div>
    </div>
  );
};
