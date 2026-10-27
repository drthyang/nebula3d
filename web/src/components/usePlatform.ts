// The device the gesture card and the wheel hint describe: ⌘ or Ctrl
// (gestures.ts isMacLike), and whether it is a touch-only device (a coarse
// pointer with no hover), kept current if that changes (a tablet's keyboard
// and trackpad attached, say).

import { useEffect, useState } from "react";

import { isMacLike, isTouchOnly } from "./gestures";

function platformString(): string {
  if (typeof navigator === "undefined") return "";
  const uaData = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData;
  return uaData?.platform || navigator.platform || "";
}

/** Apple platform: the modifier is ⌘. */
export const IS_MAC = typeof navigator !== "undefined" && isMacLike(platformString(), navigator.userAgent);

const QUERIES = ["(pointer: coarse)", "(hover: none)"];

function touchOnlyNow(): boolean {
  return typeof matchMedia === "function" && isTouchOnly((q) => matchMedia(q).matches);
}

/** Whether this is a touch-only device, following media changes. */
export function useTouchOnly(): boolean {
  const [touch, setTouch] = useState(touchOnlyNow);
  useEffect(() => {
    if (typeof matchMedia !== "function") return;
    const lists = QUERIES.map((q) => matchMedia(q));
    const update = () => setTouch(touchOnlyNow());
    lists.forEach((l) => l.addEventListener("change", update));
    return () => lists.forEach((l) => l.removeEventListener("change", update));
  }, []);
  return touch;
}
