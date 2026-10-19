// The modules as they import each other at run time: no module under llm/
// sits on an import cycle, and skills.ts reaches nothing under tools/. On a
// cycle one module of it runs while another is still half evaluated, which
// the tests' module mocks cannot resolve; skills.ts reaching the registry
// would read SKILL_TREE before it is set (the registry imports skills.ts).
//
// The graph is every module under web/src, read as text and parsed by
// TypeScript. An import or a re-export is an edge unless it is erased before
// the code runs: `import type`, `export type`, or one that names types only.
// A dynamic import() is no edge: it loads later, after its importer ran.

import ts from "typescript";
import { describe, expect, it } from "vitest";

import { joinPath } from "../skills";

const HERE = "web/src/llm/__tests__";
const LLM = "web/src/llm/";
const SKILLS = "web/src/llm/skills.ts";

/** Every module under web/src, by its repo path. */
const SOURCES: Record<string, string> = Object.fromEntries(
  Object.entries(
    import.meta.glob<string>(["../../**/*.ts", "../../**/*.tsx", "!../../**/*.d.ts"], { query: "?raw", import: "default", eager: true }),
  ).map(([key, text]) => [joinPath(HERE, key), text]),
);

/** The specifiers a module imports when it runs. */
function runtimeImports(path: string, text: string): string[] {
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, false, path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const out: string[] = [];
  for (const st of source.statements) {
    if (ts.isImportDeclaration(st)) {
      const clause = st.importClause;
      if (clause?.isTypeOnly) continue;
      const named = clause?.namedBindings && ts.isNamedImports(clause.namedBindings) ? clause.namedBindings.elements : null;
      if (clause && !clause.name && named?.length && named.every((e) => e.isTypeOnly)) continue;
      out.push((st.moduleSpecifier as ts.StringLiteral).text);
    } else if (ts.isExportDeclaration(st) && st.moduleSpecifier) {
      if (st.isTypeOnly) continue;
      const named = st.exportClause && ts.isNamedExports(st.exportClause) ? st.exportClause.elements : null;
      if (named?.length && named.every((e) => e.isTypeOnly)) continue;
      out.push((st.moduleSpecifier as ts.StringLiteral).text);
    }
  }
  return out;
}

/** The module a relative specifier names, or null: a package, a file read as text (`?raw`), data (.json). */
function resolve(from: string, spec: string): string | null {
  if (!spec.startsWith(".") || spec.includes("?")) return null;
  const base = joinPath(from.slice(0, from.lastIndexOf("/")), spec);
  return [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`].find((p) => p in SOURCES) ?? null;
}

const GRAPH = new Map(
  Object.entries(SOURCES).map(([path, text]) => [
    path,
    runtimeImports(path, text).flatMap((spec) => resolve(path, spec) ?? []),
  ]),
);

/** The graph's cycles: each strongly connected set of two or more modules (or one that imports itself), sorted. */
function cyclesIn(graph: ReadonlyMap<string, readonly string[]>): string[][] {
  // Tarjan's algorithm.
  let counter = 0;
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const cycles: string[][] = [];
  const visit = (v: string): void => {
    index.set(v, counter);
    low.set(v, counter);
    counter += 1;
    stack.push(v);
    onStack.add(v);
    for (const w of graph.get(v) ?? []) {
      if (!index.has(w)) {
        visit(w);
        low.set(v, Math.min(low.get(v)!, low.get(w)!));
      } else if (onStack.has(w)) {
        low.set(v, Math.min(low.get(v)!, index.get(w)!));
      }
    }
    if (low.get(v) !== index.get(v)) return;
    const set: string[] = [];
    let w: string;
    do {
      w = stack.pop()!;
      onStack.delete(w);
      set.push(w);
    } while (w !== v);
    if (set.length > 1 || (graph.get(v) ?? []).includes(v)) cycles.push(set.sort());
  };
  for (const v of graph.keys()) if (!index.has(v)) visit(v);
  return cycles;
}

/** Every module `from` reaches through its imports. */
function reached(from: string): Set<string> {
  const seen = new Set<string>();
  const next = [...(GRAPH.get(from) ?? [])];
  while (next.length) {
    const m = next.pop()!;
    if (seen.has(m)) continue;
    seen.add(m);
    next.push(...(GRAPH.get(m) ?? []));
  }
  return seen;
}

describe("the modules' runtime imports", () => {
  it("reads every module, and an import as an edge only where it runs", () => {
    expect(GRAPH.size).toBeGreaterThan(150);
    expect(GRAPH.get("web/src/llm/agent.ts")).toContain("web/src/llm/tools/index.ts");
    // skills.ts imports types from the agent and the tools' facts: erased, no edge.
    expect(SOURCES[SKILLS]).toMatch(/^import type \{ Gate \} from "\.\/tools\/facts";$/m);
    expect(GRAPH.get(SKILLS)).toEqual([]);
    // A cycle is found where there is one.
    const toy = new Map([["a", ["b"]], ["b", ["c", "a"]], ["c", []], ["d", ["d"]]]);
    expect(cyclesIn(toy)).toEqual([["a", "b"], ["d"]]);
  });

  it("put no module under llm/ on a cycle", () => {
    expect(cyclesIn(GRAPH).filter((c) => c.some((m) => m.startsWith(LLM)))).toEqual([]);
  });

  it("leave skills.ts reaching nothing under tools/: the registry imports it", () => {
    expect([...reached(SKILLS)].filter((m) => m.startsWith(`${LLM}tools/`))).toEqual([]);
  });
});
