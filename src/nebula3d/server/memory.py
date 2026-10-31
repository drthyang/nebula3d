# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Tsung-han Yang

"""The native server's memory, as the console's memory bar shows it.

Standard library only (psutil is not a dependency).  What is measured is the
memory of nebula3d's own processes: the server and each pipeline run's worker
process (``server.jobs`` runs every job in a process of its own, so the server
alone would miss the run).  The ring stage's helper processes, which a run
starts on Linux for large volumes or when ``NEBULA3D_RING_WORKERS`` asks for
them, are not counted.

- **Linux**: resident set size and its high-water mark, from
  ``/proc/<pid>/status`` (``VmRSS``, ``VmHWM``).
- **macOS**: the physical footprint (Activity Monitor's "Memory" column, which
  counts compressed pages that RSS leaves out) and its lifetime maximum, from
  libproc's ``proc_pid_rusage``.
- **Elsewhere** nothing is measured, and the console shows no bar.

The ceiling is the machine's physical RAM, or the container's memory limit when
a cgroup v2 limit is lower.  It is not a hard limit: the OS swaps past it.
"""

from __future__ import annotations

import ctypes
import ctypes.util
import os
import struct
import sys
from collections.abc import Iterable
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class ProcessMemory:
    """One process's memory now and its high-water mark (bytes; None when unknown)."""

    bytes: int
    peak_bytes: int | None


def memory_kind() -> str | None:
    """What :func:`process_memory` measures on this platform, or None if nothing."""
    if sys.platform.startswith("linux"):
        return "rss"
    if sys.platform == "darwin":
        return "footprint"
    return None


# ---------------------------------------------------------------------------
# Linux: /proc/<pid>/status
# ---------------------------------------------------------------------------
def parse_proc_status(text: str) -> ProcessMemory | None:
    """``VmRSS`` (now) and ``VmHWM`` (peak) from a ``/proc/<pid>/status`` text.

    The kernel writes both in kB (KiB).  A kernel thread or a zombie has no
    ``VmRSS`` line: None.
    """
    fields: dict[str, int] = {}
    for line in text.splitlines():
        key, _, rest = line.partition(":")
        if key in ("VmRSS", "VmHWM"):
            parts = rest.split()
            if parts and parts[0].isdigit():
                fields[key] = int(parts[0]) * 1024
    if "VmRSS" not in fields:
        return None
    return ProcessMemory(fields["VmRSS"], fields.get("VmHWM"))


def _linux_process(pid: int) -> ProcessMemory | None:
    try:
        text = Path(f"/proc/{pid}/status").read_text()
    except OSError:
        return None
    return parse_proc_status(text)


# ---------------------------------------------------------------------------
# macOS: proc_pid_rusage(pid, RUSAGE_INFO_V4, ...)
# ---------------------------------------------------------------------------
_RUSAGE_INFO_V4 = 4
# struct rusage_info_v4 (<sys/resource.h>): a 16-byte uuid, then uint64 fields.
# ri_phys_footprint is the 8th of them, ri_lifetime_max_phys_footprint the 29th.
_FOOTPRINT_OFFSET = 16 + 7 * 8  # 72
_LIFETIME_MAX_OFFSET = 16 + 28 * 8  # 240
_RUSAGE_V4_SIZE = 16 + 36 * 8  # 304
_libproc: ctypes.CDLL | None = None


def parse_rusage_v4(raw: bytes) -> ProcessMemory:
    """Footprint (now) and lifetime-maximum footprint from a ``rusage_info_v4``."""
    footprint = struct.unpack_from("<Q", raw, _FOOTPRINT_OFFSET)[0]
    peak = struct.unpack_from("<Q", raw, _LIFETIME_MAX_OFFSET)[0]
    # A peak below the current value would be a misread layout: drop it.
    return ProcessMemory(footprint, peak if peak >= footprint else None)


def _macos_process(pid: int) -> ProcessMemory | None:
    global _libproc
    try:
        if _libproc is None:
            lib = ctypes.CDLL(ctypes.util.find_library("proc") or "/usr/lib/libproc.dylib")
            lib.proc_pid_rusage.argtypes = [ctypes.c_int, ctypes.c_int, ctypes.c_void_p]
            lib.proc_pid_rusage.restype = ctypes.c_int
            _libproc = lib
        buf = ctypes.create_string_buffer(_RUSAGE_V4_SIZE)
        if _libproc.proc_pid_rusage(pid, _RUSAGE_INFO_V4, buf) != 0:
            return None  # the process is gone, or not ours
        return parse_rusage_v4(buf.raw)
    except (OSError, AttributeError):
        return None


def process_memory(pid: int) -> ProcessMemory | None:
    """*pid*'s memory (see the module docstring), or None where it can't be read."""
    kind = memory_kind()
    if kind == "rss":
        return _linux_process(pid)
    if kind == "footprint":
        return _macos_process(pid)
    return None


# ---------------------------------------------------------------------------
# The ceiling
# ---------------------------------------------------------------------------
def physical_memory_bytes() -> int | None:
    """The machine's physical RAM (Linux, macOS), or None."""
    try:
        pages = os.sysconf("SC_PHYS_PAGES")
        page = os.sysconf("SC_PAGE_SIZE")
    except (AttributeError, OSError, ValueError):
        return None
    if pages <= 0 or page <= 0:
        return None
    return int(pages) * int(page)


def parse_cgroup_limit(text: str) -> int | None:
    """A cgroup v2 ``memory.max`` value in bytes; None for ``max`` (no limit)."""
    value = text.strip()
    return int(value) if value.isdigit() else None


def memory_ceiling() -> tuple[int | None, str | None]:
    """``(bytes, source)``: the RAM, or the container's limit when that is lower."""
    ram = physical_memory_bytes()
    if sys.platform.startswith("linux"):
        try:
            limit = parse_cgroup_limit(Path("/sys/fs/cgroup/memory.max").read_text())
        except OSError:
            limit = None
        if limit is not None and (ram is None or limit < ram):
            return limit, "container"
    return (ram, "ram") if ram is not None else (None, None)


# ---------------------------------------------------------------------------
# The endpoint's body
# ---------------------------------------------------------------------------
def memory_snapshot(server_pid: int, run_pids: Iterable[int]) -> dict:
    """``GET /api/memory``: nebula3d's processes against the machine's memory.

    ``{measured, kind, used_bytes, ceiling_bytes, ceiling_source, processes:
    [{role: "server" | "run", pid, bytes, peak_bytes}]}``.  ``measured`` is
    false where nothing can be read (the console then shows no bar); a run
    process that has just ended is left out.
    """
    kind = memory_kind()
    processes: list[dict] = []
    for role, pid in [("server", server_pid), *(("run", p) for p in run_pids)]:
        mem = process_memory(pid)
        if mem is not None:
            processes.append({"role": role, "pid": pid, "bytes": mem.bytes,
                              "peak_bytes": mem.peak_bytes})
    ceiling, source = memory_ceiling()
    measured = kind is not None and any(p["role"] == "server" for p in processes)
    return {
        "measured": measured,
        "kind": kind if measured else None,
        "used_bytes": sum(p["bytes"] for p in processes) if measured else None,
        "ceiling_bytes": ceiling,
        "ceiling_source": source,
        "processes": processes if measured else [],
    }
