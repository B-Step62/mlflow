# TODO: Clean up unnecessary logic from this file
"""Methods and classes for working with configuration files."""
from __future__ import annotations

from dataclasses import dataclass, field
import numbers
from typing import Any, Dict, List, Mapping, Optional, Set, Union

import yaml

from mlflow.genai.evaluation import schemas
from mlflow.genai.evaluation.custom_metrics import CustomMetric
from mlflow.genai.evaluation.agent_utils import ValidationError
from mlflow.models.evaluation.base import EvaluationMetric

BUILTIN_ASSESSMENTS_KEY = "builtin_assessments"
IS_DEFAULT_CONFIG_KEY = "is_default_config"

EVALUATOR_CONFIG__METRICS_KEY = "metrics"
EVALUATOR_CONFIG__GLOBAL_GUIDELINES_KEY = "global_guidelines"
ALLOWED_EVALUATOR_CONFIG_KEYS = {
    EVALUATOR_CONFIG__METRICS_KEY,
    EVALUATOR_CONFIG__GLOBAL_GUIDELINES_KEY,
}

EVALUATOR_CONFIG_ARGS__EXTRA_METRICS_KEY = "extra_metrics"

JSON_STR__METRICS_KEY = "metrics"
JSON_STR__CUSTOM_METRICS_KEY = "custom_metrics"
JSON_STR__GLOBAL_GUIDELINES_KEY = "global_guidelines"


@dataclass
class _BaseEvaluationConfig:
    is_default_config: bool
    custom_metrics: List[CustomMetric] = field(
        default_factory=list
    )
    global_guidelines: Optional[Dict[str, List[str]]] = None


@dataclass
class ItemEvaluationConfig(_BaseEvaluationConfig):
    assessment_configs: List[AssessmentConfig] = field(
        default_factory=list
    )


