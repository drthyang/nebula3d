// A small, dependency-free Markdown parser tuned for LLM chat output: headings,
// bold/italic, inline code + fenced code, ordered/unordered lists, GFM pipe
// tables, blockquotes, horizontal rules, and links.  It parses to a plain token
// tree (no React) so it is pure and unit-testable; Markdown.tsx renders the tree
// to React elements (never to raw HTML, so there is no XSS surface).  Greek and
// other Unicode pass through untouched as plain text.

import { tidyNumbers } from "./numberText";

export type Inline =
  | { type: "text"; value: string }
  | { type: "strong"; children: Inline[] }
  | { type: "em"; children: Inline[] }
  | { type: "code"; value: string }
  | { type: "link"; href: string; children: Inline[] };

// Common TeX symbol commands → Unicode, so models that write Greek/math as LaTeX
// (e.g. `$\sigma$`, `\Delta`, `\times`) render as real glyphs in prose. Inline
// code is left untouched (deLatex is applied only to text nodes when rendering).
const TEX_SYMBOLS: Record<string, string> = {
  alpha: "α", beta: "β", gamma: "γ", delta: "δ", epsilon: "ε", varepsilon: "ε",
  zeta: "ζ", eta: "η", theta: "θ", vartheta: "ϑ", iota: "ι", kappa: "κ",
  lambda: "λ", mu: "μ", nu: "ν", xi: "ξ", pi: "π", rho: "ρ", sigma: "σ",
  tau: "τ", upsilon: "υ", phi: "φ", varphi: "φ", chi: "χ", psi: "ψ", omega: "ω",
  Gamma: "Γ", Delta: "Δ", Theta: "Θ", Lambda: "Λ", Xi: "Ξ", Pi: "Π",
  Sigma: "Σ", Upsilon: "Υ", Phi: "Φ", Psi: "Ψ", Omega: "Ω",
  times: "×", cdot: "·", div: "÷", pm: "±", mp: "∓", approx: "≈", sim: "∼",
  simeq: "≃", propto: "∝", neq: "≠", leq: "≤", le: "≤", geq: "≥", ge: "≥",
  ll: "≪", gg: "≫", to: "→", rightarrow: "→", leftarrow: "←", Rightarrow: "⇒",
  infty: "∞", partial: "∂", nabla: "∇", angstrom: "Å", AA: "Å", degree: "°",
  circ: "∘", cdots: "⋯", ldots: "…", hbar: "ℏ", ell: "ℓ",
  lesssim: "≲", gtrsim: "≳", lessapprox: "⪅", gtrapprox: "⪆", leqslant: "⩽",
  geqslant: "⩾", equiv: "≡", cong: "≅", perp: "⊥", parallel: "∥", langle: "⟨",
  rangle: "⟩",
};

// Match \command where the name ends at a non-letter (so `\sigma_{bg}` works —
// `\b` would fail there because `_` is a word character) or at a capital: models
// write `\DeltaPDF` for ΔPDF, which TeX itself would read as one unknown command.
const TEX_RE = new RegExp(`\\\\(${Object.keys(TEX_SYMBOLS).join("|")})(?![a-z])`, "g");

// Formatting wrappers whose braced content should survive as plain text.
const TEX_WRAP_RE = /\\(?:text|mathrm|mathbf|mathit|mathsf|mathcal|mathtt|operatorname|boldsymbol|textbf|textit)\{([^{}]*)\}/g;

export function deLatex(s: string): string {
  if (s.indexOf("\\") === -1 && s.indexOf("$") === -1) return s;
  return s
    // Unwrap \text{...} and friends first so their content is processed below.
    .replace(TEX_WRAP_RE, "$1")
    .replace(TEX_RE, (_m, name: string) => TEX_SYMBOLS[name])
    // Strip inline/inline-display math delimiters once the symbols are Unicode.
    .replace(/\$\$?/g, "")
    .replace(/\\[()[\]]/g, "")
    // LaTeX spacing macros (and a control space, `10\ Å`) → a normal space.
    .replace(/\\[,;:! ]/g, " ")
    // An escaped percent sign is a percent sign.
    .replace(/\\%/g, "%")
    // Simple sub/superscript braces: \sigma_{bg} → σ_bg, x^{2} → x^2.
    .replace(/([_^])\{([^{}]*)\}/g, "$1$2");
}

