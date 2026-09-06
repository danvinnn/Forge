/**
 * The rules a netlist has to follow to be accepted by the CUSTOMER'S simulator,
 * asserted for EVERY emitter this product has.
 *
 * ## Why this file exists rather than one assertion per emitter
 *
 * ngspice accepts things LTspice refuses, so a file verified only under ngspice
 * can be one the customer's tool rejects. `bench:kicad` taught this the
 * expensive way on the CAD half: an independent reader accepting our output is
 * not the same as the tool the user opens accepting it.
 *
 * The rules below were established against LTspice 17.2.4 by hand. They are
 * asserted here for both the amplifier and the reference emitter TOGETHER,
 * because "fixed in one place, not the other" is this codebase's dominant
 * failure mode and a second emitter is exactly where it recurs.
 *
 * WHAT THIS IS NOT: running LTspice. It is not installed on every machine that
 * runs this suite, and these are static rules. A new emitter still wants one
 * hand-run before it is believed.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readBlocks } from "../model";
import { emitSubckt } from "../emit";
import { emitReferenceSubckt } from "../reference";
import { emitComparatorSubckt } from "../comparator";
import { emitLdoSubckt } from "../ldo";
import type { SpecRow } from "../specs";

function row(key: string, values: Partial<SpecRow["values"]>, unit: string, conditions: string | null = null): SpecRow {
  return {
    parameter: key,
    key,
    symbol: null,
    conditions,
    unit,
    values: { min: null, typ: null, max: null, ...values },
    group: null,
    scope: null,
    page: 1
  };
}

/** One netlist from every emitter, built from a block each class can use. */
function everyNetlist(): Array<{ emitter: string; netlist: string }> {
  const amplifier = readBlocks([
    row("openLoopGain", { typ: 130, min: 106 }, "dB"),
    row("gbw", { typ: 350 }, "kHz"),
    row("slewRate", { typ: 0.16 }, "V/us"),
    row("offsetVoltage", { typ: 2, max: 10 }, "uV"),
    row("quiescentCurrent", { typ: 17 }, "uA"),
    row("openLoopOutputZ", { typ: 2 }, "kOhm")
  ])[0];
  const reference = readBlocks([
    row("outputVoltage", { typ: 2.5 }, "V"),
    row("lineRegulation", { typ: 1, max: 2.2 }, "ppm/V"),
    row("loadRegulation", { typ: 20, max: 50 }, "ppm/mA"),
    row("quiescentCurrent", { typ: 0.8 }, "mA"),
    row("supplyVoltage", { min: 3.25, max: 18 }, "V")
  ])[0];
  const comparator = readBlocks([
    row("propagationDelay", { typ: 1.3, max: 5 }, "us"),
    row("offsetVoltage", { min: -5, max: 5 }, "mV"),
    row("outputLowVoltage", { max: 400 }, "mV"),
    row("outputSinkCurrent", { min: 6 }, "mA"),
    row("quiescentCurrent", { max: 2 }, "mA")
  ])[0];
  const ldo = readBlocks([
    row("outputVoltage", { min: 4.9, typ: 5, max: 5.1 }, "V"),
    row("dropoutVoltage", { typ: 2 }, "V", "IO = 1 A"),
    row("lineRegulationOverRange", { typ: 7, max: 50 }, "mV", "VI = 7.5 to 25 V, IO = 500 mA"),
    row("loadRegulationOverRange", { typ: 30, max: 100 }, "mV", "IO = 5 mA to 1.5 A"),
    row("quiescentCurrent", { typ: 4.3, max: 6 }, "mA")
  ])[0];
  return [
    { emitter: "amplifier", netlist: emitSubckt(amplifier, { partNumber: "PART-SP" }) },
    { emitter: "reference", netlist: emitReferenceSubckt(reference, { partNumber: "PART-SP" }) },
    { emitter: "comparator", netlist: emitComparatorSubckt(comparator, { partNumber: "PART-SP" }) },
    { emitter: "ldo", netlist: emitLdoSubckt(ldo, { partNumber: "PART-SP" }) }
  ];
}

