// The in-browser engine's memory, as its workers report it (workers/heapReport.ts):
// the pipeline worker's WASM heap, each ring worker's, and the budgets the
// size gate plans with (nebula3d.webbridge.memory_budget_json, read once at
// the pipeline worker's boot). An observable for the console's memory bar.
//
// A heap is gone with its worker: cancel and a crash terminate the pipeline
// worker (clearMainHeap), and the ring pool's teardown drops the ring heaps.

export interface MemoryBudget {
  device: "desktop" | "mobile";
  heap_budget_bytes: number; // what the size gate budgets a run's peak heap at
  tab_budget_bytes: number | null; // the tab-wide budget on a phone / tablet
}

export interface EngineMemory {
  main: number | null; // the pipeline worker's heap size (bytes), null before it reports
  ring: number[]; // each ring worker's heap that has reported
  budget: MemoryBudget | null;
}

let state: EngineMemory = { main: null, ring: [], budget: null };
const listeners = new Set<(m: EngineMemory) => void>();

function publish(next: EngineMemory): void {
  state = next;
  for (const fn of listeners) fn(state);
}

export function getEngineMemory(): EngineMemory {
  return state;
}

export function subscribeEngineMemory(fn: (m: EngineMemory) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// The budget as the worker sent it, or null when it is not one (an older wheel).
export function parseBudget(raw: unknown): MemoryBudget | null {
  const b = raw as Partial<MemoryBudget> | null | undefined;
  if (!b || (b.device !== "desktop" && b.device !== "mobile")) return null;
  if (typeof b.heap_budget_bytes !== "number" || !(b.heap_budget_bytes > 0)) return null;
  const tab = typeof b.tab_budget_bytes === "number" && b.tab_budget_bytes > 0 ? b.tab_budget_bytes : null;
  return { device: b.device, heap_budget_bytes: b.heap_budget_bytes, tab_budget_bytes: tab };
}

export function setMainHeap(bytes: number, budget: unknown): void {
  if (!(bytes > 0)) return;
  publish({ ...state, main: bytes, budget: parseBudget(budget) ?? state.budget });
}

export function clearMainHeap(): void {
  if (state.main === null) return;
  publish({ ...state, main: null });
}

export function setRingHeaps(heaps: number[]): void {
  const ring = heaps.filter((b) => b > 0);
  if (ring.length === state.ring.length && ring.every((b, i) => b === state.ring[i])) return;
  publish({ ...state, ring });
}
