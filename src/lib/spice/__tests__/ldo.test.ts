/**
 * THE LOW-DROPOUT REGULATOR CLASS.
 *
 * Two properties carry most of the weight here, and each one is a defect this
 * class actually produced before it was asserted:
 *
 * 1. **A regulation figure is not a slope until the range is read.** A
 *    reference states `1 ppm/V` and a regulator states `50 mV` over an input
 *    range printed beside it. Reading the second into the first is a factor of
 *    fifty thousand on a model that simulates perfectly.
 *
 * 2. **A class is chosen from what the document states, and sometimes from what
 *    its presence rules out.** RHFL4913A was built as a COMPARATOR, because a
 *    regulator prints the timing of its inhibit pin as `tPHL` and `tPLH`.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readBlocks, buildable, cornersOf, disqualifies, COMPARATOR, LDO, REFERENCE } from "../model";
import { emitLdoAsy, emitLdoSubckt, ldoAnchor, regulationSlope, LDO_TERMINALS } from "../ldo";
import { rangeFromConditions } from "../conditions";
import { parseUnit } from "../units";
import type { SpecRow } from "../specs";

function row(
  key: string,
  parameter: string,
  values: Partial<SpecRow["values"]>,
  unit: string,
  conditions: string | null = null
): SpecRow {
  return {
    parameter,
    key,
    symbol: null,
    conditions,
    unit,
    values: { min: null, typ: null, max: null, ...values },
    group: null,
    scope: null,
    page: 6
  };
}

/** A 5 V fixed regulator, in the shape L7805 actually prints. */
const LDO_ROWS: SpecRow[] = [
  row("outputVoltage", "Output voltage", { min: 4.9, typ: 5, max: 5.1 }, "V", "TJ = 25 °C"),
  row("dropoutVoltage", "Dropout voltage", { typ: 2 }, "V", "IO = 1 A, TJ = 25 °C"),
  row("lineRegulationOverRange", "Line regulation", { typ: 7, max: 50 }, "mV", "VI = 7.5 to 25 V, IO = 500 mA"),
  row("loadRegulationOverRange", "Load regulation", { typ: 30, max: 100 }, "mV", "IO = 5 mA to 1.5 A"),
  row("quiescentCurrent", "Quiescent current", { typ: 4.3, max: 6 }, "mA", "TJ = 25 °C")
];

// --- the range, which is what makes a regulation figure mean anything --------

test("a stated range is read from the conditions, in the units the vendor printed", () => {
  assert.equal(rangeFromConditions("VI = 7.5 to 25 V, IO = 500 mA", "input"), 17.5);
  assert.equal(rangeFromConditions("Vin = 3.3 to 8 V, IO = 0 mA", "input"), 4.7);
  // ΔVIN and `Vin - VO` both name the same span.
  assert.equal(rangeFromConditions("ΔVIN = 2.9 to 20 V, ILOAD = 1 mA", "input"), 17.1);
  assert.equal(rangeFromConditions("Vin - VO = 1.5 to 13.75 V, IO = 10 mA", "input"), 12.25);
});

test("the LOAD range and the INPUT range are not interchangeable", () => {
  // A row states both. Taking the wrong one divides a load-regulation figure by
  // a 17.5 V span, and the answer is wrong by whatever the ratio happens to be.
  const conditions = "VI = 7.5 to 25 V, IO = 5 mA to 1.5 A";
  assert.equal(rangeFromConditions(conditions, "input"), 17.5);
  assert.equal(rangeFromConditions(conditions, "load"), 1.495);
  // A row stating only one of them yields nothing for the other.
  assert.equal(rangeFromConditions("VI = 7.5 to 25 V, IO = 500 mA", "load"), null);
});

test("a unit printed once, on the second number, governs both", () => {
  // `IO = 250 to 750 mA` means both are milliamps. Reading the first as bare
  // amps is a factor of a thousand, on the wrong side of a division.
  assert.equal(rangeFromConditions("IO = 250 to 750 mA", "load"), 0.5);
  assert.equal(rangeFromConditions("IO = 5 mA to 1.5 A", "load"), 1.495);
});

