/**
 * THE LOW-DROPOUT REGULATOR CLASS: its netlist, its symbol and its rig.
 *
 * ## The topology is the reference's, plus the one thing that makes it an LDO
 *
 * A regulator states the same two derivatives a voltage reference does, so the
 * body of the model is the same circuit `reference.ts` builds and for the same
 * reason: a source that moves with the input at the stated line slope, behind a
 * resistance equal to the stated load slope, IS those two statements.
 *
 * What a reference has no equivalent of is the PASS ELEMENT, and the dropout
 * voltage is the whole of what a datasheet says about it: below an input-to-
 * output headroom of Vdo the part stops regulating and the output follows the
 * input down, less that headroom. Written as a circuit that is one `min`:
 *
 *     VOUT = min( regulated value , VIN - Vdo )
 *
 * and it is the behaviour a person opens a regulator model to see. Simulating a
 * 3.3 V rail from a battery that sags to 3.4 V is the question; a model without
 * this answers it wrongly and confidently, which is the failure this whole
 * feature exists to refuse.
 *
 * ## The regulation terms are converted here, and the conversion is a READ
 *
 * A regulator does not print a slope. It prints a change and the range that
 * change was measured over, in the test conditions on the same row:
 *
 *     Line regulation   7 mV typ   VI = 7.5 to 25 V, IO = 500 mA
 *
 * so the slope is `7 mV / 17.5 V / VOUT`, and every one of those three numbers
 * is read off the page. Where the range cannot be read - RHFL4913 states
 * `VI = VO+2.5 V to 12 V`, whose low end depends on a value this row does not
 * carry - the term is NOT modelled and the header says so. Dividing by a range
 * this file guessed would be inventing an operating point.
 *
 * ## What is deliberately not modelled
 *
 * The current limit, the thermal shutdown and the start-up behaviour. A
 * datasheet states a current limit as a single number with no fold-back
 * characteristic, states a thermal shutdown as a junction temperature that is
 * not a node in this netlist, and states nothing at all about the control
 * loop's compensation. All three are on the record and none is simulated.
 */

import { toSpice } from "./units";
import { citationLines, spiceName } from "./emit";
import { rangeFromConditions } from "./conditions";
import { LDO, supportedCorners, usableAt, valueAt, type ModelBlock, type ModelParameter } from "./model";
import { runNgspice, TOLERANCE_PCT, type Check, type ConformanceReport } from "./verify";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** The `.subckt` port order, the `.asy` pin order and nothing else. */
export const LDO_TERMINALS = ["IN", "OUT", "GND"] as const;

export const LDO_TOPOLOGY =
  "behavioural low-dropout regulator (nominal output with the datasheet's own line-regulation slope on the input, limited by the stated dropout headroom, behind an output resistance equal to its load-regulation slope)";

const CORNER_INDEX: Record<"typ" | "min" | "max", number> = { typ: 1, min: 2, max: 3 };

/**
 * How far above its own dropout threshold the rig drives the part.
 *
 * One volt, which is larger than the spread between any corner's dropout and
 * the typical one on the six regulators measured, and small enough that the
 * line-regulation slope displaces the output by parts per million rather than
 * anything a check could see.
 */
const PROBE_HEADROOM_V = 1;

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
 * A regulation figure turned into the slope the netlist needs, or null.
 *
 * Three numbers, all read: the printed change, the range printed beside it, and
 * the nominal output. Null whenever any of them is missing, and the caller then
 * emits no term rather than a plausible one.
 *
 * `%` and `V` are both accepted by the record, and they are NOT the same
 * statement: a percent is already a fraction of the output and a millivolt is
 * not. `units.ts` has scaled the percent to a fraction by the time it arrives
 * here, so the only difference left is whether to divide by the output voltage.
 */
export function regulationSlope(
  block: ModelBlock,
  parameter: "lineRegulationOverRange" | "loadRegulationOverRange",
  corner: "typ" | "min" | "max"
): number | null {
  const value = block.values[parameter];
  const change = valueAt(block, parameter, corner);
  const nominal = valueAt(block, "outputVoltage", corner) ?? valueAt(block, "outputVoltage", "typ");
  if (!value || change === null || nominal === null || nominal === 0) return null;

  const span = rangeFromConditions(value.conditions, parameter === "lineRegulationOverRange" ? "input" : "load");
  if (span === null) return null;

  // The record holds `%` scaled to a fraction already; volts are absolute and
  // become a fraction only by dividing by the output the change was measured on.
  const fraction = value.unit && value.unit.includes("%") ? change : change / nominal;
  const slope = fraction / span;
  return Number.isFinite(slope) ? slope : null;
}

