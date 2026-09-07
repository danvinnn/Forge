/**
 * `/api/identify`, at its edges.
 *
 * This route did not exist until 2026-09-04. `/suite` had called it from the
 * day it was written, every upload 404'd, the component swallowed the failure
 * and the screen looked fine. Nothing in the repository could see it, because
 * nothing loaded that screen. So the contract is pinned here, not only in a
 * browser run that costs a build and a server.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { POST } from "../../app/api/identify/route";
import { __setResolverOverride } from "../retrieval";

const CACHE = path.join(process.cwd(), ".bench-cache");

function upload(bytes?: Uint8Array): Request {
  const body = new FormData();
  if (bytes) body.append("file", new File([bytes as BlobPart], "datasheet.pdf", { type: "application/pdf" }));
  return new Request("http://localhost/api/identify", { method: "POST", body });
}

test("a request with no file is refused by name, not by crash", async () => {
  const response = await POST(upload());
  assert.equal(response.status, 400);
  assert.equal((await response.json()).code, "UPLOAD_INVALID");
});

test("a typed lookup is validated before any retrieval", async () => {
  const response = await POST(new Request("http://localhost/api/identify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ partNumber: "?" })
  }));
  assert.equal(response.status, 400);
  assert.equal((await response.json()).code, "INPUT_INVALID");
});

const OPA333_LOOKUP = path.join(CACHE, "OPA333.pdf");
test(
  "a typed part is identified before any model read",
  { skip: fs.existsSync(OPA333_LOOKUP) ? false : "no cached datasheet" },
  async () => {
    const bytes = fs.readFileSync(OPA333_LOOKUP);
    __setResolverOverride({
      name: "identify-route-fixture",
      isConfigured: () => true,
      async resolve() {
        return {
          bytes: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
          fileName: "OPA333.pdf",
          pdfUrl: "https://www.ti.com/lit/ds/symlink/opa333.pdf",
          byteLength: bytes.byteLength,
          sha256: "fixture",
          resolvedBy: "identify-route-fixture"
        };
      }
    });
    try {
      const response = await POST(new Request("http://localhost/api/identify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ partNumber: "OPA333" })
      }));
      assert.equal(response.status, 200);
      const payload = await response.json() as Record<string, unknown>;
      assert.equal(payload.partNumber, "OPA333");
      assert.equal(payload.partNumberFrom, "user-input");
      assert.equal(payload.sourceUrl, "https://www.ti.com/lit/ds/symlink/opa333.pdf");
      assert.ok(Array.isArray(payload.packages));
    } finally {
      __setResolverOverride();
    }
  }
);

test("typed identification does not leak resolver failures", async () => {
  __setResolverOverride({
    name: "secret-fixture",
    isConfigured: () => true,
    async resolve() { throw new Error("token=do-not-leak internal.example"); }
  });
  try {
    const response = await POST(new Request("http://localhost/api/identify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ partNumber: "OPA333" })
    }));
    assert.equal(response.status, 502);
    const payload = await response.json() as Record<string, unknown>;
    assert.equal(payload.code, "LOOKUP_FAILED");
    assert.doesNotMatch(String(payload.error), /token|internal\.example/i);
  } finally {
    __setResolverOverride();
  }
});

test("a file that is not a PDF is bad INPUT, not a server fault", async () => {
  const response = await POST(upload(new Uint8Array([1, 2, 3, 4])));
  // Anything but a 500. A person seeing "something went wrong" learns nothing
  // they can act on, and this route's whole job is to say what a file is.
  assert.ok(response.status === 400 || response.status === 422, `status was ${response.status}`);
  const payload = (await response.json()) as Record<string, unknown>;
  assert.ok(typeof payload.error === "string" && payload.error.length > 0);
});

const OPA333 = path.join(CACHE, "OPA333.pdf");
test(
  "a real datasheet is identified, free, with every field the screen reads",
  { skip: fs.existsSync(OPA333) ? false : "no cached datasheet" },
  async () => {
    const response = await POST(upload(new Uint8Array(fs.readFileSync(OPA333))));
    assert.equal(response.status, 200);
    const payload = (await response.json()) as Record<string, unknown>;

    // Every field `SuiteWorkspace`'s `Identified` declares. A missing one is
    // `undefined` on the screen, which renders as nothing and looks deliberate.
    for (const field of ["partNumber", "partNumberFrom", "manufacturer", "pageCount", "packages", "specPages", "outlinePage", "sha256", "fileName", "sourceUrl"]) {
      assert.ok(field in payload, `the screen reads ${field} and the route does not return it`);
    }
    // The part number is the FILE NAME, and the route says so rather than
    // letting a screen present it as something read off the page.
    assert.equal(payload.partNumber, "datasheet");
    assert.equal(payload.partNumberFrom, "file-name");
    assert.equal(payload.sourceUrl, null, "an upload has no manufacturer URL to invent");
    assert.ok((payload.pageCount as number) > 1);
    assert.ok(Array.isArray(payload.packages));
    // 64 hex characters, so the screen's citation is a real digest.
    assert.match(String(payload.sha256), /^[0-9a-f]{64}$/);
  }
);

test("the route declares a time budget rather than inheriting one", async () => {
  const route = (await import("../../app/api/identify/route")) as Record<string, unknown>;
  assert.equal(typeof route.maxDuration, "number");
});
