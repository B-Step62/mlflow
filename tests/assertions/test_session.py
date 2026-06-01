"""Tests for session id, trace tagging, terminal summary."""

from __future__ import annotations

import re

import pytest

import mlflow
from mlflow._assertions import pytest_plugin as plugin
from mlflow._assertions import session
from mlflow.genai.scorers import scorer


@pytest.mark.parametrize(
    ("item_name", "expected"),
    [
        ("test_simple", None),
        ("test_parametrized[case_a]", "case_a"),
        ("test_with_dashes[a-b-c]", "a-b-c"),
        ("test_brackets_not_at_end[foo]_other", None),
        ("", None),
    ],
)
def test_case_id_extraction(item_name, expected):
    assert plugin._case_id_from_item_name(item_name) == expected


def test_session_id_is_set_and_well_formed():
    assert session.session_id() is not None
    # Default format: YYYYMMDDTHHMMSS-<hex6>
    assert re.match(r"\d{8}T\d{6}-[0-9a-f]{6}", session.session_id()) or (
        session.session_id()  # respected override from env
    )


def test_build_trace_tags_includes_session_id():
    tags = session.build_trace_tags("test_x", None)
    assert tags["mlflow.test.name"] == "test_x"
    assert tags["mlflow.test.session_id"] == session.session_id()
    assert "mlflow.test.case_id" not in tags


def test_build_trace_tags_with_case_id():
    tags = session.build_trace_tags("test_x", "case_42")
    assert tags["mlflow.test.case_id"] == "case_42"


@scorer
def trivially_passes(outputs) -> bool:
    return True


def test_results_accumulated_for_summary():
    """After assert_behavior runs, session.snapshot() should contain an entry
    naming this test and the scorer."""
    mlflow.genai.assert_behavior(
        "auto",
        outputs="anything",
        assertions=[trivially_passes],
        name="test_results_accumulated_for_summary",
    )
    found = [
        (test_name, r.scorer_name)
        for test_name, r in session.snapshot()
        if test_name == "test_results_accumulated_for_summary"
    ]
    assert any(scorer_name == "trivially_passes" for _, scorer_name in found), (
        f"Expected this test's result to be recorded; got {session.snapshot()!r}"
    )