/** True when a regulation term can produce a slope at EVERY corner the block has. */
function slopeUsable(
  block: ModelBlock,
  parameter: "lineRegulationOverRange" | "loadRegulationOverRange",
  corners: Array<"typ" | "min" | "max"> = supportedCorners(block, LDO)
): boolean {
  if (!usableAt(block, parameter, corners)) return false;
  return corners.every((corner) => regulationSlope(block, parameter, corner) !== null);
}

function slopeExpression(
  block: ModelBlock,
  parameter: "lineRegulationOverRange" | "loadRegulationOverRange",
  corners: Array<"typ" | "min" | "max">
): string | null {
  const terms: string[] = [];
  for (const corner of corners) {
    const slope = regulationSlope(block, parameter, corner);
    if (slope === null) return null;
    terms.push(`(CORNER==${CORNER_INDEX[corner]})*${toSpice(slope)}`);
  }
  return terms.join(" + ");
}

/**
 * The supply the line-regulation slope is anchored at.
 *
 * A slope has no absolute reference point. The reference class anchors at the
 * minimum supply the datasheet states; a regulator usually states no supply
 * range as such, so the fallback is the LOWEST INPUT THE REGULATION FIGURE WAS
 * MEASURED AT, which is on the row itself and is therefore still read rather
 * than chosen. Null when neither is available, and the line term is then left
 * out entirely.
 */
export function ldoAnchor(block: ModelBlock): number | null {
  const supply = block.values.supplyVoltage;
  const stated = supply?.si.min ?? supply?.si.typ ?? null;
  if (stated !== null) return stated;
  // The dropout is the headroom, so nominal + dropout is the lowest input at
  // which this part is still in regulation. It is arithmetic on two values the
  // document states, not a chosen operating point.
  const nominal = valueAt(block, "outputVoltage", "typ");
  const dropout = valueAt(block, "dropoutVoltage", "typ") ?? valueAt(block, "dropoutVoltage", "max");
  if (nominal === null || dropout === null) return null;
  return nominal + dropout;
}

