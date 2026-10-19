// The replay project's global setup: finds the Python the CPython bridge runs
// on, checks that it imports this checkout's nebula3d with its numeric stack,
// and hands what it found to every test file (setup.ts reads it). Without a
// Python that can, the replay tests fail here, saying how to fix it: they never
// skip.
//
// The interpreter: NEBULA_PYTHON, else the checkout's .venv/bin/python, else
// python3. The checkout's src/ goes first on its PYTHONPATH, so the bridge runs
// the Python of the same checkout as the TypeScript beside it. NEBULA_DEV_N
// sets the dev cases' grid: 81 points per axis by default, 161 for a nightly
// run (every node on a voxel at either).

import { DEV_GRIDS, nodeModules, type DevBridgeConfig } from "./bridgeWorker";

const GRIDS: readonly number[] = DEV_GRIDS;

interface CheckReport {
  python: string;
  executable: string;
  nebula3d?: string;
  versions?: Record<string, string | null>;
  error?: string;
}

export default async function globalSetup(project: { provide(key: "devBridge", value: DevBridgeConfig): void }): Promise<void> {
  const node = await nodeModules();
  const here = (rel: string) => node.fileURLToPath(new URL(rel, import.meta.url));
  const script = here("./bridge.py");
  const checkout = here("../../../../../"); // devData → evals → llm → src → web → the checkout
  const src = node.join(checkout, "src");

  const n = Number(node.env.NEBULA_DEV_N ?? GRIDS[0]);
  if (!GRIDS.includes(n)) {
    throw new Error(`NEBULA_DEV_N=${node.env.NEBULA_DEV_N}: the dev cases run at ${GRIDS.join(" or ")} points per axis`);
  }

  const venv = node.join(checkout, ".venv", "bin", "python");
  const python = node.env.NEBULA_PYTHON || (node.existsSync(venv) ? venv : "python3");
  const fix =
    "The replay tests (*.replay.test.ts) run the pipeline in Python, through the CPython bridge. " +
    "Fix: install the package into a Python 3.10+ (from the repository root: pip install -e .) and set " +
    "NEBULA_PYTHON to it, or make it .venv/bin/python at the repository root. " +
    "Without Python, run the unit tests alone: npx vitest --project unit.";

  const env = { ...node.env, PYTHONPATH: [src, node.env.PYTHONPATH].filter(Boolean).join(node.delimiter) };
  const run = node.spawnSync(python, [script, "check"], { env, encoding: "utf8" });
  let report: CheckReport | null = null;
  try {
    report = JSON.parse(run.stdout) as CheckReport;
  } catch {
    report = null;
  }
  if (run.error || run.status !== 0 || !report?.nebula3d) {
    const why = run.error?.message ?? report?.error ?? (run.stderr.trim().split("\n").slice(-5).join("\n") || `exit ${run.status}`);
    throw new Error(`${python} cannot run the CPython bridge: ${why}\n${fix}`);
  }
  const ours = node.realpathSync(node.join(src, "nebula3d", "__init__.py"));
  if (node.realpathSync(report.nebula3d) !== ours) {
    throw new Error(`${python} imports nebula3d from ${report.nebula3d}, not this checkout's ${ours}.\n${fix}`);
  }

  const v = report.versions ?? {};
  const stack = `Python ${report.python} (${report.executable}): numpy ${v.numpy}, scipy ${v.scipy}, h5py ${v.h5py}`;
  console.log(`dev-data bridge: ${stack}; nebula3d from ${src}; n=${n}`);
  project.provide("devBridge", { python, script, src, n, stack });
}
