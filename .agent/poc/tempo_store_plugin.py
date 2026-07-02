import os


def create_store(store_uri, artifact_uri=None):
    trace_store_url = os.environ.get("MLFLOW_TRACE_STORE_URL")
    if trace_store_url:
        from tempo_store import TempoTrackingStore

        return TempoTrackingStore(store_uri, artifact_uri)

    from mlflow.store.tracking.sqlalchemy_store import SqlAlchemyStore

    return SqlAlchemyStore(store_uri, artifact_uri)
