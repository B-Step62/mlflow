import type { RunEntity } from '../../types';
import type { RunsGroupByConfig } from '../../components/experiment-page/utils/experimentPage.group-row-utils';
import type { RunGroupByGroupingValue } from '../../components/experiment-page/utils/experimentPage.row-types';
import { RunGroupingMode } from '../../components/experiment-page/utils/experimentPage.row-types';
import { EXPERIMENT_PARENT_ID_TAG } from '../../components/experiment-page/utils/experimentPage.common-utils';

export type ExperimentEvaluationRunsGroupData = {
  groupKey: string;
  groupValues: RunGroupByGroupingValue[];
  subRuns: RunEntity[];
};

export type ExperimentEvaluationRunsNestedRunData = RunEntity & {
  childRuns: ExperimentEvaluationRunsRunData[];
};

export type ExperimentEvaluationRunsRunData = RunEntity | ExperimentEvaluationRunsNestedRunData;

export type RunEntityOrGroupData = ExperimentEvaluationRunsRunData | ExperimentEvaluationRunsGroupData;

export const getEvaluationRunParentRunId = (run: RunEntity) =>
  run.data?.tags?.find((tag) => tag.key === EXPERIMENT_PARENT_ID_TAG)?.value;

const getEvaluationRunTrialIndex = (run: RunEntity) => {
  const trialTagValue = run.data?.tags?.find((tag) => tag.key === 'mlflow.issueCujDemo.trial')?.value;
  const trialTagNumber = Number(trialTagValue);
  if (Number.isFinite(trialTagNumber)) {
    return trialTagNumber;
  }

  const trialNameMatch = run.info.runName?.match(/^trial-(\d+)$/);
  const trialNameNumber = Number(trialNameMatch?.[1]);
  return Number.isFinite(trialNameNumber) ? trialNameNumber : undefined;
};

const sortNestedEvaluationRuns = (runs: RunEntity[]) =>
  [...runs].sort((runA, runB) => {
    const trialIndexA = getEvaluationRunTrialIndex(runA);
    const trialIndexB = getEvaluationRunTrialIndex(runB);

    if (trialIndexA !== undefined && trialIndexB !== undefined) {
      return trialIndexA - trialIndexB;
    }
    if (trialIndexA !== undefined) {
      return -1;
    }
    if (trialIndexB !== undefined) {
      return 1;
    }

    return Number(runB.info.startTime) - Number(runA.info.startTime);
  });

export const getNestedEvaluationRunsData = (runs: RunEntity[]): RunEntityOrGroupData[] => {
  const runsByUuid = new Map<string, RunEntity>();
  const dedupedRuns: RunEntity[] = [];

  for (const run of runs) {
    if (!runsByUuid.has(run.info.runUuid)) {
      runsByUuid.set(run.info.runUuid, run);
      dedupedRuns.push(run);
    }
  }

  const childRunsByParentRunId = new Map<string, RunEntity[]>();
  const childRunIds = new Set<string>();

  for (const run of dedupedRuns) {
    const parentRunId = getEvaluationRunParentRunId(run);
    if (!parentRunId || parentRunId === run.info.runUuid || !runsByUuid.has(parentRunId)) {
      continue;
    }

    childRunIds.add(run.info.runUuid);
    const childRuns = childRunsByParentRunId.get(parentRunId) ?? [];
    childRuns.push(run);
    childRunsByParentRunId.set(parentRunId, childRuns);
  }

  const buildNestedRun = (run: RunEntity): RunEntity | ExperimentEvaluationRunsNestedRunData => {
    const childRuns = childRunsByParentRunId.get(run.info.runUuid);
    if (!childRuns?.length) {
      return run;
    }

    return {
      ...run,
      childRuns: sortNestedEvaluationRuns(childRuns).map(buildNestedRun),
    };
  };

  return dedupedRuns.filter((run) => !childRunIds.has(run.info.runUuid)).map(buildNestedRun);
};

// string key for easy access in the map object
const createGroupKey = (groupData: RunGroupByGroupingValue) => {
  if (groupData.mode === RunGroupingMode.Dataset) {
    return `Dataset: ${groupData.value}`;
  } else {
    return `${groupData.groupByData} (${groupData.mode}): ${groupData.value}`;
  }
};

const getGroupValues = (run: RunEntity, groupBy: RunsGroupByConfig): RunGroupByGroupingValue[] => {
  const groupByKeys = groupBy.groupByKeys;

  const values: RunGroupByGroupingValue[] = [];

  for (const groupByKey of groupByKeys) {
    switch (groupByKey.mode) {
      case RunGroupingMode.Dataset:
        values.push({
          mode: RunGroupingMode.Dataset,
          groupByData: 'dataset',
          // in genai evaluate, it's not possible to have multiple dataset inputs,
          // so we can just use the first one. however, this logic will need
          // to be updated if we support multiple dataset inputs in the future
          value: run.inputs?.datasetInputs?.[0]?.dataset?.digest ?? null,
        });
        break;
      case RunGroupingMode.Param:
        const param = run.data?.params?.find((p) => p.key === groupByKey.groupByData);
        values.push({
          mode: RunGroupingMode.Param,
          groupByData: groupByKey.groupByData,
          value: param?.value ?? null,
        });
        break;
      case RunGroupingMode.Tag:
        const tag = run.data?.tags?.find((t) => t.key === groupByKey.groupByData);
        values.push({
          mode: RunGroupingMode.Tag,
          groupByData: groupByKey.groupByData,
          value: tag?.value ?? null,
        });
        break;
      default:
        break;
    }
  }

  return values;
};

export const getGroupByRunsData = (runs: RunEntity[], groupBy: RunsGroupByConfig | null): RunEntityOrGroupData[] => {
  if (!groupBy) {
    return runs;
  }

  const runGroupsMap: Record<
    string,
    {
      groupValues: RunGroupByGroupingValue[];
      subRuns: RunEntity[];
    }
  > = {};

  for (const run of runs) {
    const groupValues = getGroupValues(run, groupBy);
    const groupKey = groupValues.map(createGroupKey).join(', ');
    if (!runGroupsMap[groupKey]) {
      runGroupsMap[groupKey] = {
        groupValues,
        subRuns: [],
      };
    }
    runGroupsMap[groupKey].subRuns.push(run);
  }

  const runsWithGroupValues: RunEntityOrGroupData[] = [];
  Object.entries(runGroupsMap).forEach(([groupKey, { groupValues, subRuns }]) => {
    const groupHeadingRow: RunEntityOrGroupData = {
      groupKey,
      groupValues,
      subRuns,
    };
    runsWithGroupValues.push(groupHeadingRow);
  });

  return runsWithGroupValues;
};
