// Where an auto run's own steps stand in the chat (THY-65 PR 7). The app's
// checks and runs (controller.ts, appStep) are no reply's, so the transcript
// shows them as blocks of their own, tagged auto: the steps before each of the
// run's replies just above that reply's opening line, and those after its last
// reply below it. A check seeded into the reply that follows it shows there,
// once, as that reply's first step. Every step of the run then has one place
// in the chat, which the Auto panel's rows, the "Now examining" bar and the
// cards' evidence link to. Pure: the run's record and the turns in, places out.

import type { AgentStep } from "../agent";
import type { ChatTurn } from "../chatStore";
import { stepKey } from "../examine/overlays";
import type { AutoRun } from "./store";

/** A step the app made itself in an auto run (not a reply's). */
export const isAppStep = (s: Pick<AgentStep, "id">): boolean => s.id.startsWith("auto:");

/** A step an auto run seeded into a reply (tools/round.ts, seedRound). */
export const isSeeded = (s: Pick<AgentStep, "id">): boolean => /:seed_\d+$/.test(s.id);

/** A block of the app's own steps, shown before the turn `before`, or (null) after the turn `after` (null: at the end). */
export interface AutoBlock {
  key: string;
  before: number | null;
  after: number | null;
  steps: AgentStep[];
}

/** A step's place in the chat: in the app's blocks (turn null), or in a reply's turn under that turn's own id for it. */
export interface StepPlace {
  turn: number | null;
  stepId: string;
}

export interface AutoTranscript {
  blocks: AutoBlock[];
  where: Map<string, StepPlace>;
}

/** The DOM id of a step's row in the chat, wherever it is. */
export const stepElementId = (p: StepPlace): string => (p.turn === null ? `ai-step-auto-${p.stepId}` : `ai-step-${p.turn}-${p.stepId}`);

/** The app's steps of `run` placed among `turns`, and each step's place. */
export function autoTranscript(run: Pick<AutoRun, "id" | "steps" | "turns" | "turnAt">, turns: readonly ChatTurn[]): AutoTranscript {
  const blocks: AutoBlock[] = [];
  const where = new Map<string, StepPlace>();
  const placed = run.turns.length === run.turnAt.length;
  let from = 0;
  let lastTurn: number | null = null;
  let carry: AgentStep[] = []; // steps whose reply is not in the chat (cleared): they go on to the next block
  if (placed) {
    run.turns.forEach((turnId, k) => {
      const to = Math.max(from, Math.min(run.turnAt[k], run.steps.length));
      const mine = [...carry, ...run.steps.slice(from, to).filter(isAppStep)];
      from = to;
      const i = turns.findIndex((t) => t.id === turnId);
      if (i < 0) {
        carry = mine;
        return;
      }
      carry = [];
      lastTurn = turnId;
      // A check seeded into this reply shows there, as its first steps.
      const seeded = new Map((turns[i].steps ?? []).filter(isSeeded).map((s) => [stepKey(s), s.id]));
      const own: AgentStep[] = [];
      for (const s of mine) {
        const there = seeded.get(stepKey(s));
        if (there) where.set(s.id, { turn: turnId, stepId: there });
        else own.push(s);
      }
      if (!own.length) return;
      const before = turns[i - 1]?.role === "user" ? turns[i - 1].id : turnId;
      blocks.push({ key: `${run.id}:${k}`, before, after: null, steps: own });
    });
  }
  const rest = [...carry, ...run.steps.slice(placed ? from : 0).filter(isAppStep)];
  if (rest.length) blocks.push({ key: `${run.id}:end`, before: null, after: lastTurn, steps: rest });
  for (const b of blocks) for (const s of b.steps) where.set(s.id, { turn: null, stepId: s.id });
  return { blocks, where };
}
