// The checks a tool puts its arguments through. A model can send anything:
// a value outside what a tool takes goes back to it as a ToolArgError, whose
// message it reads and can correct (call.ts).

import { ToolArgError, type Args } from "../types";

export const oneOf = <T extends string>(args: Args, key: string, allowed: readonly T[], fallback?: T): T => {
  const v = args[key];
  if (v === undefined && fallback !== undefined) return fallback;
  if (typeof v === "string" && (allowed as readonly string[]).includes(v)) return v as T;
  throw new ToolArgError(`${key} must be one of ${allowed.join(", ")}; got ${JSON.stringify(v)}`);
};

export const num = (args: Args, key: string, fallback?: number): number => {
  const v = args[key] ?? fallback;
  const n = typeof v === "string" ? Number(v) : v;
  if (typeof n !== "number" || !Number.isFinite(n)) {
    throw new ToolArgError(`${key} must be a number; got ${JSON.stringify(args[key])}`);
  }
  return n;
};
