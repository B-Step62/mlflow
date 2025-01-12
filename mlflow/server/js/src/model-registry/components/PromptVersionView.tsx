/**
 * NOTE: this code file was automatically migrated to TypeScript using ts-migrate and
 * may contain multiple `any` type annotations and `@ts-expect-error` directives.
 * If possible, please improve types while making changes to this file. If the type
 * annotations are already looking good, please remove this comment.
 */

import React from 'react';
import { Link, NavigateFunction } from '../../common/utils/RoutingUtils';
import { ModelRegistryRoutes } from '../routes';
import Utils from '../../common/utils/Utils';
import { ModelStageTransitionDropdown } from './ModelStageTransitionDropdown';
import { message } from 'antd';
import { Descriptions } from '../../common/components/Descriptions';
import { Alert, Modal, Button, InfoIcon, LegacyTooltip, Typography } from '@databricks/design-system';
import {
  ModelVersionStatus,
  StageTagComponents,
  ModelVersionStatusIcons,
  DefaultModelVersionStatusMessages,
  ACTIVE_STAGES,
} from '../constants';
import Routers from '../../experiment-tracking/routes';
import { CollapsibleSection } from '../../common/components/CollapsibleSection';
import { EditableNote } from '../../common/components/EditableNote';
import { EditableTagsTableView } from '../../common/components/EditableTagsTableView';
import { getModelVersionTags } from '../reducers';
import { setModelVersionTagApi, deleteModelVersionTagApi } from '../actions';
import { connect } from 'react-redux';
import { OverflowMenu, PageHeader } from '../../shared/building_blocks/PageHeader';
import { FormattedMessage, type IntlShape, injectIntl } from 'react-intl';
import { withNextModelsUIContext } from '../hooks/useNextModelsUI';
import { ModelVersionViewAliasEditor } from './aliases/ModelVersionViewAliasEditor';
import type { ModelEntity } from '../../experiment-tracking/types';

type PromptVersionViewImplProps = {
  promptName?: string;
  promptVersion?: any;
  promptEntity?: ModelEntity;
  activities?: Record<string, unknown>[];
  transitionRequests?: Record<string, unknown>[];
  onCreateComment: (...args: any[]) => any;
  onEditComment: (...args: any[]) => any;
  onDeleteComment: (...args: any[]) => any;
  handleStageTransitionDropdownSelect: (...args: any[]) => any;
  deleteModelVersionApi: (...args: any[]) => any;
  handleEditDescription: (...args: any[]) => any;
  onAliasesModified: () => void;
  navigate: NavigateFunction;
  tags: any;
  setModelVersionTagApi: (...args: any[]) => any;
  deleteModelVersionTagApi: (...args: any[]) => any;
  intl: IntlShape;
  usingNextModelsUI: boolean;
};

type PromptVersionViewImplState = any;

export class PromptVersionViewImpl extends React.Component<PromptVersionViewImplProps, PromptVersionViewImplState> {
  state = {
    isDeletePromptVisible: false,
    isDeletePromptConfirmLoading: false,
    showDescriptionEditor: false,
    isTagsRequestPending: false,
  };

  formRef = React.createRef();

  componentDidMount() {
    const pageTitle = `${this.props.promptName} v${this.props.promptVersion.version} - MLflow Prompt`;
    Utils.updatePageTitle(pageTitle);
  }

  handleDeleteConfirm = () => {
    const { promptName = '', promptVersion, navigate } = this.props;
    const { version } = promptVersion;
    this.showConfirmLoading();
    this.props
      .deleteModelVersionApi(promptName, version)
      .then(() => {
        navigate(ModelRegistryRoutes.getModelPageRoute(promptName));
      })
      .catch((e: any) => {
        this.hideConfirmLoading();
        Utils.logErrorAndNotifyUser(e);
      });
  };

  showDeleteModal = () => {
    this.setState({ isDeletePromptVisible: true });
  };

  hideDeleteModal = () => {
    this.setState({ isDeletePromptVisible: false });
  };

  showConfirmLoading = () => {
    this.setState({ isDeletePromptConfirmLoading: true });
  };