@dataclass
class GlobalEvaluationConfig(_BaseEvaluationConfig):
    """Abstraction for `evaluation` config"""

    global_assessment_configs: List[AssessmentConfig] = field(default_factory=list)
    per_item_assessments: dict[
        str,
        list[
            Union[AssessmentConfig, CustomMetric]
        ],
    ] = field(default_factory=dict)  # key: question_id, value: list of assessments (used for monitoring job only)

    def __post_init__(self):
        if self.global_assessment_configs is None:
            self.global_assessment_configs = []

        if self.per_item_assessments is None:
            self.per_item_assessments = {}

        # At most one of global_assessment_configs or per_item_assessment_configs can be non-empty.
        if self.global_assessment_configs and self.per_item_assessments:
            raise ValidationError(
                "GlobalEvaluationConfig cannot have both global and per-item assessment configs."
            )

    @classmethod
    def _from_dict(cls, config_dict: Mapping[str, Any]):
        if BUILTIN_ASSESSMENTS_KEY not in config_dict:
            raise ValidationError(
                f"Invalid config {config_dict}: `{BUILTIN_ASSESSMENTS_KEY}` required."
            )

        try:
            builtin_assessment_configs = config_dict.get(BUILTIN_ASSESSMENTS_KEY, [])

            # Global guidelines
            global_guidelines = config_dict.get(
                EVALUATOR_CONFIG__GLOBAL_GUIDELINES_KEY, None
            )
            # Run guideline adherence judge if global guidelines are provided
            if (
                global_guidelines is not None
                and GLOBAL_GUIDELINE_ADHERENCE.assessment_name
                not in builtin_assessment_configs
            ):
                builtin_assessment_configs.append(
                    GLOBAL_GUIDELINE_ADHERENCE.assessment_name
                )

            builtin_assessment_configs = (
                create_builtin_assessment_configs(
                    builtin_assessment_configs
                )
            )
        except (TypeError, KeyError, ValueError) as error:
            raise ValidationError(
                f"Invalid config `{config_dict[BUILTIN_ASSESSMENTS_KEY]}`: {error}"
            )
        # Handle errors internally as we don't want to surface that
        # the extra metrics are handled as a "config"
        extra_metrics = config_dict.get(EVALUATOR_CONFIG_ARGS__EXTRA_METRICS_KEY, None)
        # EvaluationMetric classes, i.e. from make_genai_metric_from_prompt. @metric functions
        # are handled separately.
        legacy_custom_assessment_configs = (
            create_custom_eval_metric_assessment_configs(
                extra_metrics
            )
        )
        assessment_confs = builtin_assessment_configs + legacy_custom_assessment_configs
        all_names = [
            assessment_conf.assessment_name for assessment_conf in assessment_confs
        ]
        dups = {name for name in all_names if all_names.count(name) > 1}
        if dups:
            raise ValidationError(
                f"Invalid config `{config_dict}`: assessment names must be unique. Found duplicate assessment names: {dups}"
            )

        # Custom metrics
        custom_metrics = [
            metric
            for metric in extra_metrics or []
            if isinstance(metric, CustomMetric)
        ]
        seen_custom_metric_names = set()
        for metric in custom_metrics:
            if metric.name in seen_custom_metric_names:
                raise ValidationError(
                    f"Invalid config `{config_dict}`: custom metric names must be unique. Found duplicate custom metric name: {metric.name}"
                )
            seen_custom_metric_names.add(metric.name)

        try:
            result = cls(
                is_default_config=config_dict[IS_DEFAULT_CONFIG_KEY],
                global_assessment_configs=assessment_confs,
                custom_metrics=custom_metrics,
                global_guidelines=global_guidelines,
            )
        except (TypeError, KeyError, ValueError) as error:
            raise ValidationError(
                f"Invalid config `{config_dict}`: {error}"
            )

        return result

    @classmethod
    def from_mlflow_evaluate_args(
        cls,
        evaluator_config: Optional[Mapping[str, Any]],
        extra_metrics: Optional[List[Any]] = None,
    ) -> "GlobalEvaluationConfig":
        """Reads the config from an evaluator config"""
        if evaluator_config is None:
            evaluator_config = {}

        invalid_keys = set(evaluator_config.keys()) - ALLOWED_EVALUATOR_CONFIG_KEYS
        if invalid_keys:
            raise ValidationError(
                f"Invalid keys in evaluator config: {', '.join(invalid_keys)}. "
                f"Allowed keys: {ALLOWED_EVALUATOR_CONFIG_KEYS}"
            )

        if EVALUATOR_CONFIG__METRICS_KEY in evaluator_config:
            metrics_list = evaluator_config[EVALUATOR_CONFIG__METRICS_KEY]
            if not isinstance(metrics_list, list) or not all(
                isinstance(metric, str) for metric in metrics_list
            ):
                raise ValidationError(
                    f"Invalid metrics: {metrics_list}. "
                    f"Must be a list of metric names."
                )
            config_dict = {
                BUILTIN_ASSESSMENTS_KEY: metrics_list,
                IS_DEFAULT_CONFIG_KEY: False,
            }
        else:
            config_dict = default_config_dict()
            config_dict[IS_DEFAULT_CONFIG_KEY] = True

        if EVALUATOR_CONFIG__GLOBAL_GUIDELINES_KEY in evaluator_config:
            global_guidelines = evaluator_config[
                EVALUATOR_CONFIG__GLOBAL_GUIDELINES_KEY
            ]

            # Convert list of guidelines to a default mapping
            global_guidelines_mapping = (
                {
                    GLOBAL_GUIDELINE_ADHERENCE.user_facing_assessment_name: global_guidelines
                }
                if isinstance(global_guidelines, list)
                else global_guidelines
            )

            config_dict[EVALUATOR_CONFIG__GLOBAL_GUIDELINES_KEY] = (
                global_guidelines_mapping
            )

        if extra_metrics is not None:
            config_dict[EVALUATOR_CONFIG_ARGS__EXTRA_METRICS_KEY] = extra_metrics

        return cls._from_dict(config_dict)

    def to_dict(self):
        builtin_configs = [
            conf
            for conf in self.global_assessment_configs
            if isinstance(conf, BuiltinAssessmentConfig)
        ]
        metric_names = [conf.assessment_name for conf in builtin_configs]
        output_dict = {
            JSON_STR__METRICS_KEY: metric_names,
        }
        if self.global_guidelines:
            output_dict[JSON_STR__GLOBAL_GUIDELINES_KEY] = self.global_guidelines
        if self.custom_metrics:
            output_dict[JSON_STR__CUSTOM_METRICS_KEY] = [
                metric.name for metric in self.custom_metrics
            ]

        return output_dict

    def get_eval_item_eval_config(self, question_id: str) -> ItemEvaluationConfig:
        """Returns the evaluation config for a specific question_id.

        If the request does not have a specific config, it defaults to
        using the global config to generate the ItemEvaluationConfig.

        Note that global evaluation configs are not allowed to have
        both global and per-item assessment configs. This is enforced by
        the `__post_init__` method of this class.

        Args:
            question_id (str): The question ID to get the config for.

        Returns:
            ItemEvaluationConfig: The config for evaluating a given request.
        """
        if not self.per_item_assessments:
            assessment_configs = self.global_assessment_configs
            custom_metrics = self.custom_metrics
        elif question_id not in self.per_item_assessments:
            raise ValidationError(
                f"No per-item assessment configs found for question (question_id=`{question_id}`)."
            )
        else:
            assessment_configs = [
                assessment
                for assessment in self.per_item_assessments[question_id]
                if isinstance(assessment, AssessmentConfig)
            ]
            custom_metrics = [
                assessment
                for assessment in self.per_item_assessments[question_id]
                if isinstance(assessment, CustomMetric)
            ]
        return ItemEvaluationConfig(
            is_default_config=self.is_default_config,
            assessment_configs=assessment_configs,
            custom_metrics=custom_metrics,
            global_guidelines=self.global_guidelines,
        )


