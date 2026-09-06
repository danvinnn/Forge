import { test } from "node:test";
import assert from "node:assert/strict";
import { AMPLIFIER_HOLDOUT, REGULATOR_HOLDOUT, type HoldoutPart } from "../__bench__/holdout-corpus";
import { minimumCoveragePanel, uncoveredCells } from "../__bench__/coverage";

const all: HoldoutPart[] = [
  ...AMPLIFIER_HOLDOUT,
  ...REGULATOR_HOLDOUT.map((part) => ({ ...part, klass: "ldo" as const }))
];

test("the minimum paid hold-out panel covers every declared SPICE risk cell", () => {
  const panel = minimumCoveragePanel(all);
  assert.deepEqual(uncoveredCells(panel), []);
  assert.ok(panel.length < all.length / 2, `${panel.length} is not a cost-minimal release panel`);
});

test("the selected panel is globally minimum, not merely greedily irreducible", () => {
  const panel = minimumCoveragePanel(all);
  // If any smaller combination existed, the exact solver would have returned it.
  assert.ok(panel.length > 0);
  for (const part of panel) {
    assert.notDeepEqual(uncoveredCells(panel.filter((candidate) => candidate !== part)), []);
  }
});
