import inspect
import logging
from typing import Any, Callable, Optional

from mlflow.exceptions import MlflowException
from mlflow.tracing.provider import trace_disabled

_logger = logging.getLogger(__name__)


def validate_inputs_is_dict(sample_input: Any):
    if not isinstance(sample_input, dict):
        # If the input value is string, use it in the code example
        sample_value = sample_input if isinstance(sample_input, str) else "What is MLflow?"
        input_example = {"query": sample_value}

        code_example = _construct_code_example(input_example=input_example)
        raise MlflowException.invalid_parameter_value(
            "The 'inputs' column must be a dictionary of field names and values."
            f"For example:\n{code_example}"
        )


def check_model_prediction(predict_fn: Callable, sample_input: Any) -> bool:
    """
    Validate if the predict function executes properly with the provided input.

    Args:
        predict_fn: The predict function to be evaluated.
        sample_input: A sample input to the model.
    """
    _logger.info("Testing model prediction with the first sample in the dataset.")

    # Wrap the function to add a decorator for disabling tracing
    @trace_disabled
    def _check():
        predict_fn(**sample_input)

    try:
        _check()
    except Exception as e:
        # Check input format and raise friendly message for typical error patterns
        _check_inputs_column_format_against_predict_fn(predict_fn, sample_input)
        _logger.debug(f"Failed to run predict_fn with input: {sample_input}", exc_info=e)


def _check_inputs_column_format_against_predict_fn(
    predict_fn: Callable, sample_input: dict[str, Any]
) -> Callable:
    """
    Validate the data format in the input column against the predict_fn.

    The input column must contain a dictionary of field names and values. When the
    predict_fn is provided, the field names must match the arguments of the predict_fn.
    """
    params = inspect.signature(predict_fn).parameters
    if not params:
        raise MlflowException.invalid_parameter_value(
            "`predict_fn` must accept at least one argument."
        )

    # Check if the predict_fn has dynamic positional arguments (e.g. *args)
    # MLflow doesn't support such function as predict_fn, so instruct users to wrap
    # it into another function with explicit keyword arguments.
    if _has_variable_positional_arguments(params):
        code_example = _construct_code_example(
            predict_wrapper_body=(
                "    # Invoke the original predict function with positional arguments\n"
                f"    return {predict_fn.__name__}(param1, param2)"
            ),
            predict_wrapper_params=["param1", "param2"],
            input_example={"param1": "value1", "param2": "value2"},
        )
        raise MlflowException.invalid_parameter_value(
            "The `predict_fn` has dynamic positional arguments (e.g. `*args`), "
            "so it cannot be used as a `predict_fn`. Please wrap it into another "
            "function that accepts explicit keyword arguments.\n"
            f"Example:\n\n{code_example}\n"
        )

    # If the predict_fn doesn't contain variable keyword arguments (**kwargs),
    # instruct users to match the input column with the predict_fn's arguments
    if not _has_required_keyword_arguments(params, sample_input.keys()):
        param_names = list(params.keys())
        input_example = {arg: f"value{i + 1}" for i, arg in enumerate(param_names[:3])}
        if len(param_names) > 3:
            input_example["..."] = "..."
        code_example = _construct_code_example(
            predict_fn_name=predict_fn.__name__,
            input_example=input_example,
        )
        raise MlflowException.invalid_parameter_value(
            "The `inputs` column must be a dictionary with the parameter names of "
            f"the `predict_fn` as keys. It seems the specified keys does not match "
            f"with the `predict_fn`'s arguments. Correct example:\n{code_example}"
        )

    # Otherwise show a generic error
    code_example = _construct_code_example(
        predict_wrapper_body=("    ..."),
        predict_wrapper_params=["question", "context"],
        input_example={"question": "What is MLflow?", "context": "MLflow is a platform for ..."},
    )
    raise MlflowException.invalid_parameter_value(
        "Failed to run the prediction function specified in the `predict_fn` "
        "parameter. Please make sure that the input dictionary contains the "
        "keys that match with the `predict_fn` parameters. Error: {e}\n\n"
        f"Correct example:\n{code_example}",
    )


def _has_variable_positional_arguments(params: inspect.Signature) -> bool:
    """Check if the function has variable positional arguments."""
    return any(p.kind == inspect.Parameter.VAR_POSITIONAL for p in params.values())


def _has_required_keyword_arguments(params: inspect.Signature, required_args: list[str]) -> bool:
    """Check if the function accepts the specified keyword arguments."""
    func_args = []

    for name, param in params.items():
        # If the function has **kwargs, it accepts all keyword arguments
        if param.kind == inspect.Parameter.VAR_KEYWORD:
            return True

        func_args.append(name)

    # Required argument must be a subset of the function's arguments
    return set(required_args) <= set(func_args)


def _construct_code_example(
    input_example: dict[str, str],
    predict_fn_name: Optional[str] = None,
    predict_wrapper_body: Optional[str] = None,
    predict_wrapper_params: Optional[list[str]] = None,
) -> str:
    """
    Construct a code example for the predict_fn.
    """
    code = ["```python"]

    if predict_wrapper_body:
        params = ", ".join(predict_wrapper_params)
        code.append(f"def predict_fn({params}):")
        code.append(predict_wrapper_body + "\n")

    code.append("data = [")
    code.append("    {")
    code.append('        "inputs": {')
    for k, v in input_example.items():
        code.append(f'            "{k}": "{v}",')
    code.append("        }")
    code.append("    }")
    code.append("]\n")

    if predict_wrapper_body:
        code.append("mlflow.genai.evaluate(predict_fn=predict_fn, data=data, ...)")
    elif predict_fn_name:
        code.append(f"mlflow.genai.evaluate(predict_fn={predict_fn_name}, data=data, ...)")
    else:
        code.append("mlflow.genai.evaluate(data=data, scorers=...)")

    code.append("```")
    return "\n".join(code)
