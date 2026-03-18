import warnings
from threading import Thread

from mlflow import MlflowClient
from mlflow.entities import Metric
from mlflow.utils.autologging_utils.logging_and_warnings import (
    _WarningsController,
)
from mlflow.utils.autologging_utils.metrics_queue import (
    _metrics_queue,
    _metrics_queue_lock,
    flush_metrics_queue,
)


def test_flush_metrics_queue_is_thread_safe():
    """
    Autologging augments TensorBoard event logging hooks with MLflow `log_metric` API
    calls. To prevent these API calls from blocking TensorBoard event logs, `log_metric`
    API calls are scheduled via `_flush_queue` on a background thread. Accordingly, this test
    verifies that `_flush_queue` is thread safe.
    """

    client = MlflowClient()
    run = client.create_run(experiment_id="0")
    metric_queue_item = (run.info.run_id, Metric("foo", 0.1, 100, 1))
    _metrics_queue.append(metric_queue_item)

    # Verify that, if another thread holds a lock on the metric queue leveraged by
    # _flush_queue, _flush_queue terminates and does not modify the queue
    _metrics_queue_lock.acquire()
    flush_thread1 = Thread(target=flush_metrics_queue)
    flush_thread1.start()
    flush_thread1.join()
    assert len(_metrics_queue) == 1
    assert _metrics_queue[0] == metric_queue_item
    _metrics_queue_lock.release()

    # Verify that, if no other thread holds a lock on the metric queue leveraged by
    # _flush_queue, _flush_queue flushes the queue as expected
    flush_thread2 = Thread(target=flush_metrics_queue)
    flush_thread2.start()
    flush_thread2.join()
    assert len(_metrics_queue) == 0


def test_double_patch_does_not_overwrite(monkeypatch):
    original = warnings.showwarning
    monkeypatch.setattr(warnings, "showwarning", original)

    controller = _WarningsController()

    assert warnings.showwarning == original
    assert not controller._did_patch_showwarning

    controller.set_non_mlflow_warnings_disablement_state_for_current_thread(True)

    assert controller._did_patch_showwarning
    assert warnings.showwarning == controller._patched_showwarning

    patched_func = warnings.showwarning

    controller._modify_patch_state_if_necessary()

    assert warnings.showwarning == patched_func

    controller.set_non_mlflow_warnings_disablement_state_for_current_thread(False)

    assert warnings.showwarning == original


def test_user_showwarning_survives_patch_unpatch_cycle(monkeypatch):
    custom_handler = lambda *args, **kwargs: None
    monkeypatch.setattr(warnings, "showwarning", custom_handler)

    controller = _WarningsController()

    controller.set_non_mlflow_warnings_disablement_state_for_current_thread(True)
    assert warnings.showwarning == controller._patched_showwarning

    controller.set_non_mlflow_warnings_disablement_state_for_current_thread(False)
    assert warnings.showwarning is custom_handler
