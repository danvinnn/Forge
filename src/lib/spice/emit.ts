/**
 * Writing the model and its symbol.
 *
 * Deterministic templating over values already read and confirmed. No model
 * writes this text: a language model asked to produce a netlist will produce a
 * plausible one, and plausible is the failure this product exists to refuse.
 *
 * ## Two traps that reach the emitted file
 *
 * **`Meg` versus `m`.** In SPICE `Meg` is 1e6 and `m` is 1e-3, and suffixes are
 * NOT case sensitive, so `1M` is a milli. Every value here is written in
 * exponential notation, which carries no suffix and cannot be misread.
 *
 * **Brace the parameter, never the expression.** Measured against LTspice
 * 17.2.4: `I={GM*V(a,b)}` is rejected with "Questionable use of curly braces",
 * while `I={GM}*V(a,b)` is accepted by both LTspice and ngspice. ngspice accepts
 * BOTH, so a file verified only under ngspice can be one LTspice refuses. This
 * is the `bench:kicad` lesson: an independent reader is not the customer's tool.
 */

import { toSpice } from "./units";
import { OPAMP, supportedCorners, usableAt, valueAt, type ModelBlock, type ModelParameter } from "./model";

/**
 * THE ONE TERMINAL LIST.
 *
 * The `.subckt` port order, the `.asy` pin order and the CAD symbol all derive
 * from this array. Two artefacts from one tool disagreeing about pin order is
 * the worst failure available here and it is silent, so the orderings are three
 * views of one list rather than three independent claims.
 */
export const TERMINALS = ["IN+", "IN-", "OUT", "VCC", "VEE"] as const;
export type Terminal = (typeof TERMINALS)[number];

/**
 * A part number as a SPICE identifier.
 *
 * A HYPHEN IS A MINUS SIGN in SPICE. `.subckt LMP7704-SP ...` is not a
 * definition of `LMP7704-SP`, and ngspice silently fails to register it: the
 * following `.param` lines are then absorbed into the instance line and the
 * netlist reports "unknown subckt". Every rad-hard part number this product
 * targets ends in `-SP`, so this would have broken the entire segment.
 *
 * Defined once and used by the subcircuit, the symbol and the verifier, so the
 * three cannot disagree about what the model is called.
 */
export function spiceName(partNumber: string): string {
  return partNumber.replace(/[^A-Za-z0-9_]/g, "_");
}

/** The published macromodel this product emits, named so it can be cited. */
export const TOPOLOGY = "single-pole behavioural op-amp macromodel (offset source, slew-limited transconductance into a dominant pole, output behind Zo)";

const CORNER_INDEX: Record<"typ" | "min" | "max", number> = { typ: 1, min: 2, max: 3 };

/** `(CORNER==1)*a + (CORNER==2)*b + ...` over the corners this block has. */
function cornerExpression(block: ModelBlock, parameter: ModelParameter, corners: Array<"typ" | "min" | "max">): string | null {
  const terms: string[] = [];
  for (const corner of corners) {
    const value = valueAt(block, parameter, corner);
    if (value === null) return null;
    terms.push(`(CORNER==${CORNER_INDEX[corner]})*${toSpice(value)}`);
  }
  return terms.join(" + ");
}

/**
 * Corrections solved for so that the model's LOADED behaviour reproduces the
 * datasheet's stated numbers under the datasheet's stated conditions.
 *
 * A datasheet parameter is measured AT THE PINS, UNDER A LOAD. OPA333's 350 kHz
 * is specified into 100 pF and its open-loop output impedance is 2 kOhm, so the
 * printed number already contains a divider and an extra pole. Substituting it
 * as the model's INTERNAL bandwidth produces a part that is 20% slow at its
 * pins: measured, 279.9 kHz against a stated 350 kHz.
 *
 * Solving for the internal value that reproduces the printed one is not
 * invention. The TARGET of the fit is the document's own number, so RULES.md 1
 * is answered exactly as before, and TI does the same thing by hand: their
 * OPA333 changelog reads "Updated Aol to match the GBW and UGB as per the
 * datasheet".
 *
 * The trims are emitted as their own named parameters so the datasheet's values
 * stay legible in the file and the correction is auditable rather than baked in.
 */
export interface Trim {
  /** Added to the open-loop gain in dB. */
  gainDb: number;
  /** Multiplies the gain-bandwidth product. */
  gbw: number;
}

export const NO_TRIM: Trim = { gainDb: 0, gbw: 1 };

export interface EmitOptions {
  partNumber: string;
  /** Pages the values were read from, for the file header. */
  datasheet?: string;
  trim?: Trim;
}

/**
 * The `.subckt` library text.
 *
 * A parameter the document did not state produces NO element rather than a
 * default: no offset source when no offset voltage was read, no output
 * resistance when none was printed, no supply current draw when none was given.
 * The header says which, so the file is honest about what it does not model.
 */
