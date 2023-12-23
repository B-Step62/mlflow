import json
import logging
import os
import requests
from tempfile import TemporaryDirectory

from mlflow.models import FlavorBackend
from mlflow.models.docker_utils_optimized import (
    _build_image,
)
from mlflow.models.docker_utils import (
    remove_image,
    run_container,
    stop_container,
)
from mlflow.tracking.artifact_utils import _download_artifact_from_uri
from mlflow.version import VERSION


_logger = logging.getLogger(__name__)


class PyFuncOptimizedBackend(FlavorBackend):
    """
    Optimized version of PyFuncBackend.
    """

    def __init__(
        self,
        config,
        install_mlflow=False,
        **kwargs,
    ):
        """
        :param env_root_dir: Root path for conda env. If None, use Conda's default environments
                             directory. Note if this is set, conda package cache path becomes
                             "{env_root_dir}/conda_cache_pkgs" instead of the global package cache
                             path, and pip package cache path becomes
                             "{env_root_dir}/pip_cache_pkgs" instead of the global package cache
                             path.
        """
        super().__init__(config=config, **kwargs)
        self._install_mlflow = install_mlflow
        self._env_id = os.environ.get("MLFLOW_HOME", VERSION) if install_mlflow else None


    def prepare_env(self, *args):
        raise NotImplementedError("Optimized version of PyFuncBackend does not support this method."
                                  "Please run the command without --optimized flag.")

    def predict(self, *args):
        """
        Generate predictions using generic python model saved with MLflow. The expected format of
        the input JSON is the MLflow scoring format.
        Return the prediction results as a JSON.
        """
        raise NotImplementedError("Optimized version of PyFuncBackend does not support this method."
                                  "Please run the command without --optimized flag.")

    def serve(self, *args):
        """
        Serve pyfunc model locally.
        """
        raise NotImplementedError("Optimized version of PyFuncBackend does not support this method."
                                  "Please run the command without --optimized flag.")

    def serve_stdin(self, *args):
        raise NotImplementedError("Optimized version of PyFuncBackend does not support this method."
                                  "Please run the command without --optimized flag.")

    def can_score_model(self, *args):
        raise NotImplementedError("Optimized version of PyFuncBackend does not support this method."
                                  "Please run the command without --optimized flag.")


    def generate_dockerfile(self, *args):
        raise NotImplementedError("Optimized version of PyFuncBackend does not support this method."
                                  "Please run the command without --optimized flag.")



    def build_image(
        self,
        model_uri,
        image_name,
        mlflow_home=None,
        enable_mlserver=False,
    ):
        # Download model to a temporary directory
        with TemporaryDirectory() as tmp:
            model_path = _download_artifact_from_uri(model_uri, output_path=tmp)
            _logger.info(f"Downloaded model to {model_path}")

            # Serve with no env manager
            pyfunc_entrypoint = (
                'ENTRYPOINT ["python", "-c", "from mlflow.models import container as C;'
                'C._serve(env_manager=None)"]'
            )

            _build_image(
                model_path=model_path,
                image_name=image_name,
                mlflow_home=mlflow_home,
                entrypoint=pyfunc_entrypoint,
                enable_mlserver=enable_mlserver,
            )


    def validate_local(
        self,
        model_uri: str,
        input_data_or_path: str,
        headers: dict = {},
        port: int = 5000,
        enable_mlserver: bool = False,
        env_vars: dict = None,
        retain_image: bool = False,
    ):
        input_data = self._get_input_data(input_data_or_path)
        # Build image
        image_name = "mlflow-pyfunc-local-test-optimized"
        self.build_image(
            model_uri=model_uri,
            image_name=image_name,
            mlflow_home=self._env_id,
            enable_mlserver=enable_mlserver
        )
        _logger.info(f"Built image {image_name}")

        # Run container in the background
        container = run_container(
            image_name=image_name,
            container_name="mlflow-validate-local-container",
            port=port,
            env_vars=env_vars,
            wait_for_ready=True,
        )

        # Send request to the container
        try:
            predict_endpoint = f"http://localhost:{port}/invocations"
            _logger.info(f"Sending request to container at {predict_endpoint}")

            response = requests.post(
                predict_endpoint,
                json=input_data,
                headers=headers if headers else {"Content-Type": "application/json"},
            )

            # Check the response
            if response.status_code != 200:
                raise Exception(f"Request failed with status code {response.status_code}. {response.text}")
        except Exception as e:
            _logger.error(e)
            # Retain the container and image if the validation fails
            stop_container(container.name, remove=False, show_logs=True)
            raise

        # Vlidation passed
        stop_container(container.name, remove=True)
        if not retain_image:
            remove_image(image_name)

    def _get_input_data(self, input_data_or_path: str) -> dict:
        """

        """
        if os.path.exists(input_data_or_path) and os.path.isfile(input_data_or_path):
            try:
                with open(input_data_or_path, "r") as f:
                    input_data = json.load(f)
            except Exception as e:
                raise Exception(f"Failed to parse input data from file {input_data_or_path}: {e}")
        else:
            # Validate if the input data is in json format
            try:
                input_data = json.loads(input_data_or_path)
            except Exception as e:
                raise Exception(f"The sample request is not in peoper json format: {e}")

        return input_data
