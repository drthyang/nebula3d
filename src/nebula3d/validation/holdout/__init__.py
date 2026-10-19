# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Tsung-han Yang
"""The validation's held-out test split, in :mod:`.heldout_cases`.

Builders and agents must not open, print or read heldout_cases.py. Only the opt-in
loader, :func:`nebula3d.validation.cases._load_test_split`, imports it, and this
package imports nothing."""