export function emitLdoSubckt(block: ModelBlock, options: { partNumber: string; datasheet?: string }): string {
  const corners = supportedCorners(block, LDO);
  const name = spiceName(options.partNumber);
  const has = (p: ModelParameter) => usableAt(block, p, corners);
  const anchor = ldoAnchor(block);
  const hasLine = slopeUsable(block, "lineRegulationOverRange") && anchor !== null;
  const hasLoad = slopeUsable(block, "loadRegulationOverRange");
  const lines: string[] = [];

  lines.push(`* ${name} behavioural SPICE model, generated by Forge.`);
  lines.push("*");
  lines.push(`* Topology: ${LDO_TOPOLOGY}.`);
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
  lines.push(...citationLines(block, has, 24));

  // A REGULATION FIGURE THAT WAS READ AND COULD NOT BE USED IS SAID SO, BY NAME.
  //
  // "Not stated" and "stated in a form this could not turn into a slope" are
  // different facts about the document, and telling a user the first when the
  // second is true sends them looking for a row that is on the page.
  for (const [parameter, label] of [
    ["lineRegulationOverRange", "line regulation"],
    ["loadRegulationOverRange", "load regulation"]
  ] as const) {
    if (!has(parameter)) {
      lines.push("*");
      lines.push(`* The ${label} is NOT modelled: this datasheet does not state it.`);
      continue;
    }
    if (!slopeUsable(block, parameter)) {
      lines.push("*");
      lines.push(`* The ${label} was READ but is NOT modelled: turning a change into a`);
      lines.push("* slope needs the range it was measured over, and this row's test");
      lines.push(`* conditions (${block.values[parameter]!.conditions ?? "none printed"})`);
      lines.push("* do not state one this reader can evaluate. Nothing was assumed.");
    }
  }
  if (hasLine) {
    lines.push("*");
    lines.push(`* The output is anchored at VIN = ${anchor} V and moves from there at the`);
    lines.push("* stated line-regulation slope. Where the datasheet states a supply");
    lines.push("* minimum the anchor is that; otherwise it is the nominal output plus the");
    lines.push("* stated dropout, which is the lowest input at which this part regulates.");
  }
  if (has("lineRegulationOverRange") && slopeUsable(block, "lineRegulationOverRange") && anchor === null) {
    lines.push("*");
    lines.push("* The line regulation was READ but is NOT modelled: a slope needs an");
    lines.push("* anchor and this datasheet states neither a supply minimum nor enough");
    lines.push("* to derive one.");
  }
  lines.push("*");
  lines.push("* NOT MODELLED: the current limit, the thermal shutdown and the start-up");
  lines.push("* behaviour. A datasheet states the first as one number with no fold-back");
  lines.push("* characteristic, the second as a junction temperature that is not a node");
  lines.push("* in this netlist, and nothing at all about the control loop. They are on");
  lines.push("* the record and none of them is simulated.");
  lines.push("*");
  if (corners.length > 1) {
    const highest = Math.max(...corners.map((c) => CORNER_INDEX[c]));
    lines.push(`* Corners: ${corners.map((c) => `${CORNER_INDEX[c]}=${c}`).join(", ")}. Default is typical.`);
    lines.push("* To sweep them, add to your schematic:");
    lines.push("*     .param CORNER=1");
    lines.push(`*     .step param CORNER 1 ${highest} 1`);
    lines.push(`* and instantiate as:  Xu1 ${LDO_TERMINALS.join(" ")} ${name} CORNER={CORNER}`);
  }
  lines.push("");

  lines.push(`.subckt ${name} ${LDO_TERMINALS.join(" ")} CORNER=1`);
  for (const parameter of Object.keys(block.values) as ModelParameter[]) {
    if (!has(parameter)) continue;
    // The two regulation terms go in as SLOPES, not as the change the page
    // printed, because a change is meaningless without the range beside it.
    if (parameter === "lineRegulationOverRange" || parameter === "loadRegulationOverRange") continue;
    const expression = cornerExpression(block, parameter, corners);
    if (expression) lines.push(`.param ${parameter}={${expression}}`);
  }
  if (hasLine) lines.push(`.param lineSlope={${slopeExpression(block, "lineRegulationOverRange", corners)}}`);
  if (hasLoad) lines.push(`.param loadSlope={${slopeExpression(block, "loadRegulationOverRange", corners)}}`);

  const lineTerm = hasLine ? `*(1 + {lineSlope}*(V(IN,GND) - ${toSpice(anchor!)}))` : "";
  // THE DROPOUT, and it is the whole reason this class is not the reference.
  //
  // `min` is plain SPICE and means the same thing in ngspice and LTspice. The
  // parameter is braced and the expression is not: LTspice rejects a braced
  // expression with "Questionable use of curly braces" while ngspice accepts
  // both, so a file verified only under ngspice can be one the customer's tool
  // refuses.
  lines.push(`Bref nref GND V=min({outputVoltage}${lineTerm}, V(IN,GND)-{dropoutVoltage})`);

  if (hasLoad) {
    // The load slope is a fractional change per amp, so the resistance it
    // describes is that slope times the nominal output.
    lines.push(".param ROUT={outputVoltage*loadSlope}");
    lines.push("Rout nref OUT {ROUT}");
  } else {
    // A zero-ohm resistor would be a CLAIM of a perfect output impedance as
    // well as an element some simulators warn on. A zero-volt source ties the
    // nodes and is the ordinary SPICE idiom for it.
    lines.push("Vout nref OUT 0");
  }
  if (has("quiescentCurrent")) lines.push("Biq IN GND I={quiescentCurrent}");
  lines.push(".ends");
  lines.push("");
  return lines.join("\n");
}

/** The LTspice symbol. Pin order derives from `LDO_TERMINALS`. */
export function emitLdoAsy(partNumber: string): string {
  const name = spiceName(partNumber);
  const geometry: Record<(typeof LDO_TERMINALS)[number], { x: number; y: number; label: string }> = {
    IN: { x: -32, y: 0, label: "LEFT" },
    OUT: { x: 32, y: 0, label: "RIGHT" },
    GND: { x: 0, y: 32, label: "BOTTOM" }
  };
  const lines = [
    "Version 4",
    "SymbolType CELL",
    "RECTANGLE Normal -32 -32 32 32",
    "WINDOW 0 0 -40 Bottom 2",
    "WINDOW 3 0 40 Top 2",
    "SYMATTR Prefix X",
    `SYMATTR Value ${name}`,
    `SYMATTR SpiceModel ${name}`,
    `SYMATTR Description ${name} behavioural low-dropout regulator generated by Forge`
  ];
  LDO_TERMINALS.forEach((terminal, index) => {
    const spot = geometry[terminal];
    lines.push(`PIN ${spot.x} ${spot.y} ${spot.label} 8`);
    lines.push(`PINATTR PinName ${terminal}`);
    lines.push(`PINATTR SpiceOrder ${index + 1}`);
  });
  return lines.join("\n") + "\n";
}

