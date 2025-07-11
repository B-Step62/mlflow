"""Generate the metrics logged into MLflow."""

import collections
from dataclasses import dataclass
from typing import Callable, Dict, List, Union

from mlflow.genai.evaluation import entities
from mlflow.genai.evaluation.agent_utils import get_aggregate_results
from mlflow.genai.judges.databricks import CategoricalRating
from mlflow.genai.scorers.base import Scorer

RunMetrics = Dict[str, float]


@dataclass
class MetricAggregateData:
    """Data class to store aggregate information for a metric."""

    count: int
    aggregations: RunMetrics


def generate_per_run_metrics(
    eval_results: List[entities.EvalResult],
    custom_metrics: list[Scorer],
) -> RunMetrics:
    """
    Generates per-run MLflow metrics.

    :param eval_results: List of EvalResult objects
    :param config: Global evaluation config containing custom metric configurations
    :return: Dictionary of aggregated MLflow metrics
    """
    # Create mapping of metric function names to their aggregation configs from custom metrics
    # Add "mean" as default aggregation for all metrics
    metric_aggregations = {}
    for metric in custom_metrics or []:
        # Note the name here is not the full metric name, but the name of the custom metric function
        metric_aggregations[metric.name] = (
            ["mean"] if metric.aggregations is None else metric.aggregations
        )

    # Extract all aggregation metrics
    result = {}
    for metric_name, metric_data in compute_aggregate_metric_results(
        eval_results, metric_aggregations
    ).items():
        for agg_name, agg_value in metric_data.aggregations.items():
            result[f"{metric_name}/{agg_name}"] = agg_value

    return result


def compute_aggregate_metric_results(
    eval_results: List[entities.EvalResult],
    metric_aggregations: Dict[str, List[Union[str, Callable]]],
) -> Dict[str, MetricAggregateData]:
    """
    Compute aggregations for metrics with numeric, boolean, or pass-fail values.

    If the metric value is an Assessment object, the value of the Assessment is used.

    :param eval_results: List of EvalResult objects
    :param metric_aggregations: Dictionary mapping metric function names to their aggregation configurations
    :return: Dictionary mapping metric names to MetricAggregateData objects containing aggregations
    """
    metric_values: Dict[str, List[float]] = collections.defaultdict(list)
    metric_counts: Dict[str, int] = collections.defaultdict(int)

    # Collect values
    for eval_result in eval_results:
        for metric_result in eval_result.metric_results:
            metric_value = metric_result.metric_value.feedback.value
            metric_name = metric_result.metric_value.name

            if isinstance(metric_value, (int, float, bool)):
                float_value = float(metric_value)
                metric_values[metric_name].append(float_value)
                metric_counts[metric_name] += 1
            elif (
                isinstance(metric_value, str)
                and CategoricalRating(metric_value)
                != CategoricalRating.UNKNOWN
            ):
                float_value = float(metric_value == CategoricalRating.YES)
                metric_values[metric_name].append(float_value)
                metric_counts[metric_name] += 1

    # Compute aggregates
    result = {}
    for metric_name in metric_values:
        if metric_counts[metric_name] > 0:
            # Get the function name from the returned metric name. Otherwise, fall back to metric name
            metric_function_name = (
                metric_name.split("/")[1]
                if len(metric_name.split("/")) > 1
                else metric_name
            )
            # Get aggregations for this metric, defaulting to just ["mean"]
            aggregations = metric_aggregations.get(metric_function_name, ["mean"])
            result[metric_name] = MetricAggregateData(
                count=metric_counts[metric_name],
                aggregations=get_aggregate_results(
                    metric_values[metric_name], aggregations
                ),
            )

    return result
