import { test } from "node:test";
import assert from "node:assert/strict";
import { assessModelAssurance } from "../assurance";

test("a measurable model contradiction refuses while an unverifiable behavior is disclosed as a limitation", () => {
  assert.equal(assessModelAssurance({
    confirmations: null,
    checks: [{ parameter: "gbw", corner: "typ", expected: 1, measured: 2, verdict: "fail", errorPct: 100 }]
  }).outcome, "refused");
  const limited = assessModelAssurance({
    confirmations: null,
    checks: [{ parameter: "slewRate", corner: "typ", expected: 1, measured: null, verdict: "unverifiable", reason: "No test circuit.", errorPct: null }]
  });
  assert.equal(limited.outcome, "ready");
  assert.equal(limited.limitations.length, 1);
});

test("an unresolved specification block is input, never an implicit choice", () => {
  assert.equal(assessModelAssurance({ confirmations: null, checks: [], selectionRequired: true }).outcome, "needs-input");
});

test("a part-specific topology not established by the datasheet is review, not silent", () => {
  const decision = assessModelAssurance({
    confirmations: null,
    checks: [],
    findings: [{
      id: "output-stage",
      label: "Output stage",
      state: "review",
      detail: "Confirm push-pull."
    }]
  });
  assert.equal(decision.outcome, "review");
  assert.deepEqual(decision.review.map((finding) => finding.id), ["output-stage"]);
});
