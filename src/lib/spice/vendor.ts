/** Honest seams for vendor-authored models: link to the owner, never redistribute. */
import type { DeviceClassId } from "./model";
import { spiceName } from "./emit";

export interface VendorResource {
  label: string;
  url: string;
  modelKnown: boolean;
}

const PRODUCT_URLS: Array<{ matches: RegExp; url: (part: string) => string; label: string }> = [
  { matches: /texas instruments|\bti\b/i, url: (part) => `https://www.ti.com/product/${encodeURIComponent(part)}`, label: "TI product resources" },
  { matches: /analog devices|maxim|linear technology/i, url: (part) => `https://www.analog.com/en/products/${encodeURIComponent(part.toLowerCase())}.html`, label: "Analog Devices product resources" },
  { matches: /renesas|intersil/i, url: (part) => `https://www.renesas.com/en/products/${encodeURIComponent(part.toLowerCase())}`, label: "Renesas product resources" },
  { matches: /stmicroelectronics|\bst\b/i, url: (part) => `https://www.st.com/en/search.html#q=${encodeURIComponent(part)}`, label: "ST product resources" },
  { matches: /microchip/i, url: (part) => `https://www.microchip.com/en-us/product/${encodeURIComponent(part)}`, label: "Microchip product resources" },
  { matches: /onsemi|on semiconductor/i, url: (part) => `https://www.onsemi.com/products?searchTerm=${encodeURIComponent(part)}`, label: "onsemi product resources" }
];

/** Models whose existence was checked against the vendor, never inferred by family. */
const KNOWN_MODELS: Record<string, VendorResource> = {
  OPA333: {
    label: "TI OPAx333 PSpice model (SBOC084G)",
    url: "https://www.ti.com/lit/zip/sboc084",
    modelKnown: true
  }
};

export function vendorResource(partNumber: string, manufacturer?: string | null): VendorResource | null {
  const exact = KNOWN_MODELS[partNumber.trim().toUpperCase()];
  if (exact) return exact;
  if (!manufacturer) return null;
  const source = PRODUCT_URLS.find((candidate) => candidate.matches.test(manufacturer));
  return source ? { label: source.label, url: source.url(partNumber), modelKnown: false } : null;
}

const ALIASES: Record<string, RegExp[]> = {
  "IN+": [/^IN\+$/, /^VIN\+$/, /^INP$/, /^NONINV$/, /^PLUS$/],
  "IN-": [/^IN-$/, /^VIN-$/, /^INM$/, /^INV$/, /^MINUS$/],
  OUT: [/^OUT$/, /^OUTPUT$/, /^VO$/],
  VCC: [/^V\+$/, /^VCC$/, /^VDD$/, /^VP$/],
  VEE: [/^V-$/, /^VEE$/, /^VSS$/, /^VN$/],
  REF: [/^REF$/, /^REFERENCE$/, /^VREF$/],
  "RG+": [/^RG\+$/, /^RGP$/, /^RG1$/, /^GAIN\+$/],
  "RG-": [/^RG-$/, /^RGM$/, /^RG2$/, /^GAIN-$/],
  IN: [/^IN$/, /^INPUT$/, /^VIN$/],
  GND: [/^GND$/, /^GROUND$/, /^COM$/, /^COMMON$/, /^0$/]
};

function roleOf(pin: string, roles: string[]): string | null {
  const folded = pin.trim().toUpperCase().replace(/[{}()[\],]/g, "");
  const hits = roles.filter((role) => (ALIASES[role] ?? []).some((pattern) => pattern.test(folded)));
  return hits.length === 1 ? hits[0] : null;
}

function rolesFor(deviceClass: DeviceClassId): string[] {
  if (deviceClass === "instrumentation") return ["IN+", "IN-", "OUT", "REF", "VCC", "VEE", "RG+", "RG-"];
  return deviceClass === "opamp" || deviceClass === "comparator"
    ? ["IN+", "IN-", "OUT", "VCC", "VEE"]
    : ["IN", "OUT", "GND"];
}

