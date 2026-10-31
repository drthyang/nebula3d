"""The native server's memory endpoint (``GET /api/memory``, server.memory).

What the console's memory bar reads natively: the server's and its running
pipeline processes' memory against the machine's RAM, stdlib only.  The
parsers are pinned on fixtures (Linux's /proc text, macOS's rusage_info_v4
layout); the live reads run where the platform supports them.
"""

import os
import struct
import sys

import pytest
from fastapi.testclient import TestClient

from nebula3d.server import memory as mem
from nebula3d.server.app import create_app
from nebula3d.server.config import ServerConfig
from nebula3d.server.jobs import Job, JobManager

SUPPORTED = sys.platform.startswith("linux") or sys.platform == "darwin"

PROC_STATUS = """\
Name:\tpython3
State:\tS (sleeping)
VmPeak:\t 2350000 kB
VmSize:\t 2300000 kB
VmHWM:\t  812340 kB
VmRSS:\t  401200 kB
RssAnon:\t  390000 kB
Threads:\t4
"""


def test_proc_status_gives_rss_and_its_high_water_mark_in_bytes():
    got = mem.parse_proc_status(PROC_STATUS)
    assert got == mem.ProcessMemory(401200 * 1024, 812340 * 1024)


def test_proc_status_without_rss_is_not_a_measurement():
    # A kernel thread or a zombie has no VmRSS line.
    assert mem.parse_proc_status("Name:\tkthreadd\nState:\tS (sleeping)\n") is None
    assert mem.parse_proc_status("VmRSS:\t 1200 kB\n") == mem.ProcessMemory(1200 * 1024, None)


def _rusage_v4(footprint, lifetime_max, resident=0):
    raw = bytearray(304)
    struct.pack_into("<Q", raw, 16 + 6 * 8, resident)  # ri_resident_size
    struct.pack_into("<Q", raw, 72, footprint)  # ri_phys_footprint
    struct.pack_into("<Q", raw, 240, lifetime_max)  # ri_lifetime_max_phys_footprint
    return bytes(raw)


def test_rusage_v4_gives_footprint_and_its_lifetime_maximum():
    got = mem.parse_rusage_v4(_rusage_v4(510_000_000, 900_000_000, resident=520_000_000))
    assert got == mem.ProcessMemory(510_000_000, 900_000_000)


def test_a_peak_below_the_current_value_is_dropped_as_a_misread():
    assert mem.parse_rusage_v4(_rusage_v4(510_000_000, 7)).peak_bytes is None


def test_cgroup_limit():
    assert mem.parse_cgroup_limit("8589934592\n") == 8589934592
    assert mem.parse_cgroup_limit("max\n") is None


def test_the_ceiling_is_the_container_limit_when_lower(monkeypatch, tmp_path):
    monkeypatch.setattr(mem, "physical_memory_bytes", lambda: 64 * 2**30)
    monkeypatch.setattr(mem.sys, "platform", "linux")
    limit = tmp_path / "memory.max"
    real_path = mem.Path

    def fake_path(p):
        return limit if str(p) == "/sys/fs/cgroup/memory.max" else real_path(p)

    monkeypatch.setattr(mem, "Path", fake_path)
    limit.write_text("8589934592\n")
    assert mem.memory_ceiling() == (8 * 2**30, "container")
    limit.write_text("max\n")
    assert mem.memory_ceiling() == (64 * 2**30, "ram")


@pytest.mark.skipif(not SUPPORTED, reason="memory is read on Linux and macOS only")
def test_this_process_is_measured():
    got = mem.process_memory(os.getpid())
    assert got is not None
    assert 1_000_000 < got.bytes < 1 << 40
    assert got.peak_bytes is None or got.peak_bytes >= got.bytes
    assert mem.physical_memory_bytes() > got.bytes


@pytest.mark.skipif(not SUPPORTED, reason="memory is read on Linux and macOS only")
def test_a_run_process_that_has_ended_is_left_out():
    gone = 2**22 + 12345  # beyond any pid_max: no such process
    snap = mem.memory_snapshot(os.getpid(), [gone])
    assert snap["measured"] is True
    assert [p["role"] for p in snap["processes"]] == ["server"]
    assert snap["used_bytes"] == snap["processes"][0]["bytes"]


def test_nothing_is_measured_on_other_platforms(monkeypatch):
    monkeypatch.setattr(mem.sys, "platform", "win32")
    snap = mem.memory_snapshot(os.getpid(), [])
    assert snap["measured"] is False
    assert snap["kind"] is None and snap["used_bytes"] is None
    assert snap["processes"] == []


class _Proc:
    def __init__(self, pid, alive):
        self.pid, self._alive = pid, alive

    def is_alive(self):
        return self._alive


def test_live_pids_are_the_running_jobs_with_a_live_process():
    jm = JobManager()
    jm._jobs = {
        "a": Job(id="a", input_name="x", _process=_Proc(101, True)),
        "b": Job(id="b", input_name="x", status="done", _process=_Proc(102, True)),
        "c": Job(id="c", input_name="x", _process=_Proc(103, False)),
        "d": Job(id="d", input_name="x"),
    }
    assert jm.live_pids() == [101]


def test_memory_endpoint(tmp_path):
    client = TestClient(create_app(ServerConfig(data_root=tmp_path)))
    body = client.get("/api/memory").json()
    assert body["measured"] is SUPPORTED
    if SUPPORTED:
        assert body["kind"] == ("footprint" if sys.platform == "darwin" else "rss")
        (server,) = body["processes"]
        assert server["role"] == "server" and server["pid"] == os.getpid()
        assert body["used_bytes"] == server["bytes"]
        assert body["ceiling_bytes"] > body["used_bytes"]
        assert body["ceiling_source"] in ("ram", "container")
