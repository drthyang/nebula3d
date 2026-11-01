# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Tsung-han Yang

"""The CPython adapter at the Worker seam: nebula3d.webbridge over stdio.

In the browser the engine (web/src/api/pyodideEngine.ts) posts its requests to
the pipeline worker (web/src/workers/pyodideWorker.ts), which runs
:mod:`nebula3d.webbridge` in Pyodide. That is one adapter at the seam. This is
the second: the replay tests' Worker (bridgeWorker.ts) sends the same messages
here as frames over stdin, and this process answers them from the same
webbridge, natively, as frames over stdout. Only the transport differs, so the
engine, the stores and the Pilot's tools above the seam run as the Pages build
runs them.

A frame is ``[uint32 LE header length][uint32 LE body length][header][body]``:
the header is UTF-8 JSON, the message; the body is raw bytes, empty unless the
message carries a binary payload (a ``load_file`` volume, a ``result_binary``
envelope). The messages:

- the Worker's own (WORKER_TYPES), answered as the pipeline worker answers
  them: ``{id, type: "result", payload}``, ``{id, type: "result_binary"}`` with
  the bytes as the body, or ``{id, type: "error", message}`` (the size gate's
  refusal adds ``code: "size_gate"`` and its ``report``); and, with ``id:
  null``, the events ``boot_status``, ``progress`` and ``gpu_status``;
- this adapter's own (CONTROL_TYPES): ``dev_case`` gives a dev case of the
  validation a fresh workspace, from its default run's snapshot when this
  process's root holds one; ``dev_snapshot`` keeps the workspace's outputs as
  that snapshot; ``terminate`` answers, then ends the process. With
  ``symmetrise: {label, ops}`` (operations on (h, k, l), as the NeXus Viewer
  writes them), ``dev_case`` gives the case's volume symmetrised over the group
  the operations generate and declared so, as that export is: no dev case is
  symmetrised, and the symmetry check judges only data that are.

Only the validation's dev split is built: a case id outside it is refused before
anything is built (the third of the interface's three checks; devData/index.ts
holds the other two). ``python bridge.py check`` reports the interpreter, its
numeric stack and where it imports nebula3d from; with ``--pins`` it also fails
when that stack differs from a constraints file's pins (the browser's).
"""

from __future__ import annotations

import argparse
import asyncio
import json
import math
import os
import re
import shutil
import struct
import sys
import tempfile
import time
import traceback
from collections.abc import Callable
from pathlib import Path
from typing import TYPE_CHECKING, Any, BinaryIO

if TYPE_CHECKING:
    from nebula3d.core import HKLVolume
    from nebula3d.symmetry import GridSymmetry
    from nebula3d.validation import Case

#: The pipeline worker's messages (pyodideWorker.ts, WorkerRequest): the TS type
#: test pins bridgeWorker.ts to that union, tests/test_webbridge.py this file.
WORKER_TYPES = ("boot", "load_file", "load_demo", "run_pipeline", "json_call", "slice_call")
#: This adapter's own messages.
CONTROL_TYPES = ("dev_case", "dev_snapshot", "terminate")
#: The pipeline's stages in canonical order, as the pipeline worker orders a run's
#: (nebula3d.pipeline.STAGES; the symmetry average, stage 0, first).
STAGES = ("symmetry_average", "rings", "punch", "backfill", "flatten", "pdf", "pdf_check")
#: The demo grid the pipeline worker loads (161³ over ±4 r.l.u.).
DEMO_N = 161

_LENGTHS = struct.Struct("<II")


