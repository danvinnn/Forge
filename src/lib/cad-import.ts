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

function graphicBounds(footprint: Sexp[], wantedLayer: string): Rect | null {
  const points: Point[] = [];
  for (const node of footprint) {
    if (!Array.isArray(node) || child(node, "layer")?.[1] !== wantedLayer) continue;
    if (node[0] === "fp_line" || node[0] === "fp_rect") {
      for (const key of ["start", "end"]) {
        const point = child(node, key);
        if (point) points.push({ xMm: finite(point[1], `${wantedLayer} x position`), yMm: finite(point[2], `${wantedLayer} y position`) });
      }
    } else if (node[0] === "fp_poly") {
      const pts = child(node, "pts");
      for (const point of pts ?? []) {
        if (Array.isArray(point) && point[0] === "xy") {
          points.push({ xMm: finite(point[1], `${wantedLayer} x position`), yMm: finite(point[2], `${wantedLayer} y position`) });
        }
      }
    }
  }
  if (points.length < 2) return null;
  return {
    halfWidthMm: Math.max(...points.map((point) => Math.abs(point.xMm))),
    halfHeightMm: Math.max(...points.map((point) => Math.abs(point.yMm)))
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

interface XmlElement {
  attributes: Record<string, string>;
  body: string;
}

function xmlValue(value: string): string {
  return value.replace(/&(?:#x[0-9a-f]+|#\d+|amp|quot|apos|lt|gt);/gi, (entity) => {
    if (entity.toLowerCase() === "&amp;") return "&";
    if (entity.toLowerCase() === "&quot;") return '"';
    if (entity.toLowerCase() === "&apos;") return "'";
    if (entity.toLowerCase() === "&lt;") return "<";
    if (entity.toLowerCase() === "&gt;") return ">";
    const numeric = entity[2]?.toLowerCase() === "x"
      ? Number.parseInt(entity.slice(3, -1), 16)
      : Number.parseInt(entity.slice(2, -1), 10);
    if (!Number.isInteger(numeric) || numeric < 0 || numeric > 0x10ffff) {
      throw new Error("The EAGLE library contains an invalid XML character reference.");
    }
    return String.fromCodePoint(numeric);
  });
}

function xmlAttributes(source: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  const pattern = /([A-Za-z_:][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  for (const match of source.matchAll(pattern)) attributes[match[1]] = xmlValue(match[2] ?? match[3] ?? "");
  return attributes;
}

function xmlElements(source: string, tag: string): XmlElement[] {
  const paired = new RegExp(`<${tag}\\b([^>]*)>([\\s\\S]*?)<\\/${tag}\\s*>`, "gi");
  return [...source.matchAll(paired)].map((match) => ({ attributes: xmlAttributes(match[1]), body: match[2] }));
}

function xmlEmptyElements(source: string, tag: string): Array<Record<string, string>> {
  const empty = new RegExp(`<${tag}\\b([^>]*)\\/\\s*>`, "gi");
  return [...source.matchAll(empty)].map((match) => xmlAttributes(match[1]));
}

function eagleNumber(attributes: Record<string, string>, key: string, label: string): number {
  const value = Number(attributes[key]);
  if (!Number.isFinite(value)) throw new Error(`The imported EAGLE ${label} is not a finite number.`);
  return value;
}

function eagleRotation(raw = "R0"): number {
  if (/M/i.test(raw)) throw new Error("The EAGLE footprint is mirrored onto the back side; choose the front-side package before importing it.");
  const match = /^(?:S)?R(-?(?:\d+(?:\.\d*)?|\.\d+))$/i.exec(raw.trim());
  if (!match) throw new Error(`The EAGLE footprint uses an unsupported rotation ${raw}.`);
  const angle = Number(match[1]);
  if (!Number.isFinite(angle)) throw new Error("The imported EAGLE pad rotation is not finite.");
  return angle;
}

function eaglePackage(source: string, part: ResolvedPart): XmlElement {
  const packages = [...xmlElements(source, "package"), ...xmlElements(source, "footprint")];
  if (packages.length === 0) throw new Error("No EAGLE package declaration was found.");
  if (packages.length === 1) return packages[0];
  const identity = (value: string) => value.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const wanted = identity(part.packageType);
  // Similar package names are not interchangeable (SO8 and SO80, for example).
  // In a multi-package library only an exact normalized identity is enough to
  // choose copper without asking the user.
  const matches = packages.filter((candidate) => wanted.length >= 3 && identity(candidate.attributes.name ?? "") === wanted);
  if (matches.length === 1) return matches[0];
  throw new Error(
    matches.length > 1
      ? `The EAGLE library contains more than one package matching ${part.packageType}.`
      : `The EAGLE library contains ${packages.length} packages and none uniquely matches ${part.packageType}.`
  );
}

/** Imports Autodesk EAGLE/Fusion Electronics XML package geometry. */
export function importEagleFootprint(input: CadImport, part: ResolvedPart, densityLevel: DensityLevel = "B"): FootprintGeometry {
  if (!input.fileName.toLowerCase().endsWith(".lbr")) throw new Error("An EAGLE vendor footprint must use the .lbr extension.");
  if (Buffer.byteLength(input.source, "utf8") > MAX_SOURCE_BYTES) throw new Error("The vendor CAD file is larger than 2MB.");
  if (!/<eagle\b/i.test(input.source) || !/<library\b/i.test(input.source)) {
    throw new Error("The vendor CAD file is not an EAGLE XML library.");
  }
  const declaration = eaglePackage(input.source, part);
  const customCopper = /<(?:polygon|rectangle|circle|wire)\b[^>]*\blayer\s*=\s*["']1["']/i.test(declaration.body);
  if (customCopper) {
    throw new Error("This EAGLE package uses arbitrary top-layer copper that Forge cannot preserve exactly yet.");
  }

  const pads: Pad[] = [];
  for (const item of xmlEmptyElements(declaration.body, "smd")) {
    const number = (item.name ?? "").trim();
    if (!number) throw new Error("Every imported EAGLE SMD terminal must have a pad name.");
    if (item.layer !== "1") {
      throw new Error(`EAGLE pad ${number} is not on front copper; choose or mirror the correct manufacturer footprint before importing it.`);
    }
    const widthMm = eagleNumber(item, "dx", "pad width");
    const heightMm = eagleNumber(item, "dy", "pad height");
    const roundness = item.roundness === undefined ? 0 : eagleNumber(item, "roundness", "pad roundness");
    if (widthMm <= 0 || heightMm <= 0 || roundness < 0 || roundness > 100) {
      throw new Error(`EAGLE pad ${number} has an invalid size or roundness.`);
    }
    const rotationDeg = eagleRotation(item.rot);
    pads.push({
      number,
      centre: { xMm: eagleNumber(item, "x", "pad x position"), yMm: -eagleNumber(item, "y", "pad y position") },
      widthMm,
      heightMm,
      ...(rotationDeg !== 0 ? { rotationDeg } : {}),
      ...(roundness > 0 ? { cornerRadiusRatio: roundness / 200 } : {}),
      shape: roundness > 0 ? "roundrect" : "rect",
      mounting: "smd",
      hasPaste: item.cream !== "no",
      hasMask: item.stop !== "no"
    });
  }
  for (const item of xmlEmptyElements(declaration.body, "pad")) {
    const number = (item.name ?? "").trim();
    if (!number) throw new Error("Every imported EAGLE through-hole terminal must have a pad name.");
    const drillMm = eagleNumber(item, "drill", "drill diameter");
    if (item.diameter === undefined) {
      throw new Error(`EAGLE pad ${number} relies on a board design-rule diameter; the library must state its copper diameter explicitly.`);
    }
    const diameter = eagleNumber(item, "diameter", "pad diameter");
    const shape = item.shape ?? "round";
    if (!new Set(["round", "square"]).has(shape)) {
      throw new Error(`EAGLE pad ${number} uses the unsupported shape ${shape}.`);
    }
    if (drillMm <= 0 || diameter <= drillMm) throw new Error(`EAGLE pad ${number} has an invalid drill or copper diameter.`);
    const rotationDeg = eagleRotation(item.rot);
    pads.push({
      number,
      centre: { xMm: eagleNumber(item, "x", "pad x position"), yMm: -eagleNumber(item, "y", "pad y position") },
      widthMm: diameter,
      heightMm: diameter,
      ...(rotationDeg !== 0 ? { rotationDeg } : {}),
      shape: shape === "round" ? "circle" : "rect",
      mounting: "through-hole",
      drillMm,
      hasPaste: false,
      hasMask: true
    });
  }
  for (const item of xmlEmptyElements(declaration.body, "hole")) {
    const drillMm = eagleNumber(item, "drill", "mechanical-hole diameter");
    if (drillMm <= 0) throw new Error("An EAGLE mechanical hole has a non-positive drill diameter.");
    pads.push({
      number: "",
      centre: { xMm: eagleNumber(item, "x", "hole x position"), yMm: -eagleNumber(item, "y", "hole y position") },
      widthMm: drillMm,
      heightMm: drillMm,
      shape: "circle",
      mounting: "through-hole",
      plated: false,
      drillMm,
      hasPaste: false,
      hasMask: false
    });
  }
  if (pads.length === 0 || pads.every((pad) => !pad.number)) {
    throw new Error("The EAGLE package contains no numbered copper pads Forge can import.");
  }

  const docPoints = xmlEmptyElements(declaration.body, "wire")
    .filter((item) => item.layer === "51")
    .flatMap((item) => [
      { xMm: eagleNumber(item, "x1", "documentation x position"), yMm: -eagleNumber(item, "y1", "documentation y position") },
      { xMm: eagleNumber(item, "x2", "documentation x position"), yMm: -eagleNumber(item, "y2", "documentation y position") }
    ]);
  const body = docPoints.length >= 2
    ? { halfWidthMm: Math.max(...docPoints.map((point) => Math.abs(point.xMm))), halfHeightMm: Math.max(...docPoints.map((point) => Math.abs(point.yMm))) }
    : bounds(pads, 0.25);
  const courtyard = bounds(pads, densityLevel === "A" ? 0.5 : densityLevel === "B" ? 0.25 : 0.1);
  const first = pads.find((pad) => pad.number === "1") ?? pads.find((pad) => pad.number) ?? pads[0];
  const numbered = pads.filter((pad) => pad.number);
  const name = (declaration.attributes.name ?? part.partNumber).replace(/[^A-Za-z0-9_.+-]/g, "_").slice(0, 96) || part.partNumber;
  return {
    name,
    description: `Vendor-authored EAGLE copper imported by Forge from ${input.fileName}; pin and geometry invariants revalidated.`,
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
      padWidthMm: Math.min(...numbered.map((pad) => pad.widthMm)),
      padLengthMm: Math.min(...numbered.map((pad) => pad.heightMm)),
      centreToCentreMm: Math.max(...numbered.map((pad) => Math.hypot(pad.centre.xMm, pad.centre.yMm))) * 2,
      pitchMm: pitchOf(numbered),
      arrangement: arrangement(numbered),
      corroboration: { from: "vendor", against: null, agrees: false, because: "vendor-import", detail: "Imported from vendor-authored EAGLE CAD; checked against this part's extracted terminal set." },
      discards: []
    }
  };
}

/** Dispatches supported open vendor CAD formats into the same neutral geometry. */
export function importCadFootprint(input: CadImport, part: ResolvedPart, densityLevel: DensityLevel = "B"): FootprintGeometry {
  const name = input.fileName.toLowerCase();
  if (name.endsWith(".kicad_mod")) return importKicadFootprint(input, part, densityLevel);
  if (name.endsWith(".lbr")) return importEagleFootprint(input, part, densityLevel);
  throw new Error("Forge imports vendor footprints from textual KiCad (.kicad_mod) or EAGLE XML (.lbr) files.");
}

function comparePinMap(pinMap: ReadonlyMap<string, string>, part: ResolvedPart, sourceLabel: string): { agrees: boolean; detail: string } {
  const differences = part.pins.filter((pin) => pinMap.get(pin.number) !== pin.name);
  const extras = [...pinMap.keys()].filter((number) => !part.pins.some((pin) => pin.number === number));
  if (differences.length || extras.length || pinMap.size !== part.pins.length) {
    const names = differences.slice(0, 4).map((pin) => `${pin.number}: datasheet “${pin.name}”, vendor ${sourceLabel} “${pinMap.get(pin.number) ?? "missing"}”`);
    return { agrees: false, detail: [...names, ...(extras.length ? [`extra vendor pins ${extras.slice(0, 8).join(", ")}`] : [])].join("; ") };
  }
  return { agrees: true, detail: `All ${part.pins.length} pin numbers and names agree with the vendor ${sourceLabel}.` };
}

/** Independent package-pad/name evidence from an exactly scoped EAGLE device. */
export function compareEagleLibraryPins(source: string, part: ResolvedPart): { agrees: boolean; detail: string } {
  if (Buffer.byteLength(source, "utf8") > MAX_SOURCE_BYTES) throw new Error("The vendor EAGLE library is larger than 2MB.");
  if (!/<eagle\b/i.test(source) || !/<library\b/i.test(source)) throw new Error("The vendor pin evidence is not an EAGLE XML library.");
  const selectedPackage = eaglePackage(source, part);
  const packageName = selectedPackage.attributes.name ?? "";
  const identity = (value: string) => value.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const wantedPart = identity(part.partNumber);
  const wantedPackage = identity(packageName);
  const candidates: Array<{ deviceSet: XmlElement; device: XmlElement }> = [];

  for (const deviceSet of xmlElements(source, "deviceset")) {
    const devices = xmlElements(deviceSet.body, "device").filter(
      (device) => identity(device.attributes.package ?? "") === wantedPackage
    );
    const exact = devices.filter((device) =>
      identity(`${deviceSet.attributes.name ?? ""}${device.attributes.name ?? ""}`) === wantedPart
    );
    if (exact.length > 0) {
      for (const device of exact) candidates.push({ deviceSet, device });
    } else if (identity(deviceSet.attributes.name ?? "") === wantedPart && devices.length === 1) {
      candidates.push({ deviceSet, device: devices[0] });
    }
  }
  if (candidates.length !== 1) {
    throw new Error(
      candidates.length === 0
        ? `The EAGLE library has no device exactly identifying ${part.partNumber} in package ${packageName}.`
        : `The EAGLE library has more than one device exactly identifying ${part.partNumber} in package ${packageName}.`
    );
  }

  const pinMap = new Map<string, string>();
  for (const connection of xmlEmptyElements(candidates[0].device.body, "connect")) {
    const pinName = (connection.pin ?? "").trim();
    const padNames = (connection.pad ?? "").trim().split(/\s+/).filter(Boolean);
    if (!pinName || padNames.length === 0) continue;
    for (const padName of padNames) {
      const held = pinMap.get(padName);
      if (held !== undefined && held !== pinName) {
        return { agrees: false, detail: `The vendor EAGLE device gives pad ${padName} more than one pin name.` };
      }
      pinMap.set(padName, pinName);
    }
  }
  if (pinMap.size === 0) throw new Error("No package-pad connections were found in the selected EAGLE device.");
  return comparePinMap(pinMap, part, "EAGLE device");
}

function descendants(node: Sexp): Sexp[][] {
  if (!Array.isArray(node)) return [];
  return [node, ...node.flatMap(descendants)];
}

/** Independent pin-number/name evidence from a vendor KiCad symbol library. */
export function compareKicadSymbolPins(source: string, part: ResolvedPart): { agrees: boolean; detail: string } {
  if (Buffer.byteLength(source, "utf8") > MAX_SOURCE_BYTES) throw new Error("The vendor symbol library is larger than 2MB.");
  const tree = parse(source);
  const library = tree.find((node): node is Sexp[] => Array.isArray(node) && node[0] === "kicad_symbol_lib") ?? tree;
  const symbols = library.filter((node): node is Sexp[] => Array.isArray(node) && node[0] === "symbol");
  if (symbols.length === 0) throw new Error("No symbol declaration was found in the vendor KiCad symbol library.");
  const identity = (value: unknown) => typeof value === "string" ? value.split(":").at(-1)!.toUpperCase().replace(/[^A-Z0-9]/g, "") : "";
  const wanted = identity(part.partNumber);
  const identitiesOf = (symbol: Sexp[]) => [
    identity(symbol[1]),
    ...symbol
      .filter((node): node is Sexp[] => Array.isArray(node) && node[0] === "property" && node[1] === "Value")
      .map((node) => identity(node[2]))
  ];
  const matches = symbols.filter((symbol) => identitiesOf(symbol).includes(wanted));
  const selected = matches.length === 1 ? matches[0] : symbols.length === 1 ? symbols[0] : null;
  if (!selected) {
    throw new Error(
      matches.length > 1
        ? `The vendor symbol library contains more than one declaration named for ${part.partNumber}.`
        : `The vendor symbol library contains several declarations and none uniquely names ${part.partNumber}.`
    );
  }

  // KiCad aliases may inherit their graphics and pins from another top-level
  // symbol. Follow only explicit `extends` links inside this same official
  // library, with a cycle guard; never infer an alias from a similar name.
  const selectedScopes: Sexp[][] = [];
  const visited = new Set<Sexp[]>();
  let current: Sexp[] | undefined = selected;
  while (current && !visited.has(current)) {
    visited.add(current);
    selectedScopes.push(current);
    const baseName: Sexp | undefined = child(current, "extends")?.[1];
    current = typeof baseName === "string"
      ? symbols.find((symbol) => typeof symbol[1] === "string" && symbol[1] === baseName)
      : undefined;
  }
  const pinMap = new Map<string, string>();
  for (const node of selectedScopes.flatMap(descendants)) {
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
  return comparePinMap(pinMap, part, "KiCad symbol");
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
    if (!at || !size) throw new Error("Every imported pad or hole must have a position and size.");
    const mounting = kind === "thru_hole" || kind === "np_thru_hole" ? "through-hole" : kind === "smd" ? "smd" : null;
    if (!mounting) continue;
    if (!number && kind !== "np_thru_hole") throw new Error("Every imported copper terminal must have a pin number.");
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
    let drillMm: number | undefined;
    let drillWidthMm: number | undefined;
    let drillHeightMm: number | undefined;
    if (mounting === "through-hole") {
      if (!drill) throw new Error(`Pad ${number || "(mechanical hole)"} has no drill size.`);
      if (drill[1] === "oval") {
        drillWidthMm = finite(drill[2], "slot width");
        drillHeightMm = finite(drill[3], "slot height");
      } else {
        drillMm = finite(drill[1], "drill diameter");
      }
    }
    const radiusNode = child(node, "roundrect_rratio");
    const radius = radiusNode ? finite(radiusNode[1], "rounded-corner ratio") : undefined;
    pads.push({
      number,
      centre: { xMm: finite(at[1], "pad x position"), yMm: finite(at[2], "pad y position") },
      widthMm: finite(size[1], "pad width"),
      heightMm: finite(size[2], "pad height"),
      ...(rotationDeg !== 0 ? { rotationDeg } : {}),
      ...(radius !== undefined ? { cornerRadiusRatio: radius } : {}),
      shape: rawShape,
      mounting,
      ...(kind === "np_thru_hole" ? { plated: false } : {}),
      ...(drillMm !== undefined ? { drillMm } : {}),
      ...(drillWidthMm !== undefined && drillHeightMm !== undefined ? { drillWidthMm, drillHeightMm } : {}),
      hasPaste: layers.includes("F.Paste"),
      hasMask: layers.includes("F.Mask") || layers.includes("*.Mask")
    });
  }
  if (pads.length === 0) throw new Error("The KiCad footprint contains no numbered copper pads Forge can import.");
  if (pads.every((pad) => !pad.number)) throw new Error("The KiCad footprint contains no numbered copper pads Forge can import.");
  if (pads.some((pad) => pad.widthMm <= 0 || pad.heightMm <= 0 ||
    (pad.cornerRadiusRatio !== undefined && (pad.cornerRadiusRatio < 0 || pad.cornerRadiusRatio > 0.5)) ||
    (pad.mounting === "through-hole" && !((pad.drillMm ?? 0) > 0 || ((pad.drillWidthMm ?? 0) > 0 && (pad.drillHeightMm ?? 0) > 0))))) {
    throw new Error("The imported footprint contains a non-positive pad or drill size.");
  }

  const body = graphicBounds(footprint, "F.Fab") ?? bounds(pads, 0.25);
  const courtyard = graphicBounds(footprint, "F.CrtYd") ?? bounds(pads, densityLevel === "A" ? 0.5 : densityLevel === "B" ? 0.25 : 0.1);
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
