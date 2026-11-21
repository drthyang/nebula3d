"""What the in-browser bridge reads from a file to answer a Pilot check
(:mod:`nebula3d.webbridge`): each volume once, and never a file as it was.

A check asks for the same planes of every stage's volume, the stages' and the
ΔPDF's metadata and the punch's labels.  The worker keeps two volumes and one
ΔPDF (a tab's memory is tight), so what a call reads decides how long the
check takes; and every call must answer from the file as it is now, whatever
wrote it last.
"""

from __future__ import annotations

import json

import pytest

from nebula3d import webbridge

HKL_STAGES = ("raw", "ringremoved", "braggpunched", "backfilled", "flattened")
#: Points per axis of the demo volume: the coarsest whose Bragg peaks the UB check finds.
N = 41
#: A change of settings that rewrites the backfill's output, and every one
#: after it, with other content on this volume.
FIX = json.dumps({"backfill_method": "local"})


@pytest.fixture
def ran(tmp_path):
    """The demo volume after a full run, in a fresh workspace; its dataset id."""
    webbridge.setup(workdir=str(tmp_path / "work"))
    dataset_id = webbridge.make_demo_input(n=N)
    webbridge.run("", "{}", flatten_enabled=True, force=True)
    return dataset_id


def _counts() -> dict[str, int]:
    return json.loads(webbridge.read_counts_json())


def _reads(call) -> tuple[int, int]:
    """``(volume reads, ΔPDF reads)`` a call makes."""
    before = _counts()
    call()
    after = _counts()
    return (after["volume_reads"] - before["volume_reads"],
            after["dpdf_reads"] - before["dpdf_reads"])


def test_read_counts_count_the_whole_volume_reads(ran):
    """A slice of a volume the worker does not hold reads it; one it holds reads
    nothing; and the caches never hold more than the browser's two volumes and
    one ΔPDF."""
    ids = [f"{ran}.{name}" for name in HKL_STAGES]
    assert _reads(lambda: webbridge.volume_slice(ids[0], "hk", 0.0)) == (1, 0)
    assert _reads(lambda: webbridge.volume_slice(ids[0], "kl", 0.0)) == (0, 0)
    assert _reads(lambda: webbridge.dpdf_slice(f"{ran}.delta_pdf", "xy", 0.0)) == (0, 1)
    assert _reads(lambda: webbridge.dpdf_slice(f"{ran}.delta_pdf", "yz", 0.0)) == (0, 0)
    for vid in ids:
        webbridge.volume_slice(vid, "hk", 0.0)
        held = _counts()
        assert held["volumes_cached"] <= 2 and held["dpdfs_cached"] <= 1
    # The first of five is long gone from a cache of two.
    assert _reads(lambda: webbridge.volume_slice(ids[0], "hk", 0.0)) == (1, 0)


# ---------------------------------------------------------------------------
# Metadata is read from the file's header
# ---------------------------------------------------------------------------
def _stage_path(volume_id: str):
    from nebula3d.server import datasets

    stage = datasets.resolve_volume(webbridge._require_cfg(), volume_id)
    assert stage is not None
    return stage.path


def test_a_volumes_meta_is_its_header_and_reads_no_volume(ran):
    """volume_meta_json answers from the file's header: no volume is read for
    it, and the answer is the one the loaded volume gives, to the byte."""
    for name in HKL_STAGES:
        vid = f"{ran}.{name}"
        webbridge._clear_caches()
        cold: list[str] = []
        assert _reads(lambda: cold.append(webbridge.volume_meta_json(vid))) == (0, 0), name
        webbridge.volume_slice(vid, "hk", 0.0)  # now the volume is held
        assert webbridge.volume_meta_json(vid) == cold[0], name


