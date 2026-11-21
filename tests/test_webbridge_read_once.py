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
