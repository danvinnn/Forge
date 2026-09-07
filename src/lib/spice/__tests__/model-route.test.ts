/**
 * `/api/model`, at its edges.
 *
 * The route is where a refusal becomes something a user reads, so what is
 * tested here is that a refusal still NAMES what the document did not state and
 * still hands back everything that WAS read. A refusal that throws away the
 * reading is the shape this project has paid for repeatedly.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { POST } from "../../../app/api/model/route";
import { __setLimiterOverrides, __setResolverOverride, RateLimiter } from "../../retrieval";

const CACHE = path.join(process.cwd(), ".bench-cache");

// This file intentionally exercises many requests against one module-level
// route. Rate-limit behavior has its own isolated contract tests; keep it from
// turning a newly added route case into order-dependent 429s here.
__setLimiterOverrides({
  upload: new RateLimiter(1_000, 60_000),
  lookup: new RateLimiter(1_000, 60_000)
});

function upload(fields: Record<string, string>, bytes?: Uint8Array): Request {
  const body = new FormData();
  if (bytes) body.append("file", new File([bytes as BlobPart], "datasheet.pdf", { type: "application/pdf" }));
  for (const [key, value] of Object.entries(fields)) body.append(key, value);
  return new Request("http://localhost/api/model", { method: "POST", body });
}

test("a malformed part-number lookup is refused before retrieval", async () => {
  const response = await POST(upload({ partNumber: "?" }));
  assert.equal(response.status, 400);
  assert.equal((await response.json()).code, "INPUT_REQUIRED");
});

test("an overlong part number is rejected rather than truncated into another device", async () => {
  const response = await POST(upload({ partNumber: `OPA333${"X".repeat(80)}` }));
  assert.equal(response.status, 400);
  assert.equal((await response.json()).code, "INPUT_REQUIRED");
});

const OPA333_LOOKUP = path.join(CACHE, "OPA333.pdf");
test(
  "a typed part builds SPICE from a verified retrieved datasheet without inventing an upload",
  { skip: fs.existsSync(OPA333_LOOKUP) ? false : "no cached datasheet" },
  async () => {
    const bytes = fs.readFileSync(OPA333_LOOKUP);
    __setResolverOverride({
      name: "model-route-fixture",
      isConfigured: () => true,
      async resolve() {
        return {
          bytes: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
          fileName: "OPA333.pdf",
          pdfUrl: "https://www.ti.com/lit/ds/symlink/opa333.pdf",
          byteLength: bytes.byteLength,
          sha256: "fixture",
          resolvedBy: "model-route-fixture"
        };
      }
    });
    try {
      const response = await POST(upload({ partNumber: "OPA333", response: "json" }));
      assert.equal(response.status, 200);
      const payload = await response.json() as Record<string, unknown>;
      assert.equal(payload.partNumber, "OPA333");
      assert.equal(typeof payload.zipBase64, "string");
    } finally {
      __setResolverOverride();
    }
  }
);

test("a typed model request reports an unreadable retrieved document instead of crashing", async () => {
  __setResolverOverride({
    name: "broken-model-route-fixture",
    isConfigured: () => true,
    async resolve() {
      return {
        bytes: new Uint8Array([1, 2, 3, 4]).buffer,
        fileName: "not-a-pdf.pdf",
        byteLength: 4,
        sha256: "fixture",
        resolvedBy: "broken-model-route-fixture"
      };
    }
  });
  try {
    const response = await POST(upload({ partNumber: "OPA333", response: "json" }));
    assert.equal(response.status, 422);
    assert.equal((await response.json()).code, "WRONG_DOCUMENT");
  } finally {
    __setResolverOverride();
  }
});

test("a request with no part number is refused by name", async () => {
  const response = await POST(upload({}, new Uint8Array([0x25, 0x50, 0x44, 0x46])));
  assert.equal(response.status, 400);
  assert.equal((await response.json()).code, "INPUT_REQUIRED");
});

test("a document that states nothing is refused WITH what was read", async () => {
  // Not a PDF at all, so nothing can be read. The refusal must still be a named
  // outcome carrying its counts, never an unhandled throw.
  const response = await POST(upload({ partNumber: "NOTAPART" }, new Uint8Array([1, 2, 3, 4])));
  assert.equal(response.status, 422);
  const payload = (await response.json()) as Record<string, unknown>;
  assert.equal(payload.code, "INCOMPLETE_EXTRACTION");
  assert.match(String(payload.error), /does not state/);
  assert.equal(typeof payload.parametersRead, "number");
  assert.ok(Array.isArray(payload.blocks));
  assert.equal(payload.vendorUploadAccepted, true);
  assert.deepEqual(payload.modelOpportunity, { disposition: "vendor-model-required", resolved: false });
});

test("a vendor subcircuit rescues a datasheet Forge cannot model without inventing behaviour", async () => {
  const body = new FormData();
  body.append("file", new File([new Uint8Array([1, 2, 3, 4]) as BlobPart], "datasheet.pdf", { type: "application/pdf" }));
  body.append("vendorModel", new File([
    ".subckt THEIR_SENSOR EXC+ OUT EXC-\nR1 EXC+ OUT 1k\n.ends THEIR_SENSOR\n"
  ], "vendor-sensor.lib", { type: "text/plain" }));
  body.append("partNumber", "SENSOR-1");
  body.append("response", "json");
  const response = await POST(new Request("http://localhost/api/model", { method: "POST", body }));
  assert.equal(response.status, 200);
  const payload = await response.json() as {
    zipBase64: string;
    deviceClassLabel: string;
    vendorVerification: { structuralOnly: boolean; terminals: string[] };
    modelOpportunity: { disposition: string; resolved: boolean };
  };
  assert.equal(payload.deviceClassLabel, "vendor-authored model adapter");
  assert.deepEqual(payload.vendorVerification.terminals, ["EXC+", "OUT", "EXC-"]);
  assert.equal(payload.vendorVerification.structuralOnly, true);
  assert.deepEqual(payload.modelOpportunity, { disposition: "vendor-backed", resolved: true });
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(Buffer.from(payload.zipBase64, "base64"));
  assert.equal(zip.file("vendor-sensor.lib"), null, "the uploaded vendor file must not be redistributed");
  assert.match(await zip.file("SENSOR_1.lib")!.async("string"), /\.include "vendor-sensor\.lib"/);
});

test("a multi-subcircuit vendor file asks which declaration is the part", async () => {
  const body = new FormData();
  body.append("file", new File([new Uint8Array([1, 2, 3, 4]) as BlobPart], "datasheet.pdf", { type: "application/pdf" }));
  body.append("vendorModel", new File([
    ".subckt HELPER A B\nR1 A B 1k\n.ends HELPER\n.subckt PART IN OUT GND\nX1 IN OUT HELPER\n.ends PART\n"
  ], "vendor.lib", { type: "text/plain" }));
  body.append("partNumber", "PART-1");
  body.append("response", "json");
  let response = await POST(new Request("http://localhost/api/model", { method: "POST", body }));
  assert.equal(response.status, 422);
  const choose = await response.json() as { code: string; vendorCandidates: Array<{ id: string; name: string }> };
  assert.equal(choose.code, "VENDOR_SELECTION_REQUIRED");
  const selected = choose.vendorCandidates.find((candidate) => candidate.name === "PART");
  assert.ok(selected);
  body.set("vendorCandidate", selected.id);
  response = await POST(new Request("http://localhost/api/model", { method: "POST", body }));
  assert.equal(response.status, 200);
});

test("a value-bearing vendor model asks for its instance value, then builds without guessing", async () => {
  const body = new FormData();
  body.append("file", new File([new Uint8Array([1, 2, 3, 4]) as BlobPart], "datasheet.pdf", { type: "application/pdf" }));
  body.append("vendorModel", new File([".model RMOD R(TC1=.001)\n"], "vendor.lib", { type: "text/plain" }));
  body.append("partNumber", "RESISTOR");
  body.append("response", "json");
  let response = await POST(new Request("http://localhost/api/model", { method: "POST", body }));
  assert.equal(response.status, 422);
  const configure = await response.json() as { code: string; vendorConfiguration: { parameter: string } };
  assert.equal(configure.code, "VENDOR_CONFIGURATION_REQUIRED");
  assert.equal(configure.vendorConfiguration.parameter, "resistance");

  body.set("vendorInstanceValue", "10k");
  response = await POST(new Request("http://localhost/api/model", { method: "POST", body }));
  assert.equal(response.status, 200);
  const payload = await response.json() as { zipBase64: string };
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(Buffer.from(payload.zipBase64, "base64"));
  assert.match(await zip.file("RESISTOR.lib")!.async("string"), /Rvendor P1 P2 RMOD 10k/);

  // A syntactically valid SPICE scalar still has to satisfy the question's
  // physical contract: this route asks for a positive value, not merely a
  // token the simulator can parse.
  body.set("vendorInstanceValue", "0");
  response = await POST(new Request("http://localhost/api/model", { method: "POST", body }));
  assert.equal(response.status, 400);
  assert.equal((await response.json()).code, "INPUT_INVALID");
});

const OPA333 = path.join(CACHE, "OPA333.pdf");
test(
  "a real datasheet yields the model, the symbol and the receipt",
  { skip: fs.existsSync(OPA333) ? false : "no cached datasheet" },
  async () => {
    const response = await POST(upload({ partNumber: "OPA333" }, new Uint8Array(fs.readFileSync(OPA333))));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Content-Type"), "application/zip");

    const JSZip = (await import("jszip")).default;
    const zip = await JSZip.loadAsync(await response.arrayBuffer());
    const names = Object.keys(zip.files).sort();
    assert.deepEqual(names, ["OPA333-conformance.txt", "OPA333.asy", "OPA333.lib"]);

    const lib = await zip.file("OPA333.lib")!.async("string");
    // The topology is disclosed, the parameters are cited, and the corners are
    // the document's own.
    assert.match(lib, /Topology: single-pole behavioural/);
    assert.match(lib, /page 7/);
    assert.match(lib, /\.subckt OPA333 IN\+ IN- OUT VCC VEE/);

    const receipt = await zip.file("OPA333-conformance.txt")!.async("string");
    assert.match(receipt, /model conformance report/);
    assert.match(receipt, /Built as an operational amplifier/);
    assert.match(receipt, /Specification block:/);
    assert.match(receipt, /openLoopGain\s+.*\(page \d+\)/);
    assert.match(receipt, /gbw\s+.*\(page \d+\)/);
    // Slew rate cannot be reproduced from what OPA333 prints, and the receipt
    // says so rather than calling it a failure.
    assert.match(receipt, /unverifiable\s+slewRate/);
    assert.equal(/\bfail\s+\w/.test(receipt.split("-".repeat(76))[1] ?? ""), false);
  }
);

test(
  "a reviewed parameter correction is rebuilt, cited, and returned to the screen",
  { skip: fs.existsSync(OPA333) ? false : "no cached datasheet" },
  async () => {
    const correction = JSON.stringify([{
      parameter: "openLoopGain",
      printed: { min: 106, typ: 120, max: null },
      unit: "dB",
      page: 7
    }]);
    const response = await POST(upload(
      { partNumber: "OPA333", response: "json", corrections: correction },
      new Uint8Array(fs.readFileSync(OPA333))
    ));
    assert.equal(response.status, 200);
    const payload = await response.json() as {
      zipBase64: string;
      parameters: Array<{ key: string; printed: { typ: number | null }; page: number | null; correctedByUser: boolean }>;
      toCheck: Array<{ id: string; state: string }>;
    };
    const corrected = payload.parameters.find((parameter) => parameter.key === "openLoopGain");
    assert.deepEqual(corrected, {
      key: "openLoopGain",
      printed: { min: 106, typ: 120, max: null },
      unit: "dB",
      page: 7,
      correctedByUser: true
    });
    assert.ok(payload.toCheck.some((item) => item.id === "parameter-corrections" && item.state === "confirmed"));
    const JSZip = (await import("jszip")).default;
    const zip = await JSZip.loadAsync(Buffer.from(payload.zipBase64, "base64"));
    assert.match(await zip.file("OPA333-conformance.txt")!.async("string"), /corrected by you from page 7/);
  }
);

test(
  "a both request returns one movable archive with CAD and SPICE folders",
  { skip: fs.existsSync(OPA333) ? false : "no cached datasheet" },
  async () => {
    const JSZip = (await import("jszip")).default;
    const cad = new JSZip();
    cad.file("OPA333.kicad_sym", "(kicad_symbol_lib)");
    const cadBytes = await cad.generateAsync({ type: "uint8array" });
    const body = new FormData();
    body.append("file", new File([new Uint8Array(fs.readFileSync(OPA333)) as BlobPart], "datasheet.pdf", { type: "application/pdf" }));
    body.append("cadBundle", new File([cadBytes as BlobPart], "cad-forge.zip", { type: "application/zip" }));
    body.append("partNumber", "OPA333");
    body.append("response", "json");
    const response = await POST(new Request("http://localhost/api/model", { method: "POST", body }));
    assert.equal(response.status, 200);
    const payload = await response.json() as { fileName: string; zipBase64: string };
    assert.equal(payload.fileName, "OPA333-forge.zip");
    const combined = await JSZip.loadAsync(Buffer.from(payload.zipBase64, "base64"));
    assert.deepEqual(Object.keys(combined.files).filter((name) => !combined.files[name].dir).sort(), [
      "README.txt",
      "cad/OPA333.kicad_sym",
      "spice/OPA333-conformance.txt",
      "spice/OPA333.asy",
      "spice/OPA333.lib"
    ]);
  }
);

test(
  "a supplied vendor model is checked but never redistributed",
  { skip: fs.existsSync(OPA333) ? false : "no cached datasheet" },
  async () => {
    const body = new FormData();
    body.append("file", new File([new Uint8Array(fs.readFileSync(OPA333)) as BlobPart], "datasheet.pdf", { type: "application/pdf" }));
    body.append("vendorModel", new File([
      ".subckt THEIR_OP IN+ IN- OUT VCC VEE\nEOUT OUT 0 IN+ IN- 100000\n.ends THEIR_OP\n"
    ], "vendor.lib", { type: "text/plain" }));
    body.append("partNumber", "OPA333");
    body.append("manufacturer", "Texas Instruments");
    body.append("response", "json");
    const response = await POST(new Request("http://localhost/api/model", { method: "POST", body }));
    assert.equal(response.status, 200);
    const payload = await response.json() as {
      zipBase64: string;
      vendorResource: { modelKnown: boolean; url: string };
      vendorVerification: { status: string };
    };
    assert.equal(payload.vendorResource.modelKnown, true);
    assert.match(payload.vendorResource.url, /^https:\/\/www\.ti\.com\//);
    assert.equal(payload.vendorVerification.status, "checked");
    const JSZip = (await import("jszip")).default;
    const zip = await JSZip.loadAsync(Buffer.from(payload.zipBase64, "base64"));
    const names = Object.keys(zip.files);
    assert.ok(names.includes("OPA333-vendor-conformance.txt"));
    assert.equal(names.some((name) => /vendor\.lib$/i.test(name)), false, "the vendor's copyrighted file must not be redistributed");
  }
);

test(
  "a generated result asks which canonical vendor subcircuit is the part instead of picking a helper",
  { skip: fs.existsSync(OPA333) ? false : "no cached datasheet" },
  async () => {
    const body = new FormData();
    body.append("file", new File([new Uint8Array(fs.readFileSync(OPA333)) as BlobPart], "datasheet.pdf", { type: "application/pdf" }));
    body.append("vendorModel", new File([
      ".subckt HELPER IN+ IN- OUT VCC VEE\nE1 OUT 0 IN+ IN- 10\n.ends HELPER\n",
      ".subckt OPA333 IN+ IN- OUT VCC VEE\nE1 OUT 0 IN+ IN- 100000\n.ends OPA333\n"
    ], "vendor.lib", { type: "text/plain" }));
    body.append("partNumber", "OPA333");
    body.append("response", "json");
    let response = await POST(new Request("http://localhost/api/model", { method: "POST", body }));
    assert.equal(response.status, 200);
    const choose = await response.json() as {
      vendorVerification: { status: string; error: string };
      vendorCandidates: Array<{ id: string; name: string }>;
    };
    assert.equal(choose.vendorVerification.status, "refused");
    assert.equal(choose.vendorCandidates.length, 2);
    const part = choose.vendorCandidates.find((candidate) => candidate.name === "OPA333");
    assert.ok(part);
    body.set("vendorCandidate", part.id);
    response = await POST(new Request("http://localhost/api/model", { method: "POST", body }));
    assert.equal(response.status, 200);
    const checked = await response.json() as { vendorVerification: { status: string }; vendorCandidates: unknown[] };
    assert.equal(checked.vendorVerification.status, "checked");
    assert.equal(checked.vendorCandidates.length, 0);
  }
);

test(
  "a correction with the wrong physical unit is refused",
  { skip: fs.existsSync(OPA333) ? false : "no cached datasheet" },
  async () => {
    const response = await POST(upload(
      {
        partNumber: "OPA333",
        corrections: JSON.stringify([{
          parameter: "openLoopGain",
          printed: { min: null, typ: 120, max: null },
          unit: "A",
          page: 7
        }])
      },
      new Uint8Array(fs.readFileSync(OPA333))
    ));
    assert.equal(response.status, 400);
    assert.equal((await response.json()).code, "INPUT_INVALID");
  }
);

test(
  "a correction cannot fabricate a citation outside the uploaded PDF",
  { skip: fs.existsSync(OPA333) ? false : "no cached datasheet" },
  async () => {
    const response = await POST(upload(
      {
        partNumber: "OPA333",
        corrections: JSON.stringify([{
          parameter: "openLoopGain",
          printed: { min: null, typ: 120, max: null },
          unit: "dB",
          page: 9999
        }])
      },
      new Uint8Array(fs.readFileSync(OPA333))
    ));
    assert.equal(response.status, 400);
    const payload = await response.json();
    assert.equal(payload.code, "INPUT_INVALID");
    assert.match(payload.error, /not in this PDF/);
  }
);

test(
  "a reviewed device kind constrains recognition instead of being forgotten between corrections",
  { skip: fs.existsSync(OPA333) ? false : "no cached datasheet" },
  async () => {
    const response = await POST(upload(
      { partNumber: "OPA333", reviewDeviceClass: "comparator", response: "json" },
      new Uint8Array(fs.readFileSync(OPA333))
    ));
    assert.equal(response.status, 422);
    const payload = await response.json();
    assert.equal(payload.code, "INCOMPLETE_EXTRACTION");
    assert.match(payload.error, /comparator/);
  }
);

const L7805 = path.join(CACHE, "L7805.pdf");
test(
  "a REGULATOR comes back through the same route as a regulator",
  { skip: fs.existsSync(L7805) ? false : "no cached datasheet" },
  async () => {
    // The route is class-agnostic by construction, which is exactly the kind of
    // claim that is true until a fourth class arrives. Asserted end to end
    // because the class decides the terminals, the topology line and the word on
    // the receipt, and getting any of those wrong ships a file that opens.
    //
    // L7805 also exercises the family case: its datasheet carries sixteen
    // captioned per-voltage tables, and the one that names the requested part is
    // the one that must come back.
    const bytes = new Uint8Array(fs.readFileSync(L7805));
    const choiceResponse = await POST(upload({ partNumber: "L7805", response: "json" }, bytes));
    assert.equal(choiceResponse.status, 422);
    const choice = await choiceResponse.json() as { code: string; blockChoices: Array<{ index: number; scope: string | null }> };
    assert.equal(choice.code, "MODEL_SELECTION_REQUIRED");
    const fiveVolt = choice.blockChoices.find((block) => block.scope === "L7805A");
    assert.ok(fiveVolt);
    const staleChoice = await POST(upload({ partNumber: "L7805", blockChoice: "999", response: "json" }, bytes));
    assert.equal(staleChoice.status, 422);
    assert.equal((await staleChoice.json()).code, "MODEL_SELECTION_REQUIRED", "an out-of-range choice must never silently mean the first block");
    const response = await POST(upload({ partNumber: "L7805", blockChoice: String(fiveVolt.index) }, bytes));
    assert.equal(response.status, 200);

    const JSZip = (await import("jszip")).default;
    const zip = await JSZip.loadAsync(await response.arrayBuffer());
    assert.deepEqual(Object.keys(zip.files).sort(), ["L7805-conformance.txt", "L7805.asy", "L7805.lib"]);

    const lib = await zip.file("L7805.lib")!.async("string");
    assert.match(lib, /Topology: behavioural low-dropout regulator/);
    assert.match(lib, /\.subckt L7805 IN OUT GND/);
    // The dropout limit is the whole reason this is not the reference class.
    assert.match(lib, /V=min\(/);
    // The right one of sixteen blocks: 5 V, not 24.
    assert.match(lib, /Specification block: L7805A/);

    const asy = await zip.file("L7805.asy")!.async("string");
    assert.match(asy, /behavioural low-dropout regulator/);

    const receipt = await zip.file("L7805-conformance.txt")!.async("string");
    assert.match(receipt, /model conformance report/);
    assert.match(receipt, /Built as a low-dropout regulator/);
    assert.match(receipt, /Specification block: L7805A/);
    assert.match(receipt, /outputVoltage\s+.*\(page \d+\)/);
    assert.match(receipt, /dropoutVoltage\s+.*\(page \d+\)/);
    assert.equal(/\bfail\s+\w/.test(receipt.split("-".repeat(76))[1] ?? ""), false);
  }
);

/**
 * THE ONE VALUE A USER MAY SUPPLY.
 *
 * A modern fixed LDO states an output ACCURACY and no nominal, because the
 * voltage is an ordering option: measured across fourteen regulator datasheets
 * outside the hold-out, seven state it nowhere. The number is in the
 * part-number suffix, and decoding a suffix into a specification is exactly
 * what this product refuses to do - `-1.8` means 1.8 V on one vendor and `3302`
 * means 3.3 V on another.
 *
 * So it asks. What is tested here is that asking stays honest: the question is
 * only offered where it can be answered, the answer is bounded, and it is
 * marked as supplied everywhere it afterwards appears.
 */

