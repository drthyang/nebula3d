// A dataset's short name: its temperature, and — when another dataset shares
// that temperature — what sets its file stem apart ("<T> · sub bkg" beside
// "<T> · cc"), so two runs at one temperature never look the same.

import { isTuningView } from "./client";
import type { Dataset } from "./types";

const tokens = (stem: string): string[] => stem.split(/[_\s]+/).filter(Boolean);

export function datasetName(dataset: Dataset, all: readonly Dataset[] = []): string {
  const base = dataset.temperature ?? dataset.stem ?? dataset.id;
  const twins = all.filter((o) => o.id !== dataset.id && (o.temperature ?? o.stem ?? o.id) === base);
  if (!twins.length || !dataset.stem) return base;
  const others = new Set(twins.flatMap((o) => tokens(o.stem ?? "")));
  const own = tokens(dataset.stem).filter((t) => !others.has(t));
  return `${base} · ${own.length ? own.join(" ") : tokens(dataset.stem).slice(-1)[0]}`;
}

/**
 * The datasets the dataset menu offers: the folder's own, and a tuning run's
 * view of one only while it is the one open (its card's "Open the tuned
 * result" opens it). /api/datasets lists every tuning run's view beside its
 * dataset, so each tuning of an auto run would otherwise add a "· tuned"
 * entry to the menu.
 */
export function menuDatasets<D extends { id: string }>(all: readonly D[], openId: string | null | undefined): D[] {
  return all.filter((d) => !isTuningView(d.id) || d.id === openId);
}
