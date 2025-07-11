"""Entities for evaluation."""

import dataclasses
import hashlib
import json
from copy import deepcopy
from typing import Any, Callable, Dict, List, Optional, Union

from mlflow.entities.assessment import Assessment, Expectation, Feedback
from mlflow.entities.assessment_source import AssessmentSource, AssessmentSourceType
from mlflow.entities.trace import Trace
from mlflow.genai.utils.input_output_utils import is_none_or_nan, normalize_to_dictionary, parse_variant_data
from mlflow.genai.evaluation.constant import InputDatasetColumn

ChunkInputData = Union[str, Dict[str, Any]]
RetrievalContextInputData = List[Optional[ChunkInputData]]


@dataclasses.dataclass
class EvalItem:
    """
    Represents a row in the evaluation dataset. It contains information needed to evaluate a question.
    """
    question_id: str
    """Unique identifier for the eval item."""

    request: Any
    """Raw input to the agent when `evaluate` is called. Comes from "request" or "inputs" columns. """

    response: Any
    """Raw output from an agent."""

    expectations: Any
    """Raw expectations from the eval item."""

    trace: Optional[Trace] = None
    """Trace of the model invocation."""

    error_message: Optional[str] = None
    """Error message if the model invocation fails."""

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "EvalItem":
        """
        Create an EvalItem from a row of MLflow EvaluationDataset data.
        """
        # Set the question/raw_request
        request = data.get(InputDatasetColumn.REQUEST)
        # Get the raw request from "inputs" if "request" is not present.
        if not request:
            # Parse the "inputs" if it is a VariantVal.
            request = parse_variant_data(data.get(InputDatasetColumn.INPUTS))
            if isinstance(request, str):
                try:
                    # Deseralize the "inputs" json string into dict[str, Any].
                    request: dict[str, Any] = json.loads(request)
                except Exception as e:
                    raise ValueError(
                        f"`{InputDatasetColumn.INPUTS}` must be JSON serializable: {type(request)}"
                    ) from e

        # Set the question id
        question_id = data.get(InputDatasetColumn.REQUEST_ID)
        if is_none_or_nan(question_id):
            question_id = hashlib.sha256(str(request).encode()).hexdigest()

        # Set the answer/raw_response
        response = data.get(InputDatasetColumn.RESPONSE)
        # Get the raw response from "outputs" if "response" is not present.
        if not response:
            # Parse the "outputs" if it is a VariantVal.
            response = parse_variant_data(data.get(InputDatasetColumn.OUTPUTS))
            if isinstance(response, str):
                try:
                    # Deseralize the json string into dict[str, Any].
                    response: dict[str, Any] = json.loads(response)
                except Exception as e:
                    raise ValueError(
                        f"`{InputDatasetColumn.OUTPUTS}` must be JSON serializable: {type(response)}"
                    ) from e

        trace = data.get(InputDatasetColumn.TRACE)
        if is_none_or_nan(trace):
            trace = None
        else:
            trace = trace if isinstance(trace, Trace) else Trace.from_json(trace)

        trace_expectations = {}
        if trace:
            for assessment in trace.info.assessments or []:
                if assessment.expectation is not None:
                    trace_expectations[assessment.name] = assessment.expectation.value

        expectations = normalize_to_dictionary(
            deepcopy(data.get(InputDatasetColumn.EXPECTATIONS))
        )

        # Merge the trace expectations with the specified expectations. Expectations from the
        # expectations column take precedence. custom_expected and expectations are mutually
        # exclusive so order does not matter.
        expectations = {**trace_expectations, **expectations}

        return cls(
            question_id=question_id,
            request=request,
            response=response,
            expectations=expectations,
            trace=trace,
        )



