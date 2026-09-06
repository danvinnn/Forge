import { test } from "node:test";
import assert from "node:assert/strict";
import { assessAssurance, MAX_REVIEW_ITEMS, type AssuranceFinding } from "../assurance";
import { cadElectricalTypeLimitations, cadPendingFindings, cadReviewFindings } from "../cad-assurance";
import type { PinRecord } from "../types";
import type { ReviewItem } from "../review";

const finding = (state: AssuranceFinding["state"], id: string = state): AssuranceFinding => ({ id, label: id, state, detail: id });

test("one assurance policy orders contradiction, input, review, and ready", () => {
  assert.equal(assessAssurance({}).outcome, "ready");
  assert.equal(assessAssurance({ findings: [finding("review")] }).outcome, "review");
  assert.equal(assessAssurance({ findings: [finding("limitation")] }).outcome, "ready");
  assert.equal(assessAssurance({ missingInputs: ["pitch"] }).outcome, "needs-input");
  assert.equal(assessAssurance({ unresolvedChoices: ["package"] }).outcome, "needs-input");
  assert.equal(assessAssurance({ findings: [finding("contradiction")] }).outcome, "refused");
});

test("review volume never turns a buildable artefact into a refusal", () => {
  const findings = Array.from({ length: MAX_REVIEW_ITEMS + 1 }, (_, index) => finding("review", `review-${index}`));
  const decision = assessAssurance({ findings });
  assert.equal(decision.outcome, "review");
  assert.equal(decision.review.length, MAX_REVIEW_ITEMS + 1, "nothing is hidden to make it shippable");
});

test("a contradiction outranks an answerable question", () => {
  assert.equal(assessAssurance({ findings: [finding("contradiction")], missingInputs: ["value"] }).outcome, "refused");
});

test("the same claim reported by two layers is one review item", () => {
  const decision = assessAssurance({
    findings: [finding("confirmed", "pitch"), finding("review", "pitch"), finding("review", "body")]
  });
  assert.equal(decision.review.length, 2);
  assert.equal(decision.findings.find((item) => item.id === "pitch")?.state, "review");
});

test("CAD counts model review unless a genuine output confirmation covers that field", () => {
  const review: ReviewItem[] = [
    {
      field: "dimensions.pitchMm",
      label: "Lead pitch",
      display: "1.27 mm",
      page: 2,
      snippet: "1.27",
      confidence: 0.5,
      reason: "model-read",
      consequence: "Moves every pad.",
      blocking: false
    },
    {
      field: "dimensions.mounting",
      label: "Mounting",
      display: "smd",
      page: 2,
      snippet: "surface mount",
      confidence: 0.5,
      reason: "model-read",
      consequence: "Chooses lands or holes.",
      blocking: false
    }
  ];
  const findings = cadReviewFindings(review, [
    { id: "pitch", label: "Lead pitch", state: "confirmed", detail: "two drawings agree", page: 2 }
  ]);
  assert.deepEqual(findings.map((item) => item.id), ["land-pattern"]);
});

test("CAD counts a package drawing as one glance rather than one per field", () => {
  const make = (field: string, label: string): ReviewItem => ({
    field,
    label,
    display: "1 mm",
    page: 2,
    snippet: "1",
    confidence: 0.5,
    reason: "model-read",
    consequence: "Changes the package geometry.",
    blocking: false
  });
  const findings = cadPendingFindings(
    [
      make("dimensions.pitchMm", "Lead pitch"),
      make("dimensions.bodyLengthMm", "Body length"),
      make("dimensions.leadSides", "Lead sides")
    ],
    []
  );
  assert.deepEqual(findings.map((item) => item.id), ["package-outline"]);
});

test("a flagged grouped CAD check replaces its underlying field reviews", () => {
  const review: ReviewItem[] = [
    {
      field: "dimensions.pitchMm",
      label: "Lead pitch",
      display: "1.27 mm",
      page: 2,
      snippet: "1.27",
      confidence: 0.5,
      reason: "model-read",
      consequence: "Moves every pad.",
      blocking: false
    }
  ];
  assert.deepEqual(
    cadReviewFindings(review, [
      { id: "pitch", label: "Lead pitch", state: "flagged", detail: "check page 2", page: 2 }
    ]),
    []
  );
});

test("CAD ERC limitation follows user-editable pin types", () => {
  const pin = (electricalType: PinRecord["electricalType"]): PinRecord => ({
    number: "1",
    name: "IN",
    electricalType
  });
  assert.equal(cadElectricalTypeLimitations([pin("unspecified")]).length, 1);
  assert.deepEqual(cadElectricalTypeLimitations([pin("input")]), []);
});
