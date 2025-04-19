import pytest
from packaging.version import Version

from mlflow.openai.constants import OPENAI_VERSION

from tests.helper_functions import start_mock_openai_server

is_v1 = Version(OPENAI_VERSION).major >= 1


@pytest.fixture(scope="module", autouse=True)
def mock_openai():
    with start_mock_openai_server() as base_url:
        yield base_url
