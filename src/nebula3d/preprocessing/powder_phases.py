# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Tsung-han Yang

"""Which phase made the extra powder rings: a small phase library and a matcher.

The ring removal (:mod:`nebula3d.preprocessing.pooled_rings`) fits the
aluminium of the sample environment and judges every shell; the rings left
unexplained by the Al lines may come from another phase in the beam: the flux
the crystal grew from (inclusions), another part of the sample environment,
ice, a holder. This module names the likely one, as a possibility with its
evidence, and removes nothing.

The library
-----------
``powder_phases.json`` (versioned) holds each phase's space group, a
room-temperature cell with its source, and the atoms of its cell. From them
:meth:`Phase.lines` computes every allowed reflection (the extinctions follow
from the atoms: a structure factor that vanishes is an absent line), merges
the reflections at one d-spacing into a powder line, and gives its neutron
intensity, from the bound coherent scattering lengths of Sears (1992):

    I = Σ |F_hkl|² / (V² Q²)

summed over the line's reflections (its multiplicity times |F|²): the line's
integrated intensity per unit volume of the phase *in a reciprocal-space
volume*. A powder spreads the reflection's weight over the sphere of radius
Q, of area 4πQ², so its density in the volume falls as 1/Q²: the powder
Lorentz factor of a volume binned in Q, which differs from the
1/(sin θ sin 2θ) of a constant-wavelength powder pattern. No Debye–Waller
factor is applied: the volume's own fall-off, read off its Al lines where
the removal fitted them, scales every phase alike (:func:`match_phases`).
For X-rays no intensity is modelled (their form factors are not in the
library): the lines are matched by position alone.

The matcher
-----------
:func:`match_phases` reads the across-stack radial profile of the ring stage
(the median over the planes of each plane's median profile) and its excess
over the SNIP baseline. For each phase it fits one isotropic lattice scale
(thermal contraction, within ±``max_scale``) and correlates the phase's
predicted lines, broadened to the rings' width, with the excess over the
measured |Q| not covered by another ring (an Al line, a shell judged the
crystal's own): a matched filter, whose significance must hold with any one
line left out, so one strong ring alone cannot name a phase. Strong
predicted lines missing from the measured range count against it, through
the same fit and in a check of their own; lines hidden under another ring
are neither. The rings it explains within their FWHM are counted and named,
and the rest listed as unmatched. With the fitted Al as the reference, the
amount of the phase it implies is checked: neutrons barely see vanadium, so
V rings as strong as the Al's would need far more V than Al in the beam.
"""

from __future__ import annotations

import json
import math
import os
import re
from collections.abc import Callable, Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from fractions import Fraction
from functools import lru_cache
from pathlib import Path
from typing import Any

import numpy as np
from numpy.typing import NDArray

#: The shipped library.
LIBRARY_FILE = Path(__file__).with_name("powder_phases.json")
#: An environment variable naming a file of extra phases, in the library's
#: format (its ``phases``, and ``scattering_lengths.b_coh`` for new elements).
LIBRARY_ENV = "NEBULA3D_POWDER_PHASES"
#: The library format this module reads.
SCHEMA_VERSION = 1

_CENTERING: dict[str, tuple[tuple[float, float, float], ...]] = {
    "P": ((0.0, 0.0, 0.0),),
    "I": ((0.0, 0.0, 0.0), (0.5, 0.5, 0.5)),
    "F": ((0.0, 0.0, 0.0), (0.0, 0.5, 0.5), (0.5, 0.0, 0.5), (0.5, 0.5, 0.0)),
    "C": ((0.0, 0.0, 0.0), (0.5, 0.5, 0.0)),
    "A": ((0.0, 0.0, 0.0), (0.0, 0.5, 0.5)),
    "B": ((0.0, 0.0, 0.0), (0.5, 0.0, 0.5)),
    # Rhombohedral on hexagonal axes, obverse (-h + k + l = 3n).
    "R": ((0.0, 0.0, 0.0), (2 / 3, 1 / 3, 1 / 3), (1 / 3, 2 / 3, 2 / 3)),
}

#: Atomic numbers, for the X-ray positions-only lines (which reflections a
#: cell allows; no intensity is claimed from them).
_Z = {"H": 1, "D": 1, "C": 6, "N": 7, "O": 8, "Al": 13, "Si": 14, "Ti": 22, "V": 23,
      "Cr": 24, "Mn": 25, "Fe": 26, "Ni": 28, "Cu": 29, "Zn": 30, "Ga": 31, "Nb": 41,
      "Mo": 42, "In": 49, "Sn": 50, "Sb": 51, "Te": 52, "W": 74, "Pb": 82, "Bi": 83}

_TERM = re.compile(r"([+-]?)\s*(\d+(?:\.\d+)?(?:/\d+)?)?\s*\*?\s*([xyz])?")


def _parse_op(op: str) -> tuple[NDArray[np.float64], NDArray[np.float64]]:
    """A coordinate triplet ("-y,x-y,z+1/3") as the rotation R and translation t
    of r' = R r + t."""
    parts = op.replace(" ", "").lower().split(",")
    if len(parts) != 3:
        raise ValueError(f"a symmetry operation has three parts: {op!r}")
    rot = np.zeros((3, 3))
    tr = np.zeros(3)
    for i, part in enumerate(parts):
        pos = 0
        while pos < len(part):
            m = _TERM.match(part, pos)
            if m is None or m.end() == pos:
                raise ValueError(f"cannot read {part!r} in the symmetry operation {op!r}")
            sign = -1.0 if m.group(1) == "-" else 1.0
            num, var = m.group(2), m.group(3)
            value = float(Fraction(num)) if num else 1.0
            if var:
                rot[i, "xyz".index(var)] += sign * value
            elif num:
                tr[i] += sign * value
            else:
                raise ValueError(f"cannot read {part!r} in the symmetry operation {op!r}")
            pos = m.end()
    return rot, tr


def _coord(v: object) -> float:
    """A fractional coordinate: a number, or a fraction written as a string."""
    if isinstance(v, str):
        return float(Fraction(v.strip()))
    if isinstance(v, (int, float)):
        return float(v)
    raise ValueError(f"a coordinate must be a number or a fraction: {v!r}")


def _items(x: object) -> list[Any]:
    return list(x) if isinstance(x, (list, tuple)) else []


def _dicts(x: object) -> list[dict[str, Any]]:
    return [d for d in _items(x) if isinstance(d, dict)]


def _num(x: object, default: float = 0.0) -> float:
    return float(x) if isinstance(x, (int, float)) else default


WidthFn = Callable[[NDArray[np.float64]], NDArray[np.float64]]


@dataclass(frozen=True)
class Line:
    """One powder line: the reflections at one d-spacing."""

    hkl: str                 # its strongest reflection, e.g. "012" (or "1 0 10")
    d: float                 # Å, at the library cell
    q: float                 # 2π/d, Å⁻¹
    multiplicity: int        # reflections merged, Friedel mates counted
    f2: float                # Σ|F|² over them, per cell (fm² for neutrons)
    intensity: float         # Σ|F|²/(V² Q²): per unit volume of phase in a Q volume


