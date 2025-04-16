# Copyright 2018 Databricks, Inc.
import importlib.metadata
import re

VERSION = "2.21.4.dev0"


def is_release_version():
    return bool(re.match(r"^\d+\.\d+\.\d+$", VERSION))


def is_mlflow_skinny_installed():
    # try:
    #     v = importlib.metadata.version("mlflow")
    #     print(v)
    #     return True
    # except importlib.metadata.PackageNotFoundError:
    #     pass

    try:
        importlib.metadata.version("mlflow-skinny")
        return True
    except importlib.metadata.PackageNotFoundError:
        pass

    return False