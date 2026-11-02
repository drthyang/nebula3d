"""The powder-phase library and the matcher's parts (THY-62).

The library's cells and atoms are those of the COD entries each phase names;
these tests hold them to independently published powder patterns: the
d-spacings of the strongest lines (the NBS/ICDD reference patterns), which
lines a space group allows, and, for the elements and graphite and quartz,
which low-angle line is strongest. The X-ray patterns' intensities include
form factors the neutron model has no need of, so only the strongest
low-angle line, which a monotonic form factor cannot reorder much, is held
to them; silicon, corundum, gallium and the ices are held to their d-spacings
and extinctions only.
"""

import json
import math

import numpy as np
import pytest

from nebula3d.preprocessing import powder_phases as pp

# Reference powder patterns: (hkl as the library labels it, d in Å). NBS
# Circular 539 / Monograph 25 and the ICDD cards citing them, at room
# temperature; the ice values below 0 °C.
CITED_D = {
    "Al": [("111", 2.338), ("200", 2.024), ("220", 1.431), ("311", 1.221)],
    "Cu": [("111", 2.088), ("200", 1.808), ("220", 1.278)],
    "Pb": [("111", 2.855), ("200", 2.475), ("220", 1.750)],
    "W": [("110", 2.238), ("200", 1.582), ("211", 1.292)],
    "Fe": [("110", 2.027), ("200", 1.433), ("211", 1.170)],
    "Nb": [("110", 2.334), ("200", 1.650), ("211", 1.347)],
    "V": [("110", 2.141), ("200", 1.514), ("211", 1.236)],
    "Si": [("111", 3.1355), ("220", 1.9201), ("311", 1.6375)],
    "Zn": [("002", 2.473), ("100", 2.308), ("101", 2.091)],
    "Ti": [("100", 2.555), ("002", 2.341), ("101", 2.243)],
    "In": [("101", 2.715), ("002", 2.471), ("110", 2.298)],
    "Sn": [("200", 2.915), ("101", 2.793), ("220", 2.062), ("211", 2.017)],
    "Bi": [("012", 3.280), ("104", 2.370), ("110", 2.273)],
    "Sb": [("012", 3.109), ("104", 2.248), ("110", 2.152)],
    "Te": [("101", 3.230), ("012", 2.351), ("110", 2.228)],
    "graphite": [("002", 3.355)],
    "quartz": [("100", 4.257), ("011", 3.343), ("110", 2.457), ("112", 1.818)],
    "Al2O3": [("012", 3.479), ("104", 2.552), ("110", 2.379), ("113", 2.085), ("116", 1.601)],
    "ice-Ih": [("100", 3.90), ("002", 3.67), ("101", 3.44)],
}

# The strongest line at low angles (d ≥ 1.2 Å) of the reference patterns.
CITED_STRONGEST = {
    "Al": "111", "Cu": "111", "Pb": "111", "steel": "111", "W": "110", "Fe": "110", "V": "110",
    "Nb": "110", "Zn": "101", "Ti": "101", "In": "101", "Sn": "200", "Bi": "012", "Sb": "012",
    "Te": "101", "graphite": "002", "quartz": "011",
}


@pytest.fixture(scope="module")
def lib():
    return pp.load_library()


def test_the_library_has_the_agreed_phases(lib):
    ids = {p.id for p in lib.phases}
    assert {"Bi", "Sn", "Ga", "In", "Pb", "Sb", "Te", "Zn"} <= ids                     # flux
    assert {"Al", "Cu", "V", "Ti", "Nb", "Fe", "steel", "W"} <= ids                    # environment
    assert {"ice-Ih", "ice-Ic", "graphite", "Si", "quartz", "Al2O3"} <= ids            # others
    for p in lib.phases:
        assert p.source, p.id
        assert p.space_group, p.id
        assert p.group in ("flux", "sample environment", "other"), p.id
    assert lib.version and "Sears" in lib.scattering_lengths_source


@pytest.mark.parametrize("pid", sorted(CITED_D))
def test_d_spacings_match_the_reference_patterns(lib, pid):
    lines = lib.get(pid).lines(2.0 * math.pi / 1.0)
    tol = 0.02 if pid == "ice-Ih" else 0.006
    for hkl, d in CITED_D[pid]:
        near = min(lines, key=lambda ln: abs(ln.d - d))
        assert abs(near.d - d) <= tol, (pid, hkl, d, near)
        assert near.hkl == hkl, (pid, hkl, near.hkl)


