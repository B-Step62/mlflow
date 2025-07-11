
import json
from typing import Any

import pandas as pd


def parse_variant_data(data):
    """
    Helper to convert a VariantVal to a Python dictionary. If the data is not a VariantVal,
    it will be returned as is.
    """
    try:
        from pyspark.sql import types as T

        if isinstance(data, T.VariantVal):
            return data.toPython()
    except (AttributeError, ImportError):
        # `pyspark.sql.types.VariantVal` may not be available in all environments, so we catch
        # any exception related to the import of this type.
        pass
    return data


def is_none_or_nan(value: Any) -> bool:
    """Checks whether a value is None or NaN."""
    # isinstance(value, float) check is needed to ensure that pd.isna is not called on an array.
    return value is None or (isinstance(value, float) and pd.isna(value))


def normalize_to_dictionary(data: Any) -> dict[str, Any]:
    """Normalizes a data structure to a dictionary."""
    if is_none_or_nan(data):
        return {}
    elif isinstance(data, str):
        try:
            return json.loads(data)
        except:  # noqa: E722
            pass
    elif isinstance(data, dict):
        return data

    raise ValueError(
        f"Expected a dictionary or serialized JSON string, got {type(data)}"
    )