export type Align = "left" | "center" | "right" | null;

export type Block =
  | { type: "heading"; level: number; inline: Inline[] }
  | { type: "paragraph"; inline: Inline[] }
  | { type: "code"; lang: string | null; value: string }
  // `start`: an ordered list's first number ("4." after a break in the list
  // goes on at 4, not 1); `nested`: each item's sub-list, indented under it.
  | { type: "list"; ordered: boolean; start?: number; items: Inline[][]; nested?: (Block | null)[] }
  | { type: "table"; header: Inline[][]; align: Align[]; rows: Inline[][][] }
  | { type: "blockquote"; inline: Inline[] }
  | { type: "hr" };

// Earliest of: `code`, **strong**, __strong__, *em*, _em_, [text](href).  As in
// CommonMark, a delimiter must touch its text (`5 * 3 * 2` is not emphasis), and
// an underscore inside a word is a literal: models write field names such as
// ring_energy_ratio without backticks, and those must not turn into italics.
const INLINE_SOURCE =
  /(`[^`]+`)|(\*\*(?=\S)[\s\S]*?\S\*\*)|(__(?=\S)[\s\S]*?\S__(?!_*[\p{L}\p{N}]))|(\*(?=[^\s*])[\s\S]*?[^\s*]\*)|(_(?=[^\s_])[\s\S]*?[^\s_]_(?!_*[\p{L}\p{N}]))|(\[[^\]]+\]\([^)]+\))/u
    .source;
const WORD_CHAR = /[\p{L}\p{N}]/u;

// Whether the underscore run holding text[at] follows a letter or digit.
const opensInWord = (text: string, at: number): boolean => {
  let i = at - 1;
  while (i >= 0 && text[i] === "_") i -= 1;
  return i >= 0 && WORD_CHAR.test(text[i]);
};

export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  // A regex of its own per call: parseInline recurses, and a global regex
  // would share its lastIndex between the levels.
  const re = new RegExp(INLINE_SOURCE, "gu");
  let pos = 0; // the start of the text not yet emitted
  for (;;) {
    const m = re.exec(text);
    if (!m) {
      if (pos < text.length) out.push({ type: "text", value: tidyNumbers(text.slice(pos)) });
      break;
    }
    // An underscore run that opens inside a word is a literal: search again
    // after it, and let the text around it run on.
    if ((m[3] || m[5]) && opensInWord(text, m.index)) {
      re.lastIndex = m.index + 1;
      continue;
    }
    // Float noise a model copied (0.000003141592653589793) is shown rounded;
    // code spans keep what was written.
    if (m.index > pos) out.push({ type: "text", value: tidyNumbers(text.slice(pos, m.index)) });
    const tok = m[0];
    if (m[1]) {
      out.push({ type: "code", value: tok.slice(1, -1) });
    } else if (m[2] || m[3]) {
      out.push({ type: "strong", children: parseInline(tok.slice(2, -2)) });
    } else if (m[4] || m[5]) {
      out.push({ type: "em", children: parseInline(tok.slice(1, -1)) });
    } else {
      const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(tok);
      if (link) out.push({ type: "link", href: link[2], children: parseInline(link[1]) });
      else out.push({ type: "text", value: tok });
    }
    pos = m.index + tok.length;
  }
  return out;
}

const splitRow = (line: string): string[] => {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return trimmed.split("|").map((c) => c.trim());
};

const isTableSeparator = (line: string): boolean =>
  /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)+\|?\s*$/.test(line);

const alignOf = (cell: string): Align => {
  const l = cell.startsWith(":");
  const r = cell.endsWith(":");
  if (l && r) return "center";
  if (r) return "right";
  if (l) return "left";
  return null;
};

const LIST_ITEM = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
const indentOf = (line: string): number => /^\s*/.exec(line)![0].replace(/\t/g, "    ").length;

/**
 * The list that starts at line `i`: its items at its own indent, one kind
 * (ordered or not); an item's continuation lines (indented, no marker) join
 * it; a list indented under an item is that item's sub-list; a blank line
 * between items keeps the list going. An ordered list keeps its first number
 * (`start`), so a list a model broke with a sub-list it did not indent goes
 * on at its number.
 */
function parseList(lines: readonly string[], i: number): { block: Block & { type: "list" }; next: number } {
  const first = LIST_ITEM.exec(lines[i])!;
  const indent = indentOf(first[1]);
  const ordered = /\d/.test(first[2]);
  const texts: string[] = [];
  const nested: (Block | null)[] = [];
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      let j = i + 1;
      while (j < lines.length && !lines[j].trim()) j += 1;
      const after = j < lines.length ? LIST_ITEM.exec(lines[j]) : null;
      // Goes on: an item of this list, or one of a sub-list under its last item.
      if (after && texts.length && (indentOf(after[1]) > indent || (indentOf(after[1]) === indent && /\d/.test(after[2]) === ordered))) {
        i = j;
        continue;
      }
      break;
    }
    const m = LIST_ITEM.exec(line);
    const at = indentOf(line);
    if (m && at === indent) {
      if (/\d/.test(m[2]) !== ordered) break;
      texts.push(m[3]);
      nested.push(null);
      i += 1;
    } else if (m && at > indent && texts.length) {
      const sub = parseList(lines, i);
      nested[nested.length - 1] = sub.block;
      i = sub.next;
    } else if (!m && at > indent && texts.length && !nested[nested.length - 1]) {
      texts[texts.length - 1] += ` ${line.trim()}`;
      i += 1;
    } else break;
  }
  const start = ordered ? Number(/\d+/.exec(first[2])![0]) : undefined;
  return {
    block: {
      type: "list",
      ordered,
      ...(start !== undefined && start !== 1 ? { start } : {}),
      items: texts.map(parseInline),
      ...(nested.some(Boolean) ? { nested } : {}),
    },
    next: i,
  };
}

export function parseBlocks(md: string): Block[] {
  const lines = (md ?? "").replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) {
      i += 1;
      continue;
    }

    // Fenced code block.
    const fence = /^```(.*)$/.exec(line);
    if (fence) {
      const lang = fence[1].trim() || null;
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !/^```/.test(lines[i])) {
        body.push(lines[i]);
        i += 1;
      }
      i += 1; // consume closing fence
      blocks.push({ type: "code", lang, value: body.join("\n") });
      continue;
    }

    // Heading.
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      blocks.push({ type: "heading", level: heading[1].length, inline: parseInline(heading[2].trim()) });
      i += 1;
      continue;
    }

    // Horizontal rule.
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      blocks.push({ type: "hr" });
      i += 1;
      continue;
    }

    // GFM table: a header row followed by a separator row.
    if (line.includes("|") && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
      const header = splitRow(line).map((c) => parseInline(c));
      const align = splitRow(lines[i + 1]).map(alignOf);
      i += 2;
      const rows: Inline[][][] = [];
      while (i < lines.length && lines[i].includes("|") && lines[i].trim()) {
        rows.push(splitRow(lines[i]).map((c) => parseInline(c)));
        i += 1;
      }
      blocks.push({ type: "table", header, align, rows });
      continue;
    }

    // Blockquote (consecutive `>` lines).
    if (/^\s*>/.test(line)) {
      const quote: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) {
        quote.push(lines[i].replace(/^\s*>\s?/, ""));
        i += 1;
      }
      blocks.push({ type: "blockquote", inline: parseInline(quote.join(" ")) });
      continue;
    }

    // List (consecutive item lines of the same kind, a sub-list indented under an item).
    if (LIST_ITEM.test(line)) {
      const { block, next } = parseList(lines, i);
      blocks.push(block);
      i = next;
      continue;
    }

    // Paragraph: gather until a blank line or a block-starting line.
    const para: string[] = [];
    while (i < lines.length && lines[i].trim()) {
      const l = lines[i];
      if (
        /^(#{1,6})\s+/.test(l) ||
        /^```/.test(l) ||
        /^\s*>/.test(l) ||
        /^\s*([-*+]|\d+[.)])\s+/.test(l) ||
        (l.includes("|") && i + 1 < lines.length && isTableSeparator(lines[i + 1]))
      ) {
        break;
      }
      para.push(l);
      i += 1;
    }
    blocks.push({ type: "paragraph", inline: parseInline(para.join(" ")) });
  }

  return blocks;
}
