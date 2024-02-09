import functools
import logging
import os

from mlflow.exceptions import MlflowException
from mlflow.protos.databricks_pb2 import RESOURCE_DOES_NOT_EXIST

_logger = logging.getLogger(__name__)


@functools.lru_cache(maxsize=1)
def get_latest_commit_for_repo(repo: str) -> str:
    """
    Fetches the latest commit hash for a repository from the HuggingFace model hub.
    """
    try:
        import huggingface_hub as hub
    except ImportError:
        raise MlflowException(
            "Unable to fetch model commit hash from the HuggingFace model hub. "
            "This is required for saving Transformer model without base model "
            "weights, while ensuring the version consistency of the model. "
            "Please install the `huggingface-hub` package and retry.",
            error_code=RESOURCE_DOES_NOT_EXIST,
        )
    return hub.HfApi().model_info(repo).sha


def is_valid_hf_repo_id(maybe_repo_id: str) -> bool:
    """
    Check if the given string is a valid HuggingFace repo identifier e.g. "username/repo_id".
    """

    if not maybe_repo_id or os.path.isdir(maybe_repo_id):
        return False

    try:
        from huggingface_hub.utils import HFValidationError, validate_repo_id
    except ImportError:
        _logger.warning(
            "The huggingface_hub library is not installed. "
            "Unable to validate the repository identifier."
        )
        return False

    try:
        validate_repo_id(maybe_repo_id)
        return True
    except HFValidationError as e:
        _logger.warning(f"The repository identified {maybe_repo_id} is invalid: {e}")
        return
