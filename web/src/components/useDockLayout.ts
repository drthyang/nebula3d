// NEBULA Pilot's dock mode and size for the current window (state/dockLayout.ts),
// as the CSS variables the app's grid reads: --dock-w for the docked column (the
// rail's width when collapsed) and --sheet-h for the bottom sheet.

import { useEffect, useState, type CSSProperties } from "react";

import { clampDockWidth, defaultDockWidth, dockModeFor, RAIL_W, type DockMode } from "../state/dockLayout";
import { useNavStore } from "../state/navStore";

const windowSize = () => ({ w: window.innerWidth, h: window.innerHeight });

export function useDockLayout(): { mode: DockMode; open: boolean; style: CSSProperties } {
  const [size, setSize] = useState(windowSize);
  useEffect(() => {
    const on = () => setSize(windowSize());
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  const open = useNavStore((s) => s.dockOpen);
  const dockWidth = useNavStore((s) => s.dockWidth);
  const sheet = useNavStore((s) => s.sheet);
  const mode = dockModeFor(size.w, size.h);
  const width = clampDockWidth(dockWidth ?? defaultDockWidth(size.w), size.w);
  const style = {
    "--dock-w": `${open ? width : RAIL_W}px`,
    "--sheet-h": `${Math.round(sheet * size.h)}px`,
  } as CSSProperties;
  return { mode, open, style };
}