function parse(output: string, pattern: RegExp): number | null {
  const match = output.match(pattern);
  if (!match) return null;
  const value = Number.parseFloat(match[1]);
  return Number.isFinite(value) ? value : null;
}

/**
 * The conformance deck.
 *
 * Four DC operating points. A and B differ only in the input voltage and give
 * the line slope; A and C differ only in the load and give the load slope; D
 * sits deliberately BELOW the dropout headroom, which is the one thing this
 * class exists to reproduce and the one thing no reference deck can test.
 *
 * As in `reference.ts`, the differences are taken INSIDE the simulator. Both
 * regulation terms are differences between two nearly equal voltages, and
 * printing the two and subtracting them here throws away every digit the answer
 * lives in: measured on the reference class, a stated 1.0 ppm/V came back as
 * 0.8 ppm/V, a 20% error that was entirely the printed precision.
 */
function deck(
  subckt: string,
  name: string,
  corner: number,
  anchor: number,
  probeCurrent: number,
  belowDropout: number
): string {
  return [
    `* Forge conformance deck for ${name}, corner ${corner}`,
    subckt,
    `Xa in_a out_a 0 ${name} CORNER=${corner}`,
    `Xb in_b out_b 0 ${name} CORNER=${corner}`,
    `Xc in_c out_c 0 ${name} CORNER=${corner}`,
    `Xd in_d out_d 0 ${name} CORNER=${corner}`,
    `Vin_a in_a 0 DC ${toSpice(anchor)}`,
    `Vin_b in_b 0 DC ${toSpice(anchor + 1)}`,
    `Vin_c in_c 0 DC ${toSpice(anchor)}`,
    `Vin_d in_d 0 DC ${toSpice(belowDropout)}`,
    `Iload out_c 0 DC ${toSpice(probeCurrent)}`,
    ".control",
    "op",
    "let dline = v(out_b)-v(out_a)",
    "let dload = v(out_a)-v(out_c)",
    // THE HEADROOM ACTUALLY LEFT at an input below the dropout. In regulation
    // this would be whatever the input happens to be above the output; out of
    // regulation it is the dropout itself, which is what the datasheet states.
    "let headroom = v(in_d)-v(out_d)",
    "print v(out_a)",
    "print dline",
    "print dload",
    "print headroom",
    "print i(Vin_a)",
    ".endc",
    ".end",
    ""
  ].join("\n");
}

/** What a generic DC rig can measure on a regulator, and nothing else. */
const MEASURABLE: ModelParameter[] = [
  "outputVoltage",
  "dropoutVoltage",
  "lineRegulationOverRange",
  "loadRegulationOverRange",
  "quiescentCurrent"
];

/**
 * Runs the regulator model and compares it against the values it was built from.
 *
 * Never throws. A missing simulator reports every check `unverifiable` with the
 * reason, because a product that cannot verify is a worse product, not a broken
 * one.
 */