def test_a_volumes_facts_from_its_header_are_the_loaded_volumes(ran):
    """The header's shape, axes, UB and σ's origin are the loader's, bit for bit."""
    import numpy as np

    import nebula3d
    from nebula3d.core import sigma_note
    from nebula3d.server import volumes

    for name in HKL_STAGES:
        path = _stage_path(f"{ran}.{name}")
        volumes.clear_cache()
        facts = volumes.volume_facts(path)
        vol = nebula3d.load(path, dtype=None)
        assert facts.shape == vol.data.shape
        for mine, theirs in ((facts.h_axis, vol.h_axis), (facts.k_axis, vol.k_axis),
                             (facts.l_axis, vol.l_axis), (facts.ub_matrix, vol.ub_matrix)):
            assert mine.dtype == theirs.dtype and mine.tobytes() == theirs.tobytes()
        assert facts.sigma_estimated is vol.sigma_estimated is False
        assert facts.sigma_note is None and sigma_note(vol) is None
        assert np.asarray(facts.shape).tolist() == list(vol.shape)


def test_a_volume_without_sigma_is_loaded_once_for_its_meta(tmp_path):
    """A volume whose σ is √|I| has its note read off its values: its meta
    loads it, once, and says what it said before."""
    import h5py
    import numpy as np

    import nebula3d
    from nebula3d.core import sigma_note
    from nebula3d.demo import demo_volume
    from nebula3d.server import volumes

    webbridge.setup(workdir=str(tmp_path / "work"))
    path = tmp_path / "work" / "raw" / "normalized.nxs"
    vol = demo_volume(17, dtype=np.float32)
    vol.data = vol.data / np.float32(vol.data.max() * 2)  # normalized: none above 1
    nebula3d.save(vol, path)
    with h5py.File(path, "r+") as f:  # as a file that came without σ
        del f["MDHistoWorkspace/data/errors_squared"]
    volumes.clear_cache()
    loaded = nebula3d.load(path, dtype=None)
    assert loaded.sigma_estimated and sigma_note(loaded)

    vid = "normalized.raw"
    first: list[str] = []
    assert _reads(lambda: first.append(webbridge.volume_meta_json(vid))) == (1, 0)
    meta = json.loads(first[0])
    assert meta["sigma"] == "estimated" and meta["sigma_note"] == sigma_note(loaded)
    volumes._cache.clear()  # the volume gone from the cache, its facts kept
    assert _reads(lambda: first.append(webbridge.volume_meta_json(vid))) == (0, 0)
    assert first[1] == first[0]


def test_a_meta_keeps_the_volumes_the_worker_holds(ran):
    """Asking for a third volume's meta leaves the two cached volumes where
    they are; the ΔPDF's meta reads no ΔPDF, cached or not, and says the same."""
    a, b, c = (f"{ran}.{name}" for name in HKL_STAGES[:3])
    webbridge.volume_slice(a, "hk", 0.0)
    webbridge.volume_slice(b, "hk", 0.0)
    assert _reads(lambda: webbridge.volume_meta_json(c)) == (0, 0)
    assert _counts()["volumes_cached"] == 2
    assert _reads(lambda: (webbridge.volume_slice(a, "kl", 0.0),
                           webbridge.volume_slice(b, "kl", 0.0))) == (0, 0)

    did = f"{ran}.delta_pdf"
    webbridge._clear_caches()
    cold: list[str] = []
    assert _reads(lambda: cold.append(webbridge.dpdf_meta_json(did))) == (0, 0)
    assert _counts()["dpdfs_cached"] == 0
    webbridge.dpdf_slice(did, "xy", 0.0)
    assert _counts()["dpdfs_cached"] == 1
    assert _reads(lambda: cold.append(webbridge.dpdf_meta_json(did))) == (0, 0)
    assert cold[1] == cold[0] and _counts()["dpdfs_cached"] == 1


def test_a_legacy_dpdfs_meta_is_its_header(tmp_path):
    """The legacy ΔPDF layout too: the header's meta is the loaded file's."""
    import h5py
    import numpy as np

    from nebula3d.server import deltapdf

    path = tmp_path / "legacy_delta_pdf.h5"
    rng = np.random.default_rng(0)
    with h5py.File(path, "w") as f:
        f["data"] = rng.normal(size=(5, 7, 9)).astype(np.float32)
        f["x_axis"], f["y_axis"], f["z_axis"] = (np.linspace(-1, 1, n) for n in (5, 7, 9))
        f.attrs.update(lat_a=4.0, lat_b=5.0, lat_c=6.0, q_max=7.5, window_shape="hann")
    deltapdf.clear_cache()
    before = deltapdf.read_count()
    cold = deltapdf.dpdf_meta(path)
    assert deltapdf.read_count() == before and cold["shape"] == [5, 7, 9]
    deltapdf.load_dpdf(path)
    assert deltapdf.dpdf_meta(path) == cold


