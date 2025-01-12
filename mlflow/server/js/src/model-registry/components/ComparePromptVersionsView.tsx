/**
 * NOTE: this code file was automatically migrated to TypeScript using ts-migrate and
 * may contain multiple `any` type annotations and `@ts-expect-error` directives.
 * If possible, please improve types while making changes to this file. If the type
 * annotations are already looking good, please remove this comment.
 */

import React, { Component } from 'react';
import ReactDiffViewer from "react-diff-viewer-continued";
import { connect } from 'react-redux';
import { Link } from '../../common/utils/RoutingUtils';
import _ from 'lodash';
import { FormattedMessage } from 'react-intl';
import { Switch, LegacyTabs, useDesignSystemTheme } from '@databricks/design-system';

import '../../experiment-tracking/components/CompareRunView.css';
import { CompareRunScatter } from '../../experiment-tracking/components/CompareRunScatter';
import { CompareRunBox } from '../../experiment-tracking/components/CompareRunBox';
import CompareRunContour from '../../experiment-tracking/components/CompareRunContour';
import { ModelRegistryRoutes } from '../routes';
import { getLatestMetrics } from '../../experiment-tracking/reducers/MetricReducer';
import CompareRunUtil from '../../experiment-tracking/components/CompareRunUtil';
import Utils from '../../common/utils/Utils';
import ParallelCoordinatesPlotPanel from '../../experiment-tracking/components/ParallelCoordinatesPlotPanel';
import { getModelVersion } from '../reducers';
import { PageHeader } from '../../shared/building_blocks/PageHeader';
import type { ModelVersionInfoEntity, RunInfoEntity } from '../../experiment-tracking/types';


function CompareTable(props: any) {
  const { theme } = useDesignSystemTheme();
  return (
    <table
      className="compare-table table"
      css={{
        'th.main-table-header': {
          backgroundColor: theme.colors.white,
          padding: 0,
        },
        'td.highlight-data': {
          backgroundColor: theme.colors.backgroundValidationWarning,
        },
      }}
      {...props}
    />
  );
}

type ComparePromptVersionsViewImplProps = {
  promptName: string;
  oldVersion: string;
  newVersion: string;
  oldPromptVersionEntity: ModelVersionInfoEntity;
  newPromptVersionEntity: ModelVersionInfoEntity;
};

type ComparePromptVersionsViewImplState = any;

export class ComparePromptVersionsViewImpl extends Component<
  ComparePromptVersionsViewImplProps,
  ComparePromptVersionsViewImplState