def default_config() -> str:
    """Returns the default config (in YAML)"""
    return """
builtin_assessments:
  - safety
  - groundedness
  - correctness
  - relevance_to_query
  - chunk_relevance
  - context_sufficiency
  - guideline_adherence
"""


def default_config_dict() -> Dict[str, Any]:
    """Returns the default config as a dictionary"""
    return yaml.safe_load(default_config())


def unnecessary_metrics_with_expected_response_or_expected_facts() -> Set[str]:
    """
    Returns a list of unnecessary metrics to not run when expected response or expected facts are
    provided. In this case, we can skip relevance to query and chunk relevance because their ground
    truth counterparts, correctness and context sufficiency, are more informative.
    """
    return {
        RELEVANCE_TO_QUERY.assessment_name,
        CHUNK_RELEVANCE.assessment_name,
    }


def metrics_requiring_ground_truth_or_expected_facts() -> Set[str]:
    """
    Returns a list of unnecessary metrics to not run when no ground truth, or expected facts, or
    grading notes are provided. In this case, we can skip correctness and context sufficiency
    because they require ground truth or expected facts (or grading notes for correctness). Instead,
    we run their less informative counterparts, relevance to query and chunk relevance.
    """
    return {
        CORRECTNESS.assessment_name,
        CONTEXT_SUFFICIENCY.assessment_name,
    }




"""All the internal configs."""


METRIC_METADATA__ASSESSMENT_TYPE = "assessment_type"
METRIC_METADATA__SCORE_THRESHOLD = "score_threshold"


@dataclass(frozen=True)
class BinaryConversion:
    """
    Conversion for the result of an assessment to a binary result.
    """

    threshold: float
    """
    Threshold value for converting to the binary.
    If not None, it means the output of the metric can be converted to a binary result.
    """
    greater_is_true: bool = field(default=True)
    """
    Whether to convert to True when the metric value is greater than the threshold or vice versa.
    If True, the binary result is True when the metric value score is greater than or equal to the threshold.
    If False, the binary result is True when the metric value score is less than or equal to the threshold.
    """

    def convert(self, score: Any) -> Optional[bool]:
        """
        Convert the score to a binary result based on the threshold and greater_is_true.

        If the score is not a real number, return None.
        """
        if isinstance(score, numbers.Real):
            # noinspection PyTypeChecker
            return (
                score >= self.threshold
                if self.greater_is_true
                else score <= self.threshold
            )
        else:
            return None



class AssessmentType(str):
    """Type of the assessment."""

    RETRIEVAL = "RETRIEVAL"
    """Assessment for a retrieved chunk. This is used to assess the quality of retrieval over a single chunk."""
    RETRIEVAL_LIST = "RETRIEVAL_LIST"
    """Assessment for all retrievals. This is used to assess the quality of retrieval over the whole context."""
    ANSWER = "ANSWER"
    """Assessment for answer. This is used to assess the quality of answer."""


