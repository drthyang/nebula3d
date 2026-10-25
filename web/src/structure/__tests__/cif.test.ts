import { describe, expect, it } from "vitest";

import { cifCentering, cifNumber, elementOf, parseCif, parseCoordinate, tokenize, type Cell } from "../cif";

// Rock salt, written the way structure databases write CIFs: uncertainties,
// quoted operations, a text field and an anisotropic loop to skip.
const NACL = `
# a comment line
data_NaCl
_chemical_formula_sum 'Cl Na'
_cell_length_a    5.6402(2)
_cell_length_b    5.6402(2)
_cell_length_c    5.6402(2)
_cell_angle_alpha 90
_cell_angle_beta  90.000(0)
_cell_angle_gamma 90
_symmetry_space_group_name_H-M 'F m -3 m'
_publ_section_title
;
 A multi-line text field
 with _tags_that_are_not_tags and 'quotes'
;
loop_
_space_group_symop_id
_space_group_symop_operation_xyz
1 'x, y, z'
2 '-x, -y, z'
3 "z, x, y"
loop_
_atom_site_label
_atom_site_type_symbol
_atom_site_fract_x
_atom_site_fract_y
_atom_site_fract_z
_atom_site_occupancy
Na1 Na1+ 0.0000 0.0000 0.0000 1.0
Cl1 Cl1- 0.5 0.5 0.5(0) 0.98(2)
loop_
_atom_site_aniso_label
_atom_site_aniso_U_11
Na1 0.01
Cl1 0.02
`;

describe("tokenize", () => {
  it("keeps quoted values and text fields as one token", () => {
    const t = tokenize("_a 'x, y, z'\n;\nline one\nline two\n;\n_b \"it's\" # note");
    expect(t).toEqual(["_a", "x, y, z", "line one\nline two", "_b", "it's"]);
  });
});

describe("parseCif", () => {
  const s = parseCif(NACL);

  it("reads the block name, cell and space group", () => {
    expect(s.name).toBe("NaCl");
    expect(s.cell).toEqual({ a: 5.6402, b: 5.6402, c: 5.6402, alpha: 90, beta: 90, gamma: 90 });
    expect(s.spaceGroup).toBe("F m -3 m");
  });

  it("reads the sites with elements from the type symbols", () => {
    expect(s.sites).toEqual([
      { label: "Na1", element: "Na", x: 0, y: 0, z: 0, occ: 1 },
      { label: "Cl1", element: "Cl", x: 0.5, y: 0.5, z: 0.5, occ: 0.98 },
    ]);
  });

  it("reads the operations from the operation column", () => {
    expect(s.ops).toEqual(["x, y, z", "-x, -y, z", "z, x, y"]);
    expect(s.warnings).toEqual([]);
  });

  it("reads dotted CIF 2 tags and older symmetry tags", () => {
    const t = parseCif(`data_x
_cell.length_a 4
_cell.length_b 4
_cell.length_c 6
_cell.angle_gamma 120
loop_
_symmetry_equiv_pos_as_xyz
x,y,z
-y,x-y,z
loop_
_atom_site.label
_atom_site.fract_x
_atom_site.fract_y
_atom_site.fract_z
Zn1 0.3333 0.6667 0.25
`);
    expect(t.cell).toEqual({ a: 4, b: 4, c: 6, alpha: 90, beta: 90, gamma: 120 });
    expect(t.ops).toEqual(["x,y,z", "-y,x-y,z"]);
    expect(t.sites[0].element).toBe("Zn");
  });

  it("warns when a space group is named but no operations are listed", () => {
    const t = parseCif(`data_y
_cell_length_a 3
_cell_length_b 3
_cell_length_c 3
_space_group_name_H-M_alt 'P m -3 m'
loop_
_atom_site_label
_atom_site_fract_x
_atom_site_fract_y
_atom_site_fract_z
Cs1 0 0 0
`);
    expect(t.ops).toEqual([]);
    expect(t.warnings.join(" ")).toMatch(/P m -3 m.*no symmetry operations/);
  });

  it("fails clearly without atom sites", () => {
    expect(() => parseCif("data_z\n_cell_length_a 3\n")).toThrow(/no atom sites/);
  });
});

