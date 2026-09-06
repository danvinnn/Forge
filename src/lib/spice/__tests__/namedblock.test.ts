/**
 * WHICH OF SIXTEEN BLOCKS IS THE PART THAT WAS ASKED FOR.
 *
 * A 78xx family datasheet carries one specification table per output voltage,
 * each captioned `Electrical characteristics of L7805A` through `of L7824A`.
 * Every one of them builds. Falling back to whichever sorted first is a coin
 * flip between a 5 V part and a 24 V one - with every value read correctly,
 * every conformance check passing, and nothing downstream able to tell.
 *
 * So a caption that NAMES the requested part is used, and that is a read rather
 * than a pick: the document is saying which table describes this part. Where
 * the document does not discriminate, the choice goes back to the user, which
 * is what `alternatives` is for.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { namedBlock } from "../build";
import type { ModelBlock } from "../model";

function block(scope: string | null): ModelBlock {
  return { scope, group: null, values: {}, missing: [], missingFor: {} as ModelBlock["missingFor"] };
}

const FAMILY = ["L7805A", "L7806A", "L7808A", "L7812A", "L7824A"].map(block);

test("the block whose caption names the part wins", () => {
  assert.equal(namedBlock(FAMILY, "L7805")?.scope, "L7805A");
  assert.equal(namedBlock(FAMILY, "L7824")?.scope, "L7824A");
  // And the caption may be the shorter of the two: `LD1117` asked for, a block
  // captioned `LD1117` among others captioned `LD1117-18`.
  assert.equal(namedBlock([block("LD1117"), block("LD1117-33")], "LD1117-33")?.scope, "LD1117-33");
});

test("punctuation in a caption is not part of the name", () => {
  // A scope is a caption and carries the document's typesetting: `LD1117#18`
  // and `LD1117-18` are the same statement about the same part.
  assert.equal(namedBlock([block("LD1117#18"), block("LD1117#25")], "LD1117-18")?.scope, "LD1117#18");
});

test("no match is null, and the caller falls back rather than guessing", () => {
  assert.equal(namedBlock(FAMILY, "OPA333"), null);
  assert.equal(namedBlock([block(null), block(null)], "L7805"), null);
});

test("two blocks naming the same part is the document declining to choose", () => {
  // Not an error and not a tie to be broken here: two captions naming one part
  // means the choice is genuinely open, and it goes to the user.
  assert.equal(namedBlock([block("L7805A"), block("L7805C")], "L7805"), null);
});

test("a scope or a part number too short to be specific matches nothing", () => {
  // Containment on two characters would match almost anything. `AD` inside
  // `ADR4525` is not evidence that a block describes the part `AD`.
  assert.equal(namedBlock([block("A")], "A"), null);
  assert.equal(namedBlock([block("VS = 5 V")], "L7805"), null);
});

test("the caller of buildModel is told HOW the block was chosen", async () => {
  // The screen prints a different sentence for each of these, because "the
  // document captions this table with your part number" and "it came first" are
  // very different claims that the scope alone renders identically.
  const { buildModel } = await import("../build");
  const { readFileSync, existsSync } = await import("node:fs");
  const { join } = await import("node:path");

  const path = join(process.cwd(), ".bench-cache", "L7805.pdf");
  if (!existsSync(path)) return; // no cached datasheet on this machine
  const bytes = readFileSync(path);
  const built = await buildModel(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
    "L7805"
  );
  assert.ok(built.alternatives.length > 1, "L7805 carries one block per output voltage and grade");
  // SIXTEEN BLOCKS, captioned L7805A through L7824A and L7805C through L7824C.
  // `L7805` names two of them - the A grade and the C grade - so the document
  // has NOT said which part is on the bench, and the honest answer is to say so
  // rather than to break the tie. The screen prints "check the scope against
  // your part" for exactly this.
  assert.equal(built.blockChosenBy, "first-of-several");

  // Asked for the grade, and the caption then names exactly one.
  const graded = await buildModel(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
    "L7812C"
  );
  assert.equal(graded.blockChosenBy, "caption-names-the-part");
  assert.equal(graded.block?.scope, "L7812C");
});
