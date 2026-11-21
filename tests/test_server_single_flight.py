"""Simultaneous requests for the same thing share one load.

The endpoints run in a thread pool, and a page or a Pilot check asks for
several planes of several stages at once.  Every cache the server fills
outside its lock (volumes, ΔPDFs, the consistency round trip, and the small
per-volume answers) loads once for the requests that arrive together; an
error reaches each of them and is not kept; another key is not held up; and a
file that changed (a new mtime) is read again.
"""

import os
import threading
import time

import numpy as np
import pytest
from fastapi.testclient import TestClient

import nebula3d
from nebula3d.analysis import bragg_fill_texture, bragg_sense, coverage, dpdf_features, ub_refine
from nebula3d.demo import demo_volume
from nebula3d.io import save_delta_pdf
from nebula3d.pipeline import DeltaPdfParams, PipelineParams, pipeline_paths
from nebula3d.preprocessing import flatten_floors, ring_isotropy, ring_survey
from nebula3d.server import bragg as bragg_mod
from nebula3d.server import consistency as cons_mod
from nebula3d.server import deltapdf as dpdf_mod
from nebula3d.server import laue as laue_mod
from nebula3d.server import volumes as vol_mod
from nebula3d.server.app import create_app
from nebula3d.server.config import ServerConfig
from nebula3d.server.singleflight import SingleFlight

N = 8
WAIT = 20.0  # seconds before a stuck thread fails its test instead of hanging it
STEM = "sample_300K_test_cc_sub_bkg"
SLUG = "sample-300K-test-cc-sub-bkg"


class Gate:
    """Wraps a loader: counts its calls and holds each until :meth:`open`."""

    def __init__(self, inner, error: Exception | None = None):
        self.inner, self.error = inner, error
        self.calls = 0
        self.entered = threading.Event()
        self._open = threading.Event()
        self._lock = threading.Lock()

    def __call__(self, *args, **kwargs):
        with self._lock:
            self.calls += 1
        self.entered.set()
        assert self._open.wait(WAIT), "the gate never opened"
        if self.error is not None:
            raise self.error
        return self.inner(*args, **kwargs)

    def open(self) -> None:
        self._open.set()


def together(call, gate: Gate, n: int = N) -> list:
    """*call* from *n* threads at once: all of them have asked before the
    first load is let through.  Returns each thread's result, or the
    exception it raised."""
    out: list = [None] * n
    asked = threading.Barrier(n + 1)

    def work(i: int) -> None:
        asked.wait(WAIT)
        try:
            out[i] = call()
        except Exception as exc:  # noqa: BLE001 - the test reads it
            out[i] = exc

    threads = [threading.Thread(target=work, args=(i,)) for i in range(n)]
    for t in threads:
        t.start()
    asked.wait(WAIT)
    assert gate.entered.wait(WAIT)
    time.sleep(0.2)  # the others reach the cold cache while the first load is held
    gate.open()
    for t in threads:
        t.join(WAIT)
    assert not any(t.is_alive() for t in threads), "a request never returned"
    return out


@pytest.fixture
def files(tmp_path):
    """A small volume (the demo crystal) as two stages, and a ΔPDF."""
    (tmp_path / "raw").mkdir()
    (tmp_path / "processed").mkdir()
    paths = pipeline_paths(tmp_path / "raw" / f"{STEM}.nxs", proc_dir=tmp_path / "processed")
    vol = demo_volume(41)
    nebula3d.save(vol, paths.braggpunched)
    nebula3d.save(vol, paths.backfilled)
    rng = np.random.default_rng(0)
    axis = np.linspace(-10, 10, 21)
    save_delta_pdf(paths.delta_pdf, rng.normal(size=(21, 21, 21)), axis, axis, axis,
                   ub_matrix=vol.ub_matrix, logs={"q_max": 8.0})
    _clear()
    yield paths
    _clear()


def _clear() -> None:
    vol_mod.release()
    vol_mod._survey_cache.clear()
    dpdf_mod.clear_cache()
    cons_mod.clear_cache()
    laue_mod.clear_cache()
    bragg_mod._sense_cache.clear()