@dataclasses.dataclass(frozen=True, eq=True)
class MetricResult:
    """Holds the result of a metric."""

    metric_value: Assessment
    legacy_metric: bool = False
    aggregations: Optional[List[Union[str, Callable]]] = None

    @staticmethod
    def make_legacy_metric(metric_name, metric_value, **kwargs):
        """
        Convenience constructor that also sets a legacy flag. "Legacy metric" implies a few things:
        1. When we log evaluations to mlflow using the old API, legacy metrics get logged under
           _metrics.json rather than _assessments.json
        2. They have some special handling for how their column names get generated in the results dataframe.
           Specifically, they get created without the /value, /rationale, /error suffixes.
        """
        return MetricResult(
            metric_value=Feedback(
                name=metric_name,
                source=AssessmentSource(
                    source_type=AssessmentSourceType.CODE,
                    source_id=metric_name,
                ),
                value=metric_value,
                **kwargs,
            ),
            legacy_metric=True,
        )

    def to_mlflow_assessment(
        self,
        assessment_name: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None,
        trace_id: Optional[str] = None,
        span_id: Optional[str] = None,
    ) -> Assessment:
        """
        Convert a MetricResult object to a MLflow Assessment object.

        This function is deprecated; eventually mlflow.log_feedback will directly accept
        mlflow_entities.Assessment objects for feedback and internalize all of the conversions here.

        :param assessment_name: The name of the assessment
        :param metadata: Additional metadata to add to the assessment
        :param trace_id: The trace ID of the trace associated if the trace ID is not already set
        :param span_id: The span ID of the span associated if the span ID is not already set
        :return: MLflow Assessment object
        """
        if trace_id is not None and self.metric_value.trace_id is None:
            self.metric_value.trace_id = trace_id
        if span_id is not None and self.metric_value.span_id is None:
            self.metric_value.span_id = span_id
        if assessment_name is not None:
            self.metric_value.name = assessment_name
        if metadata is not None:
            self.metric_value.metadata.update(metadata or {})
        return self.metric_value


@dataclasses.dataclass
class EvalResult:
    """Holds the result of the evaluation for an eval item."""

    eval_item: EvalItem
    metric_results: List[MetricResult] = dataclasses.field(default_factory=list)
    """A collection of MetricResult."""
    eval_error: Optional[str] = None
    """
    Error message encountered in processing the eval item.
    """

    def __eq__(self, other):
        if not isinstance(other, EvalResult):
            return False
        # noinspection PyTypeChecker
        return (
            self.eval_item == other.eval_item
            and sorted(self.metric_results, key=lambda m: m.metric_value.name)
            == sorted(other.metric_results, key=lambda m: m.metric_value.name)
            and self.eval_error == other.eval_error
        )

    @property
    def assessments(self) -> List[Assessment]:
        """Temporary shim to return assessments in the new format.

        At first, this method will translate the old assessments (V2) to the new format.

        Eventually we will switch over to directly producing mlflow_entities.Assessments,
        and when the switchover is complete, the self._assessments property will simply become
        self.assessments and this @property shim will be dropped.

        These assessments (V3) are destined to be logged to mlflow via log_feedback(), which will
        eventually replace the existing mechanism where assessmentsV2 are written to an
        _assessments.json file.
        """
        converted_metric_results: list[Assessment] = []
        converted_expectations: list[Assessment] = []

        trace_id = self.eval_item.trace.info.trace_id
        root_span = self.eval_item.trace.data.spans[0]
        root_span_id = root_span.span_id if root_span is not None else None

        for metric in self.metric_results:
            converted_metric_results.append(
                metric.to_mlflow_assessment(trace_id=trace_id, span_id=root_span_id)
            )


        # TODO: Simplify this logic
        def _expectation_obj_to_json_str(expectation_obj: Any) -> str:
            """Convert an arbitrary expectation object to a JSON string."""
            if isinstance(expectation_obj, str):
                return expectation_obj

            try:
                # Convert to JSON string with handling for nested objects
                return json.dumps(expectation_obj, default=lambda o: o.__dict__)
            except:  # noqa: E722
                return str(expectation_obj)

        expectations = self.eval_item.expectations
        for expectation_name, expectation_value in expectations.items():
            # ExpectationValue values can only hold primitives or a list of primitives. As such,
            # we need to convert objects such as retrieved documents to a JSON string.
            processed_expectation_value = expectation_value
            if isinstance(expectation_value, list) and not all(
                isinstance(value, str) for value in expectation_value
            ):
                processed_expectation_value = [
                    _expectation_obj_to_json_str(value)
                    for value in expectation_value
                    if value is not None
                ]
            elif isinstance(expectation_value, dict):
                processed_expectation_value = _expectation_obj_to_json_str(
                    expectation_value
                )

            # TODO: Revert this back to context.get_context().get_user_name()
            source_id = "unknown" # context.get_context().get_user_name()
            converted_expectations.append(
                Expectation(
                    trace_id=trace_id,
                    span_id=root_span_id,
                    name=expectation_name,
                    source=AssessmentSource(
                        source_type=AssessmentSourceType.HUMAN,
                        source_id=source_id or "unknown",
                    ),
                    value=processed_expectation_value,
                )
            )
        return converted_metric_results + converted_expectations
