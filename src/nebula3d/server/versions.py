# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Tsung-han Yang

"""One cached version per file.

The server's caches key what they read from a file by ``(path, mtime, ...)``,
and every request takes the mtime from the file as it is when it asks.  Once
the file has another date (a run rewrote it, a trial was promoted over it, a
set-aside output was put back with its earlier date), no request can form the
old key again: its entry is only memory held until newer loads push it out,
close to a gigabyte for a large volume.

A cache therefore keeps a file's entry only while the file still has the
entry's date, and drops the file's entries of any other date when it stores
one.  "Another date", not "an older date": a restored file is current with an
earlier date than the one cached in between.  Entries of other files, the
order of the entries and the cache's size limit are left alone, and an object
a request already holds stays whole: only the cache's reference goes.
"""

from __future__ import annotations

from collections.abc import MutableMapping
from pathlib import Path
from typing import Any


def is_current(path: Path, mtime: float) -> bool:
    """Whether *path* still has the date *mtime* that a key was formed with
    (false too when the file is gone).  Call it outside the cache's lock."""
    try:
        return path.stat().st_mtime == mtime
    except OSError:
        return False


def drop_other_versions(cache: MutableMapping[Any, Any], key: tuple) -> None:
    """Remove from *cache* every entry of ``key``'s file (``key[0]``) with
    another date (``key[1]``).  Entries of the same file and date under other
    settings stay.  Call it with the cache's lock held."""
    for other in [k for k in cache if k[0] == key[0] and k[1] != key[1]]:
        del cache[other]
