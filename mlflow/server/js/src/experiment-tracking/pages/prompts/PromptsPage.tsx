import { ScrollablePageWrapper } from '@mlflow/mlflow/src/common/components/ScrollablePageWrapper';
import { usePromptsListQuery } from './hooks/usePromptsListQuery';
import {
  Alert,
  Button,
  Header,
  LightningIcon,
  Spacer,
  Tabs,
  TextBoxIcon,
  useDesignSystemTheme,
} from '@databricks/design-system';
import { FormattedMessage } from 'react-intl';
import { useCallback, useState } from 'react';
import { PromptsListFilters } from './components/PromptsListFilters';
import { PromptsListTable } from './components/PromptsListTable';
import { useUpdateRegisteredPromptTags } from './hooks/useUpdateRegisteredPromptTags';
import { CreatePromptModalMode, useCreatePromptModal } from './hooks/useCreatePromptModal';
import { SkillsContent } from '../skills/SkillsPage';
import Routes from '../../routes';
import { useNavigate, useSearchParams } from '../../../common/utils/RoutingUtils';
import { withErrorBoundary } from '../../../common/utils/withErrorBoundary';
import ErrorUtils from '../../../common/utils/ErrorUtils';
import { PromptPageErrorHandler } from './components/PromptPageErrorHandler';
import { useDebounce } from 'use-debounce';
import { shouldEnableWorkspaces } from '../../../common/utils/FeatureUtils';
import { extractWorkspaceFromSearchParams } from '../../../workspaces/utils/WorkspaceUtils';

export type PromptsListComponentId =
  | 'mlflow.prompts.global.list.create'
  | 'mlflow.prompts.global.list.error'
  | 'mlflow.prompts.global.list.search'
  | 'mlflow.prompts.global.list.pagination'
  | 'mlflow.prompts.global.list.table.header'
  | 'mlflow.prompts.experiment.list.create'
  | 'mlflow.prompts.experiment.list.error'
  | 'mlflow.prompts.experiment.list.search'
  | 'mlflow.prompts.experiment.list.pagination'
  | 'mlflow.prompts.experiment.list.table.header';

export interface PromptsListComponentIds {
  create: PromptsListComponentId;
  error: PromptsListComponentId;
  search: PromptsListComponentId;
  pagination: PromptsListComponentId;
  tableHeader: PromptsListComponentId;
}

const GLOBAL_COMPONENT_IDS: PromptsListComponentIds = {
  create: 'mlflow.prompts.global.list.create',
  error: 'mlflow.prompts.global.list.error',
  search: 'mlflow.prompts.global.list.search',
  pagination: 'mlflow.prompts.global.list.pagination',
  tableHeader: 'mlflow.prompts.global.list.table.header',
};

const EXPERIMENT_COMPONENT_IDS: PromptsListComponentIds = {
  create: 'mlflow.prompts.experiment.list.create',
  error: 'mlflow.prompts.experiment.list.error',
  search: 'mlflow.prompts.experiment.list.search',
  pagination: 'mlflow.prompts.experiment.list.pagination',
  tableHeader: 'mlflow.prompts.experiment.list.table.header',
};

