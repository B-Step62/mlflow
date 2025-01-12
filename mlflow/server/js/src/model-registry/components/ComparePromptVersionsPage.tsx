/**
 * NOTE: this code file was automatically migrated to TypeScript using ts-migrate and
 * may contain multiple `any` type annotations and `@ts-expect-error` directives.
 * If possible, please improve types while making changes to this file. If the type
 * annotations are already looking good, please remove this comment.
 */

import { Component } from 'react';
import qs from 'qs';
import { connect } from 'react-redux';
import { getUUID } from '../../common/utils/ActionUtils';
import { getRegisteredModelApi, getModelVersionApi } from '../actions';
import RequestStateWrapper from '../../common/components/RequestStateWrapper';
import { ComparePromptVersionsView } from './ComparePromptVersionsView';
import _ from 'lodash';
import { PageContainer } from '../../common/components/PageContainer';
import { withRouterNext } from '../../common/utils/withRouterNext';
import type { WithRouterNextProps } from '../../common/utils/withRouterNext';
import { withErrorBoundary } from '../../common/utils/withErrorBoundary';
import ErrorUtils from '../../common/utils/ErrorUtils';

type ComparePromptVersionsPageImplProps = {
  promptName: string;
  versions: string[];
  getRegisteredModelApi: (...args: any[]) => any;
  getModelVersionApi: (...args: any[]) => any;
};

type ComparePromptVersionsPageImplState = any;

// TODO: Write integration tests for this component
export class ComparePromptVersionsPageImpl extends Component<
ComparePromptVersionsPageImplProps,
ComparePromptVersionsPageImplState
> {
  registeredModelRequestId = getUUID();
  versionRequestId = getUUID();

  state = {
    requestIds: [
      // requests that must be fulfilled before rendering
      this.registeredModelRequestId,
      this.versionRequestId,
    ],
  };

  removeRunRequestId() {
    this.setState((prevState: any) => ({
      requestIds: _.without(prevState.requestIds),
    }));
  }

  componentDidMount() {
    this.props.getRegisteredModelApi(this.props.promptName, this.registeredModelRequestId);
    this.props.versions.map((promptVersion: string) => {
      if ({}.hasOwnProperty.call(this.props.versions, promptVersion)) {
        const { promptName } = this.props;
        console.log('promptName:', promptName, 'promptVersion:', promptVersion, "versions", this.props.versions);
        this.props.getModelVersionApi(promptName, promptVersion, this.versionRequestId);
      }
    })
  }

  render() {
    return (
      <PageContainer>
        <RequestStateWrapper
          requestIds={this.state.requestIds}
        >
          <ComparePromptVersionsView promptName={this.props.promptName} oldVersion={this.props.versions[0]} newVersion={this.props.versions[1]} />
        </RequestStateWrapper>
      </PageContainer>
    );
  }
}

const mapStateToProps = (state: any, ownProps: WithRouterNextProps) => {
  const { location } = ownProps;
  const searchValues = qs.parse(location.search);
  // @ts-expect-error TS(2345): Argument of type 'string | string[] | ParsedQs | P... Remove this comment to see the full error message
  const promptName = decodeURIComponent(JSON.parse(searchValues['?name']));
  // @ts-expect-error TS(2345): Argument of type 'string | string[] | ParsedQs | P... Remove this comment to see the full error message
  const versions = JSON.parse(searchValues['versions']);
  return { promptName, versions };
};

const mapDispatchToProps = {
  getRegisteredModelApi,
  getModelVersionApi,
};

const ComparePromptVersionsPageWithRouter = withRouterNext(
  connect(mapStateToProps, mapDispatchToProps)(ComparePromptVersionsPageImpl),
);

export const ComparePromptVersionsPage = withErrorBoundary(
  ErrorUtils.mlflowServices.MODEL_REGISTRY,
  ComparePromptVersionsPageWithRouter,
);

export default ComparePromptVersionsPage;
