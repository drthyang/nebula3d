// A small CIF reader: just what the structure overlay needs from a crystal
// structure file — the cell, the asymmetric-unit sites and the symmetry
// operations.  It reads CIF 1.1 syntax (quoted values, ;-delimited text
// fields, loops, several data blocks) and the dotted CIF 2 / mmCIF tag
// spelling (_atom_site.fract_x), and takes the first block that lists sites.

export interface Cell {
  a: number;
  b: number;
  c: number;
  alpha: number;
  beta: number;
  gamma: number;
}

export interface Site {
  label: string;
  element: string;
  x: number;
  y: number;
  z: number;
  occ: number;
}

export interface CifStructure {
  name: string;
  cell: Cell | null;
  sites: Site[];
  ops: string[]; // as written, e.g. "-x+1/2, y, z"
  spaceGroup: string | null;
  warnings: string[];
}

interface Loop {
  tags: string[];
  rows: string[][];
}

interface Block {
  name: string;
  items: Map<string, string>;
  loops: Loop[];
}

/** Split CIF text into tokens; a ;-text field is one token. */
export function tokenize(text: string): string[] {
  const out: string[] = [];
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith(";")) {
      const field = [line.slice(1)];
      while (++i < lines.length && !lines[i].startsWith(";")) field.push(lines[i]);
      out.push(field.join("\n").trim());
      continue;
    }
    let j = 0;
    while (j < line.length) {
      const ch = line[j];
      if (ch === " " || ch === "\t") {
        j++;
      } else if (ch === "#") {
        break;
      } else if (ch === "'" || ch === '"') {
        // A quote closes only when followed by whitespace or the line's end.
        let k = j + 1;
        while (k < line.length && !(line[k] === ch && (k + 1 === line.length || /\s/.test(line[k + 1])))) k++;
        out.push(line.slice(j + 1, k));
        j = k + 1;
      } else {
        let k = j;
        while (k < line.length && !/\s/.test(line[k])) k++;
        out.push(line.slice(j, k));
        j = k;
      }
    }
  }
  return out;
}

const isTag = (t: string) => t.startsWith("_");
const isKeyword = (t: string) => /^(data_|loop_$|save_|global_$|stop_$)/i.test(t);

/** "_atom_site.fract_x" and "_atom_site_fract_x" → "_atom_site_fract_x". */
const normTag = (t: string) => t.toLowerCase().replace(/\./g, "_");

function parseBlocks(tokens: string[]): Block[] {
  const blocks: Block[] = [];
  let cur: Block | null = null;
  let i = 0;
  const block = () => {
    if (!cur) {
      cur = { name: "", items: new Map(), loops: [] };
      blocks.push(cur);
    }
    return cur;
  };
  while (i < tokens.length) {
    const t = tokens[i];
    if (/^data_/i.test(t)) {
      cur = { name: t.slice(5), items: new Map(), loops: [] };
      blocks.push(cur);
      i++;
    } else if (/^loop_$/i.test(t)) {
      i++;
      const tags: string[] = [];
      while (i < tokens.length && isTag(tokens[i])) tags.push(normTag(tokens[i++]));
      const values: string[] = [];
      while (i < tokens.length && !isTag(tokens[i]) && !isKeyword(tokens[i])) values.push(tokens[i++]);
      const rows: string[][] = [];
      if (tags.length) for (let r = 0; r + tags.length <= values.length; r += tags.length) rows.push(values.slice(r, r + tags.length));
      block().loops.push({ tags, rows });
    } else if (isTag(t)) {
      const v = i + 1 < tokens.length && !isTag(tokens[i + 1]) && !isKeyword(tokens[i + 1]) ? tokens[i + 1] : "";
      block().items.set(normTag(t), v);
      i += v === "" ? 1 : 2;
    } else {
      i++; // save_ frames and stray values: not needed here
    }
  }
  return blocks;
}

