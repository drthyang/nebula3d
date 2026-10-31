// Keyboard and naming rules for a tab list (WAI-ARIA tabs, automatic
// activation): the arrow keys along the list move to the next or previous tab
// and select it, wrapping at the ends; Home and End go to the first and the
// last. Only the selected tab is in the Tab order (roving tabindex), so Tab
// leaves the list for the panel. Tabs.tsx renders the list.

export type TabOrientation = "horizontal" | "vertical";

/**
 * The tab a key moves to from tab `index` of `count`, or null when the key is
 * not one the list handles. A horizontal list answers ← and →, a vertical one
 * ↑ and ↓; both answer Home and End. An index outside the list counts as the
 * first tab.
 */
export function tabKeyTarget(key: string, index: number, count: number, orientation: TabOrientation = "horizontal"): number | null {
  if (count <= 0) return null;
  const i = index >= 0 && index < count ? index : 0;
  const [prev, next] = orientation === "horizontal" ? ["ArrowLeft", "ArrowRight"] : ["ArrowUp", "ArrowDown"];
  if (key === next) return (i + 1) % count;
  if (key === prev) return (i - 1 + count) % count;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  return null;
}

/** The id of a tab, for its panel's aria-labelledby. */
export const tabId = (base: string, id: string): string => `${base}-tab-${id}`;

/** The id of the panel a list's tabs control (one panel, its content the selected tab's). */
export const tabPanelId = (base: string): string => `${base}-panel`;
