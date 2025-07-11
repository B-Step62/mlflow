from concurrent.futures import ThreadPoolExecutor, as_completed
import traceback
from typing import Any, Collection
from mlflow.entities.assessment import DEFAULT_FEEDBACK_NAME, Assessment, Feedback
from mlflow.entities.assessment_error import AssessmentError
from mlflow.entities.assessment_source import AssessmentSource, AssessmentSourceType
from mlflow.exceptions import MlflowException
from mlflow.genai.evaluation.entities import EvalItem, MetricResult
from mlflow.genai.scorers.base import Scorer

USER_DEFINED_ASSESSMENT_NAME_KEY = "_user_defined_assessment_name"


def compute_eval_scores(
    *,
    eval_item: EvalItem,
    scorers: list[Scorer],
) -> list[MetricResult]:
    """
    Compute the per-eval-item scores.
    """
    if not scorers:
        return []

    metric_results: list[MetricResult] = []
    #parent_session = session.current_session()

    def run_scorer(scorer):
        #session.set_session(parent_session)
        try:
            value = scorer.run(
                inputs=eval_item.request,
                outputs=eval_item.response,
                expectations=eval_item.expectations,
                trace=eval_item.trace,
            )
            assessments = _convert_scorer_value(scorer.name, value)
            return [MetricResult(metric_value=assessment) for assessment in assessments]
        except Exception as e:
            error_assessment = Feedback(
                name=scorer.name,
                source=_make_code_type_assessment_source(scorer.name),
                error=AssessmentError(
                    error_code="CUSTOM_METRIC_ERROR",
                    error_message=str(e),
                    stack_trace=traceback.format_exc(),
                ),
            )
            return [MetricResult(metric_value=error_assessment)]

    # Use a thread pool to run metrics in parallel
    # Use the number of metrics as the number of workers
    with ThreadPoolExecutor(max_workers=len(scorers)) as executor:
        futures = [executor.submit(run_scorer, scorer) for scorer in scorers]

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



def _convert_scorer_value(scorer_name: str, value: Any) -> list[Feedback]:
    """
    Convert the custom metric value to a list of MLflow AssessmentV3 objects.
    Raise an error if the value is not valid.

    Supported metric values:
        - number
        - boolean
        - string
        - AssessmentV2 object
        - List[AssessmentV2]


    If you have a number, boolean, or string:
    @metric
    def custom_metric(request_id, request, response):
        return 0.5

    The assessment will be normalized to:
        mlflow_entities.Assessment(  # This is AssessmentV3
            name="custom_metric",
            source=assessment_source.AssessmentSource(
                source_type=assessment_source.AssessmentSourceType.CODE,
                source_id="custom_metric",
            ),
            feedback=FeedbackValue(value=0.5),
        )

    If you have an assessment or list of assessments:
    @metric
    def custom_metric(request_id, request, response):
        return mlflow.entities.Feedback(  # This is AssessmentV2
            name="custom_assessment",
            value=0.5,
        )

    The assessment will be normalized to:
        mlflow_entities.Assessment(  # This is AssessmentV3
            name="custom_custom_assessment",
            value=0.5,
            source=mlflow.entities.AssessmentSource(
                source_type=mlflow.entities.AssessmentSourceType.CODE,
                source_id="custom_metric",
            ),
        )
    """
    # None is a valid metric value, return an empty list
    if value is None:
        return []

    # Primitives are valid metric values
    if isinstance(value, (int, float, bool, str)):
        return [
            Feedback(
                name=scorer_name,
                source=_make_code_type_assessment_source(scorer_name),
                value=value,
            )
        ]


    if isinstance(value, Assessment):
        value.name = _get_custom_assessment_name(value, scorer_name)
        return [value]

    if isinstance(value, Collection):
        assessments = []
        for item in value:
            if isinstance(item, Assessment):
                item.name = _get_custom_assessment_name(item, scorer_name)
                assessments.append(item)
            else:
                raise MlflowException.invalid_parameter_value(
                    f"Got unsupported result from scorer '{scorer_name}'. "
                    f"Expected the metric value to be a number, or a boolean, or a string, or an Assessment, or a list of Assessments. "
                    f"Got {type(item)} in the list. Full list: {value}.",
                )
        return assessments

    raise MlflowException.invalid_parameter_value(
        f"Got unsupported result from scorer '{scorer_name}'. "
        f"Expected the metric value to be a number, or a boolean, or a string, or an Assessment, or a list of Assessments. "
        f"Got {value}.",
    )


# TODO: Simplify this
def _get_custom_assessment_name(
    assessment: Assessment, scorer_name: str
) -> str:
    """Get the name of the custom assessment. Use assessment name if present and not a builtin judge
    name, otherwise use the metric name.

    Args:
        assessment (mlflow_entities.Assessment): The assessment to get the name for.
        metric_name (str): The name of the metric.
    """
    # If the user didn't provide a name, use the metric name
    if assessment.name == DEFAULT_FEEDBACK_NAME:
        return scorer_name
    # If the assessment is from a callable builtin judge, use the metric name
    elif (
        assessment.metadata is not None
        and assessment.metadata.get(USER_DEFINED_ASSESSMENT_NAME_KEY)
        == "false"
    ):
        return scorer_name
    return assessment.name


def _make_code_type_assessment_source(scorer_name: str) -> AssessmentSource:
    return AssessmentSource(
        source_type=AssessmentSourceType.CODE,
        source_id=scorer_name,
    )