@dataclass(frozen=True)
class Phase:
    """One library entry (see the module docstring and powder_phases.json)."""

    id: str
    name: str
    group: str               # "flux", "sample environment" or "other"
    elements: tuple[str, ...]
    space_group: str
    cell: tuple[float, float, float, float, float, float]   # a, b, c (Å), α, β, γ (°)
    source: str
    atoms: tuple[tuple[str, float, float, float, float], ...]  # (element, x, y, z, occupancy)
    b_coh: Mapping[str, float] = field(default_factory=dict, compare=False, repr=False)

    @property
    def volume(self) -> float:
        return float(abs(np.linalg.det(_direct_matrix(self.cell))))

    def scattering_power(self) -> float:
        """Σ occ·b² over the cell's atoms per unit volume (fm² Å⁻³): what one
        unit volume of the phase gives to its Bragg lines in all, before
        Debye–Waller. Vanadium's is about 1/70 of aluminium's."""
        return float(sum(o * self.b_coh[el] ** 2 for el, _x, _y, _z, o in self.atoms)) / self.volume

    def lines(self, q_max: float, *, radiation: str = "neutron", q_min: float = 0.0) -> list[Line]:
        """Every allowed powder line with q_min < Q ≤ q_max at the library cell
        (see the module docstring). ``radiation="xray"`` weighs each atom by its
        atomic number, to tell which reflections the cell allows; its
        intensities are not modelled and are not to be read."""
        return list(_lines(self, float(q_max), radiation, float(q_min)))


def _direct_matrix(cell: Sequence[float]) -> NDArray[np.float64]:
    """Columns a, b, c in Cartesian coordinates (a along x, b in the xy plane)."""
    a, b, c, al, be, ga = cell
    ca, cb, cg = (math.cos(math.radians(x)) for x in (al, be, ga))
    sg = math.sin(math.radians(ga))
    cx = c * cb
    cy = c * (ca - cb * cg) / sg
    cz = math.sqrt(max(c * c - cx * cx - cy * cy, 0.0))
    return np.array([[a, b * cg, cx], [0.0, b * sg, cy], [0.0, 0.0, cz]])


def _hkl_label(h: int, k: int, l: int) -> str:
    if min(h, k, l) >= 0 and max(h, k, l) < 10:
        return f"{h}{k}{l}"
    return f"{h} {k} {l}"


@lru_cache(maxsize=256)
def _lines_cached(phase: Phase, q_max: float, radiation: str, q_min: float) -> tuple[Line, ...]:
    return tuple(_compute_lines(phase, q_max, radiation, q_min))


def _lines(phase: Phase, q_max: float, radiation: str, q_min: float) -> tuple[Line, ...]:
    return _lines_cached(phase, round(q_max, 6), radiation, round(q_min, 6))


def _compute_lines(phase: Phase, q_max: float, radiation: str, q_min: float) -> list[Line]:
    if radiation not in ("neutron", "xray"):
        raise ValueError(f"radiation must be 'neutron' or 'xray', got {radiation!r}")
    direct = _direct_matrix(phase.cell)
    recip = np.linalg.inv(direct).T          # columns a*, b*, c* (no 2π)
    d_max = q_max / (2.0 * np.pi)
    lens = np.linalg.norm(direct, axis=0)
    hmax = [int(np.floor(d_max * n)) + 1 for n in lens]
    h, k, l = (np.arange(-m, m + 1) for m in hmax)
    hkl = np.stack(np.meshgrid(h, k, l, indexing="ij"), axis=-1).reshape(-1, 3)
    hkl = hkl[np.any(hkl != 0, axis=1)]
    dstar = np.linalg.norm(hkl @ recip.T, axis=1)
    q = 2.0 * np.pi * dstar
    keep = (q <= q_max * (1.0 + 1e-12)) & (q > q_min)
    hkl, q = hkl[keep], q[keep]
    if q.size == 0:
        return []
    el = [a[0] for a in phase.atoms]
    xyz = np.array([a[1:4] for a in phase.atoms], dtype=np.float64)
    occ = np.array([a[4] for a in phase.atoms], dtype=np.float64)
    weight = np.array([phase.b_coh[e] if radiation == "neutron" else float(_Z[e]) for e in el])
    amp = occ * weight
    phases = 2.0 * np.pi * (hkl.astype(np.float64) @ xyz.T)
    f_re = np.cos(phases) @ amp
    f_im = np.sin(phases) @ amp
    f2 = f_re ** 2 + f_im ** 2
    # An absent reflection: |F|² vanishes against the cell's scattering.
    allowed = f2 > 1e-8 * float(np.sum(np.abs(amp))) ** 2
    hkl, q, f2 = hkl[allowed], q[allowed], f2[allowed]
    if q.size == 0:
        return []
    # Merge the reflections at one d-spacing (equivalents and coincidences).
    order = np.argsort(q, kind="stable")
    hkl, q, f2 = hkl[order], q[order], f2[order]
    edges = np.flatnonzero(np.diff(q) > 1e-7 * q[1:]) + 1
    vol = phase.volume
    out: list[Line] = []
    for idx in np.split(np.arange(q.size), edges):
        qq = float(np.mean(q[idx]))
        total = float(np.sum(f2[idx]))
        # The label: the strongest reflection, non-negative indices first.
        best = max(idx, key=lambda i: (round(float(f2[i]), 6),
                                       -int(np.sum(hkl[i] < 0)),
                                       tuple(int(x) for x in hkl[i])))
        out.append(Line(_hkl_label(*(int(x) for x in hkl[best])), 2.0 * np.pi / qq, qq,
                        int(idx.size), total, total / (vol * vol * qq * qq)))
    return out


@dataclass(frozen=True)
class Halo:
    """A broad-feature entry (a polymer such as Kapton or GE varnish, for
    X-rays): the centres and FWHMs (Å⁻¹) of its amorphous halos, from the
    cited ``source``. Matched against the profile's broad excess
    (:func:`match_broad`), apart from the sharp rings."""

    id: str
    name: str
    halos: tuple[tuple[float, float], ...]
    source: str


@dataclass(frozen=True)
class Library:
    """The phases, and where they came from."""

    phases: tuple[Phase, ...]
    version: str
    sources: tuple[str, ...]           # the files read
    scattering_lengths_source: str
    broad: tuple[Halo, ...] = ()

    def get(self, phase_id: str) -> Phase:
        for p in self.phases:
            if p.id == phase_id:
                return p
        raise KeyError(phase_id)


