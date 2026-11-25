"""Guard for the numpy calls that fail only in the browser's 32-bit (wasm32) build.

The browser runs the package in Pyodide 0.27.7 (numpy 2.0.2, wasm32), where
``intp`` is int32 and numpy's default integer is int32 too. CI runs the tests on
64-bit CPython, so these traps pass there and fail only in the browser
(#119: ``bincount`` with int64 indices; #128: a three-operand ``einsum``).

THY-51 checked each pattern in real Pyodide 0.27.7 under Node
(``scripts/wasm32/``, docs/development.md "The 32-bit check"):

* ``np.bincount``, ``np.take``, ``np.repeat``, ``np.put``, ``np.choose`` and
  ``ufunc.reduceat`` cast their index (or count) argument to ``intp`` by the
  "safe" rule, so an int64 or uint32 array (or a 0-d int64 array) raises
  ``TypeError: Cannot cast array data from dtype('int64') to dtype('int32')``.
  Python ints, numpy integer *scalars*, int32, int16, int8, uint16, uint8 and
  bool pass. Fancy indexing, ``unravel_index``, ``ravel_multi_index``,
  ``searchsorted``, ``partition``/``argpartition``, ``add.at``, ``histogram``,
  ``split``, ``insert``, ``delete``, ``roll``, ``tile`` and ``reshape`` accept
  int64 there.
* An iterator over more than 2³¹ − 1 elements raises ``ValueError: iterator is
  too large``. Only a call whose iteration space is larger than every operand
  it allocates can reach that inside a 4 GiB heap: an ``einsum`` with a
  contracted or outer index across three or more operands, or a reduction over
  a ``broadcast_to`` view. A two-operand elementwise ``einsum`` iterates over
  no more elements than its operands hold, so the heap runs out first.

This test lists every such call in the package by its file, enclosing function
and argument text, and compares the list with the reviewed entries below. A new
call, or a changed argument, fails until someone checks it is 32-bit safe and
adds it here with the reason.
"""

from __future__ import annotations

import ast
from pathlib import Path

SRC = Path(__file__).resolve().parents[1] / "src" / "nebula3d"

#: numpy functions that cast an index/count argument to intp by the "safe" rule
#: on wasm32, and the position of that argument.
INDEX_CAST = {"take": 1, "repeat": 1, "put": 1, "choose": 0}

#: (file, enclosing function, function, index argument) → why it is 32-bit safe.
#: Every ``np.bincount`` goes through ``nebula3d.utils.counting.bincount``
#: (tests/test_counting.py), which casts to intp after a range check.
INDEX_CAST_REVIEWED: dict[tuple[str, str, str, str], str] = {
    ("_ringplane.py", "_take_plane", "take", "index"): "a plane number, a Python int",
    ("visualization/interactive.py", "_take_plane", "take", "idx"): "int(argmin)",
    ("visualization/slices.py", "extract_slice.plane_at", "take", "i"):
        "a plane number, a Python int",
    ("visualization/slices.py", "extract_slice_dpdf.<lambda>", "take", "i"):
        "a plane number from _interp_plane, a Python int",
    ("visualization/slices.py", "extract_slice_dpdf", "take", "idx"): "int(argmin)",
    ("analysis/bragg_fill.py", "_open_unmeasured", "take", "end"):
        "0 or shape − 1, a Python int",
    ("analysis/bragg_sense.py", "_mirrors", "take", "idx[keep]"):
        "np.array of Python ints (numpy's default int, intp) indexed by np.nonzero",
    ("analysis/bragg_sense.py", "_mirrors", "take", "keep"): "np.nonzero: intp",
    ("analysis/ub_refine.py", "_solve", "repeat", "3"): "a literal",
    ("server/modulation.py", "labels_envelope", "take", "0"): "a literal",
    ("preprocessing/ring_survey.py", "survey_rings.plane_profile", "take", "i"):
        "a plane number, a Python int",
    ("preprocessing/radial_background.py", "confirm_ring_shells_across_h", "take", "ip"):
        "range(), a Python int",
    ("preprocessing/radial_background.py", "_stack_plane_q_magnitude", "take", "0"):
        "a literal",
    ("preprocessing/pooled_rings.py", "fit_pooled_rings", "take", "i"):
        "a plane number, a Python int",
    ("preprocessing/pooled_rings.py", "_plane_inputs", "take", "0"): "a literal",
    ("preprocessing/pooled_rings.py", "_plane_inputs", "take", "index"):
        "a plane number, a Python int",
    ("preprocessing/pooled_rings.py", "_sampling_keep", "take", "0"): "a literal",
}

