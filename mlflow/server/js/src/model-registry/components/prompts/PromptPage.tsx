/**
 * NOTE: this code file was automatically migrated to TypeScript using ts-migrate and
 * may contain multiple `any` type annotations and `@ts-expect-error` directives.
 * If possible, please improve types while making changes to this file. If the type
 * annotations are already looking good, please remove this comment.
 */

import React from 'react';
import { connect } from 'react-redux';
import {
  listPromptVersionsApi,
  getPromptApi,
} from '../../actions';
import { PromptView } from './PromptView';
import { getPromptVersions } from '../../reducers';
import { MODEL_VERSION_STATUS_POLL_INTERVAL as POLL_INTERVAL } from '../../constants';
import { PageContainer } from '../../../common/components/PageContainer';
import RequestStateWrapper, { triggerError } from '../../../common/components/RequestStateWrapper';
import { Spinner } from '../../../common/components/Spinner';
import { ErrorView } from '../../../common/components/ErrorView';
import { ModelRegistryRoutes } from '../../routes';
import Utils from '../../../common/utils/Utils';
import { getUUID } from '../../../common/utils/ActionUtils';
import { injectIntl } from 'react-intl';
import { ErrorWrapper } from '../../../common/utils/ErrorWrapper';
import { withRouterNext } from '../../../common/utils/withRouterNext';
import type { WithRouterNextProps } from '../../../common/utils/withRouterNext';
import { withErrorBoundary } from '../../../common/utils/withErrorBoundary';
import ErrorUtils from '../../../common/utils/ErrorUtils';
import { ErrorCodes } from '../../../common/constants';

type PromptPageImplProps = WithRouterNextProps<{ subpage: string }> & {
  name: string;
  prompt?: any;
  promptVersions?: any[];
  listPromptVersionsApi: (...args: any[]) => any;
  getPromptApi: (...args: any[]) => any;
  intl?: any;
};

export class PromptPageImpl extends React.Component<PromptPageImplProps> {
  hasUnfilledRequests: any;
  pollIntervalId: any;

  initListPromptVersionsApiRequestId = getUUID();
  initGetPromptApiRequestId = getUUID();

  criticalInitialRequestIds = [this.initListPromptVersionsApiRequestId, this.initGetPromptApiRequestId];

  loadData = (isInitialLoading: any) => {
    const { name } = this.props;
    this.hasUnfilledRequests = true;
    const promiseValues = [
      this.props.getPromptApi(
        name,
        isInitialLoading === true ? this.initGetPromptApiRequestId : null,
      ),
      this.props.listPromptVersionsApi(
        { name: name },
        isInitialLoading === true ? this.initListPromptVersionsApiRequestId : null,
      ),
    ];
    return Promise.all(promiseValues).then(() => {
      this.hasUnfilledRequests = false;
    });
  };

  pollData = () => {
    const { name, navigate } = this.props;
    if (!this.hasUnfilledRequests && Utils.isBrowserTabVisible()) {
      // @ts-expect-error TS(2554): Expected 1 arguments, but got 0.
      return this.loadData().catch((e) => {
        if (e instanceof ErrorWrapper && e.getErrorCode() === 'RESOURCE_DOES_NOT_EXIST') {
          Utils.logErrorAndNotifyUser(e);
          navigate(ModelRegistryRoutes.modelListPageRoute);
        } else {
          // eslint-disable-next-line no-console -- TODO(FEINF-3587)
          console.error(e);
        }
        this.hasUnfilledRequests = false;
      });
    }
    return Promise.resolve();
  };

  componentDidMount() {
    // eslint-disable-next-line no-console -- TODO(FEINF-3587)
    this.loadData(true).catch(console.error);
    this.hasUnfilledRequests = false;
    this.pollIntervalId = setInterval(this.pollData, POLL_INTERVAL);
  }

  componentWillUnmount() {
    clearInterval(this.pollIntervalId);
  }

  render() {
    const { prompt, promptVersions, navigate, name } = this.props;
    return (
      <PageContainer>
        <RequestStateWrapper
          requestIds={this.criticalInitialRequestIds}
          // eslint-disable-next-line no-trailing-spaces
        >
          {(loading: any, hasError: any, requests: any) => {
            if (hasError) {
              clearInterval(this.pollIntervalId);
              if (Utils.shouldRender404(requests, [this.initGetPromptApiRequestId])) {
                return (
                  <ErrorView
                    statusCode={404}
                    subMessage={this.props.intl.formatMessage(
                      {
                        defaultMessage: 'Prompt {name} does not exist',
                        description: 'Sub-message text for error message on overall model page',
                      },
                      {
                        name: name,
                      },
                    )}
                    fallbackHomePageReactRoute={ModelRegistryRoutes.promptListPageRoute}
                  />
                );
              }
              const permissionDeniedErrors = requests.filter((request: any) => {
                return (
                  this.criticalInitialRequestIds.includes(request.id) &&
                  request.error?.getErrorCode() === ErrorCodes.PERMISSION_DENIED
                );
              });
              if (permissionDeniedErrors && permissionDeniedErrors[0]) {
                return (
                  <ErrorView
                    statusCode={403}
                    subMessage={this.props.intl.formatMessage(
                      {
                        defaultMessage: 'Permission denied for {name}. Error: "{errorMsg}"',
                        description: 'Permission denied error message on prompt detail page',
                      },
                      {
                        name: name,
                        errorMsg: permissionDeniedErrors[0].error?.getMessageField(),
                      },
                    )}
                    fallbackHomePageReactRoute={ModelRegistryRoutes.promptListPageRoute}
                  />
                );
              }
              // TODO(Zangr) Have a more generic boundary to handle all errors, not just 404.
              triggerError(requests);
            } else if (loading) {
              return <Spinner />;
            } else if (prompt) {
              // Null check to prevent NPE after delete operation
              return (
                <PromptView
                  prompt={prompt}
                  promptVersions={promptVersions}
                  navigate={navigate}
                  tags={prompt.tags}
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

const mapStateToProps = (state: any, ownProps: WithRouterNextProps<{ promptName: string }>) => {
  const promptName = decodeURIComponent(ownProps.params.promptName);
  const prompt = state.entities.promptByName[promptName];
  const promptVersions = getPromptVersions(state, promptName);
  return {
    promptName,
    prompt,
    promptVersions,
  };
};

const mapDispatchToProps = {
  listPromptVersionsApi,
  getPromptApi,
};

const PromptPageWithRouter = withRouterNext(
  // @ts-expect-error TS(2769): No overload matches this call.
  connect(mapStateToProps, mapDispatchToProps)(injectIntl(PromptPageImpl)),
);

export const PromptPage = withErrorBoundary(ErrorUtils.mlflowServices.MODEL_REGISTRY, PromptPageWithRouter);

export default PromptPage;