/**
 * WHERE A VALUE CAME FROM, in the one form every emitter prints.
 *
 * Four emitters wrote this line and each one built the citation itself, which is
 * three extra places for the same fact to be rendered differently. It became a
 * correctness question the day a value could come from somewhere other than a
 * page: a number the USER supplied has no page, and `page null` in a header is
 * this product fabricating a citation, which is the one thing it exists not to
 * do.
 */
export function citeValue(value: { page: number | null; conditions: string | null; suppliedByUser?: boolean }): string {
  const source = value.page === null ? "supplied by you, not stated by this datasheet" : `page ${value.page}`;
  return value.conditions ? `${source}, ${value.conditions}` : source;
}

/**
 * The block of citation lines every emitted netlist opens with.
 *
 * One implementation for all four device classes, for the reason above: this is
 * the part of the file an engineer reads to decide whether to trust it, and four
 * copies of it is four chances for one of them to stop saying where a number
 * came from.
 */
export function citationLines(
  block: ModelBlock,
  usableHere: (parameter: ModelParameter) => boolean,
  width = 18
): string[] {
  const used = (Object.keys(block.values) as ModelParameter[]).filter(usableHere);
  const supplied = used.filter((p) => block.values[p]!.page === null);
  const lines: string[] = [];
  lines.push(
    supplied.length === 0
      ? "* Parameters read, with the page each came from:"
      : "* Parameters used, with where each came from:"
  );
  for (const parameter of used) {
    const value = block.values[parameter]!;
    const printed = (["min", "typ", "max"] as const)
      .filter((c) => value.printed[c] !== null)
      .map((c) => `${c} ${value.printed[c]}`)
      .join(", ");
    // The micro/milli ambiguity travels with the value rather than being
    // guessed, so it has to be visible in the file the customer opens and not
    // only in the report they may not read.
    const ambiguous = value.ambiguousMicro ? "  [UNIT AMBIGUOUS, see report]" : "";
    lines.push(`*   ${parameter.padEnd(width)} ${printed} ${value.unit}  (${citeValue(value)})${ambiguous}`);
  }
  // SAID TWICE, ONCE IN PLAIN WORDS. The per-line citation is exact and easy to
  // skim past; whether any of this model rests on something nobody read is the
  // first question an engineer has about a generated file.
  if (supplied.length > 0) {
    lines.push("*");
    lines.push(`* ${supplied.join(", ")} ${supplied.length === 1 ? "was" : "were"} SUPPLIED, not read.`);
    lines.push("* This datasheet does not state it anywhere, so it was asked for. Every");
    lines.push("* other number above is quoted from the page beside it.");
  }
  return lines;
}