def _phase(entry: Mapping[str, object], b_coh: Mapping[str, float]) -> Phase:
    pid = str(entry["id"])
    cell_in = entry.get("cell")
    if not isinstance(cell_in, Mapping) or "a" not in cell_in:
        raise ValueError(f"phase {pid}: 'cell' needs at least 'a'")
    a = float(cell_in["a"])
    sg = str(entry.get("space_group", ""))
    # Hexagonal axes (γ = 120°) for a trigonal or hexagonal group given a and c.
    hexagonal = ("b" not in cell_in and "c" in cell_in
                 and sg[1:].lstrip().startswith(("3", "-3", "6", "-6")))
    b = float(cell_in.get("b", a))
    c = float(cell_in.get("c", a))
    alpha = float(cell_in.get("alpha", 90.0))
    beta = float(cell_in.get("beta", 90.0))
    gamma = float(cell_in.get("gamma", 120.0 if hexagonal else 90.0))
    centering = str(entry.get("centering", "P"))
    if centering not in _CENTERING:
        raise ValueError(f"phase {pid}: unknown centering {centering!r}")
    ops_in = entry.get("ops") or ["x,y,z"]
    if not isinstance(ops_in, list):
        raise ValueError(f"phase {pid}: 'ops' must be a list of coordinate triplets")
    ops = [_parse_op(str(o)) for o in ops_in]
    sites = entry.get("sites")
    if not isinstance(sites, list) or not sites:
        raise ValueError(f"phase {pid}: 'sites' must list at least one atom")
    atoms: list[tuple[str, float, float, float, float]] = []
    for s in sites:
        if not isinstance(s, Mapping):
            raise ValueError(f"phase {pid}: a site must be an object")
        el = str(s["el"])
        if el not in b_coh:
            raise ValueError(f"phase {pid}: no scattering length for {el!r}")
        xyz_in = s["xyz"]
        if not isinstance(xyz_in, list) or len(xyz_in) != 3:
            raise ValueError(f"phase {pid}: a site's 'xyz' has three coordinates")
        r = np.array([_coord(v) for v in xyz_in])
        occ = float(s.get("occ", 1.0))
        seen: list[NDArray[np.float64]] = []
        for rot, tr in ops:
            for t in _CENTERING[centering]:
                p = np.mod(rot @ r + tr + np.asarray(t), 1.0)
                p[np.isclose(p, 1.0, atol=1e-6)] = 0.0
                if not any(np.all(np.abs(((p - o) + 0.5) % 1.0 - 0.5) < 1e-4) for o in seen):
                    seen.append(p)
        atoms.extend((el, float(p[0]), float(p[1]), float(p[2]), occ) for p in seen)
    elements = entry.get("elements")
    return Phase(
        id=pid, name=str(entry.get("name", pid)), group=str(entry.get("group", "other")),
        elements=tuple(str(e) for e in elements) if isinstance(elements, list)
        else tuple(sorted({a[0] for a in atoms})),
        space_group=sg, cell=(a, b, c, alpha, beta, gamma), source=str(entry.get("source", "")),
        atoms=tuple(atoms), b_coh=dict(b_coh))


def _read(path: Path) -> dict[str, object]:
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise ValueError(f"{path}: a phase library is a JSON object")
    version = data.get("schema_version", SCHEMA_VERSION)
    if version != SCHEMA_VERSION:
        raise ValueError(f"{path}: schema_version {version}, this nebula3d reads {SCHEMA_VERSION}")
    return data


def load_library(path: str | Path | None = None, *,
                 extra: Iterable[str | Path] = ()) -> Library:
    """The phase library: the shipped file (or ``path``), then each ``extra``
    file and the one named by :data:`LIBRARY_ENV`, whose phases are added
    (or replace a phase of the same id) and whose scattering lengths are
    added. Raises ``ValueError`` on an entry it cannot read."""
    files = [Path(path) if path is not None else LIBRARY_FILE, *(Path(p) for p in extra)]
    env = os.environ.get(LIBRARY_ENV)
    if env:
        files.append(Path(env))
    return _load(tuple(str(f) for f in files))


@lru_cache(maxsize=8)
def _load(files: tuple[str, ...]) -> Library:
    b_coh: dict[str, float] = {}
    entries: dict[str, Mapping[str, object]] = {}
    broad: dict[str, Halo] = {}
    version, b_source = "", ""
    for i, name in enumerate(files):
        data = _read(Path(name))
        sl = data.get("scattering_lengths")
        if isinstance(sl, Mapping):
            table = sl.get("b_coh")
            if isinstance(table, Mapping):
                b_coh.update({str(k): float(v) for k, v in table.items()})
            if i == 0:
                b_source = str(sl.get("source", ""))
        if i == 0:
            version = str(data.get("library_version", ""))
        phases = data.get("phases")
        if not isinstance(phases, list):
            raise ValueError(f"{name}: 'phases' must be a list")
        for entry in phases:
            if not isinstance(entry, Mapping) or "id" not in entry:
                raise ValueError(f"{name}: every phase needs an 'id'")
            entries[str(entry["id"])] = entry
        for entry in _items(data.get("broad")):
            halo = _halo(entry, name)
            broad[halo.id] = halo
    return Library(tuple(_phase(e, b_coh) for e in entries.values()), version, files, b_source,
                   tuple(broad.values()))


def _halo(entry: object, name: str) -> Halo:
    if not isinstance(entry, Mapping) or "id" not in entry:
        raise ValueError(f"{name}: every broad entry needs an 'id'")
    hid = str(entry["id"])
    halos = entry.get("halos")
    if not isinstance(halos, list) or not halos:
        raise ValueError(f"broad entry {hid}: 'halos' must list at least one halo")
    out = []
    for h in halos:
        if not isinstance(h, Mapping) or float(h.get("fwhm", 0)) <= 0 or float(h.get("q", 0)) <= 0:
            raise ValueError(f"broad entry {hid}: a halo needs a positive 'q' and 'fwhm' (Å⁻¹)")
        out.append((float(h["q"]), float(h["fwhm"])))
    if not str(entry.get("source", "")).strip():
        raise ValueError(f"broad entry {hid}: cite the 'source' of its halos")
    return Halo(hid, str(entry.get("name", hid)), tuple(out), str(entry["source"]))


# ---------------------------------------------------------------------------
# The matcher
# ---------------------------------------------------------------------------

