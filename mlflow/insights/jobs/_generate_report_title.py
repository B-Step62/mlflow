import json
import logging
import litellm
from pydantic import BaseModel

_logger = logging.getLogger(__name__)

# Generate report title with LLM
title_generation_prompt = """
Generate a short (less than 10 words) minimal title for the following report generated from user's request. The title must strongly reflect the user's request.

User's question: {question}
Report content: {content}
"""

class TitleGenerationResponse(BaseModel):
    title: str

def generate_report_title(
    content: str,
    user_question: str,
    model: str = "openai:/gpt-5-mini",
) -> str:
    from mlflow.metrics.genai.model_utils import _parse_model_uri
    from mlflow.genai.judges.adapters.litellm_adapter import _invoke_litellm_and_handle_tools

    provider, model_name = _parse_model_uri(model)

    _logger.info(f"Generating report title with model {model_name} from provider {provider}")

    response = litellm.completion(
        model=f"{provider}/{model_name}",
        messages=[
            {
                "role": "user",
                "content": title_generation_prompt.format(question=user_question, content=content)
            }
        ],
        response_format=TitleGenerationResponse,
    )
    response = TitleGenerationResponse.model_validate_json(response.choices[0].message.content)
    _logger.info(f"Generated report title: {response.title}")
    return response.title
