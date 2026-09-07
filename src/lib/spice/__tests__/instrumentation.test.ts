import { test } from "node:test";
import assert from "node:assert/strict";
import { gainEquationFromText } from "../pdfspans";
import { readBlocks, supportedCorners, INSTRUMENTATION } from "../model";
import { emitInstrumentationAsy, emitInstrumentationSubckt, INSTRUMENTATION_TERMINALS, verifyInstrumentation } from "../instrumentation";
import { buildModel } from "../build";
import type { SpecRow } from "../specs";

test("reads both common forms of a printed instrumentation gain equation", () => {
  assert.equal(gainEquationFromText([{ page: 4, text: "Instrumentation amplifier\nG = 1 + 100 kΩ/RG" }])?.resistanceOhm, 100_000);
  assert.equal(gainEquationFromText([{ page: 7, text: "IN-AMP\nR_G = 50 kOhm / (GAIN - 1)" }])?.resistanceOhm, 50_000);
});

test("gain-law evidence must identify the class, state a unit, and agree", () => {
  assert.equal(gainEquationFromText([{ page: 1, text: "G = 1 + 100 kΩ/RG" }]), null);
  assert.equal(gainEquationFromText([{ page: 1, text: "Instrumentation amplifier G = 1 + 100/RG" }]), null);
  assert.equal(gainEquationFromText([{ page: 1, text: "Instrumentation amplifier G = 1 + 100 kΩ/RG; G = 1 + 50 kΩ/RG" }]), null);
});

function row(key: string, typ: number, unit: string): SpecRow {
  return { parameter: key, key, symbol: null, conditions: null, unit, values: { min: null, typ, max: null }, group: null, scope: null, page: 3 };
}

test("instrumentation netlist and symbol share the external-resistor contract", () => {
  const block = readBlocks([row("gainResistance", 100, "kOhm"), row("offsetVoltage", 25, "uV"), row("quiescentCurrent", 1, "mA")])[0];
  const subckt = emitInstrumentationSubckt(block, { partNumber: "INA-TEST" });
  assert.match(subckt, new RegExp(`\\.subckt INA_TEST ${INSTRUMENTATION_TERMINALS.map((pin) => pin.replace(/[+]/g, "\\+")).join(" ")}`));
  assert.match(subckt, /Vrg RG\+ RG- 1/);
  assert.match(subckt, /gainResistance/);
  const symbol = emitInstrumentationAsy("INA-TEST");
  assert.equal((symbol.match(/PINATTR SpiceOrder/g) ?? []).length, INSTRUMENTATION_TERMINALS.length);
});

test("instrumentation verifier either measures the printed law or explicitly reports no simulator", async () => {
  const block = readBlocks([row("gainResistance", 100, "kOhm"), row("offsetVoltage", 25, "uV"), row("quiescentCurrent", 1, "mA")])[0];
  const subckt = emitInstrumentationSubckt(block, { partNumber: "INA_TEST" });
  const report = await verifyInstrumentation(subckt, block, "INA_TEST", supportedCorners(block, INSTRUMENTATION));
  assert.ok(report.simulatorMissing || report.checks.some((check) => check.parameter === "gainResistance" && check.verdict === "pass"));
  assert.equal(report.checks.some((check) => check.verdict === "fail"), false);
});

test("a cited visual reading can recover a row absent from the PDF text layer", async () => {
  const result = await buildModel(new ArrayBuffer(0), "INA_VISUAL", undefined, async (pages) => {
    assert.deepEqual(pages, [], "the visual recovery runs because no text table was found");
    return [{
      parameter: "Gain equation numerator",
      means: "gainResistance",
      symbol: "K",
      conditions: "G = 1 + K/RG",
      unit: "kOhm",
      group: null,
      scope: null,
      page: 6,
      min: null,
      typ: 100,
      max: null
    }];
  });
  assert.equal(result.deviceClass?.id, "instrumentation");
  assert.ok(result.subckt);
  assert.equal(result.block?.values.gainResistance?.page, 6);
  assert.ok(result.confirmations?.flagged.some((item) => item.because === "named-by-one-reading"));
});
