import assert from "node:assert/strict";
import test from "node:test";
import { ExtractionModelError, type ExtractionModel, type ExtractionRequest, type ExtractionResult } from "../contracts";
import { withProviderFallback } from "../models/fallback";

const request = { fields: [] } as unknown as ExtractionRequest;

function stub(name: string, answer: () => Promise<ExtractionResult>, native = true): ExtractionModel {
  return {
    name,
    supportsNativePdf: native,
    isConfigured: () => true,
    extract: answer
  };
}

test("provider fallback leaves a successful primary answer alone and records its provenance", async () => {
  let secondaryCalls = 0;
  const model = withProviderFallback(
    stub("vertex", async () => ({ values: {}, notes: ["primary"] })),
    stub("gemini", async () => {
      secondaryCalls += 1;
      return { values: {} };
    })
  );

  const result = await model.extract(request);
  assert.equal(result.answeredBy, "vertex");
  assert.deepEqual(result.notes, ["primary"]);
  assert.equal(secondaryCalls, 0);
});

test("provider fallback invisibly recovers a typed provider failure and records the actual reader", async () => {
  const model = withProviderFallback(
    stub("vertex", async () => { throw new ExtractionModelError("transport", "timed out", 1); }),
    stub("gemini", async () => ({ values: {}, notes: ["read"] }))
  );

  const result = await model.extract(request);
  assert.equal(result.answeredBy, "gemini");
  assert.deepEqual(result.notes, ["read", "The primary extraction service was unavailable; Forge recovered through gemini."]);
});

test("provider fallback reports both typed failures", async () => {
  const model = withProviderFallback(
    stub("vertex", async () => { throw new ExtractionModelError("transport", "timed out", 1); }),
    stub("gemini", async () => { throw new ExtractionModelError("config", "credits depleted", 2); })
  );

  await assert.rejects(
    () => model.extract(request),
    (error: unknown) => {
      assert.ok(error instanceof ExtractionModelError);
      assert.match(error.message, /vertex: timed out/);
      assert.match(error.message, /gemini: credits depleted/);
      assert.equal(error.attempts, 3);
      return true;
    }
  );
});

test("provider fallback never hides an untyped policy or programming error", async () => {
  let secondaryCalls = 0;
  const policyError = new Error("spend limit reached");
  const model = withProviderFallback(
    stub("vertex", async () => { throw policyError; }),
    stub("gemini", async () => {
      secondaryCalls += 1;
      return { values: {} };
    })
  );

  await assert.rejects(() => model.extract(request), (error) => error === policyError);
  assert.equal(secondaryCalls, 0);
});

test("provider fallback advertises native PDF only when both paths support it", () => {
  assert.equal(
    withProviderFallback(stub("vertex", async () => ({ values: {} })), stub("gemini", async () => ({ values: {} }), false))
      .supportsNativePdf,
    false
  );
});
