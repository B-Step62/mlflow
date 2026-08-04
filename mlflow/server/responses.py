"""Framework-agnostic response builders for MLflow server handlers.

These return Starlette Response objects with Flask-compatible convenience
methods (``get_data``, ``get_json``) so that existing tests that call
handlers directly continue to work without modification.
"""

from __future__ import annotations

import json
import os
import stat
from typing import Any

import anyio
from starlette.background import BackgroundTask
from starlette.datastructures import Headers
from starlette.responses import FileResponse, Response, StreamingResponse


class _CompatResponse(Response):
    """Starlette Response with Flask-compatible read methods for tests."""

    def get_data(self, as_text: bool = False) -> bytes | str:
        if as_text:
            return self.body.decode("utf-8")
        return self.body

    def get_json(self) -> Any:
        return json.loads(self.body)

    @property
    def json(self) -> Any:
        return json.loads(self.body)

    @property
    def data(self) -> bytes:
        return self.body

    @data.setter
    def data(self, value: str | bytes) -> None:
        if isinstance(value, str):
            self.body = value.encode("utf-8")
        else:
            self.body = value

    @property
    def mimetype(self) -> str | None:
        return self.media_type


class _CompatFileResponse(FileResponse):
    """FileResponse with Flask-compatible read methods for tests."""

    async def __call__(self, scope, receive, send) -> None:
        background = self.background
        self.background = None
        try:
            if self.stat_result is None:
                try:
                    self.stat_result = await anyio.to_thread.run_sync(os.stat, self.path)
                except FileNotFoundError:
                    raise RuntimeError(f"File at path {self.path} does not exist.")
                if not stat.S_ISREG(self.stat_result.st_mode):
                    raise RuntimeError(f"File at path {self.path} is not a file.")
                self.set_stat_headers(self.stat_result)

            request_headers = Headers(scope=scope)
            if request_headers.get("if-none-match") == self.headers.get("etag"):
                headers = {
                    key: value
                    for key, value in self.headers.items()
                    if key.lower() in {"cache-control", "etag", "last-modified"}
                }
                await Response(status_code=304, headers=headers)(scope, receive, send)
                return

            await super().__call__(scope, receive, send)
        finally:
            if background is not None:
                await background()

    def get_data(self, as_text: bool = False) -> bytes | str:
        with open(self.path, "rb") as f:
            data = f.read()
        if as_text:
            return data.decode("utf-8")
        return data

    def get_json(self) -> Any:
        return json.loads(self.get_data())

    @property
    def mimetype(self) -> str | None:
        return self.media_type


def json_response(
    data: str, status: int = 200, headers: dict[str, str] | None = None
) -> _CompatResponse:
    return _CompatResponse(
        content=data, status_code=status, media_type="application/json", headers=headers
    )


def jsonify_response(obj: Any, status: int = 200) -> _CompatResponse:
    return json_response(json.dumps(obj), status=status)


def text_response(text: str, status: int = 200) -> _CompatResponse:
    return _CompatResponse(content=text, status_code=status, media_type="text/plain")


def empty_response(status: int = 204) -> _CompatResponse:
    return _CompatResponse(status_code=status)


def file_response(
    path_or_file,
    *,
    mimetype: str | None = None,
    as_attachment: bool = False,
    download_name: str | None = None,
    headers: dict[str, str] | None = None,
    background: BackgroundTask | None = None,
) -> _CompatResponse | _CompatFileResponse:
    if isinstance(path_or_file, (str, os.PathLike)):
        resp = _CompatFileResponse(
            path=path_or_file,
            media_type=mimetype,
            headers=headers,
            background=background,
        )
    else:
        content = path_or_file.read()
        resp = _CompatResponse(
            content=content,
            media_type=mimetype,
            headers=headers,
            background=background,
        )
    return resp


class _CompatStreamingResponse(StreamingResponse):
    """StreamingResponse with Flask-compatible ``.response`` property for tests."""

    def __init__(self, *args, **kwargs):
        self._sync_generator = kwargs.pop("_sync_generator", None)
        super().__init__(*args, **kwargs)

    @property
    def response(self):
        if self._sync_generator is not None:
            return self._sync_generator
        return self.body_iterator


def streaming_response(
    generator,
    headers: dict[str, str] | None = None,
    media_type: str | None = None,
) -> _CompatStreamingResponse:
    return _CompatStreamingResponse(
        content=generator, headers=headers, media_type=media_type, _sync_generator=generator
    )
