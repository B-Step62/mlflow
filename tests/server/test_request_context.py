"""Tests for the framework-agnostic RequestContext abstraction."""

import json
from io import BytesIO
from unittest.mock import MagicMock

import pytest

from mlflow.server.request_context import RequestContext, from_flask_request


class TestRequestContext:
    def test_args_get_scalar(self):
        ctx = RequestContext(
            method="GET",
            args={"run_id": "abc123", "path": "model/file.txt"},
            json_body=None,
            headers={},
            content_type=None,
        )
        assert ctx.args_get("run_id") == "abc123"
        assert ctx.args_get("path") == "model/file.txt"
        assert ctx.args_get("missing") is None
        assert ctx.args_get("missing", "default") == "default"

    def test_args_get_from_list(self):
        ctx = RequestContext(
            method="GET",
            args={"run_id": ["abc", "def"]},
            json_body=None,
            headers={},
            content_type=None,
        )
        # args_get returns first value of a list
        assert ctx.args_get("run_id") == "abc"

    def test_args_getlist_scalar(self):
        ctx = RequestContext(
            method="GET",
            args={"run_id": "abc123"},
            json_body=None,
            headers={},
            content_type=None,
        )
        assert ctx.args_getlist("run_id") == ["abc123"]
        assert ctx.args_getlist("missing") == []

    def test_args_getlist_repeated(self):
        ctx = RequestContext(
            method="GET",
            args={"run_id": ["abc", "def", "ghi"]},
            json_body=None,
            headers={},
            content_type=None,
        )
        assert ctx.args_getlist("run_id") == ["abc", "def", "ghi"]

    def test_get_json(self):
        body = {"experiment_name": "test", "tags": [{"key": "k", "value": "v"}]}
        ctx = RequestContext(
            method="POST",
            args={},
            json_body=body,
            headers={},
            content_type="application/json",
        )
        assert ctx.get_json() == body

    def test_get_json_none(self):
        ctx = RequestContext(
            method="GET",
            args={"run_id": "abc"},
            json_body=None,
            headers={},
            content_type=None,
        )
        assert ctx.get_json() is None

    def test_frozen(self):
        ctx = RequestContext(
            method="GET",
            args={},
            json_body=None,
            headers={},
            content_type=None,
        )
        with pytest.raises(AttributeError):
            ctx.method = "POST"


class TestFromFlaskRequest:
    def _make_flask_request(
        self,
        method="GET",
        args=None,
        json_body=None,
        content_type=None,
        headers=None,
        path="/api/2.0/mlflow/experiments/search",
        content_length=None,
    ):
        mock = MagicMock()
        mock.method = method
        mock.path = path
        mock.content_type = content_type
        mock.content_length = content_length
        mock.stream = BytesIO(b"")

        # Simulate Flask's ImmutableMultiDict for args
        _args = args or {}

        class FakeMultiDict(dict):
            def __init__(self, d):
                super().__init__(d)

            def getlist(self, key):
                val = self.get(key)
                if val is None:
                    return []
                if isinstance(val, list):
                    return val
                return [val]

        mock.args = FakeMultiDict(_args)
        mock.get_json = MagicMock(return_value=json_body)

        _headers = headers or {}
        mock.headers = _headers

        return mock

    def test_get_request(self):
        flask_req = self._make_flask_request(
            method="GET",
            args={"run_id": "abc123", "metric_key": "loss"},
        )
        ctx = from_flask_request(flask_req)

        assert ctx.method == "GET"
        assert ctx.args_get("run_id") == "abc123"
        assert ctx.args_get("metric_key") == "loss"
        assert ctx.json_body is None  # get_json returns None for mock default

    def test_post_request_with_json(self):
        body = {"name": "my-experiment"}
        flask_req = self._make_flask_request(
            method="POST",
            json_body=body,
            content_type="application/json",
        )
        ctx = from_flask_request(flask_req)

        assert ctx.method == "POST"
        assert ctx.get_json() == body
        assert ctx.content_type == "application/json"

    def test_repeated_query_params(self):
        flask_req = self._make_flask_request(
            method="GET",
            args={"run_id": ["r1", "r2", "r3"]},
        )
        ctx = from_flask_request(flask_req)

        assert ctx.args_getlist("run_id") == ["r1", "r2", "r3"]
        assert ctx.args_get("run_id") == "r1"

    def test_headers_preserved(self):
        flask_req = self._make_flask_request(
            headers={"Authorization": "Bearer token123", "X-Custom": "value"},
        )
        ctx = from_flask_request(flask_req)

        assert ctx.headers["Authorization"] == "Bearer token123"
        assert ctx.headers["X-Custom"] == "value"

    def test_content_length(self):
        flask_req = self._make_flask_request(content_length=1024)
        ctx = from_flask_request(flask_req)
        assert ctx.content_length == 1024

    def test_path(self):
        flask_req = self._make_flask_request(path="/api/2.0/mlflow/runs/search")
        ctx = from_flask_request(flask_req)
        assert ctx.path == "/api/2.0/mlflow/runs/search"


class TestRequestContextWithHandlerFunctions:
    """Test that RequestContext works with the refactored handler functions."""

    def test_validate_content_type_with_context(self):
        from mlflow.server.validation import _validate_content_type

        ctx = RequestContext(
            method="POST",
            args={},
            json_body={},
            headers={},
            content_type="application/json",
        )
        # Should not raise
        _validate_content_type(ctx, ["application/json"])

    def test_validate_content_type_rejects_wrong_type(self):
        from mlflow.exceptions import MlflowException
        from mlflow.server.validation import _validate_content_type

        ctx = RequestContext(
            method="POST",
            args={},
            json_body={},
            headers={},
            content_type="text/plain",
        )
        with pytest.raises(MlflowException, match="Content-Type must be one of"):
            _validate_content_type(ctx, ["application/json"])

    def test_validate_content_type_skips_get(self):
        from mlflow.server.validation import _validate_content_type

        ctx = RequestContext(
            method="GET",
            args={},
            json_body=None,
            headers={},
            content_type=None,
        )
        # Should not raise for GET requests even with no content type
        _validate_content_type(ctx, ["application/json"])

    def test_validate_content_type_missing_header(self):
        from mlflow.exceptions import MlflowException
        from mlflow.server.validation import _validate_content_type

        ctx = RequestContext(
            method="POST",
            args={},
            json_body={},
            headers={},
            content_type=None,
        )
        with pytest.raises(MlflowException, match="Content-Type header is missing"):
            _validate_content_type(ctx, ["application/json"])

    def test_validate_content_type_with_charset(self):
        from mlflow.server.validation import _validate_content_type

        ctx = RequestContext(
            method="POST",
            args={},
            json_body={},
            headers={},
            content_type="application/json; charset=utf-8",
        )
        # Should not raise -- charset parameter is stripped
        _validate_content_type(ctx, ["application/json"])
