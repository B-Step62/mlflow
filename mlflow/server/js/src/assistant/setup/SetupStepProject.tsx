/**
 * Final step: Project configuration for MLflow Assistant setup.
 */

import { useState, useCallback, useEffect } from 'react';
import { Typography, useDesignSystemTheme, Input, Checkbox, Spinner } from '@databricks/design-system';

import { getConfig, updateConfig } from '../AssistantService';
import { WizardFooter } from './WizardFooter';

const COMPONENT_ID = 'mlflow.assistant.setup.project';

interface SetupStepProjectProps {
  experimentId?: string;
  onBack: () => void;
  onComplete: () => void;
}

export const SetupStepProject = ({ experimentId, onBack, onComplete }: SetupStepProjectProps) => {
  const { theme } = useDesignSystemTheme();

  const [isLoading, setIsLoading] = useState(true);
  const [projectPath, setProjectPath] = useState<string>('');
  // Permission settings
  const [editFiles, setEditFiles] = useState(true);
  const [readDocs, setReadDocs] = useState(true);
  const [fullPermission, setFullPermission] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load existing config on mount
  useEffect(() => {
    const loadConfig = async () => {
      try {
        const config = await getConfig();

        // Load permissions from claude_code provider if it exists
        const claudeCodeProvider = config.providers?.['claude_code'];
        if (claudeCodeProvider?.permissions) {
          setEditFiles(claudeCodeProvider.permissions.allow_edit_files ?? true);
          setReadDocs(claudeCodeProvider.permissions.allow_read_docs ?? true);
          setFullPermission(claudeCodeProvider.permissions.full_access ?? false);
        }

        // Load project path for current experiment if it exists
        if (experimentId && config.projects?.[experimentId]) {
          setProjectPath(config.projects[experimentId].location ?? '');
        }
      } catch (err) {
        // If config fails to load, use defaults (already set as initial state)
        console.error('Failed to load config:', err);
      } finally {
        setIsLoading(false);
      }
    };

    loadConfig();
  }, [experimentId]);

  const handleSave = useCallback(async () => {
    setIsSaving(true);
    setError(null);

    try {
      // Build config update with provider and nested permissions
      const configUpdate: Parameters<typeof updateConfig>[0] = {
        providers: {
          claude_code: {
            model: 'default',
            selected: true,
            permissions: {
              allow_edit_files: editFiles,
              allow_read_docs: readDocs,
              full_access: fullPermission,
            },
          },
        },
      };

      // Update project mapping if experiment is provided
      if (experimentId) {
        if (projectPath.trim()) {
          // Set project path
          configUpdate.projects = {
            [experimentId]: { type: 'local' as const, location: projectPath.trim() },
          };
        } else {
          // Remove project mapping when path is cleared
          configUpdate.projects = {
            [experimentId]: null,
          };
        }
      }

      await updateConfig(configUpdate);
      onComplete();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save configuration');
      setIsSaving(false);
    }
  }, [experimentId, projectPath, editFiles, readDocs, fullPermission, onComplete]);

  if (isLoading) {
    return (
      <div css={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
        <Spinner label="Loading configuration..." />
      </div>
    );
  }

  return (
    <div css={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div css={{ flex: 1 }}>
        <div css={{ display: 'flex', flexDirection: 'column', gap: theme.spacing.lg }}>
          {/* Permissions Section */}
          <div>
            <Typography.Text bold css={{ fontSize: 18, marginBottom: theme.spacing.sm, display: 'block' }}>
              Permissions
            </Typography.Text>
            <Typography.Text color="secondary" css={{ display: 'block', marginBottom: theme.spacing.md }}>
              Configure what actions the assistant can perform on your behalf.
            </Typography.Text>

            <div css={{ display: 'flex', flexDirection: 'column', gap: theme.spacing.md }}>
              <div>
                <Checkbox componentId={`${COMPONENT_ID}.perm_mlflow_cli`} isChecked disabled onChange={() => {}}>
                  <Typography.Text>Execute MLflow CLI (required)</Typography.Text>
                </Checkbox>
                <Typography.Text
                  color="secondary"
                  css={{ fontSize: theme.typography.fontSizeSm, marginLeft: 24, display: 'block' }}
                >
                  Allow running MLflow commands to fetch traces, runs, and experiment data.
                </Typography.Text>
              </div>

              <div>
                <Checkbox
                  componentId={`${COMPONENT_ID}.perm_read_docs`}
                  isChecked={readDocs}
                  onChange={(checked) => setReadDocs(checked)}
                >
                  <Typography.Text>Read MLflow documentation</Typography.Text>
                </Checkbox>
                <Typography.Text
                  color="secondary"
                  css={{ fontSize: theme.typography.fontSizeSm, marginLeft: 24, display: 'block' }}
                >
                  Allow fetching pages from MLflow documentation for providing accurate information.
                </Typography.Text>
              </div>

              <div>
                <Checkbox
                  componentId={`${COMPONENT_ID}.perm_edit_files`}
                  isChecked={editFiles}
                  onChange={(checked) => setEditFiles(checked)}
                >
                  <Typography.Text>Edit project code</Typography.Text>
                </Checkbox>
                <Typography.Text
                  color="secondary"
                  css={{ fontSize: theme.typography.fontSizeSm, marginLeft: 24, display: 'block' }}
                >
                  Allow modifying files in your project directory.
                </Typography.Text>
              </div>

              <div>
                <Checkbox
                  componentId={`${COMPONENT_ID}.perm_full`}
                  isChecked={fullPermission}
                  onChange={(checked) => setFullPermission(checked)}
                >
                  <Typography.Text>Full access</Typography.Text>
                </Checkbox>
                <Typography.Text
                  color="secondary"
                  css={{ fontSize: theme.typography.fontSizeSm, marginLeft: 24, display: 'block' }}
                >
                  Bypass all permission checks. Use with caution.
                </Typography.Text>
              </div>
            </div>
          </div>

          {/* Project Configuration Section */}
          <div>
            <Typography.Text bold css={{ fontSize: 18, marginBottom: theme.spacing.sm, display: 'block' }}>
              Project Path (Optional)
            </Typography.Text>
            <Typography.Text color="secondary" css={{ display: 'block', marginBottom: theme.spacing.md }}>
              Link this experiment to your local codebase. This enables the assistant to understand your project context
              and provide more accurate suggestions and fixes.
            </Typography.Text>

            {experimentId ? (
              <Input
                componentId={`${COMPONENT_ID}.path_input`}
                value={projectPath}
                onChange={(e) => setProjectPath(e.target.value)}
                placeholder="/Users/me/projects/my-llm-project"
                css={{ width: '100%' }}
              />
            ) : (
              <div
                css={{
                  backgroundColor: theme.colors.backgroundSecondary,
                  borderRadius: theme.borders.borderRadiusMd,
                  padding: theme.spacing.md,
                }}
              >
                <Typography.Text color="secondary">
                  No experiment selected. You can configure project mappings later in Settings.
                </Typography.Text>
              </div>
            )}
          </div>

          {error && <Typography.Text css={{ color: theme.colors.textValidationDanger }}>{error}</Typography.Text>}
        </div>
      </div>

      <WizardFooter onBack={onBack} onNext={handleSave} nextLabel="Finish" isLoading={isSaving} />
    </div>
  );
};