const PromptsTabContent = ({
  experimentId,
  componentIds,
}: {
  experimentId?: string;
  componentIds: PromptsListComponentIds;
}) => {
  const { theme } = useDesignSystemTheme();
  const [searchParams] = useSearchParams();
  const workspacesEnabled = shouldEnableWorkspaces();
  const workspaceFromUrl = extractWorkspaceFromSearchParams(searchParams);

  const [searchFilter, setSearchFilter] = useState('');
  const navigate = useNavigate();

  const [debouncedSearchFilter] = useDebounce(searchFilter, 500);

  const { data, error, refetch, hasNextPage, hasPreviousPage, isLoading, onNextPage, onPreviousPage } =
    usePromptsListQuery({ experimentId, searchFilter: debouncedSearchFilter });

  const { EditTagsModal, showEditPromptTagsModal } = useUpdateRegisteredPromptTags({ onSuccess: refetch });
  const { CreatePromptModal, openModal: openCreateVersionModal } = useCreatePromptModal({
    mode: CreatePromptModalMode.CreatePrompt,
    experimentId,
    onSuccess: ({ promptName }) => navigate(Routes.getPromptDetailsPageRoute(promptName, experimentId)),
  });

  const isEmptyState = !isLoading && !error && !data?.length && !searchFilter;
  const showCreationButtons = !isEmptyState && (!workspacesEnabled || workspaceFromUrl !== null);

  const createButton = showCreationButtons && (
    <Button
      componentId={componentIds.create}
      data-testid="create-prompt-button"
      type="primary"
      onClick={openCreateVersionModal}
    >
      <FormattedMessage
        defaultMessage="Create prompt"
        description="Label for the create prompt button on the registered prompts page"
      />
    </Button>
  );

  return (
    <>
      <div css={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div css={{ display: 'flex', alignItems: 'flex-start', gap: theme.spacing.sm }}>
          <div css={{ flex: 1 }}>
            <PromptsListFilters
              searchFilter={searchFilter}
              onSearchFilterChange={setSearchFilter}
              componentId={componentIds.search}
            />
          </div>
          {createButton}
        </div>
        {error?.message && (
          <>
            <Alert type="error" message={error.message} componentId={componentIds.error} closable={false} />
            <Spacer />
          </>
        )}
        <PromptsListTable
          prompts={data}
          error={error}
          hasNextPage={hasNextPage}
          hasPreviousPage={hasPreviousPage}
          isLoading={isLoading}
          isFiltered={Boolean(searchFilter)}
          onNextPage={onNextPage}
          onPreviousPage={onPreviousPage}
          onEditTags={showEditPromptTagsModal}
          experimentId={experimentId}
          onCreatePrompt={openCreateVersionModal}
          paginationComponentId={componentIds.pagination}
          tableHeaderComponentId={componentIds.tableHeader}
        />
      </div>
      {EditTagsModal}
      {CreatePromptModal}
    </>
  );
};

const PromptsPage = ({ experimentId }: { experimentId?: string } = {}) => {
  const { theme } = useDesignSystemTheme();
  const [searchParams, setSearchParams] = useSearchParams();
  const componentIds = experimentId ? EXPERIMENT_COMPONENT_IDS : GLOBAL_COMPONENT_IDS;

  const activeTab = searchParams.get('tab') || 'prompts';
  const handleTabChange = useCallback(
    (key: string) => {
      setSearchParams(key === 'prompts' ? {} : { tab: key }, { replace: true });
    },
    [setSearchParams],
  );

  // When inside an experiment, show prompts only (no tabs)
  if (experimentId) {
    return (
      <div css={{ overflow: 'hidden', display: 'flex', flexDirection: 'column', flex: 1 }}>
        <PromptsTabContent experimentId={experimentId} componentIds={componentIds} />
      </div>
    );
  }

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
              <TextBoxIcon />
            </span>
            <FormattedMessage
              defaultMessage="Prompts & Skills"
              description="Header title for the prompts and skills page"
            />
          </span>
        }
      />
      <Spacer shrinks={false} />
      <Tabs.Root
        componentId="mlflow.prompts_and_skills.tabs"
        value={activeTab}
        onValueChange={handleTabChange}
      >
        <Tabs.List>
          <Tabs.Trigger value="prompts">
            <span css={{ display: 'flex', alignItems: 'center', gap: theme.spacing.xs }}>
              <TextBoxIcon css={{ width: 14, height: 14 }} />
              <FormattedMessage defaultMessage="Prompts" description="Tab label for prompts" />
            </span>
          </Tabs.Trigger>
          <Tabs.Trigger value="skills">
            <span css={{ display: 'flex', alignItems: 'center', gap: theme.spacing.xs }}>
              <LightningIcon css={{ width: 14, height: 14 }} />
              <FormattedMessage defaultMessage="Skills" description="Tab label for skills" />
            </span>
          </Tabs.Trigger>
        </Tabs.List>
        <Tabs.Content value="prompts">
          <div css={{ paddingTop: theme.spacing.md }}>
            <PromptsTabContent componentIds={componentIds} />
          </div>
        </Tabs.Content>
        <Tabs.Content value="skills">
          <div css={{ paddingTop: theme.spacing.md }}>
            <SkillsContent />
          </div>
        </Tabs.Content>
      </Tabs.Root>
    </ScrollablePageWrapper>
  );
};

export default withErrorBoundary(ErrorUtils.mlflowServices.EXPERIMENTS, PromptsPage, undefined, PromptPageErrorHandler);
