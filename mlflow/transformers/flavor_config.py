from __future__ import annotations

import functools
from typing import TYPE_CHECKING, Any, Dict, Optional

from mlflow.exceptions import MlflowException
from mlflow.protos.databricks_pb2 import RESOURCE_DOES_NOT_EXIST
from mlflow.transformers.torch_utils import _extract_torch_dtype_if_set

if TYPE_CHECKING:
    import transformers

# Flavor configuration keys
_TASK_KEY = "task"
_INSTANCE_TYPE_KEY = "instance_type"
_TORCH_DTYPE_KEY = "torch_dtype"
_FRAMEWORK_KEY = "framework"

_MODEL_KEY = "model"
_MODEL_TYPE_KEY = "pipeline_model_type"
_MODEL_BINARY_KEY = "model_binary"
_MODEL_PATH_OR_NAME_KEY = "source_model_name"
_MODEL_REVISION_KEY = "source_model_revision"

_COMPONENTS_KEY = "components"
_COMPONENT_NAME_KEY = "{component}_name"
_COMPONENT_REVISION_KEY = "{component}_revision"
_COMPONENT_TYPE_KEY = "{component}_type"
_TOKENIZER_KEY = "tokenizer"
_FEATURE_EXTRACTOR_KEY = "feature_extractor"
_IMAGE_PROCESSOR_KEY = "image_processor"
_PROCESSOR_KEY = "processor"
_PROCESSOR_TYPE_KEY = "processor_type"

_PROMPT_TEMPLATE_KEY = "prompt_template"


def build_flavor_config(
    pipeline: transformers.Pipeline,
    task: str,
    processor: Optional[transformers.PreTrainedModel] = None,
    save_locally=True,
) -> Dict[str, Any]:
    """
    Generate the flavor configuration for a given pipeline.

    Args:
        pipeline: The pipeline to generate the flavor configuration for.
        task: The task the pipeline is designed to perform.
    """
    flavor_conf = _generate_base_flavor_configuration(pipeline, task)
    _add_model_to_flavor_configuration(flavor_conf, pipeline, save_locally)
    components = _get_components_from_pipeline(pipeline)
    _add_component_to_flavor_configuration(flavor_conf, components, processor, save_locally)
    return flavor_conf


def _generate_base_flavor_configuration(pipeline, task: str) -> Dict[str, str]:
    """
    Generates the base flavor metadata needed for reconstructing a pipeline from saved
    components. This is important because the ``Pipeline`` class does not have a loader
    functionality. The serialization of a Pipeline saves the model, configurations, and
    metadata for ``FeatureExtractor``s, ``Processor``s, and ``Tokenizer``s exclusively.
    This function extracts key information from the submitted model object so that the precise
    instance types can be loaded correctly.
    """

    flavor_conf = {
        _TASK_KEY: task,
        _INSTANCE_TYPE_KEY: _get_instance_type(pipeline),
        _MODEL_TYPE_KEY: _get_instance_type(pipeline.model),
    }

    if framework := getattr(pipeline, _FRAMEWORK_KEY, None):
        flavor_conf[_FRAMEWORK_KEY] = framework

    # Extract a serialized representation of torch_dtype if provided
    if torch_dtype := _extract_torch_dtype_if_set(pipeline):
        # Convert the torch dtype and back to standardize the string representation
        flavor_conf[_TORCH_DTYPE_KEY] = str(torch_dtype)

    return flavor_conf


def _add_model_to_flavor_configuration(flavor_conf, pipeline, save_locally: bool = True):
    """
    Record Model information
    """
    flavor_conf[_MODEL_PATH_OR_NAME_KEY] = _get_base_model_architecture(pipeline)

    if save_locally:
        # log model path
        from mlflow.transformers.io import _MODEL_BINARY_FILE_NAME

        flavor_conf[_MODEL_BINARY_KEY] = _MODEL_BINARY_FILE_NAME
    else:
        # log commit hash in HuggingFace Hub instead
        flavor_conf[_MODEL_REVISION_KEY] = _get_latest_revision_for_repo(
            flavor_conf[_MODEL_PATH_OR_NAME_KEY]
        )


def _add_component_to_flavor_configuration(
    flavor_conf, components, processor=None, save_locally: bool = True
):
    # Record auxiliary components information
    for name, instance in components.items():
        flavor_conf[_COMPONENT_TYPE_KEY.format(component=name)] = _get_instance_type(instance)

        # Log source repo name and commit sha for the component
        if not save_locally and (repo_name := getattr(instance, "name_or_path", None)):
            revision = _get_latest_revision_for_repo(repo_name)
            flavor_conf[_COMPONENT_NAME_KEY.format(component=name)] = repo_name
            flavor_conf[_COMPONENT_REVISION_KEY.format(component=name)] = revision

    if components:
        flavor_conf[_COMPONENTS_KEY] = list(components.keys())

    if processor:
        flavor_conf[_PROCESSOR_TYPE_KEY] = _get_instance_type(processor)


def _get_instance_type(obj):
    """
    Utility for extracting the saved object type or, if the `base` argument is set to `True`,
    the base ABC type of the model.
    """
    return obj.__class__.__name__


def _get_components_from_pipeline(pipeline) -> Dict[str, Any]:
    supported_components = [_FEATURE_EXTRACTOR_KEY, _TOKENIZER_KEY, _IMAGE_PROCESSOR_KEY]
    return {
        name: getattr(pipeline, name) for name in supported_components if hasattr(pipeline, name)
    }


@functools.lru_cache(maxsize=1)
def _get_latest_revision_for_repo(repo_name: str) -> str:
    """
    Fetches the latest commit hash for a repository from the HuggingFace model hub.

    Args:
        repo_name: The name of the repository to fetch the latest commit hash for.

    Returns:
        The latest commit hash for the repository.
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
    api = hub.HfApi()
    model_info = api.model_info(repo_name)
    return model_info.sha


def _get_base_model_architecture(model_or_pipeline):
    """
    Extracts the base model architecture type from a submitted model.
    """
    from transformers import Pipeline

    if isinstance(model_or_pipeline, Pipeline):
        return model_or_pipeline.model.name_or_path
    else:
        return model_or_pipeline[_MODEL_KEY].name_or_path
