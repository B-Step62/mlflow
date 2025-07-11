"""Entities for evaluation."""

import dataclasses
import hashlib
import json
from copy import deepcopy
from typing import Any, Callable, Dict, List, Optional, Union

import mlflow.entities as mlflow_entities

from mlflow.genai.evaluation import schemas
from mlflow.genai.utils import collection_utils
from mlflow.genai.utils.input_output_utils import is_none_or_nan, normalize_to_dictionary, parse_variant_data
from mlflow.genai.evaluation.schemas import INPUTS_COL, REQUEST_COL
from mlflow.genai.evaluation.trace_utils import deserialize_trace, get_root_span, serialize_trace

ChunkInputData = Union[str, Dict[str, Any]]
RetrievalContextInputData = List[Optional[ChunkInputData]]


_EXCLUDED_METRICS_FROM_LOGGING = [
    schemas.LATENCY_SECONDS_COL,
]

@dataclasses.dataclass
class Chunk:
    doc_uri: Optional[str] = None
    content: Optional[str] = None

    @classmethod
    def from_input_data(cls, input_data: Optional[ChunkInputData]) -> Optional["Chunk"]:
        """
        Construct a Chunk from a dictionary optionally containing doc_uri and content.

        An input chunk of a retrieval context can be:
          - A doc URI; or
          - A dictionary with the schema defined in schemas.CHUNK_SCHEMA
        """
        if is_none_or_nan(input_data):
            return None
        if isinstance(input_data, str):
            return cls(doc_uri=input_data)
        else:
            return cls(
                doc_uri=input_data.get(schemas.DOC_URI_COL),
                content=input_data.get(schemas.CHUNK_CONTENT_COL),
            )

    def to_dict(self):
        return {
            schemas.DOC_URI_COL: self.doc_uri,
            schemas.CHUNK_CONTENT_COL: self.content,
        }

    def to_mlflow_document(self) -> mlflow_entities.Document:
        return mlflow_entities.Document(
            page_content=self.content,
            metadata={
                "doc_uri": self.doc_uri,
            },
        )


@dataclasses.dataclass
class RetrievalContext:
    chunks: List[Optional[Chunk]]
    span_id: Optional[str] = None

    def concat_chunk_content(
        self, delimiter: str = "\n"
    ) -> Optional[str]:
        """
        Concatenate the non-empty content of the chunks to a string with the given delimiter.
        Return None if all the contents are empty.
        """
        non_empty_contents = [
            chunk.content
            for chunk in self.chunks
            if chunk is not None and chunk.content
        ]
        return delimiter.join(non_empty_contents) if non_empty_contents else None

    def get_doc_uris(self) -> List[Optional[str]]:
        """Get the list of doc URIs in the retrieval context."""
        return [chunk.doc_uri for chunk in self.chunks if chunk is not None]

    def to_output_dict(self) -> List[Dict[str, str]]:
        """Convert the RetrievalContext to a list of dictionaries with the schema defined in schemas.CHUNK_SCHEMA."""
        return [
            (
                {
                    schemas.DOC_URI_COL: chunk.doc_uri,
                    schemas.CHUNK_CONTENT_COL: chunk.content,
                }
                if chunk is not None
                else None
            )
            for chunk in self.chunks
        ]

    def to_mlflow_documents(self) -> List[mlflow_entities.Document]:
        return [
            chunk.to_mlflow_document() for chunk in self.chunks if chunk is not None
        ]

    @classmethod
    def from_input_data(
        cls, input_data: Optional[RetrievalContextInputData]
    ) -> Optional["RetrievalContext"]:
        """
        Construct a RetrievalContext from the input.

        Input can be:
        - A list of doc URIs
        - A list of dictionaries with the schema defined in schemas.CHUNK_SCHEMA
        """
        if is_none_or_nan(input_data):
            return None
        return cls(
            chunks=[Chunk.from_input_data(chunk_data) for chunk_data in input_data]
        )


