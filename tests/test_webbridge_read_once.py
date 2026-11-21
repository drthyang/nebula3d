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


@pytest.fixture
def ran(tmp_path):
    """The demo volume after a full run, in a fresh workspace; its dataset id."""
    webbridge.setup(workdir=str(tmp_path / "work"))
    dataset_id = webbridge.make_demo_input(n=25)
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
