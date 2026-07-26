import { jest, describe, beforeEach, test, expect } from '@jest/globals';
import type { TableOptions } from '@tanstack/react-table';
import { render } from '@testing-library/react';
import { ExperimentEvaluationRunsTable } from './ExperimentEvaluationRunsTable';
import { IntlProvider } from 'react-intl';
import { DesignSystemProvider } from '@databricks/design-system';
import { ExperimentEvaluationRunsRowVisibilityProvider } from './hooks/useExperimentEvaluationRunsRowVisibility';
import { ExperimentEvaluationRunsPageMode } from './hooks/useExperimentEvaluationRunsPageMode';
import {
  EVAL_RUNS_TABLE_BASE_SELECTION_STATE,
  EvalRunsTableKeyedColumnPrefix,
} from './ExperimentEvaluationRunsTable.constants';
import {
  createEvalRunsTableKeyedColumnKey,
  isEvalRunsKeyedColumnSelectedByDefault,
} from './ExperimentEvaluationRunsTable.utils';

// Capture the columns passed to useReactTable
let capturedTableOptions: TableOptions<any> | undefined;

jest.mock('@databricks/web-shared/react-table', () => {
  const actual = jest.requireActual<typeof import('@databricks/web-shared/react-table')>(
    '@databricks/web-shared/react-table',
  );
  return {
    ...actual,
    useReactTable_unverifiedWithReact18: (_id: string, options: TableOptions<any>) => {
      capturedTableOptions = options;
      return actual.useReactTable_unverifiedWithReact18(_id, options);
    },
  };
});

describe('evaluation runs table default column selection', () => {
  test('hides noisy keyed columns by default while keeping them selectable', () => {
    expect(
      isEvalRunsKeyedColumnSelectedByDefault(
        createEvalRunsTableKeyedColumnKey(EvalRunsTableKeyedColumnPrefix.METRIC, 'rows'),
      ),
    ).toBe(false);
    expect(
      isEvalRunsKeyedColumnSelectedByDefault(
        createEvalRunsTableKeyedColumnKey(EvalRunsTableKeyedColumnPrefix.METRIC, 'trials'),
      ),
    ).toBe(false);
    expect(
      isEvalRunsKeyedColumnSelectedByDefault(
        createEvalRunsTableKeyedColumnKey(EvalRunsTableKeyedColumnPrefix.TAG, 'categories'),
      ),
    ).toBe(false);
    expect(
      isEvalRunsKeyedColumnSelectedByDefault(
        createEvalRunsTableKeyedColumnKey(EvalRunsTableKeyedColumnPrefix.TAG, 'model'),
      ),
    ).toBe(false);
    expect(
      isEvalRunsKeyedColumnSelectedByDefault(
        createEvalRunsTableKeyedColumnKey(EvalRunsTableKeyedColumnPrefix.METRIC, 'total_traces'),
      ),
    ).toBe(false);

    expect(
      isEvalRunsKeyedColumnSelectedByDefault(
        createEvalRunsTableKeyedColumnKey(EvalRunsTableKeyedColumnPrefix.METRIC, 'correctness_pass_rate'),
      ),
    ).toBe(true);
    expect(
      isEvalRunsKeyedColumnSelectedByDefault(
        createEvalRunsTableKeyedColumnKey(EvalRunsTableKeyedColumnPrefix.PARAM, 'temperature'),
      ),
    ).toBe(false);
  });
});

const metricColumn = createEvalRunsTableKeyedColumnKey(EvalRunsTableKeyedColumnPrefix.METRIC, 'accuracy');
const paramColumn = createEvalRunsTableKeyedColumnKey(EvalRunsTableKeyedColumnPrefix.PARAM, 'model');
const tagColumn = createEvalRunsTableKeyedColumnKey(EvalRunsTableKeyedColumnPrefix.TAG, 'team');

const renderTable = (data: any[] = [], selectedColumns = EVAL_RUNS_TABLE_BASE_SELECTION_STATE) =>
  render(
    <IntlProvider locale="en">
      <DesignSystemProvider>
        <ExperimentEvaluationRunsRowVisibilityProvider>
          <ExperimentEvaluationRunsTable
            data={data}
            uniqueColumns={[metricColumn, paramColumn, tagColumn]}
            selectedColumns={selectedColumns}
            setSelectedRunUuid={jest.fn()}
            isLoading={false}
            hasNextPage={false}
            rowSelection={{}}
            setRowSelection={jest.fn()}
            viewMode={ExperimentEvaluationRunsPageMode.TRACES}
          />
        </ExperimentEvaluationRunsRowVisibilityProvider>
      </DesignSystemProvider>
    </IntlProvider>,
  );

describe('ExperimentEvaluationRunsTable sorting', () => {
  beforeEach(() => {
    capturedTableOptions = undefined;
  });

  test('metric columns use basic (numeric) sorting, param and tag columns use alphanumeric sorting', () => {
    const selectedColumns = {
      ...EVAL_RUNS_TABLE_BASE_SELECTION_STATE,
      [metricColumn]: true,
      [paramColumn]: true,
      [tagColumn]: true,
    };

    renderTable([], selectedColumns);

    expect(capturedTableOptions).toBeDefined();
    const columns = capturedTableOptions!.columns;

    const metricCol = columns.find((c) => c.id === metricColumn);
    const paramCol = columns.find((c) => c.id === paramColumn);
    const tagCol = columns.find((c) => c.id === tagColumn);
    const runNameCol = columns.find((c) => c.id === 'run_name');

    expect(metricCol).toBeDefined();
    expect(paramCol).toBeDefined();
    expect(tagCol).toBeDefined();
    expect(runNameCol).toBeDefined();

    expect(metricCol!.sortingFn).toBe('basic');
    expect(paramCol!.sortingFn).toBe('alphanumeric');
    expect(tagCol!.sortingFn).toBe('alphanumeric');
    expect(
      (runNameCol as { meta?: { styles?: { minWidth?: number } } })!.meta?.styles?.minWidth,
    ).toBeGreaterThanOrEqual(240);
  });
});
