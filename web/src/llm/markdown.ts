// A small, dependency-free Markdown parser tuned for LLM chat output: headings,
// bold/italic, inline code + fenced code, ordered/unordered lists, GFM pipe
// tables, blockquotes, horizontal rules, and links.  It parses to a plain token
// tree (no React) so it is pure and unit-testable; Markdown.tsx renders the tree
// to React elements (never to raw HTML, so there is no XSS surface).  Greek and
// other Unicode pass through untouched as plain text.

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
};

// Match \command where the name ends at a non-letter (so `\sigma_{bg}` works —
// `\b` would fail there because `_` is a word character).
const TEX_RE = new RegExp(`\\\\(${Object.keys(TEX_SYMBOLS).join("|")})(?![A-Za-z])`, "g");

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
    // LaTeX spacing macros → a normal (or no) space.
    .replace(/\\[,;:!]/g, " ")
    // Simple sub/superscript braces: \sigma_{bg} → σ_bg, x^{2} → x^2.
    .replace(/([_^])\{([^{}]*)\}/g, "$1$2");
}

export type Align = "left" | "center" | "right" | null;

export type Block =
  | { type: "heading"; level: number; inline: Inline[] }
  | { type: "paragraph"; inline: Inline[] }
  | { type: "code"; lang: string | null; value: string }
  | { type: "list"; ordered: boolean; items: Inline[][] }
  | { type: "table"; header: Inline[][]; align: Align[]; rows: Inline[][][] }
  | { type: "blockquote"; inline: Inline[] }
  | { type: "hr" };

// Earliest of: `code`, **strong**, __strong__, *em*, _em_, [text](href).
const INLINE_RE =
  /(`[^`]+`)|(\*\*[\s\S]+?\*\*)|(__[\s\S]+?__)|(\*[\s\S]+?\*)|(_[\s\S]+?_)|(\[[^\]]+\]\([^)]+\))/;

export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  let rest = text;
  for (;;) {
    const m = INLINE_RE.exec(rest);
    if (!m) {
      if (rest) out.push({ type: "text", value: rest });
      break;
    }
    if (m.index > 0) out.push({ type: "text", value: rest.slice(0, m.index) });
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
    rest = rest.slice(m.index + tok.length);
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

    // List (consecutive item lines of the same kind).
    const listItem = /^\s*([-*+]|\d+[.)])\s+(.*)$/.exec(line);
    if (listItem) {
      const ordered = /\d/.test(listItem[1]);
      const items: Inline[][] = [];
      while (i < lines.length) {
        const m = /^\s*([-*+]|\d+[.)])\s+(.*)$/.exec(lines[i]);
        if (!m) break;
        if (/\d/.test(m[1]) !== ordered) break;
        items.push(parseInline(m[2]));
        i += 1;
      }
      blocks.push({ type: "list", ordered, items });
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
