// HELD OUT. Builders and agents must not open, print or read
// fixtures/holdout/heldout.json: the tool results recorded on the scenario evals'
// held-out volumes (heldoutProbe.test.ts records them). This module is its one
// reader, and it reads it only with NEBULA_HOLDOUT_TESTS=1, as CI sets for every
// job (the frontend job's `npm run test` included). heldoutFixture.test.ts checks
// that no other module in web/src imports the file or names it.
//
// Without the opt-in the held-out scenarios' replay (heldout.test.ts) is neither
// collected nor run, so their names never reach the output whoever tunes reads.

/** The opt-in, shared with pytest (tests/conftest.py): "1" is on. */
export const HOLDOUT_ENV = "NEBULA_HOLDOUT_TESTS";

/** Whether this run opts in to the held-out data. */
export const holdoutOptedIn = (): boolean =>
  (globalThis as unknown as { process?: { env: Record<string, string | undefined> } }).process?.env[HOLDOUT_ENV] === "1";

/** What the probe records and the replay reads. */
export interface HeldoutFixture {
  recorded: string;
  datasets: unknown[];
  contexts: Record<string, unknown>;
  results: Record<string, string>;
}

/** Where the fixture lives: the probe writes it here. */
export const HELDOUT_FIXTURE_URL = new URL("./fixtures/holdout/heldout.json", import.meta.url);

/**
 * The recorded fixture, read only with the opt-in. Without it this throws, saying how
 * to opt in: never an empty fixture, which a run meant to cover the held-out
 * scenarios would take for a pass.
 */
export async function loadHeldoutFixture(): Promise<HeldoutFixture> {
  if (!holdoutOptedIn()) {
    throw new Error(`the scenario evals' held-out fixture is held out: set ${HOLDOUT_ENV}=1 to load it`);
  }
  const loaded = (await import("./fixtures/holdout/heldout.json")) as { default: unknown };
  return loaded.default as HeldoutFixture;
}