@dataclasses.dataclass
class ToolCallInvocation:
    tool_name: str
    tool_call_args: Dict[str, Any]
    tool_call_id: Optional[str] = None
    tool_call_result: Optional[Dict[str, Any]] = None

    # Only available from the trace
    raw_span: Optional[mlflow_entities.Span] = None
    available_tools: Optional[List[Dict[str, Any]]] = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "tool_name": self.tool_name,
            "tool_call_args": self.tool_call_args,
            "tool_call_id": self.tool_call_id,
            "tool_call_result": self.tool_call_result,
            "raw_span": self.raw_span,
            "available_tools": self.available_tools,
        }

    @classmethod
    def _from_dict(cls, data: Dict[str, Any]) -> "ToolCallInvocation":
        return cls(
            tool_name=data["tool_name"],
            tool_call_args=data.get("tool_call_args", {}),
            tool_call_id=data.get("tool_call_id"),
            tool_call_result=data.get("tool_call_result"),
            raw_span=data.get("raw_span"),
            available_tools=data.get("available_tools"),
        )

    @classmethod
    def from_dict(
        cls, tool_calls: Optional[List[Dict[str, Any]] | Dict[str, Any]]
    ) -> Optional["ToolCallInvocation" | List["ToolCallInvocation"]]:
        if tool_calls is None:
            return None
        if isinstance(tool_calls, dict):
            return cls._from_dict(tool_calls)
        elif isinstance(tool_calls, list):
            return [cls._from_dict(tool_call) for tool_call in tool_calls]
        else:
            raise ValueError(
                f"Expected `tool_calls` to be a `dict` or `List[dict]`, but got: {type(tool_calls)}"
            )

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

    trace: Optional[mlflow_entities.Trace] = None
    """Trace of the model invocation."""

    retrieval_context: Optional[RetrievalContext] = None
    """Retrieval context that is used for evaluation."""

    tool_calls: Optional[List[ToolCallInvocation]] = None
    """List of tool call invocations from an agent."""

    model_error_message: Optional[str] = None
    """Error message if the model invocation fails."""

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "EvalItem":
        """
        Create an EvalItem from a row of MLflow EvaluationDataset data.
        """
        # Set the question/raw_request
        request = data.get(REQUEST_COL)
        # Get the raw request from "inputs" if "request" is not present.
        if not request:
            # Parse the "inputs" if it is a VariantVal.
            request = parse_variant_data(data.get(INPUTS_COL))
            if isinstance(request, str):
                try:
                    # Deseralize the "inputs" json string into dict[str, Any].
                    request: dict[str, Any] = json.loads(request)
                except Exception as e:
                    raise ValueError(
                        f"`{schemas.INPUTS_COL}` must be JSON serializable: {type(request)}"
                    ) from e

        # Set the question id
        question_id = data.get(schemas.REQUEST_ID_COL)
        if is_none_or_nan(question_id):
            question_id = hashlib.sha256(str(request).encode()).hexdigest()

        # Set the answer/raw_response
        response = data.get(schemas.RESPONSE_COL)
        # Get the raw response from "outputs" if "response" is not present.
        if not response:
            # Parse the "outputs" if it is a VariantVal.
            response = parse_variant_data(
                data.get(schemas.OUTPUTS_COL)
            )
            if isinstance(response, str):
                try:
                    # Deseralize the json string into dict[str, Any].
                    response: dict[str, Any] = json.loads(response)
                except Exception as e:
                    raise ValueError(
                        f"`{schemas.OUTPUTS_COL}` must be JSON serializable: {type(response)}"
                    ) from e

        trace = data.get(schemas.TRACE_COL)
        if is_none_or_nan(trace):
            trace = None
        else:
            trace = deserialize_trace(trace)

        trace_expectations = {}
        if trace:
            for assessment in trace.info.assessments or []:
                if assessment.expectation is not None:
                    trace_expectations[assessment.name] = assessment.expectation.value

        expectations = normalize_to_dictionary(
            deepcopy(data.get(schemas.EXPECTATIONS_COL))
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

    def as_dict(self) -> Dict[str, Any]:
        """
        Get as a dictionary. Keys are defined in schemas. Exclude None values.

        :param use_chat_completion_request_format: Whether to use the chat completion request format for the request.
        """
        inputs = {
            schemas.REQUEST_ID_COL: self.question_id,
            schemas.REQUEST_COL: self.request,
            schemas.RESPONSE_COL: self.response,
            schemas.TRACE_COL: serialize_trace(self.trace),
            schemas.EXPECTATIONS_COL: self.expectations,
            schemas.RETRIEVED_CONTEXT_COL: self.retrieval_context.to_output_dict() if self.retrieval_context else None,
            schemas.TOOL_CALLS_COL: self.tool_calls,
            schemas.MODEL_ERROR_MESSAGE_COL: self.model_error_message,
        }
        return collection_utils.drop_none_values(inputs)


@dataclasses.dataclass
class AssessmentSource:
    source_id: str

    @classmethod
    def builtin(cls) -> "AssessmentSource":
        return cls(
            source_id="databricks",
        )

    @classmethod
    def custom(cls) -> "AssessmentSource":
        return cls(
            source_id="custom",
        )


@dataclasses.dataclass(frozen=True, eq=True)
class MetricResult:
    """Holds the result of a metric."""

    metric_value: mlflow_entities.Assessment
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
            metric_value=mlflow_entities.Feedback(
                name=metric_name,
                source=mlflow_entities.AssessmentSource(
                    source_type=mlflow_entities.AssessmentSourceType.CODE,
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
    ) -> mlflow_entities.Assessment:
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
    def assessments(self) -> List[mlflow_entities.Assessment]:
        """Temporary shim to return assessments in the new format.

        At first, this method will translate the old assessments (V2) to the new format.

        Eventually we will switch over to directly producing mlflow_entities.Assessments,
        and when the switchover is complete, the self._assessments property will simply become
        self.assessments and this @property shim will be dropped.

        These assessments (V3) are destined to be logged to mlflow via log_feedback(), which will
        eventually replace the existing mechanism where assessmentsV2 are written to an
        _assessments.json file.
        """
        converted_metric_results: list[mlflow_entities.Assessment] = []
        converted_expectations: list[mlflow_entities.Assessment] = []

        trace_id = self.eval_item.trace.info.trace_id
        root_span = get_root_span(self.eval_item.trace)
        root_span_id = root_span.span_id if root_span is not None else None

        for metric in self.metric_results:
            if metric.metric_value.name in _EXCLUDED_METRICS_FROM_LOGGING:
                continue
            converted_metric_results.append(
                metric.to_mlflow_assessment(trace_id=trace_id, span_id=root_span_id)
            )


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
                mlflow_entities.Expectation(
                    trace_id=trace_id,
                    span_id=root_span_id,
                    name=expectation_name,
                    source=mlflow_entities.AssessmentSource(
                        source_type=mlflow_entities.AssessmentSourceType.HUMAN,
                        source_id=source_id or "unknown",
                    ),
                    value=processed_expectation_value,
                )
            )
        return converted_metric_results + converted_expectations


    def get_metrics_dict(self) -> Dict[str, Any]:
        """Get the metrics as a dictionary. Keys are defined in schemas."""
        metrics: Dict[str, Any] = {
            metric.metric_value.name: metric.metric_value.feedback.value
            for metric in self.metric_results
            if metric.legacy_metric
        }
        # Remove None values in metrics
        return collection_utils.drop_none_values(metrics)
