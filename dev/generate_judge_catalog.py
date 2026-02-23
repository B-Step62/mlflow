"""Generate the Judge Catalog JSON data from Python scorer class definitions.

This script introspects MLflow's built-in scorer classes and third-party metric
registries to produce a static JSON file consumed by the frontend catalog UI.

Usage:
    uv run python dev/generate_judge_catalog.py
"""

import inspect
import json
import re
import sys
from pathlib import Path

# Ensure the project root is on sys.path so that mlflow submodules resolve correctly
# when running this script via `uv run python dev/generate_judge_catalog.py`.
_PROJECT_ROOT = str(Path(__file__).resolve().parent.parent)
if _PROJECT_ROOT not in sys.path:
    sys.path.insert(0, _PROJECT_ROOT)

OUTPUT_PATH = Path(
    "mlflow/server/js/src/experiment-tracking/pages/experiment-scorers/catalog/judgeCatalogData.json"
)

# ---------------------------------------------------------------------------
# Tag mapping: scorer name pattern → tags
# ---------------------------------------------------------------------------
TAG_MAPPING: dict[str, list[str]] = {
    # MLflow built-in scorers
    "RetrievalRelevance": ["rag", "retrieval"],
    "RetrievalSufficiency": ["rag", "retrieval"],
    "RetrievalGroundedness": ["rag", "retrieval"],
    "ToolCallEfficiency": ["tool-use", "agent"],
    "ToolCallCorrectness": ["tool-use", "agent"],
    "Guidelines": ["general"],
    "ExpectationsGuidelines": ["general"],
    "RelevanceToQuery": ["general"],
    "Safety": ["safety"],
    "Correctness": ["comparison"],
    "Fluency": ["text-quality"],
    "Equivalence": ["comparison"],
    "Completeness": ["general"],
    "Summarization": ["text-quality"],
    "UserFrustration": ["conversation"],
    "ConversationCompleteness": ["conversation"],
    "ConversationalSafety": ["conversation", "safety"],
    "ConversationalToolCallEfficiency": ["conversation", "tool-use"],
    "ConversationalRoleAdherence": ["conversation"],
    "ConversationalGuidelines": ["conversation"],
    "KnowledgeRetention": ["conversation"],
    # RAGAS metrics
    "ContextPrecision": ["rag", "retrieval"],
    "ContextUtilization": ["rag", "retrieval"],
    "NonLLMContextPrecisionWithReference": ["rag", "retrieval", "deterministic"],
    "ContextRecall": ["rag", "retrieval"],
    "NonLLMContextRecall": ["rag", "retrieval", "deterministic"],
    "ContextEntityRecall": ["rag", "retrieval"],
    "NoiseSensitivity": ["rag", "retrieval"],
    "AnswerRelevancy": ["rag", "general"],
    "Faithfulness": ["rag"],
    "AnswerAccuracy": ["comparison"],
    "ContextRelevance": ["rag", "retrieval"],
    "ResponseGroundedness": ["rag"],
    "TopicAdherence": ["agent"],
    "ToolCallAccuracy": ["tool-use", "agent"],
    "ToolCallF1": ["tool-use", "agent"],
    "AgentGoalAccuracyWithReference": ["agent", "comparison"],
    "AgentGoalAccuracyWithoutReference": ["agent"],
    "FactualCorrectness": ["comparison"],
    "SemanticSimilarity": ["comparison"],
    "NonLLMStringSimilarity": ["comparison", "deterministic"],
    "BleuScore": ["comparison", "deterministic"],
    "CHRFScore": ["comparison", "deterministic"],
    "RougeScore": ["comparison", "deterministic"],
    "StringPresence": ["comparison", "deterministic"],
    "ExactMatch": ["comparison", "deterministic"],
    "AspectCritic": ["general"],
    "DiscreteMetric": ["general"],
    "RubricsScore": ["general"],
    "InstanceSpecificRubrics": ["general"],
    "SummarizationScore": ["text-quality"],
    # DeepEval metrics
    "TaskCompletion": ["agent"],
    "ToolCorrectness": ["tool-use", "agent"],
    "ArgumentCorrectness": ["tool-use", "agent"],
    "StepEfficiency": ["agent"],
    "PlanAdherence": ["agent"],
    "PlanQuality": ["agent"],
    "TurnRelevancy": ["conversation"],
    "RoleAdherence": ["conversation"],
    "ConversationCompleteness_deepeval": ["conversation"],
    "GoalAccuracy": ["agent"],
    "ToolUse": ["tool-use", "agent"],
    "Bias": ["safety"],
    "Toxicity": ["safety"],
    "NonAdvice": ["safety"],
    "Misuse": ["safety"],
    "PIILeakage": ["safety", "guardrail"],
    "RoleViolation": ["safety"],
    "Hallucination": ["rag"],
    "JsonCorrectness": ["general", "deterministic"],
    "PromptAlignment": ["general"],
    "PatternMatch": ["comparison", "deterministic"],
    # DeepEval-specific ContextualRecall etc.
    "ContextualRecall": ["rag", "retrieval"],
    "ContextualPrecision": ["rag", "retrieval"],
    "ContextualRelevancy": ["rag", "retrieval"],
    # TruLens metrics
    "Groundedness": ["rag"],
    "AnswerRelevance": ["rag", "general"],
    "Coherence": ["text-quality"],
    "logical_consistency": ["general"],
    "execution_efficiency": ["agent"],
    "plan_adherence": ["agent"],
    "plan_quality": ["agent"],
    "tool_selection": ["tool-use", "agent"],
    "tool_calling": ["tool-use", "agent"],
    # Phoenix metrics
    "Relevance": ["rag", "general"],
    "QA": ["general"],
    # Guardrails validators
    "ToxicLanguage": ["safety", "guardrail"],
    "NSFWText": ["safety", "guardrail"],
    "DetectJailbreak": ["safety", "guardrail"],
    "DetectPII": ["safety", "guardrail"],
    "SecretsPresent": ["safety", "guardrail"],
    "GibberishText": ["text-quality", "guardrail"],
}

