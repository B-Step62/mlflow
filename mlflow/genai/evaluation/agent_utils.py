import logging
from typing import Callable, Dict, List, Union
import numpy as np

from mlflow.exceptions import MlflowException
from mlflow.genai.evaluation.dataset import EvaluationDataframe


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



"""Helper functions to convert RagEval entities to MLflow entities."""

import time
from typing import List, Union

import numpy as np
import pandas as pd
from mlflow.entities import metric as mlflow_metric
from mlflow.models import evaluation as mlflow_models_evaluation
from mlflow.genai.evaluation import entities, schemas



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
        raise MlflowException(
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
