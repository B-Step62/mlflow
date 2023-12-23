import docker
import logging
import os
import shutil
from subprocess import PIPE, STDOUT, Popen

from mlflow import pyfunc
from mlflow.models import Model
from mlflow.models.model import MLMODEL_FILE_NAME
from mlflow.utils import env_manager as em
from mlflow.utils.environment import _PythonEnv
from mlflow.utils.file_utils import TempDir, _copy_project
from mlflow.utils.logging_utils import eprint


_logger = logging.getLogger(__name__)


_DOCKERFILE_TEMPLATE = """
# Build an image that can serve mlflow models.
FROM ubuntu:20.04

RUN apt-get -y update
RUN DEBIAN_FRONTEND=noninteractive TZ=Etc/UTC apt install -y --no-install-recommends \
        wget build-essential checkinstall \
        nginx ca-certificates bzip2 \
        libreadline-gplv2-dev  libncursesw5-dev  libssl-dev \
        libsqlite3-dev tk-dev libgdbm-dev libc6-dev libbz2-dev libffi-dev zlib1g-dev \
    && rm -rf /var/lib/apt/lists/*

# Install Python
{install_python}

# Install build tools
{install_build_tools}

# Install model dependencies
COPY model /opt/ml/model
WORKDIR /opt/ml/model
{install_model_deps}

# Install serving dependencies
{install_server_deps}
ENV GUNICORN_CMD_ARGS="--timeout 60 -k gevent"

# Install MLflow from the source or latest version
WORKDIR /opt/mlflow
{install_mlflow}

# granting read/write access and conditional execution authority to all child directories
# and files to allow for deployment to AWS Sagemaker Serverless Endpoints
# (see https://docs.aws.amazon.com/sagemaker/latest/dg/serverless-endpoints.html)
RUN chmod o+rwX /opt/mlflow/

{entrypoint}
"""

# Commnad to install Python from source
_INSTALL_PYTHON_TEMPLATE = """
RUN cd /usr/src && \
    wget https://www.python.org/ftp/python/{python_version}/Python-{python_version}.tgz && \
    tar xzf Python-{python_version}.tgz && \
    cd Python-{python_version} && \
    ./configure --enable-optimizations && \
    make install && \
    ln -s /usr/local/bin/python3 /usr/local/bin/python
"""

def _get_python_env_from_config(model_path):
    """
    Returns the python environment config from the model path.
    """
    model_config_path = os.path.join(model_path, MLMODEL_FILE_NAME)
    model = Model.load(model_config_path)

    conf = model.flavors[pyfunc.FLAVOR_NAME]
    env_conf = conf[pyfunc.ENV]
    python_env_config_path = os.path.join(model_path, env_conf[em.VIRTUALENV])

    # Hack: Remove mlflow dependency as we will install later anyway
    requirement_txt_path = None
    with open(python_env_config_path, "r") as f:
        lines = f.readlines()
    content = "".join([line for line in lines if "mlflow" not in line])

    if "requirements.txt" in content:
        requirement_txt_path = os.path.join(model_path, "requirements.txt")

    with open(python_env_config_path, "w") as f:
        f.write(content)

    if requirement_txt_path:
        with open(requirement_txt_path, "r") as f:
            lines = f.readlines()
        content = "".join([line for line in lines if "mlflow" not in line])
        with open(requirement_txt_path, "w") as f:
            f.write(content)

    return _PythonEnv.from_yaml(python_env_config_path)


