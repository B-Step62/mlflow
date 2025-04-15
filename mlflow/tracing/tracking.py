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
from mlflow.utils.annotations import experimental

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


def get_last_active_trace(thread_local=False) -> Optional[Trace]:
    """
    Get the last active trace in the same process if exists.

    .. warning::

        This function DOES NOT work in the model deployed in Databricks model serving.

    .. warning::

        This function is not thread-safe by default, returns the last active trace in
        the same process. If you want to get the last active trace in the current thread,
        set the `thread_local` parameter to True.

    .. note::

        This function returns an immutable copy of the original trace that is logged
        in the tracking store. Any changes made to the returned object will not be reflected
        in the original trace. To modify the already ended trace (while most of the data is
        immutable after the trace is ended, you can still edit some fields such as `tags`),
        please use the respective MlflowClient APIs with the request ID of the trace, as
        shown in the example below.

    Args:

        thread_local: If True, returns the last active trace in the current thread. Otherwise,
            returns the last active trace in the same process. Default is False.

    .. code-block:: python
        :test:

        import mlflow


        @mlflow.trace
        def f():
            pass


        f()

        trace = mlflow.get_last_active_trace()


        # Use MlflowClient APIs to mutate the ended trace
        mlflow.MlflowClient().set_trace_tag(trace.info.request_id, "key", "value")

    Returns:
        The last active trace if exists, otherwise None.
    """
    trace_id = (
        _LAST_ACTIVE_TRACE_ID_THREAD_LOCAL.get() if thread_local else _LAST_ACTIVE_TRACE_ID_GLOBAL
    )
    if trace_id is not None:
        try:
            return MlflowClient().get_trace(trace_id, display=False)
        except:
            _logger.debug(
                f"Failed to get the last active trace with request ID {trace_id}.",
                exc_info=True,
            )
            raise
    else:
        return None


def _set_last_active_trace_id(trace_id: str):
    """Internal function to set the last active trace ID."""
    global _LAST_ACTIVE_TRACE_ID_GLOBAL
    _LAST_ACTIVE_TRACE_ID_GLOBAL = trace_id
    _LAST_ACTIVE_TRACE_ID_THREAD_LOCAL.set(trace_id)


