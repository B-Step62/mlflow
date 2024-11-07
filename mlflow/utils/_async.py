import asyncio
from threading import Thread
from typing import Any


def run_async_task(task: asyncio.Future) -> Any:
    """
    A utility function to run async tasks in a blocking manner.

    If there is no event loop running already, for example, in a model serving endpoint,
    we can simply create a new event loop and run the task there. However, in a notebook
    environment (or pytest with asyncio decoration), there is already an event loop running
    at the root level and we cannot start a new one.
    """
    if not _is_event_loop_running():
        return asyncio.new_event_loop().run_until_complete(task)
    else:
        # NB: The popular way to run async task where an event loop is already running is to
        # use nest_asyncio. However, nest_asyncio.apply() breaks the async OpenAI client
        # somehow, which is used for the most of LLM calls in LlamaIndex including Databricks
        # LLMs. Therefore, we use a hacky workaround that creates a new thread and run the
        # new event loop there. This may degrade the performance compared to the native
        # asyncio, but it should be fine because this is only used in the notebook env.
        results = None
        exception = None

        def _run():
            nonlocal results, exception

            try:
                loop = asyncio.new_event_loop()
                asyncio.set_event_loop(loop)
                results = loop.run_until_complete(task)
            except Exception as e:
                exception = e
            finally:
                loop.close()

        thread = Thread(target=_run)
        thread.start()
        thread.join()

        if exception:
            raise exception

        return results

def _is_event_loop_running() -> bool:
    try:
        loop = asyncio.get_running_loop()
        return loop is not None
    except Exception:
        return False