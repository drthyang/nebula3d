"""The backfill's texture check on 3-D holes and their 3-D rims (fill_texture).

Known answers on synthetic volumes only: holes punched on a lattice of nodes
in a smooth diffuse that peaks at the nodes, and filled with the truth or set
off from it.  A fill equal to the truth has no bias; a fill set high by a
known share of the level in a share of the holes is a systematic bias with
that share; a bias under the floor is none, and so are fewer than five holes;
the backfill's own Laplace fill reads none, its whole-shell median one below.
The holes are scipy's 6-connected components whatever the slab, and the
low-memory path gives the same numbers.  Last, the Pilot's per-cut rule
(``web/src/llm/metrics/texture.ts``, ported below): on one plane the 3-D rule
is that rule, hole for hole; in 3-D a hole a cut crosses only at its edge is
judged as one crossed at its centre, and on the cut it is not.
"""

from __future__ import annotations

import dataclasses

import numpy as np
import pytest
from scipy import ndimage

from nebula3d.analysis import bragg_fill_texture as bft
from nebula3d.analysis import fill_texture, hole_texture, judge_fill_bias
from nebula3d.analysis.bragg_fill import backfill_bragg
from nebula3d.core import HKLVolume
from nebula3d.visualization import extract_slice

UB = 2 * np.pi * np.eye(3) / 4.0  # a cubic 4 Å cell: nodes 20 voxels apart at 0.05 r.l.u.
CROSS = ndimage.generate_binary_structure(3, 1)


@pytest.fixture(autouse=True)
def _native(monkeypatch):
    """Native mode unless a test asks for low memory: an earlier test's
    ``webbridge.setup()`` leaves ``NEBULA3D_LOW_MEMORY=1`` set."""
    monkeypatch.delenv("NEBULA3D_LOW_MEMORY", raising=False)


@dataclasses.dataclass
class Lattice:
    punched: HKLVolume
    filled: HKLVolume
    record: np.ndarray       # the punched voxels
    truth: np.ndarray        # the diffuse without noise
    biased: np.ndarray       # per hole (C order of its first voxel): the fill was set off