# ---------------------------------------------------------------------------
# Description mapping for third-party scorers
# ---------------------------------------------------------------------------
DESCRIPTION_MAPPING: dict[str, str] = {
    # RAGAS
    "ContextPrecision": "Evaluates whether relevant context items are ranked higher.",
    "ContextUtilization": "Measures how well the generated answer utilizes the provided context.",
    "NonLLMContextPrecisionWithReference": "Non-LLM context precision using reference answers.",
    "ContextRecall": "Measures the extent to which the context aligns with the reference answer.",
    "NonLLMContextRecall": "Non-LLM context recall using string matching.",
    "ContextEntityRecall": "Measures entity-level recall between context and reference.",
    "NoiseSensitivity": "Evaluates how sensitive the model is to irrelevant context noise.",
    "AnswerRelevancy": "Measures how relevant the generated answer is to the question.",
    "Faithfulness": "Measures how faithful the generated answer is to the given context.",
    "AnswerAccuracy": "Evaluates the accuracy of the generated answer against a reference.",
    "ContextRelevance": "Evaluates the relevance of retrieved context to the question.",
    "ResponseGroundedness": "Measures whether the response is grounded in the provided context.",
    "TopicAdherence": "Evaluates whether agent responses stay on topic.",
    "ToolCallAccuracy": "Measures accuracy of tool calls against expected tool usage.",
    "ToolCallF1": "Computes F1 score for tool call predictions vs expected.",
    "AgentGoalAccuracyWithReference": "Measures agent goal achievement with reference answers.",
    "AgentGoalAccuracyWithoutReference": "Measures agent goal achievement without reference answers.",
    "FactualCorrectness": "Evaluates the factual correctness of the generated answer.",
    "SemanticSimilarity": "Measures semantic similarity between generated and reference answers.",
    "NonLLMStringSimilarity": "Measures string similarity without using an LLM.",
    "BleuScore": "Computes BLEU score between generated and reference text.",
    "CHRFScore": "Computes chrF score between generated and reference text.",
    "RougeScore": "Computes ROUGE score between generated and reference text.",
    "StringPresence": "Checks whether specific strings are present in the output.",
    "ExactMatch": "Checks for exact match between generated and reference text.",
    "AspectCritic": "Evaluates a specific aspect of the output using a custom rubric.",
    "DiscreteMetric": "Evaluates output on a discrete scale using a custom prompt.",
    "RubricsScore": "Scores output against a predefined rubric.",
    "InstanceSpecificRubrics": "Scores output using per-instance rubrics from the dataset.",
    "SummarizationScore": "Evaluates the quality of a summarization.",
    # DeepEval
    "ContextualRecall": "Measures recall of relevant information from the context.",
    "ContextualPrecision": "Measures precision of relevant information from the context.",
    "ContextualRelevancy": "Evaluates relevance of the context to the query.",
    "TaskCompletion": "Evaluates whether the agent completed the assigned task.",
    "ToolCorrectness": "Measures correctness of tool usage by the agent.",
    "ArgumentCorrectness": "Evaluates correctness of arguments passed to tools.",
    "StepEfficiency": "Measures efficiency of steps taken by the agent.",
    "PlanAdherence": "Evaluates how well the agent adhered to the plan.",
    "PlanQuality": "Measures the quality of the agent's execution plan.",
    "TurnRelevancy": "Evaluates relevance of each turn in a conversation.",
    "RoleAdherence": "Measures how well the agent maintains its assigned role.",
    "GoalAccuracy": "Evaluates accuracy of goal achievement by the agent.",
    "ToolUse": "Evaluates overall quality of tool usage by the agent.",
    "Bias": "Detects bias in the generated output.",
    "Toxicity": "Detects toxic content in the generated output.",
    "NonAdvice": "Detects if the model provides advice when it should not.",
    "Misuse": "Detects potential misuse of the AI system.",
    "PIILeakage": "Detects personally identifiable information leakage.",
    "RoleViolation": "Detects role boundary violations in responses.",
    "Hallucination": "Detects hallucinated content not supported by the context.",
    "JsonCorrectness": "Validates JSON structure and correctness of outputs.",
    "PromptAlignment": "Evaluates alignment of the response to the prompt instructions.",
    "PatternMatch": "Checks if the output matches a specified regex pattern.",
    "KnowledgeRetention": "Evaluates whether the model retains information from earlier turns.",
    "ConversationCompleteness": "Evaluates whether the assistant fully addresses all user requests.",
    "Summarization": "Evaluates the quality and accuracy of text summarization.",
    # TruLens
    "Groundedness": "Measures whether the response is grounded in the source material.",
    "AnswerRelevance": "Evaluates the relevance of the response to the prompt.",
    "Coherence": "Measures the coherence and logical flow of the text.",
    "logical_consistency": "Evaluates logical consistency of agent actions.",
    "execution_efficiency": "Measures efficiency of agent execution steps.",
    "plan_adherence": "Evaluates adherence to the planned execution strategy.",
    "plan_quality": "Measures the quality of the agent's planning.",
    "tool_selection": "Evaluates appropriateness of tool selection by the agent.",
    "tool_calling": "Evaluates correctness of tool invocations by the agent.",
    # Phoenix
    "Relevance": "Evaluates the relevance of the response to the input query.",
    "QA": "Evaluates the quality of question-answering responses.",
    # Guardrails
    "ToxicLanguage": "Detects toxic or harmful language in text.",
    "NSFWText": "Detects not-safe-for-work content in text.",
    "DetectJailbreak": "Detects jailbreak attempts in user inputs.",
    "DetectPII": "Detects personally identifiable information in text.",
    "SecretsPresent": "Detects secrets and credentials in text.",
    "GibberishText": "Detects gibberish or nonsensical text.",
}


