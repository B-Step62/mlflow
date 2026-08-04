import json
import subprocess
import sys
import textwrap
from pathlib import Path

from mlflow.server import ARTIFACTS_DESTINATION_ENV_VAR, SERVE_ARTIFACTS_ENV_VAR

from tests.tracking.integration_test_utils import _init_server

OLD_CLIENT_MLFLOW_VERSION = "3.4.0"


def test_older_mlflow_client_core_flows_against_fastapi_server(tmp_path: Path) -> None:
    backend_uri = f"sqlite:///{tmp_path / 'mlflow.db'}"
    artifact_destination = tmp_path / "proxied-artifacts"
    out_file = tmp_path / "old-client-result.json"
    client_script = tmp_path / "old_client_flow.py"
    client_script.write_text(
        textwrap.dedent(
            """
            import json
            import sys
            import uuid
            from pathlib import Path

            import mlflow
            from mlflow import MlflowClient

            tracking_uri, out_path = sys.argv[1:]
            mlflow.set_tracking_uri(tracking_uri)
            client = MlflowClient(tracking_uri)

            suffix = uuid.uuid4().hex
            experiment_id = client.create_experiment(f"old-client-compat-{suffix}")
            run = client.create_run(
                experiment_id,
                tags={"compat.tag": "old-client", "compat.suffix": suffix},
            )
            run_id = run.info.run_id

            client.log_param(run_id, "compat_param", "value")
            client.log_metric(run_id, "compat_metric", 1.25, step=3)
            client.set_tag(run_id, "compat_extra", "tag-value")

            artifact_file = Path("payload.txt")
            artifact_file.write_text("payload from old client", encoding="utf-8")
            client.log_artifact(run_id, str(artifact_file))
            client.set_terminated(run_id)

            fetched = client.get_run(run_id)
            assert fetched.data.params["compat_param"] == "value"
            assert fetched.data.tags["compat_extra"] == "tag-value"
            assert fetched.info.artifact_uri.startswith("mlflow-artifacts:/")
            assert fetched.info.status == "FINISHED"

            runs = client.search_runs(
                [experiment_id],
                "params.compat_param = 'value'",
                order_by=["metrics.compat_metric DESC"],
            )
            assert [r.info.run_id for r in runs] == [run_id]

            artifacts = client.list_artifacts(run_id)
            assert [a.path for a in artifacts] == ["payload.txt"]
            downloaded = Path(client.download_artifacts(run_id, "payload.txt"))
            assert downloaded.read_text(encoding="utf-8") == "payload from old client"

            model_name = f"old_client_compat_{suffix}"
            client.create_registered_model(model_name)
            source = f"{fetched.info.artifact_uri}/payload.txt"
            model_version = client.create_model_version(model_name, source=source, run_id=run_id)
            assert model_version.name == model_name
            assert model_version.run_id == run_id

            Path(out_path).write_text(
                json.dumps(
                    {
                        "client_version": mlflow.__version__,
                        "experiment_id": experiment_id,
                        "run_id": run_id,
                        "model_name": model_name,
                        "model_version": model_version.version,
                    },
                    sort_keys=True,
                ),
                encoding="utf-8",
            )
            """
        ),
        encoding="utf-8",
    )

    with _init_server(
        backend_uri=backend_uri,
        root_artifact_uri="mlflow-artifacts:/",
        extra_env={
            SERVE_ARTIFACTS_ENV_VAR: "true",
            ARTIFACTS_DESTINATION_ENV_VAR: artifact_destination.as_uri(),
        },
    ) as tracking_uri:
        py_ver = ".".join(map(str, sys.version_info[:2]))
        subprocess.check_call(
            [
                "uv",
                "run",
                "--isolated",
                "--no-project",
                "--index-strategy=unsafe-first-match",
                f"--python={py_ver}",
                f"--with=mlflow=={OLD_CLIENT_MLFLOW_VERSION}",
                "python",
                "-I",
                str(client_script),
                tracking_uri,
                str(out_file),
            ],
            cwd=tmp_path,
        )

    result = json.loads(out_file.read_text(encoding="utf-8"))
    assert result["client_version"] == OLD_CLIENT_MLFLOW_VERSION
    assert result["experiment_id"]
    assert result["run_id"]
    assert result["model_name"].startswith("old_client_compat_")
    assert result["model_version"] == "1"
