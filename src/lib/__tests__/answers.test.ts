import assert from "node:assert/strict";
import { test } from "node:test";
import { answerFor, questionsToShow } from "../answers";
import type { RequiredInput } from "../exporters";

const need: RequiredInput = {
  field: "terminalPads",
  label: "Complete numbered-land layout",
  why: "The manufacturer drawing uses an irregular layout.",
  unit: "terminal-layout",
  scope: "part"
};

test("a complete numbered-land JSON answer is parsed without changing its geometry", () => {
  const pads = [
    { number: "1", xMm: -0.325, yMm: 0.48, widthMm: 0.26, heightMm: 0.24, shape: "rect" },
    { number: "2", xMm: 0.325, yMm: 0.48, widthMm: 0.26, heightMm: 0.24, shape: "rect" }
  ];
  assert.deepEqual(answerFor(need, JSON.stringify(pads)), { ok: true, value: pads });
});

test("a numbered-land answer rejects malformed JSON, missing dimensions, and duplicate terminals", () => {
  assert.equal(answerFor(need, "not json").ok, false);
  assert.equal(answerFor(need, JSON.stringify([{ number: "1", xMm: 0 }])).ok, false);
  assert.equal(answerFor(need, JSON.stringify([
    { number: "1", xMm: -1, yMm: 0, widthMm: 1, heightMm: 1, shape: "rect" },
    { number: "1", xMm: 1, yMm: 0, widthMm: 1, heightMm: 1, shape: "rect" }
  ])).ok, false);
});

test("a terminal export response does not revive the chooser's stale questions", () => {
  const predicted: RequiredInput[] = [{
    field: "formedLeadSpanMm",
    label: "Formed lead span",
    why: "The forming die decides it.",
    unit: "mm",
    scope: "install"
  }];
  const corrected: RequiredInput[] = [{
    field: "landSpanMm",
    label: "Corrected land span",
    why: "The supplied span failed geometry validation.",
    unit: "mm",
    scope: "part"
  }];

  assert.deepEqual(questionsToShow(false, [], predicted), predicted, "prediction is useful before export");
  assert.deepEqual(questionsToShow(true, corrected, predicted), corrected, "the server's corrective question wins");
  assert.deepEqual(questionsToShow(true, [], predicted), [], "an authoritative empty response stays empty");
});