#: The largest isotropic lattice scale fitted: thermal contraction between
#: room temperature and a cryostat (a few tenths of a per cent for most
#: metals) and a library cell's own spread, with room to spare.
MAX_SCALE = 0.015
#: The per-line uncertainty of a predicted intensity, as a factor (log-normal
#: σ of ln 2): texture, absorption, extinction and Debye–Waller differences.
#: A line is called missing only below a quarter of its expected height
#: (two such σ).
MODEL_FACTOR = 2.0
#: How far a ring's FWHM may be from the rings' width at its |Q|, as a
#: factor, for a phase's line to explain it: a powder in the beam gives its
#: lines the instrument's width, as the Al's (with room for a weak ring's
#: width, which the detection reads off its half height, on a neighbour's
#: flank too).
WIDTH_FACTOR = 2.5
#: −log10 of the chance probability a candidate needs (the matched filter's
#: significance with any one line left out, for the scales tried and every
#: phase of the library): a likely phase 3 (1 in 1000), a possible one 1.3
#: (1 in 20).
LIKELY_SCORE, POSSIBLE_SCORE = 3.0, 1.3
#: Rings matched within their FWHM a candidate needs: a likely phase 3, a
#: possible one 2. One ring alone never names a phase: a scale can put any
#: phase's line on it.
LIKELY_RINGS, POSSIBLE_RINGS = 3, 2
#: The most of a phase, per unit volume of the fitted Al in the beam, a
#: likely candidate may need (neutrons): more, and it is at most possible.
#: Vanadium rings as strong as the Al's would need about 70 times its volume.
MAX_AMOUNT_VS_AL = 10.0
#: How far a lattice may sit on the "wrong" side of its room-temperature
#: cell when the data's temperature is known: below 250 K a phase has
#: contracted (all the library's phases shrink in volume on cooling), above
#: 350 K expanded; the margin covers the spread of library cells and an
#: anisotropic contraction read as one scale.
SCALE_MARGIN = 0.0025
#: A fitted scale this close to the edge of the window tried is "at its
#: limit": the candidate is at most possible.
AT_LIMIT = 0.0005
#: Two candidates of one status whose scores differ by less than this are
#: named together ("Te or Bi"): the data do not tell them apart.
AMBIGUOUS_SCORE = 1.0
#: Other candidates are reported beside the first only while their score is
#: within this of its own (a factor of 1000): a phase that explains a few of
#: the rings the first explains, by chance, is no alternative.
ALSO_SCORE = 3.0
#: The ranking's prior for a flux phase whose element is in the sample's
#: composition: odds × 10 (one unit of the score). It orders candidates of
#: one status and never changes a status.
COMPOSITION_PRIOR = 1.0
#: Candidates reported, the first the one the record names.
MAX_CANDIDATES = 3
#: The phase-match record's format.
RECORD_VERSION = 1

_GAUSS_AREA = 0.5 * math.sqrt(math.pi / math.log(2.0))   # ∫ of a unit-peak Gaussian / FWHM


@dataclass(frozen=True)
class Ring:
    """A ring the Al lines leave unexplained: its |Q|, FWHM and peak excess
    (the across-stack profile's, data units), and how the ring removal saw it:
    ``"ring"`` confirmed (and removed), ``"left"`` detected and not confirmed
    (``code``: why, as :func:`~nebula3d.preprocessing.pooled_rings.shell_summary`
    says it), ``"weak"`` under the detection cut, found for this match only."""

    q: float
    fwhm: float
    amplitude: float
    source: str = "ring"
    code: str = ""


@dataclass(frozen=True)
class Cover:
    """A shell whose |Q| range no phase line is judged in: an Al line, or a
    shell the ring test showed to be the crystal's own."""

    q: float
    fwhm: float
    label: str


@dataclass(frozen=True)
class AlReference:
    """The fitted Al as the intensity reference: ``k``, the observed
    integrated intensity per unit of predicted (:attr:`Line.intensity`), and
    ``b``, the fall-off its lines show, exp(−b Q²/8π²) (Å²; Debye–Waller,
    absorption and normalisation together)."""

    k: float
    b: float
    rings: int


def al_reference(rings: Sequence[tuple[float, float, float]], al_a: float,
                 library: Library | None = None) -> AlReference | None:
    """The Al reference from the confirmed Al rings ``(q, fwhm, amplitude)``
    and the fitted lattice ``al_a``: ln(observed/predicted) = ln k − b Q²/8π²
    by least squares over the rings (weighted by amplitude), ``b`` kept within
    0 and 2 Å² (fewer than three rings: ``b`` 0). None without a ring."""
    lib = library or load_library()
    try:
        al = lib.get("Al")
    except KeyError:
        return None
    s = al.cell[0] / al_a
    lines = al.lines(max((r[0] for r in rings), default=0.0) / s + 0.5)
    pts = []
    for q, f, amp in rings:
        if not (amp > 0 and f > 0):
            continue
        near = [ln for ln in lines if abs(ln.q * s - q) <= max(0.5 * f, 0.03)]
        if not near:
            continue
        pred = sum(ln.intensity for ln in near) * s ** 2   # Q² of the scaled line
        pts.append((q, math.log(amp * f * _GAUSS_AREA / pred), amp))
    if not pts:
        return None
    x = np.array([p[0] ** 2 / (8.0 * np.pi ** 2) for p in pts])
    y = np.array([p[1] for p in pts])
    w = np.array([p[2] for p in pts])
    b = 0.0
    if len(pts) >= 3 and np.ptp(x) > 0:
        slope = np.polyfit(x, y, 1, w=np.sqrt(w))[0]
        b = float(np.clip(-slope, 0.0, 2.0))
    lnk = float(np.average(y + b * x, weights=w))
    return AlReference(k=math.exp(lnk), b=b, rings=len(pts))


def _gauss(q: NDArray[np.float64], centres: NDArray[np.float64],
           widths: NDArray[np.float64]) -> NDArray[np.float64]:
    """Unit-peak Gaussians (lines × bins)."""
    sig = widths[:, None] / (2.0 * math.sqrt(2.0 * math.log(2.0)))
    return np.exp(-0.5 * ((q[None, :] - centres[:, None]) / sig) ** 2)


def _norm_sf(z: float) -> float:
    """One-sided tail of the normal distribution."""
    return 0.5 * math.erfc(z / math.sqrt(2.0))


def _round(x: float, n: int = 4) -> float:
    return float(round(float(x), n))


