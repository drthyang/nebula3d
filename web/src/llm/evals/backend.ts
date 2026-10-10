// Runs the app's API calls against a backend from Node: the tools fetch
// relative URLs (/api/...), which a test process resolves against the server
// it is told about (NEBULA_EVAL_API, default the native server on port 8000).

/** An environment variable of the test process (the web build has no Node types). */
export const env = (name: string): string | undefined =>
  (globalThis as unknown as { process?: { env: Record<string, string | undefined> } }).process?.env[name];

let installed = false;

export const backendUrl = (): string => env("NEBULA_EVAL_API") ?? "http://127.0.0.1:8000";

export function useBackend(base = backendUrl()): void {
  if (installed) return;
  installed = true;
  const real = globalThis.fetch;
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) =>
    real(typeof input === "string" && input.startsWith("/") ? new URL(input, base) : input, init)) as typeof fetch;
}

/** Writes a text file from the test process. */
export async function writeText(url: URL, text: string): Promise<void> {
  const spec = "node:fs";
  const fs = (await import(/* @vite-ignore */ spec)) as { writeFileSync(p: URL, d: string): void };
  fs.writeFileSync(url, text);
}
