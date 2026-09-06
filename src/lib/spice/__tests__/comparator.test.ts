/**
 * The comparator class.
 *
 * Two properties carry the weight. The class must be chosen from what the
 * document STATES, and the output stage must be what the document describes: a
 * part that pulls down and does not pull up, modelled as push-pull, drives a
 * rail the real one leaves floating.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readBlocks, buildable, cornersOf, COMPARATOR, OPAMP, REFERENCE } from "../model";
import { COMPARATOR_TERMINALS, emitComparatorAsy, emitComparatorSubckt, isOpenCollector, verifyComparator } from "../comparator";
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
    page: 4
  };
}

const CMP_ROWS: SpecRow[] = [
  row("propagationDelay", "Response Time", { typ: 1.3 }, "us"),
  row("offsetVoltage", "Input Offset Voltage", { max: 5 }, "mV"),
  row("outputLowVoltage", "Saturation Voltage", { max: 400 }, "mV"),
  row("outputSinkCurrent", "Output Sink Current", { min: 6 }, "mA"),
  row("quiescentCurrent", "Supply Current", { max: 2 }, "mA")
];

test("a propagation delay makes it a comparator, and nothing else does", () => {
  const blocks = readBlocks(CMP_ROWS);
  assert.equal(buildable(blocks, COMPARATOR).length, 1);
  // No amplifier datasheet states a propagation delay and no comparator states
  // an open-loop gain with a gain-bandwidth, so neither can satisfy the other.
  assert.equal(buildable(blocks, OPAMP).length, 0);
  assert.equal(buildable(blocks, REFERENCE).length, 0);
});

test("an amplifier is never built as a comparator", () => {
  const amplifier = readBlocks([
    row("openLoopGain", "Open-loop voltage gain", { typ: 130 }, "dB"),
    row("gbw", "Gain-bandwidth product", { typ: 350 }, "kHz"),
    row("settlingTime", "Settling time", { typ: 14 }, "us")
  ]);
  assert.equal(buildable(amplifier, OPAMP).length, 1);
  assert.equal(buildable(amplifier, COMPARATOR).length, 0);
});

test("a stated saturation voltage means the output only pulls DOWN", () => {
  // Modelling an open-collector part as push-pull hands the user a device that
  // drives a rail the real one leaves floating, which is a wrong answer
  // delivered confidently.
  const block = readBlocks(CMP_ROWS)[0];
  assert.equal(isOpenCollector(block), true);
  const netlist = emitComparatorSubckt(block, { partNumber: "LM139" });
  assert.match(netlist, /OPEN-COLLECTOR OUTPUT/);
  assert.match(netlist, /YOUR CIRCUIT MUST SUPPLY THE PULL-UP/);
  // It sinks; it does not source.
  assert.match(netlist, /^Bout OUT GND I=/m);
});

test("with no output stage stated the model drives both ways, and says so", () => {
  const block = readBlocks(CMP_ROWS.filter((r) => r.key !== "outputLowVoltage" && r.key !== "outputSinkCurrent"))[0];
  assert.equal(isOpenCollector(block), false);
  const netlist = emitComparatorSubckt(block, { partNumber: "X" });
  assert.match(netlist, /PUSH-PULL OUTPUT/);
  assert.match(netlist, /^Bout OUT GND V=/m);
});

test("the clamp is written in plain SPICE, not in `limit`", () => {
  // ngspice ACCEPTS `limit(x,0,1)` in a B-source, evaluates it to something
  // else, and reports nothing: the pull-down stayed on, the output never left
  // its saturation voltage, and the model simulated perfectly cleanly while
  // doing nothing at all.
  const netlist = emitComparatorSubckt(readBlocks(CMP_ROWS)[0], { partNumber: "X" });
  assert.equal(/limit\(/.test(netlist), false);
  assert.match(netlist, /max\(0,min\(1,/);
});

test("the model reproduces the propagation delay it was built from", async () => {
  const block = readBlocks(CMP_ROWS)[0];
  const netlist = emitComparatorSubckt(block, { partNumber: "X" });
  const report = await verifyComparator(netlist, block, "X", cornersOf(block));
  const delay = report.checks.filter((c) => c.parameter === "propagationDelay");
  assert.ok(delay.length > 0, "the delay was not checked at all");
  if (report.simulatorMissing) return;
  // A model that produces NO transition is the defect this exists to catch, and
  // it looks identical to a clean run from the outside.
  assert.deepEqual(
    delay.filter((c) => c.verdict !== "pass").map((c) => c.reason),
    []
  );
});

test("the symbol's pin order is the subcircuit's port order", () => {
  const asy = emitComparatorAsy("LM139AQML-SP");
  assert.match(asy, /SYMATTR Value LM139AQML_SP/);
  COMPARATOR_TERMINALS.forEach((terminal, index) => {
    assert.match(asy, new RegExp(`PINATTR PinName ${terminal.replace("+", "\\+")}\\nPINATTR SpiceOrder ${index + 1}`));
  });
});
