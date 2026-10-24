import { configDefaults, defineConfig } from "vitest/config";

// Two projects (docs/development.md, "The replay tests"):
// - unit: every test but the replays; no Python needed (`npx vitest --project unit`);
// - replay: *.replay.test.ts, the console's Pages path (VITE_DATA_MODE=pyodide)
//   on the validation's dev cases, with the CPython bridge in place of Pyodide
//   (src/llm/evals/devData/), and the tests that read the package's own values
//   with that Python (sharedLimits.replay.test.ts). globalSetup finds the
//   Python and fails, saying how to fix it, when there is none.
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "unit",
          environment: "node",
          include: ["src/**/*.test.ts"],
          exclude: [...configDefaults.exclude, "src/**/*.replay.test.ts"],
        },
      },
      {
        test: {
          name: "replay",
          environment: "node",
          include: ["src/**/*.replay.test.ts"],
          env: { VITE_DATA_MODE: "pyodide" },
          globalSetup: ["src/llm/evals/devData/globalSetup.ts"],
          setupFiles: ["src/llm/evals/devData/setup.ts"],
          testTimeout: 120_000,
          hookTimeout: 120_000,
        },
      },
    ],
  },
});
