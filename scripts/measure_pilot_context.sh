#!/usr/bin/env bash
# NEBULA Pilot's context, measured by component (docs/pilot-context-design.md).
#
#   scripts/measure_pilot_context.sh [out-dir] [--real [model ...]]
#
# 1. scripts/pilot_context/measure.spec.ts, through vitest from web/ (outside
#    CI's include patterns): the system prompt by section, every tool's
#    definition and the local offer by question, the opening messages, the
#    skills, a sample of every tool's result, the send-backs, a reply's
#    requests as they grow (with and without the loop's compaction), where
#    each rule is stated, and reshapes of the results. Counted by the context
#    guard's estimator at its starting rates (web/src/llm/provider/tokens.ts),
#    as web/src/llm/__tests__/tokenBudget.test.ts counts. Prints a Markdown
#    report; with an out-dir, writes report.md and components.json there.
# 2. With --real: scripts/pilot_context/realtokens.mjs counts every component
#    with a local Ollama model's tokenizer (default gemma4:26b and qwen3:32b),
#    and writes realtokens.json. It loads each model in turn (17-20 GB) and
#    unloads it after: check `ollama ps` and `lms ps` first on the shared Mac.
#
# Synthetic and hermetic for step 1 (no model, backend or API); step 2 calls
# only the local Ollama server. No measured data is used.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
out="${1:-}"
[ "${out}" = "--real" ] && out=""
real=0
models=()
for a in "$@"; do
  if [ "$a" = "--real" ]; then real=1; continue; fi
  [ "$real" = 1 ] && models+=("$a")
done
if [ "$real" = 1 ] && [ -z "$out" ]; then
  out="$(mktemp -d)"
fi
if [ -n "$out" ]; then
  mkdir -p "$out"
  out="$(cd "$out" && pwd)"
fi

cd "$root/web"
PILOT_CONTEXT_OUT="$out" npx vitest run --config ../scripts/pilot_context/vitest.config.mjs --reporter=default \
  | sed -n '/^## 1\./,/^ *✓/p' | sed '$d'

if [ "$real" = 1 ]; then
  echo
  echo "== real tokenizers (Ollama), into $out"
  node "$root/scripts/pilot_context/realtokens.mjs" "$out" "${models[@]+"${models[@]}"}"
fi
