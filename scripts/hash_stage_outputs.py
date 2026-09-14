#!/usr/bin/env python
"""SHA-256 every array of every pipeline stage artifact — the bit-exactness gate.

Walks a processed directory (default ``data/processed``) and, for each pipeline
HDF5 artifact (``*_ringremoved.h5``, ``*_braggpunched.h5``, ``*_backfilled.h5``,
``*_flattened.h5``, ``*_delta_pdf.h5``), hashes the raw bytes of every dataset
(sorted by name, so the digest is deterministic and independent of HDF5 chunking
or compression settings).  Run it before and after a refactor that must be
bit-exact and diff the output:

    python scripts/hash_stage_outputs.py data/processed > /tmp/before.txt
    ...refactor, rerun pipeline...
    python scripts/hash_stage_outputs.py data/processed > /tmp/after.txt
    diff /tmp/before.txt /tmp/after.txt

JSON sidecars (``*_consistency.json``, ``*_profile.json``, ``*_diagnostics.json``)
are hashed byte-for-byte.  Scalar consistency metrics may legitimately move in
the ~13th digit across summation-order changes (see the streaming metrics in
``pipeline._consistency_metrics``); the volume hashes are the hard gate.
"""

from __future__ import annotations

import hashlib
import sys
from pathlib import Path

import h5py
import numpy as np

STAGE_SUFFIXES = (
    "_ringremoved.h5",
    "_braggpunched.h5",
    "_backfilled.h5",
    "_flattened.h5",
    "_delta_pdf.h5",
)
JSON_SUFFIXES = ("_consistency.json", "_profile.json", "_diagnostics.json")


def _hash_h5(path: Path) -> str:
    """Deterministic digest over every dataset's dtype/shape/bytes, sorted by name."""
    digest = hashlib.sha256()
    with h5py.File(path, "r") as fh:
        names: list[str] = []
        fh.visititems(
            lambda name, obj: names.append(name) if isinstance(obj, h5py.Dataset) else None
        )
        for name in sorted(names):
            ds = fh[name]
            arr = np.ascontiguousarray(ds[()])
            digest.update(name.encode())
            digest.update(str(arr.dtype).encode())
            digest.update(str(arr.shape).encode())
            digest.update(arr.tobytes())
    return digest.hexdigest()


def _hash_bytes(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> int:
    proc = Path(sys.argv[1] if len(sys.argv) > 1 else "data/processed")
    if not proc.is_dir():
        print(f"error: {proc} is not a directory", file=sys.stderr)
        return 2
    rows: list[tuple[str, str]] = []
    for path in sorted(proc.rglob("*")):
        if path.name.endswith(STAGE_SUFFIXES):
            rows.append((str(path.relative_to(proc)), _hash_h5(path)))
        elif path.name.endswith(JSON_SUFFIXES):
            rows.append((str(path.relative_to(proc)), _hash_bytes(path)))
    if not rows:
        print(f"error: no stage artifacts under {proc}", file=sys.stderr)
        return 1
    for rel, digest in rows:
        print(f"{digest}  {rel}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
