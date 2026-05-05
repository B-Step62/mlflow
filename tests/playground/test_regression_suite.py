from unittest import mock

import pytest

from mlflow.exceptions import MlflowException
from mlflow.playground import regression_suite
from mlflow.playground.regression_suite import (
    REGRESSION_DATASET_PREFIX,
    append_test_case,
    delete_test_case,
    get_or_create_regression_dataset,
    regression_dataset_name,
)
from mlflow.playground.test_case_generator import (
    AssertionSpec,
    GeneratedTestCase,
    TestStrategy,
)
from mlflow.protos.databricks_pb2 import (
    INVALID_PARAMETER_VALUE,
    RESOURCE_DOES_NOT_EXIST,
    ErrorCode,
)


def _test_case(test_case_id: str = "tc-abc") -> GeneratedTestCase:
    return GeneratedTestCase(
        test_case_id=test_case_id,
        strategy=TestStrategy.ASSERTION,
        inputs=[{"role": "user", "content": "hi"}],
        rationale_summary="cite §4.2",
        assertion=AssertionSpec(must_contain=["§4.2"]),
    )


def test_regression_dataset_name_uses_experiment_id():
    assert regression_dataset_name("0") == f"{REGRESSION_DATASET_PREFIX}0"
    assert regression_dataset_name("us-transfer-concierge") == (
        f"{REGRESSION_DATASET_PREFIX}us-transfer-concierge"
    )


def test_get_or_create_returns_existing_dataset_when_present():
    existing = mock.Mock(name="existing_dataset")
    with (
        mock.patch.object(regression_suite, "get_dataset", return_value=existing) as m_get,
        mock.patch.object(regression_suite, "create_dataset") as m_create,
    ):
        result = get_or_create_regression_dataset("exp-1")

    assert result is existing
    m_get.assert_called_once_with(name="regression_suite_exp-1")
    m_create.assert_not_called()


def test_get_or_create_creates_dataset_when_missing():
    not_found = MlflowException(
        "Dataset with name 'regression_suite_exp-1' not found.",
        error_code=RESOURCE_DOES_NOT_EXIST,
    )
    created = mock.Mock(name="created_dataset")
    with (
        mock.patch.object(regression_suite, "get_dataset", side_effect=not_found) as m_get,
        mock.patch.object(regression_suite, "create_dataset", return_value=created) as m_create,
    ):
        result = get_or_create_regression_dataset("exp-1")

    assert result is created
    m_get.assert_called_once_with(name="regression_suite_exp-1")
    m_create.assert_called_once_with(
        name="regression_suite_exp-1", experiment_id="exp-1"
    )


def test_get_or_create_reraises_unexpected_mlflow_exception():
    boom = MlflowException("permission denied", error_code=INVALID_PARAMETER_VALUE)
    with (
        mock.patch.object(regression_suite, "get_dataset", side_effect=boom),
        mock.patch.object(regression_suite, "create_dataset") as m_create,
    ):
        with pytest.raises(MlflowException, match="permission denied") as exc_info:
            get_or_create_regression_dataset("exp-1")

    assert exc_info.value.error_code == ErrorCode.Name(INVALID_PARAMETER_VALUE)
    m_create.assert_not_called()


def test_append_test_case_writes_record_with_promoted_false_default():
    dataset = mock.Mock()
    with mock.patch.object(
        regression_suite, "get_or_create_regression_dataset", return_value=dataset
    ):
        append_test_case(
            "exp-1",
            _test_case("tc-1"),
            issue_id="iss-1",
            source_trace_id="tr-1",
        )

    dataset.merge_records.assert_called_once()
    [records] = dataset.merge_records.call_args.args
    assert len(records) == 1
    record = records[0]
    assert record["expectations"]["test_case_id"] == "tc-1"
    assert record["tags"] == {
        "issue_id": "iss-1",
        "source_trace_id": "tr-1",
        "promoted": "false",
    }


def test_append_test_case_marks_promoted_when_requested():
    dataset = mock.Mock()
    with mock.patch.object(
        regression_suite, "get_or_create_regression_dataset", return_value=dataset
    ):
        append_test_case("exp-1", _test_case(), promoted=True)

    [records] = dataset.merge_records.call_args.args
    assert records[0]["tags"]["promoted"] == "true"


def test_append_test_case_omits_lineage_tags_when_not_provided():
    dataset = mock.Mock()
    with mock.patch.object(
        regression_suite, "get_or_create_regression_dataset", return_value=dataset
    ):
        append_test_case("exp-1", _test_case())

    [records] = dataset.merge_records.call_args.args
    assert records[0]["tags"] == {"promoted": "false"}


def test_delete_test_case_resolves_record_id_and_calls_delete_records():
    import pandas as pd

    dataset = mock.Mock()
    dataset.to_df.return_value = pd.DataFrame(
        [
            {
                "dataset_record_id": "rec-1",
                "expectations": {"test_case_id": "tc-keep"},
            },
            {
                "dataset_record_id": "rec-2",
                "expectations": {"test_case_id": "tc-drop"},
            },
        ]
    )
    with mock.patch.object(regression_suite, "get_dataset", return_value=dataset):
        delete_test_case("exp-1", "tc-drop")

    dataset.delete_records.assert_called_once_with(["rec-2"])


def test_delete_test_case_is_noop_when_id_not_found():
    import pandas as pd

    dataset = mock.Mock()
    dataset.to_df.return_value = pd.DataFrame(
        [
            {
                "dataset_record_id": "rec-1",
                "expectations": {"test_case_id": "tc-1"},
            },
        ]
    )
    with mock.patch.object(regression_suite, "get_dataset", return_value=dataset):
        delete_test_case("exp-1", "tc-does-not-exist")

    dataset.delete_records.assert_not_called()


def test_delete_test_case_is_noop_when_dataset_missing():
    from mlflow.exceptions import MlflowException

    not_found = MlflowException(
        "Dataset not found.",
        error_code=RESOURCE_DOES_NOT_EXIST,
    )
    with mock.patch.object(regression_suite, "get_dataset", side_effect=not_found):
        delete_test_case("exp-1", "tc-anything")