def match_phases(
    q_grid: NDArray[np.float64],
    excess: NDArray[np.float64],
    measured: NDArray[np.bool_],
    noise: float,
    rings: Sequence[Ring],
    *,
    width: tuple[NDArray[np.float64], NDArray[np.float64]] | float,
    covers: Sequence[Cover] = (),
    al: AlReference | None = None,
    floor: float | None = None,
    radiation: str = "neutron",
    composition: Iterable[str] = (),
    library: Library | None = None,
    exclude: Iterable[str] = (),
    max_scale: float = MAX_SCALE,
    temperature: float | None = None,
) -> dict[str, object]:
    """Which library phase explains the ``rings`` (see the module docstring).

    ``q_grid``/``excess``/``measured``: the across-stack profile's bins, its
    excess over the SNIP baseline, and which bins are measured; ``noise`` its
    bin noise. ``width``: the rings' FWHM, one value or (|Q|, FWHM) points
    interpolated (kept within their range). ``covers``: shells under which no
    line is judged. ``al``: the fitted Al reference (neutrons), whose fall-off
    every phase is given and against which each phase's amount is checked.
    ``floor``: the detection cut the rings were found at (default 3 × noise).
    ``exclude``: phases not to try (the Al the ring removal fitted).
    ``temperature`` (K), if known, keeps the scale on its side of room
    temperature (:data:`SCALE_MARGIN`); ``composition``, the sample's elements
    if known, orders the flux candidates (:func:`rank`).

    Returns the JSON-ready record: the rings, the candidates (likely, then
    possible; at most :data:`MAX_CANDIDATES`, the first the best), each with
    its scale, the rings it explains, its lines matched, hidden and missing,
    and the rings no candidate explains.
    """
    lib = library or load_library()
    q = np.asarray(q_grid, dtype=np.float64)
    e = np.nan_to_num(np.asarray(excess, dtype=np.float64))
    meas = np.asarray(measured, dtype=bool) & np.isfinite(np.asarray(excess, dtype=np.float64))
    floor = 3.0 * noise if floor is None else float(floor)
    step = float(np.median(np.diff(q))) if q.size > 1 else 0.02
    if isinstance(width, tuple):
        wq, wf = (np.asarray(v, dtype=np.float64) for v in width)
        order = np.argsort(wq)
        wq, wf = wq[order], wf[order]

        def wfun(x: NDArray[np.float64]) -> NDArray[np.float64]:
            return np.clip(np.interp(x, wq, wf), max(float(wf.min()), 2.0 * step), None)
    else:
        w0 = max(float(width), 2.0 * step)

        def wfun(x: NDArray[np.float64]) -> NDArray[np.float64]:
            return np.full(np.shape(x), w0)

    rings = sorted(rings, key=lambda r: r.q)
    record: dict[str, object] = {
        "version": RECORD_VERSION, "library": lib.version, "radiation": radiation,
        "intensities": radiation == "neutron",
        "scales": [_round(x, 4) for x in _scale_window(max_scale, temperature)],
        **({"temperature_K": _round(temperature, 1)} if temperature is not None else {}),
        "falloff_b": _round(al.b, 3) if al is not None and radiation == "neutron" else None,
        "rings": [{"q": _round(r.q), "fwhm": _round(r.fwhm),
                   "snr": _round(r.amplitude / noise, 1) if noise > 0 else None,
                   "source": r.source, **({"code": r.code} if r.code else {})}
                  for r in rings],
        "candidates": [],
        "unmatched": [_round(r.q) for r in rings],
    }
    usable_q = q[meas]
    if len(rings) < POSSIBLE_RINGS or usable_q.size < 4 or not noise > 0:
        return record
    # Bins under another ring (an Al line, the crystal's own shell) judge no
    # line: as far as that ring's own peak stands above the noise (its tails
    # reach further the stronger it is), and half a line's width beyond.
    covered = np.zeros(q.size, dtype=bool)
    wq_bins = wfun(q)
    for c in covers:
        covered |= np.abs(q - c.q) <= _cover_reach(c, e, q, noise) + 0.5 * wq_bins
    usable = meas & ~covered
    q_lo, q_hi = float(usable_q.min()), float(usable_q.max())
    skip = set(exclude)
    phases = [p for p in lib.phases if p.id not in skip]
    out = []
    for phase in phases:
        cand = _match_one(phase, q, e, usable, meas, covers, rings, noise, floor, wfun, al,
                          radiation, _scale_window(max_scale, temperature), q_lo, q_hi, step,
                          len(phases))
        if cand is not None:
            out.append(cand)
    record["candidates"] = out
    return rank(record, composition)


#: The scales whose correlation calibrates a phase's matched filter: the
#: phase's pattern at these wrong scales meets the profile's structure by
#: chance only, so their spread is the filter's noise, correlated structure
#: included (the profile's bin noise alone would understate it).
NULL_SCALES = (0.05, 0.25)


def _kernels(q: NDArray[np.float64], centres: NDArray[np.float64],
             widths: NDArray[np.float64]) -> tuple[NDArray[np.float64], NDArray[np.float64]]:
    """Each line's peak (unit height, its FWHM) and its zero-sum kernel: the
    peak less half of one twice as wide, so a smooth excess under it reads as
    nothing, and a ring beside it little (lines × bins)."""
    g = _gauss(q, centres, widths)
    return g, g - _gauss(q, centres, 2.0 * widths) / 2.0


def _cover_reach(c: Cover, e: NDArray[np.float64], q: NDArray[np.float64], noise: float) -> float:
    """How far from its centre a covering ring's own peak stands above the
    noise: σ √(2 ln(height/noise)) for its height in the excess, at least half
    its FWHM."""
    sig = c.fwhm / (2.0 * math.sqrt(2.0 * math.log(2.0)))
    height = float(np.interp(c.q, q, e)) if q.size else 0.0
    ratio = height / noise if noise > 0 else 0.0
    return max(0.5 * c.fwhm, sig * math.sqrt(2.0 * math.log(ratio)) if ratio > 1.0 else 0.0)


def _scale_window(max_scale: float, temperature: float | None) -> tuple[float, float]:
    """The lattice scales tried: ± ``max_scale``, kept on the side of room
    temperature the data's ``temperature`` is on, if known."""
    lo, hi = -max_scale, max_scale
    if temperature is not None and temperature < 250.0:
        hi = min(hi, SCALE_MARGIN)
    elif temperature is not None and temperature > 350.0:
        lo = max(lo, -SCALE_MARGIN)
    return lo, hi