#: (file, enclosing function, subscripts) → why the einsum's iteration space
#: stays under 2³¹ (it has three or more operands, or contracts an index).
EINSUM_REVIEWED: dict[tuple[str, str, str], str] = {
    ("analysis/bragg_sense.py", "_inside", "'...i,ij,...j->...'"):
        "offsets in one 2-D window, (..., 2): 4 iterations per offset",
    ("analysis/misorientation.py", "fit_rotation.solve", "'i,ij,ik->jk'"):
        "the fitted Bragg peaks, (n, 3): 9 n iterations",
    ("analysis/delta_pdf.py", "_lattice_point_group", "'nji,jk,nkl->nil'"):
        "the unimodular candidates (under 3⁹) × 3⁴: under 1.6 M",
    ("analysis/delta_pdf.py", "_invariant_ellipsoid", "'nij,nik->ijk'"):
        "the point group's operators: at most 48 × 3³",
    ("analysis/delta_pdf.py", "_invariant_ellipsoid", "'ijk,jk->i'"): "3 × 3 × 3",
    ("analysis/delta_pdf.py", "_fit_to_support", "'ni,ij,nj->n'"): "the box's 8 corners",
}

#: Two-operand elementwise einsums ("ij,ij->i"): they iterate over exactly the
#: elements of their operands, so a 4 GiB heap runs out before 2³¹.
_ELEMENTWISE = {"'nm,nm->n'", "'ij,ij->i'"}


def _calls() -> list[tuple[str, str, ast.Call]]:
    """(file, enclosing qualname, call) for every call in the package."""
    found: list[tuple[str, str, ast.Call]] = []
    for path in sorted(SRC.rglob("*.py")):
        rel = path.relative_to(SRC).as_posix()
        tree = ast.parse(path.read_text(), filename=rel)

        def walk(node: ast.AST, scope: list[str], rel: str = rel) -> None:
            for child in ast.iter_child_nodes(node):
                if isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef)):
                    walk(child, [*scope, child.name])
                elif isinstance(child, ast.ClassDef):  # methods go by their own name
                    walk(child, scope)
                elif isinstance(child, ast.Lambda):
                    walk(child, [*scope, "<lambda>"])
                else:
                    if isinstance(child, ast.Call):
                        found.append((rel, ".".join(scope), child))
                    walk(child, scope)

        walk(tree, [])
    return found


def _np_func(call: ast.Call) -> str | None:
    f = call.func
    if isinstance(f, ast.Attribute) and isinstance(f.value, ast.Name) and f.value.id == "np":
        return f.attr
    return None


def test_every_intp_cast_index_is_reviewed_for_wasm32():
    seen: dict[tuple[str, str, str, str], int] = {}
    for rel, scope, call in _calls():
        name = _np_func(call)
        if name in INDEX_CAST and len(call.args) > INDEX_CAST[name]:
            key = (rel, scope, name, ast.unparse(call.args[INDEX_CAST[name]]))
            seen[key] = call.lineno
    new = {f"{k} (line {n})" for k, n in seen.items() if k not in INDEX_CAST_REVIEWED}
    gone = set(INDEX_CAST_REVIEWED) - set(seen)
    assert not new, (
        "check that each index is a Python int, a numpy scalar or an int32-or-narrower "
        f"array (int64 and uint32 arrays raise on wasm32), then list it: {sorted(new)}")
    assert not gone, f"reviewed calls no longer in the package; drop them: {sorted(gone)}"


def test_no_ufunc_reduceat_or_array_index_methods():
    """``ufunc.reduceat`` and the ``ndarray.take``/``repeat``/``choose`` methods
    cast like the functions above; the package uses none, so none are listed."""
    offenders = [
        f"{rel}:{call.lineno} .{call.func.attr}"
        for rel, _, call in _calls()
        if isinstance(call.func, ast.Attribute)
        and call.func.attr in {"reduceat", "take", "repeat", "choose"}
        and _np_func(call) is None
    ]
    assert not offenders, f"review for wasm32 and add a reviewed list: {offenders}"


def test_every_contracting_einsum_is_reviewed_for_wasm32():
    seen: dict[tuple[str, str, str], int] = {}
    for rel, scope, call in _calls():
        if _np_func(call) != "einsum" or not call.args:
            continue
        subs = ast.unparse(call.args[0])
        if subs in _ELEMENTWISE and len(call.args) == 3:
            continue
        seen[(rel, scope, subs)] = call.lineno
    new = {f"{k} (line {n})" for k, n in seen.items() if k not in EINSUM_REVIEWED}
    gone = set(EINSUM_REVIEWED) - set(seen)
    assert not new, (
        "an einsum over three or more operands can iterate past 2³¹ on wasm32 "
        "('iterator is too large'); bound its sizes (or chunk it, as "
        f"global_rings._row_quadratic_form does), then list it: {sorted(new)}")
    assert not gone, f"reviewed einsums no longer in the package; drop them: {sorted(gone)}"
