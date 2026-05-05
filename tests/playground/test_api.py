from unittest import mock

from fastapi import FastAPI
from fastapi.testclient import TestClient

from mlflow.server.playground_api import create_playground_api_router


def create_test_client():
    app = FastAPI()
    app.include_router(create_playground_api_router())
    return TestClient(app)


def test_playground_config_endpoint_returns_agent_status():
    client = create_test_client()

    with (
        mock.patch("mlflow.server.playground_api._ensure_agent_running", return_value=False),
        mock.patch("mlflow.server.playground_api._is_agent_healthy_sync", return_value=False),
    ):
        response = client.get("/ajax-api/3.0/mlflow/playground/config")

    assert response.status_code == 200
    assert response.json()["agent_url"] == "http://127.0.0.1:8000"
    assert response.json()["agent_connected"] is False


def test_playground_probe_endpoint_updates_agent_url():
    client = create_test_client()

    with (
        mock.patch("mlflow.server.playground_api._ensure_agent_running", return_value=True),
        mock.patch("mlflow.server.playground_api._is_agent_healthy_sync", return_value=True),
    ):
        response = client.post(
            "/ajax-api/3.0/mlflow/playground/config",
            json={"agent_url": "http://127.0.0.1:9000"},
        )

    assert response.status_code == 200
    assert response.json() == {
        "connected": True,
        "agent_url": "http://127.0.0.1:9000",
    }


def test_playground_chat_endpoint_requires_messages():
    client = create_test_client()

    response = client.post("/ajax-api/3.0/mlflow/playground/chat", json={"messages": []})

    assert response.status_code == 400
    assert "non-empty list" in response.json()["detail"]


_DISPATCH_PATH = "/ajax-api/3.0/mlflow/playground/issues/dispatch"


def _valid_dispatch_payload(**overrides):
    base = {
        "rationale": "must mention §4.2 of the refund policy",
        "failing_assistant_message": "I'd be happy to help process your refund.",
        "conversation_prefix": [{"role": "user", "content": "How long do refunds take?"}],
        "experiment_id": "0",
        "source_trace_id": "tr-abc",
    }
    base.update(overrides)
    return base


def test_dispatch_returns_ids_on_success():
    client = create_test_client()
    expected = {
        "issue_id": "iss-1",
        "test_case_id": "tc-1",
        "dataset_name": "regression_suite_0",
    }
    with mock.patch(
        "mlflow.server.playground_api._dispatch_feedback",
        return_value=expected,
    ) as mock_dispatch:
        response = client.post(_DISPATCH_PATH, json=_valid_dispatch_payload())

    assert response.status_code == 200
    assert response.json() == expected
    mock_dispatch.assert_called_once()
    kwargs = mock_dispatch.call_args.kwargs
    assert kwargs["rationale"].startswith("must mention")
    assert kwargs["experiment_id"] == "0"
    assert kwargs["source_trace_id"] == "tr-abc"


def test_dispatch_rejects_blank_rationale():
    client = create_test_client()

    response = client.post(_DISPATCH_PATH, json=_valid_dispatch_payload(rationale="  "))

    assert response.status_code == 400
    assert "rationale" in response.json()["detail"]


def test_dispatch_rejects_non_list_conversation_prefix():
    client = create_test_client()

    response = client.post(_DISPATCH_PATH, json=_valid_dispatch_payload(conversation_prefix="hi"))

    assert response.status_code == 400
    assert "conversation_prefix" in response.json()["detail"]


def test_dispatch_translates_value_error_to_400():
    client = create_test_client()
    with mock.patch(
        "mlflow.server.playground_api._dispatch_feedback",
        side_effect=ValueError("experiment_id missing"),
    ):
        response = client.post(_DISPATCH_PATH, json=_valid_dispatch_payload(experiment_id=None))

    assert response.status_code == 400
    assert "experiment_id missing" in response.json()["detail"]


def test_dispatch_translates_unexpected_error_to_500():
    client = create_test_client()
    with mock.patch(
        "mlflow.server.playground_api._dispatch_feedback",
        side_effect=RuntimeError("LLM down"),
    ):
        response = client.post(_DISPATCH_PATH, json=_valid_dispatch_payload())

    assert response.status_code == 500
    assert "LLM down" in response.json()["detail"]