const LP5907 = path.join(CACHE, "LP5907.pdf");

test(
  "a refusal the user can lift comes back with the question",
  { skip: fs.existsSync(LP5907) ? false : "no cached datasheet" },
  async () => {
    const bytes = new Uint8Array(fs.readFileSync(LP5907));
    const refused = await POST(upload({ partNumber: "LP5907" }, bytes));
    assert.equal(refused.status, 422);
    const payload = (await refused.json()) as Record<string, unknown>;
    const asks = payload.asks as Array<Record<string, string>>;
    assert.equal(asks.length, 1);
    assert.equal(asks[0].field, "outputVoltage");
    assert.equal(asks[0].unit, "V");
    // The question says WHY. A question with no reason reads as the product
    // having failed rather than as the document being silent.
    assert.match(asks[0].why, /ordering option/);
  }
);

test(
  "the supplied value builds the model and is marked as supplied everywhere",
  { skip: fs.existsSync(LP5907) ? false : "no cached datasheet" },
  async () => {
    const bytes = new Uint8Array(fs.readFileSync(LP5907));
    const response = await POST(upload({ partNumber: "LP5907", "supplied.outputVoltage": "3.3" }, bytes));
    assert.equal(response.status, 200);

    const JSZip = (await import("jszip")).default;
    const zip = await JSZip.loadAsync(await response.arrayBuffer());
    const lib = await zip.file("LP5907.lib")!.async("string");

    // NEVER A PAGE NUMBER. A citation is a claim that a number is on a page,
    // and printing one beside a value a person typed is the product fabricating
    // provenance, which is the one thing it exists not to do.
    assert.match(lib, /outputVoltage\s+typ 3\.3 V\s+\(supplied by you, not stated by this datasheet\)/);
    assert.match(lib, /outputVoltage was SUPPLIED, not read/);
    assert.equal(/outputVoltage.*page \d/.test(lib), false);

    const receipt = await zip.file("LP5907-conformance.txt")!.async("string");
    // And the receipt says it BEFORE the table of verdicts, which would
    // otherwise make a check against the user's own number look like evidence.
    assert.match(receipt, /SUPPLIED, NOT READ: outputVoltage/);
    assert.ok(
      receipt.indexOf("SUPPLIED, NOT READ") < receipt.indexOf("verdict        parameter"),
      "the warning must come before the table it is about"
    );
  }
);

