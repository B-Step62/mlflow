/**
 * NOTE: this code file was automatically migrated to TypeScript using ts-migrate and
 * may contain multiple `any` type annotations and `@ts-expect-error` directives.
 * If possible, please improve types while making changes to this file. If the type
 * annotations are already looking good, please remove this comment.
 */

import React from 'react';
import { connect } from 'react-redux';
import {
  getModelVersionApi,
  getRegisteredModelApi,
  updateModelVersionApi,
  deleteModelVersionApi,
  transitionModelVersionStageApi,
} from '../actions';
import { getModelVersion, getModelVersionSchemas } from '../reducers';
import { PromptVersionView } from './PromptVersionView';
import { ActivityTypes, MODEL_VERSION_STATUS_POLL_INTERVAL as POLL_INTERVAL } from '../constants';
import Utils from '../../common/utils/Utils';
import RequestStateWrapper, { triggerError } from '../../common/components/RequestStateWrapper';
import { ErrorView } from '../../common/components/ErrorView';
import { Spinner } from '../../common/components/Spinner';
import { ModelRegistryRoutes } from '../routes';
import { getUUID } from '../../common/utils/ActionUtils';
import _ from 'lodash';
import { PageContainer } from '../../common/components/PageContainer';
import { withRouterNext } from '../../common/utils/withRouterNext';
import type { WithRouterNextProps } from '../../common/utils/withRouterNext';
import { withErrorBoundary } from '../../common/utils/withErrorBoundary';
import ErrorUtils from '../../common/utils/ErrorUtils';
import type { ModelEntity } from '../../experiment-tracking/types';
import { ReduxState } from '../../redux-types';
import { ErrorCodes } from '../../common/constants';
import { injectIntl } from 'react-intl';

type PromptVersionPageImplProps = WithRouterNextProps & {
  promptName: string;
  version: string;
  promptVersion?: any;
  promptEntity?: ModelEntity;
  getModelVersionApi: (...args: any[]) => any;
  getRegisteredModelApi: typeof getRegisteredModelApi;
  updateModelVersionApi: (...args: any[]) => any;
  transitionModelVersionStageApi: (...args: any[]) => any;
  deleteModelVersionApi: (...args: any[]) => any;
  apis: any;
  schema?: any;
  activities?: Record<string, unknown>[];
  intl?: any;
};

type PromptVersionPageImplState = any;

export class PromptVersionPageImpl extends React.Component<PromptVersionPageImplProps, PromptVersionPageImplState> {
  listTransitionRequestId: any;
  pollIntervalId: any;

  initGetModelVersionDetailsRequestId = getUUID();
  getRunRequestId = getUUID();
  updateModelVersionRequestId = getUUID();
  transitionModelVersionStageRequestId = getUUID();
  getModelVersionDetailsRequestId = getUUID();
  initGetMlModelFileRequestId = getUUID();
  state = {
    criticalInitialRequestIds: [this.initGetModelVersionDetailsRequestId, this.initGetMlModelFileRequestId],
  };

  pollingRelatedRequestIds = [this.getModelVersionDetailsRequestId, this.getRunRequestId];

  hasPendingPollingRequest = () =>
    this.pollingRelatedRequestIds.every((requestId) => {
      const request = this.props.apis[requestId];
      return Boolean(request && request.active);
    });

  loadData = (isInitialLoading: any) => {
    const promises = [this.getPromptVersionDetails(isInitialLoading)];
    return Promise.all([promises]);
  };

  pollData = () => {
    const { promptName, version, navigate } = this.props;
    if (!this.hasPendingPollingRequest() && Utils.isBrowserTabVisible()) {
      // @ts-expect-error TS(2554): Expected 1 arguments, but got 0.
      return this.loadData().catch((e) => {
        if (e.getErrorCode() === 'RESOURCE_DOES_NOT_EXIST') {
          Utils.logErrorAndNotifyUser(e);
          this.props.deleteModelVersionApi(promptName, version, undefined, true);
          navigate(ModelRegistryRoutes.getModelPageRoute(promptName));
        } else {
          // eslint-disable-next-line no-console -- TODO(FEINF-3587)
          console.error(e);
        }
      });
    }
    return Promise.resolve();
  };

  // We need to do this because currently the ModelVersionDetailed we got does not contain
  // experimentId. We need experimentId to construct a link to the source run. This workaround can
  // be removed after the availability of experimentId.
  getPromptVersionDetails(isInitialLoading: any) {
    const { promptName, version } = this.props;
    return this.props
      .getModelVersionApi(
        promptName,
        version,
        isInitialLoading === true ? this.initGetModelVersionDetailsRequestId : this.getModelVersionDetailsRequestId,
      )
  };

  handleStageTransitionDropdownSelect = (activity: any, archiveExistingVersions: any) => {
    const { promptName, version } = this.props;
    const toStage = activity.to_stage;
    if (activity.type === ActivityTypes.APPLIED_TRANSITION) {
      this.props
        .transitionModelVersionStageApi(
          promptName,
          version.toString(),
          toStage,
          archiveExistingVersions,
          this.transitionModelVersionStageRequestId,
        )
        .then(this.loadData)
        .catch(Utils.logErrorAndNotifyUser);
    }
  };

