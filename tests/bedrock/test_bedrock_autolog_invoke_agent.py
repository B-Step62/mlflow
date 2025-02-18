import boto3
import json
import mlflow
from unittest import mock

from tests.bedrock.test_bedrock_autolog_converse import get_traces

def test_bedrock_invoke_agent_multi_agent():
    mlflow.bedrock.autolog()

    client = boto3.client("bedrock-agent-runtime", region_name="us-west-2")

    with open("tests/bedrock/resources/multi_agent_events.jsonl"):
        events = [json.loads(line) for line in f]

    def _dummy_event_stream():
        for event in events:
            yield event

    test_session_id = "session-id"

    with mock.patch(
        "botocore.client.BaseClient._make_api_call",
        return_value={
            "completion": _dummy_event_stream,
            "sessionId": test_session_id,
        },
    ):
        response = client.invoke_agent(
            agentId="agent-id",
            agentAliasId="agent-alias-id",
            sessionId="session-id",
            enableTrace=True,  # TODO: MLflow should automatically inject "enableTrace=True"
            inputText="Hello, world!",
        )

    assert get_traces() == []

    for event in response["completion"]:
        pass

    traces = get_traces()
    assert len(traces) == 1
    assert traces[0].info.status == "OK"

