/**
 * The voltage reference class.
 *
 * The property under test is that a CLASS IS CHOSEN FROM WHAT THE DOCUMENT
 * STATES. Nothing here may look at a part number: a part number is a string
 * somebody typed, and handing an op-amp user a voltage source because the file
 * was called `ref-something.pdf` is the worst failure this class can produce.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readBlocks, buildable, cornersOf, REFERENCE, OPAMP } from "../model";
import { anchorSupply, emitReferenceAsy, emitReferenceSubckt, REFERENCE_TERMINALS } from "../reference";
import { parseUnit } from "../units";
import type { SpecRow } from "../specs";

function row(key: string, parameter: string, values: Partial<SpecRow["values"]>, unit: string): SpecRow {
  return {
    parameter,
    key,
    symbol: null,
    conditions: null,
    unit,
    values: { min: null, typ: null, max: null, ...values },
    group: null,
    scope: null,
    page: 6
  };
}

const REF_ROWS: SpecRow[] = [
  row("outputVoltage", "Output voltage", { typ: 2.5 }, "V"),
  row("lineRegulation", "Line regulation", { typ: 1, max: 2.2 }, "ppm/V"),
  row("loadRegulation", "Load regulation", { typ: 20, max: 50 }, "ppm/mA"),
  row("quiescentCurrent", "Quiescent current", { typ: 0.8, max: 1.2 }, "mA"),
  row("supplyVoltage", "Supply voltage", { min: 3.25, max: 18 }, "V")
];

test("parts per million and percent carry their own magnitude", () => {
  // Treating `ppm` as scale 1 puts a 20 ppm/mA load regulation on the record as
  // 20 per milliamp, which is a million times the value the page states.
  assert.equal(parseUnit("ppm/V")!.scale, 1e-6);
  assert.equal(parseUnit("ppm/mA")!.scale, 1e-3);
  assert.equal(parseUnit("%")!.scale, 1e-2);
  assert.equal(parseUnit("ppm/V")!.base, "PPM/V");
  assert.equal(parseUnit("ppm/mA")!.base, "PPM/A");
});

test("a table stating an output voltage and a regulation term builds a reference", () => {
  const blocks = readBlocks(REF_ROWS);
  assert.deepEqual(blocks[0].missingFor.reference, []);
  assert.equal(buildable(blocks, REFERENCE).length, 1);
  // And NOT an amplifier: it states neither of the two an amplifier needs.
  assert.equal(buildable(blocks, OPAMP).length, 0);
});

test("an output voltage ALONE is not a reference", () => {
  // An amplifier datasheet can print a row called `Output voltage` too, and a
  // class chosen on that hands an op-amp user a voltage source. What no
  // amplifier prints is a line or load regulation.
  const blocks = readBlocks([REF_ROWS[0], REF_ROWS[4]]);
  assert.equal(buildable(blocks, REFERENCE).length, 0);
  // The refusal names BOTH terms, either of which would have unblocked it,
  // rather than one of them chosen arbitrarily.
  assert.deepEqual(blocks[0].missingFor.reference, ["lineRegulation", "loadRegulation"]);
});

test("an amplifier table is never built as a reference", () => {
  const amplifier = readBlocks([
    row("openLoopGain", "Open-loop voltage gain", { typ: 130 }, "dB"),
    row("gbw", "Gain-bandwidth product", { typ: 350 }, "kHz"),
    row("outputVoltage", "Output voltage", { typ: 4.9 }, "V")
  ]);
  assert.equal(buildable(amplifier, OPAMP).length, 1);
  assert.equal(buildable(amplifier, REFERENCE).length, 0);
});

test("the netlist states both derivatives the datasheet defines", () => {
  const block = readBlocks(REF_ROWS)[0];
  const netlist = emitReferenceSubckt(block, { partNumber: "REF5025" });
  assert.match(netlist, /\.subckt REF5025 IN OUT GND CORNER=1/);
  // The load slope IS an output resistance: the fractional change per amp
  // times the nominal output.
  assert.match(netlist, /\.param ROUT=\{outputVoltage\*loadRegulation\}/);
  assert.match(netlist, /Rout nref OUT \{ROUT\}/);
  assert.match(netlist, /lineRegulation\}\*\(V\(IN,GND\)/);
  // Braced parameter, never a braced expression: LTspice rejects the latter.
  assert.equal(/\{[^}]*[+*][^}]*V\(/.test(netlist), false);
});

test("the line slope is anchored on a supply the DOCUMENT states", () => {
  const block = readBlocks(REF_ROWS)[0];
  assert.equal(anchorSupply(block), 3.25);
  assert.match(emitReferenceSubckt(block, { partNumber: "REF5025" }), /anchored at VIN = 3\.25 V/);
});

test("with no supply stated the line term is OMITTED, not anchored somewhere convenient", () => {
  const block = readBlocks(REF_ROWS.filter((r) => r.key !== "supplyVoltage"))[0];
  assert.equal(anchorSupply(block), null);
  const netlist = emitReferenceSubckt(block, { partNumber: "X" });
  assert.equal(/V\(IN,GND\)/.test(netlist), false);
  // And it says so, rather than quietly dropping a value it read.
  assert.match(netlist, /line regulation was READ but is NOT modelled/);
});

test("a hyphen in the part number never reaches the subcircuit name", () => {
  // A HYPHEN IS A MINUS SIGN in SPICE, and every rad-hard part ends in `-SP`.
  const block = readBlocks(REF_ROWS)[0];
  assert.match(emitReferenceSubckt(block, { partNumber: "REF5025-SP" }), /\.subckt REF5025_SP /);
  assert.match(emitReferenceAsy("REF5025-SP"), /SYMATTR Value REF5025_SP/);
});

test("the symbol's pin order is the subcircuit's port order", () => {
  const asy = emitReferenceAsy("REF5025");
  REFERENCE_TERMINALS.forEach((terminal, index) => {
    const at = asy.indexOf(`PINATTR PinName ${terminal}`);
    assert.ok(at > 0, `${terminal} is not on the symbol`);
    assert.match(asy.slice(at), new RegExp(`PINATTR PinName ${terminal}\\nPINATTR SpiceOrder ${index + 1}`));
  });
});

test("a corner the document does not print is not invented", () => {
  const block = readBlocks([
    row("outputVoltage", "Output voltage", { typ: 2.5 }, "V"),
    row("loadRegulation", "Load regulation", { typ: 20 }, "ppm/mA")
  ])[0];
  assert.deepEqual(cornersOf(block), ["typ"]);
});

test("a reference stating only a LINE regulation still simulates", async () => {
  // The other branch of the emitter, which nothing had ever run. REF5025 states
  // both terms, so the no-load-regulation path went out unexercised. It used to
  // emit a zero-ohm resistor: both a claim of a perfect output impedance the
  // datasheet never made, and an element some simulators warn on.
  const { verifyReference } = await import("../reference");
  const block = readBlocks(REF_ROWS.filter((r) => r.key !== "loadRegulation"))[0];
  const netlist = emitReferenceSubckt(block, { partNumber: "X" });
  assert.equal(/^Rout /m.test(netlist), false, "an unstated output impedance was emitted anyway");
  const report = await verifyReference(netlist, block, "X", cornersOf(block));
  assert.equal(
    report.checks.filter((c) => c.verdict === "fail").length,
    0,
    report.checks.filter((c) => c.verdict === "fail").map((c) => `${c.parameter}: ${c.reason}`).join("; ")
  );
  // And it measured something, rather than reporting everything unverifiable,
  // which would be a green result that checked nothing.
  if (!report.simulatorMissing) {
    assert.ok(
      report.checks.some((c) => c.verdict === "pass"),
      "nothing passed, so nothing was actually simulated"
    );
  }
});