def _match_one(phase: Phase, q: NDArray[np.float64], e: NDArray[np.float64],
               usable: NDArray[np.bool_], meas: NDArray[np.bool_], covers: Sequence[Cover],
               rings: Sequence[Ring], noise: float, floor: float, wfun: WidthFn,
               al: AlReference | None, radiation: str, window: tuple[float, float], q_lo: float,
               q_hi: float, step: float, n_phases: int) -> dict[str, object] | None:
    lo_s, hi_s = NULL_SCALES
    lines = phase.lines(q_hi * (1.0 + hi_s) + 0.3, radiation=radiation,
                        q_min=max(0.0, q_lo * (1.0 - hi_s) - 0.3))
    if not lines:
        return None
    q0 = np.array([ln.q for ln in lines])
    if radiation == "neutron":
        b = al.b if al is not None else 0.0
        inten = np.array([ln.intensity for ln in lines]) * np.exp(-b * q0 ** 2 / (8.0 * np.pi ** 2))
    else:
        inten = np.ones(q0.size)                     # positions only
    w = np.asarray(wfun(q0), dtype=np.float64)
    weight = inten / (_GAUSS_AREA * w)               # peak height per unit amount
    keep = weight >= 1e-3 * float(weight.max())
    lines = [ln for ln, kk in zip(lines, keep) if kk]
    q0, w, weight, inten = q0[keep], w[keep], weight[keep], inten[keep]
    # Each line's kernel in ln|Q|, where a lattice scale is a shift: built
    # once on a fine grid, read at each scale (a line's width in |Q| changes
    # with the scale by under 1.5 % in the fit, 25 % in the null: neglected).
    du = float(np.min(w / q0)) / 12.0
    u = np.arange(math.log(max(q_lo * (1.0 - hi_s), 1e-3)) - 0.05,
                  math.log(q_hi * (1.0 + hi_s)) + 0.05, du)
    # (lines × grid points: at most about 400 × 5,500 on a full volume, 16 MB)
    k_u = _kernels(np.exp(u), q0, w)[1]
    sig_min = float(w.min()) / 2.3548

    def fit_on(use: NDArray[np.bool_], null: tuple[float, float] | None = None) -> _Fit | None:
        """The scale that best fits the phase's lines over the bins ``use``,
        its significance, and the null it is judged against (computed here,
        or the one given: ``null``, its median and spread)."""
        qu, eu = q[use], e[use]
        if qu.size < 4:
            return None
        lnq = np.log(qu)

        def stats(eps_i: float) -> tuple[float, float]:
            # The matched filter's significance at one scale, and the same
            # with the line that carries most of it left out (bin-noise units).
            pos = (lnq + math.log1p(eps_i) - u[0]) / du
            i0 = np.clip(np.floor(pos).astype(np.intp), 0, u.size - 2)
            f = np.clip(pos - i0, 0.0, 1.0)
            kb = k_u[:, i0] * (1.0 - f) + k_u[:, i0 + 1] * f    # lines × bins
            d = weight * (kb @ eu)
            t = weight @ kb
            tn2 = float(t @ t)
            if tn2 <= 0:
                return 0.0, 0.0
            kt = weight * (kb @ t)
            kk = weight ** 2 * np.einsum("ij,ij->i", kb, kb)
            rest = np.maximum(tn2 - 2.0 * kt + kk, 1e-30)
            z_full = float(d.sum()) / (noise * math.sqrt(tn2))
            z_less = (float(d.sum()) - d) / (noise * np.sqrt(rest))
            return z_full, float(np.min(np.where(rest > 1e-12 * tn2, z_less, z_full)))

        n_eps = max(int(np.ceil((window[1] - window[0]) * q_hi / (0.1 * sig_min))) + 1, 3)
        eps = np.linspace(window[0], window[1], n_eps)
        fit = [stats(x) for x in eps]
        i_best = int(np.argmax([zz for zz, _l in fit]))
        z, z_loo = fit[i_best]
        # The null: the same statistic, one line left out, at scales where
        # the phase's pattern meets the profile by chance only. Leaving a line
        # out there too keeps one strong ring of another phase, which some
        # line of this one crosses at many wrong scales, from inflating it.
        if null is None:
            n_null = max(int(np.ceil((hi_s - lo_s) * q_hi / (0.5 * sig_min))), 24)
            zs_null = np.array([stats(sg * x)[1] for sg in (-1.0, 1.0)
                                for x in np.linspace(lo_s, hi_s, n_null)])
            m0 = float(np.median(zs_null))
            s0 = max(1.4826 * float(np.median(np.abs(zs_null - m0))), 1.0)
        else:
            m0, s0 = null
        eps_best = float(eps[i_best])
        qs = q0 / (1.0 + eps_best)
        g, kern = _kernels(qu, qs, w)
        t = weight @ kern
        den = float(t @ (weight @ g))
        k = float(t @ eu) / den if den > 0 else 0.0  # the amount: observed per unit predicted
        return _Fit(eps_best, z, (z_loo - m0) / s0, m0, s0, qs, g, kern, k, eu)

    def explained_by(fit: _Fit) -> tuple[list[tuple[int, int]], float]:
        """(ring, line) pairs, each ring and the strongest line within its
        FWHM, and the amount they imply: the median over them of the ring's
        integrated excess over the lines' predicted intensity. A ring whose
        lines that amount makes more than a factor MODEL_FACTOR² too weak or
        too strong is not theirs; the amount is read again without it."""
        near = {}
        for i, r in enumerate(rings):
            tol = max(0.5 * r.fwhm, step)
            js = [j for j in range(fit.qs.size) if abs(fit.qs[j] - r.q) <= tol]
            if not js or not r.amplitude > 0:
                continue
            # A powder line has the rings' width there, and lines of the
            # phase too close to resolve make one ring as wide as they
            # spread: a ring far narrower or broader is not theirs.
            w_r = float(wfun(np.array([r.q]))[0])
            close = fit.qs[np.abs(fit.qs - r.q) <= 0.5 * (r.fwhm + w_r)]
            spread = float(np.ptp(close)) if close.size else 0.0
            if w_r / WIDTH_FACTOR <= r.fwhm <= WIDTH_FACTOR * w_r + spread:
                near[i] = js
        amount = 0.0
        for _round_ in range(2 if radiation == "neutron" else 0):
            ratio = {i: rings[i].amplitude * rings[i].fwhm * _GAUSS_AREA
                     / float(np.sum(inten[js])) for i, js in near.items()}
            if not ratio:
                return [], 0.0
            amount = float(np.exp(np.median(np.log(list(ratio.values())))))
            near = {i: js for i, js in near.items()
                    if MODEL_FACTOR ** -2 <= ratio[i] / amount <= MODEL_FACTOR ** 2}
        if near and radiation != "neutron":
            amount = 1.0                             # positions only: no amount
        return [(i, max(js, key=lambda jj: weight[jj])) for i, js in near.items()], amount

    first = fit_on(usable)
    if first is None or not first.z > 0:
        return None
    # The rings this phase does not explain are another source's: covered,
    # like the Al lines, and the phase fitted again without them.
    pairs, k = explained_by(first)
    foreign = [Cover(r.q, r.fwhm, f"ring {r.q:.2f}") for i, r in enumerate(rings)
               if i not in {p for p, _j in pairs}]
    fit = first
    if foreign:
        use2 = usable.copy()
        wq_bins = np.asarray(wfun(q), dtype=np.float64)
        for c in foreign:
            use2 &= ~(np.abs(q - c.q) <= _cover_reach(c, e, q, noise) + 0.5 * wq_bins)
        # The null stays the first fit's: the other rings, which this phase's
        # lines cross at wrong scales, are what makes a chance match likely.
        again = fit_on(use2, (first.m0, first.s0))
        if again is None or not again.z > 0:
            return None
        fit, usable = again, use2
        covers = [*covers, *foreign]
        pairs, k = explained_by(fit)
    if not pairs:
        return None
    # The amount is the one the matched rings imply: what else the phase
    # predicts at it must be there too.
    qs, kern, eps_best = fit.qs, fit.kern, fit.eps
    reach = np.abs(kern).sum(axis=1)
    q_eff = float(np.sum(weight * reach * qs) / max(float(np.sum(weight * reach)), 1e-30))
    trials = max(1.0, (window[1] - window[0]) * q_eff / float(np.median(w) / 2.3548))
    p_eff = min(1.0, _norm_sf(max(fit.z_cal, 0.0)) * trials * n_phases)
    score = -math.log10(max(p_eff, 1e-300))
    # Each line: matched to a ring, hidden under another, unmeasured, or judged.
    g_full = _gauss(q, qs, w)
    full_norm = np.sum(g_full ** 2, axis=1)
    use_norm = np.sum((g_full * usable[None, :]) ** 2, axis=1)
    meas_norm = np.sum((g_full * meas[None, :]) ** 2, axis=1)
    expected = k * weight                            # the peak height each line should have
    predicted = expected @ g_full                    # the phase's profile at that amount
    explained = {i for i, _j in pairs}
    used_line = {j for _i, j in pairs}
    matched = [{"hkl": lines[j].hkl, "q": _round(qs[j]), "ring": _round(rings[i].q)}
               for i, j in pairs]
    hidden: list[dict[str, object]] = []
    missing: list[dict[str, object]] = []
    penalty = 0.0
    if radiation == "neutron" and k > 0:
        for j in range(qs.size):
            if j in used_line or meas_norm[j] < 0.5 * full_norm[j] or expected[j] < floor:
                continue
            if use_norm[j] < 0.5 * full_norm[j]:
                under = min(covers, key=lambda c: abs(c.q - qs[j]), default=None)
                if under is not None and abs(under.q - qs[j]) <= (
                        _cover_reach(under, e, q, noise) + 0.5 * w[j] + step):
                    hidden.append({"hkl": lines[j].hkl, "q": _round(qs[j]), "under": under.label})
                continue
            # Its core against what the phase predicts there, its neighbours'
            # lines included: how likely the excess is as low as it reads,
            # the prediction uncertain by MODEL_FACTOR (log-normal); what it
            # costs the phase.
            core = usable & (np.abs(q - qs[j]) <= 0.5 * w[j])
            n_core = int(core.sum())
            if n_core == 0:
                continue
            pred = float(np.mean(predicted[core]))
            seen = max(float(np.mean(e[core])), 0.0) + 2.0 * noise / math.sqrt(n_core)
            if pred < 3.0 * noise / math.sqrt(n_core):
                continue                            # too weak to be seen either way
            cost = -math.log10(max(_norm_sf(math.log(max(pred / seen, 1e-12))
                                            / math.log(MODEL_FACTOR)), 1e-300))
            cost = max(cost - math.log10(2.0), 0.0)  # an even chance costs nothing
            penalty += cost
            if cost >= 1.0:
                missing.append({"hkl": lines[j].hkl, "q": _round(qs[j])})
    score -= penalty
    n_match = len(explained)
    amount = k / al.k if (al is not None and radiation == "neutron" and al.k > 0) else None
    too_much = amount is not None and amount > MAX_AMOUNT_VS_AL
    # A scale at the edge of those tried is where the fit was stopped, not
    # where it settled: the lattice it needs lies beyond the window.
    at_limit = min(abs(eps_best - window[0]), abs(window[1] - eps_best)) <= AT_LIMIT
    if (score >= LIKELY_SCORE and n_match >= LIKELY_RINGS and not missing and not too_much
            and not at_limit):
        status = "likely"
    elif score >= POSSIBLE_SCORE and n_match >= POSSIBLE_RINGS and k > 0:
        status = "possible"
    else:
        return None
    return {
        "phase": phase.id, "name": phase.name, "group": phase.group,
        "elements": list(phase.elements), "status": status,
        "scale": _round(eps_best, 5), "matched": n_match, "of": len(rings),
        "significance": _round(fit.z_cal, 1), "score": _round(score, 2),
        **({"missing_cost": _round(penalty, 2)} if penalty > 0 else {}),
        **({"amount_vs_al": float(f"{amount:.3g}")} if amount is not None else {}),
        **({"at_limit": True} if at_limit else {}),
        "lines": matched, "hidden": hidden, "missing": missing,
        "unmatched": [_round(r.q) for i, r in enumerate(rings) if i not in explained],
    }


