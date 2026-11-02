// Closing the volume (state/closeVolume.ts) returns every store to the state
// the app starts in. Each zustand store says here, once, beside its own
// definition, how: it resets with the volume (to its initial state, less the
// display preferences it keeps), or it holds nothing of a volume. A test
// (__tests__/volumeReset.test.ts) finds every store in the source and fails
// on one that says neither, so a store added later cannot be forgotten.

interface ResettableStore<S> {
  getState: () => S;
  getInitialState: () => S;
  setState: (partial: Partial<S>) => void;
}

interface Entry {
  store: ResettableStore<object>;
  keep: readonly string[];
  fresh?: () => object;
}

const resetting: Entry[] = [];
const volumeFree = new Map<object, string>();
const clearing: (() => void)[] = [];

/**
 * The store resets when the volume closes: to its initial state, except the
 * `keep` fields (preferences, not the volume's). A store whose initial state
 * is read back from storage (a conversation kept over a reload) gives the
 * empty state as `fresh`, which overrides those fields of its initial state.
 */
export function resetsWithVolume<S extends object>(
  store: ResettableStore<S>,
  opts: { keep?: readonly (keyof S & string)[]; fresh?: () => Partial<S> } = {},
): void {
  resetting.push({ store: store as ResettableStore<object>, keep: opts.keep ?? [], fresh: opts.fresh });
}

/** The store holds nothing of a volume (why: a line for the reader); Close leaves it alone. */
export function holdsNoVolume(store: object, why: string): void {
  volumeFree.set(store, why);
}

/** A module-level cache of a volume's (outside the stores): Close calls `clear`. */
export function clearsWithVolume(clear: () => void): void {
  clearing.push(clear);
}

/** Whether the store said how it closes (the test's check). */
export function declaredForClose(store: object): boolean {
  return volumeFree.has(store) || resetting.some((e) => e.store === store);
}

/** The fields Close keeps in this store, or null when it does not reset (the test's check). */
export function keptOnClose(store: object): readonly string[] | null {
  return resetting.find((e) => e.store === store)?.keep ?? null;
}

/** Every store that resets with the volume back to its initial state, and every cache cleared. */
export function resetVolumeState(): void {
  for (const { store, keep, fresh } of resetting) {
    const initial = { ...store.getInitialState(), ...(fresh?.() ?? {}) } as Record<string, unknown>;
    const next = Object.fromEntries(
      Object.entries(initial).filter(([k, v]) => typeof v !== "function" && !keep.includes(k)),
    );
    store.setState(next);
  }
  for (const clear of clearing) clear();
}
