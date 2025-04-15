"""Tracing APIs that requires tracking server"""
from __future__ import annotations

import importlib
import logging
from typing import TYPE_CHECKING, Any, Literal, Optional, Union


from mlflow import MlflowClient
from mlflow.entities import Trace
from mlflow.entities.span import LiveSpan
from mlflow.entities.trace_status import TraceStatus
from mlflow.exceptions import MlflowException
from mlflow.store.tracking import SEARCH_TRACES_DEFAULT_MAX_RESULTS
from mlflow.tracing.core import provider
from mlflow.tracing.constant import (
    SpanAttributeKey,
)
from mlflow.tracing.core.api import (
    _EVAL_REQUEST_ID_TO_TRACE_ID,
    get_current_active_span,
)
from mlflow.tracing.core.provider import is_tracing_enabled
from mlflow.tracing.core.trace_manager import InMemoryTraceManager
from mlflow.tracing.utils import SPANS_COLUMN_NAME
from mlflow.tracing.utils.search import extract_span_inputs_outputs, traces_to_df
from mlflow.tracking.fluent import _get_experiment_id
from mlflow.utils import get_results_from_paginated_fn
from mlflow.utils.annotations import deprecated, experimental

_logger = logging.getLogger(__name__)

if TYPE_CHECKING:
    import pandas


def get_trace(request_id: str) -> Optional[Trace]:
    """
    Get a trace by the given request ID if it exists.

    This function retrieves the trace from the in-memory buffer first, and if it doesn't exist,
    it fetches the trace from the tracking store. If the trace is not found in the tracking store,
    it returns None.

    Args:
        request_id: The request ID of the trace.


    .. code-block:: python
        :test:

        import mlflow


        with mlflow.start_span(name="span") as span:
            span.set_attribute("key", "value")

        trace = mlflow.get_trace(span.request_id)
        print(trace)


    Returns:
        A :py:class:`mlflow.entities.Trace` objects with the given request ID.
    """
    # Special handling for evaluation request ID.
    request_id = _EVAL_REQUEST_ID_TO_TRACE_ID.get(request_id) or request_id

    try:
        return MlflowClient().get_trace(request_id, display=False)
    except MlflowException as e:
        _logger.warning(
            f"Failed to get trace from the tracking store: {e}"
            "For full traceback, set logging level to debug.",
            exc_info=_logger.isEnabledFor(logging.DEBUG),
        )
        return None


def search_traces(
    experiment_ids: Optional[list[str]] = None,
    filter_string: Optional[str] = None,
    max_results: Optional[int] = None,
    order_by: Optional[list[str]] = None,
    extract_fields: Optional[list[str]] = None,
    run_id: Optional[str] = None,
    return_type: Literal["pandas", "list"] = "pandas",
    model_id: Optional[str] = None,
    sql_warehouse_id: Optional[str] = None,
) -> Union["pandas.DataFrame", list[Trace]]:
    """
    Return traces that match the given list of search expressions within the experiments.

    .. note::

        If expected number of search results is large, consider using the
        `MlflowClient.search_traces` API directly to paginate through the results. This
        function returns all results in memory and may not be suitable for large result sets.

    Args:
        experiment_ids: List of experiment ids to scope the search. If not provided, the search
            will be performed across the current active experiment.
        filter_string: A search filter string.
        max_results: Maximum number of traces desired. If None, all traces matching the search
            expressions will be returned.
        order_by: List of order_by clauses.
        extract_fields: Specify fields to extract from traces using the format
            ``"span_name.[inputs|outputs].field_name"`` or ``"span_name.[inputs|outputs]"``.

            .. note::

                This parameter is only supported when the return type is set to "pandas".

            For instance, ``"predict.outputs.result"`` retrieves the output ``"result"`` field from
            a span named ``"predict"``, while ``"predict.outputs"`` fetches the entire outputs
            dictionary, including keys ``"result"`` and ``"explanation"``.

            By default, no fields are extracted into the DataFrame columns. When multiple
            fields are specified, each is extracted as its own column. If an invalid field
            string is provided, the function silently returns without adding that field's column.
            The supported fields are limited to ``"inputs"`` and ``"outputs"`` of spans. If the
            span name or field name contains a dot it must be enclosed in backticks. For example:

            .. code-block:: python

                # span name contains a dot
                extract_fields = ["`span.name`.inputs.field"]

                # field name contains a dot
                extract_fields = ["span.inputs.`field.name`"]

                # span name and field name contain a dot
                extract_fields = ["`span.name`.inputs.`field.name`"]

        run_id: A run id to scope the search. When a trace is created under an active run,
            it will be associated with the run and you can filter on the run id to retrieve the
            trace. See the example below for how to filter traces by run id.

        return_type: The type of the return value. The following return types are supported. Default
            is ``"pandas"``.

            - `"pandas"`: Returns a Pandas DataFrame containing information about traces
                where each row represents a single trace and each column represents a field of the
                trace e.g. request_id, spans, etc.
            - `"list"`: Returns a list of :py:class:`Trace <mlflow.entities.Trace>` objects.

        model_id: If specified, search traces associated with the given model ID.
        sql_warehouse_id: Only used in Databricks. The ID of the SQL warehouse to use for
            searching traces in inference tables.

    Returns:
        Traces that satisfy the search expressions. Either as a list of
        :py:class:`Trace <mlflow.entities.Trace>` objects or as a Pandas DataFrame,
        depending on the value of the `return_type` parameter.

    .. code-block:: python
        :test:
        :caption: Search traces with extract_fields

        import mlflow

        with mlflow.start_span(name="span1") as span:
            span.set_inputs({"a": 1, "b": 2})
            span.set_outputs({"c": 3, "d": 4})

        mlflow.search_traces(
            extract_fields=["span1.inputs", "span1.outputs", "span1.outputs.c"],
            return_type="pandas",
        )


    .. code-block:: python
        :test:
        :caption: Search traces with extract_fields and non-dictionary span inputs and outputs

        import mlflow

        with mlflow.start_span(name="non_dict_span") as span:
            span.set_inputs(["a", "b"])
            span.set_outputs([1, 2, 3])

        mlflow.search_traces(
            extract_fields=["non_dict_span.inputs", "non_dict_span.outputs"],
        )

    .. code-block:: python
        :test:
        :caption: Search traces by run ID and return as a list of Trace objects

        import mlflow


        @mlflow.trace
        def traced_func(x):
            return x + 1


        with mlflow.start_run() as run:
            traced_func(1)

        mlflow.search_traces(run_id=run.info.run_id, return_type="list")

    """
    if return_type not in ["pandas", "list"]:
        raise MlflowException.invalid_parameter_value(
            f"Invalid return type: {return_type}. Return type must be either 'pandas' or 'list'."
        )
    elif return_type == "list" and extract_fields:
        raise MlflowException.invalid_parameter_value(
            "The `extract_fields` parameter is only supported when return type is set to 'pandas'."
        )
    elif return_type == "pandas":
        # Check if pandas is installed early to avoid unnecessary computation
        if importlib.util.find_spec("pandas") is None:
            raise MlflowException(
                message=(
                    "The `pandas` library is not installed. Please install `pandas` to use"
                    " the `return_type='pandas'` option."
                ),
            )

    if not experiment_ids:
        if experiment_id := _get_experiment_id():
            experiment_ids = [experiment_id]
        else:
            raise MlflowException(
                "No active experiment found. Set an experiment using `mlflow.set_experiment`, "
                "or specify the list of experiment IDs in the `experiment_ids` parameter."
            )

    def pagination_wrapper_func(number_to_get, next_page_token):
        return MlflowClient().search_traces(
            experiment_ids=experiment_ids,
            run_id=run_id,
            max_results=number_to_get,
            filter_string=filter_string,
            order_by=order_by,
            page_token=next_page_token,
            model_id=model_id,
            sql_warehouse_id=sql_warehouse_id,
        )

    results = get_results_from_paginated_fn(
        pagination_wrapper_func,
        max_results_per_page=SEARCH_TRACES_DEFAULT_MAX_RESULTS,
        max_results=max_results,
    )

    if return_type == "pandas":
        results = traces_to_df(results)
        if extract_fields:
            results = extract_span_inputs_outputs(
                traces=results,
                fields=extract_fields,
                col_name=SPANS_COLUMN_NAME,
            )

    return results