def _camel_to_kebab(name: str) -> str:
    s = re.sub(r"([A-Z]+)([A-Z][a-z])", r"\1-\2", name)
    s = re.sub(r"([a-z0-9])([A-Z])", r"\1-\2", s)
    return s.lower()


def _get_first_sentence(docstring: str | None) -> str:
    if not docstring:
        return ""
    # Skip experimental decorator notes
    lines = [line.strip() for line in docstring.strip().split("\n")]
    # Filter out empty lines and .. Note:: lines
    content_lines = [
        line
        for line in lines
        if line and not line.startswith(".. Note::") and not line.startswith(".. note::")
    ]
    if not content_lines:
        return ""
    first_line = content_lines[0]
    # Split on period followed by space or end
    match = re.match(r"^(.+?\.)\s", first_line + " ")
    return match.group(1) if match else first_line


def _has_required_init_args(cls: type) -> bool:
    """Check if the pydantic model has required fields (no default value)."""
    try:
        cls()
        return False
    except Exception:
        return True


def _generate_mlflow_snippet(class_name: str, requires_config: bool) -> str:
    if requires_config:
        if "Guidelines" in class_name:
            return (
                f"from mlflow.genai.scorers import {class_name}\n\n"
                f'scorer = {class_name}(guidelines=["Be polite", "Be concise"])\n'
                f"results = mlflow.genai.evaluate(\n"
                f"    data=eval_dataset,\n"
                f"    scorers=[scorer],\n"
                f")"
            )
        return (
            f"from mlflow.genai.scorers import {class_name}\n\n"
            f"scorer = {class_name}()\n"
            f"results = mlflow.genai.evaluate(\n"
            f"    data=eval_dataset,\n"
            f"    scorers=[scorer],\n"
            f")"
        )
    return (
        f"from mlflow.genai.scorers import {class_name}\n\n"
        f"results = mlflow.genai.evaluate(\n"
        f"    data=eval_dataset,\n"
        f"    scorers=[{class_name}()],\n"
        f")"
    )


