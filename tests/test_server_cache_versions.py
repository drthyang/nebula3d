"""The server's caches keep one version of a file.

A cache key carries the file's date as it is when a request asks, so once a
file has another date (a run rewrote it, or a set-aside output was put back
with its earlier date) its old entry can never be asked for again.  Storing
a file's current version drops its entries of any other date and nothing
else: other files' entries, the order and the size limit stay, an object a
request already holds stays whole, and a volume whose file changed while it
was read is returned and not kept.
"""

import os
import shutil
import threading

import numpy as np
import pytest

import nebula3d
from nebula3d.demo import demo_volume
from nebula3d.io import save_delta_pdf
from nebula3d.pipeline import DeltaPdfParams, pipeline_paths
from nebula3d.server import consistency as cons_mod
from nebula3d.server import deltapdf as dpdf_mod
from nebula3d.server import volumes as vol_mod
from nebula3d.server.versions import drop_other_versions, is_current

WAIT = 20.0  # seconds before a stuck thread fails its test instead of hanging it
STEM = "sample_300K_test_cc_sub_bkg"


def _clear() -> None:
    vol_mod.release()
    dpdf_mod.clear_cache()
    cons_mod.clear_cache()


@pytest.fixture
def files(tmp_path, monkeypatch):
    """A small volume (the demo crystal) as two stages, and a ΔPDF; the
    caches at the native server's sizes (the browser bridge's setup, which
    other tests run, shrinks them for the rest of the session)."""
    monkeypatch.setattr(vol_mod, "_CACHE_MAX", 6)
    monkeypatch.setattr(dpdf_mod, "_CACHE_MAX", 3)
    monkeypatch.setattr(cons_mod, "_CACHE_MAX", 4)
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


def redate(path, seconds: float) -> float:
    """Give *path* a date *seconds* from its own, as a rewrite (later) or a
    restore (earlier) leaves it.  Returns the date it had."""
    was = os.stat(path)
    os.utime(path, ns=(was.st_atime_ns, was.st_mtime_ns + int(seconds * 1e9)))
    return was.st_mtime


def put_back(path, mtime_ns: int) -> None:
    os.utime(path, ns=(mtime_ns, mtime_ns))


def counted(monkeypatch, module, name) -> list:
    """Count the calls of ``module.name`` (the loader inside a cache)."""
    calls: list = []
    real = getattr(module, name)

    def load(*args, **kwargs):
        calls.append(args)
        return real(*args, **kwargs)

    monkeypatch.setattr(module, name, load)
    return calls


def cached_paths(cache) -> list[str]:
    return [k[0] for k in cache]


# --- the volume cache -------------------------------------------------------
def test_a_new_version_replaces_the_old_one_and_no_other_file(files):
    other = vol_mod.load_volume(files.braggpunched)
    first = vol_mod.load_volume(files.backfilled)
    old = redate(files.backfilled, 5)

    second = vol_mod.load_volume(files.backfilled)

    assert second is not first
    assert list(vol_mod._cache) == [
        (str(files.braggpunched), os.stat(files.braggpunched).st_mtime),
        (str(files.backfilled), os.stat(files.backfilled).st_mtime)]
    assert (str(files.backfilled), old) not in vol_mod._cache
    assert vol_mod.load_volume(files.braggpunched) is other
    assert vol_mod.load_volume(files.backfilled) is second


def test_the_old_version_goes_before_the_new_one_is_read(files, monkeypatch):
    # Not after: the old and the new volume are never both held by the cache
    # and the read, which is what the peak memory after a run is made of.
    path = files.backfilled
    other = vol_mod.load_volume(files.braggpunched)
    vol_mod.load_volume(path)
    redate(path, 5)
    real = nebula3d.load
    seen: list = []

    def load(*args, **kwargs):
        seen.append(list(vol_mod._cache))
        return real(*args, **kwargs)

    monkeypatch.setattr(nebula3d, "load", load)
    vol_mod.load_volume(path)

    assert seen == [[(str(files.braggpunched), os.stat(files.braggpunched).st_mtime)]]
    assert vol_mod.load_volume(files.braggpunched) is other


def test_a_failed_read_of_a_new_version_is_tried_again(files, monkeypatch):
    path = files.backfilled
    vol_mod.load_volume(path)
    redate(path, 5)
    real = nebula3d.load
    monkeypatch.setattr(nebula3d, "load", lambda *a, **k: (_ for _ in ()).throw(OSError("gone")))
    with pytest.raises(OSError, match="gone"):
        vol_mod.load_volume(path)
    monkeypatch.setattr(nebula3d, "load", real)

    vol = vol_mod.load_volume(path)

    assert list(vol_mod._cache) == [(str(path), os.stat(path).st_mtime)]
    assert vol_mod.load_volume(path) is vol