# Each cache: the function the endpoints call, and the loader inside it
# (module, attribute) that must run once for simultaneous callers.
SITES = {
    "volume": (lambda p: vol_mod.load_volume(p.backfilled), (nebula3d, "load")),
    "delta_pdf": (lambda p: dpdf_mod.load_dpdf(p.delta_pdf), (dpdf_mod, "load_delta_pdf")),
    "delta_pdf_floor": (lambda p: dpdf_mod.dpdf_floor(p.delta_pdf),
                        (dpdf_features, "sigma_outside_origin")),
    "consistency": (
        lambda p: cons_mod.reconstruction(
            cons_mod.ViewInput(p.backfilled, DeltaPdfParams(), {}), None, None),
        (cons_mod, "consistency_reconstruction")),
    "coverage": (lambda p: vol_mod.volume_coverage(p.backfilled),
                 (coverage, "q_coverage")),
    "ub": (lambda p: vol_mod.volume_ub_check(p.backfilled),
           (ub_refine, "check_ub")),
    "ring_isotropy": (lambda p: vol_mod.volume_ring_isotropy(p.backfilled, [(1.0, 0.1)]),
                      (ring_isotropy, "judge_shells")),
    "ring_survey": (lambda p: vol_mod.volume_ring_survey(p.backfilled),
                    (ring_survey, "survey_rings")),
    "shell_floors": (lambda p: vol_mod.volume_shell_floors(p.backfilled),
                     (flatten_floors, "shell_floors")),
    "texture": (lambda p: vol_mod.volume_texture(p.backfilled, p.braggpunched)["n_holes"],
                (bragg_fill_texture, "hole_texture")),
    "bragg_sense": (lambda p: bragg_mod.volume_bragg_sense(p.backfilled, PipelineParams()),
                    (bragg_sense, "sense_bragg")),
    "laue": (lambda p: laue_mod.laue_compare(p.backfilled, PipelineParams()),
             (laue_mod, "compare_laue_classes")),
}


def _gate(monkeypatch, target, error: Exception | None = None) -> Gate:
    module, name = target
    gate = Gate(getattr(module, name), error)
    monkeypatch.setattr(module, name, gate)
    return gate


@pytest.mark.parametrize("site", SITES)
def test_simultaneous_requests_load_once_and_share_the_result(site, files, monkeypatch):
    call, target = SITES[site]
    gate = _gate(monkeypatch, target)

    got = together(lambda: call(files), gate)

    assert gate.calls == 1
    assert not any(isinstance(g, Exception) for g in got), got
    if site == "texture":  # the holes are shared; each request judges them itself
        assert len(set(got)) == 1
    else:
        assert all(g is got[0] for g in got)
    # Cached now: asking again loads nothing.
    call(files)
    assert gate.calls == 1


@pytest.mark.parametrize("site", SITES)
def test_a_failed_load_reaches_every_waiter_and_is_not_kept(site, files, monkeypatch):
    call, target = SITES[site]
    boom = OSError("the file went away")
    gate = _gate(monkeypatch, target, boom)

    got = together(lambda: call(files), gate)

    assert gate.calls == 1
    assert all(g is boom for g in got), got
    # The next request tries again, and succeeds once the loader does.
    gate.error = None
    call(files)
    assert gate.calls == 2
    call(files)
    assert gate.calls == 2


