// A key cap: the gesture card's keys and the wheel hint's ⌘ / Ctrl.

import type { ReactNode } from "react";

/** `name` is what a screen reader says for a symbol key ("Command" for ⌘). */
export function Kbd({ children, name }: { children: ReactNode; name?: string }) {
  return (
    <kbd className="kbd" aria-label={name}>
      {children}
    </kbd>
  );
}
