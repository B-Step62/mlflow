/**
 * Test cases tab for the regression-test run page (C3).
 *
 * Two sections:
 * 1. Per-assertion pass-rate bars, computed from the case-level results so
 *    a user can see at a glance which scorer is the weak link.
 * 2. A flat table of test cases (one row per case, including parametrized
 *    variants) with input/output previews, cost, latency, and an X/Y pass
 *    badge.
 *
 * Data is hardcoded (see ``mockData.ts``); a future checkpoint will
 * replace it with a real data hook keyed off ``mlflow.test.session_id``.
 */
import {
  Table,
  TableCell,
  TableHeader,
  TableRow,
  Tag,
  Typography,
  useDesignSystemTheme,
} from '@databricks/design-system';
import { FormattedMessage } from 'react-intl';
import { MOCK_TEST_CASES, summarizeAssertions } from './mockData';

const TestCasesTab = () => {
  const { theme } = useDesignSystemTheme();
  const cases = MOCK_TEST_CASES;
  const summary = summarizeAssertions(cases);

  return (
    <div css={{ display: 'flex', flexDirection: 'column', gap: theme.spacing.lg }}>
      <section>
        <Typography.Title level={4} css={{ marginBottom: theme.spacing.sm }}>
          <FormattedMessage
            defaultMessage="Per-assertion pass rate (this run)"
            description="Section heading for the per-scorer pass-rate breakdown on the regression-test run page"
          />
        </Typography.Title>
        <div css={{ display: 'flex', flexDirection: 'column', gap: theme.spacing.xs }}>
          {summary.map((row) => {
            const pct = row.total === 0 ? 0 : Math.round((row.passed / row.total) * 100);
            const passColor =
              pct === 100
                ? theme.colors.green600
                : pct >= 60
                  ? theme.colors.yellow600
                  : theme.colors.red600;
            return (
              <div
                key={row.scorer}
                css={{
                  display: 'grid',
                  gridTemplateColumns: '180px 1fr 100px',
                  gap: theme.spacing.sm,
                  alignItems: 'center',
                }}
              >
                <Typography.Text bold>{row.scorer}</Typography.Text>
                <div
                  css={{
                    height: 8,
                    borderRadius: 4,
                    backgroundColor: theme.colors.backgroundSecondary,
                    overflow: 'hidden',
                  }}
                >
                  <div
                    css={{
                      width: `${pct}%`,
                      height: '100%',
                      backgroundColor: passColor,
                      transition: 'width 0.3s ease',
                    }}
                  />
                </div>
                <Typography.Text color="secondary" css={{ whiteSpace: 'nowrap' }}>
                  {row.passed}/{row.total} ({pct}%)
                  {row.numericAverage !== undefined && (
                    <span css={{ marginLeft: theme.spacing.xs }}>· avg {row.numericAverage.toFixed(2)}</span>
                  )}
                </Typography.Text>
              </div>
            );
          })}
        </div>
      </section>

      <section>
        <Table>
          <TableRow isHeader>
            <TableHeader componentId="mlflow.regression-test-run.test-cases.col-test">
              <FormattedMessage defaultMessage="Test" description="Column header: test function name" />
            </TableHeader>
            <TableHeader componentId="mlflow.regression-test-run.test-cases.col-input">
              <FormattedMessage defaultMessage="Input" description="Column header: agent input preview" />
            </TableHeader>
            <TableHeader componentId="mlflow.regression-test-run.test-cases.col-output">
              <FormattedMessage defaultMessage="Output" description="Column header: agent output preview" />
            </TableHeader>
            <TableHeader componentId="mlflow.regression-test-run.test-cases.col-cost">
              <FormattedMessage defaultMessage="Cost" description="Column header: cost of the test in dollars" />
            </TableHeader>
            <TableHeader componentId="mlflow.regression-test-run.test-cases.col-latency">
              <FormattedMessage defaultMessage="Latency" description="Column header: test wall-time latency" />
            </TableHeader>
            <TableHeader componentId="mlflow.regression-test-run.test-cases.col-pass">
              <FormattedMessage defaultMessage="Pass" description="Column header: X/Y pass count" />
            </TableHeader>
          </TableRow>
          {cases.map((tc) => {
            const passed = tc.scorerResults.filter((r) => r.passed).length;
            const total = tc.scorerResults.length;
            const allPassed = passed === total;
            return (
              <TableRow key={tc.id}>
                <TableCell css={{ fontFamily: 'monospace' }}>{tc.name}</TableCell>
                <TableCell>
                  <Typography.Text
                    color="secondary"
                    css={{
                      display: '-webkit-box',
                      WebkitLineClamp: 1,
                      WebkitBoxOrient: 'vertical',
                      overflow: 'hidden',
                      maxWidth: 220,
                    }}
                  >
                    {tc.inputPreview}
                  </Typography.Text>
                </TableCell>
                <TableCell>
                  <Typography.Text
                    color="secondary"
                    css={{
                      display: '-webkit-box',
                      WebkitLineClamp: 1,
                      WebkitBoxOrient: 'vertical',
                      overflow: 'hidden',
                      maxWidth: 260,
                    }}
                  >
                    {tc.outputPreview}
                  </Typography.Text>
                </TableCell>
                <TableCell>${tc.cost.toFixed(3)}</TableCell>
                <TableCell>{tc.latencySeconds.toFixed(1)}s</TableCell>
                <TableCell>
                  <Tag
                    componentId="mlflow.regression-test-run.test-cases.pass-tag"
                    color={allPassed ? 'turquoise' : 'coral'}
                    css={{ margin: 0 }}
                  >
                    {passed}/{total}
                  </Tag>
                </TableCell>
              </TableRow>
            );
          })}
        </Table>
      </section>
    </div>
  );
};

export default TestCasesTab;