# ---------------------------------------------------------------------------
# The punch's labels read the punched stage's axes, not its voxels
# ---------------------------------------------------------------------------
def test_the_labels_read_no_volume_and_are_the_same(ran):
    """modulation_labels_slice reads the punch's record and the punched
    stage's axes: no volume, held or not, and the same bytes either way."""
    cuts = (("hk0", 0.0, False), ("h0l", 0.0, False), ("0kl", 0.0, False), ("kl", 0.37, True))
    webbridge._clear_caches()
    cold: list[bytes] = []
    for cut in cuts:
        assert _reads(lambda: cold.append(webbridge.modulation_labels_slice(ran, *cut))) == (0, 0)
    assert _counts()["volumes_cached"] == 0
    webbridge.volume_slice(f"{ran}.braggpunched", "hk", 0.0)  # the punched volume held
    for cut, was in zip(cuts, cold):
        assert webbridge.modulation_labels_slice(ran, *cut) == was
    # Two other volumes held: the labels do not displace them.
    webbridge.volume_slice(f"{ran}.backfilled", "hk", 0.0)
    webbridge.volume_slice(f"{ran}.flattened", "hk", 0.0)
    assert _reads(lambda: webbridge.modulation_labels_slice(ran, *cuts[0])) == (0, 0)
    assert _reads(lambda: (webbridge.volume_slice(f"{ran}.backfilled", "kl", 0.0),
                           webbridge.volume_slice(f"{ran}.flattened", "kl", 0.0))) == (0, 0)


# ---------------------------------------------------------------------------
# Several slices of one volume in one call
# ---------------------------------------------------------------------------
def _unpack_slices(buf: bytes) -> tuple[dict, list[bytes | str]]:
    """The header and, per cut, its envelope or its error (webbridge._pack_slices)."""
    import struct

    (n,) = struct.unpack_from("<I", buf, 0)
    header = json.loads(buf[4:4 + n].decode("utf-8"))
    at, out = 4 + n, []
    for item in header["items"]:
        if "error" in item:
            out.append(item["error"])
        else:
            out.append(buf[at:at + item["bytes"]])
            at += item["bytes"]
    assert at == len(buf)
    return header, out


HKL_CUTS = [["hk0", 0.0, False], ["h0l", 0.0, False], ["0kl", 0.0, False],
            ["hk", 0.33, True], ["kl", -1.0, False]]
DPDF_CUTS = [["xy", 0.0], ["xz", 0.0], ["yz", 0.0], ["xy", 2.5]]


def test_several_slices_are_the_one_slice_calls_bytes(ran):
    """volume_slices and dpdf_slices give, for each cut, the bytes the
    one-slice call gives: from a cold cache and from a warm one."""
    for name in HKL_STAGES:
        vid = f"{ran}.{name}"
        single = [bytes(webbridge.volume_slice(vid, *cut)) for cut in HKL_CUTS]
        for warm in (False, True):
            if not warm:
                webbridge._clear_caches()
            _header, got = _unpack_slices(webbridge.volume_slices(vid, json.dumps(HKL_CUTS)))
            assert got == single, (name, warm)
    did = f"{ran}.delta_pdf"
    single = [bytes(webbridge.dpdf_slice(did, *cut)) for cut in DPDF_CUTS]
    for warm in (False, True):
        if not warm:
            webbridge._clear_caches()
        _header, got = _unpack_slices(webbridge.dpdf_slices(did, json.dumps(DPDF_CUTS)))
        assert got == single, warm


