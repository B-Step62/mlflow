import { useState, useCallback, useMemo } from 'react';
import { Button, Checkbox, Input, Modal, Spinner, Typography, useDesignSystemTheme } from '@databricks/design-system';
import { FormattedMessage } from 'react-intl';
import { RegisteredSkillsApi } from '../api';

interface SkillPreview {
  name: string;
  description: string | null;
}

type ModalStep = 'input' | 'select';

export const useRegisterSkillModal = ({ onSuccess }: { onSuccess: () => void }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [source, setSource] = useState('');
  const [step, setStep] = useState<ModalStep>('input');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [skillPreviews, setSkillPreviews] = useState<SkillPreview[]>([]);
  const [selectedSkills, setSelectedSkills] = useState<Set<string>>(new Set());
  const { theme } = useDesignSystemTheme();

  const resetState = useCallback(() => {
    setSource('');
    setStep('input');
    setIsLoading(false);
    setError(null);
    setSkillPreviews([]);
    setSelectedSkills(new Set());
  }, []);

  const handleClose = useCallback(() => {
    setIsOpen(false);
    resetState();
  }, [resetState]);

  const handlePreview = useCallback(async () => {
    if (!source.trim()) return;
    setIsLoading(true);
    setError(null);
    try {
      const previews = await RegisteredSkillsApi.previewSource(source.trim());
      setSkillPreviews(previews);
      setSelectedSkills(new Set(previews.map((p) => p.name)));
      setStep('select');
    } catch (e: any) {
      setError(e?.message || 'Failed to fetch skills from source');
    } finally {
      setIsLoading(false);
    }
  }, [source]);

  const handleRegister = useCallback(async () => {
    if (!selectedSkills.size) return;
    setIsLoading(true);
    setError(null);
    try {
      await RegisteredSkillsApi.registerFromSource(source.trim(), undefined, Array.from(selectedSkills));
      handleClose();
      onSuccess();
    } catch (e: any) {
      setError(e?.message || 'Failed to register skills');
    } finally {
      setIsLoading(false);
    }
  }, [source, selectedSkills, handleClose, onSuccess]);

  const allSelected = useMemo(
    () => skillPreviews.length > 0 && selectedSkills.size === skillPreviews.length,
    [skillPreviews, selectedSkills],
  );

  const handleToggleAll = useCallback(() => {
    if (allSelected) {
      setSelectedSkills(new Set());
    } else {
      setSelectedSkills(new Set(skillPreviews.map((p) => p.name)));
    }
  }, [allSelected, skillPreviews]);

  const handleToggleSkill = useCallback((name: string) => {
    setSelectedSkills((prev) => {
      const next = new Set(prev);
      if (next.has(name)) {
        next.delete(name);
      } else {
        next.add(name);
      }
      return next;
    });
  }, []);

  const RegisterSkillModal = isOpen ? (
    <Modal
      componentId="mlflow.skills.register_modal"
      title={
        <FormattedMessage defaultMessage="Register skill" description="Title for register skill modal" />
      }
      visible
      onCancel={handleClose}
      onOk={step === 'input' ? handlePreview : handleRegister}
      okButtonProps={{
        disabled: step === 'input' ? !source.trim() || isLoading : selectedSkills.size === 0 || isLoading,
        loading: isLoading,
      }}
      okText={
        step === 'input' ? (
          <FormattedMessage defaultMessage="Next" description="Next button in skill modal" />
        ) : (
          <FormattedMessage
            defaultMessage="Register {count} {count, plural, one {skill} other {skills}}"
            description="Register selected skills button"
            values={{ count: selectedSkills.size }}
          />
        )
      }
    >
      {step === 'input' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: theme.spacing.md }}>
          <div>
            <FormattedMessage
              defaultMessage="Enter a GitHub repository URL or local directory path containing SKILL.md files."
              description="Instructions for register skill modal"
            />
          </div>
          <Input
            componentId="mlflow.skills.register_modal.source_input"
            placeholder="https://github.com/org/skills-repo"
            value={source}
            onChange={(e) => setSource(e.target.value)}
            onPressEnter={handlePreview}
            autoFocus
          />
          {error && <div style={{ color: theme.colors.textValidationDanger }}>{error}</div>}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: theme.spacing.md }}>
          <Typography.Text color="secondary">
            <FormattedMessage
              defaultMessage="Found {count} {count, plural, one {skill} other {skills}} in the source. Select which to register:"
              description="Skill selection instructions"
              values={{ count: skillPreviews.length }}
            />
          </Typography.Text>
          <div
            style={{
              borderBottom: `1px solid ${theme.colors.borderDecorative}`,
              paddingBottom: theme.spacing.sm,
            }}
          >
            <Checkbox
              componentId="mlflow.skills.register_modal.select_all"
              isChecked={allSelected}
              onChange={handleToggleAll}
            >
              <Typography.Text bold>
                <FormattedMessage defaultMessage="Select all" description="Select all checkbox label" />
              </Typography.Text>
            </Checkbox>
          </div>
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: theme.spacing.xs,
              maxHeight: 300,
              overflowY: 'auto',
            }}
          >
            {skillPreviews.map((skill) => (
              <div
                key={skill.name}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: theme.spacing.sm,
                  padding: theme.spacing.sm,
                  borderRadius: theme.borders.borderRadiusSm,
                  backgroundColor: selectedSkills.has(skill.name)
                    ? theme.colors.actionTertiaryBackgroundHover
                    : 'transparent',
                  cursor: 'pointer',
                }}
                onClick={() => handleToggleSkill(skill.name)}
              >
                <Checkbox
                  componentId={`mlflow.skills.register_modal.skill.${skill.name}`}
                  isChecked={selectedSkills.has(skill.name)}
                  onChange={() => {}}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <Typography.Text bold>{skill.name}</Typography.Text>
                  {skill.description && (
                    <Typography.Text
                      color="secondary"
                      style={{
                        display: 'block',
                        fontSize: theme.typography.fontSizeSm,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {skill.description}
                    </Typography.Text>
                  )}
                </div>
              </div>
            ))}
          </div>
          {error && <div style={{ color: theme.colors.textValidationDanger }}>{error}</div>}
        </div>
      )}
    </Modal>
  ) : null;

  return {
    RegisterSkillModal,
    openModal: () => setIsOpen(true),
  };
};
