// One page's colour-scale state: Auto from reference samples, the user's
// limits when set, and the colour bar's domain and histogram.  The caller owns
// where the manual limits live (a shared store or local state).

import { useMemo } from "react";

import {
  autoLevels,
  barDomain,
  histogram,
  type AutoLevels,
  type Levels,
  type ScaleKind,
} from "./colorScale";

export interface LevelsModel {
  levels: Levels; // what the views draw
  auto: AutoLevels;
  isAuto: boolean;
  soft: number;
  domain: [number, number];
  hist: Float32Array;
}

const EMPTY: ArrayLike<number>[] = [];

/**
 * `samples` set Auto (memoise them: a new array recomputes Auto); `histData`
 * is drawn behind the colour bar; `manual` overrides Auto when not null.
 */
export function useLevels({
  samples,
  histData,
  signed = false,
  scale = "lin",
  manual,
}: {
  samples: ArrayLike<number>[] | null;
  histData?: ArrayLike<number> | null;
  signed?: boolean;
  scale?: ScaleKind;
  manual: Levels | null;
}): LevelsModel {
  const src = samples ?? EMPTY;
  const auto = useMemo(() => autoLevels(src, { signed, scale }), [src, signed, scale]);
  const levels = manual
    ? signed
      ? { lo: -Math.abs(manual.hi), hi: Math.abs(manual.hi) }
      : manual
    : { lo: auto.lo, hi: auto.hi };
  const domain = barDomain(auto, levels, signed);
  const [d0, d1] = domain;
  const hist = useMemo(
    () => histogram(histData ?? src[0] ?? [], [d0, d1]),
    [histData, src, d0, d1],
  );
  return { levels, auto, isAuto: !manual, soft: auto.soft, domain, hist };
}
