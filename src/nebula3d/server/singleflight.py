# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Tsung-han Yang

"""One load for simultaneous requests of the same thing.

The server's caches (:mod:`~nebula3d.server.volumes`,
:mod:`~nebula3d.server.deltapdf`, :mod:`~nebula3d.server.consistency`,
:mod:`~nebula3d.server.laue`, :mod:`~nebula3d.server.bragg`) fill outside
their lock, as reading a volume takes seconds.  The endpoints run in a thread
pool, and a page or a Pilot check asks for several planes of several stages
at once: every request that found the cache cold used to read the whole file
itself, so one check read the same volumes many times over, all held in
memory at once.

:class:`SingleFlight` lets the first caller of a key do the work while the
others wait for it and take its result.  It keeps nothing: the caches decide
what stays, how many and for how long, as before.  The key is the cache's own
(``(path, mtime)`` and the settings), so a changed file is a new key and is
read again.

Standard library only, and no thread is started: in the browser build
(Pyodide, one thread) a call just runs.
"""

from __future__ import annotations

import threading
from collections.abc import Callable, Hashable
from typing import Generic, TypeVar

T = TypeVar("T")


class _Call(Generic[T]):
    """One load under way: its owner's thread, and what it came to."""

    __slots__ = ("abandoned", "done", "error", "owner", "value")

    def __init__(self) -> None:
        self.owner = threading.get_ident()
        self.done = threading.Event()
        self.value: T | None = None
        self.error: Exception | None = None
        self.abandoned = False


class SingleFlight:
    """Run one ``load`` per key at a time; simultaneous callers share it.

    - The first caller of a key runs ``load``; callers that arrive while it
      runs wait and return the same object.
    - ``load`` raising an ``Exception`` raises that exception in every waiter.
      Nothing is remembered: the next call runs ``load`` again.
    - ``load`` ended by anything else (``KeyboardInterrupt``, a cancellation)
      leaves the waiters to retry: one of them becomes the loader.
    - Keys are independent, so different keys load in parallel and a ``load``
      may ask for other keys.  A ``load`` that asks for its own key runs it
      directly instead of waiting for itself.
    """

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._calls: dict[Hashable, _Call] = {}

    def run(self, key: Hashable, load: Callable[[], T]) -> T:
        """``load()``, shared with every caller of *key* that arrives meanwhile."""
        while True:
            with self._lock:
                call: _Call[T] | None = self._calls.get(key)
                leads = call is None
                if call is None:
                    call = self._calls[key] = _Call()
            if leads:
                return self._lead(key, call, load)
            if call.owner == threading.get_ident():
                return load()
            call.done.wait()
            if call.abandoned:
                continue
            if call.error is not None:
                raise call.error
            return call.value  # type: ignore[return-value]

    def _lead(self, key: Hashable, call: _Call[T], load: Callable[[], T]) -> T:
        try:
            value = call.value = load()
        except Exception as exc:
            call.error = exc
            raise
        except BaseException:
            call.abandoned = True
            raise
        finally:
            with self._lock:
                del self._calls[key]
            call.done.set()
        return value

    def loading(self) -> int:
        """How many keys are loading now."""
        with self._lock:
            return len(self._calls)
