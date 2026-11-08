import { describe, expect, it } from "vitest";

import { composerPlaceholder } from "../composerText";

const base = { connected: true, assistant: true, contextLoading: false, autoRunning: false };

describe("the chat box's placeholder", () => {
  it("asks for a question when it can take one", () => {
    expect(composerPlaceholder(base)).toBe("Ask about this reduction…");
  });
  it("asks to connect a model only when none is connected", () => {
    expect(composerPlaceholder({ ...base, connected: false, assistant: false })).toBe("Connect a model to chat…");
  });
  it("says the metrics are loading while a connected model waits for them (a run under way)", () => {
    expect(composerPlaceholder({ ...base, assistant: false, contextLoading: true })).toBe("Preparing metrics…");
  });
  it("asks for a processed dataset when there is none", () => {
    expect(composerPlaceholder({ ...base, assistant: false })).toBe("Select a processed dataset…");
  });
  it("says an auto run is going before anything else", () => {
    expect(composerPlaceholder({ ...base, autoRunning: true, connected: false })).toBe("Auto analysis is running…");
  });
});
