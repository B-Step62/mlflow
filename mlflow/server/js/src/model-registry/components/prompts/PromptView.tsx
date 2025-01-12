/**
 * NOTE: this code file was automatically migrated to TypeScript using ts-migrate and
 * may contain multiple `any` type annotations and `@ts-expect-error` directives.
 * If possible, please improve types while making changes to this file. If the type
 * annotations are already looking good, please remove this comment.
 */

import React from 'react';
import { PromptVersionTable } from './PromptVersionTable';
import Utils from '../../../common/utils/Utils';
import { Link, NavigateFunction } from '../../../common/utils/RoutingUtils';
import { ModelRegistryRoutes } from '../../routes';
import { CollapsibleSection } from '../../../common/components/CollapsibleSection';
import { EditableNote } from '../../../common/components/EditableNote';
import { PageHeader } from '../../../shared/building_blocks/PageHeader';
import { FormattedMessage, type IntlShape, injectIntl } from 'react-intl';
import { Descriptions } from '../../../common/components/Descriptions';
import { PromptVersionInfoEntity, type PromptEntity } from '../../../experiment-tracking/types';
import { withNextModelsUIContext } from '../../hooks/useNextModelsUI';

type PromptViewImplProps = {
  prompt?: PromptEntity;
  promptVersions?: PromptVersionInfoEntity[];
  navigate: NavigateFunction;
  tags: any;
  intl: IntlShape;
};

type PromptViewImplState = any;

export class PromptViewImpl extends React.Component<PromptViewImplProps, PromptViewImplState> {
  constructor(props: PromptViewImplProps) {
    super(props);
    // this.onCompare = this.onCompare.bind(this);
  }

  formRef = React.createRef();

  componentDidMount() {
    // @ts-expect-error TS(2532): Object is possibly 'undefined'.
    const pageTitle = `${this.props.model.name} - MLflow Model`;
    Utils.updatePageTitle(pageTitle);
  }

  // onCompare() {
  //   if (!this.props.prompt) {
  //     return;
  //   }
  //   this.props.navigate(
  //     ModelRegistryRoutes.getCompareModelVersionsPageRoute(this.props.prompt.name, this.state.runsSelected),
  //   );
  // }


  renderDetails = () => {
    const { prompt, promptVersions, tags } = this.props;
    // @ts-expect-error TS(2532): Object is possibly 'undefined'.
    const promptName = prompt.name;
    return (
      <div css={styles.wrapper}>
        {/* Metadata List */}
        <Descriptions columns={3} data-testid="prompt-view-metadata">
          <Descriptions.Item
            data-testid="prompt-view-metadata-item"
            label={this.props.intl.formatMessage({
              defaultMessage: 'Created Time',
              description: 'Label name for the created time under details tab on the model view page',
            })}
          >
            {/* @ts-expect-error TS(2532): Object is possibly 'undefined'. */}
            {Utils.formatTimestamp(prompt.creation_timestamp)}
          </Descriptions.Item>
          <Descriptions.Item
            data-testid="model-view-metadata-item"
            label={this.props.intl.formatMessage({
              defaultMessage: 'Last Modified',
              description: 'Label name for the last modified time under details tab on the model view page',
            })}
          >
            {/* @ts-expect-error TS(2532): Object is possibly 'undefined'. */}
            {Utils.formatTimestamp(prompt.last_updated_at)}
          </Descriptions.Item>
        </Descriptions>

        {/* Page Sections */}
        <CollapsibleSection
          // @ts-expect-error TS(2322): Type '{ children: Element; css: any; title: Elemen... Remove this comment to see the full error message
          css={(styles as any).collapsiblePanel}
          title={
            <span>
              <FormattedMessage
                defaultMessage="Description"
                description="Title text for the description section under details tab on the model
                   view page"
              />{' '}
            </span>
          }
          // Reported during ESLint upgrade
          // eslint-disable-next-line react/prop-types
          defaultCollapsed={!(prompt as any).description}
          data-test-id="model-description-section"
        >
          <EditableNote
            defaultMarkdown={(prompt as any).description}
            //onSubmit={this.handleSubmitEditDescription}
            //onCancel={this.handleCancelEditDescription}
            //showEditor={showDescriptionEditor}
          />
        </CollapsibleSection>

        <CollapsibleSection
          title={
            <>
              <div css={styles.versionsTabButtons}>
                <span>
                  <FormattedMessage
                    defaultMessage="Versions"
                    description="Title text for the versions section under details tab on the
                       model view page"
                  />
                </span>
                {/* <Button
                  componentId="codegen_mlflow_app_src_model-registry_components_modelview.tsx_619"
                  data-test-id="compareButton"
                  disabled={compareDisabled}
                  onClick={this.onCompare}
                >
                  <FormattedMessage
                    defaultMessage="Compare"
                    description="Text for compare button to compare versions under details tab
                       on the model view page"
                  />
                </Button> */}
              </div>
            </>
          }
          data-test-id="model-versions-section"
        >
          <PromptVersionTable
            promptName={promptName}
            promptVersions={promptVersions}
            promptEntity={prompt}
          />
        </CollapsibleSection>
      </div>
    );
  };

  renderMainPanel() {
    return this.renderDetails();
  }

  render() {
    const { prompt } = this.props;
    // @ts-expect-error TS(2532): Object is possibly 'undefined'.
    const promptName = prompt.name;

    const breadcrumbs = [
      <Link to={ModelRegistryRoutes.promptListPageRoute}>
        <FormattedMessage
          defaultMessage="Registered Prompts"
          description="Text for link back to model page under the header on the model view page"
        />
      </Link>,
    ];
    return (
      <div>
        <PageHeader title={promptName} breadcrumbs={breadcrumbs}>
          {/* <OverflowMenu menu={this.getOverflowMenuItems()} /> */}
        </PageHeader>
        {this.renderMainPanel()}
      </div>
    );
  }
}

const styles = {
  emailNotificationPreferenceDropdown: (theme: any) => ({
    width: 300,
    marginBottom: theme.spacing.md,
  }),
  emailNotificationPreferenceTip: (theme: any) => ({
    paddingLeft: theme.spacing.sm,
    paddingRight: theme.spacing.sm,
  }),
  wrapper: (theme: any) => ({
    '.collapsible-panel': {
      marginBottom: theme.spacing.md,
    },

    /**
     * This seems to be a best and most stable method to catch
     * antd's collapsible section buttons without hacks
     * and using class names.
     */
    'div[role="button"][aria-expanded]': {
      height: theme.general.buttonHeight,
    },
  }),
  editButton: (theme: any) => ({
    marginLeft: theme.spacing.md,
  }),
  versionsTabButtons: (theme: any) => ({
    display: 'flex',
    gap: theme.spacing.md,
    alignItems: 'center',
  }),
};

export const PromptView = withNextModelsUIContext(injectIntl(PromptViewImpl));