def test_get_test_case_returns_matched_row():
    import pandas as pd

    client = create_test_client()
    issue = mock.Mock(experiment_id="0", test_case_id="tc-1")
    dataset = mock.Mock()
    dataset.to_df.return_value = pd.DataFrame([
        {
            "inputs": {"messages": [{"role": "user", "content": "Hi"}]},
            "expectations": {
                "test_case_id": "tc-1",
                "test_spec": {"strategy": "assertion", "assertions": ["mentions §4.2"]},
                "expected_response": "We mention §4.2.",
            },
            "tags": {"issue_id": "iss-1"},
        }
    ])
    with (
        mock.patch(
            "mlflow.tracking._tracking_service.utils._get_store",
            return_value=mock.Mock(get_issue=mock.Mock(return_value=issue)),
        ),
        mock.patch(
            "mlflow.playground.regression_suite.get_or_create_regression_dataset",
            return_value=dataset,
        ),
    ):
        response = client.get("/ajax-api/3.0/mlflow/playground/issues/iss-1/test-case")

    assert response.status_code == 200
    body = response.json()
    assert body["messages"] == [{"role": "user", "content": "Hi"}]
    assert body["test_spec"]["strategy"] == "assertion"
    assert body["test_spec"]["assertions"] == ["mentions §4.2"]
    assert body["expected_response"] == "We mention §4.2."
    assert body["tags"] == {"issue_id": "iss-1"}


_QB_BASE = "/ajax-api/3.0/mlflow/playground/question-bank"


def test_question_bank_list_returns_questions_from_storage():
    client = create_test_client()
    fake_questions = [
        {"question_id": "qb-1", "content": "Q1", "dataset_record_id": "rec-1"},
        {"question_id": "qb-2", "content": "Q2", "dataset_record_id": "rec-2"},
    ]
    with mock.patch(
        "mlflow.playground.question_bank.list_questions",
        return_value=fake_questions,
    ) as m:
        response = client.get(f"{_QB_BASE}?experiment_id=exp-1")

    assert response.status_code == 200
    body = response.json()
    assert body["experiment_id"] == "exp-1"
    assert body["questions"] == fake_questions
    m.assert_called_once_with("exp-1")


def test_question_bank_add_returns_new_question_id():
    client = create_test_client()
    with mock.patch(
        "mlflow.playground.question_bank.add_question",
        return_value="qb-new",
    ) as m:
        response = client.post(
            f"{_QB_BASE}/add",
            json={"experiment_id": "exp-1", "question": "How fast?", "source_message_id": "msg-x"},
        )

    assert response.status_code == 200
    assert response.json() == {"question_id": "qb-new"}
    m.assert_called_once_with("exp-1", "How fast?", source_message_id="msg-x")


def test_question_bank_add_rejects_blank_question():
    client = create_test_client()
    response = client.post(
        f"{_QB_BASE}/add",
        json={"experiment_id": "exp-1", "question": "   "},
    )
    assert response.status_code == 400
    assert "non-empty" in response.json()["detail"]


def test_question_bank_add_rejects_missing_experiment_id():
    client = create_test_client()
    response = client.post(f"{_QB_BASE}/add", json={"question": "ok"})
    assert response.status_code == 400


def test_question_bank_delete_calls_storage_layer():
    client = create_test_client()
    with mock.patch("mlflow.playground.question_bank.delete_question") as m:
        response = client.delete(f"{_QB_BASE}/qb-1?experiment_id=exp-1")

    assert response.status_code == 200
    assert response.json() == {"deleted": "qb-1"}
    m.assert_called_once_with("exp-1", "qb-1")


def test_regression_runs_list_returns_shaped_rows():
    client = create_test_client()
    fake_run = mock.Mock(
        info=mock.Mock(run_id="run-1", start_time=100, end_time=200),
        data=mock.Mock(
            metrics={"pass_count": 9.0, "fail_count": 3.0, "pass_rate": 0.75},
            tags={"playground.agent_git_sha": "abc123def"},
        ),
    )
    with mock.patch("mlflow.tracking.client.MlflowClient") as MlflowClientCls:
        MlflowClientCls.return_value.search_runs.return_value = [fake_run]
        response = client.get("/ajax-api/3.0/mlflow/playground/regression-suite/runs?experiment_id=exp-1")

    assert response.status_code == 200
    body = response.json()
    assert body == {
        "runs": [
            {
                "run_id": "run-1",
                "started_at": 100,
                "ended_at": 200,
                "pass_count": 9,
                "fail_count": 3,
                "total_count": 12,
                "pass_rate": 0.75,
                "agent_git_sha": "abc123def",
            }
        ]
    }


def test_regression_run_snapshot_returns_artifact():
    import json as _json
    import os as _os
    import tempfile as _tempfile

    client = create_test_client()
    snapshot = {
        "kind": "regression_suite",
        "run_id": "run-1",
        "summary": {"pass_count": 1, "fail_count": 0, "total_count": 1, "pass_rate": 1.0},
        "conversations": [{"row_id": "group-0", "label": "x", "messages": [], "verdicts": []}],
    }

    def fake_download(run_id, path, tmpdir):
        local = _os.path.join(tmpdir, "regression_run.json")
        with open(local, "w") as f:
            _json.dump(snapshot, f)
        return local

    with mock.patch("mlflow.tracking.client.MlflowClient") as MlflowClientCls:
        MlflowClientCls.return_value.download_artifacts.side_effect = fake_download
        response = client.get(
            "/ajax-api/3.0/mlflow/playground/regression-suite/runs/run-1/snapshot?experiment_id=exp-1"
        )

    assert response.status_code == 200
    assert response.json() == snapshot


