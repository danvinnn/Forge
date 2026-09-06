import { test } from "node:test";
import assert from "node:assert/strict";

test("official resource recovery stays network-free in air-gapped mode", async () => {
  const previous = process.env.FORGE_DEPLOYMENT_MODE;
  const originalFetch = globalThis.fetch;
  let called = false;
  process.env.FORGE_DEPLOYMENT_MODE = "air-gapped";
  globalThis.fetch = (async () => { called = true; throw new Error("network called"); }) as typeof fetch;
  try {
    const { GET } = await import("../../app/api/resources/route");
    const response = await GET(new Request("http://localhost/api/resources?partNumber=OPA333&manufacturer=Texas%20Instruments"));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { resources: [] });
    assert.equal(called, false);
  } finally {
    globalThis.fetch = originalFetch;
    if (previous === undefined) delete process.env.FORGE_DEPLOYMENT_MODE;
    else process.env.FORGE_DEPLOYMENT_MODE = previous;
  }
});