class AssessmentInputRequirements(str):
    ASSESSMENT_INPUT_REQUIREMENTS_UNSPECIFIED = (
        "ASSESSMENT_INPUT_REQUIREMENTS_UNSPECIFIED"
    )
    CHAT_REQUEST = "CHAT_REQUEST"
    CHAT_RESPONSE = "CHAT_RESPONSE"
    RETRIEVAL_CONTEXT = "RETRIEVAL_CONTEXT"
    GROUND_TRUTH_CHAT_RESPONSE = "GROUND_TRUTH_CHAT_RESPONSE"
    GROUND_TRUTH_RETRIEVAL_CONTEXT = "GROUND_TRUTH_RETRIEVAL_CONTEXT"
    GRADING_NOTES = "GRADING_NOTES"
    EXPECTED_FACTS = "EXPECTED_FACTS"
    GUIDELINES = "GUIDELINES"

    @classmethod
    def to_user_facing_column_name(
        cls, input_requirement: "AssessmentInputRequirements"
    ) -> str:
        match input_requirement:
            case cls.CHAT_REQUEST:
                return schemas.REQUEST_COL
            case cls.CHAT_RESPONSE:
                return schemas.RESPONSE_COL
            case cls.RETRIEVAL_CONTEXT:
                return schemas.RETRIEVED_CONTEXT_COL
            case cls.GROUND_TRUTH_CHAT_RESPONSE:
                return schemas.EXPECTED_RESPONSE_COL
            case cls.GROUND_TRUTH_RETRIEVAL_CONTEXT:
                return schemas.EXPECTED_RETRIEVED_CONTEXT_COL
            case cls.GRADING_NOTES:
                return schemas.GRADING_NOTES_COL
            case cls.EXPECTED_FACTS:
                return schemas.EXPECTED_FACTS_COL
            case cls.GUIDELINES:
                return schemas.GUIDELINES_COL
            case _:
                raise ValueError(f"Unrecognized input requirement: {input_requirement}")


@dataclass(frozen=True)
class AssessmentInputRequirementExpression:
    required: List[AssessmentInputRequirements] = field(default_factory=list)
    """Required columns for the assessment."""

    at_least_one_of: List[AssessmentInputRequirements] = field(default_factory=list)
    """At least one of the columns is required for the assessment."""

    at_most_one_of: List[AssessmentInputRequirements] = field(default_factory=list)
    """At most one of the columns should be provided for the assessment."""

    @classmethod
    def get_user_facing_requirement_names(
        cls, requirements: List[AssessmentInputRequirements]
    ) -> List[str]:
        return [
            AssessmentInputRequirements.to_user_facing_column_name(requirement)
            for requirement in requirements
        ]


@dataclasses.dataclass(frozen=True)
class AssessmentConfig:
    assessment_name: str

    assessment_type: AssessmentType

    flip_rating: bool = field(default=False)
    """Whether to flip the rating from the service."""

    # TODO(ML-44244): Call the /chat-assessments-definitions endpoints to get input requirements
    require_question: bool = field(default=False)
    """Whether the assessment requires input to be present in the dataset to eval."""

    require_answer: bool = field(default=False)
    """Whether the assessment requires output to be present in the dataset to eval."""

    require_retrieval_context: bool = field(default=False)
    """Whether the assessment requires retrieval context to be present in the dataset to eval."""

    require_retrieval_context_array: bool = field(default=False)
    """Whether the assessment requires retrieval context array to be present in the dataset to eval."""

    require_ground_truth_answer: bool = field(default=False)
    """Whether the assessment requires ground truth answer to be present in the dataset to eval."""

    require_ground_truth_answer_or_expected_facts: bool = field(default=False)
    """Whether the assessment requires ground truth answer or expected facts to be present in the dataset to eval."""

    require_guidelines: bool = field(default=False)
    """Whether the assessment requires guidelines to be present in the dataset to eval."""


@dataclasses.dataclass(frozen=True)
class BuiltinAssessmentConfig(AssessmentConfig):
    """
    Assessment represents a method to assess the quality of a RAG system.

    The method is defined by an MLflow EvaluationMetric object.
    """

    user_facing_assessment_name: Optional[str] = field(default=None)
    """If the service uses a different assessment name than the client, this is the user-facing name."""

    def __hash__(self):
        """
        Allow this object to be used as a key in a dictionary.
        """
        return hash(self.assessment_name)


