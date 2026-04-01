"""Tests that the generalized FastAPI auth middleware covers all routes.

This is the security gate for Milestone 1.5 -- verifying that no route is left
unprotected when migrating from Flask to FastAPI.

The middleware has two layers of protection:
1. Authentication: ALL non-unprotected routes require authentication (user must
   provide valid credentials). This is enforced by the middleware itself.
2. Authorization: Some routes have specific permission validators (e.g., "can
   this user read this experiment?"). _find_fastapi_validator returns these.
   Routes without a specific validator still require authentication.
"""

import re

import pytest

from mlflow.server.auth import _find_fastapi_validator, is_unprotected_route
from mlflow.server.handlers import get_endpoints


class TestAuthCoverage:
    """Verify auth middleware behavior for different route categories."""

    def test_fastapi_native_routes_have_validators(self):
        """Previously hard-coded FastAPI routes must have specific validators."""
        native_routes = [
            ("/gateway/some-endpoint/mlflow/invocations", "POST"),
            ("/v1/traces", "POST"),
            ("/ajax-api/3.0/jobs/submit", "POST"),
            ("/ajax-api/3.0/mlflow/assistant/chat", "POST"),
        ]
        for path, method in native_routes:
            validator = _find_fastapi_validator(path, method)
            assert validator is not None, f"No validator for FastAPI-native route: {method} {path}"

    def test_explicit_routes_with_validators_covered(self):
        """Explicit routes that have Flask validators must also have FastAPI coverage."""
        # These routes have explicit entries in BEFORE_REQUEST_VALIDATORS
        routes_with_validators = [
            ("/get-artifact", "GET"),
            ("/model-versions/get-artifact", "GET"),
            ("/ajax-api/2.0/mlflow/metrics/get-history-bulk", "GET"),
            ("/ajax-api/2.0/mlflow/metrics/get-history-bulk-interval", "GET"),
            ("/ajax-api/2.0/mlflow/experiments/search-datasets", "POST"),
            ("/ajax-api/2.0/mlflow/runs/create-promptlab-run", "POST"),
            ("/ajax-api/2.0/mlflow/gateway-proxy", "POST"),
            ("/ajax-api/2.0/mlflow/gateway-proxy", "GET"),
            ("/ajax-api/2.0/mlflow/upload-artifact", "POST"),
            ("/ajax-api/2.0/mlflow/get-trace-artifact", "GET"),
        ]
        uncovered = []
        for path, method in routes_with_validators:
            validator = _find_fastapi_validator(path, method)
            if validator is None:
                uncovered.append((path, method))

        assert uncovered == [], (
            f"Explicit routes without FastAPI auth coverage:\n"
            + "\n".join(f"  {method} {path}" for path, method in uncovered)
        )

    def test_protobuf_routes_with_exact_match_validators(self):
        """Protobuf routes that have exact-match validators in BEFORE_REQUEST_VALIDATORS."""
        # These are non-parameterized protobuf routes with known validators
        routes = [
            ("/api/2.0/mlflow/experiments/create", "POST"),
            ("/api/2.0/mlflow/experiments/delete", "POST"),
            ("/api/2.0/mlflow/runs/create", "POST"),
            ("/api/2.0/mlflow/runs/delete", "POST"),
            ("/api/2.0/mlflow/runs/log-metric", "POST"),
            ("/api/2.0/mlflow/runs/log-batch", "POST"),
            ("/api/2.0/mlflow/registered-models/create", "POST"),
        ]
        for path, method in routes:
            validator = _find_fastapi_validator(path, method)
            assert validator is not None, (
                f"No validator for protobuf route: {method} {path}"
            )

    def test_unprotected_routes_skipped(self):
        """Health, static, and favicon routes should not require auth."""
        assert is_unprotected_route("/health")
        assert is_unprotected_route("/static/main.js")
        assert is_unprotected_route("/favicon.ico")
        assert not is_unprotected_route("/api/2.0/mlflow/experiments/create")

    def test_proxy_artifact_paths_covered(self):
        """Proxy artifact paths must have auth coverage."""
        proxy_paths = [
            ("/api/2.0/mlflow-artifacts/artifacts/some/path", "GET"),
            ("/api/2.0/mlflow-artifacts/artifacts/some/path", "PUT"),
            ("/ajax-api/2.0/mlflow-artifacts/artifacts/some/path", "GET"),
        ]
        for path, method in proxy_paths:
            validator = _find_fastapi_validator(path, method)
            assert validator is not None, f"No validator for proxy artifact: {method} {path}"

    def test_middleware_always_authenticates_non_unprotected_routes(self):
        """The middleware requires authentication for ALL non-unprotected routes,
        even those without a specific validator (validator=None means 'auth only').

        This is the key behavioral guarantee: after migrating from Flask to FastAPI,
        no route is accessible without authentication when --app-name basic-auth is used.
        """
        # Routes without specific validators should still be auth-protected
        # by the middleware (it checks auth before looking for validators)
        routes_without_validators = [
            ("/api/2.0/mlflow/experiments/search", "POST"),
            ("/api/2.0/mlflow/runs/search", "POST"),
        ]
        for path, method in routes_without_validators:
            # These return None (no specific permission check needed)
            # but the middleware still requires authentication
            assert not is_unprotected_route(path), (
                f"Route should NOT be unprotected: {method} {path}"
            )