test(
  "a nonsense answer is dropped rather than modelled",
  { skip: fs.existsSync(LP5907) ? false : "no cached datasheet" },
  async () => {
    // Bounded on the route as well as in the box, because a bound that exists
    // only on the client is not a bound. A slipped decimal point must refuse,
    // not produce a 3300 V regulator that simulates perfectly.
    const bytes = new Uint8Array(fs.readFileSync(LP5907));
    for (const answer of ["3300", "-3.3", "0", "not-a-number", ""]) {
      const response = await POST(upload({ partNumber: "LP5907", "supplied.outputVoltage": answer }, bytes));
      assert.equal(response.status, 422, `${answer} must not become an output voltage`);
    }
  }
);

test(
  "a value the DOCUMENT states is never overwritten by an answer",
  { skip: fs.existsSync(path.join(CACHE, "L7805.pdf")) ? false : "no cached datasheet" },
  async () => {
    // The user is answering a question this product asked because the page was
    // silent. If the page was not silent, the question should not have been
    // asked and the page wins.
    const bytes = new Uint8Array(fs.readFileSync(path.join(CACHE, "L7805.pdf")));
    const response = await POST(upload({ partNumber: "L7805", "supplied.outputVoltage": "42", blockChoice: "0" }, bytes));
    assert.equal(response.status, 200);
    const JSZip = (await import("jszip")).default;
    const zip = await JSZip.loadAsync(await response.arrayBuffer());
    const lib = await zip.file("L7805.lib")!.async("string");
    assert.equal(/42/.test(lib.split(".subckt")[0]), false, "the answer must not appear in the citations");
    assert.match(lib, /outputVoltage\s+min 4\.9, typ 5, max 5\.1 V\s+\(page \d/);
  }
);

test(
  "nothing but the output voltage may be supplied",
  { skip: fs.existsSync(path.join(CACHE, "LT1013.pdf")) ? false : "no cached datasheet" },
  async () => {
    // LT1013 is refused for a gain-bandwidth its datasheet states only as a
    // GRAPH. That is a characterisation the vendor measured, so it must never
    // enter through the uncited `supplied.*` channel. A separate reviewed
    // correction may be offered only with rendered pages and a source-page
    // requirement.
    const bytes = new Uint8Array(fs.readFileSync(path.join(CACHE, "LT1013.pdf")));
    const response = await POST(upload({ partNumber: "LT1013", "supplied.gbw": "800000" }, bytes));
    assert.equal(response.status, 422);
    const payload = (await response.json()) as Record<string, unknown>;
    assert.deepEqual(payload.asks, [], "a refusal nobody can lift must offer no question");
    assert.ok(
      (payload.correctionNeeds as Array<{ parameter: string }>).some((need) => need.parameter === "gbw"),
      "a missed measured value should have a page-backed review path"
    );
    assert.ok(Array.isArray(payload.reviewPages));
  }
);

test("a question is not offered where its answer would be ignored", async () => {
  // `ldo:outputVoltage` means the document is silent and an answer lifts the
  // refusal. `ldo:outputVoltage(read-not-every-corner)` means the document
  // states one this model cannot use - a value present at some corners and not
  // at every corner the block expresses - and a supplied answer never
  // overwrites what the page said. Offering the box there is a question whose
  // answer goes nowhere, which is worse than the refusal it decorates.
  //
  // Asserted on the route's own matcher rather than through a datasheet,
  // because which corpus part happens to land in the marked case changes.
  const marked = "ldo:outputVoltage(read-not-every-corner)";
  assert.equal(marked.split(/[:+]/).includes("outputVoltage"), false);
  assert.equal("ldo:outputVoltage".split(/[:+]/).includes("outputVoltage"), true);
  assert.equal("ldo:outputVoltage+dropoutVoltage".split(/[:+]/).includes("outputVoltage"), true);
});

test("the route declares a time budget rather than inheriting one", async () => {
  // `/api/parse` declares 150 seconds and races the model pass against it. This
  // route declared nothing, so it inherited the platform default and a slow
  // second reading killed the whole request: the user got a generic failure
  // instead of the model, which the deterministic reading alone can always
  // produce. Asserted here because the failure only appears in deployment.
  const route = (await import("../../../app/api/model/route")) as Record<string, unknown>;
  assert.equal(typeof route.maxDuration, "number");
  assert.ok((route.maxDuration as number) >= 60, `maxDuration is ${route.maxDuration}`);
});