function mappedRoles(candidate: VendorCandidate, deviceClass: DeviceClassId): string[] | null {
  if (candidate.kind !== "subckt") return null;
  const roles = rolesFor(deviceClass);
  if (candidate.terminals.length !== roles.length) return null;
  const mapped = candidate.terminals.map((pin) => roleOf(pin, roles));
  return mapped.some((role) => role === null) || new Set(mapped).size !== roles.length
    ? null
    : mapped as string[];
}

export interface VendorCandidate {
  /** Stable within this upload; sent back by the chooser when a file has helpers. */
  id: string;
  kind: "subckt" | "model";
  name: string;
  modelType: string | null;
  /** Labels only. Their order, not their spelling, is the electrical contract. */
  terminals: string[];
  /** Some model cards are incomplete until the instance supplies this value. */
  instanceParameter: "resistance" | "capacitance" | "inductance" | "length" | null;
}

function validDeclarationName(name: string): boolean {
  // Numeric-leading semiconductor names (for example 2N3904) are ordinary
  // SPICE identifiers. Keep the alphabet deliberately small so a declaration
  // token can never become syntax when copied into the adapter.
  return /^[A-Za-z0-9_][A-Za-z0-9_.$-]*$/.test(name);
}

export const VENDOR_PRIMITIVE_TERMINALS: Readonly<Record<string, readonly string[]>> = {
  R: ["P", "N"],
  C: ["P", "N"],
  D: ["A", "K"],
  NPN: ["C", "B", "E"],
  PNP: ["C", "B", "E"],
  NJF: ["D", "G", "S"],
  PJF: ["D", "G", "S"],
  NMF: ["D", "G", "S"],
  PMF: ["D", "G", "S"],
  NMOS: ["D", "G", "S", "B"],
  PMOS: ["D", "G", "S", "B"],
  VDMOS: ["D", "G", "S"],
  NIGBT: ["C", "G", "E"],
  SW: ["P", "N", "CTRL+", "CTRL-"],
  CSW: ["P", "N", "CTRL+", "CTRL-"],
  LTRA: ["L+", "L-", "R+", "R-"],
  URC: ["N1", "N2", "COMMON"]
};

const INSTANCE_PARAMETERS: Readonly<Record<string, VendorCandidate["instanceParameter"]>> = {
  R: "resistance",
  C: "capacitance",
  URC: "length"
};

/**
 * Vendor text is eventually handed to a native simulator. It is data, not a
 * place to smuggle simulator commands or reads from the host filesystem.
 */
export function validateVendorModel(text: string, forExecution = false): void {
  if (text.length === 0 || text.length > 5_000_000) throw new Error("The vendor model is empty or larger than 5MB.");
  if (text.includes("\0")) throw new Error("The vendor model contains a NUL byte.");
  const active = text.split(/\r?\n/).filter((line) => !/^\s*\*/.test(line));
  if (active.some((line) => line.length > 20_000)) throw new Error("The vendor model contains an overlong line.");
  if (forExecution) {
    // `.lib NAME` may delimit a self-contained model corner and is therefore
    // handled by the standalone-dependency check in `inspectVendorModel`.
    // Blanket-refusing it rejects valid vendor libraries for no safety gain.
    const unsafe = /^\s*\.(?:control|endc|shell|include|inc|load|source|codemodel|pre_osdi)\b|^\s*shell\b/i;
    const hit = active.find((line) => unsafe.test(line));
    if (hit) throw new Error(`The vendor model uses a directive Forge will not execute: ${hit.trim().split(/\s+/)[0]}.`);
  }
}

function logicalSpiceLines(text: string): string[] {
  const lines: string[] = [];
  for (const physical of text.split(/\r?\n/)) {
    if (/^\s*\*/.test(physical) || physical.trim() === "") continue;
    if (/^\s*\+/.test(physical) && lines.length > 0) {
      lines[lines.length - 1] += ` ${physical.replace(/^\s*\+\s*/, "")}`;
    } else {
      lines.push(physical);
    }
  }
  return lines;
}