def test_every_other_version_of_the_file_goes_not_only_the_last(files):
    # Entries of three dates of one file (as the cache held them before):
    # storing the current one leaves it alone.
    path = files.backfilled
    stale = [(str(path), os.stat(path).st_mtime - d) for d in (30.0, 20.0, 10.0)]
    for key in stale:
        vol_mod._cache[key] = demo_volume(9)
    kept = vol_mod.load_volume(files.braggpunched)

    vol = vol_mod.load_volume(path)

    assert [id(v) for v in vol_mod._cache.values()] == [id(kept), id(vol)]


def test_a_restored_file_loads_and_the_version_cached_meanwhile_goes(files, monkeypatch):
    # Auto mode sets a stage's outputs aside, runs a fix (a later date), and
    # puts the outputs back with their own, EARLIER date: the current
    # version is then the older one.
    calls = counted(monkeypatch, nebula3d, "load")
    path = files.backfilled
    original = os.stat(path)
    before = vol_mod.load_volume(path)
    redate(path, 60)
    fixed = vol_mod.load_volume(path)
    assert list(vol_mod._cache) == [(str(path), os.stat(path).st_mtime)]

    put_back(path, original.st_mtime_ns)
    restored = vol_mod.load_volume(path)

    assert len(calls) == 3 and restored is not fixed
    assert list(vol_mod._cache) == [(str(path), original.st_mtime)]
    np.testing.assert_array_equal(restored.data, before.data)
    assert vol_mod.load_volume(path) is restored and len(calls) == 3


def test_a_volume_handed_out_stays_whole_after_its_entry_goes(files):
    path = files.backfilled
    held = vol_mod.load_volume(path)
    data, sigma, mask = held.data.copy(), held.sigma.copy(), held.mask.copy()
    envelope = vol_mod.pack_slice(vol_mod.extract_slice(held, plane="hk", value=0.0, interp=False))
    redate(path, 5)

    vol_mod.load_volume(path)
    vol_mod.set_cache_max(1)
    vol_mod.load_volume(files.braggpunched)
    vol_mod.set_cache_max(6)

    assert not any(v is held for v in vol_mod._cache.values())
    np.testing.assert_array_equal(held.data, data)
    np.testing.assert_array_equal(held.sigma, sigma)
    np.testing.assert_array_equal(held.mask, mask)
    assert vol_mod.pack_slice(
        vol_mod.extract_slice(held, plane="hk", value=0.0, interp=False)) == envelope


def test_two_versions_loading_at_once_end_with_the_current_one_cached(files, monkeypatch):
    # A request reads the file while a run rewrites it, and a second request
    # asks for the new version before the first read has ended.
    path = files.backfilled
    real = nebula3d.load
    entered = [threading.Event(), threading.Event()]
    go = threading.Event()
    n = iter(range(2))
    lock = threading.Lock()

    def load(*args, **kwargs):
        with lock:
            i = next(n)
        entered[i].set()
        assert go.wait(WAIT), "the load was never let through"
        return real(*args, **kwargs)

    monkeypatch.setattr(nebula3d, "load", load)
    out: list = [None, None]

    def work(i: int) -> None:
        try:
            out[i] = vol_mod.load_volume(path)
        except Exception as exc:  # noqa: BLE001 - the test reads it
            out[i] = exc

    threads = [threading.Thread(target=work, args=(i,)) for i in range(2)]
    threads[0].start()
    assert entered[0].wait(WAIT)
    redate(path, 5)
    threads[1].start()
    assert entered[1].wait(WAIT)  # its own load: another date is another key
    go.set()
    for t in threads:
        t.join(WAIT)
    assert not any(t.is_alive() for t in threads), "a request never returned"

    assert not any(isinstance(v, Exception) for v in out), out
    assert out[0] is not out[1]
    assert list(vol_mod._cache) == [(str(path), os.stat(path).st_mtime)]
    assert vol_mod._cache[str(path), os.stat(path).st_mtime] is out[1]
    assert vol_mod._flights.loading() == 0
    assert vol_mod.load_volume(path) is out[1]


def test_many_requests_across_a_rewrite_end_with_one_version_cached(files):
    path = files.backfilled
    errors: list = []
    start = threading.Barrier(9)

    def ask() -> None:
        try:
            start.wait(WAIT)
            for _ in range(20):
                vol = vol_mod.load_volume(path)
                assert vol.data.shape == (41, 41, 41)
        except Exception as exc:  # noqa: BLE001
            errors.append(exc)

    threads = [threading.Thread(target=ask) for _ in range(8)]
    for t in threads:
        t.start()
    start.wait(WAIT)
    for _ in range(10):
        redate(path, 1)
    for t in threads:
        t.join(WAIT)
    assert not any(t.is_alive() for t in threads) and not errors, errors

    vol_mod.load_volume(path)
    assert list(vol_mod._cache) == [(str(path), os.stat(path).st_mtime)]
    assert vol_mod._flights.loading() == 0