@pytest.mark.parametrize("pid", sorted(CITED_STRONGEST))
def test_the_strongest_low_angle_line_is_the_reference_patterns(lib, pid):
    lines = [ln for ln in lib.get(pid).lines(2.0 * math.pi / 1.2)]
    assert max(lines, key=lambda ln: ln.intensity).hkl == CITED_STRONGEST[pid]


def _allowed(lib, pid, q_max=9.0):
    return {ln.hkl for ln in lib.get(pid).lines(q_max)}


def test_the_extinctions_follow_from_the_atoms(lib):
    # F lattice: h, k, l all odd or all even.
    assert {"111", "200", "220", "311"} <= _allowed(lib, "Cu")
    assert not {"100", "110", "210", "211"} & _allowed(lib, "Cu")
    # I lattice: h + k + l even.
    assert {"110", "200", "211"} <= _allowed(lib, "W")
    assert not {"100", "111", "210"} & _allowed(lib, "W")
    # Diamond (Fd-3m): 200 and 222 absent, besides the F condition.
    assert {"111", "220", "311", "400"} <= _allowed(lib, "Si")
    assert not {"200", "222", "420"} & _allowed(lib, "Si")
    # hcp (P6_3/mmc, 2c): 001 and 003 absent, and h - k = 3n with l odd.
    assert {"100", "002", "101", "102"} <= _allowed(lib, "Zn")
    assert not {"001", "003", "111"} & _allowed(lib, "Zn")
    # R-3m on hexagonal axes, obverse: -h + k + l = 3n.
    bi = _allowed(lib, "Bi")
    assert {"003", "012", "104", "110", "015", "006", "202", "024"} <= bi
    assert not {"100", "001", "002", "011", "102", "111"} & bi
    # I4_1/amd (white tin): 00l with l = 4n; hk0 with h, k even.
    assert {"200", "101", "220", "211"} <= _allowed(lib, "Sn")
    assert not {"002", "110", "100"} & _allowed(lib, "Sn")
    # Cmce (gallium): h + k even; 0kl k even; h0l h and l even.
    ga = _allowed(lib, "Ga")
    assert {"020", "111", "021", "002", "200"} <= ga
    assert not {"100", "010", "001", "011", "101", "110", "012"} & ga


def test_vanadium_barely_scatters_neutrons(lib):
    al, v = lib.get("Al"), lib.get("V")
    # Its coherent scattering power per volume is about 1/70 of aluminium's
    # (b = -0.38 against 3.45 fm), and so is its strongest line's.
    assert 0.010 < v.scattering_power() / al.scattering_power() < 0.020
    i_v = max(ln.intensity for ln in v.lines(6.0))
    i_al = max(ln.intensity for ln in al.lines(6.0))
    assert i_v / i_al < 0.03


def test_the_cells_hold_their_formula_units(lib):
    def count(pid, el):
        return sum(a[4] for a in lib.get(pid).atoms if a[0] == el)
    assert count("Bi", "Bi") == pytest.approx(6)
    assert count("Al2O3", "Al") == pytest.approx(12) and count("Al2O3", "O") == pytest.approx(18)
    assert count("quartz", "Si") == pytest.approx(3) and count("quartz", "O") == pytest.approx(6)
    assert count("ice-Ih", "O") == pytest.approx(4) and count("ice-Ih", "H") == pytest.approx(8)
    assert count("ice-Ic", "O") == pytest.approx(8) and count("ice-Ic", "H") == pytest.approx(16)
    assert count("Ga", "Ga") == pytest.approx(8)
    assert count("Si", "Si") == pytest.approx(8)


def test_a_custom_phase_file_adds_and_replaces(tmp_path, monkeypatch):
    extra = tmp_path / "mine.json"
    extra.write_text(json.dumps({
        "schema_version": 1,
        "scattering_lengths": {"b_coh": {"Ag": 5.922}},
        "phases": [
            {"id": "Ag", "name": "silver", "group": "sample environment", "space_group": "Fm-3m",
             "cell": {"a": 4.0862}, "source": "my holder", "centering": "F",
             "sites": [{"el": "Ag", "xyz": [0, 0, 0]}]},
            {"id": "Cu", "name": "copper, my value", "space_group": "Fm-3m", "cell": {"a": 3.6},
             "centering": "F", "sites": [{"el": "Cu", "xyz": [0, 0, 0]}]},
        ]}))
    lib = pp.load_library(extra=[extra])
    assert lib.get("Ag").lines(3.0)[0].hkl == "111"
    assert lib.get("Cu").cell[0] == pytest.approx(3.6)
    assert len(lib.phases) == len(pp.load_library().phases) + 1
    monkeypatch.setenv(pp.LIBRARY_ENV, str(extra))
    assert pp.load_library().get("Ag").name == "silver"


