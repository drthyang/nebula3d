// A dataset's short name: its temperature, and — when another dataset shares
// that temperature — what sets its file stem apart ("22K · sub bkg" beside
// "22K · cc"), so two runs at one temperature never look the same.

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
