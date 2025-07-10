import abc
import logging
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import List, Optional
from mlflow.genai.evaluation.entities import AssessmentResult, EvalItem, MetricResult

_logger = logging.getLogger(__name__)


class Metric(abc.ABC):
    """
    Metric represents a method to compute a metric of an evaluation.
    """

    @abc.abstractmethod
    def run(
        self,
        *,
        eval_item: Optional[EvalItem] = None,
        assessment_results: Optional[List[AssessmentResult]] = None,
    ) -> List[MetricResult]:
        """
        Run the metric on a single eval item and produce a list of metric results.
        A single eval item can produce multiple metric results since multiple metrics can be batch computed
        together for a single EvalItem.

        :param eval_item: The eval item to assess.
        :param assessment_results: The assessment results for the eval item.
        :return: A list of metric results.
        """
        pass


def compute_eval_metrics(
    *,
    eval_item: EvalItem,
    assessment_results: List[AssessmentResult],
    metrics: List[Metric],
) -> List[MetricResult]:
    """
    Compute the per-eval-item metrics.
    """
    if not metrics:
        return []

    metric_results: List[MetricResult] = []
    #parent_session = session.current_session()

    def run_metric(metric):
        #session.set_session(parent_session)
        return metric.run(eval_item=eval_item, assessment_results=assessment_results)

    # Use a thread pool to run metrics in parallel
    # Use the number of metrics as the number of workers
    with ThreadPoolExecutor(max_workers=len(metrics)) as executor:
        futures = [executor.submit(run_metric, metric) for metric in metrics]

        try:
            for future in as_completed(futures):
                result = future.result()
                metric_results.extend(result)
        except KeyboardInterrupt:
            for future in futures:
                future.cancel()
            print("Metrics computation interrupted.")
            raise
    return metric_results