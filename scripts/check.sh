#!/usr/bin/env bash
# Run the same checks as GitHub CI (.github/workflows/ci.yml) before pushing:
#
#   pytest                                    -> tests
#   ruff  check src/ tests/                   -> lint
#   mypy  src/nebula3d --ignore-missing-imports --python-version 3.12  -> type check
#
# Usage:
#   bash scripts/check.sh
#   PY=/path/to/python bash scripts/check.sh      # choose the interpreter
#
# Install as an automatic pre-push guard (any clone):
#   ln -s ../../scripts/check.sh .git/hooks/pre-push
#
# Exits non-zero if any check fails. A check is skipped (not failed) when its
# tool is not installed, so a bare clone without dev extras still pushes.
set -uo pipefail

REPO="$(git rev-parse --show-toplevel 2>/dev/null)" \
    || REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO" || exit 1
export PYTHONPATH="src${PYTHONPATH:+:$PYTHONPATH}"
export MPLCONFIGDIR="${MPLCONFIGDIR:-/tmp/mpl}"
# Interpreter: $PY if set, else the repo venv, else the main checkout's venv
# (a linked worktree has none of its own), else python3.
if [ -z "${PY:-}" ]; then
    MAIN="$(dirname "$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null)")"
    for cand in "$REPO/.venv/bin/python" "$MAIN/.venv/bin/python"; do
        if [ -x "$cand" ]; then PY="$cand"; break; fi
    done
    PY="${PY:-python3}"
fi

fail=0
ran=0
skipped=""
run() {  # run <label> <module> <args...>; skip if the tool is not importable
    local label="$1" mod="$2"; shift 2
    if ! "$PY" -c "import $mod" >/dev/null 2>&1; then
        echo "[check] $label: '$mod' not installed — skipped"
        skipped="$skipped $label"
        return 0
    fi
    ran=$((ran + 1))
    echo "[check] $label ..."
    "$PY" -m "$mod" "$@" || fail=1
}

# pytest: -o addopts= keeps the run independent of any pyproject addopts
# (coverage is a CI-only flag; it has no fail-under, so pass/fail is unchanged).
run pytest pytest -o addopts= -q
run ruff   ruff   check src/ tests/
run mypy   mypy   src/nebula3d --ignore-missing-imports --python-version 3.12

if [ "$fail" -ne 0 ]; then
    echo "" >&2
    echo "[check] FAILED — fix the issues above (bypass a push with: git push --no-verify)" >&2
    exit 1
fi
if [ "$ran" -eq 0 ]; then
    echo "[check] no checks ran: none of pytest, ruff, mypy is installed for $PY."
elif [ -n "$skipped" ]; then
    echo "[check] passed, but skipped:$skipped (not installed for $PY)."
else
    echo "[check] all checks passed."
fi
exit 0