export function emitSubckt(block: ModelBlock, options: EmitOptions): string {
  const corners = supportedCorners(block, OPAMP);
  const name = spiceName(options.partNumber);
  const lines: string[] = [];

  // Usability, not mere presence: a parameter that cannot produce a value at
  // every corner must not be referenced by the netlist.
  const has = (p: ModelParameter) => usableAt(block, p, corners);
  const expr = (p: ModelParameter) => cornerExpression(block, p, corners);

  lines.push(`* ${name} behavioural SPICE model, generated by Forge.`);
  lines.push("*");
  lines.push(`* Topology: ${TOPOLOGY}.`);
  lines.push("* The topology is a constant of the generator and is not read from the");
  // NOT "every parameter below is read from the datasheet", which stopped being
  // true the day a user could supply one. Each line says where it came from and
  // a supplied value says so in words; the preamble points at that rather than
  // making a blanket claim it cannot keep.
  lines.push("* document. Every PARAMETER below says where it came from.");
  lines.push("*");
  if (options.datasheet) lines.push(`* Datasheet: ${options.datasheet}`);
  if (block.scope) lines.push(`* Specification block: ${block.scope}`);
  if (block.group) lines.push(`* Grade: ${block.group}`);
  lines.push("*");
  lines.push(...citationLines(block, has));
  const absent = (["slewRate", "offsetVoltage", "quiescentCurrent", "openLoopOutputZ"] as ModelParameter[]).filter((p) => !has(p));
  if (absent.length > 0) {
    lines.push("*");
    lines.push(`* NOT MODELLED, because the datasheet does not state them: ${absent.join(", ")}.`);
    lines.push("* Nothing is assumed in their place. The model does not reproduce them.");
  }
  lines.push("*");
  if (corners.length > 1) {
    const highest = Math.max(...corners.map((c) => CORNER_INDEX[c]));
    lines.push(`* Corners: ${corners.map((c) => `${CORNER_INDEX[c]}=${c}`).join(", ")}. Default is typical.`);
    lines.push("* To sweep them, add to your schematic:");
    lines.push("*     .param CORNER=1");
    lines.push(`*     .step param CORNER 1 ${highest} 1`);
    lines.push(`* and instantiate as:  Xu1 ${TERMINALS.join(" ")} ${name} CORNER={CORNER}`);
    lines.push("* Which corner is worst depends on YOUR circuit, so none is chosen here.");
  }
  lines.push("");

  const trim = options.trim ?? NO_TRIM;

  // EVERY PARAMETER IS LOCAL TO THE SUBCIRCUIT.
  //
  // Declared globally, two Forge models in one schematic collide: LTspice stops
  // with "Fatal Error: Duplicate definitions for gbw_trim". A board with two
  // op-amps on it is the ordinary case, so a model that cannot sit beside
  // another is not a usable artefact. It shows up only when two are included,
  // which is why it survived every single-part test.
  //
  // CORNER is a subcircuit parameter with a default rather than a global, for
  // the same reason. The header says how to sweep it.
  lines.push(`.subckt ${name} ${TERMINALS.join(" ")} CORNER=1`);
  for (const parameter of Object.keys(block.values) as ModelParameter[]) {
    if (!has(parameter)) continue;
    const expression = expr(parameter);
    if (expression) lines.push(`.param ${parameter}={${expression}}`);
  }
  if (trim.gainDb !== 0 || trim.gbw !== 1) {
    lines.push("* Solved so the LOADED response reproduces the values above.");
  }
  lines.push(`.param GAIN_TRIM_DB=${toSpice(trim.gainDb)}`);
  lines.push(`.param GBW_TRIM=${toSpice(trim.gbw)}`);
  lines.push(".param GM=1e-3");
  lines.push(".param AOLV={pow(10, (openLoopGain+GAIN_TRIM_DB)/20)}");
  lines.push(".param RP={AOLV/GM}");
  lines.push(".param CP={1/(2*3.14159265358979*RP*(gbw*GBW_TRIM/AOLV))}");

  const inputNode = has("offsetVoltage") ? "ninp" : "IN+";
  if (has("offsetVoltage")) lines.push("Vos ninp IN+ {offsetVoltage}");

  if (has("slewRate")) {
    lines.push(".param IMAX={slewRate*CP}");
    // Brace the parameter, never the whole expression: LTspice rejects the latter.
    lines.push(`Bgm 0 n1 I={IMAX}*tanh({GM}*V(${inputNode},IN-)/{IMAX})`);
  } else {
    lines.push(`Bgm 0 n1 I={GM}*V(${inputNode},IN-)`);
  }
  lines.push("R1 n1 0 {RP}");
  lines.push("C1 n1 0 {CP}");

  if (has("openLoopOutputZ")) {
    lines.push("Eb nb 0 n1 0 1");
    lines.push("Rout nb OUT {openLoopOutputZ}");
  } else {
    lines.push("Eb OUT 0 n1 0 1");
  }
  if (has("quiescentCurrent")) lines.push("Biq VCC VEE I={quiescentCurrent}");
  lines.push(".ends");
  lines.push("");
  return lines.join("\n");
}

/**
 * The LTspice symbol.
 *
 * `SpiceOrder` is what binds a symbol pin to a `.subckt` port, and it counts
 * from 1 in the order the ports are declared. Deriving both from `TERMINALS` is
 * what makes them impossible to disagree.
 */
export function emitAsy(partNumber: string): string {
  const name = spiceName(partNumber);
  // A conventional op-amp triangle on LTspice's 16-unit grid.
  const geometry: Record<Terminal, { x: number; y: number; label: string }> = {
    "IN+": { x: -32, y: -32, label: "LEFT" },
    "IN-": { x: -32, y: 32, label: "LEFT" },
    OUT: { x: 32, y: 0, label: "RIGHT" },
    VCC: { x: 0, y: -32, label: "TOP" },
    VEE: { x: 0, y: 32, label: "BOTTOM" }
  };
  const lines = [
    "Version 4",
    "SymbolType CELL",
    "LINE Normal -32 -48 -32 48",
    "LINE Normal -32 48 32 0",
    "LINE Normal 32 0 -32 -48",
    "WINDOW 0 16 -32 Left 2",
    "WINDOW 3 16 32 Left 2",
    "SYMATTR Prefix X",
    `SYMATTR Value ${name}`,
    `SYMATTR SpiceModel ${name}`,
    `SYMATTR Description ${name} behavioural model generated by Forge`
  ];
  TERMINALS.forEach((terminal, index) => {
    const spot = geometry[terminal];
    lines.push(`PIN ${spot.x} ${spot.y} ${spot.label} 8`);
    lines.push(`PINATTR PinName ${terminal}`);
    lines.push(`PINATTR SpiceOrder ${index + 1}`);
  });
  return lines.join("\n") + "\n";
}
