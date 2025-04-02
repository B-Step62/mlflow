import json
import logging
from typing import Any, Optional

from botocore.eventstream import EventStream

from mlflow.bedrock.chat import convert_message_to_mlflow_chat
from mlflow.bedrock.utils import capture_exception
from mlflow.entities.span import LiveSpan
from mlflow.entities.span_event import SpanEvent
from mlflow.tracing.utils import set_span_chat_messages
from mlflow.tracking.client import MlflowClient

_logger = logging.getLogger(__name__)


class BaseEventStreamWrapper:
    """
    A wrapper class for a event stream to record events and accumulated response
    in an MLflow span if possible.

    A span should be ended when the stream is exhausted rather than when it is created.

    Args:
        stream: The original event stream to wrap.
        client: The MLflow client to end the span.
        span: The span to record events and response in.
        inputs: The inputs to the converse API.
    """

    def __init__(
        self,
        stream: EventStream,
        client: MlflowClient,
        span: LiveSpan,
        inputs: Optional[dict[str, Any]] = None,
    ):
        self._stream = stream
        self._span = span
        self._client = client
        self._inputs = inputs

    def __iter__(self):
        for event in self._stream:
            self._handle_event(self._span, event)
            yield event

        # End the span when the stream is exhausted
        self._close()

    def __getattr__(self, attr):
        """Delegate all other attributes to the original stream."""
        return getattr(self._stream, attr)

    def _handle_event(self, span, event):
        """Process a single event from the stream."""
        raise NotImplementedError

    def _close(self):
        """End the span and run any finalization logic."""
        raise NotImplementedError

    @capture_exception("Failed to handle event for the stream")
    def _end_span(self):
        """End the span."""
        if self._span.parent_id:
            self._client.end_span(self._span.request_id, self._span.span_id)
        else:
            self._client.end_trace(self._span.request_id)


class InvokeModelStreamWrapper(BaseEventStreamWrapper):
    """A wrapper class for a event stream returned by the InvokeModelWithResponseStream API."""

    @capture_exception("Failed to handle event for the stream")
    def _handle_event(self, span, event):
        chunk = json.loads(event["chunk"]["bytes"])
        self._span.add_event(SpanEvent(name=chunk["type"], attributes={"json": json.dumps(chunk)}))

    def _close(self):
        self._end_span()


class ConverseStreamWrapper(BaseEventStreamWrapper):
    """A wrapper class for a event stream returned by the ConverseStream API."""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._response_builder = _ConverseMessageBuilder()

    def __getattr__(self, attr):
        """Delegate all other attributes to the original stream."""
        return getattr(self._stream, attr)

    @capture_exception("Failed to handle event for the stream")
    def _handle_event(self, span, event):
        """
        Process a single event from the stream.

        Refer to the following documentation for the event format:
        https://boto3.amazonaws.com/v1/documentation/api/1.35.8/reference/services/bedrock-runtime/client/converse_stream.html
        """
        event_name = list(event.keys())[0]
        self._response_builder.process_event(event_name, event[event_name])
        # Record raw event as a span event
        self._span.add_event(
            SpanEvent(name=event_name, attributes={"json": json.dumps(event[event_name])})
        )

    @capture_exception("Failed to record the accumulated response in the span")
    def _close(self):
        # Record the accumulated response as the output of the span
        converse_response = self._response_builder.build()
        self._span.set_outputs(converse_response)

        # Record the chat message attributes in the MLflow's standard format
        messages = self._inputs.get("messages", []) + [converse_response["output"]["message"]]
        mlflow_messages = [convert_message_to_mlflow_chat(m) for m in messages]
        set_span_chat_messages(self._span, mlflow_messages)

        self._end_span()


class _ConverseMessageBuilder:
    """A helper class to accumulate the chunks of a streaming Converse API response."""

    def __init__(self):
        self._role = "assistant"
        self._text_content_buffer = ""
        self._tool_use = {}
        self._response = {}

    def process_event(self, event_name: str, event_attr: dict):
        if event_name == "messageStart":
            self._role = event_attr["role"]
        elif event_name == "contentBlockStart":
            # ContentBlockStart event is only used for tool usage. It carries the tool id
            # and the name, but not the input arguments.
            self._tool_use = {
                # In streaming, input is always string
                "input": "",
                **event_attr["start"]["toolUse"],
            }
        elif event_name == "contentBlockDelta":
            delta = event_attr["delta"]
            if text := delta.get("text"):
                self._text_content_buffer += text
            if tool_use := delta.get("toolUse"):
                self._tool_use["input"] += tool_use["input"]
        elif event_name == "contentBlockStop":
            pass
        elif event_name == "messageStop" or event_name == "metadata":
            self._response.update(event_attr)
        else:
            _logger.debug(f"Unknown event, skipping: {event_name}")

    def build(self) -> dict[str, Any]:
        message = {
            "role": self._role,
            "content": [{"text": self._text_content_buffer}],
        }
        if self._tool_use:
            message["content"].append({"toolUse": self._tool_use})

        self._response.update({"output": {"message": message}})

        return self._response

import json
import re
import time

import mlflow
from mlflow.bedrock.chat import convert_message_to_mlflow_chat
from mlflow.entities import Document, SpanType
from mlflow.tracing.provider import detach_span_from_context, set_span_in_context
from mlflow.tracing.utils import set_span_chat_messages, start_client_span_or_trace, end_client_span_or_trace, construct_full_inputs

