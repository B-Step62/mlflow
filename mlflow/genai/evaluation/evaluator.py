import warnings
from typing import Any, Dict, Optional

import mlflow
from mlflow.genai.evaluation.per_run_metrics import generate_per_run_metrics
from mlflow.models.evaluation import ModelEvaluator, EvaluationResult

from mlflow.genai.evaluation.context import eval_context
from mlflow.genai.evaluation.agent_utils import mlflow_dataset_to_evaluation_dataset
from mlflow.genai.evaluation import harness




class GenAIEvaluator(ModelEvaluator):
    name = 'genai'

    @classmethod
    def can_evaluate(cls, *, model_type, **kwargs) -> bool:
        """
        See parent class docstring.
        """
        return model_type == 'genai'

    @eval_context
    def evaluate(
        self,
        *,
        dataset,
        run_id,
        model=None,
        extra_metrics=None,
        **kwargs,
    ):
        """
        Runs Databricks RAG evaluation on the provided dataset.

        The following arguments are supported:
        - model_type: Must be the same as evaluator_plugin.MODEL_TYPE
        - dataset
        - run_id

        For more details, see parent class docstring.
        """
        eval_dataset = mlflow_dataset_to_evaluation_dataset(dataset)
        eval_results = harness.run(
            model=model,
            eval_dataset=eval_dataset,
            scorers=extra_metrics,
        )

        mlflow_per_run_metrics = generate_per_run_metrics(
            eval_results, custom_metrics=extra_metrics
        )
        mlflow.log_metrics(mlflow_per_run_metrics)

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
        return EvaluationResult(metrics=mlflow_per_run_metrics, artifacts=[])