@dataclass(frozen=True)
class EvaluationMetricAssessmentConfig(AssessmentConfig):
    """
    Represents a provided evaluation metric assessment configuration.

    This is used to represent an assessment that is provided by the user as an MLflow EvaluationMetric object.
    """

    binary_conversion: Optional[BinaryConversion] = field(default=None)
    """
    Configs how the result can be converted to binary.
    None if the result is not for converting to binary.
    """

    evaluation_metric: EvaluationMetric = field(default=None)

    @classmethod
    def from_eval_metric(cls, evaluation_metric: EvaluationMetric):
        """
        Create a EvaluationMetricAssessmentConfig object from an MLflow EvaluationMetric object.
        """
        try:
            assessment_type = AssessmentType(
                evaluation_metric.metric_metadata.get(
                    METRIC_METADATA__ASSESSMENT_TYPE, ""
                ).upper()
            )
        except Exception:
            raise ValidationError(
                f"Invalid assessment type in evaluation metric: {evaluation_metric.name}. Evaluation metric "
                f"must contain metric metadata with key 'assessment_type' and value 'RETRIEVAL', 'RETRIEVAL_LIST', or 'ANSWER'."
            )

        threshold = evaluation_metric.metric_metadata.get(
            METRIC_METADATA__SCORE_THRESHOLD, 3
        )

        return cls(
            assessment_name=evaluation_metric.name,
            assessment_type=AssessmentType(assessment_type),
            evaluation_metric=evaluation_metric,
            binary_conversion=BinaryConversion(
                threshold=threshold, greater_is_true=evaluation_metric.greater_is_better
            ),
        )

    def __hash__(self):
        """
        Allow this object to be used as a key in a dictionary.
        """
        return hash(self.assessment_name)


def create_builtin_assessment_configs(
    assessment_list: List[str],
) -> List[BuiltinAssessmentConfig]:
    """
    Parse a list of builtin assessments (and optional examples) into a list of BuiltinAssessmentConfigs
    """

    assessment_configs = []
    for assessment_name in assessment_list:
        builtin_assessment_conf = (
            get_builtin_assessment_config_with_eval_assessment_name(assessment_name)
        )

        assessment_configs.append(builtin_assessment_conf)

    return assessment_configs


def create_custom_eval_metric_assessment_configs(
    eval_metrics: Optional[List[EvaluationMetric]],
) -> List[EvaluationMetricAssessmentConfig]:
    """
    Create AssessmentJudge objects from a list of custom evaluation metrics.
    """
    if eval_metrics is None:
        return []
    return [
        EvaluationMetricAssessmentConfig.from_eval_metric(metric)
        for metric in eval_metrics
        if isinstance(metric, mlflow.models.EvaluationMetric)
    ]


# ================ Builtin Assessments ================
GROUNDEDNESS = BuiltinAssessmentConfig(
    assessment_name="groundedness",
    assessment_type=AssessmentType.ANSWER,
    require_question=True,
    require_answer=True,
    require_retrieval_context=True,
)

CORRECTNESS = BuiltinAssessmentConfig(
    assessment_name="correctness",
    assessment_type=AssessmentType.ANSWER,
    require_question=True,
    require_answer=True,
    require_ground_truth_answer_or_expected_facts=True,
)

HARMFULNESS = BuiltinAssessmentConfig(
    assessment_name="harmfulness",
    user_facing_assessment_name="safety",
    assessment_type=AssessmentType.ANSWER,
    require_answer=True,
    flip_rating=True,
)

RELEVANCE_TO_QUERY = BuiltinAssessmentConfig(
    assessment_name="relevance_to_query",
    assessment_type=AssessmentType.ANSWER,
    require_question=True,
    require_answer=True,
)

CONTEXT_SUFFICIENCY = BuiltinAssessmentConfig(
    assessment_name="context_sufficiency",
    assessment_type=AssessmentType.RETRIEVAL_LIST,
    require_question=True,
    require_ground_truth_answer_or_expected_facts=True,
    require_retrieval_context=True,
)

CHUNK_RELEVANCE = BuiltinAssessmentConfig(
    assessment_name="chunk_relevance",
    assessment_type=AssessmentType.RETRIEVAL,
    require_question=True,
    require_retrieval_context_array=True,
)