def test_several_slices_read_their_volume_once(ran):
    """One call, one read, whatever the cache held: a check that asks volume
    by volume reads each of the five stages once, where plane by plane across
    the stages it read one per slice (two volumes fit the worker's cache)."""
    cuts = HKL_CUTS[:3]
    ids = [f"{ran}.{name}" for name in HKL_STAGES]
    webbridge._clear_caches()
    together = json.dumps(cuts)
    assert _reads(lambda: [webbridge.volume_slices(vid, together) for vid in ids]) == (5, 0)
    assert _counts()["volumes_cached"] <= 2
    # Plane by plane, as the checks asked before: every slice a read.
    webbridge._clear_caches()
    one_by_one = lambda: [webbridge.volume_slice(vid, *cut) for cut in cuts for vid in ids]  # noqa: E731
    assert _reads(one_by_one) == (15, 0)
    webbridge._clear_caches()
    sections = json.dumps(DPDF_CUTS)
    assert _reads(lambda: webbridge.dpdf_slices(f"{ran}.delta_pdf", sections)) == (0, 1)


def test_a_cut_that_fails_leaves_the_others(ran):
    """A cut the one-slice call refuses gives its error in place; the others
    still come.  An unknown volume, or cuts that are no list, fail the call."""
    vid = f"{ran}.raw"
    cuts = [["hk0", 0.0, False], ["nope", 0.0, False], ["0kl", 0.0, False]]
    header, got = _unpack_slices(webbridge.volume_slices(vid, json.dumps(cuts)))
    assert [sorted(i) for i in header["items"]] == [["bytes"], ["error"], ["bytes"]]
    assert got[0] == bytes(webbridge.volume_slice(vid, "hk0", 0.0, False))
    assert got[2] == bytes(webbridge.volume_slice(vid, "0kl", 0.0, False))
    with pytest.raises(ValueError) as one:
        webbridge.volume_slice(vid, "nope", 0.0, False)
    assert got[1] == f"ValueError: {one.value}"
    _header, got = _unpack_slices(webbridge.dpdf_slices(f"{ran}.delta_pdf",
                                                        json.dumps([["xy", 0.0], ["zz", 0.0]])))
    assert isinstance(got[0], bytes) and isinstance(got[1], str)
    with pytest.raises(KeyError):
        webbridge.volume_slices("nope.raw", json.dumps(cuts))
    with pytest.raises(ValueError):
        webbridge.volume_slices(f"{ran}.delta_pdf", json.dumps(cuts))  # not an HKL stage
    with pytest.raises(ValueError):
        webbridge.volume_slices(vid, json.dumps([["hk0", 0.0]]))
    header, got = _unpack_slices(webbridge.volume_slices(vid, "[]"))
    assert header["items"] == [] and got == []


def test_a_change_of_view_keeps_what_was_computed_from_a_volume(ran):
    """The ΔPDF's meta releases the cleanup view's volumes (the memory) and
    keeps the ring verdicts, the shell floors and the holes' texture computed
    from them: asked again, they read no volume and say the same.  A run
    clears them, and they are computed again from the new files."""
    calls = {
        "rings": lambda: webbridge.volume_ring_isotropy_json(f"{ran}.raw", "2.69", "0.05"),
        "floors": lambda: webbridge.volume_shell_floors_json(f"{ran}.flattened"),
        "texture": lambda: webbridge.volume_texture_json(f"{ran}.backfilled"),
    }
    for name, call in calls.items():
        first = call()
        webbridge.volume_slice(f"{ran}.raw", "hk0", 0.0)
        webbridge.dpdf_meta_json(f"{ran}.delta_pdf")  # the ΔPDF view is entered
        assert _counts()["volumes_cached"] == 0, name  # the memory is released
        again: list[str] = []
        assert _reads(lambda call=call: again.append(call())) == (0, 0), name
        assert again[0] == first, name
    floors = calls["floors"]()
    webbridge.run("", FIX, True, force_from="backfill")
    assert _reads(calls["floors"])[0] >= 1
    assert calls["floors"]() != floors


# ---------------------------------------------------------------------------
# Never a file as it was: after every writer, what the bridge reads is the file
# ---------------------------------------------------------------------------
READ_CUTS = [["hk0", 0.0, False], ["h0l", 0.0, False], ["0kl", 0.0, False]]
SECTIONS = [["xy", 0.0], ["xz", 0.0], ["yz", 0.0]]


def _version(volume_id: str) -> str | None:
    return json.loads(webbridge.slice_version_json(volume_id))["version"]