def _generate_3p_snippet(provider: str, metric_name: str) -> str:
    match provider:
        case "ragas":
            return (
                f"from mlflow.genai.scorers import RagasScorer\n\n"
                f'scorer = RagasScorer(metric_name="{metric_name}")\n'
                f"results = mlflow.genai.evaluate(\n"
                f"    data=eval_dataset,\n"
                f"    scorers=[scorer],\n"
                f")"
            )
        case "deepeval":
            return (
                f"from mlflow.genai.scorers import DeepEvalScorer\n\n"
                f'scorer = DeepEvalScorer(metric_name="{metric_name}")\n'
                f"results = mlflow.genai.evaluate(\n"
                f"    data=eval_dataset,\n"
                f"    scorers=[scorer],\n"
                f")"
            )
        case "trulens":
            return (
                f"from mlflow.genai.scorers import TruLensScorer\n\n"
                f'scorer = TruLensScorer(metric_name="{metric_name}")\n'
                f"results = mlflow.genai.evaluate(\n"
                f"    data=eval_dataset,\n"
                f"    scorers=[scorer],\n"
                f")"
            )
        case "phoenix":
            return (
                f"from mlflow.genai.scorers import PhoenixScorer\n\n"
                f'scorer = PhoenixScorer(metric_name="{metric_name}")\n'
                f"results = mlflow.genai.evaluate(\n"
                f"    data=eval_dataset,\n"
                f"    scorers=[scorer],\n"
                f")"
            )
        case "guardrails":
            return (
                f"from mlflow.genai.scorers import GuardrailsScorer\n\n"
                f'scorer = GuardrailsScorer(validator_name="{metric_name}")\n'
                f"results = mlflow.genai.evaluate(\n"
                f"    data=eval_dataset,\n"
                f"    scorers=[scorer],\n"
                f")"
            )
        case _:
            return ""


def _get_tags(name: str, provider: str) -> list[str]:
    key = name
    if provider == "deepeval" and name == "ConversationCompleteness":
        key = "ConversationCompleteness_deepeval"
    tags = TAG_MAPPING.get(key, [])
    if not tags:
        # Fallback: try pattern-based matching
        if name.startswith("Retrieval") or name.startswith("Context"):
            tags = ["rag", "retrieval"]
        elif name.startswith("ToolCall") or name.startswith("Tool"):
            tags = ["tool-use", "agent"]
        elif name.startswith("Conversational") or name.startswith("Conversation"):
            tags = ["conversation"]
        else:
            tags = ["general"]
    return tags


def extract_builtin_scorers() -> list[dict]:
    from mlflow.genai.scorers.builtin_scorers import _get_all_concrete_builtin_scorers

    entries = []
    for cls in _get_all_concrete_builtin_scorers():
        doc = cls.__doc__ or ""
        description = _get_first_sentence(doc)
        requires_config = _has_required_init_args(cls)

        # Check if session level by inspecting class hierarchy
        is_session = False
        instructions = ""
        try:
            instance = cls() if not requires_config else None
            if instance is not None:
                is_session = instance.is_session_level_scorer
                instructions = getattr(instance, "instructions", "") or ""
            else:
                from mlflow.genai.scorers.builtin_scorers import BuiltInSessionLevelScorer

                is_session = issubclass(cls, BuiltInSessionLevelScorer)
                # For config-requiring scorers, try with dummy values to get the template
                try:
                    if "Guidelines" in cls.__name__:
                        dummy = cls(guidelines=["<guidelines>"])
                        instructions = getattr(dummy, "instructions", "") or ""
                except Exception:
                    pass
        except Exception:
            from mlflow.genai.scorers.builtin_scorers import BuiltInSessionLevelScorer

            is_session = issubclass(cls, BuiltInSessionLevelScorer)

        entry: dict = {
            "id": f"mlflow-{_camel_to_kebab(cls.__name__)}",
            "name": cls.__name__,
            "provider": "mlflow",
            "description": description,
            "tags": _get_tags(cls.__name__, "mlflow"),
            "evaluationLevel": "session" if is_session else "span",
            "codeSnippet": _generate_mlflow_snippet(cls.__name__, requires_config),
            "canAddToExperiment": True,
            "llmTemplate": cls.__name__,
            "isSessionLevel": is_session,
            "requiresConfig": requires_config,
        }
        if instructions:
            entry["instructions"] = instructions
        entries.append(entry)
    return entries


