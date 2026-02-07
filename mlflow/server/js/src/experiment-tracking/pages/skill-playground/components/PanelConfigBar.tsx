import { useState } from 'react';
import { Button, CloseIcon, PlusIcon, Typography, useDesignSystemTheme } from '@databricks/design-system';
import { DUMMY_COMMITS } from '../dummy-data';
import type { PanelConfig, PanelId, SkillEntry } from '../types';

interface PanelConfigBarProps {
  panelId: PanelId;
  config: PanelConfig;
  onConfigChange: (config: PanelConfig) => void;
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

export const PanelConfigBar = ({ panelId, config, onConfigChange }: PanelConfigBarProps) => {
  const { theme } = useDesignSystemTheme();
  const [newSkillRepo, setNewSkillRepo] = useState('');
  const [newToolName, setNewToolName] = useState('');

  const handleAddSkill = () => {
    if (!newSkillRepo.trim()) return;
    const name = newSkillRepo.includes('/')
      ? newSkillRepo.split('/').pop() || newSkillRepo
      : newSkillRepo;
    const newEntry: SkillEntry = {
      name,
      repo: newSkillRepo.trim(),
      commitId: DUMMY_COMMITS[0].hash,
    };
    onConfigChange({ ...config, skills: [...config.skills, newEntry] });
    setNewSkillRepo('');
  };

  const handleRemoveSkill = (index: number) => {
    onConfigChange({ ...config, skills: config.skills.filter((_, i) => i !== index) });
  };

  const handleSkillCommitChange = (index: number, commitId: string) => {
    const updated = config.skills.map((s, i) => (i === index ? { ...s, commitId } : s));
    onConfigChange({ ...config, skills: updated });
  };

  const handleAddTool = () => {
    if (!newToolName.trim() || config.allowedTools.includes(newToolName.trim())) return;
    onConfigChange({ ...config, allowedTools: [...config.allowedTools, newToolName.trim()] });
    setNewToolName('');
  };

  const handleRemoveTool = (tool: string) => {
    onConfigChange({ ...config, allowedTools: config.allowedTools.filter((t) => t !== tool) });
  };

  return (
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
              onClick={() => onConfigChange({ ...config, model })}
            >
              {model.charAt(0).toUpperCase() + model.slice(1)}
            </Button>
          ))}
        </div>
      </div>

      {/* Skills table */}
      <div>
        <label css={labelStyles(theme)}>Skills</label>
        <table css={{ width: '100%', borderCollapse: 'collapse', border: `1px solid ${theme.colors.border}`, borderRadius: theme.borders.borderRadiusMd }}>
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
              <tr key={index}>
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
                    onChange={(e) => handleSkillCommitChange(index, e.target.value)}
                    css={{
                      ...inputStyles(theme),
                      padding: `2px ${theme.spacing.xs}px`,
                      fontSize: theme.typography.fontSizeSm - 1,
                    }}
                  >
                    {DUMMY_COMMITS.map((c) => (
                      <option key={c.hash} value={c.hash}>
                        {c.hash === 'working-tree' ? 'working tree' : c.hash.slice(0, 7)}
                      </option>
                    ))}
                  </select>
                </td>
                <td css={{ ...cellStyles(theme), textAlign: 'center' }}>
                  <button
                    type="button"
                    onClick={() => handleRemoveSkill(index)}
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
                  onClick={handleAddSkill}
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
        <table css={{ width: '100%', borderCollapse: 'collapse', border: `1px solid ${theme.colors.border}`, borderRadius: theme.borders.borderRadiusMd }}>
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
  );
};