  hideConfirmLoading = () => {
    this.setState({ isDeletePromptConfirmLoading: false });
  };

  handleCancelEditDescription = () => {
    this.setState({ showDescriptionEditor: false });
  };

  handleSubmitEditDescription = (description: any) => {
    return this.props.handleEditDescription(description).then(() => {
      this.setState({ showDescriptionEditor: false });
    });
  };

  startEditingDescription = (e: any) => {
    e.stopPropagation();
    this.setState({ showDescriptionEditor: true });
  };

  handleAddTag = (values: any) => {
    const form = this.formRef.current;
    const { promptName } = this.props;
    const { version } = this.props.promptVersion;
    this.setState({ isTagsRequestPending: true });
    this.props
      .setModelVersionTagApi(promptName, version, values.name, values.value)
      .then(() => {
        this.setState({ isTagsRequestPending: false });
        (form as any).resetFields();
      })
      .catch((ex: any) => {
        this.setState({ isTagsRequestPending: false });
        // eslint-disable-next-line no-console -- TODO(FEINF-3587)
        console.error(ex);
        message.error(
          this.props.intl.formatMessage(
            {
              defaultMessage: 'Failed to add tag. Error: {userVisibleError}',
              description: 'Text for user visible error when adding tag in model version view',
            },
            {
              userVisibleError: ex.getUserVisibleError(),
            },
          ),
        );
      });
  };

  handleSaveEdit = ({ name, value }: any) => {
    const { promptName } = this.props;
    const { version } = this.props.promptVersion;
    return this.props.setModelVersionTagApi(promptName, version, name, value).catch((ex: any) => {
      // eslint-disable-next-line no-console -- TODO(FEINF-3587)
      console.error(ex);
      message.error(
        this.props.intl.formatMessage(
          {
            defaultMessage: 'Failed to set tag. Error: {userVisibleError}',
            description: 'Text for user visible error when setting tag in model version view',
          },
          {
            userVisibleError: ex.getUserVisibleError(),
          },
        ),
      );
    });
  };

  handleDeleteTag = ({ name }: any) => {
    const { promptName } = this.props;
    const { version } = this.props.promptVersion;
    return this.props.deleteModelVersionTagApi(promptName, version, name).catch((ex: any) => {
      // eslint-disable-next-line no-console -- TODO(FEINF-3587)
      console.error(ex);
      message.error(
        this.props.intl.formatMessage(
          {
            defaultMessage: 'Failed to delete tag. Error: {userVisibleError}',
            description: 'Text for user visible error when deleting tag in model version view',
          },
          {
            userVisibleError: ex.getUserVisibleError(),
          },
        ),
      );
    });
  };

  shouldHideDeleteOption() {
    return false;
  }

  renderStageDropdown(modelVersion: any) {
    const { handleStageTransitionDropdownSelect } = this.props;
    return (
      <Descriptions.Item
        key="description-key-stage"
        label={this.props.intl.formatMessage({
          defaultMessage: 'Stage',
          description: 'Label name for stage metadata in model version page',
        })}
      >
        {modelVersion.status === ModelVersionStatus.READY ? (
          <ModelStageTransitionDropdown
            currentStage={modelVersion.current_stage}
            permissionLevel={modelVersion.permission_level}
            onSelect={handleStageTransitionDropdownSelect}
          />
        ) : (
          StageTagComponents[modelVersion.current_stage]
        )}
      </Descriptions.Item>
    );
  }

  renderRegisteredTimestampDescription(creation_timestamp: any) {
    return (
      <Descriptions.Item
        key="description-key-register"
        label={this.props.intl.formatMessage({
          defaultMessage: 'Registered At',
          description: 'Label name for registered timestamp metadata in model version page',
        })}
      >
        {Utils.formatTimestamp(creation_timestamp)}
      </Descriptions.Item>
    );
  }

  renderCreatorDescription(user_id: any) {
    return (
      user_id && (
        <Descriptions.Item
          key="description-key-creator"
          label={this.props.intl.formatMessage({
            defaultMessage: 'Creator',
            description: 'Label name for creator metadata in model version page',
          })}
        >
          {user_id}
        </Descriptions.Item>
      )
    );
  }

