"""Best-effort SMTP notifications for review-queue events.

All configuration is read from environment variables and is entirely optional:
if ``MLFLOW_SMTP_HOST`` is unset, every public function here is a silent no-op.
Sends happen on a fire-and-forget daemon thread so a slow or unreachable SMTP
server never blocks (or breaks) the request that triggered the notification.

Environment variables:

- ``MLFLOW_SMTP_HOST``: SMTP server host. If unset, notifications are disabled.
- ``MLFLOW_SMTP_PORT``: SMTP server port (default ``587``).
- ``MLFLOW_SMTP_USERNAME``: SMTP username. If set, STARTTLS + login are used.
- ``MLFLOW_SMTP_PASSWORD``: SMTP password (used only when a username is set).
- ``MLFLOW_SMTP_FROM``: From address (default ``mlflow@localhost``).
- ``MLFLOW_SERVER_BASE_URL``: Base URL for deep links (default
  ``http://localhost:5000``).
"""

import logging
import os
import smtplib
import threading
from email.message import EmailMessage
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from mlflow.genai.review_queues.review_queues import ReviewQueue

_logger = logging.getLogger(__name__)

_DEFAULT_SMTP_PORT = 587
_DEFAULT_FROM = "mlflow@localhost"
_DEFAULT_BASE_URL = "http://localhost:5000"


def _smtp_enabled() -> bool:
    return bool(os.environ.get("MLFLOW_SMTP_HOST"))


def _base_url() -> str:
    return os.environ.get("MLFLOW_SERVER_BASE_URL", _DEFAULT_BASE_URL).rstrip("/")


def _deep_link(queue: "ReviewQueue") -> str:
    return (
        f"{_base_url()}/#/experiments/{queue.experiment_id}/review-queue"
        f"?selectedQueueId={queue.queue_id}&startReview=true"
    )


def _recipients(queue: "ReviewQueue") -> list[str]:
    return [u for u in (queue.users or []) if "@" in u]


def _send_async(recipients: list[str], subject: str, body: str) -> None:
    host = os.environ.get("MLFLOW_SMTP_HOST")
    if not host:
        return
    port = int(os.environ.get("MLFLOW_SMTP_PORT", _DEFAULT_SMTP_PORT))
    username = os.environ.get("MLFLOW_SMTP_USERNAME")
    password = os.environ.get("MLFLOW_SMTP_PASSWORD")
    sender = os.environ.get("MLFLOW_SMTP_FROM", _DEFAULT_FROM)

    def _run() -> None:
        try:
            message = EmailMessage()
            message["Subject"] = subject
            message["From"] = sender
            message["To"] = ", ".join(recipients)
            message.set_content(body)
            with smtplib.SMTP(host, port, timeout=10) as server:
                if username:
                    server.starttls()
                    server.login(username, password or "")
                server.send_message(message)
        except Exception as e:
            _logger.warning(f"Failed to send review-queue notification email: {e}")

    threading.Thread(target=_run, name="review-queue-notify", daemon=True).start()


def notify_queue_assignment(queue: "ReviewQueue") -> None:
    """Notify a queue's assigned users that they've been assigned to it."""
    try:
        if not _smtp_enabled():
            return
        recipients = _recipients(queue)
        if not recipients:
            return
        subject = f"You've been assigned to review queue '{queue.name}'"
        body = (
            f"You've been assigned to the review queue '{queue.name}'.\n\n{_deep_link(queue)}"
        )
        _send_async(recipients, subject, body)
    except Exception as e:
        _logger.warning(f"Failed to schedule review-queue assignment notification: {e}")


def notify_items_attached(queue: "ReviewQueue", count: int) -> None:
    """Notify a queue's assigned users that new items are ready to review."""
    try:
        if not _smtp_enabled():
            return
        recipients = _recipients(queue)
        if not recipients:
            return
        subject = f"{count} new item(s) to review in '{queue.name}'"
        body = (
            f"{count} new item(s) have been added to the review queue "
            f"'{queue.name}'.\n\n{_deep_link(queue)}"
        )
        _send_async(recipients, subject, body)
    except Exception as e:
        _logger.warning(f"Failed to schedule review-queue items notification: {e}")