def test_the_size_limit_and_the_order_hold_for_different_files(files, tmp_path):
    a, b = files.braggpunched, files.backfilled
    c, d = tmp_path / "c.nxs", tmp_path / "d.nxs"
    shutil.copy(a, c)
    shutil.copy(a, d)
    vol_mod.set_cache_max(3)
    for p in (a, b, c):
        vol_mod.load_volume(p)
    assert cached_paths(vol_mod._cache) == [str(a), str(b), str(c)]
    vol_mod.load_volume(a)  # used last: b is now the oldest
    assert cached_paths(vol_mod._cache) == [str(b), str(c), str(a)]
    vol_mod.load_volume(d)  # a fourth file pushes the oldest out
    assert cached_paths(vol_mod._cache) == [str(c), str(a), str(d)]

    redate(c, 5)  # a new version takes the newest place, and frees its old one
    vol_mod.load_volume(c)
    assert cached_paths(vol_mod._cache) == [str(a), str(d), str(c)]
    vol_mod.load_volume(b)  # the limit is three files still
    assert cached_paths(vol_mod._cache) == [str(d), str(c), str(b)]
    assert vol_mod._CACHE_MAX == 3


def test_a_file_named_two_ways_keeps_an_entry_per_name(files, tmp_path):
    # A data root reached through a symlink: the keys are the paths as asked,
    # and a new version of one name leaves the other name's entry.
    link = tmp_path / "linked"
    link.symlink_to(files.backfilled.parent, target_is_directory=True)
    by_link = link / files.backfilled.name
    direct = vol_mod.load_volume(files.backfilled)
    linked = vol_mod.load_volume(by_link)
    assert linked is not direct
    redate(files.backfilled, 5)

    again = vol_mod.load_volume(by_link)

    assert again is not linked
    assert cached_paths(vol_mod._cache) == [str(files.backfilled), str(by_link)]
    assert vol_mod._cache[next(iter(vol_mod._cache))] is direct


# --- the ΔPDF cache and the consistency round trip --------------------------
def test_a_new_delta_pdf_replaces_the_old_one(files, tmp_path, monkeypatch):
    calls = counted(monkeypatch, dpdf_mod, "load_delta_pdf")
    path = files.delta_pdf
    other = tmp_path / "other_delta_pdf.h5"
    shutil.copy(path, other)
    kept = dpdf_mod.load_dpdf(other)
    original = os.stat(path)
    first = dpdf_mod.load_dpdf(path)
    values = first.data.copy()
    redate(path, 5)

    second = dpdf_mod.load_dpdf(path)

    assert second is not first
    assert list(dpdf_mod._cache) == [(str(other), os.stat(other).st_mtime),
                                     (str(path), os.stat(path).st_mtime)]
    np.testing.assert_array_equal(first.data, values)  # still whole in the holder's hands
    assert dpdf_mod.load_dpdf(other) is kept

    put_back(path, original.st_mtime_ns)  # restored: the earlier date is current
    n = len(calls)
    third = dpdf_mod.load_dpdf(path)
    assert len(calls) == n + 1 and third is not second
    assert sorted(dpdf_mod._cache) == sorted([(str(other), os.stat(other).st_mtime),
                                              (str(path), original.st_mtime)])


def test_a_new_version_drops_the_round_trips_of_the_old_one(files, monkeypatch):
    calls = counted(monkeypatch, cons_mod, "consistency_reconstruction")
    view = cons_mod.ViewInput(files.backfilled, DeltaPdfParams(), {})
    other = cons_mod.ViewInput(files.braggpunched, DeltaPdfParams(), {})
    whole = cons_mod.reconstruction(view, None, None)
    band = cons_mod.reconstruction(view, (0.5, 2.0), None)
    kept = cons_mod.reconstruction(other, None, None)
    # Two bands of one date stay together.
    assert cons_mod.reconstruction(view, None, None) is whole
    assert cons_mod.reconstruction(view, (0.5, 2.0), None) is band
    assert len(cons_mod._cache) == 3 and len(calls) == 3
    old = os.stat(files.backfilled).st_mtime
    redate(files.backfilled, 5)

    new = cons_mod.reconstruction(view, None, None)

    assert new is not whole and len(calls) == 4
    assert not [k for k in cons_mod._cache if k[:2] == (str(files.backfilled), old)]
    assert [k[0] for k in cons_mod._cache] == [str(files.braggpunched), str(files.backfilled)]
    assert cons_mod.reconstruction(other, None, None) is kept and len(calls) == 4
    assert set(whole) == set(new)  # the answer handed out before is still whole


# --- the rule itself --------------------------------------------------------
def test_drop_other_versions_takes_the_file_s_other_dates_only():
    cache = {("a", 1.0): 1, ("a", 2.0, "band"): 2, ("a", 2.0): 3, ("b", 1.0): 4, ("a", 3.0): 5}
    drop_other_versions(cache, ("a", 2.0))
    assert cache == {("a", 2.0, "band"): 2, ("a", 2.0): 3, ("b", 1.0): 4}


def test_is_current_reads_the_file_s_date(tmp_path):
    path = tmp_path / "f"
    path.write_text("x")
    date = os.stat(path).st_mtime
    assert is_current(path, date)
    assert not is_current(path, date + 1) and not is_current(path, date - 1)
    path.unlink()
    assert not is_current(path, date)
