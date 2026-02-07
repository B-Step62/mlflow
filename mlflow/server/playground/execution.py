import asyncio
import json
import logging
import os
import shutil
from collections.abc import AsyncGenerator
from pathlib import Path
from typing import Any

from mlflow.assistant.types import (
    ContentBlock,
    Event,
    Message,
    TextBlock,
    ThinkingBlock,
    ToolResultBlock,
    ToolUseBlock,
)
from mlflow.server.playground.session import (
    clear_panel_process_pid,
    save_panel_process_pid,
)

_logger = logging.getLogger(__name__)

MODEL_MAP: dict[str, str] = {
    "opus": "claude-opus-4-6",
    "sonnet": "claude-sonnet-4-5-20250929",
    "haiku": "claude-haiku-4-5-20251001",
}


def _parse_message_to_event(data: dict[str, Any]) -> Event | None:
    message_type = data.get("type")
    if not message_type:
        return Event.from_error("Message missing 'type' field")

    match message_type:
        case "user":
            try:
                if isinstance(data["message"]["content"], list):
                    blocks: list[ContentBlock] = []
                    for block in data["message"]["content"]:
                        match block["type"]:
                            case "text":
                                blocks.append(TextBlock(text=block["text"]))
                            case "tool_use":
                                blocks.append(
                                    ToolUseBlock(
                                        id=block["id"],
                                        name=block["name"],
                                        input=block["input"],
                                    )
                                )
                            case "tool_result":
                                blocks.append(
                                    ToolResultBlock(
                                        tool_use_id=block["tool_use_id"],
                                        content=block.get("content"),
                                        is_error=block.get("is_error"),
                                    )
                                )
                    msg = Message(role="user", content=blocks)
                else:
                    msg = Message(role="user", content=data["message"]["content"])
                return Event.from_message(msg)
            except KeyError as e:
                return Event.from_error(f"Failed to parse user message: {e}")

        case "assistant":
            try:
                if data["message"].get("error"):
                    return Event.from_error(data["message"]["error"])

                content_blocks: list[ContentBlock] = []
                for block in data["message"]["content"]:
                    match block["type"]:
                        case "text":
                            content_blocks.append(TextBlock(text=block["text"]))
                        case "thinking":
                            content_blocks.append(
                                ThinkingBlock(
                                    thinking=block["thinking"],
                                    signature=block["signature"],
                                )
                            )
                        case "tool_use":
                            content_blocks.append(
                                ToolUseBlock(
                                    id=block["id"],
                                    name=block["name"],
                                    input=block["input"],
                                )
                            )
                        case "tool_result":
                            content_blocks.append(
                                ToolResultBlock(
                                    tool_use_id=block["tool_use_id"],
                                    content=block.get("content"),
                                    is_error=block.get("is_error"),
                                )
                            )
                return Event.from_message(Message(role="assistant", content=content_blocks))
            except KeyError as e:
                return Event.from_error(f"Failed to parse assistant message: {e}")

        case "system":
            return None

        case "error":
            try:
                error_msg = data.get("error", {}).get("message", str(data.get("error")))
                return Event.from_error(error_msg)
            except Exception as e:
                return Event.from_error(f"Failed to parse error message: {e}")

        case "result":
            try:
                return Event.from_result(
                    result=data.get("result"),
                    session_id=data["session_id"],
                )
            except KeyError as e:
                return Event.from_error(f"Failed to parse result message: {e}")

        case "stream_event":
            try:
                return Event.from_stream_event(event=data["event"])
            except KeyError as e:
                return Event.from_error(f"Failed to parse stream_event message: {e}")

        case _:
            return Event.from_error(f"Unknown message type: {message_type}")


async def stream_panel_execution(
    message: str,
    cwd: Path,
    model: str,
    allowed_tools: list[str],
    provider_session_id: str | None,
    session_id: str,
    panel_id: str,
) -> AsyncGenerator[Event, None]:
    claude_path = shutil.which("claude")
    if not claude_path:
        yield Event.from_error(
            "Claude CLI not found. Please install Claude Code CLI and ensure it's in your PATH."
        )
        return

    cmd = [claude_path, "-p", message, "--output-format", "stream-json", "--verbose"]
    cmd.extend(["--model", model])
    cmd.extend(["--permission-mode", "bypassPermissions"])
    cmd.extend(["--setting-sources", "project"])

    for tool in allowed_tools:
        cmd.extend(["--allowed-tools", tool])

    if provider_session_id:
        cmd.extend(["--resume", provider_session_id])

    process = None
    try:
        process = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            cwd=cwd,
            limit=100 * 1024 * 1024,
            env=os.environ.copy(),
        )

        if process.pid:
            save_panel_process_pid(session_id, panel_id, process.pid)

        try:
            async for line in process.stdout:
                line_str = line.decode("utf-8").strip()
                if not line_str:
                    continue

                try:
                    data = json.loads(line_str)
                    if event := _parse_message_to_event(data):
                        yield event
                except json.JSONDecodeError:
                    yield Event.from_message(Message(role="user", content=line_str))
        finally:
            clear_panel_process_pid(session_id, panel_id)

        await process.wait()

        if process.returncode == -9:
            yield Event.from_interrupted()
            return

        if process.returncode != 0:
            stderr = await process.stderr.read()
            error_msg = (
                stderr.decode("utf-8").strip()
                or f"Process exited with code {process.returncode}"
            )
            yield Event.from_error(error_msg)

    except Exception as e:
        _logger.exception("Error running Claude Code CLI")
        yield Event.from_error(str(e))
    finally:
        if process is not None and process.returncode is None:
            process.kill()
            await process.wait()
