import mlflow
from mlflow.insights.jobs.run import generate_insight_report


mlflow.set_tracking_uri("http://localhost:5000")
mlflow.set_experiment("Insight Sandbox")


if __name__ == "__main__":
    run_id = generate_insight_report(
        trace_ids=["tr-8646cc97c0a1507455c44b764100185a"],
        user_question="What is the topic of the question?",
        model="openai:/databricks-gpt-5",
    )
    print(run_id)