import { test } from "node:test";
import assert from "node:assert/strict";
import { DEVICE_CLASSES } from "../model";
import { inspectVendorModel, VENDOR_PRIMITIVE_TERMINALS } from "../vendor";
import { SPICE_MODEL_STRATEGIES, unresolvedOpportunity } from "../opportunity";

test("every generated class has both automatic and cited-review paths", () => {
  const classes = DEVICE_CLASSES.map((deviceClass) => deviceClass.id).sort();
  assert.deepEqual([...SPICE_MODEL_STRATEGIES.generatedBehavioural].sort(), classes);
  assert.deepEqual([...SPICE_MODEL_STRATEGIES.reviewedBehavioural].sort(), classes);
});

test("every declared primitive strategy is accepted by the vendor inspector", () => {
  for (const [type, terminals] of Object.entries(VENDOR_PRIMITIVE_TERMINALS)) {
    const [candidate] = inspectVendorModel(`.model FORGE_TEST ${type}(X=1)\n`);
    assert.ok(candidate, `${type} was declared but cannot be inspected`);
    assert.deepEqual(candidate.terminals, terminals, `${type} terminal contract drifted`);
  }
});

test("every unsuccessful generated build has a named next route", () => {
  assert.deepEqual(
    unresolvedOpportunity({ correctionAvailable: true, configurationAvailable: true }),
    { disposition: "page-review-required", resolved: false }
  );
  assert.deepEqual(
    unresolvedOpportunity({ correctionAvailable: false, configurationAvailable: true }),
    { disposition: "configuration-required", resolved: false }
  );
  assert.deepEqual(
    unresolvedOpportunity({ correctionAvailable: false, configurationAvailable: false }),
    { disposition: "vendor-model-required", resolved: false }
  );
});