/** A CIF number without its standard uncertainty, "0.1234(5)" → 0.1234; null for "?" / ".". */
export function cifNumber(v: string | undefined): number | null {
  if (v === undefined) return null;
  const s = v.replace(/\(\d+\)$/, "");
  if (s === "" || s === "?" || s === ".") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** The element in a type symbol or label: "Cu2+" → "Cu", "O2-" → "O", "Sn1a" → "Sn". */
export function elementOf(symbol: string): string {
  const m = /^([A-Z][a-z]?)/.exec(symbol.trim());
  if (m) return m[1];
  const lower = /^([a-z])([a-z])?/.exec(symbol.trim());
  return lower ? lower[1].toUpperCase() + (lower[2] ?? "") : symbol.trim();
}

function findLoop(b: Block, tag: string): Loop | undefined {
  return b.loops.find((l) => l.tags.includes(tag));
}

function column(loop: Loop, ...tags: string[]): number {
  for (const t of tags) {
    const i = loop.tags.indexOf(t);
    if (i >= 0) return i;
  }
  return -1;
}

const OP_TAGS = ["_space_group_symop_operation_xyz", "_symmetry_equiv_pos_as_xyz"];
const SG_TAGS = ["_space_group_name_h-m_alt", "_symmetry_space_group_name_h-m", "_space_group_name_hall"];

/** Read the first data block that lists atom sites with fractional coordinates. */
export function parseCif(text: string): CifStructure {
  const blocks = parseBlocks(tokenize(text));
  const b = blocks.find((blk) => findLoop(blk, "_atom_site_fract_x"));
  if (!b) throw new Error("no atom sites with fractional coordinates (_atom_site_fract_x) in this CIF");
  const warnings: string[] = [];

  const cellVals = ["a", "b", "c"].map((k) => cifNumber(b.items.get(`_cell_length_${k}`)));
  const angVals = ["alpha", "beta", "gamma"].map((k) => cifNumber(b.items.get(`_cell_angle_${k}`)) ?? 90);
  const cell: Cell | null = cellVals.every((v) => v !== null && v > 0)
    ? { a: cellVals[0]!, b: cellVals[1]!, c: cellVals[2]!, alpha: angVals[0], beta: angVals[1], gamma: angVals[2] }
    : null;
  if (!cell) warnings.push("the CIF gives no complete cell; the overlay uses the ΔPDF's own cell");

  const loop = findLoop(b, "_atom_site_fract_x")!;
  const iLabel = column(loop, "_atom_site_label");
  const iType = column(loop, "_atom_site_type_symbol");
  const iX = column(loop, "_atom_site_fract_x");
  const iY = column(loop, "_atom_site_fract_y");
  const iZ = column(loop, "_atom_site_fract_z");
  const iOcc = column(loop, "_atom_site_occupancy");
  const iFlag = column(loop, "_atom_site_calc_flag");
  const sites: Site[] = [];
  loop.rows.forEach((row, n) => {
    if (iFlag >= 0 && row[iFlag].toLowerCase() === "dum") return; // dummy atoms
    const [x, y, z] = [iX, iY, iZ].map((i) => (i >= 0 ? cifNumber(row[i]) : null));
    const label = iLabel >= 0 ? row[iLabel] : `${iType >= 0 ? elementOf(row[iType]) : "X"}${n + 1}`;
    if (x === null || y === null || z === null) {
      warnings.push(`site ${label} has no complete position and was skipped`);
      return;
    }
    sites.push({
      label,
      element: elementOf(iType >= 0 && row[iType] !== "?" ? row[iType] : label),
      x,
      y,
      z,
      occ: (iOcc >= 0 ? cifNumber(row[iOcc]) : null) ?? 1,
    });
  });

  let ops: string[] = [];
  for (const tag of OP_TAGS) {
    const opLoop = findLoop(b, tag);
    if (opLoop) {
      ops = opLoop.rows.map((r) => r[opLoop.tags.indexOf(tag)]);
      break;
    }
    const single = b.items.get(tag);
    if (single) {
      ops = [single];
      break;
    }
  }
  const sgTag = SG_TAGS.find((t) => b.items.get(t));
  const spaceGroup = sgTag ? b.items.get(sgTag)!.trim() : null;
  if (!ops.length && spaceGroup && !/^P\s*1$/i.test(spaceGroup)) {
    warnings.push(
      `the CIF names space group ${spaceGroup} but lists no symmetry operations — paste them under Symmetry`,
    );
  }

  return { name: b.name, cell, sites, ops, spaceGroup, warnings };
}