# ---------------------------------------------------------------------------
# Frames
# ---------------------------------------------------------------------------
def _finite(obj: object) -> object:
    """Non-finite floats as null, so the header is JSON that JSON.parse reads."""
    if isinstance(obj, float):
        return obj if math.isfinite(obj) else None
    if isinstance(obj, dict):
        return {k: _finite(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_finite(v) for v in obj]
    return obj


def _read_exact(stream: BinaryIO, n: int, *, inside: bool) -> bytes | None:
    """*n* bytes; at the end of the stream None between frames, an error *inside* one."""
    buf = bytearray()
    while len(buf) < n:
        chunk = stream.read(n - len(buf))
        if not chunk:
            if buf or inside:
                raise EOFError(f"the stream ended {n - len(buf)} bytes before a frame's end")
            return None
        buf += chunk
    return bytes(buf)


def read_frame(stream: BinaryIO) -> tuple[dict[str, Any], bytes] | None:
    """The next frame's header and body, or None at the end of the stream."""
    lengths = _read_exact(stream, _LENGTHS.size, inside=False)
    if lengths is None:
        return None
    header_len, body_len = _LENGTHS.unpack(lengths)
    header = _read_exact(stream, header_len, inside=True) or b""
    body = (_read_exact(stream, body_len, inside=True) or b"") if body_len else b""
    return json.loads(header.decode("utf-8")), body


def write_frame(stream: BinaryIO, header: dict[str, Any], body: bytes = b"") -> None:
    data = json.dumps(_finite(header), separators=(",", ":"), allow_nan=False).encode("utf-8")
    stream.write(_LENGTHS.pack(len(data), len(body)))
    stream.write(data)
    if body:
        stream.write(body)
    stream.flush()


# ---------------------------------------------------------------------------
# The server
# ---------------------------------------------------------------------------
class Bridge:
    """One webbridge session behind the Worker messages, in a root folder of its own.

    The root holds the workspaces (one per boot and per dev case, the superseded
    one removed) and the dev cases' snapshots, each under the case's opaque
    dataset stem: no path a tool can show names a case.
    """

    def __init__(self, root: Path, out: BinaryIO) -> None:
        from nebula3d import webbridge

        self.wb = webbridge
        self.root = root
        self.out = out
        self.mobile = False
        self.workdir: Path | None = None

    # -- replies --------------------------------------------------------
    def emit(self, header: dict[str, Any], body: bytes = b"") -> None:
        write_frame(self.out, header, body)

    def result(self, rid: object, payload: object) -> None:
        self.emit({"id": rid, "type": "result", "payload": payload})

    # -- the loop ---------------------------------------------------------
    def serve(self, inp: BinaryIO) -> int:
        while True:
            frame = read_frame(inp)
            if frame is None:
                return 0
            header, body = frame
            rid = header.get("id")
            kind = header.get("type")
            try:
                if kind == "terminate":
                    self.result(rid, True)
                    return 0
                handler = self._handlers().get(str(kind))
                if handler is None:
                    raise ValueError(f"the bridge has no message {kind!r}")
                handler(rid, header, body)
            except Exception:  # noqa: BLE001 - every failure goes back as the reply
                # As Pyodide words a Python exception: the formatted traceback.
                message = traceback.format_exc()
                print(message, file=sys.stderr)
                self.emit({"id": rid, "type": "error", "message": message.strip()})

    def _handlers(self) -> dict[str, Callable[[object, dict[str, Any], bytes], None]]:
        return {
            "boot": self.boot,
            "load_file": self.load_file,
            "load_demo": self.load_demo,
            "run_pipeline": self.run_pipeline,
            "json_call": self.json_call,
            "slice_call": self.slice_call,
            "dev_case": self.dev_case,
            "dev_snapshot": self.dev_snapshot,
        }

    def _new_workspace(self) -> Path:
        work = Path(tempfile.mkdtemp(dir=self.root, prefix="work-"))
        (work / "raw").mkdir()
        (work / "processed").mkdir()
        return work

    def _switch_to(self, work: Path) -> None:
        """Point the session at *work*; the workspace it leaves is removed."""
        self.wb.setup(str(work), self.mobile)
        old, self.workdir = self.workdir, work
        if old is not None and old != work:
            shutil.rmtree(old, ignore_errors=True)

    # -- the Worker's messages ------------------------------------------------
    def boot(self, rid: object, req: dict[str, Any], _body: bytes) -> None:
        import nebula3d

        self.mobile = bool(req.get("mobile", False))
        self._switch_to(self._new_workspace())
        self.emit({"id": None, "type": "boot_status", "phase": "ready", "ready": True,
                   "message": "Ready: the pipeline runs natively (the CPython bridge)."})
        # The pipeline worker answers with the wheel it installed; the ring
        # workers would install the same one. Here there is no wheel.
        self.result(rid, f"native:nebula3d-{nebula3d.__version__}")
        # No WebGPU: the ΔPDF runs on the CPU FFT, as in a browser without it.
        self.emit({"id": None, "type": "gpu_status", "available": False, "adapter": "",
                   "maxBufferMB": 0})

    def load_file(self, rid: object, req: dict[str, Any], body: bytes) -> None:
        uploads = self.root / "uploads"
        uploads.mkdir(exist_ok=True)
        tmp = uploads / str(time.time_ns())
        tmp.write_bytes(body)
        try:
            # The size gate's refusal is the reply's message, with its report, as
            # the worker sends it.
            report = json.loads(self.wb.inspect_input(req["name"], str(tmp)))
            if not report["ok"]:
                self.emit({"id": rid, "type": "error", "message": report["message"],
                           "code": "size_gate", "report": report})
                return
            self.result(rid, self.wb.load_input(req["name"], str(tmp)))
        finally:
            tmp.unlink(missing_ok=True)

    def load_demo(self, rid: object, req: dict[str, Any], _body: bytes) -> None:
        # ``n`` is not a Worker field: the Python test asks for a coarse demo.
        self.result(rid, self.wb.make_demo_input(int(req.get("n", DEMO_N))))

    def run_pipeline(self, rid: object, req: dict[str, Any], _body: bytes) -> None:
        selected = req.get("stages") or STAGES
        stages_csv = ",".join(s for s in STAGES if s in selected)

        def progress(stage: str, status: str, fraction: float | None, message: str) -> None:
            self.emit({"id": None, "type": "progress", "stage": stage, "status": status,
                       "fraction": fraction, "message": message})

        out = asyncio.run(self.wb.run_async(
            stages_csv, req["paramsJson"], bool(req["flattenEnabled"]), bool(req["force"]),
            req.get("forceFrom"), progress, req.get("tuningRun"), req.get("tuningTrial")))
        self.result(rid, out)

    def _method(self, name: object) -> Callable[..., object]:
        fn = getattr(self.wb, str(name), None) if not str(name).startswith("_") else None
        if not callable(fn):
            raise AttributeError(f"nebula3d.webbridge has no method {name!r}")
        return fn

    def json_call(self, rid: object, req: dict[str, Any], _body: bytes) -> None:
        args = list(req.get("args", []))
        stage = req.get("progress")
        if stage:
            # A call that reports its progress, as the pipeline worker passes it:
            # a (fraction, message) callback after the arguments, posted as
            # that stage's progress events.
            def progress(fraction: float | None, message: str) -> None:
                self.emit({"id": None, "type": "progress", "stage": stage, "status": "progress",
                           "fraction": fraction, "message": message})

            args.append(progress)
        self.result(rid, self._method(req["method"])(*args))

    def slice_call(self, rid: object, req: dict[str, Any], _body: bytes) -> None:
        data = self._method(req["method"])(*req.get("args", []))
        if not isinstance(data, (bytes, bytearray)):
            raise TypeError(f"{req['method']} returned {type(data).__name__}, not bytes")
        self.emit({"id": rid, "type": "result_binary"}, bytes(data))

    # -- this adapter's own messages -----------------------------------------
    def _dev_case(self, case_id: str) -> Case:
        """The dev case named *case_id*; any other id is refused before anything is built."""
        from nebula3d.validation import case_named, cases

        if case_id not in {c.id for c in cases("dev")}:
            raise ValueError(
                f"{case_id!r} is not a dev case of the validation: the bridge builds the dev "
                "split only")
        case = case_named(case_id)
        assert case.split == "dev", case_id
        return case

    def _snapshot_dir(self, req: dict[str, Any]) -> tuple[str, Path]:
        from nebula3d.validation.__main__ import dataset_stem

        stem = dataset_stem(str(req["case"]), str(req.get("arm", "B")), int(req.get("run", 1)))
        sym = req.get("symmetrise")
        # A symmetrised volume is a case of its own: its snapshot apart.
        variant = f"-{re.sub(r'[^0-9A-Za-z]+', '', str(sym['label']))}" if sym else ""
        return stem, self.root / "snapshots" / f"{stem}-n{int(req['n'])}{variant}"

    def dev_case(self, rid: object, req: dict[str, Any], _body: bytes) -> None:
        import nebula3d
        from nebula3d.validation import build

        case = self._dev_case(str(req["case"]))
        stem, snap = self._snapshot_dir(req)
        raw = snap / "raw" / f"{stem}.nxs"
        if not raw.exists():
            # Built once per root: the raw volume is kept beside its snapshot.
            raw.parent.mkdir(parents=True, exist_ok=True)
            vol = build(case, int(req["n"])).raw
            sym = req.get("symmetrise")
            group = symmetrised(vol, str(sym["ops"])) if sym else None
            nebula3d.save(vol, raw)
            if sym:
                declare(raw, str(sym["label"]), group)
        work = self._new_workspace()
        shutil.copyfile(raw, work / "raw" / raw.name)
        restored = (snap / "processed").is_dir()
        if restored:
            shutil.copytree(snap / "processed", work / "processed", dirs_exist_ok=True)
        self._switch_to(work)
        listing = json.loads(self.wb.datasets_json())
        (dataset_id,) = [d["id"] for d in listing if d["stem"] == stem]
        if json.loads(self.wb.select_input(dataset_id)) is not True:
            raise RuntimeError(f"{dataset_id} is not in its fresh workspace")
        self.result(rid, {"dataset_id": dataset_id, "restored": restored})

    def dev_snapshot(self, rid: object, req: dict[str, Any], _body: bytes) -> None:
        self._dev_case(str(req["case"]))
        if self.workdir is None:
            raise RuntimeError("no workspace to snapshot")
        _stem, snap = self._snapshot_dir(req)
        shutil.rmtree(snap / "processed", ignore_errors=True)
        shutil.copytree(self.workdir / "processed", snap / "processed")
        self.result(rid, True)


def symmetrised(vol: HKLVolume, ops: str) -> GridSymmetry:
    """*vol* symmetrised in place over the group *ops* generate (triplets on
    (h, k, l)), as the NeXus Viewer's export is: each voxel the mean of its
    equivalents, and unmeasured wherever one of them is. Returns the group on
    the volume's grid (:class:`nebula3d.symmetry.GridSymmetry`)."""
    import numpy as np

    from nebula3d.symmetry import GridSymmetry, parse_symmetry_ops

    group = GridSymmetry.for_volume(vol, parse_symmetry_ops(ops))
    holes = group.orbit_any(~np.isfinite(vol.data))
    vol.data[holes] = np.nan
    group.orbit_mean(vol.data, ~holes)
    return group


def declare(path: Path, label: str, group: GridSymmetry) -> None:
    """Write into the volume file at *path* the declaration the NeXus Viewer's
    export carries: the symmetry's name and every operation of its group (the
    ``symmetry`` and ``symmetry_ops`` attributes, which
    :func:`nebula3d.io.hkl_reader.declared_attrs` reads)."""
    import h5py

    from nebula3d.io.mantid_nxs import NEBULA3D_GROUP
    from nebula3d.symmetry import _triplet

    with h5py.File(path, "r+") as f:
        attrs = f.require_group(f"MDHistoWorkspace/{NEBULA3D_GROUP}").attrs
        attrs["symmetry"] = label
        attrs["symmetry_ops"] = "; ".join(_triplet(m) for m in group.ops)


def serve(root: Path) -> int:
    # Frames own stdout: anything else printed, by Python or by a C library
    # writing to file descriptor 1, goes to stderr instead.
    out = os.fdopen(os.dup(1), "wb")
    os.dup2(2, 1)
    sys.stdout = sys.stderr
    root.mkdir(parents=True, exist_ok=True)
    os.environ.setdefault("MPLCONFIGDIR", str(root / "mpl"))
    print(f"nebula3d dev-data bridge: pid {os.getpid()}, Python {sys.version.split()[0]}, "
          f"root {root}", file=sys.stderr, flush=True)
    return Bridge(root, out).serve(sys.stdin.buffer)


# ---------------------------------------------------------------------------
# The interpreter check
# ---------------------------------------------------------------------------
def read_pins(path: Path) -> tuple[dict[str, str], str | None]:
    """A constraints file's ``name==version`` pins, and the CPython minor its header names."""
    pins: dict[str, str] = {}
    comments: list[str] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if line.lstrip().startswith("#"):
            comments.append(line.lstrip()[1:].strip())
            continue
        spec = line.split("#", 1)[0].strip()
        if spec:
            name, sep, version = spec.partition("==")
            if not sep:
                raise ValueError(f"{path}: {spec!r} is not a name==version pin")
            pins[name.strip().lower()] = version.strip()
    # The header's words run across lines ("Pyodide 0.27.7 = CPython / 3.12.7").
    m = re.search(r"CPython\s+(\d+\.\d+)", " ".join(comments))
    return pins, m.group(1) if m else None


def check(pins_file: Path | None) -> int:
    """Print what the bridge would run on, as JSON; 1 when an import fails or a pin differs."""
    from importlib.metadata import PackageNotFoundError, version

    report: dict[str, Any] = {"python": sys.version.split()[0], "executable": sys.executable}
    try:
        import h5py  # noqa: F401
        import numpy  # noqa: F401
        import scipy  # noqa: F401

        import nebula3d
        import nebula3d.validation  # noqa: F401
        import nebula3d.webbridge  # noqa: F401

        report["nebula3d"] = str(Path(nebula3d.__file__).resolve())
    except Exception as exc:  # noqa: BLE001 - reported, with the fix, by the caller
        report["error"] = f"{type(exc).__name__}: {exc}"
        print(json.dumps(report))
        return 1

    def installed(name: str) -> str | None:
        try:
            return version(name)
        except PackageNotFoundError:
            return None

    report["versions"] = {n: installed(n) for n in ("numpy", "scipy", "h5py", "matplotlib")}
    code = 0
    if pins_file is not None:
        pins, minor = read_pins(pins_file)
        differ = {n: {"pinned": v, "installed": installed(n)}
                  for n, v in pins.items() if installed(n) != v}
        here = ".".join(map(str, sys.version_info[:2]))
        if minor is None:
            differ["python"] = {"pinned": "(the file names no CPython)", "installed": here}
        elif here != minor:
            differ["python"] = {"pinned": minor, "installed": here}
        report["pins"] = {"file": str(pins_file), "python": minor, "packages": pins,
                          "differ": differ}
        code = 1 if differ else 0
    print(json.dumps(report))
    return code


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="bridge.py", description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("serve", help="answer the Worker messages on stdin/stdout")
    s.add_argument("--root", required=True, help="the folder for the workspaces and snapshots")
    c = sub.add_parser("check", help="report the interpreter and its numeric stack, as JSON")
    c.add_argument("--pins", help="fail when the stack differs from this constraints file")
    args = ap.parse_args(argv)
    if args.cmd == "serve":
        return serve(Path(args.root))
    return check(Path(args.pins) if args.pins else None)


if __name__ == "__main__":
    sys.exit(main())