@pytest.mark.parametrize("entry, why", [
    ({"id": "x", "cell": {"a": 4.0}, "sites": [{"el": "Xx", "xyz": [0, 0, 0]}]},
     "scattering length"),
    ({"id": "x", "sites": [{"el": "Al", "xyz": [0, 0, 0]}]}, "cell"),
    ({"id": "x", "cell": {"a": 4.0}, "sites": []}, "sites"),
    ({"id": "x", "cell": {"a": 4.0}, "centering": "Q", "sites": [{"el": "Al", "xyz": [0, 0, 0]}]},
     "centering"),
    ({"id": "x", "cell": {"a": 4.0}, "ops": ["x,y"], "sites": [{"el": "Al", "xyz": [0, 0, 0]}]},
     "three parts"),
])
def test_a_bad_entry_is_refused(tmp_path, entry, why):
    bad = tmp_path / "bad.json"
    bad.write_text(json.dumps({"schema_version": 1, "phases": [entry]}))
    with pytest.raises(ValueError, match=why):
        pp.load_library(extra=[bad])


def test_another_schema_version_is_refused(tmp_path):
    bad = tmp_path / "v2.json"
    bad.write_text(json.dumps({"schema_version": 2, "phases": []}))
    with pytest.raises(ValueError, match="schema_version"):
        pp.load_library(extra=[bad])


@pytest.mark.parametrize("op, r, expected", [
    ("x,y,z", (0.1, 0.2, 0.3), (0.1, 0.2, 0.3)),
    ("-y,x-y,z+1/3", (0.1, 0.2, 0.3), (-0.2, -0.1, 0.3 + 1 / 3)),
    ("1/2+x,1/2-y,-z", (0.1, 0.2, 0.3), (0.6, 0.3, -0.3)),
    ("-x+y,-x,z+2/3", (0.1, 0.2, 0.3), (0.1, -0.1, 0.3 + 2 / 3)),
])
def test_symmetry_operations_are_read(op, r, expected):
    rot, tr = pp._parse_op(op)
    assert np.allclose(rot @ np.array(r) + tr, expected)


@pytest.mark.parametrize("name, elements", [
    ("Fe3Ge2_90K_all_hex.nxs", {"Fe", "Ge"}),
    ("CsV3Sb5_10K_(0,k,l)_mmm_cc.nxs", {"Cs", "V", "Sb"}),
    ("NdBi_test.nxs", {"Nd", "Bi"}),
    ("CORELLI_run123_sub_bkg.nxs", set()),
    ("TOPAZ_Al_can.nxs", set()),
    ("v3a9f1c_dev_control.nxs", set()),
])
def test_the_composition_a_name_holds(name, elements):
    assert pp.elements_in_name(name) == elements


@pytest.mark.parametrize("name, t", [
    ("Fe3Ge2_90K_all_hex.nxs", 90.0), ("x_1.5K_y.nxs", 1.5), ("x_(0,k,l)_[h,0,0].nxs", None),
    ("a_10K_b_20K.nxs", None), ("Kapton_scan.nxs", None),
])
def test_the_temperature_a_name_holds(name, t):
    assert pp.temperature_in_name(name) == t


def test_the_scale_stays_on_its_side_of_room_temperature():
    assert pp._scale_window(0.015, None) == (-0.015, 0.015)
    assert pp._scale_window(0.015, 20.0) == (-0.015, pp.SCALE_MARGIN)
    assert pp._scale_window(0.015, 600.0) == (-pp.SCALE_MARGIN, 0.015)
    assert pp._scale_window(0.015, 295.0) == (-0.015, 0.015)


# ---------------------------------------------------------------- the matcher on a profile

STEP = 0.02


def _profile(lines, *, noise=0.002, seed=0, q_max=8.0, width=0.08):
    """An excess profile with Gaussian lines ((|Q|, height)) and white noise."""
    q = np.arange(1.5, q_max, STEP) + 0.5 * STEP
    e = np.zeros_like(q)
    for q0, h in lines:
        e += h * np.exp(-4.0 * np.log(2.0) * ((q - q0) / width) ** 2)
    e += np.random.default_rng(seed).normal(0.0, noise, q.size)
    return q, e


def _phase_lines(pid, scale, amount, q_max=8.0, width=0.08):
    phase = pp.load_library().get(pid)
    return [(ln.q / (1.0 + scale), amount * ln.intensity / (pp._GAUSS_AREA * width))
            for ln in phase.lines(q_max + 0.3) if ln.q / (1.0 + scale) < q_max]