describe("helpers", () => {
  it("drops standard uncertainties and unknowns", () => {
    expect(cifNumber("0.1234(5)")).toBe(0.1234);
    expect(cifNumber("?")).toBeNull();
    expect(cifNumber(".")).toBeNull();
  });

  it("finds the element in type symbols and labels", () => {
    expect(elementOf("Cu2+")).toBe("Cu");
    expect(elementOf("O2-")).toBe("O");
    expect(elementOf("Sn1a")).toBe("Sn");
  });

  it("reads all-capitals type symbols as the two-letter element they name", () => {
    expect(["NA", "CL", "CO", "SI4+", "NB", "BA", "cl", "CL1-"].map(elementOf)).toEqual(["Na", "Cl", "Co", "Si", "Nb", "Ba", "Cl", "Cl"]);
  });

  it("falls back to one letter when two name no element (or only a superheavy one)", () => {
    expect(["Ow1", "OH-", "NO1", "NH3", "C1", "X", "D1"].map(elementOf)).toEqual(["O", "O", "N", "N", "C", "X", "D"]);
  });
});

describe("cifCentering", () => {
  const cubic: Cell = { a: 4, b: 4, c: 4, alpha: 90, beta: 90, gamma: 90 };
  const hex: Cell = { a: 4, b: 4, c: 9, alpha: 90, beta: 90, gamma: 120 };
  const rho: Cell = { a: 4, b: 4, c: 4, alpha: 60, beta: 60, gamma: 60 };
  it("takes the lattice letter of the Hermann–Mauguin or Hall symbol", () => {
    expect(cifCentering({ spaceGroup: "F m -3 m", cell: cubic })).toBe("F");
    expect(cifCentering({ spaceGroup: "Fm-3m", cell: cubic })).toBe("F");
    expect(cifCentering({ spaceGroup: "-F 4 2 3", cell: cubic })).toBe("F");
    expect(cifCentering({ spaceGroup: "I 4/m m m", cell: cubic })).toBe("I");
    expect(cifCentering({ spaceGroup: "C 1 2/m 1", cell: cubic })).toBe("C");
    expect(cifCentering({ spaceGroup: "P 63/m m c", cell: hex })).toBe("P");
    expect(cifCentering({ spaceGroup: null, cell: cubic })).toBe("P");
  });

  it("adds R only on hexagonal axes", () => {
    expect(cifCentering({ spaceGroup: "R -3 m", cell: hex })).toBe("R");
    expect(cifCentering({ spaceGroup: "R -3 m :H", cell: null })).toBe("R");
    expect(cifCentering({ spaceGroup: "R -3 m", cell: rho })).toBe("P");
    expect(cifCentering({ spaceGroup: "R -3 m :R", cell: hex })).toBe("P");
    expect(cifCentering({ spaceGroup: "R -3 m", cell: null })).toBe("P");
  });
});

describe("parseCoordinate (a site's coordinate as typed)", () => {
  it("reads decimals and signed fractions, the notation the symmetry operations take", () => {
    expect(parseCoordinate("0.25")).toBe(0.25);
    expect(parseCoordinate(" .5 ")).toBe(0.5);
    expect(parseCoordinate("-0.125")).toBe(-0.125);
    expect(parseCoordinate("1/3")).toBeCloseTo(1 / 3, 15);
    expect(parseCoordinate("-1/4")).toBe(-0.25);
    expect(parseCoordinate("+2 / 3")).toBeCloseTo(2 / 3, 15);
    expect(parseCoordinate("1e-3")).toBe(0.001);
  });

  it("drops a standard uncertainty and reads a typeset minus", () => {
    expect(parseCoordinate("0.5(2)")).toBe(0.5);
    expect(parseCoordinate("0.2500(4)")).toBe(0.25);
    expect(parseCoordinate("\u22120.25")).toBe(-0.25);
    expect(parseCoordinate("\u22121/4")).toBe(-0.25);
    expect(parseCoordinate("?")).toBeNull();
  });

  it("is how a CIF's coordinates are read, so fractions there are kept", () => {
    const cif = parseCif("data_f\nloop_\n_atom_site_label\n_atom_site_fract_x\n_atom_site_fract_y\n_atom_site_fract_z\nCl1 1/2 1/2 0.5(1)\n");
    expect(cif.sites.map((s) => [s.x, s.y, s.z])).toEqual([[0.5, 0.5, 0.5]]);
    expect(cif.warnings.filter((w) => /skipped/.test(w))).toEqual([]);
  });

  it("refuses what it cannot read, never giving NaN", () => {
    for (const t of ["", "0,5", "1/0", "x", "1/3/4", "0.5.1", "1/", "/2", "0x10"]) expect(parseCoordinate(t)).toBeNull();
  });
});
