"""
This module contains helper functions for invoking the model to be evaluated.
"""
import uuid
from typing import Any, Callable

import mlflow
from mlflow.exceptions import MlflowException
from mlflow.genai.evaluation.entities import EvalItem
import mlflow.pyfunc.context as pyfunc_context


def invoke_predict_fn_and_set_result(predict_fn: Callable[..., Any], eval_item: EvalItem):
    """Invoke the model with a request and set the result and trace to the eval item."""
    # === Invoke the model and get the trace ===
    # Use a random UUID as the context ID to avoid conflicts with other evaluations on the same set of questions
    context_id = str(uuid.uuid4())
    with pyfunc_context.set_prediction_context(
        pyfunc_context.Context(context_id, is_evaluate=True)
    ):
        try:
            eval_item.response = predict_fn(eval_item.request)
        except Exception as e:
            eval_item.error_message = (
                f"Fail to invoke the model with {eval_item.request}. {e!r}"
            )

    # Get the generated trace from the MLflow trace server
    eval_item.trace = mlflow.get_trace(context_id)
    if eval_item.trace is None:
        raise MlflowException("Failed to get trace for the predict_fn invocation.")