@experimental
def log_trace(
    name: str = "Task",
    request: Optional[Any] = None,
    response: Optional[Any] = None,
    intermediate_outputs: Optional[dict[str, Any]] = None,
    attributes: Optional[dict[str, Any]] = None,
    tags: Optional[dict[str, str]] = None,
    start_time_ms: Optional[int] = None,
    execution_time_ms: Optional[int] = None,
) -> str:
    """
    Create a trace with a single root span.
    This API is useful when you want to log an arbitrary (request, response) pair
    without structured OpenTelemetry spans. The trace is linked to the active experiment.

    Args:
        name: The name of the trace (and the root span). Default to "Task".
        request: Input data for the entire trace. This is also set on the root span of the trace.
        response: Output data for the entire trace. This is also set on the root span of the trace.
        intermediate_outputs: A dictionary of intermediate outputs produced by the model or agent
            while handling the request. Keys are the names of the outputs,
            and values are the outputs themselves. Values must be JSON-serializable.
        attributes: A dictionary of attributes to set on the root span of the trace.
        tags: A dictionary of tags to set on the trace.
        start_time_ms: The start time of the trace in milliseconds since the UNIX epoch.
            When not specified, current time is used for start and end time of the trace.
        execution_time_ms: The execution time of the trace in milliseconds since the UNIX epoch.

    Returns:
        The request ID of the logged trace.

    Example:

    .. code-block:: python
        :test:

        import time
        import mlflow

        request_id = mlflow.log_trace(
            request="Does mlflow support tracing?",
            response="Yes",
            intermediate_outputs={
                "retrieved_documents": ["mlflow documentation"],
                "system_prompt": ["answer the question with yes or no"],
            },
            start_time_ms=int(time.time() * 1000),
            execution_time_ms=5129,
        )
        trace = mlflow.get_trace(request_id)

        print(trace.data.intermediate_outputs)
    """
    client = MlflowClient()
    if intermediate_outputs:
        if attributes:
            attributes.update(SpanAttributeKey.INTERMEDIATE_OUTPUTS, intermediate_outputs)
        else:
            attributes = {SpanAttributeKey.INTERMEDIATE_OUTPUTS: intermediate_outputs}

    span = client.start_trace(
        name=name,
        inputs=request,
        attributes=attributes,
        tags=tags,
        start_time_ns=start_time_ms * 1000000 if start_time_ms else None,
    )
    client.end_trace(
        request_id=span.request_id,
        outputs=response,
        end_time_ns=(start_time_ms + execution_time_ms) * 1000000
        if start_time_ms and execution_time_ms
        else None,
    )

    return span.request_id
