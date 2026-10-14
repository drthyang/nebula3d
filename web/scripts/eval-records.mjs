// The facts of an eval run that may be published, and the record they make.
//
// A full record (live.test.ts, NEBULA_EVAL_OUT) holds every tool call, its
// result and the answer. On the measured eval datasets those hold figures
// measured from unpublished data, so a full record stays on the machine that
// ran it. Its summary holds only what a before/after report needs: per run,
// whether it passed, the names of the checks it failed (written with the
// scenarios, no measured figures), how the model server failed it if it did,
// whether it ended in an exception, at the round cap or by the loop guard, and
// its time and token counts. Both kinds of file are read alike here.

const TURN_CAP = /^Stopped after \d+ rounds/;
const LOOP = /repeated calls that brought nothing new/;

/** One run's publishable facts, from a full record's run or a summary's. */
export function runFacts(run) {
  const failure = typeof run.failure === "string" ? run.failure : (run.failure?.kind ?? null);
  return {
    scenario: run.scenario,
    passed: Boolean(run.passed),
    failed_checks: run.failed_checks ?? (run.grades ?? []).filter((g) => !g.pass).map((g) => g.check),
    failure,
    attempts: run.attempts ?? run.failure?.attempts ?? null,
    error: typeof run.error === "boolean" ? run.error : Boolean(run.error),
    turn_cap: run.turn_cap ?? TURN_CAP.test(run.note ?? ""),
    loop: run.loop ?? LOOP.test(run.note ?? ""),
    seconds: run.seconds ?? (typeof run.latency_ms === "number" ? Math.round(run.latency_ms / 1000) : null),
    tokens: run.tokens ?? (run.usage ? { input: run.usage.input, output: run.usage.output, requests: run.usage.requests } : null),
  };
}

/** A record's publishable summary. */
export function summarize(record) {
  const runs = record.runs.map(runFacts);
  return {
    kind: "nebula-pilot-eval-summary",
    provider: record.provider,
    model: record.model,
    local: record.local,
    at: record.at,
    complete: record.complete,
    repeat: record.repeat,
    timeout_minutes: record.timeout_minutes,
    summary: record.summary,
    runs,
  };
}

/** A model's runs across files, keyed "model (provider)". */
export function runsByModel(records) {
  const out = new Map();
  for (const r of records) {
    const key = `${r.model} (${r.provider})`;
    out.set(key, (out.get(key) ?? []).concat(r.runs.map(runFacts)));
  }
  return out;
}

/** The tallies a report and the acceptance read. */
export function tally(runs) {
  const failures = {};
  for (const r of runs) if (r.failure) failures[r.failure] = (failures[r.failure] ?? 0) + 1;
  return {
    runs: runs.length,
    passed: runs.filter((r) => r.passed).length,
    errors: runs.filter((r) => r.error).length,
    turn_cap: runs.filter((r) => r.turn_cap).length,
    loops: runs.filter((r) => r.loop).length,
    failures,
  };
}
