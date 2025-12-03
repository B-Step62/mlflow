import json
import logging
import os
from concurrent.futures import ThreadPoolExecutor, as_completed
from pydantic import BaseModel
import threading
from typing import Literal

import mlflow
from mlflow.entities import Feedback, Trace
from mlflow.entities.assessment import AssessmentSource, AssessmentSourceType
from mlflow.types.llm import ChatMessage


_logger = logging.getLogger(__name__)

class Evidence(BaseModel):
    type: Literal["assessment", "span"]
    entity_id: str
    trace_id: str

class Item(BaseModel):
    content: str
    evidence: Evidence

class Response(BaseModel):
    items: list[Item]

def extract_trace_summaries(run_id: str, trace_ids: list[str], user_question: str, model: str = "openai:/gpt-5-mini") -> list[Item]:
    from mlflow.metrics.genai.model_utils import _parse_model_uri
    from mlflow.genai.judges.adapters.litellm_adapter import _invoke_litellm_and_handle_tools

    # To enable tracing for the judge tools
    os.environ["MLFLOW_GENAI_EVAL_ENABLE_SCORER_TRACING"] = "true"

    provider, model_name = _parse_model_uri(model)

    _logger.info(f"Summarizing traces with model {model_name} from provider {provider}")

    results = []
    result_lock = threading.Lock()

    def _summarize_trace(trace_id: str):
        trace = mlflow.get_trace(trace_id)

        # TODO: Ask LLM that if the answer can be found from the inputs/outputs/feedbacks first, rather than letting it determine the stop condition, to avoid infinite loop risk?
        messages = [
            ChatMessage(role="system", content=_SYSTEM_PROMPT),
            ChatMessage(role="user", content=_format_user_prompt(user_question, trace)),
        ]

        # TODO: Record cost and trace in some way
        response, cost = mlflow.trace(_invoke_litellm_and_handle_tools)(
            provider=provider,
            model_name=model_name,
            messages=messages,
            trace=trace,
            num_retries=3,
            response_format=Response,
        )
        formatted_response = Response.model_validate_json(response)
        return formatted_response.items

    results = []
    with ThreadPoolExecutor(max_workers=5) as executor:
        futures = [executor.submit(_summarize_trace, trace_id) for trace_id in trace_ids]
        for future in as_completed(futures):
            results.extend(future.result())
    _logger.info(f"Extracted {len(results)} summaries")
    return results


def _format_user_prompt(user_question: str, trace: Trace) -> str:
    return _USER_PROMPT.format(
        user_question=user_question,
        trace_id=trace.info.trace_id,
        request=trace.data.spans[0].inputs,
        response=trace.data.spans[0].outputs,
        feedbacks="\n\n".join(
            json.dumps({
                "name": a.name,
                "value": a.value,
                "rationale": a.rationale,
                "assessment_id": a.assessment_id,
                "trace_id": a.trace_id,
            })
            for a in trace.info.assessments
            if isinstance(a, Feedback) and not a.name.startswith("mlflow.")
        ),
    )


_SYSTEM_PROMPT = """
# Your Role
You are a specialized agent that explores traces and returns information asked from the developer or the supervisor agent.
You will be given a trace ID and a set of tools to explore the trace, such as GetTrace, GetTraceSpan, etc.

Your task is to extract the information asked from the developer or the supervisor agent from the trace.

# Your Task

Your task is to extract the information asked from the developer or the supervisor agent from the trace.

When there are multiple distinct information can be extracted, extract all of them into the list. Note that you must not extract the same information multiple times.

Example:
- You are asked to extract the questions users are asking. -> Check the root span and extract the question from the inputs.
- You are asked about the issues in the trace. -> Check all the feedbacks (assessments) and extract the negative feedbacks.
- You are asked about the latency bottleneck in the trace. -> Check the latency of each span and extract the span with the highest latency.

# Important Notes

You will be given the following information pre-extracted from the trace. You must ALWAYS start from looking at following information before navigating more into the trace. In many case, user's question is already answered in these information. Only look at the trace if you cannot find the answer in these information.

- Request: The end input for the request.
- Response: The end output of the request..
- Feedbacks: A list of feedbacks associated with the trace.

# Response Format
Your response should be a list of items, each with a information and an evidence. The source must be one of "assessment" or "spans". The id field must be the id of the assessment or the span where you extracted the information from. The trace_id field must be the id of the trace where the assessment or the span is located.

The information should be identical to the original text in the trace if possible. If the original text is too long or the information needs to be gathered from multiple places, summarize the information into short sentences.

Example input:
```
{
    "question": "What is the topic of the question?",
    "request": "How to use MLflow prompt registry?",
    "response": "To use MLflow prompt registry, you can read the official documentation here: ...",
    "feedbacks": [
        {
            "name": "user_feedback",
            "value": False,
            "rationale": "I want the agent to tell me the actual answer, not the documentation link.",
        }
    ],
    "trace_id": "tr-456",
}
```

Example output:
[
    {
        "content": "The conversation is about how to use MLflow prompt registry.",
        "evidence": {
            "type": "request",
            "entity_id": "span-12345", <- ID of the root span object
            "trace_id": "456",
        }
    },
]

Other examples:

// e.g. if the question is about the issues in the trace
[
    {
        "content": "The user want the agent to tell me the actual answer, not the documentation link.",
        "evidence": {
            "type": "feedback",
            "id": "a-12345", <- ID of the assessment object
            "trace_id": "456",
        }
    },
]
// e.g. if the question is about the latency bottleneck in the trace
[
    {
        "content": "The slowest span is the retrieval with 1000ms latency.",
        "evidence": {
            "type": "span",
            "entity_id": "span-12345", <- ID of the span object
            "trace_id": "tr-456",
        }
    },
]
"""


_USER_PROMPT = """
<user_question>
{user_question}
</user_question>

<trace_id>
{trace_id}
</trace_id>

<request>
{request}
</request>

<response>
{response}
</response>

<feedbacks>
{feedbacks}
</feedbacks>
"""