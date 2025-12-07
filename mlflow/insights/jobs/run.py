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
from mlflow.insights.jobs._extract import extract_trace_summaries
from mlflow.insights.jobs._discover_issue import discover_issues
from mlflow.insights.jobs._generate_report_title import generate_report_title
from mlflow.server.jobs import job
from mlflow.types.llm import ChatMessage

_logger = logging.getLogger(__name__)


@job(
    name="generate-insight-report",
    description="Generate an insight report for the trace.",
    max_workers=1,
    pip_requirements=["litellm"]
)
def generate_insight_report(
    filter_string: str,
    experiment_id: str,
    user_question: str,
    model: str,
) -> str:
    """
    Extract the summary of the trace.

    Args:
        run_id: The ID of the insight run. It should be started in upstream and this job resumes it.
        trace_ids: The list of trace IDs
        user_question: The question asked by the user

    Returns:
        The ID of the insight run.
    """
    mlflow.set_experiment(experiment_id)
    traces = mlflow.search_traces(
        filter_string=filter_string,
        locations=[experiment_id],
        return_type="list",
        include_spans=False,
    )

    # TODO: Remove this hard code
    model = "openai:/databricks-gpt-5-mini"
    with mlflow.start_run(tags={"mlflow.runType": "INSIGHTS"}) as run:
        # TODO: Distribute this to threads when the trace count is large
        trace_ids = [trace.info.trace_id for trace in traces]
        run_id = run.info.run_id
        summaries = extract_trace_summaries(run_id, trace_ids, user_question, model)
        # TODO: Cluster summaries when the trace count is large
        #  _cluster_trace_summaries(run_id, trace_ids, user_question, model)
        issues = discover_issues(run_id, summaries, user_question, model)
        title = generate_report_title(json.dumps(issues), user_question, model)
        mlflow.log_dict({
            "title": title,
            "report_type": "issue_identification",
            "issues": issues,
        }, "insight_report.json")
        # Metadata to be shown at the table view.
        mlflow.log_params({
            "num_issues": len(issues),
            "num_traces": len(trace_ids),
        })
        _logger.info(f"Generated report title: {title}")
    return run_id