> {
  state = {};

  icons = {
    plusIcon: <i className="far fa-plus-square-o" />,
    minusIcon: <i className="far fa-minus-square-o" />,
    downIcon: <i className="fas fa-caret-down" />,
    rightIcon: <i className="fas fa-caret-right" />,
    chartIcon: <i className="fas fa-line-chart padding-left-text" />,
  };

  onToggleClick = (active: any) => {
    this.setState((state: any) => ({
      [active]: !state[active],
    }));
  };

  getPromptText = (promptVersionEntity: ModelVersionInfoEntity) => {
      if (promptVersionEntity === undefined || promptVersionEntity.tags === undefined) {
        return
      }
      const promptTag = promptVersionEntity.tags.find((tag) => tag.key === "mlflow.prompt.text");
      return promptTag ? promptTag.value : "";
  }

  render() {
    const {
      promptName,
      oldPromptVersionEntity,
      newPromptVersionEntity,
    } = this.props;
    const title = (
      <FormattedMessage
        defaultMessage="Comparing 2 Versions"
        description="Text for main title for the model comparison page"
      />
    );
    const breadcrumbs = [
      <Link to={ModelRegistryRoutes.modelListPageRoute}>
        <FormattedMessage
          defaultMessage="Registered Prompts"
          description="Text for registered prompt link in the title for prompt comparison page"
        />
      </Link>,
      <Link to={ModelRegistryRoutes.getModelPageRoute(promptName)}>{promptName}</Link>,
    ];

    return (
      <div
        className="ComparePromptVersionsView"
        // @ts-expect-error TS(2322): Type '{ '.compare-table': { minWidth: number; }; '... Remove this comment to see the full error message
        css={{
          ...styles.compareModelVersionsView,
          ...styles.wrapper(2),
        }}
      >
        <PageHeader title={title} breadcrumbs={breadcrumbs} />
        <div className="responsive-table-container">
          <CompareTable>
            {this.renderTableHeader()}
            {this.renderPromptVersionInfo()}
            {/* {this.renderPromptDiff()} */}
          </CompareTable>
        </div>
        <ReactDiffViewer
          oldValue={this.getPromptText(oldPromptVersionEntity)}
          newValue={this.getPromptText(newPromptVersionEntity)}
          splitView={true}
        />
      </div>
    );
  }

  renderTableHeader() {
    const { promptName, oldVersion, newVersion } = this.props;
    return (
      <thead>
        <tr className="table-row">
          <th scope="row" className="row-header block-content">
            <FormattedMessage
              defaultMessage="Prompt Version:"
              description="Text for run ID header in the main table in the model comparison page"
            />
          </th>
          {[oldVersion, newVersion].map((version) => (
            <th scope="column" className="data-value block-content" key={version}>
              <Link to={ModelRegistryRoutes.getModelVersionPageRoute(promptName, version)}>prompts:/{promptName}/{version}</Link>
            </th>
          ))}
        </tr>
      </thead>
    );
  }

  renderPromptVersionInfo() {
    const { oldPromptVersionEntity, newPromptVersionEntity } = this.props;
    const promptVersions = [oldPromptVersionEntity, newPromptVersionEntity];
    return (
      <tbody className="scrollable-table">
        <tr className="table-row">
          <th scope="row" className="data-value block-content">
            <FormattedMessage
              defaultMessage="Created:"
              description="Text for creation time row header in the main table in the prompt comparison
                page"
            />
          </th>
          {promptVersions.map((promptVersion) => {
            /* Do not attempt to get timestamps for invalid run IDs */
            const startTime = Utils.formatTimestamp(promptVersion.creation_timestamp);
            return (
              <td className="meta-info block-content" key={promptVersion.version}>
                {startTime}
              </td>
            );
          })}
        </tr>
        <tr className="table-row">
          <th scope="row" className="data-value block-content">
            <FormattedMessage
              defaultMessage="Last Modified:"
              description="Text for last modified time row header in the main table in the prompt comparison
                page"
            />
          </th>
          {promptVersions.map((promptVersion) => {
            /* Do not attempt to get timestamps for invalid run IDs */
            const startTime = Utils.formatTimestamp(promptVersion.last_updated_timestamp);
            return (
              <td className="meta-info block-content" key={promptVersion.version}>
                {startTime}
              </td>
            );
          })}
        </tr>
      </tbody>
    );
  }

  // renderMetrics() {
  //   const { runInfos, metricLists } = this.props;
  //   const { metricActive, metricToggle } = this.state;
  //   const { chartIcon } = this.icons;
  //   const metricsHeaderMap = (key: any, data: any) => {
  //     return (
  //       <Link
  //         to={Routes.getMetricPageRoute(
  //           runInfos.map((info) => info.runUuid).filter((uuid, idx) => data[idx] !== undefined),
  //           key,
  //           // TODO: Refactor so that the breadcrumb
  //           // on the linked page is for model registry
  //           [runInfos[0].experimentId],
  //         )}
  //         target="_blank"
  //         title="Plot chart"
  //       >
  //         {key}
  //         {chartIcon}
  //       </Link>
  //     );
  //   };
  //   return (
  //     <tbody className="scrollable-table">
  //       {this.renderDataRows(
  //         metricLists,
  //         <FormattedMessage
  //           defaultMessage="Metrics"
  //           description="Field name text for metrics table in the model comparison page"
  //         />,
  //         metricActive,
  //         metricToggle,
  //         metricsHeaderMap,
  //         Utils.formatMetric,
  //       )}
  //     </tbody>
  //   );
  // }
}


const mapStateToProps = (state: any, ownProps: any) => {
  const { promptName, oldVersion, newVersion } = ownProps;
  const oldPromptVersionEntity = getModelVersion(state, promptName, oldVersion);
  const newPromptVersionEntity = getModelVersion(state, promptName, newVersion);
  return { promptName, oldVersion, newVersion, oldPromptVersionEntity, newPromptVersionEntity };
};

const DEFAULT_COLUMN_WIDTH = 200;

const styles = {
  wrapper: (numRuns: any) => ({
    '.compare-table': {
      // 1 extra unit for header column
      minWidth: (numRuns + 1) * DEFAULT_COLUMN_WIDTH,
    },
  }),
  compareModelVersionsView: {
    'button:focus': {
      outline: 'none',
      boxShadow: 'none',
    },
    'td.block-content th.block-content': {
      whiteSpace: 'nowrap',
      textOverflow: 'ellipsis',
      tableLayout: 'fixed',
      boxSizing: 'content-box',
    },
    'th.schema-table-header': {
      height: 28,
      padding: 0,
    },
    'tr.table-row': {
      display: 'table',
      width: '100%',
      tableLayout: 'fixed',
    },
    'tr.hidden-row': {
      display: 'none',
    },
    'tbody.scrollable-table': {
      width: '100%',
      display: 'block',
      border: 'none',
      maxHeight: 400,
      overflowY: 'auto',
    },
    'tbody.schema-scrollable-table': {
      maxHeight: 200,
    },
    '.switch-button-container': {
      display: 'flex',
      paddingTop: 16,
      paddingBottom: 16,
    },
    'button.schema-collapse-button': {
      textAlign: 'left',
      display: 'block',
      width: '100%',
      height: '100%',
      border: 'none',
    },
    '.collapse-button': {
      textAlign: 'left',
      display: 'flex',
      alignItems: 'center',
      border: 'none',
      backgroundColor: 'white',
      paddingLeft: 0,
    },
    '.cell-content': {
      maxWidth: '200px',
      minWidth: '100px',
    },
    '.padding-left-text': {
      paddingLeft: 8,
    },
    '.padding-right-text': {
      paddingRight: 16,
    },
    '.toggle-switch': {
      marginTop: 2,
    },
    '.header': {
      paddingLeft: 8,
      fontSize: 16,
    },
  },
};

export const ComparePromptVersionsView = connect(mapStateToProps)(ComparePromptVersionsViewImpl);