def test_regression_case_patch_calls_storage_layer():
    client = create_test_client()
    with mock.patch("mlflow.playground.regression_suite.update_test_case") as m:
        response = client.patch(
            "/ajax-api/3.0/mlflow/playground/regression-suite/cases/tc-1",
            json={
                "experiment_id": "exp-1",
                "question": "new q",
                "assertion": {"must_contain": ["§4.2"]},
            },
        )
    assert response.status_code == 200
    assert response.json() == {"updated": "tc-1"}
    m.assert_called_once_with(
        "exp-1",
        "tc-1",
        question="new q",
        assertion={"must_contain": ["§4.2"]},
        judge=None,
    )


def test_regression_case_patch_rejects_both_assertion_and_judge():
    client = create_test_client()
    response = client.patch(
        "/ajax-api/3.0/mlflow/playground/regression-suite/cases/tc-1",
        json={
            "experiment_id": "exp-1",
            "assertion": {"must_contain": []},
            "judge": {"criteria": "x"},
        },
    )
    assert response.status_code == 400
    assert "either" in response.json()["detail"].lower()


def test_regression_case_delete_calls_storage_layer():
    client = create_test_client()
    with mock.patch("mlflow.playground.regression_suite.delete_test_case") as m:
        response = client.delete(
            "/ajax-api/3.0/mlflow/playground/regression-suite/cases/tc-1?experiment_id=exp-1"
        )

    assert response.status_code == 200
    assert response.json() == {"deleted": "tc-1"}
    m.assert_called_once_with("exp-1", "tc-1")


def test_get_test_case_returns_404_when_no_matching_row():
    import pandas as pd

    client = create_test_client()
    issue = mock.Mock(experiment_id="0", test_case_id=None)
    dataset = mock.Mock()
    dataset.to_df.return_value = pd.DataFrame()
    with (
        mock.patch(
            "mlflow.tracking._tracking_service.utils._get_store",
            return_value=mock.Mock(get_issue=mock.Mock(return_value=issue)),
        ),
        mock.patch(
            "mlflow.playground.regression_suite.get_or_create_regression_dataset",
            return_value=dataset,
        ),
    ):
        response = client.get("/ajax-api/3.0/mlflow/playground/issues/iss-2/test-case")

    assert response.status_code == 404


def _issue_dict(issue_id: str, status: str = "todo") -> dict:
    return {"issue_id": issue_id, "experiment_id": "0", "name": issue_id, "status": status}


def test_list_issues_returns_search_results():
    client = create_test_client()
    issues = [
        mock.Mock(to_dictionary=mock.Mock(return_value=_issue_dict("iss-1", "todo"))),
        mock.Mock(to_dictionary=mock.Mock(return_value=_issue_dict("iss-2", "done"))),
    ]
    store = mock.Mock(search_issues=mock.Mock(return_value=issues))
    with mock.patch(
        "mlflow.tracking._tracking_service.utils._get_store",
        return_value=store,
    ):
        response = client.get("/ajax-api/3.0/mlflow/playground/issues?experiment_id=0")

    assert response.status_code == 200
    body = response.json()
    assert [issue["issue_id"] for issue in body["issues"]] == ["iss-1", "iss-2"]
    store.search_issues.assert_called_once_with(
        experiment_id="0",
        filter_string=None,
        max_results=200,
        include_trace_count=False,
    )


def test_list_issues_passes_state_through_as_filter_string():
    client = create_test_client()
    store = mock.Mock(search_issues=mock.Mock(return_value=[]))
    with mock.patch(
        "mlflow.tracking._tracking_service.utils._get_store",
        return_value=store,
    ):
        response = client.get(
            "/ajax-api/3.0/mlflow/playground/issues?experiment_id=0&state=in_progress"
        )

    assert response.status_code == 200
    store.search_issues.assert_called_once_with(
        experiment_id="0",
        filter_string="status = 'in_progress'",
        max_results=200,
        include_trace_count=False,
    )


def test_list_issues_translates_mlflow_exception_to_400():
    from mlflow.exceptions import MlflowException

    client = create_test_client()
    store = mock.Mock(search_issues=mock.Mock(side_effect=MlflowException("bad filter")))
    with mock.patch(
        "mlflow.tracking._tracking_service.utils._get_store",
        return_value=store,
    ):
        response = client.get("/ajax-api/3.0/mlflow/playground/issues?experiment_id=0")

    assert response.status_code == 400
    assert "bad filter" in response.json()["detail"]
    store.search_issues.assert_called_once()