test("a range this reader cannot evaluate produces nothing, not an approximation", () => {
  // RHFL4913 states `VI = VO+2.5 V to 12 V`. The low end depends on a value
  // this row does not carry. There is a plausible arithmetic to be done and it
  // is not done: that is how a reader starts inventing operating points.
  assert.equal(rangeFromConditions("VI = VO+2.5 V to 12 V, IO = 5 mA", "input"), null);
  // A temperature range is not an input range, however it is written.
  assert.equal(rangeFromConditions("TJ = -55 to 125 °C", "input"), null);
  // A hyphen is not a range separator: `Vin - VO` already contains one that is
  // a subtraction and `-55 to +125` contains two that are signs.
  assert.equal(rangeFromConditions("VI = 5 - 12 V", "input"), null);
  // A zero span would divide a real figure by nothing.
  assert.equal(rangeFromConditions("IO = 5 mA to 5 mA", "load"), null);
  assert.equal(rangeFromConditions(null, "load"), null);
});

test("a range whose unit is the wrong dimension is not that range", () => {
  // The name is checked AND the unit is. A clause called `IO` that parses in
  // volts is not a load range, whatever the vendor meant by it.
  assert.equal(rangeFromConditions("IO = 1 to 5 V", "load"), null);
  assert.equal(rangeFromConditions("VI = 1 to 5 A", "input"), null);
});

// --- the conversion, and the three numbers it is made of ---------------------

test("a change in millivolts becomes a slope only with the range and the output", () => {
  const block = readBlocks(LDO_ROWS)[0];
  // 7 mV over a 17.5 V input span on a 5 V output: 7e-3 / 17.5 / 5.
  const line = regulationSlope(block, "lineRegulationOverRange", "typ")!;
  assert.ok(Math.abs(line - 7e-3 / 17.5 / 5) < 1e-12, `${line}`);
  // 30 mV over a 1.495 A load span on a 5 V output.
  const load = regulationSlope(block, "loadRegulationOverRange", "typ")!;
  assert.ok(Math.abs(load - 30e-3 / 1.495 / 5) < 1e-12, `${load}`);
});

test("a percentage is ALREADY a fraction of the output and is not divided by it again", () => {
  // LD1117 states `0.035 %` where L7805 states `7 mV`. Treating the first like
  // the second divides by the output voltage twice.
  const rows = [
    row("outputVoltage", "Output voltage", { typ: 1.2 }, "V"),
    row("dropoutVoltage", "Dropout voltage", { typ: 1.05 }, "V"),
    row("lineRegulationOverRange", "Line regulation", { typ: 0.035 }, "%", "Vin - VO = 1.5 to 13.75 V")
  ];
  const block = readBlocks(rows)[0];
  const slope = regulationSlope(block, "lineRegulationOverRange", "typ")!;
  // 0.035% is 3.5e-4 as a fraction, over a 12.25 V span.
  assert.ok(Math.abs(slope - 3.5e-4 / 12.25) < 1e-12, `${slope}`);
});

test("a regulation figure with no readable range produces no slope and no element", () => {
  const rows = [
    row("outputVoltage", "Output voltage", { typ: 5 }, "V"),
    row("dropoutVoltage", "Dropout voltage", { typ: 2 }, "V"),
    row("lineRegulationOverRange", "Line regulation", { typ: 7 }, "mV", null),
    row("loadRegulationOverRange", "Load regulation", { typ: 30 }, "mV", null)
  ];
  const block = readBlocks(rows)[0];
  assert.equal(regulationSlope(block, "lineRegulationOverRange", "typ"), null);

  const subckt = emitLdoSubckt(block, { partNumber: "TEST" });
  assert.ok(!subckt.includes(".param lineSlope"), "no slope may be emitted from a change with no range");
  assert.ok(!subckt.includes(".param loadSlope"));
  // And it must SAY so, naming the two facts apart: read-but-unusable is not
  // the same as not stated, and telling a user the second sends them looking
  // for a row that is on the page.
  assert.match(subckt, /READ but is NOT modelled/);
  // With no load slope there is no resistor, and NOT a zero-ohm one: a
  // zero-valued resistor is a claim of a perfect output impedance.
  assert.ok(!subckt.includes("Rout"), "a missing load regulation must not become a perfect output");
  assert.match(subckt, /^Vout nref OUT 0$/m);
});