  renderLastModifiedDescription(last_updated_timestamp: any) {
    return (
      <Descriptions.Item
        key="description-key-modified"
        label={this.props.intl.formatMessage({
          defaultMessage: 'Last Modified',
          description: 'Label name for last modified timestamp metadata in model version page',
        })}
      >
        {Utils.formatTimestamp(last_updated_timestamp)}
      </Descriptions.Item>
    );
  }

  renderAliasEditor = () => {
    // Extract aliases for the currently displayed model version from the model entity object
    const currentVersion = this.props.promptVersion.version;
    const currentVersionAliases =
      this.props.promptEntity?.aliases?.filter(({ version }) => version === currentVersion).map(({ alias }) => alias) ||
      [];
    return (
      <Descriptions.Item
        key="description-key-aliases"
        label={this.props.intl.formatMessage({
          defaultMessage: 'Aliases',
          description: 'Aliases section in the metadata on prompt version page',
        })}
      >
        <ModelVersionViewAliasEditor
          aliases={currentVersionAliases}
          version={this.props.promptVersion.version}
          modelEntity={this.props.promptEntity}
          onAliasesModified={this.props.onAliasesModified}
        />
      </Descriptions.Item>
    );
  };

  getDescriptions(promptVersion: any) {
    const defaultOrder = [
      this.renderRegisteredTimestampDescription(promptVersion.creation_timestamp),
      this.renderCreatorDescription(promptVersion.user_id),
      this.renderLastModifiedDescription(promptVersion.last_updated_timestamp),
      this.renderAliasEditor(),
    ];
    return defaultOrder.filter((item) => item !== null);
  }

  renderMetadata(promptVersion: any) {
    return (
      // @ts-expect-error TS(2322): Type '{ children: any[]; className: string; }' is ... Remove this comment to see the full error message
      <Descriptions className="metadata-list">{this.getDescriptions(promptVersion)}</Descriptions>
    );
  }

  renderDescription(promptVersion: any) {
    return (
      // @ts-expect-error TS(2322): Type '{ children: any[]; className: string; }' is ... Remove this comment to see the full error message
      <Descriptions className="metadata-list">{[
        <Descriptions.Item
          key="description-key-description"
          label={this.props.intl.formatMessage({
            defaultMessage: 'Description',
            description: 'DEscription for the prompt version',
          })}
        >{promptVersion.description}
        </Descriptions.Item>
      ]}</Descriptions>
    );
  }

  renderStatusAlert() {
    const { status, status_message } = this.props.promptVersion;
    if (status !== ModelVersionStatus.READY) {
      const defaultMessage = DefaultModelVersionStatusMessages[status];
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore - OSS specific ignore
      const type = status === ModelVersionStatus.FAILED_REGISTRATION ? 'error' : 'info';
      return (
        <Alert
          type={type}
          className={`status-alert status-alert-${type}`}
          message={status_message || defaultMessage}
          // @ts-expect-error TS(2322): Type '{ type: "error" | "info"; className: string;... Remove this comment to see the full error message
          icon={ModelVersionStatusIcons[status]}
          banner
        />
      );
    }
    return null;
  }


  getPageHeader(title: any, breadcrumbs: any) {
    const menu = [
      {
        id: 'delete',
        itemName: (
          <FormattedMessage
            defaultMessage="Delete"
            description="Text for delete button on model version view page header"
          />
        ),
        onClick: this.showDeleteModal,
        disabled: ACTIVE_STAGES.includes(this.props.promptVersion.current_stage),
      },
    ];
    return (
      <PageHeader title={title} breadcrumbs={breadcrumbs}>
        {!this.shouldHideDeleteOption() && <OverflowMenu menu={menu} />}
      </PageHeader>
    );
  }

