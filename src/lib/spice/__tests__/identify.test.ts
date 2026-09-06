/**
 * Naming a row the vocabulary could not name.
 *
 * The property under test is that this ADDS a name and never CHANGES one. A
 * mechanism that lets a second reading overwrite the first is a ranking rule,
 * and every ranking rule this project has shipped scored worse than what it
 * replaced.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { applyModelIdentities } from "../identify";
import type { ModelReadValue } from "../confirm";
import type { SpecRow } from "../specs";

function row(over: Partial<SpecRow> = {}): SpecRow {
  return {
    parameter: "Differential voltage amplification",
    key: null,
    symbol: null,
    conditions: null,
    unit: "dB",
    values: { min: 100, typ: 120, max: null },
    group: null,
    scope: null,
    page: 6,
    ...over
  };
}

function theirs(over: Partial<ModelReadValue> = {}): ModelReadValue {
  return {
    parameter: "Differential voltage amplification",
    unit: "dB",
    group: null,
    means: "openLoopGain",
    min: 100,
    typ: 120,
    max: null,
    ...over
  };
}

test("a row our vocabulary cannot name is named by the model, and marked", () => {
  const result = applyModelIdentities([row()], [theirs()]);
  assert.equal(result.rows[0].key, "openLoopGain");
  assert.equal(result.rows[0].namedByModel, true);
  assert.deepEqual(result.named.map((n) => n.key), ["openLoopGain"]);
  // The VALUES are untouched: the model names, it does not supply numbers.
  assert.deepEqual(result.rows[0].values, { min: 100, typ: 120, max: null });
});

test("no second reading names nothing, rather than guessing", () => {
  const result = applyModelIdentities([row()], null);
  assert.equal(result.rows[0].key, null);
  assert.deepEqual(result.named, []);
});

test("a unit that contradicts the quantity refuses the name", () => {
  // A gain cannot be in amps. This is the check that catches a plausible
  // mislabel without anyone reading the page.
  const result = applyModelIdentities([row({ unit: "mA" })], [theirs({ unit: "mA" })]);
  assert.equal(result.rows[0].key, null);
  assert.deepEqual(result.named, []);
});

test("a unit we cannot parse is not proof, so the name still stands", () => {
  // `nV/root-Hz` and `uV/degC` are perfectly good units this scaler does not
  // know. Refusing on them would delete correct readings to satisfy a check.
  const r = row({ parameter: "Input voltage noise density", unit: "nV/√ Hz" });
  const t = theirs({ parameter: "Input voltage noise density", unit: "nV/√ Hz", means: "voltageNoise" });
  assert.equal(applyModelIdentities([r], [t]).rows[0].key, "voltageNoise");
});

test("a name outside the list is not a name", () => {
  const result = applyModelIdentities([row()], [theirs({ means: "somethingWeDoNotModel" })]);
  assert.equal(result.rows[0].key, null);
});

test("a row our vocabulary already named is NEVER renamed", () => {
  // Both readings named it. Ours stands whether or not the model agrees: this
  // adds names, it does not arbitrate between them.
  const result = applyModelIdentities([row({ key: "cmrr" })], [theirs({ means: "openLoopGain" })]);
  assert.equal(result.rows[0].key, "cmrr");
  assert.equal(result.rows[0].namedByModel, undefined);
  assert.deepEqual(result.conflicts.map((c) => [c.ours, c.theirs]), [["cmrr", "openLoopGain"]]);
});

test("the two readings agreeing on a name produces no conflict and no flag", () => {
  const result = applyModelIdentities([row({ key: "openLoopGain" })], [theirs()]);
  assert.deepEqual(result.conflicts, []);
  assert.deepEqual(result.named, []);
});

test("a null means leaves the row exactly as it was", () => {
  const result = applyModelIdentities([row()], [theirs({ means: null })]);
  assert.equal(result.rows[0].key, null);
});