// --- the dropout, which is the whole reason this is not the reference class ---

test("the netlist limits the output to the input less the stated dropout", () => {
  const subckt = emitLdoSubckt(readBlocks(LDO_ROWS)[0], { partNumber: "L7805" });
  assert.match(subckt, /^Bref nref GND V=min\(/m);
  assert.match(subckt, /V\(IN,GND\)-\{dropoutVoltage\}/);
});

// The portability rules themselves - braces, hyphens, `Meg` - are asserted for
// EVERY emitter together in `netlist-syntax.test.ts`, which this class's
// emitter is now one of. Asserting them again here would be a second place to
// fix, which is the failure this codebase keeps paying for.

test("the anchor is read, and where nothing states one it is derived from two values that are", () => {
  const withSupply = readBlocks([...LDO_ROWS, row("supplyVoltage", "Supply voltage", { min: 7, max: 35 }, "V")])[0];
  assert.equal(ldoAnchor(withSupply), 7);
  // No supply row: the nominal plus the dropout is the lowest input at which
  // the part regulates, and both of those are on the page.
  assert.equal(ldoAnchor(readBlocks(LDO_ROWS)[0]), 7);
  // Neither available: no anchor, and the emitter then leaves the line term out
  // rather than picking a voltage.
  const bare = readBlocks([row("outputVoltage", "Output voltage", { typ: 5 }, "V")])[0];
  assert.equal(ldoAnchor(bare), null);
});

// --- which class this is, decided from the document --------------------------

test("an output voltage and a dropout build a regulator, and not a reference", () => {
  const blocks = readBlocks(LDO_ROWS);
  assert.equal(buildable(blocks, LDO).length, 1);
  // The reference class would also accept it - it states an output voltage and
  // a regulation term - which is exactly why the LDO is tried first.
  assert.deepEqual(blocks[0].missingFor.ldo, []);
});

test("a reference is NOT a regulator: it states no dropout", () => {
  const reference = readBlocks([
    row("outputVoltage", "Output voltage", { typ: 2.5 }, "V"),
    row("lineRegulation", "Line regulation", { typ: 1 }, "ppm/V")
  ]);
  assert.equal(buildable(reference, LDO).length, 0);
  assert.equal(buildable(reference, REFERENCE).length, 1);
  assert.deepEqual(reference[0].missingFor.ldo, ["dropoutVoltage"]);
});

test("a dropout voltage proves this is not a comparator", () => {
  // THE DEFECT. RHFL4913 is a rad-hard linear regulator whose datasheet prints
  // two rows described `tPLH` and `tPHL` - the timing of its INHIBIT pin. Those
  // are a comparator's symbols, they are read correctly as a propagation delay,
  // and a propagation delay is the comparator's discriminator. So a regulator
  // was built as a comparator with every value read correctly.
  const blocks = readBlocks([
    row("propagationDelay", "tPLH", { typ: 30 }, "µs"),
    row("dropoutVoltage", "Dropout voltage", { typ: 0.45 }, "V"),
    row("quiescentCurrent", "Quiescent current", { typ: 5 }, "mA")
  ]);
  assert.deepEqual(blocks[0].missingFor.comparator, [], "the propagation delay IS there");
  assert.equal(disqualifies(blocks[0], COMPARATOR), "dropoutVoltage");
  assert.equal(buildable(blocks, COMPARATOR).length, 0, "and it is still not a comparator");
});

test("a real comparator states no dropout and is unaffected", () => {
  const blocks = readBlocks([
    row("propagationDelay", "Propagation delay", { typ: 40 }, "ns"),
    row("offsetVoltage", "Input offset voltage", { typ: 1 }, "mV")
  ]);
  assert.equal(disqualifies(blocks[0], COMPARATOR), null);
  assert.equal(buildable(blocks, COMPARATOR).length, 1);
});

// --- the file the customer opens ---------------------------------------------

test("every parameter the netlist references is one the netlist declares", () => {
  // LMP7704-SP shipped a subcircuit referencing a `.param` that was never
  // emitted, because a value existed on the record without existing at every
  // corner. The netlist simulated to nothing.
  const subckt = emitLdoSubckt(readBlocks(LDO_ROWS)[0], { partNumber: "L7805" });
  const declared = new Set([...subckt.matchAll(/^\.param (\w+)=/gm)].map((m) => m[1]));
  declared.add("CORNER");
  for (const [, used] of subckt.matchAll(/\{(\w+)\}/g)) {
    assert.ok(declared.has(used), `${used} is referenced and never declared`);
  }
});

test("the symbol's pins are the subcircuit's ports, in order", () => {
  const asy = emitLdoAsy("L7805");
  const named = [...asy.matchAll(/PINATTR PinName (\S+)/g)].map((m) => m[1]);
  assert.deepEqual(named, [...LDO_TERMINALS]);
  const subckt = emitLdoSubckt(readBlocks(LDO_ROWS)[0], { partNumber: "L7805" });
  assert.match(subckt, new RegExp(`^\\.subckt L7805 ${LDO_TERMINALS.join(" ")} `, "m"));
});

test("the header cites every value it used, with its page", () => {
  const subckt = emitLdoSubckt(readBlocks(LDO_ROWS)[0], { partNumber: "L7805", datasheet: "l7805.pdf" });
  for (const parameter of ["outputVoltage", "dropoutVoltage", "quiescentCurrent"]) {
    assert.ok(subckt.includes(parameter), parameter);
  }
  assert.match(subckt, /page 6/);
  assert.match(subckt, /Datasheet: l7805\.pdf/);
  // And it names what it did NOT model, so the omission is not read as a claim.
  assert.match(subckt, /NOT MODELLED: the current limit/);
});

test("a block with one corner emits no corner sweep", () => {
  const single = readBlocks([
    row("outputVoltage", "Output voltage", { typ: 3.3 }, "V"),
    row("dropoutVoltage", "Dropout voltage", { typ: 0.3 }, "V")
  ])[0];
  assert.deepEqual(cornersOf(single), ["typ"]);
  const subckt = emitLdoSubckt(single, { partNumber: "TEST" });
  assert.ok(!subckt.includes(".step param CORNER"));
});

test("a LOW-DROPOUT REFERENCE states a dropout too, and is still a reference", () => {
  // THE DEFECT. A dropout voltage alone does not separate the two classes: a
  // low-dropout SERIES reference states one. Both voltage references in the
  // amplifier hold-out were built as regulators, with every value read
  // correctly, every conformance check passing, and the wrong kind of device
  // named on the receipt and drawn on the symbol.
  //
  // What separates them is the CONVENTION each states its regulation in: a
  // precision reference prints a slope in parts per million, and not one of the
  // six regulators measured does.
  const blocks = readBlocks([
    row("outputVoltage", "Output voltage", { typ: 2.5 }, "V"),
    row("dropoutVoltage", "Dropout voltage", { typ: 0.3 }, "V"),
    row("lineRegulation", "Line regulation", { typ: 1 }, "ppm/V"),
    row("loadRegulation", "Load regulation", { typ: 20 }, "ppm/mA")
  ]);
  assert.deepEqual(blocks[0].missingFor.ldo, [], "it does state both of the LDO's requirements");
  assert.equal(disqualifies(blocks[0], LDO), "lineRegulation");
  assert.equal(buildable(blocks, LDO).length, 0);
  assert.equal(buildable(blocks, REFERENCE).length, 1);
});

test("a regulator stating the same terms over a range is unaffected", () => {
  const blocks = readBlocks(LDO_ROWS);
  assert.equal(disqualifies(blocks[0], LDO), null);
  assert.equal(buildable(blocks, LDO).length, 1);
});

test("a percent of the output is a percent; a percent of full scale is not", () => {
  // TPS7A4700 heads its regulation columns `%VO`. Nothing parsed it, so both
  // rows were read, named and dropped for having no magnitude - on a part whose
  // regulation is the thing being modelled.
  assert.equal(parseUnit("%VO")!.base, "%");
  assert.equal(parseUnit("%VOUT")!.scale, 1e-2);
  // NOT generalised to a percent of anything. ADS8688 prints `%FSR`, a fraction
  // of an ADC's full-scale range, and folding that to a bare percent would
  // silently redefine it.
  assert.equal(parseUnit("%FSR"), null);
});
