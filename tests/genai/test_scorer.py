import importlib

import pandas as pd
import pytest
from packaging.version import Version

import mlflow
from mlflow.entities import Assessment
from mlflow.entities.assessment import Feedback
from mlflow.entities.assessment_source import AssessmentSource, AssessmentSourceType
from mlflow.genai import Scorer, scorer

if importlib.util.find_spec("databricks.agents") is None:
    pytest.skip(reason="databricks-agents is not installed", allow_module_level=True)

agent_sdk_version = Version(importlib.import_module("databricks.agents").__version__)


def always_yes(inputs, outputs, expectations, trace):
    return "yes"


class AlwaysYesScorer(Scorer):
    def __call__(self, inputs, outputs, expectations, trace):
        return "yes"


@pytest.fixture
def sample_data():
    return pd.DataFrame(
        {
            "inputs": [
                {"message": [{"role": "user", "content": "What is Spark??"}]},
                {
                    "messages": [
                        {"role": "user", "content": "How can you minimize data shuffling in Spark?"}
                    ]
                },
            ],
            "outputs": [
                {"choices": [{"message": {"content": "actual response for first question"}}]},
                {"choices": [{"message": {"content": "actual response for second question"}}]},
            ],
            "expectations": [
                {"expected_response": "expected response for first question"},
                {"expected_response": "expected response for second question"},
            ],
        }
    )


@pytest.fixture
def sample_new_data():
    # sample data for new eval dataset format for mlflow.genai.evaluate()
    return pd.DataFrame(
        {
            "inputs": [
                {"message": [{"role": "user", "content": "What is Spark??"}]},
                {
                    "messages": [
                        {"role": "user", "content": "How can you minimize data shuffling in Spark?"}
                    ]
                },
            ],
            "outputs": [
                {"choices": [{"message": {"content": "actual response for first question"}}]},
                {"choices": [{"message": {"content": "actual response for second question"}}]},
            ],
            "expectations": [
                {"expected_response": "expected response for first question"},
                {"expected_response": "expected response for second question"},
            ],
        }
    )


@pytest.mark.parametrize("dummy_scorer", [AlwaysYesScorer(name="always_yes"), scorer(always_yes)])
def test_scorer_existence_in_metrics(sample_data, dummy_scorer):
    result = mlflow.genai.evaluate(data=sample_data, scorers=[dummy_scorer])
    assert any("always_yes" in metric for metric in result.metrics.keys())


@pytest.mark.parametrize(
    "dummy_scorer", [AlwaysYesScorer(name="always_no"), scorer(name="always_no")(always_yes)]
)
def test_scorer_name_works(sample_data, dummy_scorer):
    _SCORER_NAME = "always_no"
    result = mlflow.genai.evaluate(data=sample_data, scorers=[dummy_scorer])
    assert any(_SCORER_NAME in metric for metric in result.metrics.keys())


def test_trace_passed_correctly():
    @mlflow.trace
    def predict_fn(question):
        return "output: " + str(question)

    actual_call_args_list = []

    @scorer
    def dummy_scorer(inputs, outputs, trace):
        actual_call_args_list.append(
            {
                "inputs": inputs,
                "outputs": outputs,
                "trace": trace,
            }
        )
        return 0.0

    data = [
        {"inputs": {"question": "input1"}},
        {"inputs": {"question": "input2"}},
    ]
    mlflow.genai.evaluate(
        predict_fn=predict_fn,
        data=data,
        scorers=[dummy_scorer],
    )

    assert len(actual_call_args_list) == len(data)
    for actual_args in actual_call_args_list:
        assert actual_args["trace"] is not None
        trace = actual_args["trace"]
        # check if the input is present in the trace
        assert any(str(data[i]["inputs"]["question"]) in str(trace.data.request) for i in range(len(data)))
        # check if predict_fn was run by making output it starts with "output:"
        assert "output:" in str(trace.data.response)[:10]


@pytest.mark.parametrize(
    "scorer_return",
    [
        "yes",
        42,
        42.0,
        Assessment(
            name="big_question",
            source=AssessmentSource(source_type=AssessmentSourceType.HUMAN, source_id="123"),
            feedback=Feedback(value=42),
            rationale="It's the answer to everything",
        ),
        [
            Assessment(
                name="big_question",
                source=AssessmentSource(
                    source_type=AssessmentSourceType.LLM_JUDGE, source_id="judge_1"
                ),
                feedback=Feedback(value=42),
                rationale="It's the answer to everything",
            ),
            Assessment(
                name="small_question",
                feedback=Feedback(value=1),
                rationale="Not sure, just a guess",
                source=AssessmentSource(
                    source_type=AssessmentSourceType.LLM_JUDGE, source_id="judge_2"
                ),
            ),
        ],
    ],
)
def test_scorer_on_genai_evaluate(sample_new_data, scorer_return):
    # Skip if `databricks-agents` SDK is not 1.x. It doesn't
    # support the `mlflow.entities.Assessment` type.
    is_return_assessment = isinstance(scorer_return, Assessment) or (
        isinstance(scorer_return, list) and isinstance(scorer_return[0], Assessment)
    )
    if is_return_assessment and agent_sdk_version.major < 1:
        pytest.skip("Skipping test for assessment return type")

    @scorer
    def dummy_scorer(inputs, outputs):
        return scorer_return

    results = mlflow.genai.evaluate(
        data=sample_new_data,
        scorers=[dummy_scorer],
    )

    assert any("metric/dummy_scorer" in metric for metric in results.metrics.keys())

    dummy_scorer_cols = [
        col for col in results.result_df.keys() if "dummy_scorer" in col and "value" in col
    ]
    dummy_scorer_values = set()
    for col in dummy_scorer_cols:
        for _val in results.result_df[col]:
            dummy_scorer_values.add(_val)

    scorer_return_values = set()
    if isinstance(scorer_return, list):
        for _assessment in scorer_return:
            scorer_return_values.add(_assessment.feedback.value)
    elif isinstance(scorer_return, Assessment):
        scorer_return_values.add(scorer_return.feedback.value)
    else:
        scorer_return_values.add(scorer_return)

    assert dummy_scorer_values == scorer_return_values
