"""Entry point to the evaluation harness"""

from __future__ import annotations

import dataclasses
import logging
import re
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from functools import partialmethod
from typing import Any, Callable, List, Optional, Tuple
import warnings

import pandas as pd
from tqdm.auto import tqdm

import mlflow
from mlflow.entities.assessment import Assessment
from mlflow.entities.trace import Trace
from mlflow.entities.trace_location import MlflowExperimentLocation
from mlflow.genai.evaluation.entities import EvalItem, EvalResult
from mlflow.genai.evaluation.metrics import compute_eval_scores
from mlflow.genai.evaluation.models import invoke_predict_fn_and_set_result
from mlflow.genai.scorers.aggregation import compute_aggregated_metrics
from mlflow.genai.scorers.base import Scorer
from mlflow.models.evaluation.base import EvaluationResult
import mlflow.tracing.constant as tracing_constant
from mlflow.genai.evaluation import context
from mlflow.tracing.utils.copy import copy_trace_to_experiment, create_minimal_trace


_logger = logging.getLogger(__name__)
_FAIL_TO_GET_TRACE_WARNING_MSG = re.compile(
    r"Failed to get trace from the tracking store"
)

EvalResults = List[EvalResult]


def _get_current_time() -> float:
    """
    Get the current time in seconds since the epoch.
    This method is extracted to make it easier to mock in tests.

    Returns:
        float: Current time in seconds since the epoch.
    """
    return time.perf_counter()


@context.eval_context
def run(
    *,
    dataset: pd.DataFrame,
    predict_fn=None,
    scorers=None,
    run_id,
):
    """
    Runs Databricks RAG evaluation on the provided dataset.

    The following arguments are supported:
    - model_type: Must be the same as evaluator_plugin.MODEL_TYPE
    - dataset
    - run_id

    For more details, see parent class docstring.
    """
    eval_items = [EvalItem.from_dict(row) for row in dataset.to_dict(orient="records")]

    eval_results = _run_prediction_and_scoring(
        predict_fn=predict_fn,
        eval_items=eval_items,
        scorers=scorers,
    )

    aggregated_metrics = compute_aggregated_metrics(eval_results, scorers=scorers)
    mlflow.log_metrics(aggregated_metrics)

    # Check for failed scorers and log a warning
    failed_scorers = set()
    for result in eval_results:
        for metric in result.metric_results:
            if metric.metric_value.error is not None:
                failed_scorers.add(metric.metric_value.name)

    if failed_scorers:
        failed_scorers_str = ", ".join(sorted(failed_scorers))
        warnings.warn(
            f"Some scorers failed during evaluation: {failed_scorers_str}. "
            f"Please check the evaluation result page for more details."
        )

    # _display_summary_and_usage_instructions(run_id)

    trace_df = mlflow.search_traces(run_id=run_id)
    return EvaluationResult(metrics=aggregated_metrics, artifacts=[trace_df])


def _run_prediction_and_scoring(
    *,
    eval_items: list[EvalItem],
    scorers: list[Scorer],
    predict_fn=None,
) -> EvalResults:
    """
    Run the logic of the eval harness.

    :param eval_dataset: The evaluation dataset
    :param config: The evaluation config
    :param experiment_id: The MLflow experiment ID to log the results to (used for logging traces)
    :param run_id: The MLflow run ID to log the results to (used for logging traces)
    :param model: Optional model to use for generating responses and traces
    :return: EvalResults
    """
    # Disable tqdm progress bar by default so that the progress bars inside MLflow eval_fn do not show
    tqdm.__init__ = partialmethod(tqdm.__init__, disable=True)

    ctx = context.get_context()
    # Ensure there's always a valid experiment ID. Note this internal method will fall back to the
    # default experiment ID if there is no current experiment. In Databricks, it's the
    # notebook-based experiment and in OSS it is `experiment_id=0`.
    experiment_id = ctx.get_mlflow_experiment_id()
    run_id = ctx.get_mlflow_run_id()

    eval_results = []
    with ThreadPoolExecutor(
        max_workers=10, #env_vars.RAG_EVAL_MAX_WORKERS.get()
    ) as executor:
        futures = [
            executor.submit(
                _run_single,
                eval_item=eval_item,
                scorers=scorers,
                predict_fn=predict_fn,
                experiment_id=experiment_id,
                run_id=run_id,
            )
            for eval_item in eval_items
        ]

        futures_as_completed = as_completed(futures)
        # Add a progress bar to show the progress of the assessments
        futures_as_completed = tqdm(
            futures_as_completed,
            total=len(futures),
            disable=False,
            desc="Evaluating",
            smoothing=0,  # 0 means using average speed for remaining time estimates
            bar_format="{l_bar}{bar}| {n_fmt}/{total_fmt} [Elapsed: {elapsed}, Remaining: {remaining}] {postfix}",
        )

        total_agent_time = 0.0
        total_metric_time = 0.0
        for future in futures_as_completed:
            eval_result, eval_times = future.result()
            eval_results.append(eval_result)
            if eval_times.agent_invocation_time is not None:
                total_agent_time += eval_times.agent_invocation_time
            if eval_times.metric_computation_time is not None:
                total_metric_time += eval_times.metric_computation_time

            if total_agent_time > 0 or total_metric_time > 0:
                agent_invocation_percentage = (
                    total_agent_time / (total_agent_time + total_metric_time)
                ) * 100
                metric_computation_percentage = 100 - agent_invocation_percentage
                futures_as_completed.set_postfix(
                    {
                        "Time breakdown": f"({agent_invocation_percentage:.2f}% predict_fn, {metric_computation_percentage:.2f}% scorers)"
                    }
                )

    return eval_results