def _generate_dockerfile_content(
    model_path: str,
    install_mlflow: bool,
    entrypoint: str,
    enable_mlserver=False,
):
    """
    Generates a Dockerfile that can be used to build a docker image, that serves ML model
    stored and tracked in MLflow
    """
    # Model dependencies
    try:
        python_env = _get_python_env_from_config(model_path)
    except:
        raise Exception("Failed to extract python environment from the model.")

    if not python_env.python.startswith("3"):
        raise Exception("Python version 3 is required for optimized image build."
                        "Please run the command without --optimized flag for using Python 2")

    # Server dependencies
    if enable_mlserver:
        server_deps = ["'mlserver>=1.2.0,!=1.3.1'", "'mlserver-mlflow>=1.2.0,!=1.3.1'"]
    else:
        server_deps = ["flask==3.0.0", "gunicorn[gevent]"]
    # pandas is requrired for pyfunc model
    server_deps += ["pandas==2.0.3"]

    def _pip_install_cmd(pip_deps):
        return "RUN python -m pip install --upgrade {}".format(" ".join(pip_deps))

    dockerfile = _DOCKERFILE_TEMPLATE.format(
        model_path=model_path,
        install_python=_INSTALL_PYTHON_TEMPLATE.format(python_version=python_env.python),
        install_build_tools=_pip_install_cmd(python_env.build_dependencies),
        install_model_deps=_pip_install_cmd(python_env.dependencies),
        install_server_deps=_pip_install_cmd(server_deps),
        install_mlflow=install_mlflow,
        entrypoint=entrypoint,
    )
    _logger.info("Dockerfile content is: \n%s", dockerfile)

    return dockerfile


def _get_mlflow_install_step(dockerfile_context_dir, mlflow_home):
    """
    Get docker build commands for installing MLflow given a Docker context dir and optional source
    directory
    """
    if mlflow_home:
        mlflow_dir = _copy_project(src_path=os.path.abspath(mlflow_home), dst_path=dockerfile_context_dir)
        return (
            f"COPY {mlflow_dir} /opt/mlflow\n"
            "ENV MLFLOW_SKINNY=1\n" # Install skinny version
            "RUN pip install /opt/mlflow\n"
        )
    else:
        return "RUN pip install mlflow-skinny==2.9.2\n"

def _build_image(
    model_path: str,
    image_name: str,
    entrypoint: str,
    mlflow_home=None,
    enable_mlserver=False,
):
    """
    Build an MLflow Docker image that can be used to serve a
    The image is built locally and it requires Docker to run.

    :param image_name: Docker image name.
    :param entry_point: String containing ENTRYPOINT directive for docker image
    :param mlflow_home: (Optional) Path to a local copy of the MLflow GitHub repository.
                        If specified, the image will install MLflow from this directory.
                        If None, it will install MLflow from pip..
    """
    with TempDir() as tmp:
        cwd = tmp.path()
        install_mlflow = _get_mlflow_install_step(cwd, mlflow_home)

        # copy model to context dir
        model_path_in_context = os.path.join(cwd, "model")
        shutil.copytree(model_path, model_path_in_context)

        docker_file_content = _generate_dockerfile_content(
            model_path=model_path_in_context,
            install_mlflow=install_mlflow,
            entrypoint=entrypoint,
            enable_mlserver=enable_mlserver,
        )

        with open(os.path.join(cwd, "Dockerfile"), "w") as f:
            f.write(docker_file_content)

        _logger.info("Building docker image with name %s", image_name)
        _build_image_from_context(context_dir=cwd, image_name=image_name)


def _build_image_from_context(context_dir: str, image_name: str):
    import docker

    client = docker.from_env()
    # In Docker < 19, `docker build` doesn't support the `--platform` option
    is_platform_supported = int(client.version()["Version"].split(".")[0]) >= 19
    # Enforcing the AMD64 architecture build for Apple M1 users
    platform_option = ["--platform", "linux/amd64"] if is_platform_supported else []
    commands = [
        "docker",
        "build",
        "-t",
        image_name,
        "-f",
        "Dockerfile",
        *platform_option,
        ".",
    ]
    proc = Popen(commands, cwd=context_dir, stdout=PIPE, stderr=STDOUT, text=True)
    for x in iter(proc.stdout.readline, ""):
        eprint(x, end="")

    if proc.wait():
        raise RuntimeError("Docker build failed.")
