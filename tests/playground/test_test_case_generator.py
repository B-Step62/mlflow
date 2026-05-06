import json

import pytest

from mlflow.playground.test_case_generator import (
    AssertionSpec,
    FeedbackInput,
    GeneratedTestCase,
    JudgeSpec,
    TestCaseGenerator,
    TestStrategy,
)


def _feedback(**overrides) -> FeedbackInput:
    base = {
        "rationale": "must mention §4.2 of the refund policy",
        "failing_assistant_message": "I'd be happy to help process your refund.",
        "conversation_prefix": [
            {"role": "user", "content": "How long do refunds take?"},
        ],
    }
    base.update(overrides)
    return FeedbackInput(**base)


def _llm(payload: dict) -> object:
    return lambda _prompt: json.dumps(payload)


def test_assertion_strategy_populates_assertion_spec_only():
    payload = {
        "strategy": "assertion",
        "rationale_summary": "must cite §4.2",
        "must_contain": ["§4.2"],
        "must_not_contain": ["I'd be happy"],
        "must_call_tool": [],
        "must_not_call_tool": ["delete_account"],
    }
    gen = TestCaseGenerator(llm=_llm(payload))

    tc = gen.generate(_feedback())

    assert tc.strategy is TestStrategy.ASSERTION
    assert tc.assertion == AssertionSpec(
        must_contain=["§4.2"],
        must_not_contain=["I'd be happy"],
        must_call_tool=[],
        must_not_call_tool=["delete_account"],
    )
    assert tc.judge is None
    assert tc.rationale_summary == "must cite §4.2"
    assert tc.test_case_id.startswith("tc-")
    assert tc.inputs == [{"role": "user", "content": "How long do refunds take?"}]


def test_judge_strategy_populates_judge_spec_and_carries_expected_response():
    payload = {
        "strategy": "judge",
        "rationale_summary": "tone too casual",
        "judge_criteria": "Response tone is professional, not casual.",
    }
    gen = TestCaseGenerator(llm=_llm(payload))

    tc = gen.generate(
        _feedback(
            rationale="tone is too casual",
            expected_response="A formal, professional reply.",
            aspect="tone",
        )
    )

    assert tc.strategy is TestStrategy.JUDGE
    assert tc.assertion is None
    assert tc.judge == JudgeSpec(
        criteria="Response tone is professional, not casual.",
        expected_response="A formal, professional reply.",
    )


def test_judge_falls_back_to_rationale_if_llm_omits_criteria():
    payload = {"strategy": "judge", "rationale_summary": "", "judge_criteria": None}
    gen = TestCaseGenerator(llm=_llm(payload))

    tc = gen.generate(_feedback(rationale="answer is wrong somehow"))

    assert tc.judge is not None
    assert tc.judge.criteria == "answer is wrong somehow"
    # Empty summary falls back to truncated rationale.
    assert tc.rationale_summary == "answer is wrong somehow"


def test_unknown_strategy_raises():
    payload = {"strategy": "vibes", "rationale_summary": ""}
    gen = TestCaseGenerator(llm=_llm(payload))

    with pytest.raises(ValueError, match="unknown strategy 'vibes'"):
        gen.generate(_feedback())


def test_test_case_ids_are_unique():
    payload = {"strategy": "assertion", "must_contain": ["x"]}
    gen = TestCaseGenerator(llm=_llm(payload))

    ids = {gen.generate(_feedback()).test_case_id for _ in range(5)}

    assert len(ids) == 5


def test_prompt_includes_expected_response_and_aspect_when_provided():
    captured: dict[str, str] = {}

    def capturing_llm(prompt: str) -> str:
        captured["prompt"] = prompt
        return json.dumps({"strategy": "assertion", "must_contain": ["x"]})

    TestCaseGenerator(llm=capturing_llm).generate(
        _feedback(expected_response="42", aspect="groundedness")
    )

    prompt = captured["prompt"]
    assert "User-provided expected response: '42'" in prompt
    assert "Aspect tag: groundedness" in prompt


