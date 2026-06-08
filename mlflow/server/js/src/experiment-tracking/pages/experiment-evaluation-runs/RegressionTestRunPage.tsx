/**
 * Per-run page for a regression-test session (a run tagged with
 * ``mlflow.runType=regression_test``, produced by an ``@mlflow.assertions``
 * pytest invocation).
 *
 * Renders the test cases table for the run, with a compare-to-run selector so
 * two regression-test runs can be diffed side by side.
 */
import { Typography, useDesignSystemTheme } from '@databricks/design-system';
import { FormattedMessage } from 'react-intl';
import { Link, useParams } from '../../../common/utils/RoutingUtils';
import Routes from '../../routes';
import { ExperimentPageTabName } from '../../constants';
import TestCasesTab from './regression-test-run/TestCasesTab';

const RegressionTestRunPage = () => {
  const { theme } = useDesignSystemTheme();
  const { experimentId, runUuid } = useParams<{ experimentId: string; runUuid: string }>();

  return (
    <div css={{ display: 'flex', flexDirection: 'column', padding: theme.spacing.lg, gap: theme.spacing.md }}>
      <div css={{ display: 'flex', alignItems: 'center', gap: theme.spacing.sm }}>
        <Link
          componentId="mlflow.regression-test-run.back-to-eval-runs"
          to={Routes.getExperimentPageTabRoute(experimentId ?? '', ExperimentPageTabName.EvaluationRuns)}
        >
          <FormattedMessage
            defaultMessage="← Back to Evaluation runs"
            description="Back link from the regression test run page to the evaluation runs list"
          />
        </Link>
      </div>
      <Typography.Title level={2}>
        <FormattedMessage
          defaultMessage="Regression test run"
          description="Heading for the regression-test run detail page"
        />
      </Typography.Title>
      <div css={{ marginTop: theme.spacing.md }}>
        <TestCasesTab experimentId={experimentId} runUuid={runUuid} />
      </div>
    </div>
  );
};

export default RegressionTestRunPage;