def extract_ragas_metrics() -> list[dict]:
    from mlflow.genai.scorers.ragas.registry import _METRIC_REGISTRY

    entries = []
    for name, config in _METRIC_REGISTRY.items():
        is_deterministic = not config.requires_llm_in_constructor and not config.requires_llm_at_score_time
        tags = _get_tags(name, "ragas")
        if is_deterministic and "deterministic" not in tags:
            tags.append("deterministic")

        entries.append(
            {
                "id": f"ragas-{_camel_to_kebab(name)}",
                "name": name,
                "provider": "ragas",
                "description": DESCRIPTION_MAPPING.get(name, ""),
                "tags": tags,
                "evaluationLevel": "session" if config.is_agentic_or_multiturn else "span",
                "codeSnippet": _generate_3p_snippet("ragas", name),
                "installCommand": "pip install ragas",
                "canAddToExperiment": False,
                "isSessionLevel": config.is_agentic_or_multiturn,
            }
        )
    return entries


def extract_deepeval_metrics() -> list[dict]:
    from mlflow.genai.scorers.deepeval.registry import _METRIC_REGISTRY

    entries = []
    for name, (_, is_deterministic) in _METRIC_REGISTRY.items():
        tags = _get_tags(name, "deepeval")
        if is_deterministic and "deterministic" not in tags:
            tags.append("deterministic")

        entries.append(
            {
                "id": f"deepeval-{_camel_to_kebab(name)}",
                "name": name,
                "provider": "deepeval",
                "description": DESCRIPTION_MAPPING.get(name, ""),
                "tags": tags,
                "evaluationLevel": "span",
                "codeSnippet": _generate_3p_snippet("deepeval", name),
                "installCommand": "pip install deepeval",
                "canAddToExperiment": False,
                "isSessionLevel": False,
            }
        )
    return entries


def extract_trulens_metrics() -> list[dict]:
    from mlflow.genai.scorers.trulens.registry import _METRIC_REGISTRY

    entries = []
    for name in _METRIC_REGISTRY:
        entries.append(
            {
                "id": f"trulens-{_camel_to_kebab(name)}",
                "name": name,
                "provider": "trulens",
                "description": DESCRIPTION_MAPPING.get(name, ""),
                "tags": _get_tags(name, "trulens"),
                "evaluationLevel": "span",
                "codeSnippet": _generate_3p_snippet("trulens", name),
                "installCommand": "pip install trulens",
                "canAddToExperiment": False,
                "isSessionLevel": False,
            }
        )
    return entries


def extract_phoenix_metrics() -> list[dict]:
    from mlflow.genai.scorers.phoenix.registry import _METRIC_REGISTRY

    entries = []
    for name in _METRIC_REGISTRY:
        entries.append(
            {
                "id": f"phoenix-{_camel_to_kebab(name)}",
                "name": name,
                "provider": "phoenix",
                "description": DESCRIPTION_MAPPING.get(name, ""),
                "tags": _get_tags(name, "phoenix"),
                "evaluationLevel": "span",
                "codeSnippet": _generate_3p_snippet("phoenix", name),
                "installCommand": "pip install arize-phoenix-evals",
                "canAddToExperiment": False,
                "isSessionLevel": False,
            }
        )
    return entries


def extract_guardrails_validators() -> list[dict]:
    from mlflow.genai.scorers.guardrails.registry import _SUPPORTED_VALIDATORS

    entries = []
    for name in _SUPPORTED_VALIDATORS:
        entries.append(
            {
                "id": f"guardrails-{_camel_to_kebab(name)}",
                "name": name,
                "provider": "guardrails",
                "description": DESCRIPTION_MAPPING.get(name, ""),
                "tags": _get_tags(name, "guardrails"),
                "evaluationLevel": "span",
                "codeSnippet": _generate_3p_snippet("guardrails", name),
                "installCommand": "pip install guardrails-ai",
                "canAddToExperiment": False,
                "isSessionLevel": False,
            }
        )
    return entries


def main():
    all_entries: list[dict] = []
    extractors = [
        ("builtin", extract_builtin_scorers),
        ("ragas", extract_ragas_metrics),
        ("deepeval", extract_deepeval_metrics),
        ("trulens", extract_trulens_metrics),
        ("phoenix", extract_phoenix_metrics),
        ("guardrails", extract_guardrails_validators),
    ]
    for name, extractor in extractors:
        try:
            entries = extractor()
            all_entries.extend(entries)
            print(f"  {name}: {len(entries)} entries")
        except Exception as e:
            print(f"  {name}: FAILED - {e}")
            raise

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(json.dumps(all_entries, indent=2) + "\n")
    print(f"Generated {len(all_entries)} catalog entries → {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