test("no emitter puts an EXPRESSION inside braces", () => {
  // Measured against LTspice 17.2.4: `I={GM*V(a,b)}` is rejected with
  // "Questionable use of curly braces" while `I={GM}*V(a,b)` is accepted by
  // both tools. ngspice accepts both, so nothing downstream would catch this.
  for (const { emitter, netlist } of everyNetlist()) {
    for (const line of netlist.split("\n")) {
      // `.param` lines are DEFINITIONS and are expressions by nature; the rule
      // is about element lines that reference them.
      if (line.startsWith(".param") || line.startsWith("*")) continue;
      for (const braced of line.match(/\{[^}]*\}/g) ?? []) {
        assert.equal(
          /[+\-*/]|V\(|I\(/.test(braced.slice(1, -1)),
          false,
          `${emitter} braced an expression on an element line: ${line}`
        );
      }
    }
  }
});

test("no emitter puts a hyphen in a subcircuit name", () => {
  // A HYPHEN IS A MINUS SIGN in SPICE, so `.subckt LMP7704-SP` never registers
  // and ngspice fails silently: the following `.param` lines are absorbed into
  // the instance line. Every rad-hard part number this product targets ends in
  // `-SP`, so this would have broken the entire segment.
  for (const { emitter, netlist } of everyNetlist()) {
    const declaration = netlist.split("\n").find((l) => l.startsWith(".subckt"));
    assert.ok(declaration, `${emitter} emitted no .subckt line`);
    assert.equal(/-/.test(declaration!.split(/\s+/)[1]), false, `${emitter}: ${declaration}`);
  }
});

test("no emitter declares a parameter outside its subcircuit", () => {
  // Declared globally, two Forge models in one schematic collide and LTspice
  // stops with "Fatal Error: Duplicate definitions". A board with two of our
  // parts on it is the ordinary case, and it shows up only when two are
  // included, which is why it survived every single-part test.
  for (const { emitter, netlist } of everyNetlist()) {
    let inside = false;
    for (const line of netlist.split("\n")) {
      if (line.startsWith(".subckt")) inside = true;
      else if (line.startsWith(".ends")) inside = false;
      else if (line.startsWith(".param")) assert.ok(inside, `${emitter} declared a parameter outside the subcircuit: ${line}`);
    }
  }
});

test("no emitter writes a value with a SUFFIX", () => {
  // In SPICE `Meg` is 1e6 and `m` is 1e-3, and suffixes are NOT case sensitive,
  // so `1M` is a milliohm where a megohm was meant. Exponential notation
  // carries no suffix and cannot be misread.
  for (const { emitter, netlist } of everyNetlist()) {
    for (const line of netlist.split("\n")) {
      if (line.startsWith("*")) continue;
      for (const number of line.match(/(?<![A-Za-z0-9_.])\d+\.?\d*[A-Za-z]+/g) ?? []) {
        // `1T` in the conformance deck's ideal elements is not emitted here.
        assert.match(number, /^\d+\.?\d*e/i, `${emitter} wrote a suffixed value: ${number} in ${line}`);
      }
    }
  }
});

test("every emitter names its topology in the file it writes", () => {
  // The topology is the one thing in the file that is NOT read from the
  // document, so it is stated, not left for a reader to infer from the netlist.
  for (const { emitter, netlist } of everyNetlist()) {
    assert.match(netlist, /\* Topology: /, `${emitter} does not name its topology`);
    assert.match(netlist, /is a constant of the generator and is not read from the/, emitter);
  }
});

test("every emitter cites a page for every parameter it used", () => {
  // Traceability is the product. A value in a file with no page beside it is
  // a number the user has to take on faith.
  for (const { emitter, netlist } of everyNetlist()) {
    // The parameter list only: the section the emitter introduces by name,
    // ending at the next bare comment line. Matching every indented comment
    // also caught the corner-sweep instructions, which cite no page and should
    // not.
    const lines = netlist.split("\n");
    const start = lines.findIndex((l) => l.includes("Parameters read, with the page each came from:"));
    assert.ok(start > 0, `${emitter} does not introduce its parameter list`);
    const header: string[] = [];
    for (let i = start + 1; i < lines.length && lines[i].startsWith("*   "); i++) header.push(lines[i]);
    assert.ok(header.length > 0, `${emitter} lists no parameters`);
    for (const line of header) assert.match(line, /\(page \d+/, `${emitter}: ${line}`);
  }
});
