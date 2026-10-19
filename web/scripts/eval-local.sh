#!/usr/bin/env bash
# The local eval tier: NEBULA Pilot on one local model, through the eval
# scenarios and the held-out fault scenarios, then the acceptance.
#
# The full records (every tool call, result and answer) go to
# .eval-runs/<date>/, which git ignores: on the measured datasets they hold
# figures from unpublished data. Their summaries (eval-records.mjs: pass or
# fail, the failed checks' names, failure kinds, time, tokens and the context
# window) go to docs/evals/local/<date>/, to be committed;
# scripts/eval-report.mjs makes the before/after report from them.
#
#   scripts/eval-local.sh <base-url> <model> <label>
#   scripts/eval-local.sh http://localhost:1234/v1 qwen/qwen3.8-27b lmstudio-qwen3.8-27b
#   scripts/eval-local.sh http://localhost:11434/v1 gemma4:26b ollama-gemma4-26b
#
# The model needs a context window of 56k or more, the run policy's minimum for
# a local live run (RUN_POLICY in src/llm/evals/validationModels.ts). In LM
# Studio, load it with a Context Length of 57344 or more before the script,
#   lms load qwen/qwen3.8-27b --context-length 57344
# and make that the model's default Context Length: LM Studio reloads an idle
# model with its defaults. In Ollama the model must support 57344 or more
# (ollama show gemma4:26b); the run sizes num_ctx itself. The scenario evals
# read the window before the first run and again before each, and refuse less
# or one they cannot read: a set refused before its first run leaves no record.
#
# NEBULA_EVAL_API          the backend serving the eval datasets (default http://127.0.0.1:8000)
# NEBULA_EVAL_HELDOUT_API  the backend serving the held-out volumes (default http://127.0.0.1:8001)
# NEBULA_EVAL_REPEAT       runs per scenario (default 3)
# NEBULA_EVAL_DATE         the folder's date (default today)
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
day=${NEBULA_EVAL_DATE:-$(date +%F)}
raw=.eval-runs/$day
public=../docs/evals/local/$day
mkdir -p "$raw" "$public"

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
  NEBULA_EVAL_REPEAT="$repeat" NEBULA_EVAL_OUT="$raw/$label.json" \
  npx vitest run src/llm/evals/live.test.ts || true
echo "== the held-out fault scenarios ($heldout_api)"
NEBULA_EVAL=1 NEBULA_EVAL_SET=heldout NEBULA_EVAL_API="$heldout_api" NEBULA_EVAL_BASE_URL="$base_url" \
  NEBULA_EVAL_MODEL="$model" NEBULA_EVAL_REPEAT="$repeat" NEBULA_EVAL_OUT="$raw/$label-heldout.json" \
  npx vitest run src/llm/evals/live.test.ts || true

echo "== summaries ($public)"
summaries=()
for set in "$label" "$label-heldout"; do
  if [ -f "$raw/$set.json" ]; then
    node scripts/eval-summary.mjs "$raw/$set.json" "$public/$set.json"
    summaries+=("$public/$set.json")
  else
    echo "no record for $set: its backend may be down, or the model's context window was refused (above)" >&2
  fi
done
if [ ${#summaries[@]} -eq 0 ]; then
  exit 1
fi

echo "== acceptance"
node scripts/eval-acceptance.mjs "${summaries[@]}"