@experimental
def add_trace(trace: Union[Trace, dict[str, Any]], target: Optional[LiveSpan] = None):
    """
    Add a completed trace object into another trace.

    This is particularly useful when you call a remote service instrumented by
    MLflow Tracing. By using this function, you can merge the trace from the remote
    service into the current active local trace, so that you can see the full
    trace including what happens inside the remote service call.

    The following example demonstrates how to use this function to merge a trace from a remote
    service to the current active trace in the function.

    .. code-block:: python

        @mlflow.trace(name="predict")
        def predict(input):
            # Call a remote service that returns a trace in the response
            resp = requests.get("https://your-service-endpoint", ...)

            # Extract the trace from the response
            trace_json = resp.json().get("trace")

            # Use the remote trace as a part of the current active trace.
            # It will be merged under the span "predict" and exported together when it is ended.
            mlflow.add_trace(trace_json)

    If you have a specific target span to merge the trace under, you can pass the target span

    .. code-block:: python

        def predict(input):
            # Create a local span
            span = MlflowClient().start_span(name="predict")

            resp = requests.get("https://your-service-endpoint", ...)
            trace_json = resp.json().get("trace")

            # Merge the remote trace under the span created above
            mlflow.add_trace(trace_json, target=span)

    Args:
        trace: A :py:class:`Trace <mlflow.entities.Trace>` object or a dictionary representation
            of the trace. The trace **must** be already completed i.e. no further updates should
            be made to it. Otherwise, this function will raise an exception.

            .. attention:

                The spans in the trace must be ordered in a way that the parent span comes
                before its children. If the spans are not ordered correctly, this function
                will raise an exception.

        target: The target span to merge the given trace.

            - If provided, the trace will be merged under the target span.
            - If not provided, the trace will be merged under the current active span.
            - If not provided and there is no active span, a new span named "Remote Trace <...>"
              will be created and the trace will be merged under it.
    """
    if not is_tracing_enabled():
        _logger.debug("Tracing is disabled. Skipping add_trace.")
        return

    if isinstance(trace, dict):
        try:
            trace = Trace.from_dict(trace)
        except Exception as e:
            raise MlflowException.invalid_parameter_value(
                "Failed to load a trace object from the given dictionary. Please ensure the "
                f"dictionary is in the correct MLflow Trace format. Error: {e}",
            )
    elif not isinstance(trace, Trace):
        raise MlflowException.invalid_parameter_value(
            f"Invalid trace object: {type(trace)}. Please provide a valid MLflow Trace object "
            "to use it as a remote trace. You can create a Trace object from its json format by "
            "using the Trace.from_dict() method."
        )

    if trace.info.status not in TraceStatus.end_statuses():
        raise MlflowException.invalid_parameter_value(
            "The trace must be ended before adding it to another trace. "
            f"Current status: {trace.info.status}.",
        )

    if target_span := target or get_current_active_span():
        _merge_trace(
            trace=trace,
            target_request_id=target_span.request_id,
            target_parent_span_id=target_span.span_id,
        )
    else:
        # If there is no target span, create a new root span named "Remote Trace <...>"
        # and put the remote trace under it. This design aims to keep the trace export
        # logic simpler and consistent, rather than directly exporting the remote trace.
        client = MlflowClient()
        remote_root_span = trace.data.spans[0]
        span = client.start_trace(
            name=f"Remote Trace <{remote_root_span.name}>",
            inputs=remote_root_span.inputs,
            attributes={
                # Exclude request ID attribute not to reuse same request ID
                k: v
                for k, v in remote_root_span.attributes.items()
                if k != SpanAttributeKey.REQUEST_ID
            },
            start_time_ns=remote_root_span.start_time_ns,
        )
        _merge_trace(
            trace=trace,
            target_request_id=span.request_id,
            target_parent_span_id=span.span_id,
        )
        client.end_trace(
            request_id=span.request_id,
            status=trace.info.status,
            outputs=remote_root_span.outputs,
            end_time_ns=remote_root_span.end_time_ns,
        )


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


def _merge_trace(
    trace: Trace,
    target_request_id: str,
    target_parent_span_id: str,
):
    """
    Merge the given trace object under an existing trace in the in-memory trace registry.

    Args:
        trace: The trace object to be merged.
        target_request_id: The request ID of the parent trace.
        target_parent_span_id: The parent span ID, under which the child trace should be merged.
    """
    trace_manager = InMemoryTraceManager.get_instance()

    # The merged trace should have the same trace ID as the parent trace.
    with trace_manager.get_trace(target_request_id) as parent_trace:
        if not parent_trace:
            _logger.warning(
                f"Parent trace with request ID {target_request_id} not found. Skipping merge."
            )
            return

        new_trace_id = parent_trace.span_dict[target_parent_span_id]._trace_id

    for span in trace.data.spans:
        parent_span_id = span.parent_id or target_parent_span_id

        # NB: We clone span one by one in the order it was saved in the original trace. This
        # works upon the assumption that the parent span always comes before its children.
        # This is guaranteed in current implementation, but if it changes in the future,
        # we have to traverse the tree to determine the order.
        if not trace_manager.get_span_from_id(target_request_id, parent_span_id):
            raise MlflowException.invalid_parameter_value(
                f"Span with ID {parent_span_id} not found. Please make sure the "
                "spans in the trace are ordered correctly i.e. the parent span comes before "
                "its children."
            )

        cloned_span = LiveSpan.from_immutable_span(
            span=span,
            parent_span_id=parent_span_id,
            request_id=target_request_id,
            trace_id=new_trace_id,
        )
        trace_manager.register_span(cloned_span)

    # Merge the tags and metadata from the child trace to the parent trace.
    with trace_manager.get_trace(target_request_id) as parent_trace:
        # Order of merging is important to ensure the parent trace's metadata is
        # not overwritten by the child trace's metadata if they have the same key.
        parent_trace.info.tags = {**trace.info.tags, **parent_trace.info.tags}
        parent_trace.info.request_metadata = {
            **trace.info.request_metadata,
            **parent_trace.info.request_metadata,
        }
