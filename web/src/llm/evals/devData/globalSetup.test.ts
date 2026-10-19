// The replay project's start without a Python that can run the bridge: it
// fails, saying how to fix it, and never skips. No Python needed: the unit
// project runs it.

import { afterEach, describe, expect, it } from "vitest";

import type { DevBridgeConfig } from "./bridgeWorker";
import globalSetup from "./globalSetup";

const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
const KEYS = ["NEBULA_PYTHON", "NEBULA_DEV_N"] as const;
const saved = Object.fromEntries(KEYS.map((k) => [k, env[k]]));

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete env[k];
    else env[k] = saved[k];
  }
});

describe("the replay project's start", () => {
  it("fails with the fix when its Python cannot run the bridge", async () => {
    env.NEBULA_PYTHON = "/nonexistent/python";
    delete env.NEBULA_DEV_N;
    const provided: DevBridgeConfig[] = [];
    await expect(globalSetup({ provide: (_key, value) => provided.push(value) })).rejects.toThrow(
      /\/nonexistent\/python cannot run the CPython bridge[\s\S]*set NEBULA_PYTHON to it[\s\S]*npx vitest --project unit/,
    );
    expect(provided).toEqual([]);
  });

  it("takes the dev cases' grid from NEBULA_DEV_N, 81 or 161", async () => {
    env.NEBULA_DEV_N = "100";
    await expect(globalSetup({ provide: () => undefined })).rejects.toThrow(/NEBULA_DEV_N=100: the dev cases run at 81 or 161 points per axis/);
  });
});
