import { ScrollablePageWrapper } from '@mlflow/mlflow/src/common/components/ScrollablePageWrapper';
import { useSkillsListQuery } from './hooks/useSkillsListQuery';
import {
  Alert,
  BeakerIcon,
  Button,
  CloudDownloadIcon,
  Header,
  Input,
  Spacer,
  Spinner,
  Tag,
  Tooltip,
  TrashIcon,
  UserCircleIcon,
  useDesignSystemTheme,
} from '@databricks/design-system';
import { FormattedMessage } from 'react-intl';
import { useState, useCallback } from 'react';
import { useRegisterSkillModal } from './hooks/useRegisterSkillModal';
import Routes from '../../routes';
import { useNavigate } from '../../../common/utils/RoutingUtils';
import { withErrorBoundary } from '../../../common/utils/withErrorBoundary';
import ErrorUtils from '../../../common/utils/ErrorUtils';
import { useDebounce } from 'use-debounce';
import type { RegisteredSkill } from './types';
import { RegisteredSkillsApi } from './api';

const formatDate = (timestamp?: number) => {
  if (!timestamp) return null;
  const date = new Date(timestamp);
  return `${date.getMonth() + 1}/${date.getDate()}/${date.getFullYear()}`;
};

const SkillCard = ({
  skill,
  onDelete,
}: {
  skill: RegisteredSkill;
  onDelete: () => void;
}) => {
  const { theme } = useDesignSystemTheme();
  const navigate = useNavigate();
  const tags = skill.tags ? Object.keys(skill.tags) : [];

  const handleCardClick = useCallback(() => {
    navigate(Routes.getSkillDetailsPageRoute(skill.name));
  }, [navigate, skill.name]);

  const handleDelete = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (window.confirm(`Delete skill "${skill.name}" and all its versions?`)) {
        RegisteredSkillsApi.deleteRegisteredSkill(skill.name).then(onDelete);
      }
    },
    [skill.name, onDelete],
  );

  const handleDownload = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      // TODO: trigger install flow
    },
    [],
  );

  return (
    <div
      onClick={handleCardClick}
      css={{
        border: `1px solid ${theme.colors.borderDecorative}`,
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
      {/* Top row: name + actions */}
      <div css={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div
          css={{
            fontWeight: 600,
            fontSize: theme.typography.fontSizeMd,
            color: theme.colors.textPrimary,
            wordBreak: 'break-word',
          }}
        >
          {skill.name}
        </div>
        <div
          css={{
            display: 'flex',
            gap: theme.spacing.xs,
            flexShrink: 0,
            marginLeft: theme.spacing.sm,
          }}
        >
          <Tooltip componentId="mlflow.skills.card.download_tooltip" content="Install skill">
            <button
              type="button"
              onClick={handleDownload}
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
          </Tooltip>
          <Tooltip componentId="mlflow.skills.card.delete_tooltip" content="Delete skill">
            <button
              type="button"
              onClick={handleDelete}
              css={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                padding: 2,
                color: theme.colors.textSecondary,
                display: 'flex',
                '&:hover': { color: theme.colors.textValidationDanger },
              }}
            >
              <TrashIcon />
            </button>
          </Tooltip>
        </div>
      </div>

      {/* Description */}
      <div
        css={{
          color: theme.colors.textSecondary,
          fontSize: theme.typography.fontSizeSm,
          lineHeight: 1.4,
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
          minHeight: `calc(${theme.typography.fontSizeSm} * 1.4 * 2)`,
        }}
      >
        {skill.description || 'No description'}
      </div>

      {/* Meta row: author, date, version */}
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
        {skill.last_updated_timestamp && <span>{formatDate(skill.last_updated_timestamp)}</span>}
        {skill.latest_version != null && (
          <span
            css={{
              backgroundColor: theme.colors.actionPrimaryBackgroundDefault,
              color: theme.colors.actionPrimaryTextDefault,
              borderRadius: theme.borders.borderRadiusSm,
              padding: `0 ${theme.spacing.xs}px`,
              fontSize: theme.typography.fontSizeSm,
              fontWeight: 600,
              lineHeight: '20px',
            }}
          >
            v{skill.latest_version}
          </span>
        )}
        {skill.source && (
          <span
            css={{
              maxWidth: 120,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              color: theme.colors.actionPrimaryBackgroundDefault,
              fontFamily: 'monospace',
              fontSize: 11,
            }}
          >
            {skill.source.replace(/^https?:\/\/(www\.)?github\.com\//, '')}
          </span>
        )}
      </div>

      {/* Tags */}
      {tags.length > 0 && (
        <div css={{ display: 'flex', gap: theme.spacing.xs, flexWrap: 'wrap' }}>
          {tags.slice(0, 5).map((tag) => (
            <Tag componentId={`mlflow.skills.card.tag.${tag}`} key={tag}>
              {tag}
            </Tag>
          ))}
          {tags.length > 5 && (
            <span css={{ fontSize: theme.typography.fontSizeSm, color: theme.colors.textSecondary }}>
              +{tags.length - 5} more
            </span>
          )}
        </div>
      )}
    </div>
  );
};

const SkillsCardGrid = ({
  skills,
  isLoading,
  onRefresh,
}: {
  skills: RegisteredSkill[];
  isLoading: boolean;
  onRefresh: () => void;
}) => {
  const { theme } = useDesignSystemTheme();

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
          defaultMessage="No skills registered yet. Click 'Register skill' to get started."
          description="Empty state message for skills list"
        />
      </div>
    );
  }

  return (
    <div
      css={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
        gap: theme.spacing.md,
        overflow: 'auto',
        flex: 1,
        alignContent: 'start',
      }}
    >
      {skills.map((skill) => (
        <SkillCard key={skill.name} skill={skill} onDelete={onRefresh} />
      ))}
    </div>
  );
};

const SkillsPage = () => {
  const { theme } = useDesignSystemTheme();
  const [searchFilter, setSearchFilter] = useState('');
  const [debouncedSearchFilter] = useDebounce(searchFilter, 500);

  const { data, error, isLoading, refetch } = useSkillsListQuery({
    searchFilter: debouncedSearchFilter || undefined,
  });

  const { RegisterSkillModal, openModal } = useRegisterSkillModal({ onSuccess: refetch });

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
              <BeakerIcon />
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
        <div css={{ marginBottom: theme.spacing.md }}>
          <Input
            componentId="mlflow.skills.list.search"
            placeholder="Search skills..."
            value={searchFilter}
            onChange={(e) => setSearchFilter(e.target.value)}
            allowClear
          />
        </div>
        {!isLoading && data.length > 0 && (
          <div css={{ marginBottom: theme.spacing.sm, color: theme.colors.textSecondary, fontSize: theme.typography.fontSizeSm }}>
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
        <SkillsCardGrid skills={data} isLoading={isLoading} onRefresh={refetch} />
      </div>
      {RegisterSkillModal}
    </ScrollablePageWrapper>
  );
};

export default withErrorBoundary(ErrorUtils.mlflowServices.EXPERIMENTS, SkillsPage);
