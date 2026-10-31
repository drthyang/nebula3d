// A tab list (role="tablist") styled as the segmented control the viewer
// pages switch planes with. The keys follow tabs.ts: the arrows move to the
// next or previous tab and select it, Home and End to the ends; only the
// selected tab is in the Tab order. The caller renders the panel with
// role="tabpanel", id tabPanelId(idBase) and aria-labelledby tabId(idBase,
// value).

import { useRef, type ReactNode } from "react";

import { tabId, tabKeyTarget, tabPanelId } from "./tabs";

export interface TabSpec {
  id: string;
  label: ReactNode;
  title?: string; // a one-line tooltip
}

export function TabList({
  tabs,
  value,
  onChange,
  label,
  idBase,
  className,
}: {
  tabs: readonly TabSpec[];
  value: string;
  onChange: (id: string) => void;
  label: string; // the list's accessible name
  idBase: string; // prefix of the tabs' and the panel's ids (useId)
  className?: string;
}) {
  const refs = useRef(new Map<string, HTMLButtonElement>());
  const selected = Math.max(0, tabs.findIndex((t) => t.id === value));
  return (
    <div role="tablist" aria-label={label} aria-orientation="horizontal" className={`segmented tabs${className ? ` ${className}` : ""}`}>
      {tabs.map((t, i) => {
        const on = i === selected;
        return (
          <button
            key={t.id}
            ref={(el) => {
              if (el) refs.current.set(t.id, el);
              else refs.current.delete(t.id);
            }}
            type="button"
            role="tab"
            id={tabId(idBase, t.id)}
            aria-selected={on}
            aria-controls={tabPanelId(idBase)}
            tabIndex={on ? 0 : -1}
            className={on ? "on" : ""}
            title={t.title}
            onClick={() => onChange(t.id)}
            onKeyDown={(e) => {
              const j = tabKeyTarget(e.key, i, tabs.length);
              if (j === null) return;
              e.preventDefault();
              onChange(tabs[j].id);
              refs.current.get(tabs[j].id)?.focus();
            }}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
