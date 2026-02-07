import { useState } from 'react';
import { Button, CloseIcon, PlusIcon, Typography, useDesignSystemTheme } from '@databricks/design-system';
import { useCommitList } from '../hooks/useCommitList';
import { useSkillList } from '../hooks/useSkillList';
import type { PanelConfig, PanelId, SkillEntry } from '../types';

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

// Per-row component so each skill fetches commits from its own repo
const SkillRow = ({
  skill,
  index,
  onCommitChange,
  onRemove,
}: {
  skill: SkillEntry;
  index: number;
  onCommitChange: (index: number, commitId: string) => void;
  onRemove: (index: number) => void;
}) => {
  const { theme } = useDesignSystemTheme();
  const { commits } = useCommitList(skill.repo);

  const commitOptions = [
    { hash: 'working-tree', label: 'Working tree (uncommitted)' },
    ...commits.map((c) => ({ hash: c.hash, label: `${c.hash.slice(0, 7)} - ${c.message}` })),
  ];

  return (
    <tr>
      <td css={cellStyles(theme)}>
        <Typography.Text size="sm">{skill.name}</Typography.Text>
      </td>
      <td css={cellStyles(theme)}>
        <Typography.Text size="sm" css={{ wordBreak: 'break-all' }}>
          {skill.repo.length > 30 ? '...' + skill.repo.slice(-28) : skill.repo}
        </Typography.Text>
      </td>
      <td css={cellStyles(theme)}>
        <select
          value={skill.commitId}
          onChange={(e) => onCommitChange(index, e.target.value)}
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
        <button
          type="button"
          onClick={() => onRemove(index)}
          css={{
            border: 'none',
            background: 'none',
            color: theme.colors.textSecondary,
            cursor: 'pointer',
            padding: 2,
            display: 'flex',
            alignItems: 'center',
            '&:hover': { color: theme.colors.textPrimary },
          }}
        >
          <CloseIcon css={{ width: 14, height: 14 }} />
        </button>
      </td>
    </tr>
  );
};

export const PanelConfigBar = ({ panelId, config, onLocalChange, onSave, onReset, isDirty }: PanelConfigBarProps) => {
  const { theme } = useDesignSystemTheme();
  const [newSkillRepo, setNewSkillRepo] = useState('');
  const [newToolName, setNewToolName] = useState('');

  // Fetch available skills when adding from a repo (preview what skills exist)
  const { skills: availableSkills, isLoading: skillsLoading } = useSkillList(newSkillRepo.trim(), 'working-tree');

  const handleAddSkill = (skillName?: string) => {
    const repo = newSkillRepo.trim();
    if (!repo) return;

    const name = skillName ?? (repo.includes('/') ? repo.split('/').pop() || repo : repo);
    const newEntry: SkillEntry = {
      name,
      repo,
      commitId: 'working-tree',
    };
    onLocalChange({ ...config, skills: [...config.skills, newEntry] });

    if (skillName) return; // Don't clear repo when adding from suggestion list
    setNewSkillRepo('');
  };

  const handleRemoveSkill = (index: number) => {
    onLocalChange({ ...config, skills: config.skills.filter((_, i) => i !== index) });
  };

  const handleSkillCommitChange = (index: number, commitId: string) => {
    const updated = config.skills.map((s, i) => (i === index ? { ...s, commitId } : s));
    onLocalChange({ ...config, skills: updated });
  };

  const handleAddTool = () => {
    if (!newToolName.trim() || config.allowedTools.includes(newToolName.trim())) return;
    onLocalChange({ ...config, allowedTools: [...config.allowedTools, newToolName.trim()] });
    setNewToolName('');
  };

  const handleRemoveTool = (tool: string) => {
    onLocalChange({ ...config, allowedTools: config.allowedTools.filter((t) => t !== tool) });
  };

  // Filter available skills to exclude already-added ones
  const suggestedSkills = availableSkills.filter(
    (s) => !config.skills.some((existing) => existing.name === s.name && existing.repo === newSkillRepo.trim()),
  );

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

        {/* Skills table */}
        <div>
          <label css={labelStyles(theme)}>Skills</label>
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
                <th css={headerCellStyles(theme)}>Name</th>
                <th css={headerCellStyles(theme)}>Repo</th>
                <th css={headerCellStyles(theme)}>Commit</th>
                <th css={{ ...headerCellStyles(theme), width: 36 }} />
              </tr>
            </thead>
            <tbody>
              {config.skills.map((skill, index) => (
                <SkillRow
                  key={index}
                  skill={skill}
                  index={index}
                  onCommitChange={handleSkillCommitChange}
                  onRemove={handleRemoveSkill}
                />
              ))}
              {/* Add row */}
              <tr>
                <td colSpan={3} css={cellStyles(theme)}>
                  <input
                    placeholder="Enter repo path or URL..."
                    value={newSkillRepo}
                    onChange={(e) => setNewSkillRepo(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleAddSkill();
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
                    onClick={() => handleAddSkill()}
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

          {/* Skill suggestions from the entered repo */}
          {newSkillRepo.trim() && suggestedSkills.length > 0 && (
            <div
              css={{
                marginTop: theme.spacing.xs,
                padding: theme.spacing.sm,
                border: `1px solid ${theme.colors.border}`,
                borderRadius: theme.borders.borderRadiusMd,
                backgroundColor: theme.colors.backgroundSecondary,
              }}
            >
              <Typography.Text size="sm" color="secondary" css={{ display: 'block', marginBottom: theme.spacing.xs }}>
                Available skills in this repo:
              </Typography.Text>
              <div css={{ display: 'flex', flexWrap: 'wrap', gap: theme.spacing.xs }}>
                {suggestedSkills.map((skill) => (
                  <Button
                    key={skill.name}
                    componentId={`mlflow.skill-playground.panel-${panelId}.add-skill.${skill.name}`}
                    type="tertiary"
                    size="small"
                    onClick={() => handleAddSkill(skill.name)}
                  >
                    + {skill.name}
                  </Button>
                ))}
              </div>
            </div>
          )}
          {newSkillRepo.trim() && skillsLoading && (
            <Typography.Text size="sm" color="secondary" css={{ display: 'block', marginTop: theme.spacing.xs }}>
              Loading skills...
            </Typography.Text>
          )}
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
                      css={{
                        border: 'none',
                        background: 'none',
                        color: theme.colors.textSecondary,
                        cursor: 'pointer',
                        padding: 2,
                        display: 'flex',
                        alignItems: 'center',
                        '&:hover': { color: theme.colors.textPrimary },
                      }}
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