/** Every standalone subcircuit is usable; common primitive .MODEL cards are too. */
export function inspectVendorModel(text: string): VendorCandidate[] {
  validateVendorModel(text);
  const logical = logicalSpiceLines(text);
  const localLibrarySections = new Set<string>();
  const openLibrarySections: string[] = [];
  for (const line of logical) {
    const opening = line.match(/^\s*\.lib\s+(\S+)\s*$/i);
    if (opening) openLibrarySections.push(opening[1].toUpperCase());
    const closing = line.match(/^\s*\.endl(?:\s+(\S+))?\s*$/i);
    if (!closing || openLibrarySections.length === 0) continue;
    const opened = openLibrarySections.pop()!;
    if (!closing[1] || closing[1].toUpperCase() === opened) localLibrarySections.add(opened);
  }
  const dependency = logical.find((line) => {
    if (/^\s*\.(?:include|inc|source)\b/i.test(line)) return true;
    const library = line.match(/^\s*\.lib\s+(.+)$/i);
    if (!library) return false;
    const arguments_ = library[1].trim().split(/\s+/);
    return arguments_.length !== 1 || !localLibrarySections.has(arguments_[0].toUpperCase());
  });
  if (dependency) throw new Error("This vendor model depends on another file. Supply one consolidated standalone model so the adapter cannot ship with a hidden missing dependency.");
  if (logical.some((line) => /^\s*\.end\s*(?:$|\*)/i.test(line))) {
    throw new Error("This vendor file contains a top-level .END card. Supply it as a reusable library without the circuit-ending card.");
  }
  const candidates: VendorCandidate[] = [];
  let index = 0;
  for (const line of logical) {
    const match = line.match(/^\s*\.subckt\s+(\S+)\s+(.+)$/i);
    if (!match) continue;
    const name = match[1];
    if (!validDeclarationName(name)) continue;
    const terminals: string[] = [];
    for (const token of match[2].trim().split(/\s+/)) {
      if (/^(?:PARAMS?|OPTIONAL):/i.test(token) || token.includes("=")) break;
      terminals.push(token);
    }
    if (terminals.length === 0) continue;
    candidates.push({ id: `subckt:${index++}`, kind: "subckt", name, modelType: null, terminals, instanceParameter: null });
  }
  for (const line of logical) {
    const match = line.match(/^\s*\.model\s+(\S+)\s+(\S+)/i);
    if (!match) continue;
    const name = match[1];
    if (!validDeclarationName(name)) continue;
    const modelType = match[2].replace(/\(.*/, "").toUpperCase();
    const terminals = VENDOR_PRIMITIVE_TERMINALS[modelType];
    if (!terminals) continue;
    candidates.push({
      id: `model:${index++}`,
      kind: "model",
      name,
      modelType,
      terminals: [...terminals],
      instanceParameter: INSTANCE_PARAMETERS[modelType] ?? null
    });
  }
  return candidates;
}

/** Subcircuits Forge can map semantically for numerical class verification. */
export function compatibleVendorCandidates(text: string, deviceClass: DeviceClassId): VendorCandidate[] {
  validateVendorModel(text, true);
  return inspectVendorModel(text).filter((candidate) => mappedRoles(candidate, deviceClass) !== null);
}

function quotedIncludeName(fileName: string): string {
  const leaf = fileName.split(/[\\/]/).pop()?.replace(/[\r\n"<>:|?*]/g, "_").trim();
  return leaf && leaf !== "." && leaf !== ".." ? leaf : "vendor-model.lib";
}

function spiceScalar(value: string | undefined, parameter: NonNullable<VendorCandidate["instanceParameter"]>): string {
  const scalar = value?.trim() ?? "";
  if (!/^(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+|meg|[fpnumkgt])?$/i.test(scalar)) {
    throw new Error(`Supply a positive SPICE numeric ${parameter} (for example 10k, 2.2u, or 0.01).`);
  }
  // Syntax alone is not the contract. Zero resistance, capacitance, or line
  // length passes the token grammar above but cannot answer a question that
  // explicitly asks for a positive physical value. Parse the suffix here so
  // the route and the generated instance enforce the same boundary instead of
  // accepting an answer the error text says is invalid.
  const parsed = scalar.match(/^(\d+(?:\.\d*)?|\.\d+)(e[+-]?\d+|meg|[fpnumkgt])?$/i);
  const suffix = parsed?.[2]?.toLowerCase() ?? "";
  const multipliers: Record<string, number> = {
    "": 1,
    f: 1e-15,
    p: 1e-12,
    n: 1e-9,
    u: 1e-6,
    m: 1e-3,
    k: 1e3,
    meg: 1e6,
    g: 1e9,
    t: 1e12
  };
  const numeric = parsed
    ? Number(parsed[1]) * (suffix.startsWith("e") ? 10 ** Number(suffix.slice(1)) : multipliers[suffix])
    : NaN;
  if (!Number.isFinite(numeric) || numeric <= 0) {
    throw new Error(`Supply a positive SPICE numeric ${parameter} (for example 10k, 2.2u, or 0.01).`);
  }
  return scalar;
}

function primitiveLines(candidate: VendorCandidate, instanceValue?: string): string[] {
  const ports = candidate.terminals.map((_, i) => `P${i + 1}`).join(" ");
  switch (candidate.modelType) {
    case "R": case "C": {
      const value = spiceScalar(instanceValue, candidate.instanceParameter!);
      return [`${candidate.modelType}vendor ${ports} ${candidate.name} ${value}`];
    }
    case "D": return [`Dvendor ${ports} ${candidate.name}`];
    case "NPN": case "PNP": return [`Qvendor ${ports} ${candidate.name}`];
    case "NJF": case "PJF": return [`Jvendor ${ports} ${candidate.name}`];
    case "NMF": case "PMF": case "NIGBT": return [`Zvendor ${ports} ${candidate.name}`];
    case "NMOS": case "PMOS": case "VDMOS": return [`Mvendor ${ports} ${candidate.name}`];
    case "SW": return [`Svendor ${ports} ${candidate.name}`];
    case "CSW": return [
      "Vsense P3 P4 0",
      `Wvendor P1 P2 Vsense ${candidate.name}`
    ];
    case "LTRA": return [`Ovendor ${ports} ${candidate.name}`];
    case "URC": return [`Uvendor ${ports} ${candidate.name} L=${spiceScalar(instanceValue, "length")}`];
    default: throw new Error(`Forge does not know the terminal contract for .MODEL type ${candidate.modelType ?? "unknown"}.`);
  }
}

/**
 * Make a thin adapter without copying the uploaded vendor file. The engineer
 * keeps that file beside this one, preserving both licensing and provenance.
 */
export function wrapVendorCandidate(
  candidate: VendorCandidate,
  uploadedFileName: string,
  partNumber: string,
  instanceValue?: string
): { text: string; asy: string; includeName: string } {
  // A vendor's main declaration is commonly the part number itself. Giving
  // the adapter that same name would create a duplicate definition whose
  // Xvendor instance recursively calls the adapter instead of the vendor part.
  const wrapper = `${spiceName(partNumber)}_FORGE`;
  const includeName = quotedIncludeName(uploadedFileName);
  const ports = candidate.terminals.map((_, i) => `P${i + 1}`);
  const instances = candidate.kind === "subckt"
    ? [`Xvendor ${ports.join(" ")} ${candidate.name}`]
    : primitiveLines(candidate, instanceValue);
  const lines = [
    `* ${wrapper} adapter generated by Forge for a vendor-authored model.`,
    "* The vendor file is not copied or modified. Keep it beside this adapter.",
    `* Terminal order preserved from ${candidate.kind === "subckt" ? ".SUBCKT" : `.MODEL ${candidate.modelType}`} ${candidate.name}:`,
    `*   ${candidate.terminals.map((terminal, i) => `${i + 1}=${terminal}`).join(", ")}`,
    ...(candidate.instanceParameter ? [`* Instance ${candidate.instanceParameter}: ${spiceScalar(instanceValue, candidate.instanceParameter)}`] : []),
    `.include "${includeName}"`,
    `.subckt ${wrapper} ${ports.join(" ")}`,
    ...instances,
    `.ends ${wrapper}`,
    ""
  ];
  return { text: lines.join("\n"), asy: emitVendorAsy(partNumber, candidate.terminals, wrapper), includeName };
}

/** A neutral symbol: it preserves and displays terminal order without guessing function. */
export function emitVendorAsy(partNumber: string, terminals: string[], modelName = spiceName(partNumber)): string {
  const name = spiceName(partNumber);
  const half = Math.ceil(terminals.length / 2);
  const height = Math.max(64, (half + 1) * 32);
  const lines = [
    "Version 4",
    "SymbolType CELL",
    `RECTANGLE Normal 32 16 160 ${height}`,
    `TEXT 96 ${Math.max(24, Math.floor(height / 2) - 8)} Center 0 ${name}`,
    "SYMATTR Prefix X",
    `SYMATTR Value ${modelName}`,
    `SYMATTR SpiceModel ${modelName}`
  ];
  terminals.forEach((terminal, index) => {
    const left = index < half;
    const row = left ? index : index - half;
    const x = left ? 0 : 192;
    const y = 32 + row * 32;
    const orient = left ? "RIGHT" : "LEFT";
    lines.push(`PIN ${x} ${y} ${orient} 16`);
    lines.push(`PINATTR PinName ${terminal.replace(/[^A-Za-z0-9_+.$#-]/g, "_")}`);
    lines.push(`PINATTR SpiceOrder ${index + 1}`);
  });
  return `${lines.join("\n")}\n`;
}

/**
 * Wrap a vendor subcircuit behind Forge's canonical terminal order. Refuses an
 * unfamiliar or extra pin rather than guessing what it means.
 */
export function wrapVendorModel(
  text: string,
  deviceClass: DeviceClassId,
  wrapperName = "FORGE_VENDOR",
  candidateId?: string
): { text: string; originalName: string } {
  validateVendorModel(text, true);
  const all = inspectVendorModel(text).filter((candidate) => candidate.kind === "subckt");
  const compatible = all.filter((candidate) => mappedRoles(candidate, deviceClass) !== null);
  const selected = candidateId
    ? compatible.find((candidate) => candidate.id === candidateId)
    : compatible.length === 1 ? compatible[0] : undefined;
  if (!selected && compatible.length > 1) {
    throw new Error("More than one subcircuit has the required terminal contract. Choose the part-level declaration; Forge will not guess among helpers.");
  }
  if (!selected) {
    const pins = all[0]?.terminals ?? [];
    const roles = rolesFor(deviceClass);
    if (pins.length !== roles.length) {
      throw new Error(`The vendor model exposes ${pins.length} terminals; Forge can verify ${roles.length} for this class without guessing.`);
    }
    throw new Error(`The vendor model's terminal order could not be mapped without guessing: ${pins.join(" ")}.`);
  }
  const originalName = selected.name;
  const roles = rolesFor(deviceClass);
  const mapped = mappedRoles(selected, deviceClass)!;
  return {
    originalName,
    text: [
      text.trimEnd(),
      "",
      "* Forge verification wrapper; the vendor model above is unmodified.",
      `.subckt ${wrapperName} ${roles.join(" ")} CORNER=1`,
      `Xvendor ${mapped.join(" ")} ${originalName}`,
      `.ends ${wrapperName}`,
      ""
    ].join("\n")
  };
}