def test_different_files_load_in_parallel(files, monkeypatch):
    # Each load waits for the other to have started: loads held one after
    # the other would never meet.
    real = nebula3d.load
    meet = threading.Barrier(2)

    def load(path, *args, **kwargs):
        meet.wait(WAIT)
        return real(path, *args, **kwargs)

    monkeypatch.setattr(nebula3d, "load", load)
    out: dict = {}

    def work(path) -> None:
        try:
            out[path] = vol_mod.load_volume(path)
        except Exception as exc:  # noqa: BLE001
            out[path] = exc

    threads = [threading.Thread(target=work, args=(p,))
               for p in (files.backfilled, files.braggpunched)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(WAIT)
    assert not any(isinstance(v, Exception) for v in out.values()), out
    assert len(out) == 2


def test_a_changed_file_is_read_again(files, monkeypatch):
    gate = _gate(monkeypatch, (nebula3d, "load"))
    gate.open()
    path = files.backfilled
    first = vol_mod.load_volume(path)
    assert vol_mod.load_volume(path) is first and gate.calls == 1

    stamp = os.stat(path).st_mtime + 5
    os.utime(path, (stamp, stamp))
    second = vol_mod.load_volume(path)
    assert gate.calls == 2 and second is not first
    assert vol_mod.load_volume(path) is second and gate.calls == 2


def test_a_load_may_ask_for_other_cached_objects(files, monkeypatch):
    # The fill texture loads two volumes inside its own load, and the
    # consistency round trip one: simultaneous requests for all three end
    # with one read of each file.
    gate = _gate(monkeypatch, (nebula3d, "load"))
    gate.open()
    calls = [lambda: vol_mod.volume_texture(files.backfilled, files.braggpunched),
             lambda: vol_mod.volume_coverage(files.backfilled),
             lambda: vol_mod.volume_shell_floors(files.backfilled, files.braggpunched),
             lambda: vol_mod.load_volume(files.braggpunched)] * 3
    out: list = []

    def work(fn) -> None:
        try:
            fn()
            out.append(None)
        except Exception as exc:  # noqa: BLE001
            out.append(exc)

    threads = [threading.Thread(target=work, args=(fn,)) for fn in calls]
    for t in threads:
        t.start()
    for t in threads:
        t.join(WAIT)
    assert out == [None] * len(calls)
    assert gate.calls == 2


def test_the_cache_size_still_bounds_what_is_kept(files, monkeypatch):
    monkeypatch.setattr(vol_mod, "_CACHE_MAX", 1)
    vol_mod.load_volume(files.backfilled)
    vol_mod.load_volume(files.braggpunched)
    assert [k[0] for k in vol_mod._cache] == [str(files.braggpunched)]
    assert vol_mod._flights.loading() == 0


def test_simultaneous_slice_requests_read_the_file_once(files, monkeypatch, tmp_path):
    # Through the API, as a check asks: three planes of a stage and its meta.
    client = TestClient(create_app(ServerConfig(data_root=tmp_path)))
    vid = f"{SLUG}.backfilled"
    expected = {plane: client.get(f"/api/volumes/{vid}/slice", params={"plane": plane}).content
                for plane in ("hk", "hl", "kl")}
    vol_mod.release()
    gate = _gate(monkeypatch, (nebula3d, "load"))
    urls = [(f"/api/volumes/{vid}/slice", {"plane": plane}) for plane in expected] * 2
    urls.append((f"/api/volumes/{vid}/meta", {}))
    it = iter(urls)
    lock = threading.Lock()

    def ask():
        with lock:
            url, params = next(it)
        r = client.get(url, params=params)
        assert r.status_code == 200
        return params.get("plane"), r.content

    got = together(ask, gate, n=len(urls))

    assert gate.calls == 1
    assert not any(isinstance(g, Exception) for g in got), got
    for plane, body in got:
        if plane is not None:
            assert body == expected[plane]


# --- SingleFlight itself ----------------------------------------------------
def test_single_flight_runs_one_load_per_key():
    flight = SingleFlight()
    gate = Gate(lambda: object())
    got = together(lambda: flight.run("k", gate), gate)
    assert gate.calls == 1 and all(g is got[0] for g in got)
    assert flight.loading() == 0
    # Nothing is kept: the next call loads again (the caches decide what stays).
    assert flight.run("k", gate) is not got[0] and gate.calls == 2


def test_single_flight_waiters_retry_when_the_loader_is_cancelled():
    # The first requester ended by something that is no error of the load
    # (a cancellation, an interrupt): the waiters are not left without an
    # answer, one of them loads.
    flight = SingleFlight()
    first = threading.Event()
    release = threading.Event()
    calls = []

    def load():
        calls.append(threading.get_ident())
        if len(calls) == 1:
            first.set()
            assert release.wait(WAIT)
            raise KeyboardInterrupt
        return "loaded"

    out: list = []

    def leader() -> None:
        try:
            flight.run("k", load)
        except KeyboardInterrupt:
            out.append("cancelled")

    def waiter() -> None:
        out.append(flight.run("k", load))

    lead = threading.Thread(target=leader)
    lead.start()
    assert first.wait(WAIT)
    waiters = [threading.Thread(target=waiter) for _ in range(3)]
    for t in waiters:
        t.start()
    time.sleep(0.2)
    release.set()
    for t in [lead, *waiters]:
        t.join(WAIT)
    assert sorted(out) == ["cancelled", "loaded", "loaded", "loaded"]
    # The flight keeps nothing, so a waiter that retries after another's
    # retry ended loads again: at least one of them did, and none hung.
    assert 2 <= len(calls) <= 4 and flight.loading() == 0


def test_single_flight_load_may_ask_for_its_own_key_and_for_others():
    flight = SingleFlight()
    assert flight.run("a", lambda: flight.run("b", lambda: flight.run("a", lambda: 1))) == 1
    assert flight.loading() == 0


def test_every_laue_request_hears_the_shared_comparison_progress(files, monkeypatch):
    gate = _gate(monkeypatch, (laue_mod, "compare_laue_classes"))
    heard: dict[int, list] = {}

    def ask():
        mine = heard.setdefault(threading.get_ident(), [])
        return laue_mod.laue_compare(files.backfilled, PipelineParams(),
                                     progress=lambda f, m: mine.append((f, m)))

    got = together(ask, gate, n=4)

    assert gate.calls == 1 and all(g is got[0] for g in got)
    assert len(heard) == 4
    # Each request heard the comparison it waited for reach its end.
    assert all(h and h[-1][0] == pytest.approx(1.0) for h in heard.values()), heard
    assert not laue_mod._listeners
