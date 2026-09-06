/**
 * The amplifier hold-out may not overlap the tuned corpus.
 *
 * `LEARNINGS.md`: three parts once sat in both corpora at once and nothing
 * noticed for months, because a contaminated hold-out does not look broken. It
 * reads slightly high forever. The rule was stated forcefully in a comment and
 * enforced nowhere.
 *
 * So it is enforced here, from the day the corpus exists rather than after the
 * first misleading number.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { AMPLIFIER_HOLDOUT, REGULATOR_HOLDOUT } from "../__bench__/holdout-corpus";
import { TUNED_CORPUS } from "../../__bench__/spicecorpus";

const normalise = (part: string) => part.trim().toUpperCase();

test("no hold-out amplifier is also in the tuned corpus", () => {
  const tuned = new Set(TUNED_CORPUS.map(normalise));
  const overlap = AMPLIFIER_HOLDOUT.map((p) => p.partNumber).filter((p) => tuned.has(normalise(p)));
  assert.deepEqual(overlap, [], `these parts are fitted against AND counted as unseen: ${overlap.join(", ")}`);
});

test("no part appears twice in the hold-out", () => {
  const seen = new Set<string>();
  const repeated: string[] = [];
  for (const part of AMPLIFIER_HOLDOUT) {
    const key = normalise(part.partNumber);
    if (seen.has(key)) repeated.push(part.partNumber);
    seen.add(key);
  }
  // A repeated entry inflates the denominator and hides a miss inside a hit.
  assert.deepEqual(repeated, []);
});

test("the hold-out spans vendors and classes, or it measures one house style", () => {
  const vendors = new Set(AMPLIFIER_HOLDOUT.map((p) => p.manufacturer));
  const classes = new Set(AMPLIFIER_HOLDOUT.map((p) => p.klass));
  // Every vocabulary defect found so far was one vendor's typesetting: TI's
  // footnote markers, ST's trailing periods, ADI's Symbol font. A corpus from
  // two vendors would measure two house styles and call it generalisation.
  assert.ok(vendors.size >= 6, `only ${vendors.size} vendors`);
  assert.ok(classes.size >= 3, `only ${classes.size} device classes`);
  assert.ok(AMPLIFIER_HOLDOUT.length >= 20, `only ${AMPLIFIER_HOLDOUT.length} parts`);
});

test("a tuned part is never named twice either", () => {
  const seen = new Set<string>();
  const repeated = TUNED_CORPUS.filter((part) => {
    const key = normalise(part);
    const already = seen.has(key);
    seen.add(key);
    return already;
  });
  assert.deepEqual(repeated, []);
});

test("every device class this product models is in the tuned corpus", () => {
  // A class with no part fitted against is a class nothing measures. The
  // reference class shipped with a bench row on the day it existed, rather than
  // on the day somebody remembered to add one.
  //
  // Named parts rather than a count, because a count is satisfied by adding any
  // datasheet at all.
  assert.ok(TUNED_CORPUS.includes("REF5025"), "no voltage reference is measured by bench:model");
  assert.ok(TUNED_CORPUS.includes("LM139AQML-SP"), "no comparator is measured by bench:model");
  assert.ok(TUNED_CORPUS.includes("L7805"), "no regulator is measured by bench:model");
});

test("every device class this product models also has a hold-out", () => {
  // The tuned corpus above proves a class is MEASURED. It cannot prove the
  // measurement means anything: every rule in it was added because a part in it
  // failed. A class with no hold-out has a number and no way to know whether
  // that number generalises, which is the position the extraction parser was in
  // for months at 69% tuned and 49% unseen.
  const classes = new Set(AMPLIFIER_HOLDOUT.map((p) => p.klass));
  assert.ok(classes.has("opamp"));
  assert.ok(classes.has("comparator"));
  assert.ok(classes.has("reference"));
  assert.ok(REGULATOR_HOLDOUT.length >= 12, `only ${REGULATOR_HOLDOUT.length} regulators`);
  assert.ok(
    new Set(REGULATOR_HOLDOUT.map((p) => p.manufacturer)).size >= 5,
    "a regulator hold-out from two vendors measures two house styles and calls it generalisation"
  );
});

test("no regulator is in both the tuned corpus and the regulator hold-out", () => {
  const tuned = new Set(TUNED_CORPUS.map(normalise));
  const overlap = REGULATOR_HOLDOUT.map((p) => p.partNumber).filter((p) => tuned.has(normalise(p)));
  assert.deepEqual(overlap, [], `fitted against AND counted as unseen: ${overlap.join(", ")}`);
});

test("no regulator is in the amplifier hold-out either", () => {
  // Two corpora scoring one part under two different rules about what may be
  // tuned against is the exact hazard `.spice-holdout-cache` was split out for.
  const amplifiers = new Set(AMPLIFIER_HOLDOUT.map((p) => normalise(p.partNumber)));
  const overlap = REGULATOR_HOLDOUT.map((p) => p.partNumber).filter((p) => amplifiers.has(normalise(p)));
  assert.deepEqual(overlap, []);
});

test("no regulator is named twice", () => {
  const seen = new Set<string>();
  const repeated = REGULATOR_HOLDOUT.map((p) => p.partNumber).filter((p) => {
    const key = normalise(p);
    const already = seen.has(key);
    seen.add(key);
    return already;
  });
  assert.deepEqual(repeated, []);
});
