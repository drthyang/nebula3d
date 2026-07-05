import { describe, expect, it } from "vitest";

import { deLatex, parseBlocks, parseInline } from "../markdown";

describe("deLatex", () => {
  it("converts LaTeX Greek/math to Unicode and strips $ delimiters", () => {
    expect(deLatex("$\\Delta$PDF shows 156 $\\sigma$")).toBe("ΔPDF shows 156 σ");
    expect(deLatex("width \\approx 0.04 \\times 10")).toBe("width ≈ 0.04 × 10");
    expect(deLatex("\\sigma_{bg}")).toBe("σ_bg");
    expect(deLatex("\\text{SNR} = 156")).toBe("SNR = 156");
  });
  it("leaves plain text unchanged", () => {
    expect(deLatex("no math here")).toBe("no math here");
  });
});

describe("parseInline", () => {
  it("parses bold, italic, and inline code with Greek text intact", () => {
    const nodes = parseInline("The **σ** is *high* per `feature_snr` (Δ)");
    expect(nodes).toEqual([
      { type: "text", value: "The " },
      { type: "strong", children: [{ type: "text", value: "σ" }] },
      { type: "text", value: " is " },
      { type: "em", children: [{ type: "text", value: "high" }] },
      { type: "text", value: " per " },
      { type: "code", value: "feature_snr" },
      { type: "text", value: " (Δ)" },
    ]);
  });

  it("parses links and nested emphasis", () => {
    const nodes = parseInline("see [the **docs**](https://x.io)");
    expect(nodes[0]).toEqual({ type: "text", value: "see " });
    expect(nodes[1]).toMatchObject({ type: "link", href: "https://x.io" });
    const link = nodes[1] as { children: unknown[] };
    expect(link.children).toContainEqual({ type: "strong", children: [{ type: "text", value: "docs" }] });
  });

  it("leaves plain text (with underscores in code) untouched", () => {
    expect(parseInline("plain text")).toEqual([{ type: "text", value: "plain text" }]);
  });
});

describe("parseBlocks", () => {
  it("parses headings, paragraphs and lists", () => {
    const blocks = parseBlocks("# Title\n\nHello world\n\n- one\n- two");
    expect(blocks[0]).toMatchObject({ type: "heading", level: 1 });
    expect(blocks[1]).toMatchObject({ type: "paragraph" });
    expect(blocks[2]).toMatchObject({ type: "list", ordered: false });
    expect((blocks[2] as { items: unknown[] }).items).toHaveLength(2);
  });

  it("parses an ordered list", () => {
    const blocks = parseBlocks("1. first\n2. second\n3. third");
    expect(blocks[0]).toMatchObject({ type: "list", ordered: true });
    expect((blocks[0] as { items: unknown[] }).items).toHaveLength(3);
  });

  it("parses a GFM table with alignment", () => {
    const md = "| Metric | Value |\n| :--- | ---: |\n| SNR | 156 |\n| σ | 532 |";
    const blocks = parseBlocks(md);
    expect(blocks).toHaveLength(1);
    const table = blocks[0] as { type: string; header: unknown[]; rows: unknown[]; align: string[] };
    expect(table.type).toBe("table");
    expect(table.header).toHaveLength(2);
    expect(table.rows).toHaveLength(2);
    expect(table.align).toEqual(["left", "right"]);
  });

  it("parses fenced code blocks verbatim", () => {
    const blocks = parseBlocks("```py\nx = 1\n**not bold**\n```");
    expect(blocks[0]).toEqual({ type: "code", lang: "py", value: "x = 1\n**not bold**" });
  });

  it("parses horizontal rules and blockquotes", () => {
    const blocks = parseBlocks("> a quote\n\n---");
    expect(blocks[0]).toMatchObject({ type: "blockquote" });
    expect(blocks[1]).toEqual({ type: "hr" });
  });
});
