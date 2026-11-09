// The report's digest names the checks the chat ran before the run
// (auto/controller.ts, checksBeforeRun; auto/prompts.ts, digest): an auto reply
// has no chat history, and the run's report said the Laue comparison the
// pre-run had made "was not run". Synthetic only.

import { beforeEach, describe, expect, it } from "vitest";

import type { AgentStep } from "../agent";
import { checksBeforeRun } from "../auto/controller";
import { freshPlan } from "../auto/plan";
import { digest } from "../auto/prompts";
import { useChatStore, type ChatTurn } from "../chatStore";

const step = (name: string, status: AgentStep["status"] = "done"): AgentStep => ({ id: `${name}-${status}`, name, args: {}, status, result: "{}" });
const turn = (id: number, steps: AgentStep[]): ChatTurn => ({ id, role: "assistant", content: "", steps });

beforeEach(() => useChatStore.setState({ turns: [], busy: false }));

describe("the checks the chat ran before the run", () => {
  it("are named by their labels, once each: not the pre-run tools, not what the report runs again, not the run's own", () => {
    useChatStore.setState({
      turns: [
        turn(2, [step("ring_survey"), step("bragg_sense"), step("compare_laue_classes"), step("ub_check"), step("read_skill"), step("compare_laue_classes")]),
        turn(4, [step("grain_check", "error")]),
        turn(6, [step("texture_check")]), // the run's own reply
      ],
    });
    expect(checksBeforeRun([6], [{ name: "ub_check" }])).toEqual(["Compared the Laue classes by R_int"]);
    expect(checksBeforeRun([2, 4, 6], [])).toEqual([]);
  });

  it("make one line of the report's digest, and none when there are none", () => {
    const base = { plan: freshPlan(), fixesPerStage: 2, limit: null, decisions: [], proposals: [] };
    expect(digest({ ...base, chatChecks: ["Compared the Laue classes by R_int"] })).toContain("\n- the chat before this run: Compared the Laue classes by R_int");
    expect(digest(base)).not.toContain("the chat before this run");
  });
});