def _read_all(dataset_id: str) -> dict[str, object]:
    """Everything a check reads of a dataset (or a tuning view of one), through
    the bridge as it stands, caches and all: each stage's three planes one by
    one and together, its meta, the punch's labels, and the ΔPDF's sections."""
    out: dict[str, object] = {}
    listed = json.loads(webbridge.dataset_json(dataset_id))["stages"]
    for stage in listed:
        if not stage["exists"]:
            continue
        vid = stage["volume_id"]
        if stage["kind"] == "hkl":
            out[f"{vid} one by one"] = [bytes(webbridge.volume_slice(vid, *c)) for c in READ_CUTS]
            header, together = _unpack_slices(webbridge.volume_slices(vid, json.dumps(READ_CUTS)))
            out[f"{vid} together"] = together
            out[f"{vid} meta"] = webbridge.volume_meta_json(vid)
        else:
            out[f"{vid} one by one"] = [bytes(webbridge.dpdf_slice(vid, *c)) for c in SECTIONS]
            header, together = _unpack_slices(webbridge.dpdf_slices(vid, json.dumps(SECTIONS)))
            out[f"{vid} together"] = together
            out[f"{vid} meta"] = webbridge.dpdf_meta_json(vid)
        # The batch says which file it read: the one the version call names now.
        assert header["version"] == _version(vid)
        assert out[f"{vid} together"] == out[f"{vid} one by one"]
    if any(s["name"] == "braggpunched" and s["exists"] for s in listed):
        out["labels"] = [bytes(webbridge.modulation_labels_slice(dataset_id, *c))
                         for c in READ_CUTS]
    # What the backend computes from a whole volume and keeps by its file.
    have = {s["name"]: s["volume_id"] for s in listed if s["exists"]}
    out["rings"] = webbridge.volume_ring_isotropy_json(have["raw"], "2.69,3.1", "0.05,0.05")
    out["coverage"] = webbridge.volume_coverage_json(have["raw"])
    if "flattened" in have:
        out["floors"] = webbridge.volume_shell_floors_json(have["flattened"])
    if "backfilled" in have and "braggpunched" in have:
        out["texture"] = webbridge.volume_texture_json(have["backfilled"])
    return out


def _versions(dataset_id: str) -> dict[str, str | None]:
    listed = json.loads(webbridge.dataset_json(dataset_id))["stages"]
    return {s["volume_id"]: _version(s["volume_id"]) for s in listed if s["exists"]}


def _forget_without_a_trace() -> None:
    """Drop every volume, ΔPDF and header the bridge holds, behind its back
    (no call of the bridge's, so no version moves): the next read is the file."""
    from nebula3d.server import deltapdf, volumes

    volumes._cache.clear()
    volumes._facts.clear()
    for records in (volumes._ring_cache, volumes._floors_cache, volumes._texture_cache,
                    volumes._coverage_cache, deltapdf._cache, deltapdf._floors):
        records.clear()


def _assert_reads_the_files(dataset_id: str) -> dict[str, object]:
    """What the bridge gives now, with whatever it holds, is what it gives from
    the files alone.  Returns it."""
    held = _read_all(dataset_id)
    counter = webbridge._S.writes
    _forget_without_a_trace()
    assert _read_all(dataset_id) == held
    assert webbridge._S.writes == counter  # reading moved no version
    return held


def _changed(old: dict[str, object], new: dict[str, object], name: str) -> bool:
    keys = [k for k in new if f".{name} " in k and "meta" not in k]
    assert keys, name
    return any(old.get(k) != new[k] for k in keys)


def test_no_stale_slice_after_a_run(ran):
    """A run that rewrites the outputs: every read after it is the new file,
    and every version given before it is gone."""
    old, versions = _assert_reads_the_files(ran), _versions(ran)
    webbridge.run("", FIX, True, force_from="backfill")
    new = _assert_reads_the_files(ran)
    for name in ("backfilled", "flattened", "delta_pdf"):
        assert _changed(old, new, name), name  # really rewritten, with other content
    for name in ("raw", "ringremoved", "braggpunched"):
        assert not _changed(old, new, name), name
    now = _versions(ran)
    assert all(now[vid] != versions[vid] for vid in versions)  # the unchanged files' too
    # The asynchronous run the worker makes moves them as well.
    import asyncio

    asyncio.run(webbridge.run_async("", "{}", True, force_from="backfill"))
    back = _assert_reads_the_files(ran)
    assert all(_versions(ran)[vid] != now[vid] for vid in now)
    assert back == old  # the first run's settings again: its numbers again