  render() {
    const { promptName = '', promptVersion, tags } = this.props;
    const { description } = promptVersion;
    const { isDeletePromptVisible, isDeletePromptConfirmLoading, showDescriptionEditor, isTagsRequestPending } =
      this.state;
    const title = (
      <FormattedMessage
        defaultMessage="Version {versionNum}"
        description="Title text for model version page"
        values={{ versionNum: promptVersion.version }}
      />
    );
    const breadcrumbs = [
      <Link to={ModelRegistryRoutes.modelListPageRoute}>
        <FormattedMessage
          defaultMessage="Registered Prompts"
          description="Text for link back to models page under the header on the model version
             view page"
        />
      </Link>,
      <Link data-test-id="breadcrumbRegisteredModel" to={ModelRegistryRoutes.getModelPageRoute(promptName)}>
        {promptName}
      </Link>,
    ];
    return (
      <div>
        {this.getPageHeader(title, breadcrumbs)}
        {this.renderStatusAlert()}

        {/* Metadata List */}
        {this.renderDescription(promptVersion)}
        {this.renderMetadata(promptVersion)}

        {/* Prompt Section */}
        <CollapsibleSection
          title={
            <span>
              <FormattedMessage
                defaultMessage="Prompt"
                description="Title text for the description section on the model version view page"
              />{' '}
            </span>
          }
          defaultCollapsed={!description}
          data-test-id="model-version-description-section"
        >
          <textarea
            className="rich-text"
            value={promptVersion.tags.find((tag: any) => tag.key === 'mlflow.prompt.text')?.value}
            readOnly
            style={{ width: '100%', height: '200px', padding: '8px', borderRadius: '4px' }}
          />
        </CollapsibleSection>

        <div data-test-id="tags-section">
          <CollapsibleSection
            title={
              <FormattedMessage
                defaultMessage="Tags"
                description="Title text for the tags section on the model versions view page"
              />
            }
            defaultCollapsed={Utils.getVisibleTagValues(tags).length === 0}
            data-test-id="model-version-tags-section"
          >
            <EditableTagsTableView
              // @ts-expect-error TS(2322): Type '{ innerRef: RefObject<unknown>; handleAddTag... Remove this comment to see the full error message
              innerRef={this.formRef}
              handleAddTag={this.handleAddTag}
              handleDeleteTag={this.handleDeleteTag}
              handleSaveEdit={this.handleSaveEdit}
              tags={tags}
              isRequestPending={isTagsRequestPending}
            />
          </CollapsibleSection>
        </div>
        <Modal
          title={this.props.intl.formatMessage({
            defaultMessage: 'Delete Prompt Version',
            description: 'Title text for model version deletion modal in model versions view page',
          })}
          visible={isDeletePromptVisible}
          confirmLoading={isDeletePromptConfirmLoading}
          onOk={this.handleDeleteConfirm}
          okText={this.props.intl.formatMessage({
            defaultMessage: 'Delete',
            description: 'OK button text for model version deletion modal in model versions view page',
          })}
          // @ts-expect-error TS(2322): Type '{ children: Element; title: any; visible: bo... Remove this comment to see the full error message
          okType="danger"
          onCancel={this.hideDeleteModal}
          cancelText={this.props.intl.formatMessage({
            defaultMessage: 'Cancel',
            description: 'Cancel button text for model version deletion modal in model versions view page',
          })}
        >
          <span>
            <FormattedMessage
              defaultMessage="Are you sure you want to delete prompt version {versionNum}? This
                 cannot be undone."
              description="Comment text for model version deletion modal in model versions view
                 page"
              values={{ versionNum: promptVersion.version }}
            />
          </span>
        </Modal>
      </div>
    );
  }
}

const mapStateToProps = (state: any, ownProps: any) => {
  const { promptName } = ownProps;
  const { version } = ownProps.promptVersion;
  const tags = getModelVersionTags(promptName, version, state);
  return { tags };
};
const mapDispatchToProps = { setModelVersionTagApi, deleteModelVersionTagApi };

export const PromptVersionView = connect(
  mapStateToProps,
  mapDispatchToProps,
)(withNextModelsUIContext(injectIntl<'intl', PromptVersionViewImplProps>(PromptVersionViewImpl)));