@dataclass(frozen=True)
class _Fit:
    """One phase's fit over a set of bins (:func:`_match_one`)."""

    eps: float                       # the lattice scale
    z: float                         # the matched filter's significance (bin noise)
    z_cal: float                     # with one line left out, against the null's spread
    m0: float                        # the null's median, in bin-noise units
    s0: float                        # the null's spread, in bin-noise units (≥ 1)
    qs: NDArray[np.float64]          # the lines at the scale
    g: NDArray[np.float64]           # their peaks over the bins (lines × bins)
    kern: NDArray[np.float64]        # their zero-sum kernels
    k: float                         # the amount: observed per unit predicted
    eu: NDArray[np.float64]          # the excess over the bins


#: A halo is reported where its amplitude stands this many times its error
#: above a line through its surroundings.
HALO_SIGNIFICANCE = 5.0
#: How far a halo's centre may sit from its cited place, as a share of |Q|.
HALO_SHIFT = 0.05


def match_broad(q_grid: NDArray[np.float64], profile: NDArray[np.float64],
                measured: NDArray[np.bool_], *, rings: Sequence[Ring] = (),
                library: Library | None = None) -> list[dict[str, object]]:
    """The broad-feature entries whose halos the profile shows (X-rays).

    Each halo of an entry is fitted, at its cited FWHM and a centre within
    ± :data:`HALO_SHIFT` of its cited one, with a line under it, over twice
    its FWHM either side (the sharp rings' bins left out); it is there when
    its amplitude stands :data:`HALO_SIGNIFICANCE` times its error (from the
    fit's residual) above the line. An entry is reported, "possibly a ...
    halo", when all its halos measured are there. Nothing is subtracted."""
    lib = library or load_library()
    q = np.asarray(q_grid, dtype=np.float64)
    y = np.asarray(profile, dtype=np.float64)
    ok = np.asarray(measured, dtype=bool) & np.isfinite(y)
    for r in rings:
        ok &= np.abs(q - r.q) > r.fwhm
    out: list[dict[str, object]] = []
    for entry in lib.broad:
        found = []
        for qh, wh in entry.halos:
            best: tuple[float, float, float] | None = None
            for centre in np.linspace(qh * (1 - HALO_SHIFT), qh * (1 + HALO_SHIFT), 21):
                sel = ok & (np.abs(q - centre) <= 2.0 * wh)
                if sel.sum() < 8 or np.ptp(q[sel]) < 2.0 * wh:
                    continue
                x = q[sel] - centre
                g = np.exp(-4.0 * math.log(2.0) * (x / wh) ** 2)
                design = np.stack([np.ones_like(x), x, g], axis=1)
                coef, *_ = np.linalg.lstsq(design, y[sel], rcond=None)
                resid = y[sel] - design @ coef
                dof = max(int(sel.sum()) - 3, 1)
                rms = float(np.sqrt(np.sum(resid ** 2) / dof))
                cov = np.linalg.pinv(design.T @ design)
                err = rms * math.sqrt(max(float(cov[2, 2]), 0.0))
                sig = float(coef[2]) / err if err > 0 else 0.0
                if best is None or sig > best[0]:
                    best = (sig, float(centre), float(coef[2]))
            if best is None:
                continue                                # not measured: neither for nor against
            found.append((best, wh))
        if found and all(b[0] >= HALO_SIGNIFICANCE and b[2] > 0 for b, _w in found):
            out.append({"id": entry.id, "name": entry.name,
                        "halos": [{"q": _round(b[1], 3), "fwhm": _round(w, 3),
                                   "significance": _round(b[0], 1)} for b, w in found]})
    return out


