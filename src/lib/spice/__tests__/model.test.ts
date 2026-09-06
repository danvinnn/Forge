/**
 * The rules that decide what a model is allowed to claim.
 *
 * The one that matters most is that a corner the datasheet does not print
 * produces NO corner. Defaulting `max = typ` would have the product assert a
 * guarantee the vendor never made, and an engineer's worst-case analysis would
 * be wrong in the direction that looks safe.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { LDO, readBlocks, buildable, cornersOf, supportedCorners, usable, valueAt, varyingParameters } from "../model";
import { emitSubckt, emitAsy, TERMINALS, NO_TRIM } from "../emit";
import { parseUnit, toSpice, toSI } from "../units";
import type { SpecRow } from "../specs";

function row(key: string, values: Partial<SpecRow["values"]>, unit: string, extra: Partial<SpecRow> = {}): SpecRow {
  return {
    parameter: key,
    key,
    symbol: null,
    conditions: null,
    unit,
    values: { min: null, typ: null, max: null, ...values },
    group: null,
    scope: null,
    page: 1,
    ...extra
  };
}

const MINIMAL: SpecRow[] = [row("openLoopGain", { typ: 130 }, "dB"), row("gbw", { typ: 350 }, "kHz")];

test("a prefix in the DENOMINATOR scales the value up", () => {
  // 0.16 V/us is 160000 V/s. Treating every prefix as a multiplier gets slew
  // rate wrong by 1e12.
  assert.equal(toSI(0.16, "V/us"), 160000);
  assert.equal(toSI(0.16, "V/µs"), 160000); // MICRO SIGN
  assert.equal(toSI(0.16, "V/μs"), 160000); // GREEK SMALL LETTER MU
  assert.equal(toSI(350, "kHz"), 350000);
});

test("look-alike code points fold, so U+2126 OHM SIGN parses", () => {
  // TI writes kilohms with U+2126; a table written with U+03A9 does not match
  // it and `toUpperCase` does not reconcile them. OPA333's output impedance was
  // read correctly and then silently dropped for exactly this.
  assert.equal(toSI(2, "kΩ"), 2000); // OHM SIGN
  assert.equal(toSI(2, "kΩ"), 2000); // GREEK CAPITAL OMEGA
});

test("an unparseable unit yields no SI value rather than a guess", () => {
  assert.equal(parseUnit("furlongs"), null);
  assert.equal(toSI(5, "furlongs"), null);
  assert.equal(toSI(5, null), null);
});

test("a milli under the line is reported ambiguous, not silently trusted", () => {
  // AD8628's PDF draws a micro sign and stores `m`, so its slew rate arrives as
  // V/ms: a factor of 1000 that the dimension check cannot see.
  assert.equal(parseUnit("V/ms")?.ambiguousMicro, true);
  assert.equal(parseUnit("V/us")?.ambiguousMicro, false);
});

test("emitted numbers carry no SPICE suffix, so Meg cannot become milli", () => {
  // In SPICE `1M` is one MILLI. A megohm written that way is a 1e9 error that
  // passes every check this product has.
  for (const value of [1e6, 2000, 1e-6, 0.16]) {
    assert.match(toSpice(value), /^-?\d\.\d+e-?\d+$/);
  }
  assert.equal(toSpice(0), "0");
  assert.throws(() => toSpice(Number.NaN));
});

test("a missing corner produces NO corner, never one equal to typical", () => {
  const blocks = readBlocks(MINIMAL);
  const block = blocks[0];
  assert.deepEqual(cornersOf(block), ["typ"]);
  assert.equal(block.values.gbw!.si.max, null);
  assert.equal(block.values.gbw!.si.min, null);
  // And nothing downstream invents one.
  assert.equal(emitSubckt(block, { partNumber: "X" }).includes("CORNER==3"), false);
});

test("corners appear only where the document prints them", () => {
  const blocks = readBlocks([
    row("openLoopGain", { min: 106, typ: 130 }, "dB"),
    row("gbw", { typ: 350 }, "kHz"),
    row("quiescentCurrent", { typ: 17, max: 25 }, "uA")
  ]);
  assert.deepEqual(cornersOf(blocks[0]).sort(), ["max", "min", "typ"]);
  // Gain-bandwidth has only a typical, so it holds still across the sweep. The
  // document knows nothing else about it and neither do we.
  assert.equal(valueAt(blocks[0], "gbw", "min"), 350000);
  assert.equal(valueAt(blocks[0], "gbw", "max"), 350000);
  assert.deepEqual(varyingParameters(blocks[0]).sort(), ["openLoopGain", "quiescentCurrent"]);
});

test("a class emits the intersection its required parameters can honestly support", () => {
  const block = readBlocks([
    row("outputVoltage", { min: 4.95, max: 5.05 }, "V"),
    row("dropoutVoltage", { typ: 0.12 }, "V"),
    // This unrelated typical is why the raw provenance set includes `typ`.
    row("quiescentCurrent", { typ: 65 }, "uA")
  ])[0];

  assert.deepEqual(cornersOf(block), ["typ", "min", "max"]);
  assert.deepEqual(supportedCorners(block, LDO), ["min", "max"]);
  assert.equal(block.missingFor.ldo.length, 0);
  assert.equal(buildable([block], LDO).length, 1);
});

test("a wrong-dimension value is not admitted to the model", () => {
  // The vision model once reported gain-bandwidth as 106 dB, having taken the
  // adjacent row. A bandwidth cannot be in decibels.
  const blocks = readBlocks([row("openLoopGain", { typ: 130 }, "dB"), row("gbw", { typ: 106 }, "dB")]);
  assert.equal(blocks[0].values.gbw, undefined);
  assert.deepEqual(blocks[0].missing, ["gbw"]);
  assert.equal(buildable(blocks).length, 0);
});

test("blocks are kept apart, so one grade's minimum cannot meet another's maximum", () => {
  const blocks = readBlocks([
    row("openLoopGain", { typ: 130 }, "dB", { group: "LT1013AM" }),
    row("gbw", { typ: 350 }, "kHz", { group: "LT1013AM" }),
    row("openLoopGain", { typ: 110 }, "dB", { group: "LT1013M" }),
    row("gbw", { typ: 300 }, "kHz", { group: "LT1013M" })
  ]);
  assert.equal(blocks.length, 2);
  const am = blocks.find((b) => b.group === "LT1013AM")!;
  assert.equal(valueAt(am, "openLoopGain", "typ"), 130);
  assert.equal(valueAt(am, "gbw", "typ"), 350000);
});

test("a parameter the datasheet omits produces no element and is declared", () => {
  const text = emitSubckt(readBlocks(MINIMAL)[0], { partNumber: "X" });
  assert.equal(text.includes("Vos "), false); // no offset source
  assert.equal(text.includes("Rout"), false); // no output impedance
  assert.equal(text.includes("Biq"), false); // no supply current
  assert.match(text, /NOT MODELLED/);
  assert.match(text, /Nothing is assumed in their place/);
});

test("the B-source braces the parameter, never the whole expression", () => {
  // LTspice rejects I={GM*V(a,b)} with "Questionable use of curly braces".
  // ngspice accepts both, so ngspice alone would pass a file LTspice refuses.
  const text = emitSubckt(readBlocks([...MINIMAL, row("slewRate", { typ: 0.16 }, "V/us")])[0], { partNumber: "X" });
  assert.match(text, /I=\{IMAX\}\*tanh\(\{GM\}\*V\(/);
  assert.equal(/I=\{[^}]*V\(/.test(text), false);
});

test("the symbol and the subcircuit share one terminal list", () => {
  const block = readBlocks(MINIMAL)[0];
  const subckt = emitSubckt(block, { partNumber: "X" });
  const asy = emitAsy("X");
  // The .subckt port order IS the terminal list.
  assert.match(subckt, new RegExp(`\\.subckt X ${TERMINALS.map((t) => t.replace("+", "\\+")).join(" ")}`));
  // And SpiceOrder counts through the same list, so they cannot disagree.
  TERMINALS.forEach((terminal, index) => {
    const at = asy.indexOf(`PINATTR PinName ${terminal}`);
    assert.ok(at > 0, `${terminal} missing from the symbol`);
    assert.match(asy.slice(at), new RegExp(`PINATTR PinName ${terminal.replace("+", "\\+")}\\nPINATTR SpiceOrder ${index + 1}`));
  });
});

test("the header quotes the datasheet's own numbers, not scaled floats", () => {
  const block = readBlocks([...MINIMAL, row("offsetVoltage", { typ: 2, max: 10 }, "uV", { page: 7 })])[0];
  const text = emitSubckt(block, { partNumber: "X" });
  assert.match(text, /offsetVoltage\s+typ 2, max 10 uV\s+\(page 7\)/);
  assert.equal(text.includes("0.000009999"), false);
});

test("a trim is emitted as its own named parameter, so the fit stays auditable", () => {
  const block = readBlocks(MINIMAL)[0];
  const text = emitSubckt(block, { partNumber: "X", trim: { gainDb: 1.584, gbw: 1.2747 } });
  assert.match(text, /GAIN_TRIM_DB=1\.584/);
  assert.match(text, /GBW_TRIM=1\.2747/);
  // The datasheet's own value is still legible beside it.
  assert.match(text, /openLoopGain=\{\(CORNER==1\)\*1\.300000e2\}/);
  assert.equal(emitSubckt(block, { partNumber: "X", trim: NO_TRIM }).includes("Solved so the LOADED"), false);
});

test("a parameter the emitter leaves out is not measured either", async () => {
  // ONE DEFINITION OF USABLE. A parameter with both bounds printed and no
  // typical has no single value, so `valueAt` returns null at the typical
  // corner and `usable` is false: the emitter writes no offset source. The
  // verifier had its own idea of when a value counts, went on measuring it, and
  // reported the model as disagreeing with its own datasheet by the whole
  // offset. That is the LMP7704-SP presence-versus-usability defect a second
  // time, in the one other place with a private notion of "present".
  const { emitSubckt } = await import("../emit");
  const { verify } = await import("../verify");
  const rows: SpecRow[] = [
    row("openLoopGain", { typ: 120 }, "dB"),
    row("gbw", { typ: 10 }, "MHz"),
    row("offsetVoltage", { min: -1, max: 1 }, "mV")
  ];
  const block = readBlocks(rows)[0];
  assert.equal(usable(block, "offsetVoltage"), false);
  const netlist = emitSubckt(block, { partNumber: "T" });
  assert.equal(/^Vos /m.test(netlist), false, "an unusable parameter reached the netlist");
  const report = await verify(netlist, block, "T", cornersOf(block));
  assert.deepEqual(
    report.checks.filter((c) => c.parameter === "offsetVoltage"),
    [],
    "a parameter with no element in the netlist was still measured against the datasheet"
  );
});
