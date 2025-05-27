from mlflow.entities.assessment import Expectation
import pytest
from unittest.mock import patch

import mlflow
from mlflow.entities.document import Document
from mlflow.entities.span import SpanType


@pytest.fixture
def trace():

    @mlflow.trace(span_type=SpanType.AGENT)
    def _predict(question):
        _retrieve(question)
        return "answer"

    @mlflow.trace(span_type=SpanType.RETRIEVER)
    def _retrieve(question):
        return [
            Document(
                page_content="content_1",
                metadata={"doc_uri": "url_1"},
            ),
            Document(
                page_content="content_2",
                metadata={"doc_uri": "url_2"},
            ),
            Document(
                page_content="content_3"
            )
        ]

    _predict("query")

    trace = mlflow.get_trace(mlflow.get_last_active_trace_id())

    # Add expectations. Directly append to the trace info because OSS backend doesn't
    # support assessment logging yet.
    trace.info.assessments = [
        Expectation(name="expected_response", value="expected answer"),
        Expectation(name="expected_facts", value=["fact1", "fact2"]),
    ]
    return trace


def test_retrieval_groundedness(trace):
    with patch("mlflow.genai.judges.is_grounded") as mock_is_grounded:
        mlflow.genai.scorers.retrieval_groundedness(trace=trace)

    mock_is_grounded.assert_called_once_with(
        request=trace.data.request,
        response=trace.data.response,
        context=[
            {"content": "content_1", "doc_uri": "url_1"},
            {"content": "content_2", "doc_uri": "url_2"},
            {"content": "content_3"},
        ]
    )


def test_retrieval_relevance(trace):
    with patch("mlflow.genai.judges.is_context_relevant") as mock_is_context_relevant:
        mlflow.genai.scorers.retrieval_relevance(trace=trace)

    mock_is_context_relevant.assert_called_once_with(
        request=trace.data.request,
        context=[
            {"content": "content_1", "doc_uri": "url_1"},
            {"content": "content_2", "doc_uri": "url_2"},
            {"content": "content_3"},
        ],
    )


def test_retrieval_sufficiency(trace):
    with patch("mlflow.genai.judges.is_context_sufficient") as mock_is_context_sufficient:
        mlflow.genai.scorers.retrieval_sufficiency(trace=trace)

    mock_is_context_sufficient.assert_called_once_with(
        request=trace.data.request,
        context=[
            {"content": "content_1", "doc_uri": "url_1"},
            {"content": "content_2", "doc_uri": "url_2"},
            {"content": "content_3"},
        ],
        expected_response="expected answer",
        expected_facts=["fact1", "fact2"],
    )


def test_guideline_adherence():
    # 1. Called with per-row guidelines
    with patch("mlflow.genai.judges.meets_guidelines") as mock_meets_guidelines:
        mlflow.genai.scorers.guideline_adherence(
            inputs={"question": "query"},
            outputs="answer",
            expectations={"guidelines": ["guideline1", "guideline2"]}
        )

    mock_meets_guidelines.assert_called_once_with(
        request="query",
        response="answer",
        guidelines=["guideline1", "guideline2"],
    )

    # 2. Called with global guidelines
    is_english = mlflow.genai.scorers.guideline_adherence.with_config(
        name="is_english",
        global_guidelines=["The response should be in English."],
    )

    with patch("mlflow.genai.judges.meets_guidelines") as mock_meets_guidelines:
        is_english(
            inputs={"question": "query"},
            outputs="answer",
        )

    mock_meets_guidelines.assert_called_once_with(
        request="query",
        response="answer",
        guidelines=["The response should be in English."],
    )


def test_relevance_to_query():
    with patch("mlflow.genai.judges.is_relevant_to_query") as mock_is_relevant_to_query:
        mlflow.genai.scorers.relevance_to_query(
            inputs={"question": "query"},
            outputs="answer",
        )

    mock_is_relevant_to_query.assert_called_once_with(
        request="query",
        response="answer",
    )


def test_safety():
    with patch("mlflow.genai.judges.is_safe") as mock_is_safe:
        mlflow.genai.scorers.safety(
            inputs={"question": "query"},
            outputs="answer",
        )

    mock_is_safe.assert_called_once_with(
        request="query",
        response="answer",
    )


def test_correctness():
    with patch("mlflow.genai.judges.is_correct") as mock_is_correct:
        mlflow.genai.scorers.correctness(
            inputs={"question": "query"},
            outputs="answer",
            expectations={"expected_facts": ["fact1", "fact2"]}
        )

    mock_is_correct.assert_called_once_with(
        request="query",
        response="answer",
        expected_facts=["fact1", "fact2"],
        expected_response=None,
    )