def rank(record: dict[str, object], composition: Iterable[str] = ()) -> dict[str, object]:
    """The record's candidates in order: likely before possible, then by score,
    a flux phase whose element is in ``composition`` (the sample's) given
    :data:`COMPOSITION_PRIOR` (and marked ``in_composition``); at most
    :data:`MAX_CANDIDATES`, the others only within :data:`ALSO_SCORE` of the
    first. ``unmatched``: the rings the first leaves
    unexplained (all of them without a candidate). In place, and returned."""
    comp = {str(c) for c in composition}
    cands = _dicts(record.get("candidates"))
    for c in cands:
        c["in_composition"] = bool(c.get("group") == "flux" and comp
                                   and any(el in comp for el in _items(c.get("elements"))))
        if not c["in_composition"]:
            c.pop("in_composition")

    def key(c: dict[str, Any]) -> tuple[int, float]:
        tier = 0 if c.get("status") == "likely" else 1
        prior = COMPOSITION_PRIOR if c.get("in_composition") else 0.0
        return tier, -(_num(c.get("score")) + prior)

    cands.sort(key=key)
    for c in cands:
        c.pop("or", None)
    if len(cands) >= 2 and key(cands[0])[0] == key(cands[1])[0] \
            and key(cands[1])[1] - key(cands[0])[1] < AMBIGUOUS_SCORE:
        cands[0]["or"] = cands[1]["phase"]
    if cands:
        best = -key(cands[0])[1]
        cands = [cands[0], *(c for c in cands[1:] if -key(c)[1] >= best - ALSO_SCORE)]
    record["candidates"] = cands[:MAX_CANDIDATES]
    record["unmatched"] = (_items(cands[0].get("unmatched")) if cands
                           else [r.get("q") for r in _dicts(record.get("rings"))])
    return record


#: The element symbols a dataset's name may hold, for :func:`elements_in_name`.
_ELEMENTS = frozenset((
    "H He Li Be B C N O F Ne Na Mg Al Si P S Cl Ar K Ca Sc Ti V Cr Mn Fe Co Ni Cu Zn Ga Ge As "
    "Se Br Kr Rb Sr Y Zr Nb Mo Tc Ru Rh Pd Ag Cd In Sn Sb Te I Xe Cs Ba La Ce Pr Nd Pm Sm Eu "
    "Gd Tb Dy Ho Er Tm Yb Lu Hf Ta W Re Os Ir Pt Au Hg Tl Pb Bi Po At Rn Fr Ra Ac Th Pa U Np "
    "Pu Am").split())
_FORMULA = re.compile(r"(?:[A-Z][a-z]?(?:\d+(?:\.\d+)?)?)+")
_SYMBOL = re.compile(r"([A-Z][a-z]?)(?:\d+(?:\.\d+)?)?")


def elements_in_name(name: str) -> set[str]:
    """The elements of the chemical formulas a dataset's file name holds: each
    word (split at anything but letters, digits and dots) that reads as a
    formula of two elements or more, every symbol a real element ("Fe3Ge2_90K"
    gives Fe and Ge; "CORELLI" or "sub_bkg" nothing)."""
    out: set[str] = set()
    for word in re.split(r"[^A-Za-z0-9.]+", Path(name).name):
        if not word or not _FORMULA.fullmatch(word):
            continue
        symbols = _SYMBOL.findall(word)
        if len(set(symbols)) >= 2 and all(s in _ELEMENTS for s in symbols):
            out.update(symbols)
    return out


_TEMPERATURE = re.compile(r"(?<![A-Za-z0-9.])(\d+(?:\.\d+)?)K(?![A-Za-z])")


def temperature_in_name(name: str) -> float | None:
    """The temperature a dataset's file name gives, as "22K" or "1.5K" (one
    value only; None for none, or for several that disagree)."""
    found = {float(m.group(1)) for m in _TEMPERATURE.finditer(Path(name).name)}
    return found.pop() if len(found) == 1 else None


#: How many of each list :func:`summary` names (the rest it counts): the
#: lines matched, hidden and missing, and the rings left.
SUMMARY_ITEMS = 4


def _listed(items: list[str]) -> str:
    more = f", +{len(items) - SUMMARY_ITEMS} more" if len(items) > SUMMARY_ITEMS else ""
    return ", ".join(items[:SUMMARY_ITEMS]) + more


def summary(record: object) -> str | None:
    """The phase match in one line, for NEBULA Pilot, or None without a
    candidate: the best one as a possibility, its rings matched of those
    unexplained by the Al and its lattice scale; its lines matched (hkl at
    the ring's |Q|), hidden under another ring and missing; the rings it
    leaves; and the next candidate, if any. Each list names at most
    :data:`SUMMARY_ITEMS` and counts the rest."""
    if not isinstance(record, dict):
        return None
    cands = _dicts(record.get("candidates"))
    halos = "; ".join(f"possibly a {b.get('name')} halo at "
                      + ", ".join(f"{_num(h.get('q')):.2f}" for h in _dicts(b.get("halos")))
                      for b in _dicts(record.get("broad")))
    if not cands:
        return halos or None
    c = cands[0]
    alt = c.get("or")
    word = "likely" if c.get("status") == "likely" and not alt else "possibly"
    flux = " flux" if c.get("group") == "flux" else ""
    name = f"{c.get('phase')} or {alt}" if alt else f"{c.get('phase')}{flux}"
    scale = 100.0 * _num(c.get("scale"))
    parts = [f"{word} {name}: {c.get('matched')} of {c.get('of')} rings matched, "
             f"scale {scale:+.1f} %"]
    lines = _dicts(c.get("lines"))
    if lines:
        parts.append("lines " + _listed([f"{ln.get('hkl')} {_num(ln.get('ring')):.2f}"
                                         for ln in lines]))
    hidden = _dicts(c.get("hidden"))
    if hidden:
        parts.append("hidden " + _listed([f"{h.get('hkl')} under {h.get('under')}"
                                          for h in hidden]))
    missing = _dicts(c.get("missing"))
    if missing:
        parts.append("missing " + _listed([f"{m.get('hkl')} {_num(m.get('q')):.2f}"
                                           for m in missing]))
    left = _items(c.get("unmatched"))
    parts.append("unmatched " + (_listed([f"{_num(x):.2f}" for x in left]) if left else "none"))
    if c.get("at_limit"):
        parts.append("scale at its limit")
    amount = c.get("amount_vs_al")
    if isinstance(amount, (int, float)) and amount >= 1.0:
        parts.append(f"needs {amount:g}× the Al's volume")
    if len(cands) > 1:
        parts.append("also " + ", ".join(f"{o.get('phase')} ({o.get('status')})"
                                         for o in cands[1:]))
    if halos:
        parts.append(halos)
    return "; ".join(parts)


__all__ = ["LIBRARY_ENV", "LIBRARY_FILE", "AlReference", "Cover", "Halo", "Library", "Line",
           "Phase", "Ring", "al_reference", "elements_in_name", "load_library", "match_broad",
           "match_phases", "rank", "summary", "temperature_in_name"]
