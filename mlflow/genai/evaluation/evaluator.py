import warnings
from typing import Any, Dict, Optional

import mlflow
from mlflow.genai.evaluation.per_run_metrics import generate_per_run_metrics
from mlflow.models.evaluation import ModelEvaluator, EvaluationResult

from mlflow.genai.evaluation.context import eval_context
from mlflow.genai.evaluation.config import GlobalEvaluationConfig
from mlflow.genai.evaluation.agent_utils import ValidationError, mlflow_dataset_to_evaluation_dataset
from mlflow.genai.evaluation import harness




class GenAIEvaluator(ModelEvaluator):
    @classmethod
    def can_evaluate(cls, *, model_type, evaluator_config, **kwargs) -> bool:
        """
        See parent class docstring.
        """
        return model_type == 'databricks-agents'

    @eval_context
    def evaluate(
        self,
        *,
        model_type,
        dataset,
        run_id,
        evaluator_config: Optional[Dict[str, Any]] = None,
        model=None,
        custom_metrics=None,
        extra_metrics=None,
        custom_artifacts=None,
        baseline_model=None,
        predictions=None,
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
        try:
            if evaluator_config is None:
                evaluator_config = {}

            config = GlobalEvaluationConfig.from_mlflow_evaluate_args(
                evaluator_config, extra_metrics
            )

            eval_dataset = mlflow_dataset_to_evaluation_dataset(dataset)

            # # Set batch size to the context
            # session.current_session().set_session_batch_size(
            #     len(eval_dataset.eval_items)
            # )
            run_info = mlflow.get_run(run_id)
            experiment_id = run_info.info.experiment_id

            eval_results = harness.run(
                model=model,
                eval_dataset=eval_dataset,
                config=config,
                experiment_id=experiment_id,
                run_id=run_id,
            )

            mlflow_per_run_metrics = generate_per_run_metrics(
                eval_results, config=config
            )
            mlflow.log_metrics(mlflow_per_run_metrics)

            # Check for failed scorers and log a warning
            failed_scorers = set()
            for result in eval_results:
                for assessment in result.assessment_results:
                    if (
                        hasattr(assessment, "rating")
                        and assessment.rating.error_message is not None
                    ):
                        failed_scorers.add(assessment.assessment_name)
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
            return EvaluationResult(metrics=mlflow_per_run_metrics)

        except ValidationError as e:
            # Scrub trace for user-facing validation errors
            raise ValidationError(str(e)) from None