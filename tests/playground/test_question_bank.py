from unittest import mock

import pandas as pd
import pytest

from mlflow.exceptions import MlflowException
from mlflow.playground import question_bank
from mlflow.playground.question_bank import (
    QUESTION_BANK_DATASET_PREFIX,
    add_question,
    delete_question,
    get_or_create_question_bank,
    list_questions,
    question_bank_dataset_name,
)
from mlflow.protos.databricks_pb2 import (
    INVALID_PARAMETER_VALUE,
    RESOURCE_DOES_NOT_EXIST,
    ErrorCode,
)


def test_question_bank_dataset_name_uses_experiment_id():
    assert question_bank_dataset_name("0") == f"{QUESTION_BANK_DATASET_PREFIX}0"
    assert question_bank_dataset_name("us-transfer-concierge") == (
        f"{QUESTION_BANK_DATASET_PREFIX}us-transfer-concierge"
    )


def test_get_or_create_returns_existing_dataset_when_present():
    existing = mock.Mock(name="existing_dataset")
    with (
        mock.patch.object(question_bank, "get_dataset", return_value=existing) as m_get,
        mock.patch.object(question_bank, "create_dataset") as m_create,
    ):
        result = get_or_create_question_bank("exp-1")

    assert result is existing
    m_get.assert_called_once_with(name="question_bank_exp-1")
    m_create.assert_not_called()


def test_get_or_create_creates_dataset_when_missing():
    not_found = MlflowException(
        "Dataset with name 'question_bank_exp-1' not found.",
        error_code=RESOURCE_DOES_NOT_EXIST,
    )
    created = mock.Mock(name="created_dataset")
    with (
        mock.patch.object(question_bank, "get_dataset", side_effect=not_found) as m_get,
        mock.patch.object(question_bank, "create_dataset", return_value=created) as m_create,
    ):
        result = get_or_create_question_bank("exp-1")

    assert result is created
    m_get.assert_called_once_with(name="question_bank_exp-1")
    m_create.assert_called_once_with(name="question_bank_exp-1", experiment_id="exp-1")


def test_get_or_create_reraises_unexpected_mlflow_exception():
    boom = MlflowException("permission denied", error_code=INVALID_PARAMETER_VALUE)
    with (
        mock.patch.object(question_bank, "get_dataset", side_effect=boom),
        mock.patch.object(question_bank, "create_dataset") as m_create,
    ):
        with pytest.raises(MlflowException, match="permission denied") as exc_info:
            get_or_create_question_bank("exp-1")

    assert exc_info.value.error_code == ErrorCode.Name(INVALID_PARAMETER_VALUE)
    m_create.assert_not_called()


def test_add_question_writes_inputs_only_record_and_returns_id():
    dataset = mock.Mock()
    with mock.patch.object(question_bank, "get_or_create_question_bank", return_value=dataset):
        question_id = add_question("exp-1", "How long do refunds take?")

    assert question_id.startswith("qb-")
    dataset.merge_records.assert_called_once()
    [records] = dataset.merge_records.call_args.args
    assert len(records) == 1
    record = records[0]
    assert record["inputs"] == {
        "messages": [{"role": "user", "content": "How long do refunds take?"}]
    }
    # Inputs-only — no expectations key.
    assert "expectations" not in record
    assert record["tags"] == {"question_id": question_id, "source_message_id": ""}


def test_add_question_threads_through_source_message_id():
    dataset = mock.Mock()
    with mock.patch.object(question_bank, "get_or_create_question_bank", return_value=dataset):
        question_id = add_question(
            "exp-1",
            "Refund policy §4.2?",
            source_message_id="msg-abc",
        )

    [records] = dataset.merge_records.call_args.args
    assert records[0]["tags"] == {
        "question_id": question_id,
        "source_message_id": "msg-abc",
    }


def test_list_questions_returns_empty_when_dataset_missing():
    not_found = MlflowException(
        "Dataset with name 'question_bank_exp-1' not found.",
        error_code=RESOURCE_DOES_NOT_EXIST,
    )
    with mock.patch.object(question_bank, "get_dataset", side_effect=not_found):
        assert list_questions("exp-1") == []


def test_list_questions_shapes_rows_and_drops_orphans():
    dataset = mock.Mock()
    dataset.to_df.return_value = pd.DataFrame(
        [
            {
                "dataset_record_id": "rec-1",
                "inputs": {"messages": [{"role": "user", "content": "Q1"}]},
                "tags": {"question_id": "qb-1", "source_message_id": "msg-a"},
                "created_time": 100,
            },
            {
                "dataset_record_id": "rec-2",
                "inputs": {"messages": [{"role": "user", "content": "Q2"}]},
                "tags": {"question_id": "qb-2", "source_message_id": ""},
                "created_time": 200,
            },
            {
                # Orphan — no question_id tag, should be dropped.
                "dataset_record_id": "rec-orphan",
                "inputs": {"messages": [{"role": "user", "content": "lost"}]},
                "tags": {},
                "created_time": 50,
            },
        ]
    )
    with mock.patch.object(question_bank, "get_dataset", return_value=dataset):
        rows = list_questions("exp-1")

    assert [r["question_id"] for r in rows] == ["qb-1", "qb-2"]
    assert rows[0]["content"] == "Q1"
    assert rows[0]["source_message_id"] == "msg-a"
    assert rows[1]["source_message_id"] is None  # blank tag → None


def test_delete_question_resolves_record_id_and_calls_delete_records():
    dataset = mock.Mock()
    dataset.to_df.return_value = pd.DataFrame(
        [
            {
                "dataset_record_id": "rec-1",
                "inputs": {"messages": [{"role": "user", "content": "Q1"}]},
                "tags": {"question_id": "qb-1"},
            },
            {
                "dataset_record_id": "rec-2",
                "inputs": {"messages": [{"role": "user", "content": "Q2"}]},
                "tags": {"question_id": "qb-2"},
            },
        ]
    )
    with mock.patch.object(question_bank, "get_dataset", return_value=dataset):
        delete_question("exp-1", "qb-2")

    dataset.delete_records.assert_called_once_with(["rec-2"])


def test_delete_question_is_noop_when_id_not_found():
    dataset = mock.Mock()
    dataset.to_df.return_value = pd.DataFrame(
        [
            {
                "dataset_record_id": "rec-1",
                "inputs": {"messages": [{"role": "user", "content": "Q1"}]},
                "tags": {"question_id": "qb-1"},
            },
        ]
    )
    with mock.patch.object(question_bank, "get_dataset", return_value=dataset):
        delete_question("exp-1", "qb-does-not-exist")

    dataset.delete_records.assert_not_called()


def test_delete_question_is_noop_when_dataset_missing():
    not_found = MlflowException(
        "Dataset with name 'question_bank_exp-1' not found.",
        error_code=RESOURCE_DOES_NOT_EXIST,
    )
    with mock.patch.object(question_bank, "get_dataset", side_effect=not_found):
        # No raise.
        delete_question("exp-1", "qb-anything")