class AgentStreamWrapper(BaseEventStreamWrapper):
    """A wrapper class for a event stream returned by the ConverseStream API."""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)

        self._mlflow_client = mlflow.MlflowClient()

        self._current_step = -1
        self._current_step_span = None
        self._current_leaf_span = None
        self._last_event_time = time.time_ns()

    def __getattr__(self, attr):
        """Delegate all other attributes to the original stream."""
        return getattr(self._stream, attr)

    @capture_exception("Failed to handle event for the stream")
    def _handle_event(self, root_span, event):
        """
        Process a single event from the stream.

        Refer to the following documentation for the event format:
        https://boto3.amazonaws.com/v1/documentation/api/1.35.8/reference/services/bedrock-runtime/client/converse_stream.html
        """
        try:
            if trace := event.get("trace", {}).get("trace"):
                if orchestration_trace := trace.get("orchestrationTrace"):
                    if model_input := orchestration_trace.get("modelInvocationInput"):
                        self._maybe_start_new_step_span(root_span, model_input)

                        self._current_leaf_span = start_client_span_or_trace(
                            client=self._mlflow_client,
                            name="chat.completions",
                            parent_span=self._current_step_span,
                            inputs=model_input,
                            span_type=SpanType.LLM,
                        )

                        if text := model_input.get("text"):
                            raw_inputs = json.loads(text)
                            messages = raw_inputs.get("messages", [])
                            # for message in messages:
                            #     message["content"] = parse_content_str(message["content"])
                            if system := raw_inputs.get("system"):
                                messages = [{"role": "system", "content": system}] + messages
                            set_span_chat_messages(self._current_leaf_span, messages)

                    elif model_outputs := orchestration_trace.get("modelInvocationOutput"):
                        if raw_content := model_outputs.get("rawResponse").get("content"):
                            message = json.loads(raw_content)
                            message = convert_message_to_mlflow_chat(message)
                            set_span_chat_messages(self._current_leaf_span, [message], append=True)

                        end_client_span_or_trace(
                            client=self._mlflow_client,
                            span=self._current_leaf_span,
                            outputs=model_outputs,
                            attributes=model_outputs["metadata"],
                        )

                    elif invocation_input := orchestration_trace.get("invocationInput"):
                        self._maybe_start_new_step_span(root_span, invocation_input)
                        action_type = invocation_input["invocationType"]
                        if code_interpreter_input := invocation_input.get("codeInterpreterInvocationInput"):
                            self._current_leaf_span = start_client_span_or_trace(
                                client=self._mlflow_client,
                                name="code_interpreter",
                                parent_span=self._current_step_span,
                                inputs=code_interpreter_input,
                                span_type=SpanType.TOOL,
                            )

                        if action_input := invocation_input.get("actionGroupInvocationInput"):
                            self._current_leaf_span = start_client_span_or_trace(
                                client=self._mlflow_client,
                                name=action_input["actionGroupName"],
                                parent_span=self._current_step_span,
                                inputs={p["name"]: p["value"] for p in action_input["parameters"]},
                                span_type=SpanType.TOOL,
                            )

                        if knowledge_base_input := invocation_input.get("knowledgeBaseLookupInput"):
                            span = start_client_span_or_trace(
                                client=self._mlflow_client,
                                name="knowledge_base_lookup",
                                inputs=knowledge_base_input,
                                span_type=SpanType.RETRIEVER,
                            )

                    elif observation := orchestration_trace.get("observation"):
                        if code_interpreter_output := observation.get("codeInterpreterInvocationOutput"):
                            end_client_span_or_trace(
                                client=self._mlflow_client,
                                span=self._current_leaf_span,
                                outputs=code_interpreter_output,
                            )

                        if action_output := observation.get("actionGroupInvocationOutput"):
                            end_client_span_or_trace(
                                client=self._mlflow_client,
                                span=self._current_leaf_span,
                                outputs=action_output["text"], # TODO: Support other types
                            )

                        if knowledge_base_output := observation.get("knowledgeBaseLookupOutput"):
                            docs = []
                            for i, retrieved in enumerate(knowledge_base_output["retrievedReferences"]):
                                metadata = retrieved.get("metadata", {})
                                if metadata:
                                    doc_meta = {
                                        "doc_uri": retrieved["metadata"]["x-amz-bedrock-kb-source-uri"],
                                        "chunk_id": retrieved["metadata"]["x-amz-bedrock-kb-document-page-number"],
                                    }
                                else:
                                    doc_meta = {}
                                docs.append(Document(
                                    id=metadata.get("x-amz-bedrock-kb-data-source-id") or f"doc-{i}",
                                    page_content=retrieved["content"]["text"],
                                    metadata=doc_meta,
                                ))

                            end_client_span_or_trace(
                                client=self._mlflow_client,
                                span=self._current_leaf_span,
                                outputs=docs,
                            )

                        if final_response := observation.get("finalResponse"):
                            # Close last step span
                            if self._current_step_span:
                                end_client_span_or_trace(client=self._mlflow_client, span=self._current_step_span)
        except Exception as e:
            _logger.warning(f"Failed to handle event: {e}")

        self._last_event_time = time.time_ns()

        # Last event
        if chunk := event.get("chunk"):
            end_client_span_or_trace(client=self._mlflow_client, span=root_span, outputs=chunk["bytes"].decode("utf-8"))

    def _close(self):
        pass

    def _maybe_start_new_step_span(self, root_span, inputs):

        step = int(inputs["traceId"].split("-")[-1])
        if step != self._current_step:
            if self._current_step_span:
                end_client_span_or_trace(client=self._mlflow_client, span=self._current_step_span)

            step_span = start_client_span_or_trace(
                client=self._mlflow_client,
                name=f"step_{step}",
                parent_span=root_span,
                span_type=SpanType.CHAIN,
            )

            self._current_step += 1
            self._current_step_span = step_span