def test_no_stale_slice_after_a_tuning_trial_and_a_promote(ran):
    """A trial run again in its folder, and a trial promoted into the chain:
    the trial's and the chain's views read their files as they are."""
    start = json.loads(webbridge.tuning_start_json(ran, "backfill"))
    run_id, chain = start["run_id"], start["dataset_id"]
    trial = f"{ran}~tune~{run_id}~backfill-1"
    webbridge.run("backfill", "{}", True, tuning_run=run_id, tuning_trial="backfill-1")
    first, v_first = _assert_reads_the_files(trial), _versions(trial)
    assert _version(f"{trial}.backfilled")
    # The same trial, run again with another setting: the same file, rewritten.
    webbridge.run("backfill", FIX, True, force=True,
                  tuning_run=run_id, tuning_trial="backfill-1")
    second = _assert_reads_the_files(trial)
    assert _changed(first, second, "backfilled")
    assert all(_versions(trial)[vid] != v_first[vid] for vid in v_first)

    before, v_before = _assert_reads_the_files(chain), _versions(chain)
    webbridge.tuning_promote_json(run_id, "backfill-1")
    after = _assert_reads_the_files(chain)
    assert after[f"{chain}.backfilled together"] == second[f"{trial}.backfilled together"]
    assert after != before
    assert all(_versions(chain).get(vid) != v for vid, v in v_before.items())
    # processed/ is only read by a tuning run: its files read as they did.
    assert _assert_reads_the_files(ran)[f"{ran}.backfilled together"] \
        == first[f"{trial}.backfilled together"]


def test_no_stale_slice_after_a_set_aside_and_a_restore(ran):
    """Outputs set aside, a fix run over them, then put back with their old
    dates: the reads follow the files each time, and what is put back reads
    as it did, under a new version."""
    original, v_original = _assert_reads_the_files(ran), _versions(ran)
    assert json.loads(webbridge.set_aside_json(ran, "backfill"))["set_aside"]
    assert _assert_reads_the_files(ran) == original
    v_aside = _versions(ran)
    assert all(v_aside[vid] != v_original[vid] for vid in v_original)

    webbridge.run("", FIX, True, force_from="backfill")
    fixed, v_fixed = _assert_reads_the_files(ran), _versions(ran)
    assert _changed(original, fixed, "backfilled") and _changed(original, fixed, "delta_pdf")

    out = json.loads(webbridge.set_aside_restore_json(ran, "{}", True))
    assert out["restored"] is True
    restored = _assert_reads_the_files(ran)
    assert restored == original  # byte for byte what it read before the fix
    v_restored = _versions(ran)
    for vid in v_original:  # the old dates are back, the old versions are not
        assert v_restored[vid] not in (v_original[vid], v_aside[vid], v_fixed[vid])

    # Set aside and discarded: nothing read changes, and the versions still move.
    webbridge.set_aside_json(ran, "backfill")
    assert json.loads(webbridge.set_aside_discard_json(ran)) == {"discarded": True}
    assert _assert_reads_the_files(ran) == original
    assert all(_versions(ran)[vid] != v_restored[vid] for vid in v_restored)


def test_no_stale_slice_after_a_load_over_the_same_name(tmp_path):
    """A volume loaded again under the name of one already there replaces its
    raw file: the reads and the meta are the new file's."""
    import numpy as np

    import nebula3d
    from nebula3d.demo import demo_volume

    webbridge.setup(workdir=str(tmp_path / "work"))
    upload = tmp_path / "upload.nxs"
    vol = demo_volume(17, dtype=np.float32)
    nebula3d.save(vol, upload)
    dataset_id = webbridge.load_input("sample.nxs", str(upload))
    first, v_first = _assert_reads_the_files(dataset_id), _versions(dataset_id)

    vol.data = vol.data * np.float32(3.0)
    nebula3d.save(vol, upload)
    assert webbridge.load_input("sample.nxs", str(upload)) == dataset_id
    second = _assert_reads_the_files(dataset_id)
    assert _changed(first, second, "raw")
    assert _versions(dataset_id)[f"{dataset_id}.raw"] != v_first[f"{dataset_id}.raw"]