def _lattice(n=81, spacing=20, radius=3, width=8.0, amp=0.2, noise=0.01, seed=0, sats=(),
             nodes=None, bias=0.0, share=1.0, undulation=0.05, dtype=np.float64):
    """An n³ grid, 0.05 r.l.u. a voxel, holding a smooth diffuse (1 with a
    gentle *undulation*) and a Gaussian of height *amp* and *width* voxels
    at every node (every *spacing* voxels from the centre, or at *nodes*,
    voxel offsets) and at each of its *sats* (offsets).  Every one of them
    is punched as a ball of *radius* voxels.  The measured values carry
    Gaussian noise of *noise*.  The fill: the truth (no noise) in the gap
    band, a voxel deep outside the punch, as the Laplace fill rewrites it;
    the truth times 1 + *bias* in a *share* of the holes and the truth in
    the rest."""
    rng = np.random.default_rng(seed)
    g = np.arange(n) - n // 2
    H, K, L = np.meshgrid(g, g, g, indexing="ij")
    truth = 1.0 + undulation * np.cos(2 * np.pi * H / 97.0) * np.cos(2 * np.pi * K / 89.0)
    if nodes is None:
        ks = np.arange(-(n // 2) // spacing, (n // 2) // spacing + 1) * spacing
        nodes = [(a, b, c) for a in ks for b in ks for c in ks]
    record = np.zeros(H.shape, dtype=bool)
    for node in nodes:
        for d in [(0, 0, 0), *sats]:
            r2 = ((H - node[0] - d[0]) ** 2 + (K - node[1] - d[1]) ** 2
                  + (L - node[2] - d[2]) ** 2)
            truth = truth + amp * np.exp(-0.5 * r2 / width ** 2)
            record |= r2 <= radius * radius
    measured = truth + noise * rng.standard_normal(truth.shape)
    labels, n_holes = ndimage.label(record, structure=CROSS)
    biased = rng.permutation(n_holes) < round(share * n_holes)
    fill = measured.copy()
    band = ndimage.binary_dilation(record, structure=CROSS) & ~record
    fill[band] = truth[band]
    fill[record] = truth[record] * (1.0 + bias * biased[labels[record] - 1])
    half = (n // 2) * 0.05
    vol = HKLVolume.from_arrays(measured, (-half, half), (-half, half), (-half, half),
                                ub_matrix=UB, dtype=dtype)
    # The punch only clears the mask: the measured values stay under it.
    punched = dataclasses.replace(vol, mask=~record)
    filled = dataclasses.replace(vol, data=fill.astype(dtype), mask=np.ones(record.shape, bool))
    return Lattice(punched, filled, record, truth, biased)


# ---------------------------------------------------------------------------
# Known answers
# ---------------------------------------------------------------------------
def test_a_fill_equal_to_the_truth_has_no_bias():
    lat = _lattice()
    t = fill_texture(lat.punched, lat.filled, punch_record=lat.record)
    assert t.n_holes == 125 and t.n_judged == 125 and t.judged
    h = t.holes
    # The diffuse rises toward every node, and the truth lies between the
    # rim's level at the hole's edge and its rise continued to the hole.
    assert np.all(h.slope < 0) and np.all(h.edge <= h.fill) and np.all(h.fill <= h.peaked)
    assert np.all(h.bias == 0.0)
    assert t.median_fill_bias_sigma == 0.0 and t.median_fill_bias_level == 0.0
    assert t.above_fraction == t.below_fraction == 0.0
    assert t.above_floor_fraction == t.below_floor_fraction == 0.0
    assert not t.systematic_fill_bias
    # The 27 holes clear of the box's faces are balls of radius 3 (123
    # voxels) on their nodes, at integer h, k, l, with a rim of four rings
    # (1 + 2 + 3 + 4 voxels out, past the gap band).
    whole = h.voxels == 123
    assert whole.sum() == 27 and np.all(h.rim_voxels[whole] > 1000)
    assert np.allclose(h.centre_hkl[whole], np.round(h.centre_hkl[whole]))
    assert h.holes_from == "punch_record" and (h.rim, h.min_rim) == (4, 8)


@pytest.mark.parametrize("share, systematic", [(0.8, True), (0.6, False)])
def test_a_fill_set_high_in_a_share_of_the_holes_is_read_with_that_share(share, systematic):
    """Half the local level too high in 80 % of the holes: a systematic bias,
    the 80 % read back exactly.  In 60 % the medians are as large, but under
    three quarters of the holes lean that way: none."""
    lat = _lattice(bias=0.5, share=share)
    t = fill_texture(lat.punched, lat.filled, punch_record=lat.record)
    bl = t.holes.bias_level
    assert t.n_judged == 125
    assert np.array_equal(t.holes.bias > 0, lat.biased)          # exactly the holes set off
    assert np.all(t.holes.bias[~lat.biased] == 0.0)
    assert np.all(np.abs(bl[lat.biased] - 0.5) < 0.02)            # each by half its level
    assert t.above_fraction == t.above_floor_fraction == pytest.approx(share, abs=0.004)
    assert t.below_fraction == t.below_floor_fraction == 0.0
    assert t.median_fill_bias_level == pytest.approx(0.5, abs=0.02)
    assert t.median_fill_bias_sigma > 10.0
    assert t.systematic_fill_bias is systematic


def test_a_bias_under_the_floor_is_none():
    """A tenth of the level, in every hole: well past 0.5σ on these
    statistics, and every hole leans up, but under a fifth of the level."""
    lat = _lattice(bias=0.1)
    t = fill_texture(lat.punched, lat.filled, punch_record=lat.record)
    assert t.above_fraction == 1.0 and t.median_fill_bias_sigma > 5.0
    assert t.median_fill_bias_level == pytest.approx(0.1, abs=0.01)
    assert t.above_floor_fraction == 0.0
    assert not t.systematic_fill_bias
    # The floor is a parameter: at 0.05 the same holes are a systematic bias.
    low = judge_fill_bias(t.holes, floor=0.05)
    assert low.systematic_fill_bias and low.above_floor_fraction == 1.0


def test_fewer_than_five_holes_are_not_judged():
    nodes = [(-20, -20, 0), (-20, 20, 0), (20, -20, 0), (20, 20, 0)]
    lat = _lattice(n=61, nodes=nodes, bias=0.5)
    t = fill_texture(lat.punched, lat.filled, punch_record=lat.record)
    assert t.n_holes == t.n_judged == 4
    assert not t.judged and not t.systematic_fill_bias
    # Each hole on its own leans up by half its level.
    assert t.above_floor_fraction == 1.0
    assert t.median_fill_bias_level == pytest.approx(0.5, abs=0.02)
    # With four holes allowed, the same holes are a systematic bias.
    four = judge_fill_bias(t.holes, min_holes=4)
    assert four.judged and four.systematic_fill_bias


def test_the_backfills_own_fills():
    """The default Laplace fill continues the diffuse into each hole: no
    systematic bias.  The whole-shell median (``q_shell``) ignores the
    diffuse peaked at the nodes, and on a sharply node-peaked diffuse reads a
    systematic bias below, the node-periodic bias the backfill's docs warn of."""
    lat = _lattice(width=4.0, amp=1.0)
    for method, systematic in (("laplace", False), ("q_shell", True)):
        filled = backfill_bragg(dataclasses.replace(lat.punched, data=lat.punched.data.copy()),
                                method=method, punched=lat.record, direct_beam_fill=False)
        t = fill_texture(lat.punched, filled, punch_record=lat.record)
        assert t.n_judged == 125
        assert t.systematic_fill_bias is systematic, method
        if systematic:
            assert t.median_fill_bias_level < -0.2 and t.below_fraction >= 0.75
        else:
            assert abs(t.median_fill_bias_level) < 0.02


# ---------------------------------------------------------------------------
# Holes, rims and the cases not judged
# ---------------------------------------------------------------------------
@pytest.mark.parametrize("slab", [None, 1, 2, 7])
def test_holes_are_the_6_connected_components_whatever_the_slab(slab):
    """Random blobs, many crossing slab faces, some touching only at an edge
    (two holes) and some at a face (one): scipy's components on the whole
    volume, in the same order."""
    rng = np.random.default_rng(4)
    shape = (23, 29, 31)
    mask = ndimage.binary_dilation(rng.random(shape) < 0.01, iterations=1)
    mask |= rng.random(shape) < 0.03
    vol = HKLVolume.from_arrays(1.0 + 0.01 * rng.standard_normal(shape), (-1, 1), (-1, 1),
                                (-1, 1))
    punched = dataclasses.replace(vol, mask=~mask)
    h = hole_texture(punched, vol, slab=slab)
    labels, n = ndimage.label(mask, structure=CROSS)
    assert h.n == n > 100
    sizes = np.bincount(labels.ravel())[1:]
    centres = np.array(ndimage.center_of_mass(mask, labels, np.arange(1, n + 1)))
    assert np.array_equal(h.voxels, sizes)
    assert np.allclose(h.centre, centres, rtol=0, atol=1e-9)
    assert h.holes_from == "masks"


def test_the_record_leaves_out_unmeasured_voxels_the_fill_filled():
    """Dead voxels inside the coverage: unmeasured in both stages' masks
    until the backfill fills them.  texture.ts's test takes them for holes;
    the punch's record does not."""
    lat = _lattice(n=61)
    dead = np.zeros(lat.record.shape, bool)
    dead[20, 20, 20] = dead[40, 20, 40] = dead[20, 40, 20] = True  # between the nodes
    punched = dataclasses.replace(lat.punched, mask=lat.punched.mask & ~dead)
    by_masks = hole_texture(punched, lat.filled)
    by_record = hole_texture(punched, lat.filled, punch_record=lat.record)
    assert by_masks.n == by_record.n + 3
    assert by_masks.holes_from == "masks" and by_record.holes_from == "punch_record"
    assert sorted(by_masks.voxels.tolist()) == sorted(by_record.voxels.tolist() + [1, 1, 1])


def test_holes_not_judged(monkeypatch):
    # A constant diffuse without noise: the rim lies on its trend, σ = 0.
    flat = _lattice(n=41, noise=0.0, amp=0.0, undulation=0.0)
    h = hole_texture(flat.punched, flat.filled, punch_record=flat.record)
    assert set(h.not_judged) == {"flat rim"} and np.all(np.isnan(h.bias))
    assert np.all(h.fill == 1.0) and np.all(h.rim_voxels > 300)  # measured, not judged
    # The middle node's surroundings unmeasured but for three voxels two out
    # from its hole (past the gap band): too thin a rim.  The other 26 holes
    # are judged.
    lat = _lattice(n=41)
    mask = lat.punched.mask.copy()
    mask[12:29, 12:29, 12:29] = False
    for voxel in ((20, 20, 25), (20, 25, 20), (25, 20, 20)):
        mask[voxel] = True
    t = fill_texture(dataclasses.replace(lat.punched, mask=mask), lat.filled,
                     punch_record=lat.record)
    middle = int(np.flatnonzero(np.all(t.holes.centre == 20, axis=1))[0])
    assert t.holes.not_judged[middle] == "thin rim" and t.holes.rim_voxels[middle] == 3
    assert t.n_holes == 27 and t.n_judged == 26
    # Holes whose box with its rim is past the limit (the smallest, a node in
    # a corner of the box, has 8³ voxels).
    monkeypatch.setattr(bft, "MAX_REGION_VOXELS", 500)
    big = hole_texture(lat.punched, lat.filled, punch_record=lat.record)
    assert set(big.not_judged) == {"too large"} and big.rim_voxels.sum() == 0
    t = judge_fill_bias(big)
    assert t.n_judged == 0 and not t.judged and not t.systematic_fill_bias
    assert np.isnan(t.median_fill_bias_sigma) and np.isnan(t.above_fraction)


def test_bad_arguments():
    lat = _lattice(n=41)
    for bad in ({"rim": 0}, {"min_rim": 0}, {"min_sigma": -1.0}, {"one_way": 1.5},
                {"min_holes": 0}, {"floor": float("nan")}):
        with pytest.raises(ValueError):
            fill_texture(lat.punched, lat.filled, **bad)
    with pytest.raises(ValueError, match="shape"):
        fill_texture(lat.punched, lat.filled, punch_record=lat.record[:-1])
    other = HKLVolume.from_arrays(np.zeros((41, 41, 40)), (-1, 1), (-1, 1), (-1, 1))
    with pytest.raises(ValueError, match="grid"):
        fill_texture(lat.punched, other)
    shifted = dataclasses.replace(lat.filled, l_axis=lat.filled.l_axis + 0.05)
    with pytest.raises(ValueError, match="grid"):                 # same shape, other axes
        fill_texture(lat.punched, shifted)


def test_low_memory_gives_the_same_numbers(monkeypatch):
    lat = _lattice(width=4.0, amp=1.0, bias=0.12, sats=[(10, 10, 3)], dtype=np.float32)
    native = fill_texture(lat.punched, lat.filled, punch_record=lat.record)
    masks = fill_texture(lat.punched, lat.filled)
    monkeypatch.setenv("NEBULA3D_LOW_MEMORY", "1")
    for slab in (None, 1, 3):
        for ref, record in ((native, lat.record), (masks, None)):
            lean = fill_texture(lat.punched, lat.filled, punch_record=record, slab=slab)
            for f in dataclasses.fields(ref.holes):
                a, b = getattr(ref.holes, f.name), getattr(lean.holes, f.name)
                if isinstance(a, np.ndarray):
                    assert np.array_equal(a, b, equal_nan=True), f.name
                else:
                    assert a == b, f.name
            for f in dataclasses.fields(ref):
                if f.name != "holes":
                    a, b = getattr(ref, f.name), getattr(lean, f.name)
                    assert a == b or (a != a and b != b), f.name
    # The record and texture.ts's test find the same holes here.
    assert np.array_equal(native.holes.bias, masks.holes.bias)


# ---------------------------------------------------------------------------
# texture.ts's per-cut rule, on cuts and on the volume
# ---------------------------------------------------------------------------
TS_RIM = 4  # texture.ts RIM


def ts_holes(punched, filled):
    """texture.ts ``findHoles`` and ``holeBias``, line for line, on two cuts as
    the slice endpoint sends them (float32, masked voxels NaN).  Per hole, in
    the order findHoles finds them: its size and centre (row, column) and,
    when judged, ``bias``, ``sigma`` and ``level``."""
    ny, nx = punched.shape
    P = np.asarray(punched, dtype=np.float32).reshape(-1).astype(float).tolist()
    F = np.asarray(filled, dtype=np.float32).reshape(-1).astype(float).tolist()
    finite = np.isfinite
    mask = [not finite(P[i]) and finite(F[i]) for i in range(ny * nx)]
    seen = [False] * (ny * nx)
    holes = []
    for start in range(ny * nx):
        if not mask[start] or seen[start]:
            continue
        hole, stack = [], [start]
        seen[start] = True
        while stack:
            i = stack.pop()
            hole.append(i)
            x = i % nx
            y = (i - x) // nx
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                xx, yy = x + dx, y + dy
                if xx < 0 or yy < 0 or xx >= nx or yy >= ny:
                    continue
                j = yy * nx + xx
                if mask[j] and not seen[j]:
                    seen[j] = True
                    stack.append(j)
        holes.append(hole)

    def cheb(i, j):
        return max(abs(i % nx - j % nx), abs(i // nx - j // nx))

    out = []
    for hole in holes:
        xs, ys = [i % nx for i in hole], [i // nx for i in hole]
        x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
        in_hole = set(hole)
        outside = [y * nx + x for y in range(max(0, y0 - 1), min(ny - 1, y1 + 1) + 1)
                   for x in range(max(0, x0 - 1), min(nx - 1, x1 + 1) + 1)
                   if y * nx + x not in in_hole]
        rim_s, rim_v = [], []
        for y in range(max(0, y0 - TS_RIM), min(ny - 1, y1 + TS_RIM) + 1):
            for x in range(max(0, x0 - TS_RIM), min(nx - 1, x1 + TS_RIM) + 1):
                j = y * nx + x
                p = P[j]
                if mask[j] or not finite(p) or F[j] != p:
                    continue
                d = min(cheb(i, j) for i in hole)
                if 1 <= d <= TS_RIM:
                    rim_s.append(d)
                    rim_v.append(p)
        row = {"n": len(hole), "centre": (sum(ys) / len(hole), sum(xs) / len(hole))}
        out.append(row)
        if len(rim_v) < 8 or len(set(rim_s)) < 2:
            continue
        n = len(rim_s)
        ms, mv = sum(rim_s) / n, sum(rim_v) / n
        sxy = sum((rim_s[k] - ms) * (rim_v[k] - mv) for k in range(n))
        sxx = sum((rim_s[k] - ms) ** 2 for k in range(n))
        b = sxy / sxx if sxx > 0 else 0.0
        a = mv - b * ms
        level = float(np.median(rim_v))                     # sliceStats median
        sigma = 1.4826 * float(np.median([abs(rim_v[k] - (a + b * rim_s[k]))
                                          for k in range(n)]))
        if not sigma > 0:
            continue
        fill = sum(F[i] for i in hole) / len(hole)
        s_mean = sum(1 - min(cheb(i, j) for j in outside) for i in hole) / len(hole)
        flat, peaked = a + b, a + b * s_mean
        lo, hi = min(flat, peaked), max(flat, peaked)
        row.update(bias=fill - hi if fill > hi else fill - lo if fill < lo else 0.0,
                   sigma=sigma, level=level)
    return out


def ts_summary(holes, floor=0.2):
    """texture.ts ``textureMetrics``, its fill-bias part."""
    judged = [h for h in holes if "bias" in h]
    in_sigma = [h["bias"] / h["sigma"] for h in judged]
    in_level = [h["bias"] / abs(h["level"]) for h in judged if abs(h["level"]) > 0]
    bias = float(np.median(in_sigma)) if in_sigma else None
    bias_level = float(np.median(in_level)) if in_level else None
    above = sum(h["bias"] > 0 for h in judged) / len(judged) if judged else None
    below = sum(h["bias"] < 0 for h in judged) / len(judged) if judged else None
    one_way = (bias is not None and above is not None and below is not None
               and (above >= 0.75 if bias > 0 else below >= 0.75))
    return {"n_holes": len(holes), "median_fill_bias_sigma": bias,
            "median_fill_bias_level": bias_level, "above_fraction": above,
            "below_fraction": below,
            "systematic_fill_bias": (len(judged) >= 5 and bias is not None and abs(bias) >= 0.5
                                     and bias_level is not None and abs(bias_level) >= floor
                                     and one_way)}


def _cut(vol, il):
    """The hk cut at grid plane *il*, as the slice endpoint serves it."""
    return extract_slice(vol, "hk", float(vol.l_axis[il])).data.astype(np.float32)


def _level_bias(holes):
    return np.array([h["bias"] / abs(h["level"]) for h in holes])


def test_on_one_plane_the_3d_rule_is_texture_ts():
    """A volume one plane thick: its 6-connected holes are the plane's
    4-connected ones and the chessboard distances are the plane's, so each
    hole's facts are the per-cut rule's, hole for hole."""
    lat = _lattice(width=4.0, amp=1.0, bias=0.12, sats=[(10, 10, 3)])
    for il in (40, 43, 37):                 # the nodes' plane, the satellites', the nodes' poles
        p, f = _cut(lat.punched, il), _cut(lat.filled, il)
        ts = ts_holes(p, f)
        plane = HKLVolume.from_arrays(np.nan_to_num(p)[None], (0, 0), (-2, 2), (-2, 2))
        punched = dataclasses.replace(plane, mask=np.isfinite(p)[None])
        filled = dataclasses.replace(plane, data=np.nan_to_num(f)[None],
                                     mask=np.isfinite(f)[None])
        t = fill_texture(punched, filled)
        assert t.n_holes == len(ts) > 20
        for k, row in enumerate(ts):
            assert t.holes.voxels[k] == row["n"]
            assert tuple(t.holes.centre[k, 1:]) == pytest.approx(row["centre"])
            if "bias" not in row:
                assert t.holes.not_judged[k] is not None
                continue
            for name in ("bias", "sigma", "level"):
                assert getattr(t.holes, name)[k] == pytest.approx(row[name], rel=1e-9,
                                                                  abs=1e-12), name
        want = ts_summary(ts)
        for name, value in want.items():
            got = getattr(t, name)
            assert got == (pytest.approx(value, rel=1e-9) if isinstance(value, float)
                           else value), name


def test_a_hole_crossed_at_its_edge_is_judged_as_one_crossed_at_its_centre():
    """Nodes on the plane l = 0 and a satellite beside each, at (½, ½, 0.15)
    r.l.u., all punched alike and all filled 12 % too high, on a diffuse
    sharply peaked at every one of them.  The two are the same hole in the
    same surroundings, mirrored.

    In 3-D they read the same, past the floor: a systematic fill bias.  The
    per-cut rule on the nodes' plane crosses each node at its centre and each
    satellite only at its pole, a single voxel whose rim in the plane lies
    off the satellite, where the diffuse is rounded: it reads the nodes past
    the floor and the satellites under it.  On the plane through the nodes'
    lower poles every hole it crosses is crossed at its edge, and that cut
    reads no systematic bias at all."""
    lat = _lattice(width=4.0, amp=1.0, bias=0.12, sats=[(10, 10, 3)])
    t = fill_texture(lat.punched, lat.filled, punch_record=lat.record)
    assert t.n_judged == t.n_holes and t.systematic_fill_bias
    c = 40                                                   # the grid plane l = 0
    # Clear of the box's faces: 9 nodes on l = 0 and the 16 satellites
    # beside them, at l = 0.15 (grid indices).
    node_at = [(c + a, c + b) for a in (-20, 0, 20) for b in (-20, 0, 20)]
    sat_at = [(c + a, c + b) for a in (-30, -10, 10, 30) for b in (-30, -10, 10, 30)]

    def at(centres, points):
        return np.array([any(np.allclose(x, p) for p in points) for x in centres])

    nodes = at(t.holes.centre, [(*p, c) for p in node_at])
    sats = at(t.holes.centre, [(*p, c + 3) for p in sat_at])
    assert nodes.sum() == 9 and sats.sum() == 16
    bl = t.holes.bias_level
    assert np.ptp(bl[nodes | sats]) < 0.01                   # one reading for both
    assert np.all(bl[nodes | sats] > 0.25)                   # past the floor

    on_plane = ts_holes(_cut(lat.punched, c), _cut(lat.filled, c))   # rows k, columns h
    centres = [h["centre"] for h in on_plane]
    crossed_at_centre = [h for h, x in zip(on_plane, at(centres, node_at)) if x]
    crossed_at_edge = [h for h, x in zip(on_plane, at(centres, sat_at)) if x]
    assert [h["n"] for h in crossed_at_centre] == [29] * 9   # the ball's widest section
    assert [h["n"] for h in crossed_at_edge] == [1] * 16     # the satellite's pole
    assert _level_bias(crossed_at_centre).min() > 0.25       # past the floor ...
    assert _level_bias(crossed_at_edge).max() < 0.13         # ... and under it
    assert ts_summary(on_plane)["systematic_fill_bias"]      # the nodes carry this cut

    poles = ts_holes(_cut(lat.punched, c - 3), _cut(lat.filled, c - 3))
    assert len(poles) == 25 and all(h["n"] == 1 for h in poles)   # the nodes' lower poles
    s = ts_summary(poles)
    assert s["above_fraction"] == 1.0 and s["median_fill_bias_level"] < 0.12
    assert not s["systematic_fill_bias"]
