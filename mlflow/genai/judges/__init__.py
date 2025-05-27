from mlflow.entities.assessment import Feedback
from typing import Any, Optional, Union


def is_context_relevant(*, request: str, context: Any, name: Optional[str] = None) -> Feedback:
    """
    LLM judge determines whether the given context is relevant to the input request.

    Args:
        request: Input to the application to evaluate, user's question or query. For example, “What is RAG?”.
        context: TBA
        name: Optional name for overriding the default name of the returned feedback.

    Returns:
        A :py:class:`mlflow.entities.assessment.Feedback~` object with a boolean value indicating
        whether the context is relevant to the request.

    """
    from databricks.agents.evals.judges import chunk_relevance

    return chunk_relevance(
        request=request,
        retrieved_context=context,
        assessment_name=name,
    )


def is_context_sufficient(
    *,
    request: str,
    context: Any,
    expected_facts: list[str],
    expected_response: Optional[str] = None,
    name: str = "is_context_sufficient",
) -> Feedback:
    """
    LLM judge determines whether the given context is sufficient to answer the input request.

    Args:
        request: Input to the application to evaluate, user's question or query. For example, “What is RAG?”.
        context: TBA
        expected_facts: A list of expected facts that should be present in the context.
        expected_response: The expected response from the application. Optional.
        name: Optional name for the judge. Default is "is_context_sufficient".

    Returns:
        A :py:class:`mlflow.entities.assessment.Feedback~` object with a boolean value indicating
        whether the context is sufficient to answer the request.
    """
    from databricks.agents.evals.judges import context_sufficiency

    return context_sufficiency(
        request=request,
        retrieved_context=context,
        expected_facts=expected_facts,
        expected_response=expected_response,
        assessment_name=name,
    )


def is_correct(
    *,
    request: str,
    response: str,
    expected_facts: list[str],
    expected_response: Optional[str] = None,
    name: Optional[str] = None,
) -> Feedback:
    """
    LLM judge determines whether the given response is correct for the input request.

    Args:
        request: Input to the application to evaluate, user's question or query. For example, “What is RAG?”.
        response: The response from the application to evaluate.
        expected_facts: A list of expected facts that should be present in the response.
        expected_response: The expected response from the application. Optional.
        name: Optional name for overriding the default name of the returned feedback.

    Returns:
        A :py:class:`mlflow.entities.assessment.Feedback~` object with a boolean value indicating
        whether the response is correct for the request.
    """
    from databricks.agents.evals.judges import correctness

    return correctness(
        request=request,
        response=response,
        expected_facts=expected_facts,
        expected_response=expected_response,
        assessment_name=name,
    )


def is_grounded(*, request: str, response: str, context: Any, name: Optional[str] = None) -> Feedback:
    """
    LLM judge determines whether the given response is grounded in the given context.

    Args:
        request: Input to the application to evaluate, user's question or query. For example, “What is RAG?”.
        response: The response from the application to evaluate.
        context: TBA
        name: Optional name for overriding the default name of the returned feedback.
    Returns:
        A :py:class:`mlflow.entities.assessment.Feedback~` object with a boolean value indicating
        whether the response is grounded in the context.
    """
    from databricks.agents.evals.judges import groundedness

    return groundedness(
        request=request,
        response=response,
        retrieved_context=context,
        assessment_name=name,
    )


def is_relevant_to_query(*, request: str, response: str, name: Optional[str] = None) -> Feedback:
    """
    LLM judge determines whether the given response is relevant to the input request.

    Args:
        request: Input to the application to evaluate, user's question or query. For example, “What is RAG?”.
        response: The response from the application to evaluate.
        name: Optional name for overriding the default name of the returned feedback.
    Returns:
        A :py:class:`mlflow.entities.assessment.Feedback~` object with a boolean value indicating
        whether the response is relevant to the request.
    """
    from databricks.agents.evals.judges import relevance_to_query

    return relevance_to_query(
        request=request,
        response=response,
        assessment_name=name,
    )


def is_safe(*, request: str, response: str, name: Optional[str] = None) -> Feedback:
    """
    LLM judge determines whether the given response is safe.

    Args:
        request: Input to the application to evaluate, user's question or query. For example, “What is RAG?”.
        response: The response from the application to evaluate.
        name: Optional name for overriding the default name of the returned feedback.
    Returns:
        A :py:class:`mlflow.entities.assessment.Feedback~` object with a boolean value indicating
        whether the response is safe.
    """
    from databricks.agents.evals.judges import safety

    return safety(
        request=request,
        response=response,
        assessment_name=name,
    )


def meets_guidelines(
    *,
    request: str,
    response: str,
    guidelines: Union[str, list[str]],
    name: Optional[str] = None,
) -> Feedback:
    """
    LLM judge determines whether the given response meets the given guideline(s).

    Args:
        request: Input to the application to evaluate, user's question or query. For example, “What is RAG?”.
        response: The response from the application to evaluate.
        guidelines: A single guideline or a list of guidelines.
        name: Optional name for overriding the default name of the returned feedback.
    Returns:
        A :py:class:`mlflow.entities.assessment.Feedback~` object with a boolean value indicating
        whether the response meets the guideline(s).
    """
    from databricks.agents.evals.judges import guideline_adherence

    return guideline_adherence(
        request=request,
        response=response,
        guidelines=guidelines,
        assessment_name=name,
    )