def test_no_stale_slice_after_a_regrid(tmp_path):
    """A regrid writes a new raw volume beside the first, with other content,
    and both datasets read their files as they are; asked again it writes
    nothing (the file is there), and still every version moves."""
    from tests.test_ub_regrid import NEW_SLUG, SLUG, _bridge

    _bridge(tmp_path)
    source, v_source = _assert_reads_the_files(SLUG), _versions(SLUG)
    assert _version(f"{NEW_SLUG}.raw") is None
    assert json.loads(webbridge.dataset_regrid_json(SLUG, "1,1,1"))["written"] is True
    regridded, v_regridded = _assert_reads_the_files(NEW_SLUG), _versions(NEW_SLUG)
    assert regridded[f"{NEW_SLUG}.raw together"] != source[f"{SLUG}.raw together"]
    assert _assert_reads_the_files(SLUG) == source
    assert _versions(SLUG)[f"{SLUG}.raw"] != v_source[f"{SLUG}.raw"]
    webbridge.dataset_regrid_json(SLUG, "1,1,1")
    assert _assert_reads_the_files(NEW_SLUG) == regridded
    assert all(_versions(NEW_SLUG)[vid] != v for vid, v in v_regridded.items())


# ---------------------------------------------------------------------------
# The version of a file
# ---------------------------------------------------------------------------
def test_a_version_reads_no_volume_and_stands_while_nothing_writes(ran):
    """slice_version_json reads no data, and gives the same version for as
    long as only reads are made, of any kind; null for a volume not there."""
    webbridge._clear_caches()
    ids = [f"{ran}.{name}" for name in (*HKL_STAGES, "delta_pdf")]
    first: dict[str, str | None] = {}
    assert _reads(lambda: first.update({vid: _version(vid) for vid in ids})) == (0, 0)
    assert all(first.values()) and len(set(first.values())) == len(ids)
    _read_all(ran)
    webbridge.datasets_json()
    webbridge.stale_outputs_json(ran, "{}", True)
    webbridge.bragg_profile_json(ran)
    webbridge.consistency_check_json(ran)
    assert {vid: _version(vid) for vid in ids} == first
    assert _version("nope.raw") is None and _version(f"{ran}.nope") is None


def test_a_version_never_names_two_contents(ran, monkeypatch):
    """A file rewritten in place by a marked call, with the same size, the
    same date to the nanosecond and the same inode, has another version: the
    count of the calls that may write is part of it, not the dates alone."""
    import os

    vid = f"{ran}.flattened"
    path = _stage_path(vid)
    webbridge.volume_slice(vid, "hk0", 0.0)

    @webbridge._writes
    def rewrite_in_place() -> None:
        st = path.stat()
        data = bytearray(path.read_bytes())
        data[-1] ^= 0xFF
        with open(path, "r+b") as f:
            f.write(data)
        os.utime(path, ns=(st.st_atime_ns, st.st_mtime_ns))

    before, stat = _version(vid), path.stat()
    rewrite_in_place()
    after = path.stat()
    assert (after.st_size, after.st_mtime_ns, after.st_ino) == \
        (stat.st_size, stat.st_mtime_ns, stat.st_ino)
    assert _version(vid) != before
    # A marked call that fails half-way has moved it too.

    @webbridge._writes
    def fails() -> None:
        raise RuntimeError("half-way")

    before = _version(vid)
    with pytest.raises(RuntimeError):
        fails()
    assert _version(vid) != before
    # Another worker (a restart: its count starts again) never repeats one.
    before = _version(vid)
    monkeypatch.setattr(webbridge, "_BOOT", "another-worker")
    monkeypatch.setattr(webbridge._S, "writes", webbridge._S.writes)
    assert _version(vid) != before