export async function verifyLdo(
  subckt: string,
  block: ModelBlock,
  partNumber: string,
  corners: Array<"typ" | "min" | "max">
): Promise<ConformanceReport> {
  const name = spiceName(partNumber);
  const checks: Check[] = [];
  const directory = await mkdtemp(join(tmpdir(), "forge-spice-ldo-"));
  const anchor = ldoAnchor(block);
  /** 1 mA, which is inside every load range this class states. */
  const probeCurrent = 1e-3;
  let simulatorMissing = false;

  const unverifiable = (parameter: ModelParameter, corner: "typ" | "min" | "max", reason: string) => {
    if (!usableAt(block, parameter, corners)) return;
    const expected = valueAt(block, parameter, corner);
    if (expected !== null) checks.push({ parameter, corner, expected, measured: null, verdict: "unverifiable", reason, errorPct: null });
  };

  try {
    for (const corner of corners) {
      const nominal = valueAt(block, "outputVoltage", corner);
      const dropout = valueAt(block, "dropoutVoltage", corner);
      if (nominal === null || dropout === null) continue;
      // THE PROBE MUST CLEAR THE DROPOUT AT EVERY CORNER, not at this one.
      //
      // The anchor is a single voltage shared by all three corners, and it is
      // the nominal plus the TYPICAL dropout. At the max corner the dropout is
      // larger, so probing at the anchor put the model exactly at or below its
      // own regulation threshold, `min` took the pass-element branch, and the
      // output came back as the input minus a headroom. Measured on LD1117:
      // 1.100 V against a stated 1.212, and the line and load regulation both
      // failed with it because they are differences taken from that same point.
      //
      // So the probe clears the WORST corner's threshold and then some. The
      // cost is that the line-regulation slope displaces the output slightly
      // from nominal - by parts per million, which is three orders of magnitude
      // inside the tolerance, and is a real property of the model rather than
      // an artefact of the rig.
      const threshold = Math.max(
        ...corners.map((c) => (valueAt(block, "outputVoltage", c) ?? 0) + (valueAt(block, "dropoutVoltage", c) ?? 0))
      );
      const probeInput = Math.max(anchor ?? 0, threshold) + PROBE_HEADROOM_V;
      // HALF THE HEADROOM, so the part is unambiguously out of regulation. Any
      // input below nominal + dropout would do; this one is far enough in that
      // a rounding difference cannot put the operating point back over the line.
      const belowDropout = nominal + dropout / 2;
      const file = join(directory, `${name}-${corner}.cir`);
      await writeFile(file, deck(subckt, name, CORNER_INDEX[corner], probeInput, probeCurrent, belowDropout), "utf8");
      const { stdout, ok } = await runNgspice(file);
      if (!ok) {
        simulatorMissing = true;
        for (const parameter of MEASURABLE) unverifiable(parameter, corner, "ngspice is not available on this host");
        continue;
      }

      const outA = parse(stdout, /v\(out_a\)\s*=\s*([-\d.eE+]+)/);
      const dLine = parse(stdout, /\bdline\s*=\s*([-\d.eE+]+)/);
      const dLoad = parse(stdout, /\bdload\s*=\s*([-\d.eE+]+)/);
      const headroom = parse(stdout, /\bheadroom\s*=\s*([-\d.eE+]+)/);
      const supplyCurrent = parse(stdout, /i\(vin_a\)\s*=\s*([-\d.eE+]+)/);

      // The two regulation terms are compared in the units THE RECORD holds
      // them in, which is what the page printed: a change over the stated
      // range, in volts or as a fraction of the output. Measuring a slope and
      // comparing it against a printed change would be comparing two different
      // quantities and calling the difference a defect.
      const lineSpan = rangeFromConditions(block.values.lineRegulationOverRange?.conditions ?? null, "input");
      const loadSpan = rangeFromConditions(block.values.loadRegulationOverRange?.conditions ?? null, "load");
      const asPrinted = (
        parameter: "lineRegulationOverRange" | "loadRegulationOverRange",
        perVolt: number | null,
        span: number | null
      ): number | null => {
        if (perVolt === null || span === null || outA === null || outA === 0) return null;
        const change = perVolt * span;
        return block.values[parameter]?.unit?.includes("%") ? change / outA : change;
      };

      const measured: Partial<Record<ModelParameter, number | null>> = {
        outputVoltage: outA,
        // Out of regulation the model follows the input down, so the headroom
        // it leaves IS the dropout the datasheet stated.
        dropoutVoltage: headroom,
        lineRegulationOverRange: anchor === null ? null : asPrinted("lineRegulationOverRange", dLine, lineSpan),
        loadRegulationOverRange: asPrinted("loadRegulationOverRange", dLoad === null ? null : dLoad / probeCurrent, loadSpan),
        quiescentCurrent: supplyCurrent === null ? null : Math.abs(supplyCurrent)
      };

      for (const parameter of MEASURABLE) {
        if (!usableAt(block, parameter, corners)) continue;
        const expected = valueAt(block, parameter, corner);
        if (expected === null) continue;
        const value = measured[parameter] ?? null;
        if (value === null) {
          unverifiable(
            parameter,
            corner,
            parameter === "lineRegulationOverRange" && anchor === null
              ? "this datasheet states no supply minimum and none can be derived, so the line-regulation slope has no anchor and is not in the model"
              : (parameter === "lineRegulationOverRange" && lineSpan === null) ||
                  (parameter === "loadRegulationOverRange" && loadSpan === null)
                ? "the test conditions do not state the range this figure was measured over, so it is not in the model"
                : "the simulation produced no value for this measurement"
          );
          continue;
        }
        const errorPct = expected === 0 ? (value === 0 ? 0 : 100) : Math.abs((value - expected) / expected) * 100;
        checks.push({
          parameter,
          corner,
          expected,
          measured: value,
          verdict: errorPct <= TOLERANCE_PCT ? "pass" : "fail",
          reason: errorPct <= TOLERANCE_PCT ? undefined : `measured ${value.toPrecision(4)} against a stated ${expected.toPrecision(4)}`,
          errorPct
        });
      }
    }
  } finally {
    await rm(directory, { recursive: true, force: true }).catch(() => {});
  }

  return { checks, simulatorMissing };
}
