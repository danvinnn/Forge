import type { DensityLevel } from "./ipc7351";
import type { FootprintGeometry, Pad, Point, Rect } from "./geometry";
import type { ResolvedPart } from "./types";

/** A deliberately small, bounded reader for vendor-authored KiCad footprints. */
const MAX_SOURCE_BYTES = 2_000_000;
const MAX_TOKENS = 250_000;

type Sexp = string | Sexp[];

function tokens(source: string): string[] {
  const out: string[] = [];
  const pattern = /\s*(\(|\)|"(?:\\.|[^"\\])*"|[^\s()]+)/gy;
  let at = 0;
  while (at < source.length) {
    pattern.lastIndex = at;
    const match = pattern.exec(source);
    if (!match) throw new Error("The KiCad footprint contains syntax Forge cannot read.");
    out.push(match[1]);
    if (out.length > MAX_TOKENS) throw new Error("The KiCad footprint is too complex to import safely.");
    at = pattern.lastIndex;
  }
  return out;
}

function parse(source: string): Sexp[] {
  const root: Sexp[] = [];
  const stack: Sexp[][] = [root];
  for (const token of tokens(source)) {
    if (token === "(") {
      if (stack.length > 64) throw new Error("The KiCad footprint is nested too deeply.");
      const node: Sexp[] = [];
      stack[stack.length - 1].push(node);
      stack.push(node);
    } else if (token === ")") {
      if (stack.length === 1) throw new Error("The KiCad footprint has an unmatched closing parenthesis.");
      stack.pop();
    } else {
      stack[stack.length - 1].push(token.startsWith('"') ? JSON.parse(token) : token);
    }
  }
  if (stack.length !== 1) throw new Error("The KiCad footprint has an unmatched opening parenthesis.");
  return root;
}

function child(node: Sexp[], name: string): Sexp[] | undefined {
  return node.find((item): item is Sexp[] => Array.isArray(item) && item[0] === name);
}

function finite(raw: Sexp | undefined, label: string): number {
  const value = typeof raw === "string" ? Number(raw) : NaN;
  if (!Number.isFinite(value)) throw new Error(`The imported ${label} is not a finite number.`);
  return value;
}

function bounds(points: Array<{ centre: Point; widthMm: number; heightMm: number; rotationDeg?: number }>, extra: number): Rect {
  const rotated = points.map((item) => {
    const angle = ((item.rotationDeg ?? 0) * Math.PI) / 180;
    return {
      ...item,
      xExtent: (Math.abs(Math.cos(angle)) * item.widthMm + Math.abs(Math.sin(angle)) * item.heightMm) / 2,
      yExtent: (Math.abs(Math.sin(angle)) * item.widthMm + Math.abs(Math.cos(angle)) * item.heightMm) / 2
    };
  });
  const x = rotated.flatMap((item) => [item.centre.xMm - item.xExtent, item.centre.xMm + item.xExtent]);
  const y = rotated.flatMap((item) => [item.centre.yMm - item.yExtent, item.centre.yMm + item.yExtent]);
  return {
    halfWidthMm: Math.max(Math.abs(Math.min(...x)), Math.abs(Math.max(...x))) + extra,
    halfHeightMm: Math.max(Math.abs(Math.min(...y)), Math.abs(Math.max(...y))) + extra
  };
}

function arrangement(pads: Pad[]): "single" | "dual" | "quad" | "grid" {
  const xs = new Set(pads.map((pad) => pad.centre.xMm.toFixed(4))).size;
  const ys = new Set(pads.map((pad) => pad.centre.yMm.toFixed(4))).size;
  if (xs > 2 && ys > 2) return "grid";
  if (xs === 1 || ys === 1) return "single";
  return xs === 2 || ys === 2 ? "dual" : "quad";
}

function pitchOf(pads: Pad[]): number {
  const values = pads.flatMap((pad) => [pad.centre.xMm, pad.centre.yMm]);
  const differences = values.flatMap((value, index) => values.slice(index + 1).map((other) => Math.abs(value - other)))
    .filter((value) => value > 0.0001).sort((a, b) => a - b);
  return differences[0] ?? 0;
}

export interface CadImport {
  fileName: string;
  source: string;
}

function descendants(node: Sexp): Sexp[][] {
  if (!Array.isArray(node)) return [];
  return [node, ...node.flatMap(descendants)];
}

/** Independent pin-number/name evidence from a vendor KiCad symbol library. */
export function compareKicadSymbolPins(source: string, part: ResolvedPart): { agrees: boolean; detail: string } {
  if (Buffer.byteLength(source, "utf8") > MAX_SOURCE_BYTES) throw new Error("The vendor symbol library is larger than 2MB.");
  const pinMap = new Map<string, string>();
  for (const node of descendants(parse(source))) {
    if (node[0] !== "pin") continue;
    const name = child(node, "name")?.[1];
    const number = child(node, "number")?.[1];
    if (typeof name !== "string" || typeof number !== "string" || !number.trim()) continue;
    const held = pinMap.get(number.trim());
    if (held !== undefined && held !== name.trim()) {
      return { agrees: false, detail: `The vendor symbol gives pin ${number.trim()} more than one name.` };
    }
    pinMap.set(number.trim(), name.trim());
  }
  if (pinMap.size === 0) throw new Error("No numbered pins were found in the vendor KiCad symbol library.");
  const differences = part.pins.filter((pin) => pinMap.get(pin.number) !== pin.name);
  const extras = [...pinMap.keys()].filter((number) => !part.pins.some((pin) => pin.number === number));
  if (differences.length || extras.length || pinMap.size !== part.pins.length) {
    const names = differences.slice(0, 4).map((pin) => `${pin.number}: datasheet “${pin.name}”, vendor symbol “${pinMap.get(pin.number) ?? "missing"}”`);
    return { agrees: false, detail: [...names, ...(extras.length ? [`extra vendor pins ${extras.slice(0, 8).join(", ")}`] : [])].join("; ") };
  }
  return { agrees: true, detail: `All ${part.pins.length} pin numbers and names agree with the vendor KiCad symbol.` };
}

