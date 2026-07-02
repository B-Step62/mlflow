"""
Generate traces using PURE OTel SDK and send them to Tempo.
No MLflow imported. No MLflow involved. Just OTel -> Tempo.

Usage:
    uv run .agent/poc/generate.py           # 1 trace
    uv run .agent/poc/generate.py --count 30  # 30 traces
"""

import argparse
import json
import random
import sys
import time

import requests
from opentelemetry import trace
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor

TEMPO_OTLP = "http://localhost:4318/v1/traces"
TEMPO_API = "http://localhost:3200"

QUESTIONS = [
    "What is MLflow?",
    "How do I track experiments?",
    "What is the model registry?",
    "How does MLflow tracing work?",
    "What are MLflow recipes?",
    "How do I deploy a model with MLflow?",
    "What is MLflow Evaluate?",
    "How do I use MLflow with PyTorch?",
    "What are MLflow plugins?",
    "How do I set up a tracking server?",
    "What is an MLflow experiment?",
    "How do I log metrics in MLflow?",
    "What are MLflow artifacts?",
    "How does autologging work?",
    "What is MLflow Projects?",
    "How do I compare runs in MLflow?",
    "What LLM providers does MLflow support?",
    "How do I create a custom scorer?",
    "What is the MLflow AI Gateway?",
    "How do I use MLflow with LangChain?",
    "What is prompt engineering in MLflow?",
    "How do I version prompts?",
    "What are MLflow system metrics?",
    "How do I use the MLflow CLI?",
    "What is MLflow Spark integration?",
    "How do I export traces?",
    "What is an MLflow run?",
    "How do I use tags in MLflow?",
    "What databases does MLflow support?",
    "How do I migrate from MLflow 1.x to 2.x?",
]

SERVICES = ["rag-app", "chatbot", "qa-service", "agent-pipeline", "search-assistant"]
MODELS = ["gpt-4o", "gpt-4o-mini", "claude-sonnet-4-20250514", "llama-3.1-70b", "gemini-2.0-flash"]


def check_tempo():
    try:
        requests.get(f"{TEMPO_API}/ready", timeout=2)
    except requests.ConnectionError:
        print("Tempo is not running. Start it with:")
        print("  docker compose -f .agent/poc/docker-compose.yml up -d")
        sys.exit(1)


def generate_one(tracer, question, model):
    SPAN_TYPE = "mlflow.spanType"
    INPUTS = "mlflow.spanInputs"
    OUTPUTS = "mlflow.spanOutputs"

    docs = [
        {"id": f"doc{i}", "text": f"Relevant document {i} for: {question}"}
        for i in range(random.randint(1, 4))
    ]
    answer = {"answer": f"Here is the answer to: {question}", "model": model}

    with tracer.start_as_current_span("rag_pipeline") as root:
        root.set_attribute(SPAN_TYPE, "CHAIN")
        root.set_attribute(INPUTS, json.dumps({"question": question}))

        with tracer.start_as_current_span("retrieve") as retriever_span:
            retriever_span.set_attribute(SPAN_TYPE, "RETRIEVER")
            retriever_span.set_attribute(INPUTS, json.dumps({"query": question}))
            time.sleep(random.uniform(0.005, 0.02))
            retriever_span.set_attribute(OUTPUTS, json.dumps(docs))

        with tracer.start_as_current_span("generate_answer") as llm_span:
            llm_span.set_attribute(SPAN_TYPE, "LLM")
            llm_span.set_attribute(
                INPUTS,
                json.dumps({"question": question, "context": docs}),
            )
            time.sleep(random.uniform(0.005, 0.03))
            llm_span.set_attribute(OUTPUTS, json.dumps(answer))

        root.set_attribute(OUTPUTS, json.dumps(answer))

    return f"{root.context.trace_id:032x}"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--count", type=int, default=1)
    args = parser.parse_args()

    check_tempo()

    service = random.choice(SERVICES)
    resource = Resource.create({"service.name": service})
    provider = TracerProvider(resource=resource)
    exporter = OTLPSpanExporter(endpoint=TEMPO_OTLP)
    provider.add_span_processor(BatchSpanProcessor(exporter))
    trace.set_tracer_provider(provider)
    tracer = trace.get_tracer(service)

    trace_ids = []
    for i in range(args.count):
        question = QUESTIONS[i % len(QUESTIONS)]
        model = random.choice(MODELS)
        tid = generate_one(tracer, question, model)
        trace_ids.append(tid)
        print(f"  [{i+1}/{args.count}] {tid} - {question[:40]}")

    provider.shutdown()
    print(f"\n{args.count} traces sent to Tempo (service: {service})")

    # Wait for last trace to be ingested
    print("Waiting for Tempo to ingest...")
    last_id = trace_ids[-1]
    for attempt in range(10):
        time.sleep(2)
        resp = requests.get(
            f"{TEMPO_API}/api/traces/{last_id}",
            headers={"Accept": "application/json"},
        )
        if resp.status_code == 200:
            print(f"Tempo confirmed ingestion")
            break
    else:
        print("Tempo did not confirm in time")

    if args.count == 1:
        print(f"\nVerify: uv run .agent/poc/verify.py {trace_ids[0]}")


if __name__ == "__main__":
    main()
