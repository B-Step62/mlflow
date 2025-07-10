import logging
from typing import Callable, Dict, List, Union

import numpy as np


from enum import Enum, EnumMeta
from typing import List

from mlflow.genai.evaluation.dataset import EvaluationDataframe


class MetaEnum(EnumMeta):
    """Metaclass for Enum classes that allows to check if a value is a valid member of the Enum."""

    def __contains__(cls, item):
        try:
            cls(item)
        except ValueError:
            return False
        return True


class StrEnum(str, Enum, metaclass=MetaEnum):
    def __str__(self):
        """Return the string representation of the enum using its value."""
        return self.value

    @classmethod
    def values(cls) -> List[str]:
        """Return a list of all string values of the Enum."""
        return [str(member) for member in cls]


_logger = logging.getLogger(__name__)

_AGGREGATION_TO_AGGREGATE_FUNCTION = {
    "min": np.min,
    "max": np.max,
    "mean": np.mean,
    "median": np.median,
    "variance": np.var,
    "p90": lambda x: np.percentile(x, 90) if x else None,
}


def get_aggregate_results(
    scores: List[float], aggregations: List[Union[str, Callable]]
) -> Dict[str, float]:
    """Compute aggregate statistics for a list of scores based on specified aggregations.

    Args:
        scores: List of numeric scores to aggregate
        aggregations: List of aggregation types to compute (e.g. ["min", "max", "mean"])

    Returns:
        Dictionary mapping aggregation names to computed values
    """
    scores_for_aggregation = [score for score in scores if score is not None]
    if not scores_for_aggregation:
        return {}

    results = {}
    for aggregation in aggregations:
        if isinstance(aggregation, str):
            if aggregation not in _AGGREGATION_TO_AGGREGATE_FUNCTION:
                raise ValueError(f"Invalid aggregation: {aggregation}")
            results[aggregation] = _AGGREGATION_TO_AGGREGATE_FUNCTION[aggregation](
                scores_for_aggregation
            )
        else:
            try:
                results[aggregation.__name__] = aggregation(scores_for_aggregation)
            except Exception as e:
                _logger.error(f"Error computing aggregation {aggregation} due to: {e}")
                continue

    return results



# TODO: Replace this with MlflowException
class ValidationError(Exception):
    """Error class for all user-facing validation errors."""
    pass



"""Helper functions to convert RagEval entities to MLflow entities."""

import time
from typing import List, Union

import numpy as np
import pandas as pd
from mlflow.entities import metric as mlflow_metric
from mlflow.models import evaluation as mlflow_models_evaluation
from mlflow.genai.evaluation import entities, schemas


class EvaluationErrorCode(StrEnum):
    MODEL_ERROR = "MODEL_ERROR"


def eval_result_to_mlflow_metrics(
    eval_result: entities.EvalResult,
) -> List[mlflow_metric.Metric]:
    """Get a list of MLflow Metric objects from an EvalResult object."""
    return [
        _construct_mlflow_metrics(
            key=k,
            value=v,
        )
        for k, v in eval_result.get_metrics_dict().items()
        # Do not log metrics with non-numeric-or-boolean values
        if isinstance(v, (int, float, bool))
    ]


def _construct_mlflow_metrics(
    key: str, value: Union[int, float, bool]
) -> mlflow_metric.Metric:
    """
    Construct an MLflow Metric object from key and value.
    Timestamp is the current time and step is 0.
    """
    return mlflow_metric.Metric(
        key=key,
        value=value,
        timestamp=int(time.time() * 1000),
        step=0,
    )


def _cast_to_pandas_dataframe(
    data: Union[pd.DataFrame, np.ndarray], flatten: bool = True
) -> pd.DataFrame:
    """
    Cast data to a pandas DataFrame. If already a pandas DataFrame, passes the data through.
    :param data: Data to cast to a pandas DataFrame
    :param flatten: Whether to flatten the data from 2d to 1d
    :return: A pandas DataFrame
    """
    if isinstance(data, pd.DataFrame):
        return data

    data = data.tolist()
    if flatten:
        data = [item for feature in data for item in feature]
    try:
        return pd.DataFrame(data)
    except Exception as e:
        raise ValidationError(
            f"Data must be a DataFrame or a list of dictionaries. Got: {type(data[0])}"
        ) from e


def _validate_mlflow_dataset(ds: mlflow_models_evaluation.EvaluationDataset):
    """Validates an MLflow evaluation dataset."""
    features_df = _cast_to_pandas_dataframe(ds.features_data)

    # Validate max number of rows in the eval dataset
    # TODO: Add back this env var in MLflow
    # if len(features_df) > env_vars.RAG_EVAL_MAX_INPUT_ROWS.get():
    #     raise error_utils.ValidationError(
    #         f"The number of rows in the dataset exceeds the maximum: {env_vars.RAG_EVAL_MAX_INPUT_ROWS.get()}. "
    #         f"Got {len(features_df)} rows." + error_utils.CONTACT_FOR_LIMIT_ERROR_SUFFIX
    #     )
    if ds.predictions_data is not None:
        # Predictions data is one-dimensional so it does not need to be flattened
        predictions_df = _cast_to_pandas_dataframe(ds.predictions_data, flatten=False)
        assert features_df.shape[0] == predictions_df.shape[0], (
            f"Features data and predictions must have the same number of rows. "
            f"Features: {features_df.shape[0]}, Predictions: {predictions_df.shape[0]}"
        )


def mlflow_dataset_to_evaluation_dataset(
    ds: mlflow_models_evaluation.EvaluationDataset,
) -> EvaluationDataframe:
    """Creates an instance of the class from an MLflow evaluation dataset and model predictions."""
    _validate_mlflow_dataset(ds)
    df = _cast_to_pandas_dataframe(ds.features_data).copy()
    if ds.predictions_data is not None:
        # Predictions data is one-dimensional so it does not need to be flattened
        df[schemas.RESPONSE_COL] = _cast_to_pandas_dataframe(
            ds.predictions_data, flatten=False
        )
    return EvaluationDataframe(df)



"""Helper functions for dealing with ratings."""

import re
from typing import Optional

MISSING_INPUTS_ERROR_CODE = 1001
INVALID_INPUT_ERROR_CODE = 1006
CONFLICTING_INPUTS_ERROR_CODE = 1010


def _extract_error_code(error_message: Optional[str]) -> Optional[str]:
    """
    Extract the error code from the error message.
    """
    if error_message is None:
        return None
    match = re.match(r"Error\[(\d+)]", error_message)
    return match.group(1) if match else None


def is_missing_input_error(error_message: Optional[str]) -> bool:
    """
    Check if the error message is due to missing input fields (Error[1001]).
    """
    return _extract_error_code(error_message) == str(MISSING_INPUTS_ERROR_CODE)


def has_conflicting_input_error(error_message: Optional[str]) -> bool:
    """
    Check if the error message is due to conflicting input fields (Error[1010]).
    """
    return _extract_error_code(error_message) == str(CONFLICTING_INPUTS_ERROR_CODE)


def normalize_error_message(error_message: str) -> str:
    """
    Normalize the error message by removing the Reference ID part.

    The Reference ID is a UUID generated for every Armeria service call. We assume any string
    after "Reference ID: " with the character set described in the regex below is a Reference ID.
    """
    return re.sub(r", Reference ID: [\w.,!?;:-]+", "", error_message)