/**
 * Imports copper rather than translating file text. Every output emitter reads
 * the same neutral geometry and the normal geometry/pin invariants run later.
 */
export function importKicadFootprint(input: CadImport, part: ResolvedPart, densityLevel: DensityLevel = "B"): FootprintGeometry {
  if (!input.fileName.toLowerCase().endsWith(".kicad_mod")) throw new Error("Forge currently imports vendor CAD as a .kicad_mod footprint.");
  if (Buffer.byteLength(input.source, "utf8") > MAX_SOURCE_BYTES) throw new Error("The vendor CAD file is larger than 2MB.");
  const tree = parse(input.source);
  const footprint = tree.find((item): item is Sexp[] => Array.isArray(item) && (item[0] === "footprint" || item[0] === "module"));
  if (!footprint) throw new Error("No KiCad footprint declaration was found.");
  const footprintAt = child(footprint, "at");
  if (footprintAt && footprintAt.slice(1).some((value) => finite(value, "footprint transform") !== 0)) {
    throw new Error("The vendor footprint has a board-placement transform. Import the library footprint at its local origin instead.");
  }

  const pads: Pad[] = [];
  for (const node of footprint) {
    if (!Array.isArray(node) || node[0] !== "pad") continue;
    const number = typeof node[1] === "string" ? node[1].trim() : "";
    const kind = node[2];
    const at = child(node, "at");
    const size = child(node, "size");
    if (!number || !at || !size) throw new Error("Every imported copper pad must have a number, position, and size.");
    const mounting = kind === "thru_hole" ? "through-hole" : kind === "smd" ? "smd" : null;
    if (!mounting) continue;
    const drill = child(node, "drill");
    const layers = child(node, "layers")?.slice(1).filter((item): item is string => typeof item === "string") ?? [];
    if (mounting === "smd" && !layers.includes("F.Cu")) {
      throw new Error(`Pad ${number} is not on front copper; choose or mirror the correct manufacturer footprint before importing it.`);
    }
    const rotationDeg = at[3] === undefined ? 0 : finite(at[3], "pad rotation");
    const rawShape = typeof node[3] === "string" ? node[3] : "";
    if (rawShape !== "roundrect" && rawShape !== "circle" && rawShape !== "rect" && rawShape !== "oval") {
      throw new Error(`Pad ${number} uses the unsupported KiCad shape ${rawShape || "(missing)"}.`);
    }
    pads.push({
      number,
      centre: { xMm: finite(at[1], "pad x position"), yMm: finite(at[2], "pad y position") },
      widthMm: finite(size[1], "pad width"),
      heightMm: finite(size[2], "pad height"),
      ...(rotationDeg !== 0 ? { rotationDeg } : {}),
      shape: rawShape,
      mounting,
      ...(mounting === "through-hole" ? { drillMm: drill ? finite(drill[1], "drill diameter") : undefined } : {})
    });
  }
  if (pads.length === 0) throw new Error("The KiCad footprint contains no numbered copper pads Forge can import.");
  if (pads.some((pad) => pad.widthMm <= 0 || pad.heightMm <= 0 || (pad.mounting === "through-hole" && (!pad.drillMm || pad.drillMm <= 0)))) {
    throw new Error("The imported footprint contains a non-positive pad or drill size.");
  }

  const body = bounds(pads, 0.25);
  const courtyard = bounds(pads, densityLevel === "A" ? 0.5 : densityLevel === "B" ? 0.25 : 0.1);
  const first = pads.find((pad) => pad.number === "1") ?? pads[0];
  const width = Math.min(...pads.map((pad) => pad.widthMm));
  const length = Math.min(...pads.map((pad) => pad.heightMm));
  const span = Math.max(...pads.map((pad) => Math.hypot(pad.centre.xMm, pad.centre.yMm))) * 2;
  const name = String(footprint[1] ?? part.partNumber).replace(/[^A-Za-z0-9_.+-]/g, "_").slice(0, 96) || part.partNumber;
  return {
    name,
    description: `Vendor-authored KiCad copper imported by Forge from ${input.fileName}; pin and geometry invariants revalidated.`,
    partNumber: part.partNumber,
    pads,
    body,
    courtyard,
    pin1Marker: { xMm: first.centre.xMm - first.widthMm / 2, yMm: first.centre.yMm - first.heightMm / 2 },
    thermalVias: [],
    provenance: {
      family: part.packageType,
      source: `vendor CAD import: ${input.fileName}`,
      densityLevel,
      padWidthMm: width,
      padLengthMm: length,
      centreToCentreMm: span,
      pitchMm: pitchOf(pads),
      arrangement: arrangement(pads),
      corroboration: { from: "vendor", against: null, agrees: false, because: "vendor-import", detail: "Imported from vendor-authored CAD; checked against this part's extracted terminal set." },
      discards: []
    }
  };
}
