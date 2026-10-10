// Gathers a report for one finished reply: a fresh measurement pass with the
// agent's own tools (the same numbers the agent reads, run again so the report
// never depends on which tools the model happened to call), figures of the
// cleanup stages and the ΔPDF sections, the run's settings, the tuning record,
// and the reply itself.

import { fetchDpdfSlice, fetchSlice } from "../../api/client";
import type { Dataset, Slice } from "../../api/types";
import { autoLevels } from "../../components/colorScale";
import { DPDF_AUTO_PERCENTILE, withoutOrigin } from "../../components/dpdfLevels";
import { usePipelineStore } from "../../state/pipelineStore";
import type { ChatTurn } from "../chatStore";
import { datasetLabel, dpdfVolumeId, safe } from "../context/loadContext";
import { isLocalUrl, providerForUrl } from "../provider/presets";
import type { LlmSettings } from "../settings";
import { CHAT_TOOLS, type ToolContext } from "../tools";
import { currentStageSettings, displayValue, SAMPLE_PARAMS, TUNE_STAGES, type ParamValue } from "../tune/catalog";
import { headline } from "../tune/evaluate";
import { STAGE_GOALS } from "../tune/prompts";
import { useTuneStore } from "../tune/tuner";
import { fullHalf, pngDataUrl, rasterize } from "./figures";
import { buildReport, type Measured, type Report, type ReportFigure, type ReportTuningStage } from "./report";

// The tools whose replies make a reply an analysis worth a report.
export const REPORT_TOOLS = new Set(["assess_stage", "tune_pipeline", "run_pipeline", "texture_check", "qmax_coverage", "symmetry_check"]);
export const reportable = (turn: ChatTurn): boolean =>
  turn.role === "assistant" && Boolean(turn.steps?.some((s) => REPORT_TOOLS.has(s.name) && s.status === "done"));

const STAGE_FIGURES = [
  ["raw", "Raw"],
  ["ringremoved", "Ring-removed"],
  ["braggpunched", "Bragg-punched"],
  ["backfilled", "Backfilled"],
  ["flattened", "Flattened"],
] as const;
const DPDF_SECTIONS = [
  ["xy", "x–y section at z = 0"],
  ["xz", "x–z section at y = 0"],
  ["yz", "y–z section at x = 0"],
] as const;
const FIGURE_PX = 360;
const DPDF_HALF = 25; // Å: the near-origin correlations

type Obj = Record<string, unknown>;

async function measure(ctx: ToolContext): Promise<Measured> {
  const run = async (name: string, args: Obj = {}): Promise<Obj | null> => {
    const tool = CHAT_TOOLS.find((t) => t.name === name);
    if (!tool) return null;
    try {
      const out = await tool.run(args, ctx, {});
      return out.result && typeof out.result === "object" ? (out.result as Obj) : null;
    } catch {
      return null;
    }
  };
  const [describe, all, texture, coverage, symmetry] = await Promise.all([
    run("describe_dataset"),
    run("assess_stage", { stage: "all" }),
    run("texture_check"),
    run("qmax_coverage"),
    dpdfVolumeId(ctx.dataset) ? run("symmetry_check") : Promise.resolve(null),
  ]);
  const stage = (k: string): Obj | null => {
    const s = all?.[k];
    return s && typeof s === "object" && !("missing" in (s as Obj)) ? (s as Obj) : null;
  };
  return {
    describe,
    rings: stage("rings"),
    punch: stage("punch"),
    backfill: stage("backfill"),
    flatten: stage("flatten"),
    pdf: stage("pdf"),
    texture,
    coverage,
    symmetry,
  };
}