@dataclasses.dataclass
class EvalTimes:
    """Dataclass to track timing information for evaluation runs.

    Attributes:
        agent_invocation_time: Time taken for agent invocation in seconds
        metric_computation_time: Time taken for metric computation in seconds
    """

    agent_invocation_time: Optional[float] = None
    metric_computation_time: Optional[float] = None


def _run_single(
    eval_item: EvalItem,
    scorers: list[Scorer],
    experiment_id: Optional[str],
    run_id: Optional[str],
    predict_fn: Optional[Callable[..., Any]] = None,
) -> Tuple[EvalResult, EvalTimes]:
    """
    Run the logic of the eval harness for a single eval item.

    :param eval_item: The eval item to evaluate
    :param config: The evaluation config
    :param model: Optional model to use for generating responses and traces
    :param mlflow_run_id: MLflow run ID to use for this evaluation
    :return: EvalResult, EvalTimes) where EvalTimes is a dataclass with agent_invocation_time and metric_computation_time
    """
    # Set the MLflow run ID in the context for this thread
    if run_id:
        # Manually set the mlflow_run_id for this context to be the same as was set in the parent thread.
        # This is required because MLflow runs are thread-local.
        ctx = context.get_context()
        ctx.set_mlflow_run_id(run_id)

    model_invocation_time = None
    if predict_fn:
        start_time = _get_current_time()
        invoke_predict_fn_and_set_result(predict_fn, eval_item)
        model_invocation_time = _get_current_time() - start_time
    elif eval_item.trace is not None:
        # Catch any issues with malformed traces
        try:
            if _should_clone_trace(eval_item.trace, experiment_id):
                cloned_trace_id = copy_trace_to_experiment(eval_item.trace.to_dict(), experiment_id)
                cloned_trace = mlflow.get_trace(cloned_trace_id)
                eval_item.trace = cloned_trace
            elif _should_link_trace_to_run(eval_item.trace, run_id):
                context.get_context().build_mlflow_client().link_traces_to_run(
                    run_id=run_id,
                    trace_ids=[eval_item.trace.info.trace_id],
                )
        except Exception as e:
            eval_item.error_message = str(e)
    else:
        minimal_trace = create_minimal_trace(eval_item.request, eval_item.response)
        eval_item.trace = minimal_trace

    # Skip the evaluation if invoking the model failed or there's a malformed trace
    if eval_item.error_message:
        eval_result = EvalResult(
            eval_item=eval_item,
            eval_error=eval_item.error_message,
        )
        metric_computation_time = 0.0
    else:
        start_time = _get_current_time()
        metric_results = compute_eval_scores(eval_item=eval_item, scorers=scorers)
        metric_computation_time = _get_current_time() - start_time
        eval_result = EvalResult(eval_item=eval_item, metric_results=metric_results)

    try:
        logged_trace = log_traces_and_assessments(
            experiment_id=experiment_id,
            run_id=run_id,
            trace=eval_item.trace,
            assessments=eval_result.assessments,
        )
        eval_result.eval_item.trace = logged_trace
    except Exception as e:
        # Failures in logging to MLflow should not fail the entire harness run
        _logger.warning(f"Failed to log trace and assessments to MLflow: {e}")

    return eval_result, EvalTimes(
        agent_invocation_time=model_invocation_time or 0.0,
        metric_computation_time=metric_computation_time,
    )


