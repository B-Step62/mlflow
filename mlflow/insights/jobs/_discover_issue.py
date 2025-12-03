import json
import logging
import os
from concurrent.futures import ThreadPoolExecutor, as_completed
from pydantic import BaseModel
import threading
from typing import Literal
import litellm

import mlflow
from mlflow.entities import Feedback, Trace
from mlflow.entities.assessment import AssessmentSource, AssessmentSourceType
from mlflow.insights.jobs._extract import Item, Evidence
from mlflow.types.llm import ChatMessage

_logger = logging.getLogger(__name__)



class Category(BaseModel):
    name: str
    description: str
    evidences: list[Evidence]

class Categories(BaseModel):
    categories: list[Category]



def discover_issues(
    run_id: str,
    summaries: list[Item],
    user_question: str,
    model: str,
) -> list[Categories]:
    from mlflow.metrics.genai.model_utils import _parse_model_uri
    from mlflow.genai.judges.adapters.litellm_adapter import _invoke_litellm_and_handle_tools

    # To enable tracing for the judge tools
    os.environ["MLFLOW_GENAI_EVAL_ENABLE_SCORER_TRACING"] = "true"
    mlflow.litellm.autolog()

    provider, model_name = _parse_model_uri(model)

    _logger.info(f"Discovering issues with model {model_name} from provider {provider}")

    results = []
    result_lock = threading.Lock()

    response = litellm.completion(
        model=f"{provider}/{model_name}",
        messages=[
            {
            "role": "system",
            "content": _SYSTEM_PROMPT
            },
            {
            "role": "user",
            "content": _USER_PROMPT.format(
                feedbacks="\n\n".join(item.model_dump_json() for item in summaries),
                user_question=user_question),
            },
        ],
        response_format=Categories,
    )

    llm_categories = Categories.model_validate_json(response.choices[0].message.content)
    _logger.info(f"Discovered {len(llm_categories.categories)} issues")

    def _get_severity(category: Category) -> str:
        evidence_ids = list(set(e.entity_id for e in category.evidences))
        return "high" if len(evidence_ids) / len(summaries) > 0.5 else "medium" if len(evidence_ids) / len(summaries) > 0.3 else "low"

    issues = [
        {
            "issue_id": i,
            "name": category.name,
            "description": category.description,
            "evidences": [e.model_dump() for e in category.evidences],
            "trace_ids": list(set(e.trace_id for e in category.evidences)),
            "severity": _get_severity(category)
        }
        for i, category in enumerate(llm_categories.categories)
    ]
    return issues



_SYSTEM_PROMPT = """
You are expert on categorizing and grouping issues based on the users' interests.

Your output should be a list of issue categories, each with a name, description, and list of text IDs. The category should be concrete and specific. Each category must be an atomic issue that is root caused by a single problem, rather than a generic class of problem that mixes multiple issues.

Maximum number of categories is 10. If some texts are not appropriate for any categories, you can omit them from the output. However, you should try your best to find great set of categories that covers most of the texts yet still not too vague.

Good example:
  - {"name": "Outdated answer", "description": "The referenced documents are from non-latest version of the documentation that misleads users...."}
  - {"name": "Incorrect guidance about MLflow Tracing", "description": "The guidance on MLflow tracing is not correct. Agent confuses tracing and traditional run logging...."}

Bad example:
  - {"name": "The answer is not correct or outdated.", "description": ...} <= This is not an atomic issue. 'Incorrect' and 'outdated' are two separate issues."}
  - {"name": "Unclear description", "description": ...} <= Unclear description is not concrete enough. It is better to be more specific.

Example output:
    {
        "categories": [
            {
               "name": "Outdated answer",
               "description": "The referenced documents are from non-latest version of the documentation that misleads users....",
               "evidences": [
                   {
                       "type": "feedback",
                       "id": "a-12345",
                       "trace_id": "123",
                   },
                   {
                       "type": "feedback",
                       "id": "a-12346",
                       "trace_id": "456",
                   }
               ]
            }
        ]
    }
"""

_USER_PROMPT = """
Here are the feedbacks that are associated with the trace.
{feedbacks}

User's question: {user_question}
"""
