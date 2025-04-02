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

def test_bedrock_agent_stream_wrapper():
    from mlflow.entities import SpanType
    from mlflow.tracing.utils import start_client_span_or_trace
    from mlflow.bedrock.stream import AgentStreamWrapper

    client = mlflow.MlflowClient()
    span = start_client_span_or_trace(
        client=client,
        name="Bedrock.invoke_agent",
        inputs={"ok": "ok"},
        span_type=SpanType.AGENT,
    )
    for event in AgentStreamWrapper(
        stream=iter([{'trace': {'agentAliasId': 'V6IRD89ZAU',
   'agentId': 'NNYQ5U1T9L',
   'agentVersion': '2',
   'callerChain': [{'agentAliasArn': 'arn:aws:bedrock:us-west-2:023440809699:agent-alias/NNYQ5U1T9L/V6IRD89ZAU'}],
   'sessionId': 'test',
   'trace': {'orchestrationTrace': {'modelInvocationInput': {'inferenceConfiguration': {'maximumLength': 2048,
       'stopSequences': ['</invoke>', '</answer>', '</error>'],
       'temperature': 0.0,
       'topK': 250,
       'topP': 1.0},
      'text': '',
      'traceId': 'dbb8a892-ec90-4217-ae85-97e8ecb9a764-0',
      'type': 'ORCHESTRATION'}}}}},
 {'trace': {'agentAliasId': 'V6IRD89ZAU',
   'agentId': 'NNYQ5U1T9L',
   'agentVersion': '2',
   'callerChain': [{'agentAliasArn': 'arn:aws:bedrock:us-west-2:023440809699:agent-alias/NNYQ5U1T9L/V6IRD89ZAU'}],
   'sessionId': 'test',
   'trace': {'orchestrationTrace': {'modelInvocationOutput': {'metadata': {'usage': {'inputTokens': 2106,
        'outputTokens': 10}},
      'rawResponse': {'content': '{"stop_sequence":"</answer>","model":"claude-3-5-sonnet-20240620","usage":{"input_tokens":2106,"output_tokens":10,"cache_read_input_tokens":null,"cache_creation_input_tokens":null},"type":"message","id":"msg_bdrk_01UGfGWxvjjhJcnbyDeMN38Y","content":[{"imageSource":null,"reasoningTextSignature":null,"reasoningRedactedContent":null,"name":null,"type":"text","id":null,"source":null,"input":null,"is_error":null,"text":"<answer>Sorry I cannot answer","content":null,"reasoningText":null,"guardContent":null,"tool_use_id":null}],"role":"assistant","stop_reason":"stop_sequence"}'},
      'traceId': 'dbb8a892-ec90-4217-ae85-97e8ecb9a764-0'}}}}},
 {'trace': {'agentAliasId': 'V6IRD89ZAU',
   'agentId': 'NNYQ5U1T9L',
   'agentVersion': '2',
   'callerChain': [{'agentAliasArn': 'arn:aws:bedrock:us-west-2:023440809699:agent-alias/NNYQ5U1T9L/V6IRD89ZAU'}],
   'sessionId': 'test',
   'trace': {'orchestrationTrace': {'observation': {'finalResponse': {'text': 'Sorry I cannot answer'},
      'traceId': 'dbb8a892-ec90-4217-ae85-97e8ecb9a764-0',
      'type': 'FINISH'}}}}},
 {'chunk': {'bytes': b'Sorry I cannot answer'}}]),
        span=span,
        client=client,
        inputs=None,
    ):
        pass
    assert len(get_traces()) == 1
    assert len(get_traces()[0].data.spans) == 3

