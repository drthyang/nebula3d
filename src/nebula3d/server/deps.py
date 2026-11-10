# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Tsung-han Yang

"""FastAPI dependencies."""

from __future__ import annotations

from fastapi import Request

from nebula3d.server.config import ServerConfig


def get_config(request: Request) -> ServerConfig:
    """Return the :class:`ServerConfig` stored on the app at startup."""
    return request.app.state.config  # type: ignore[no-any-return]


def etag_matches(request: Request, tag: str) -> bool:
    """Whether the request's If-None-Match names *tag* (or ``*``)."""
    header = request.headers.get("if-none-match")
    if not header:
        return False
    names = {t.strip().removeprefix("W/") for t in header.split(",")}
    return tag in names or "*" in names
