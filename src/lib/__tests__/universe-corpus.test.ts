import assert from "node:assert/strict";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { BENCH_CORPUS } from "../retrieval/__bench__/corpus";
import { HOLDOUT_CORPUS } from "../__bench__/holdout-corpus";
import { TUNED_CORPUS } from "../__bench__/spicecorpus";
import { AMPLIFIER_HOLDOUT, REGULATOR_HOLDOUT } from "../spice/__bench__/holdout-corpus";
import { REQUIRED_UNIVERSE_PAIRS, UNIVERSE_CELLS, UNIVERSE_CORPUS } from "../__bench__/universe-corpus";
import { UNIVERSE_ORACLE } from "../__bench__/universe-oracle";

const key = (value: string) => value.toUpperCase().replace(/[^A-Z0-9]/g, "");

test("the black-box universe covers every externally declared population", () => {
  const covered = new Set(UNIVERSE_CORPUS.flatMap((part) => part.cells));
  assert.deepEqual(UNIVERSE_CELLS.filter((cell) => !covered.has(cell)), []);
});

test("every declared cross-risk pair occurs in at least one frozen document", () => {
  for (const [left, right] of REQUIRED_UNIVERSE_PAIRS) {
    assert.ok(
      UNIVERSE_CORPUS.some((part) => part.cells.includes(left) && part.cells.includes(right)),
      `no frozen document covers ${left} × ${right}`
    );
  }
});

test("the black-box corpus was not previously tuned or held out", () => {
  const old = new Set([
    ...BENCH_CORPUS.map((part) => part.partNumber),
    ...HOLDOUT_CORPUS.map((part) => part.partNumber),
    ...TUNED_CORPUS,
    ...AMPLIFIER_HOLDOUT.map((part) => part.partNumber),
    ...REGULATOR_HOLDOUT.map((part) => part.partNumber)
  ].map(key));
  const overlap = UNIVERSE_CORPUS.filter((part) => old.has(key(part.partNumber))).map((part) => part.partNumber);
  assert.deepEqual(overlap, []);
  assert.equal(new Set(UNIVERSE_CORPUS.map((part) => key(part.partNumber))).size, UNIVERSE_CORPUS.length);

  // Some blind panels are data directories rather than exported TypeScript
  // arrays. Checking only imported manifests missed one of them once, which is
  // enough to invalidate a claim that this panel is unseen.
  const cachedPdfStems = [".blind-cache", ".bench-cache", ".holdout-cache", ".phase0-cache", ".spice-holdout-cache"]
    .flatMap((directory) => {
      const path = join(process.cwd(), directory);
      return existsSync(path)
        ? readdirSync(path).filter((name) => /\.pdf$/i.test(name)).map((name) => key(name.replace(/\.pdf$/i, "")))
        : [];
    });
  const cachedOverlap = UNIVERSE_CORPUS
    .filter((part) => cachedPdfStems.some((stem) => stem.includes(key(part.partNumber))))
    .map((part) => part.partNumber);
  assert.deepEqual(cachedOverlap, []);
});

test("the panel stays compact and cannot silently drop a unique population", () => {
  assert.ok(UNIVERSE_CORPUS.length <= 20);
  for (const part of UNIVERSE_CORPUS) {
    const other = new Set(UNIVERSE_CORPUS.filter((candidate) => candidate !== part).flatMap((candidate) => candidate.cells));
    const unique = part.cells.filter((cell) => !other.has(cell));
    assert.ok(unique.length > 0, `${part.partNumber} adds no unique population and only adds cost`);
  }
});

test("every frozen document has an independent multi-turn release contract", () => {
  for (const part of UNIVERSE_CORPUS) {
    const oracle = UNIVERSE_ORACLE[part.partNumber];
    assert.ok(oracle?.source.startsWith("https://"), `${part.partNumber} has no authoritative source`);
    assert.ok(oracle.e2e, `${part.partNumber} has no end-to-end contract`);
    for (const answer of Object.values(oracle.e2e.cad.answers ?? {})) {
      assert.ok(answer.source.length >= 20, `${part.partNumber} has an uncited CAD answer`);
    }
    for (const answer of Object.values(oracle.e2e.spice.supplied ?? {})) {
      assert.ok(answer.source.length >= 20, `${part.partNumber} has an uncited SPICE answer`);
    }
  }
});
