#!/usr/bin/env bash
# The local eval tier: NEBULA Pilot on one local model, through the eval
# scenarios and the held-out fault scenarios, then the acceptance.
#
#   scripts/eval-local.sh <base-url> <model> <label>
#   scripts/eval-local.sh http://localhost:1234/v1 qwen/qwen3.8-27b lmstudio-qwen3.8-27b
#   scripts/eval-local.sh http://localhost:11434/v1 gemma4:26b ollama-gemma4-26b
#
# NEBULA_EVAL_API          the backend serving the eval datasets (default http://127.0.0.1:8000)
# NEBULA_EVAL_HELDOUT_API  the backend serving the held-out volumes (default http://127.0.0.1:8001)
# NEBULA_EVAL_REPEAT       runs per scenario (default 3)
# NEBULA_EVAL_FORCE=1      run though the machine is short of memory
#
# The Mac is shared: it shows what the model servers hold and how much memory
# is free, and stops when little is, before it loads anything. It never
# unloads a model; whoever runs last in the queue does.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ $# -ne 3 ]; then
  echo "usage: scripts/eval-local.sh <base-url> <model> <label>" >&2
  exit 1
fi
base_url=$1 model=$2 label=$3
api=${NEBULA_EVAL_API:-http://127.0.0.1:8000}
heldout_api=${NEBULA_EVAL_HELDOUT_API:-http://127.0.0.1:8001}
repeat=${NEBULA_EVAL_REPEAT:-3}
out=../docs/evals/results

echo "== what the model servers hold"
(command -v ollama >/dev/null && ollama ps) || echo "(no ollama)"
(command -v lms >/dev/null && lms ps) || echo "(no lms)"
if command -v memory_pressure >/dev/null; then
  free=$(memory_pressure | sed -n 's/.*free percentage: \([0-9]*\)%.*/\1/p')
  echo "== memory free: ${free:-?} %"
  if [ -n "${free:-}" ] && [ "$free" -lt 15 ] && [ "${NEBULA_EVAL_FORCE:-0}" != 1 ]; then
    echo "Less than 15 % of memory is free: wait for the other jobs, or set NEBULA_EVAL_FORCE=1." >&2
    exit 2
  fi
fi

# A failed run fails the vitest run too; the acceptance decides.
echo "== the eval scenarios ($api)"
NEBULA_EVAL=1 NEBULA_EVAL_API="$api" NEBULA_EVAL_BASE_URL="$base_url" NEBULA_EVAL_MODEL="$model" \
  NEBULA_EVAL_REPEAT="$repeat" NEBULA_EVAL_OUT="$out/local-$label.json" \
  npx vitest run src/llm/evals/live.test.ts || true
echo "== the held-out fault scenarios ($heldout_api)"
NEBULA_EVAL=1 NEBULA_EVAL_SET=heldout NEBULA_EVAL_API="$heldout_api" NEBULA_EVAL_BASE_URL="$base_url" \
  NEBULA_EVAL_MODEL="$model" NEBULA_EVAL_REPEAT="$repeat" NEBULA_EVAL_OUT="$out/local-$label-heldout.json" \
  npx vitest run src/llm/evals/live.test.ts || true

echo "== acceptance"
node scripts/eval-acceptance.mjs "$out/local-$label.json" "$out/local-$label-heldout.json"