GUIDELINE_ADHERENCE = BuiltinAssessmentConfig(
    assessment_name="guideline_adherence",
    assessment_type=AssessmentType.ANSWER,
    require_question=True,
    require_answer=True,
    require_guidelines=True,
)

GLOBAL_GUIDELINE_ADHERENCE = BuiltinAssessmentConfig(
    assessment_name="guideline_adherence",
    user_facing_assessment_name="global_guideline_adherence",
    assessment_type=AssessmentType.ANSWER,
    require_question=True,
    require_answer=True,
    require_guidelines=True,
)

GUIDELINES = BuiltinAssessmentConfig(
    assessment_name="guidelines",
    assessment_type=AssessmentType.ANSWER,
    require_question=True,
    require_answer=True,
    require_guidelines=True,
)


def _builtin_assessment_configs() -> List[BuiltinAssessmentConfig]:
    """Returns the list of built-in assessment configs for default evaluation"""
    return [
        HARMFULNESS,
        GROUNDEDNESS,
        CORRECTNESS,
        RELEVANCE_TO_QUERY,
        CHUNK_RELEVANCE,
        CONTEXT_SUFFICIENCY,
        GUIDELINE_ADHERENCE,
    ]


def _all_builtin_assessment_configs() -> List[BuiltinAssessmentConfig]:
    """Returns all available built-in assessment configs including specialized ones"""
    return _builtin_assessment_configs() + [
        GUIDELINES,
    ]


def builtin_assessment_names() -> List[str]:
    """Returns the list of built-in assessment names"""
    return [
        assessment_config.assessment_name
        for assessment_config in _builtin_assessment_configs()
    ]


def builtin_answer_assessment_names() -> List[str]:
    """Returns the list of built-in answer assessment configs"""
    return [
        assessment_config.assessment_name
        for assessment_config in _builtin_assessment_configs()
        if assessment_config.assessment_type == AssessmentType.ANSWER
    ]


def builtin_retrieval_assessment_names() -> List[str]:
    """Returns the list of built-in retrieval assessment configs"""
    return [
        assessment_config.assessment_name
        for assessment_config in _builtin_assessment_configs()
        if assessment_config.assessment_type == AssessmentType.RETRIEVAL
    ]


def builtin_retrieval_list_assessment_names() -> List[str]:
    """Returns the list of built-in retrieval assessment configs"""
    return [
        assessment_config.assessment_name
        for assessment_config in _builtin_assessment_configs()
        if assessment_config.assessment_type == AssessmentType.RETRIEVAL_LIST
    ]


def get_builtin_assessment_config_with_service_assessment_name(
    name: str,
) -> BuiltinAssessmentConfig:
    """
    Returns the built-in assessment config with the given service assessment name
    :param name: The service assessment name of the assessment
    :returns: The built-in assessment config
    """
    for assessment_config in _all_builtin_assessment_configs():
        if assessment_config.assessment_name == name:
            return assessment_config

    all_available_names = [
        config.assessment_name for config in _all_builtin_assessment_configs()
    ]
    raise ValueError(
        f"Assessment '{name}' not found in the builtin assessments. "
        f"Available assessments: {all_available_names}."
    )


def get_builtin_assessment_config_with_eval_assessment_name(
    name: str,
) -> BuiltinAssessmentConfig:
    """
    Returns the built-in assessment config with the given eval assessment name
    :param name: The eval assessment name of the assessment
    :returns: The built-in assessment config
    """
    available_assessment_names = []
    for assessment_config in _all_builtin_assessment_configs():
        eval_assessment_name = (
            assessment_config.user_facing_assessment_name
            if assessment_config.user_facing_assessment_name is not None
            else assessment_config.assessment_name
        )
        if eval_assessment_name == name:
            return assessment_config

        available_assessment_names.append(eval_assessment_name)

    raise ValueError(
        f"Assessment '{name}' not found in the builtin assessments. "
        f"Available assessments: {available_assessment_names}."
    )


def needs_flip(service_assessment_name: str) -> bool:
    """Returns whether the rating needs to be flipped for a given assessment."""
    return get_builtin_assessment_config_with_service_assessment_name(
        service_assessment_name
    ).flip_rating