  handleEditDescription = (description: any) => {
    const { promptName, version } = this.props;
    return (
      this.props
        .updateModelVersionApi(promptName, version, description, this.updateModelVersionRequestId)
        .then(this.loadData)
        // eslint-disable-next-line no-console -- TODO(FEINF-3587)
        .catch(console.error)
    );
  };

  componentDidMount() {
    // eslint-disable-next-line no-console -- TODO(FEINF-3587)
    this.loadData(true).catch(console.error);
    this.loadModelDataWithAliases();
    this.pollIntervalId = setInterval(this.pollData, POLL_INTERVAL);
  }

  loadModelDataWithAliases = () => {
    this.props.getRegisteredModelApi(this.props.promptName);
  };

  // Make a new initial load if model version or name has changed
  componentDidUpdate(prevProps: PromptVersionPageImplProps) {
    if (this.props.version !== prevProps.version || this.props.promptName !== prevProps.promptName) {
      // eslint-disable-next-line no-console -- TODO(FEINF-3587)
      this.loadData(true).catch(console.error);
    }
  }

  componentWillUnmount() {
    clearInterval(this.pollIntervalId);
  }

  render() {
    const { promptName, version, promptVersion, navigate, schema, promptEntity } = this.props;

    return (
      <PageContainer>
        <RequestStateWrapper
          requestIds={this.state.criticalInitialRequestIds}
          // eslint-disable-next-line no-trailing-spaces
        >
          {(loading: any, hasError: any, requests: any) => {
            if (hasError) {
              clearInterval(this.pollIntervalId);
              const resourceConflictError = Utils.getResourceConflictError(
                requests,
                this.state.criticalInitialRequestIds,
              );
              if (resourceConflictError) {
                return (
                  <ErrorView
                    statusCode={409}
                    subMessage={resourceConflictError.error.getMessageField()}
                    fallbackHomePageReactRoute={ModelRegistryRoutes.modelListPageRoute}
                  />
                );
              }
              if (Utils.shouldRender404(requests, this.state.criticalInitialRequestIds)) {
                return (
                  <ErrorView
                    statusCode={404}
                    subMessage={`Prompt ${promptName} v${version} does not exist`}
                    fallbackHomePageReactRoute={ModelRegistryRoutes.modelListPageRoute}
                  />
                );
              }
              // TODO(Zangr) Have a more generic boundary to handle all errors, not just 404.
              const permissionDeniedErrors = requests.filter((request: any) => {
                return (
                  this.state.criticalInitialRequestIds.includes(request.id) &&
                  request.error?.getErrorCode() === ErrorCodes.PERMISSION_DENIED
                );
              });
              if (permissionDeniedErrors && permissionDeniedErrors[0]) {
                return (
                  <ErrorView
                    statusCode={403}
                    subMessage={this.props.intl.formatMessage(
                      {
                        defaultMessage: 'Permission denied for {promptName} version {version}. Error: "{errorMsg}"',
                        description: 'Permission denied error message on prompt version detail page',
                      },
                      {
                        promptName: promptName,
                        version: version,
                        errorMsg: permissionDeniedErrors[0].error?.getMessageField(),
                      },
                    )}
                    fallbackHomePageReactRoute={ModelRegistryRoutes.modelListPageRoute}
                  />
                );
              }
              triggerError(requests);
            // } else if (loading) {
            //   console.log('loading', loading, 'hasError', hasError, 'requests', requests);
            //   return <Spinner />;
            } else if (promptVersion) {
              // Null check to prevent NPE after delete operation
              return (
                <PromptVersionView
                  promptName={promptName}
                  promptVersion={promptVersion}
                  promptEntity={promptEntity}
                  handleEditDescription={this.handleEditDescription}
                  deleteModelVersionApi={this.props.deleteModelVersionApi}
                  navigate={navigate}
                  handleStageTransitionDropdownSelect={this.handleStageTransitionDropdownSelect}
                  onAliasesModified={this.loadModelDataWithAliases}
                />
              );
            }
            return null;
          }}
        </RequestStateWrapper>
      </PageContainer>
    );
  }
}

const mapStateToProps = (state: ReduxState, ownProps: WithRouterNextProps<{ modelName: string; version: string }>) => {
  const promptName = decodeURIComponent(ownProps.params.modelName);
  const { version } = ownProps.params;
  const promptVersion = getModelVersion(state, promptName, version);
  const schema = getModelVersionSchemas(state, promptName, version);
  const promptEntity = state.entities.modelByName[promptName];
  const { apis } = state;
  return {
    promptName,
    version,
    promptVersion,
    promptEntity,
    apis,
    schema,
  };
};

const mapDispatchToProps = {
  getModelVersionApi,
  getRegisteredModelApi,
  updateModelVersionApi,
  transitionModelVersionStageApi,
  deleteModelVersionApi,
};

const PromptVersionPageWithRouter = withRouterNext(
  // @ts-expect-error TS(2769): No overload matches this call.
  connect(mapStateToProps, mapDispatchToProps)(injectIntl(PromptVersionPageImpl)),
);

export const PromptVersionPage = withErrorBoundary(ErrorUtils.mlflowServices.MODEL_REGISTRY, PromptVersionPageWithRouter);

export default PromptVersionPage;
