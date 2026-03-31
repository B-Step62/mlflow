import { useState, useCallback } from 'react';
import { Button, Input, Modal, useDesignSystemTheme } from '@databricks/design-system';
import { FormattedMessage } from 'react-intl';
import { RegisteredSkillsApi } from '../api';

export const useRegisterSkillModal = ({ onSuccess }: { onSuccess: () => void }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [source, setSource] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { theme } = useDesignSystemTheme();

  const handleSubmit = useCallback(async () => {
    if (!source.trim()) return;
    setIsSubmitting(true);
    setError(null);
    try {
      await RegisteredSkillsApi.registerFromSource(source.trim());
      setIsOpen(false);
      setSource('');
      onSuccess();
    } catch (e: any) {
      setError(e?.message || 'Failed to register skill');
    } finally {
      setIsSubmitting(false);
    }
  }, [source, onSuccess]);

  const RegisterSkillModal = isOpen ? (
    <Modal
      componentId="mlflow.skills.register_modal"
      title={
        <FormattedMessage defaultMessage="Register skill" description="Title for register skill modal" />
      }
      visible
      onCancel={() => {
        setIsOpen(false);
        setSource('');
        setError(null);
      }}
      onOk={handleSubmit}
      okButtonProps={{ disabled: !source.trim() || isSubmitting, loading: isSubmitting }}
      okText={
        <FormattedMessage defaultMessage="Register" description="Register button in skill modal" />
      }
    >
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
          onPressEnter={handleSubmit}
          autoFocus
        />
        {error && <div style={{ color: theme.colors.textValidationDanger }}>{error}</div>}
      </div>
    </Modal>
  ) : null;

  return {
    RegisterSkillModal,
    openModal: () => setIsOpen(true),
  };
};
