// Fits the app shell above the on-screen keyboard (keyboardFrame.ts): while
// NEBULA Pilot's composer (or another of its text fields) is focused and the
// keyboard is up, <html> gets `kb-open` and the visual viewport's height and
// pan as --kb-vh and --kb-top. Fields in the page are left to the browser,
// which scrolls the page's pane to them. Nothing happens where there is no
// visualViewport or no keyboard (a desktop).

import { useEffect } from "react";

import { isEditable, keyboardFrame } from "./keyboardFrame";

export function useKeyboardFrame(): void {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const root = document.documentElement;
    let frame = 0;
    const apply = () => {
      frame = 0;
      const f = keyboardFrame({
        layoutHeight: window.innerHeight,
        height: vv.height,
        offsetTop: vv.offsetTop,
        scale: vv.scale,
        editing: isEditable(document.activeElement) && document.activeElement?.closest(".ai-side") != null,
      });
      if (f) {
        const was = root.classList.contains("kb-open");
        root.style.setProperty("--kb-vh", `${f.height}px`);
        root.style.setProperty("--kb-top", `${f.top}px`);
        root.classList.add("kb-open");
        // the shell just shrank under the field: keep it in sight
        if (!was) requestAnimationFrame(() => document.activeElement?.scrollIntoView?.({ block: "nearest" }));
      } else if (root.classList.contains("kb-open")) {
        root.classList.remove("kb-open");
        root.style.removeProperty("--kb-vh");
        root.style.removeProperty("--kb-top");
      }
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(apply);
    };
    vv.addEventListener("resize", schedule);
    vv.addEventListener("scroll", schedule);
    // focusout fires before the next field's focusin: read after both
    document.addEventListener("focusin", schedule);
    document.addEventListener("focusout", schedule);
    return () => {
      vv.removeEventListener("resize", schedule);
      vv.removeEventListener("scroll", schedule);
      document.removeEventListener("focusin", schedule);
      document.removeEventListener("focusout", schedule);
      if (frame) cancelAnimationFrame(frame);
      root.classList.remove("kb-open");
    };
  }, []);
}
