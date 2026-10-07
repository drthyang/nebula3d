// A page's workspace layout (layout.ts), loaded from and saved to
// localStorage, with Esc leaving the single-view layout.

import { useEffect, useReducer } from "react";

import { layoutReducer, loadLayout, saveLayout, type LayoutAction, type LayoutState } from "./layout";

export type LayoutDispatch = (a: LayoutAction) => void;

export function useWorkspaceLayout(
  page: string,
  ids: string[],
  fallback: LayoutState,
): [LayoutState, LayoutDispatch] {
  const [state, dispatch] = useReducer(layoutReducer, undefined, () =>
    loadLayout(page, ids, fallback),
  );
  useEffect(() => saveLayout(page, state), [page, state]);
  useEffect(() => {
    if (state.mode !== "single") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") dispatch({ type: "escape" });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [state.mode]);
  return [state, dispatch];
}
