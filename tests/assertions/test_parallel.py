"""Cross-test parallelism for the @mlflow.assertions bundle runner.

The plugin collapses multiple @mlflow.assertions tests in a module into a
single pytest item that dispatches the originals through a thread pool.
These tests verify:

- Three sibling tests overlap in wall time (parallel, not sequential).
- A session-scoped fixture is built exactly once and shared across tests.
- Filter (`pytest -k`) composes correctly: filtered-down to a single test,
  no bundling kicks in and the test runs as itself.
"""

from __future__ import annotations

import threading
import time

import pytest

import mlflow
from mlflow.genai.scorers import scorer


@scorer
def sleep_then_pass(outputs) -> bool:
    time.sleep(0.4)
    return True


_start_times: list[float] = []
_start_times_lock = threading.Lock()

_fixture_build_count = 0
_fixture_lock = threading.Lock()


@pytest.fixture(scope="session")
def shared_expensive_response():
    """Stand-in for a real session-scoped agent response.

    Built once - this is the cost win xdist cannot provide (process-based
    workers each build their own).
    """
    global _fixture_build_count
    with _fixture_lock:
        _fixture_build_count += 1
    time.sleep(0.2)
    return "shared response value"


def _record_start() -> None:
    with _start_times_lock:
        _start_times.append(time.perf_counter())


@mlflow.assertions(sleep_then_pass)
def test_parallel_one(verify, shared_expensive_response):
    _record_start()
    assert shared_expensive_response == "shared response value"
    verify(shared_expensive_response)


@mlflow.assertions(sleep_then_pass)
def test_parallel_two(verify, shared_expensive_response):
    _record_start()
    verify(shared_expensive_response)


@mlflow.assertions(sleep_then_pass)
def test_parallel_three(verify, shared_expensive_response):
    _record_start()
    verify(shared_expensive_response)


def test_zzz_overlap_and_fixture_shared():
    """Runs after the bundle. Checks the parallel-execution invariants."""
    assert len(_start_times) == 3, (
        f"Expected 3 recorded starts, got {len(_start_times)}. "
        f"The bundled tests may have errored."
    )
    spread = max(_start_times) - min(_start_times)
    assert spread < 0.2, (
        f"Tests appear to have run sequentially (start spread {spread:.2f}s). "
        f"Expected parallel execution (spread << 0.4s)."
    )
    assert _fixture_build_count == 1, (
        f"Session fixture was built {_fixture_build_count} times; expected 1. "
        f"Session-fixture sharing across bundled tests is broken."
    )
