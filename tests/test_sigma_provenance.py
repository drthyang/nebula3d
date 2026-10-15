"""Whether a volume's σ came with its data, and the warning when it did not.

The punch's significance test counts σ. With none in the file, σ is √|I|: a
count's standard error on counts, but on normalized values it depends on the
arbitrary intensity scale. The NeXus Viewer's export carries σ when it has one
(``errors_squared``, or ``/entry/sigma`` in the legacy layout); the flag
travels with every stage's output.
"""

import h5py
import numpy as np

import nebula3d
from nebula3d.core import HKLVolume, sigma_note
from nebula3d.pipeline import PunchParams, punch_bragg

UB = 2 * np.pi * np.eye(3) / 4.0


def _vol(data, sigma=None):
    return HKLVolume.from_arrays(data, (-2, 2), (-2, 2), (-2, 2), sigma=sigma, ub_matrix=UB)


def _normalized(n=15, seed=0):
    return np.random.default_rng(seed).uniform(0.05, 0.6, (n, n, n))


def _viewer_file(path, data, sigma=None):
    """The NeXus Viewer's hand-off layout: /entry/{data, mask, axes, ub_matrix[, sigma]}."""
    n = data.shape[0]
    with h5py.File(path, "w") as f:
        entry = f.create_group("entry")
        entry["data"] = data
        entry["mask"] = np.ones(data.shape, dtype=bool)
        for name in ("h_axis", "k_axis", "l_axis"):
            entry[name] = np.linspace(-2, 2, n)
        entry["ub_matrix"] = UB
        if sigma is not None:
            entry["sigma"] = sigma


def test_normalized_values_without_sigma_get_the_note():
    note = sigma_note(_vol(_normalized()))
    assert note is not None
    assert "√|I|" in note and "non-integer" in note and "the largest 0.6" in note
    assert "NeXus Viewer exports it" in note


def test_counts_or_a_given_sigma_need_no_note():
    counts = np.random.default_rng(1).poisson(40.0, (15, 15, 15)).astype(float)
    assert sigma_note(_vol(counts)) is None              # √|I| is the counts' error
    assert sigma_note(_vol(_normalized(), sigma=np.full((15, 15, 15), 0.01))) is None


def test_the_viewer_layout_reads_sigma_when_it_has_one(tmp_path):
    data = _normalized()
    _viewer_file(tmp_path / "none.nxs", data)
    _viewer_file(tmp_path / "with.nxs", data, sigma=np.full(data.shape, 0.02))
    without = nebula3d.load(tmp_path / "none.nxs")
    with_sigma = nebula3d.load(tmp_path / "with.nxs")
    assert without.sigma_estimated and sigma_note(without) is not None
    assert not with_sigma.sigma_estimated and sigma_note(with_sigma) is None
    np.testing.assert_array_equal(with_sigma.sigma, 0.02)


def test_the_flag_travels_with_a_saved_volume(tmp_path):
    for estimated in (True, False):
        vol = _vol(_normalized(), sigma=None if estimated else np.full((15, 15, 15), 0.01))
        nebula3d.save(vol, tmp_path / "v.nxs")
        assert nebula3d.load(tmp_path / "v.nxs").sigma_estimated is estimated


def test_the_punch_warns_in_its_log():
    events = []
    punch_bragg(_vol(_normalized()), PunchParams(), progress=lambda *a: events.append(a))
    warnings = [e[3] for e in events if e[0] == "punch" and e[3].startswith("⚠")]
    assert len(warnings) == 1 and "√|I|" in warnings[0]
    events.clear()
    punch_bragg(_vol(_normalized(), sigma=np.full((15, 15, 15), 0.01)), PunchParams(),
                progress=lambda *a: events.append(a))
    assert not [e for e in events if e[3].startswith("⚠")]
