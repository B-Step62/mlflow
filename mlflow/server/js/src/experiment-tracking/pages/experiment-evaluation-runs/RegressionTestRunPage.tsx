/**
 * Per-run page for a regression-test session (a run tagged with
 * ``mlflow.runType=regression_test``, produced by an ``@mlflow.assertions``
 * pytest invocation).
 *
 * Stage 2 UI shell: three top-level tabs (Test cases / History /
 * Configuration). Tab content is intentionally a stub - the table /
 * sparklines / config view are filled in by C3 / C4 / C5.
 */
import { Tabs, Typography, useDesignSystemTheme } from '@databricks/design-system';
import { useState } from 'react';
import { FormattedMessage, useIntl } from 'react-intl';
import { Link, useParams } from '../../../common/utils/RoutingUtils';
import Routes from '../../routes';
import { ExperimentPageTabName } from '../../constants';

const RegressionTestRunPage = () => {
  const { theme } = useDesignSystemTheme();
  const intl = useIntl();
  const { experimentId, runUuid } = useParams<{ experimentId: string; runUuid: string }>();
  const [activeTab, setActiveTab] = useState<string>('test-cases');

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
      <Typography.Text color="secondary">
        <FormattedMessage
          defaultMessage="Run {runUuid}"
          description="Subheading showing which run this regression-test page is for"
          values={{ runUuid: <code>{runUuid}</code> }}
        />
      </Typography.Text>

      <Tabs.Root
        componentId="mlflow.eval-runs.regression-test-run.tabs"
        value={activeTab}
        onValueChange={setActiveTab}
        css={{ marginTop: theme.spacing.md }}
      >
        <Tabs.List>
          <Tabs.Trigger value="test-cases">
            <FormattedMessage
              defaultMessage="Test cases"
              description="Tab label for the test cases view on the regression-test run page"
            />
          </Tabs.Trigger>
          <Tabs.Trigger value="history">
            <FormattedMessage
              defaultMessage="History"
              description="Tab label for the history view on the regression-test run page"
            />
          </Tabs.Trigger>
          <Tabs.Trigger value="configuration">
            <FormattedMessage
              defaultMessage="Configuration"
              description="Tab label for the configuration view on the regression-test run page"
            />
          </Tabs.Trigger>
        </Tabs.List>

        <Tabs.Content value="test-cases" css={{ paddingTop: theme.spacing.md }}>
          <Typography.Text color="secondary">
            {intl.formatMessage({
              defaultMessage: 'Test cases table will go here (C3).',
              description: 'Placeholder text for the empty Test cases tab on the regression-test run page',
            })}
          </Typography.Text>
        </Tabs.Content>

        <Tabs.Content value="history" css={{ paddingTop: theme.spacing.md }}>
          <Typography.Text color="secondary">
            {intl.formatMessage({
              defaultMessage: 'Per-test history sparklines and trend charts will go here (C5).',
              description: 'Placeholder text for the empty History tab on the regression-test run page',
            })}
          </Typography.Text>
        </Tabs.Content>

        <Tabs.Content value="configuration" css={{ paddingTop: theme.spacing.md }}>
          <Typography.Text color="secondary">
            {intl.formatMessage({
              defaultMessage:
                'Plugin version, test files collected, scorers in use, run environment will go here.',
              description: 'Placeholder text for the empty Configuration tab on the regression-test run page',
            })}
          </Typography.Text>
        </Tabs.Content>
      </Tabs.Root>
    </div>
  );
};

export default RegressionTestRunPage;