async function figures(dataset: Dataset): Promise<ReportFigure[]> {
  const out: ReportFigure[] = [];
  const stageId = (name: string) => dataset.stages.find((s) => s.name === name && s.exists)?.volume_id;
  const stageSlices = await Promise.all(
    STAGE_FIGURES.map(async ([name, title]) => {
      const id = stageId(name);
      const slice = id ? await safe(fetchSlice(id, "hk0", 0, false)) : null;
      return slice ? { title: title as string, slice } : null;
    }),
  );
  const present = stageSlices.filter((x): x is { title: string; slice: Slice } => x != null);
  if (present.length) {
    // One colour scale for every stage, from the first (the raw cut): the
    // stages are compared, not each stretched to its own range.
    const levels = autoLevels([present[0].slice.data], { scale: "asinh" });
    const half = fullHalf(present[0].slice);
    for (const { title, slice } of present) {
      const url = pngDataUrl(rasterize(slice, { n: FIGURE_PX, half, colormap: "inferno", scale: "asinh", levels, diverging: false }), FIGURE_PX);
      if (url) out.push({ title: `${title}, H–K plane at L = 0`, caption: "Shared asinh colour scale (the raw cut's Auto); grey is masked.", dataUrl: url });
    }
  }
  const dId = dpdfVolumeId(dataset);
  if (dId) {
    const sections = await Promise.all(DPDF_SECTIONS.map(([plane]) => safe(fetchDpdfSlice(dId, plane, 0))));
    const have = sections.filter((s): s is Slice => s != null);
    if (have.length) {
      const levels = autoLevels(have.map(withoutOrigin), { signed: true, percentile: DPDF_AUTO_PERCENTILE });
      sections.forEach((slice, i) => {
        if (!slice) return;
        const url = pngDataUrl(
          rasterize(slice, { n: FIGURE_PX, half: Math.min(DPDF_HALF, fullHalf(slice)), colormap: "RdBu_r", scale: "lin", levels, diverging: true }),
          FIGURE_PX,
        );
        if (url) {
          out.push({
            title: `3D-ΔPDF, ${DPDF_SECTIONS[i][1]}`,
            caption: `±${levels.hi.toPrecision(3)} (the 99.9th percentile of |ΔPDF|, origin left out); ±${Math.min(DPDF_HALF, fullHalf(slice))} Å, axes at their real angle.`,
            dataUrl: url,
          });
        }
      });
    }
  }
  return out;
}

function tuningRecord(turn: ChatTurn): ReportTuningStage[] | null {
  if (!turn.steps?.some((s) => s.name === "tune_pipeline")) return null;
  const { stages } = useTuneStore.getState();
  if (!stages.length) return null;
  return stages.map((st) => ({
    stage: st.stage,
    why: st.why ?? "",
    trials: st.trials.map((t) => ({
      n: t.n,
      changes: Object.keys(t.changes).length ? Object.entries(t.changes).map(([k, v]) => `${k}=${v}`).join(", ") : "your settings",
      headline: t.status === "done" ? headline(st.stage, t.evaluation) : t.status === "error" ? `failed: ${t.error ?? ""}` : t.status,
      chosen: st.best === t.n,
    })),
  }));
}

export interface ReportRequest {
  dataset: Dataset;
  datasets: Dataset[];
  turn: ChatTurn;
  question: string;
  llm: LlmSettings;
}

export async function collectReport({ dataset, datasets, turn, question, llm }: ReportRequest): Promise<Report> {
  const ctx: ToolContext = { dataset, datasets };
  const [measured, figs] = await Promise.all([measure(ctx), figures(dataset)]);
  const s = usePipelineStore.getState();
  const settings = TUNE_STAGES.map((stage) => ({ stage, values: currentStageSettings(stage, s) }));
  const sampleFacts: Record<string, ParamValue> = Object.fromEntries(SAMPLE_PARAMS.map((p) => [p.key, displayValue(p, s[p.key as keyof typeof s])]));
  // The facts outside the tuning catalog: the ΔPDF's |Q| band and the flatten's magnetic ion.
  sampleFacts["|Q| band"] = s.pdfQMax ? `${s.pdfQMin || "0"} … ${s.pdfQMax} Å⁻¹` : "full (none set)";
  sampleFacts.flattenIon = s.flattenIon || "none";
  const preset = providerForUrl(llm.baseUrl);
  return buildReport({
    created: new Date(),
    question,
    answer: turn.content,
    steps: (turn.steps ?? []).map((st) => ({ tool: st.name, summary: st.summary ?? "", ok: st.status !== "error" })),
    model: { provider: preset?.label ?? (isLocalUrl(llm.baseUrl) ? "Local server" : "Custom provider"), model: llm.model, local: isLocalUrl(llm.baseUrl) },
    dataset: { label: datasetLabel(dataset, datasets), rawName: dataset.raw_name, temperature: dataset.temperature },
    settings,
    sampleFacts,
    tuning: tuningRecord(turn),
    measured,
    figures: figs,
    goals: { ...STAGE_GOALS },
  });
}
