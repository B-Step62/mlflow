import json
from typing import Any, Dict, Iterator, List, Mapping, Sequence, TypeVar, Union

import numpy as np

def convert_ndarray_to_list(data):
    """
    Recursively converts all numpy.ndarray objects in a dictionary (or any nested structure)
    to Python lists.

    Args:
        data: The input data (dictionary, list, or any nested structure).

    Returns:
        A new data structure with numpy.ndarray objects converted to Python lists.
    """
    if isinstance(data, dict):
        return {key: convert_ndarray_to_list(value) for key, value in data.items()}
    elif isinstance(data, list):
        return [convert_ndarray_to_list(item) for item in data]
    elif isinstance(data, tuple):
        return tuple(convert_ndarray_to_list(item) for item in data)
    elif isinstance(data, np.ndarray):
        return data.tolist()
    else:
        return data