def _rings(q, e, noise, cut=6.0):
    from nebula3d.preprocessing.radial_background import _detect_rings
    c, f = _detect_rings(q, e, STEP, 0.24, min_snr=cut, rel_prominence=0.0)
    return [pp.Ring(float(cc), float(ff), float(np.interp(cc, q, e))) for cc, ff in zip(c, f)]


def _match(lines, **kw):
    noise = kw.pop("noise", 0.002)
    q, e = _profile(lines, noise=noise, seed=kw.pop("seed", 0))
    rings = _rings(q, e, noise)
    return pp.match_phases(q, e, np.ones(q.size, bool), noise, rings, width=0.08, **kw)


def test_bi_lines_on_a_profile_name_bi_with_its_scale():
    rec = _match(_phase_lines("Bi", -0.004, 0.05))
    best = rec["candidates"][0]
    assert best["phase"] == "Bi" and best["status"] == "likely"
    assert best["scale"] == pytest.approx(-0.004, abs=0.001)
    assert {ln["hkl"] for ln in best["lines"]} >= {"012", "110", "202", "024"}
    assert best["unmatched"] == [] and not best["missing"]


def test_one_ring_alone_names_no_phase():
    # A single strong ring: any phase can put a line on it with a scale.
    rec = _match([(2.5, 0.2)])
    assert rec["candidates"] == []
    assert rec["unmatched"] == [pytest.approx(2.5, abs=STEP)]


def test_rings_at_random_places_name_no_phase():
    rng = np.random.default_rng(3)
    for trial in range(5):
        places = np.sort(rng.uniform(1.8, 7.5, 5))
        rec = _match([(float(x), 0.05) for x in places], seed=trial)
        assert all(c["status"] != "likely" for c in rec["candidates"]), (places, rec["candidates"])


def test_a_strong_line_missing_counts_against_a_phase():
    # Bi's lines with its strongest one, 012, taken away.
    lines = [x for x in _phase_lines("Bi", -0.004, 0.05) if abs(x[0] - 1.924) > 0.05]
    rec = _match(lines)
    bi = [c for c in rec["candidates"] if c["phase"] == "Bi"]
    assert not bi or bi[0]["status"] != "likely"
    if bi:
        assert "012" in {m["hkl"] for m in bi[0]["missing"]}


def test_a_line_under_an_al_ring_is_hidden_not_missing():
    lines = [x for x in _phase_lines("Bi", -0.004, 0.05) if abs(x[0] - 2.70) > 0.12]
    al111 = pp.Cover(2.70, 0.10, "Al111")
    rec = _match(lines + [(2.70, 0.5)], covers=[al111])
    best = rec["candidates"][0]
    assert best["phase"] == "Bi"
    hidden = {h["hkl"] for h in best["hidden"]}
    assert {"104", "110"} <= hidden
    assert not {"104", "110"} & {m["hkl"] for m in best["missing"]}


def test_the_temperature_keeps_a_contracted_lattice():
    # Cu at -0.3 %: steel (fcc, a 0.7 % smaller) would need it expanded,
    # which a cold sample cannot be.
    rec = _match(_phase_lines("Cu", -0.003, 0.004), temperature=20.0)
    best = rec["candidates"][0]
    assert best["phase"] == "Cu" and best["status"] == "likely"
    steel = [c for c in rec["candidates"] if c["phase"] == "steel"]
    assert not steel or steel[0].get("at_limit") and steel[0]["status"] == "possible"


def test_the_composition_orders_flux_candidates_of_one_status():
    rec = {"candidates": [
        {"phase": "Te", "group": "flux", "elements": ["Te"], "status": "possible", "score": 2.0,
         "unmatched": []},
        {"phase": "Bi", "group": "flux", "elements": ["Bi"], "status": "possible", "score": 1.6,
         "unmatched": [2.1]},
        {"phase": "Cu", "group": "sample environment", "elements": ["Cu"], "status": "likely",
         "score": 1.4, "unmatched": []}],
        "rings": []}
    out = pp.rank(json.loads(json.dumps(rec)), {"Tb", "Bi"})
    assert [c["phase"] for c in out["candidates"]] == ["Cu", "Bi", "Te"]
    assert out["candidates"][1]["in_composition"] is True
    # Without the composition the two flux phases are too close to tell apart.
    out = pp.rank(json.loads(json.dumps(rec)))
    assert [c["phase"] for c in out["candidates"]] == ["Cu", "Te", "Bi"]
    rec["candidates"][2]["status"] = "possible"
    out = pp.rank(json.loads(json.dumps(rec)))
    assert out["candidates"][0]["phase"] == "Te" and out["candidates"][0]["or"] == "Bi"
    assert pp.summary(out).startswith("possibly Te or Bi:")


