"""
This file contains logic to load/save Transformer models and pipelines locally or from Hugging Face Hub.
"""
from __future__ import annotations

import logging
from pathlib import Path
from typing import TYPE_CHECKING, Any, Dict, Optional

from mlflow.environment_variables import (
    MLFLOW_HUGGINGFACE_DISABLE_ACCELERATE_FEATURES,
    MLFLOW_HUGGINGFACE_MODEL_MAX_SHARD_SIZE,
)
from mlflow.exceptions import MlflowException
from mlflow.protos.databricks_pb2 import INVALID_PARAMETER_VALUE
from mlflow.transformers.flavor_config import (
    _COMPONENT_NAME_KEY,
    _COMPONENT_REVISION_KEY,
    _COMPONENT_TYPE_KEY,
    _COMPONENTS_KEY,
    _MODEL_BINARY_KEY,
    _MODEL_PATH_OR_NAME_KEY,
    _MODEL_REVISION_KEY,
    _MODEL_TYPE_KEY,
    _PROCESSOR_KEY,
    _PROCESSOR_TYPE_KEY,
)
from mlflow.transformers.torch_utils import _TORCH_DTYPE_KEY

if TYPE_CHECKING:
    import transformers

_logger = logging.getLogger(__name__)

# File/directory names for saved artifacts
_MODEL_BINARY_FILE_NAME = "model"
_COMPONENTS_BINARY_DIR_NAME = "components"
_PROCESSOR_BINARY_DIR_NAME = "processor"


def save_pipeline_local(
    path: Path,
    pipeline: transformers.Pipeline,
    flavor_config: Dict[str, Any],
    processor: Optional[transformers.PreTrainedModel] = None,
):
    """
    TBA
    """
    pipeline.model.save_pretrained(
        save_directory=path.joinpath(_MODEL_BINARY_FILE_NAME),
        max_shard_size=MLFLOW_HUGGINGFACE_MODEL_MAX_SHARD_SIZE.get(),
    )

    # Save the components explicitly to the components directory
    component_dir = path.joinpath(_COMPONENTS_BINARY_DIR_NAME)
    for component_key in flavor_config.get(_COMPONENTS_KEY, []):
        component = getattr(pipeline, component_key)
        component.save_pretrained(component_dir.joinpath(component_key))

    if processor:
        processor.save_pretrained(component_dir.joinpath(_PROCESSOR_BINARY_DIR_NAME))


def _load_model_and_components_from_huggingface_hub(
    flavor_config, device, accelerate_model_conf
) -> Dict[str, Any]:
    """
    TBA
    """
    loaded = {}

    if _MODEL_PATH_OR_NAME_KEY not in flavor_config:
        raise MlflowException(
            "The saved model doesn't contain either a model name in HuggingFace Hub or a local path to"
            "a model weight.",
            error_code=INVALID_PARAMETER_VALUE,
        )
    model_repo_name = flavor_config[_MODEL_PATH_OR_NAME_KEY]
    model_revision = flavor_config.get(_MODEL_REVISION_KEY, None)

    if not model_revision:
        _logger.warn(
            "It seems the specified model is saved with 'save_base_model_weight' set to False, but the model"
            "commit hash is not found in the saved configuration. MLflow will fallback to loading the latest"
            "available model from HuggingFace Hub, but it may cause inconsistency issue if the model is "
            "updated in HuggingFace Hub."
        )

    loaded["model"] = _try_load_model_with_device(
        model_repo_name, flavor_config, accelerate_model_conf, device, revision=model_revision
    )

    # Load auxiliary components
    for component_key in flavor_config.get(_COMPONENTS_KEY, []):
        loaded[component_key] = _load_component(flavor_config, component_key)

    if _PROCESSOR_TYPE_KEY in flavor_config:
        loaded[_PROCESSOR_KEY] = _load_component(flavor_config, _PROCESSOR_KEY)

    return loaded


def _load_model_and_components_from_local(
    local_path, flavor_config, device, accelerate_model_conf
) -> Dict[str, Any]:
    """
    TBA
    """
    loaded = {}

    # NB: Path resolution for models that were saved prior to 2.4.1 release when the pathing for
    #     the saved pipeline or component artifacts was handled by duplicate entries for components
    #     (artifacts/pipeline/* and artifacts/components/*) and pipelines were saved via the
    #     "artifacts/pipeline/*" path. In order to load the older formats after the change, the
    #     presence of the new path key is checked.
    model_path = local_path.joinpath(flavor_config.get(_MODEL_BINARY_KEY, "pipeline"))
    loaded["model"] = _try_load_model_with_device(
        model_path, flavor_config, accelerate_model_conf, device
    )

    # Load auxiliary components from local path
    for component_key in flavor_config.get(_COMPONENTS_KEY, []):
        loaded[component_key] = _load_component(flavor_config, component_key, local_path=model_path)

    return loaded


def _try_load_model_with_device(
    model_name_or_path, flavor_config, accelerate_model_conf, device, revision=None
):
    """
    Try to load a model with the specified device and fallback to loading without the device
    """
    import transformers

    model_instance = getattr(transformers, flavor_config[_MODEL_TYPE_KEY])

    if not MLFLOW_HUGGINGFACE_DISABLE_ACCELERATE_FEATURES.get():
        try:
            return model_instance.from_pretrained(
                model_name_or_path, **accelerate_model_conf, revision=revision
            )
        except (ValueError, TypeError, NotImplementedError, ImportError):
            # NB: ImportError is caught here in the event that `accelerate` is not installed
            # on the system, which will raise if `low_cpu_mem_usage` is set or the argument
            # `device_map` is set and accelerate is not installed.
            pass

    torch_dtype = accelerate_model_conf.get(_TORCH_DTYPE_KEY, None)
    try:
        return model_instance.from_pretrained(
            model_name_or_path, torch_dtype=torch_dtype, device=device, revision=revision
        )
    except OSError as e:
        if f"{revision} is not a valid git identifier" in str(e):
            raise MlflowException(
                f"The model was saved with a HuggingFace Hub repository name '{model_name_or_path}'"
                f"and a commit hash '{revision}', but the commit is not found in the repository. "
            )
        else:
            raise e
    except (ValueError, TypeError, NotImplementedError):
        _logger.warning("Could not specify device parameter for this pipeline type")
        return model_instance.from_pretrained(
            model_name_or_path, torch_dtype=torch_dtype, revision=revision
        )


def _load_component(flavor_config, component_key, local_path: Optional[Path] = None):
    import transformers

    component_type = flavor_config[_COMPONENT_TYPE_KEY.format(component=component_key)]
    component_cls = getattr(transformers, component_type)

    if local_path is not None:
        components_dir = local_path.joinpath(_COMPONENTS_BINARY_DIR_NAME)
        component_path = components_dir.joinpath(component_key)
        return component_cls.from_pretrained(component_path)
    else:
        # Load component from HuggingFace Hub
        component_name = flavor_config[_COMPONENT_NAME_KEY.format(component=component_key)]
        component_revision = flavor_config.get(
            _COMPONENT_REVISION_KEY.format(component=component_key), None
        )
        return component_cls.from_pretrained(component_name, revision=component_revision)