#: The bridge's public calls that change no file of the workspace, each with
#: arguments to call it by on a dataset that ran.  Every other public function
#: must carry the write mark (webbridge._writes).
READ_ONLY = {
    "read_counts_json": lambda ds: (),
    "memory_budget_json": lambda ds: (),
    "inspect_dataset_json": lambda ds: (ds,),
    "select_input": lambda ds: (ds,),
    "datasets_json": lambda ds: (),
    "dataset_json": lambda ds: (ds,),
    "stale_outputs_json": lambda ds: (ds, "{}", True),
    "bragg_profile_json": lambda ds: (ds,),
    "modulation_check_json": lambda ds: ("{}",),
    "modulation_labels_slice": lambda ds: (ds, "hk0", 0.0),
    "ring_diagnostics_json": lambda ds: (ds,),
    "volume_meta_json": lambda ds: (f"{ds}.raw",),
    "volume_slice": lambda ds: (f"{ds}.raw", "hk0", 0.0),
    "volume_slices": lambda ds: (f"{ds}.raw", json.dumps(READ_CUTS)),
    "slice_version_json": lambda ds: (f"{ds}.raw",),
    "volume_coverage_json": lambda ds: (f"{ds}.raw",),
    "volume_ub_check_json": lambda ds: (f"{ds}.raw",),
    "volume_ring_isotropy_json": lambda ds: (f"{ds}.raw", "2.69", "0.05"),
    "volume_shell_floors_json": lambda ds: (f"{ds}.flattened",),
    "volume_texture_json": lambda ds: (f"{ds}.backfilled",),
    "dpdf_meta_json": lambda ds: (f"{ds}.delta_pdf",),
    "dpdf_slice": lambda ds: (f"{ds}.delta_pdf", "xy", 0.0),
    "dpdf_slices": lambda ds: (f"{ds}.delta_pdf", json.dumps(SECTIONS)),
    "dpdf_features_json": lambda ds: (f"{ds}.delta_pdf",),
    "dpdf_pair_signal": lambda ds: (f"{ds}.delta_pdf", json.dumps(
        {"diffs": [[0.5, 0.0, 0.0]], "lat": [4.2, 4.2, 4.2]})),
    "consistency_meta_json": lambda ds: (ds,),
    "consistency_check_json": lambda ds: (ds,),
    "consistency_slice": lambda ds: (ds, "data", "hk0", 0.0),
    "inspect_input": None,  # reads the upload it is given, outside the workspace
}


def _public_calls() -> dict[str, object]:
    import inspect

    return {name: fn for name, fn in vars(webbridge).items()
            if inspect.isfunction(fn) and not name.startswith("_")
            and fn.__module__ == webbridge.__name__}


def test_every_bridge_call_is_marked_as_a_writer_or_listed_read_only():
    """A call added to the bridge must say which it is: one that may write
    carries the mark that moves the versions; one listed read-only is called
    below and may change nothing."""
    calls = _public_calls()
    marked = {name for name, fn in calls.items() if getattr(fn, "writes_files", False)}
    assert marked >= {"setup", "load_input", "make_demo_input", "run", "run_async",
                      "set_aside_json", "set_aside_restore_json", "set_aside_discard_json",
                      "tuning_start_json", "tuning_promote_json", "dataset_regrid_json",
                      "save_dpdf"}
    assert not marked & set(READ_ONLY)
    assert set(calls) - marked == set(READ_ONLY), "mark the call with _writes or list it"


def test_the_read_only_calls_change_no_file_and_no_version(ran, tmp_path):
    """Each read-only call leaves every file of the workspace as it was (its
    bytes, its date, its inode, and no file more or fewer) and every version
    standing."""
    import hashlib

    work = tmp_path / "work"

    def state() -> dict[str, tuple[str, int, int]]:
        return {str(p.relative_to(work)): (hashlib.sha256(p.read_bytes()).hexdigest(),
                                           p.stat().st_mtime_ns, p.stat().st_ino)
                for p in sorted(work.rglob("*")) if p.is_file()}

    files, versions, counter = state(), _versions(ran), webbridge._S.writes
    calls = _public_calls()
    for name, args in READ_ONLY.items():
        if args is None:
            continue
        calls[name](*args(ran))
        assert state() == files, name
        assert webbridge._S.writes == counter and _versions(ran) == versions, name