def _should_clone_trace(trace: Optional[Trace], experiment_id: str) -> bool:
    """
    Determine if we should clone the trace.

    :param trace: The trace to check
    :param experiment_id: The experiment ID to check against
    """
    if trace is None:
        return False

    # Check if the trace is from the same experiment. If it isn't, we need to clone the trace
    is_trace_from_same_exp = (
        trace.info.trace_location.mlflow_experiment.experiment_id == experiment_id
    )
    return not is_trace_from_same_exp


def _should_link_trace_to_run(trace: Optional[Trace], run_id: Optional[str]) -> bool:
    """
    Determine if we should link the trace to the run.

    :param trace: The trace to check
    :param run_id: The run ID to check against
    """
    if trace is None or run_id is None:
        return False

    # Do a best effort attempt to retrieve the run ID from the trace metadata
    trace_run_id = trace.info.trace_metadata.get(
        tracing_constant.TraceMetadataKey.SOURCE_RUN
    )
    # If the trace is from the same experiment but a different run, we need to
    # link the trace to the run.
    return trace_run_id is None or trace_run_id != run_id


def log_traces_and_assessments(
    experiment_id: Optional[str],
    run_id: Optional[str],
    trace: Trace,
    assessments: List[Assessment],
) -> Trace:
    """
    Log the trace and assessments to MLflow. We do this to ensure that MLFlow has a trace for every
    eval row, storing the computed assessments/metrics.

    A trace may have been generated and logged during model invocation, in which case we don't
    need to create a trace. However, if a trace was passed in as part of the eval row, we need to
    make a copy, because we don't know if the trace was used in a previous eval invocation. Without
    a copy, we could end up with multiple evaluation runs adding assessments to the same trace.
    """
    if not experiment_id:
        _logger.warning(
            "Failed to log trace and assessments to MLflow because experiment ID is not set"
        )
        return trace

    with mlflow.utils.logging_utils.suppress_logs(
        mlflow.tracing.fluent.__name__, _FAIL_TO_GET_TRACE_WARNING_MSG
    ):
        # Ensure that every trace is logged in MLflow, regardless of where it came from.
        # Specifically, if the trace is present in MLflow, do nothing. Otherwise, log the trace.
        if trace.info.trace_id is None or mlflow.get_trace(trace.info.trace_id) is None:
            trace.info.trace_location.mlflow_experiment = MlflowExperimentLocation(experiment_id)

            mlflow_client = mlflow.tracking.MlflowClient()
            try:
                stored_trace_id = mlflow_client._log_trace(trace)
                trace.info.trace_id = stored_trace_id
            except Exception as e:
                _logger.warning(f"Failed to log the trace: {e}")
                return trace

        # Create the assessments
        print(assessments, "assessments")
        for assessment in assessments:
            # Ensure that if we created a new trace, that the updated trace_id is reflected in
            # the assessments.
            assessment.trace_id = trace.info.trace_id
            if run_id is not None:
                assessment.metadata = (
                    {
                        **assessment.metadata,
                        tracing_constant.AssessmentMetadataKey.SOURCE_RUN_ID: run_id,
                    }
                    if assessment.metadata is not None
                    else {tracing_constant.AssessmentMetadataKey.SOURCE_RUN_ID: run_id}
                )
            _log_assessment_to_mlflow(assessment)

        # Get the trace to fetch newly created assessments.
        return mlflow.get_trace(trace.info.trace_id)


def _log_assessment_to_mlflow(
    assessment: Assessment,
) -> Optional[Assessment]:
    """
    Creates the given assessment in MLflow.
    """
    # Note that the `log_expectation` and `log_feedback` APIs expect the ID without the "0x" prefix.
    # However, the `encode_trace_id` utility adds the "0x" prefix so we add this check.
    span_id = assessment.span_id.removeprefix("0x")
    try:
        if assessment.expectation is not None:
            return mlflow.log_expectation(
                trace_id=assessment.trace_id,
                name=assessment.name,
                source=assessment.source,
                value=assessment.expectation.value,
                metadata=assessment.metadata,
                span_id=span_id,
            )
        else:
            if assessment.error is not None:
                error = assessment.error
                value = None
            else:
                error = None
                value = assessment.feedback.value

            return mlflow.log_feedback(
                trace_id=assessment.trace_id,
                name=assessment.name,
                source=assessment.source,
                error=error,
                value=value,
                rationale=assessment.rationale,
                metadata=assessment.metadata,
                span_id=span_id,
            )
    except Exception as e:
        _logger.warning(f"Failed to log the assessment: {e}")
        return