def test_x_rays_match_positions_alone():
    rec = _match(_phase_lines("Bi", -0.004, 0.05), radiation="xray")
    assert rec["intensities"] is False
    assert rec["candidates"] and rec["candidates"][0]["phase"] in ("Bi", "Te", "Sb")
    assert all(not c["missing"] and not c["hidden"] for c in rec["candidates"])


def test_vanadium_rings_as_strong_as_the_al_would_need_too_much_of_it():
    al_ref = pp.AlReference(k=1.0, b=0.0, rings=5)
    # V's lines at about the height Al's would have: 70 times its volume.
    rec = _match(_phase_lines("V", -0.002, 70.0), al=al_ref, exclude=["Al"])
    v = [c for c in rec["candidates"] if c["phase"] == "V"]
    assert v and v[0]["status"] == "possible" and v[0]["amount_vs_al"] > pp.MAX_AMOUNT_VS_AL
    assert "× the Al's volume" in pp.summary({"candidates": v, "rings": []})


def test_the_summary_names_lines_hidden_and_unmatched():
    # As a synthetic Al + Sn volume's record gives it.
    rec = {"candidates": [{
        "phase": "Sn", "group": "flux", "status": "possible", "scale": -0.0017, "matched": 2,
        "of": 2, "lines": [{"hkl": "200", "q": 2.2203, "ring": 2.2224},
                           {"hkl": "420", "q": 4.8412, "ring": 4.8439}],
        "hidden": [{"hkl": "211", "q": 3.12, "under": "Al200"}], "missing": [],
        "unmatched": [], "amount_vs_al": 0.12}], "rings": []}
    assert pp.summary(rec) == ("possibly Sn flux: 2 of 2 rings matched, scale -0.2 %; "
                               "lines 200 2.22, 420 4.84; hidden 211 under Al200; "
                               "unmatched none")
    assert pp.summary({"candidates": [], "rings": []}) is None


def test_a_cited_halo_is_found_in_the_broad_excess(tmp_path):
    entry = tmp_path / "halo.json"
    entry.write_text(json.dumps({"schema_version": 1, "phases": [], "broad": [
        {"id": "film", "name": "test film", "halos": [{"q": 2.6, "fwhm": 0.6}],
         "source": "a synthetic halo for this test"}]}))
    lib = pp.load_library(extra=[entry])
    q = np.arange(1.5, 6.0, STEP)
    base = 1.0 + 0.1 * (q - 1.5)
    noise = np.random.default_rng(0).normal(0.0, 0.003, q.size)
    halo = 0.05 * np.exp(-4.0 * np.log(2.0) * ((q - 2.65) / 0.6) ** 2)
    found = pp.match_broad(q, base + halo + noise, np.ones(q.size, bool), library=lib)
    assert [f["id"] for f in found] == ["film"]
    assert found[0]["halos"][0]["q"] == pytest.approx(2.65, abs=0.05)
    assert pp.match_broad(q, base + noise, np.ones(q.size, bool), library=lib) == []
    rec = {"candidates": [], "rings": [], "broad": found}
    assert pp.summary(rec).startswith("possibly a test film halo at 2.6")


def test_a_halo_needs_a_cited_source(tmp_path):
    entry = tmp_path / "halo.json"
    entry.write_text(json.dumps({"schema_version": 1, "phases": [], "broad": [
        {"id": "film", "halos": [{"q": 2.6, "fwhm": 0.6}]}]}))
    with pytest.raises(ValueError, match="source"):
        pp.load_library(extra=[entry])


def test_no_halo_is_shipped_without_a_source(lib):
    # Kapton and GE varnish wait for a cited halo position (the library's notes).
    assert lib.broad == ()


def test_the_summary_names_four_of_each_and_counts_the_rest():
    lines = [{"hkl": f"{i}00", "q": 2.0 + i, "ring": 2.0 + i} for i in range(1, 7)]
    rec = {"candidates": [{"phase": "Sn", "group": "flux", "status": "likely", "scale": -0.003,
                           "matched": 6, "of": 9, "lines": lines, "hidden": [], "missing": [],
                           "unmatched": [1.6, 1.7, 1.8, 1.9, 2.05]}], "rings": []}
    line = pp.summary(rec)
    assert "lines 100 3.00, 200 4.00, 300 5.00, 400 6.00, +2 more" in line
    assert "unmatched 1.60, 1.70, 1.80, 1.90, +1 more" in line
