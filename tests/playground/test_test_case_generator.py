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