def test_to_dataset_record_assertion_shape():
    tc = GeneratedTestCase(
        test_case_id="tc-abc",
        strategy=TestStrategy.ASSERTION,
        inputs=[{"role": "user", "content": "hi"}],
        rationale_summary="cite §4.2",
        assertion=AssertionSpec(must_contain=["§4.2"]),
    )

    record = TestCaseGenerator.to_dataset_record(
        tc, issue_id="iss-123", source_trace_id="tr-456"
    )

    assert record == {
        "inputs": {"messages": [{"role": "user", "content": "hi"}]},
        "expectations": {
            "test_case_id": "tc-abc",
            "test_spec": {
                "strategy": "assertion",
                "assertion": {
                    "must_contain": ["§4.2"],
                    "must_not_contain": [],
                    "must_call_tool": [],
                    "must_not_call_tool": [],
                },
            },
            "rationale_summary": "cite §4.2",
        },
        "tags": {"issue_id": "iss-123", "source_trace_id": "tr-456"},
    }


def test_to_dataset_record_judge_shape_and_omits_empty_tags():
    tc = GeneratedTestCase(
        test_case_id="tc-xyz",
        strategy=TestStrategy.JUDGE,
        inputs=[],
        rationale_summary="tone",
        judge=JudgeSpec(criteria="be formal", expected_response=None),
    )

    record = TestCaseGenerator.to_dataset_record(tc)

    assert record["expectations"]["test_spec"] == {
        "strategy": "judge",
        "judge": {"criteria": "be formal", "expected_response": None},
    }
    assert record["tags"] == {}


def test_default_llm_call_uses_databricks_serving_endpoint(monkeypatch):
    """Test-case generation hits Databricks model serving via its
    OpenAI-compatible API: base_url=<host>/serving-endpoints, api_key=<PAT>.
    """
    from unittest import mock as _mock

    captured = {}

    class _Choice:
        def __init__(self):
            self.message = type("M", (), {"content": "{}"})()

    class _Resp:
        choices = [_Choice()]

    fake_client = _mock.Mock()
    fake_client.chat.completions.create.return_value = _Resp()

    fake_openai_module = type("M", (), {"OpenAI": _mock.Mock(return_value=fake_client)})

    monkeypatch.setitem(__import__("sys").modules, "openai", fake_openai_module)
    monkeypatch.setenv("DATABRICKS_HOST", "https://example.cloud.databricks.com/")
    monkeypatch.setenv("DATABRICKS_TOKEN", "dapi-fake")
    monkeypatch.delenv("MLFLOW_PLAYGROUND_TEST_GEN_ENDPOINT", raising=False)

    from mlflow.playground.test_case_generator import _default_llm_call

    _default_llm_call("hello world")

    fake_openai_module.OpenAI.assert_called_once_with(
        api_key="dapi-fake",
        base_url="https://example.cloud.databricks.com/serving-endpoints",
    )
    create_call = fake_client.chat.completions.create.call_args
    assert create_call.kwargs["model"] == "databricks-claude-sonnet-4-5"
    assert create_call.kwargs["messages"] == [{"role": "user", "content": "hello world"}]


def test_default_llm_call_endpoint_env_override(monkeypatch):
    from unittest import mock as _mock

    fake_client = _mock.Mock()
    fake_client.chat.completions.create.return_value = type(
        "R", (), {"choices": [type("C", (), {"message": type("M", (), {"content": "{}"})()})()]}
    )()
    fake_openai_module = type("M", (), {"OpenAI": _mock.Mock(return_value=fake_client)})

    monkeypatch.setitem(__import__("sys").modules, "openai", fake_openai_module)
    monkeypatch.setenv("DATABRICKS_HOST", "https://example.cloud.databricks.com")
    monkeypatch.setenv("DATABRICKS_TOKEN", "dapi-fake")
    monkeypatch.setenv("MLFLOW_PLAYGROUND_TEST_GEN_ENDPOINT", "databricks-meta-llama-3-3-70b-instruct")

    from mlflow.playground.test_case_generator import _default_llm_call

    _default_llm_call("hi")
    assert (
        fake_client.chat.completions.create.call_args.kwargs["model"]
        == "databricks-meta-llama-3-3-70b-instruct"
    )


def test_default_llm_call_raises_when_databricks_credentials_missing(monkeypatch):
    monkeypatch.delenv("DATABRICKS_HOST", raising=False)
    monkeypatch.delenv("DATABRICKS_TOKEN", raising=False)

    from mlflow.playground.test_case_generator import _default_llm_call

    with pytest.raises(RuntimeError, match="DATABRICKS_HOST"):
        _default_llm_call("hi")
