import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPartRecord } from "../../datasheet";
import { datasheetTextFromPages } from "../../pdftext";
import { answerForBenchTest } from "../shipcheck";

function record() {
  return buildPartRecord(datasheetTextFromPages(["ACME engineering drawing"]), "ACME.pdf");
}

test("the answerability witness never makes a grid land wider than its pitch", () => {
  const part = record();
  part.pinCount.value = 4;
  part.pins.value = ["A1", "A2", "B1", "B2"].map((number) => ({
    number,
    name: number,
    electricalType: "unspecified" as const
  }));
  part.dimensions.pitchMm.value = 0.35;

  const answer = answerForBenchTest(
    { field: "landPadLengthMm", label: "Land diameter", why: "missing", unit: "mm", scope: "part" },
    part
  );
  assert.equal(typeof answer, "number");
  assert.ok((answer as number) < 0.35);
});

test("a part-specific formed-span witness clears the package that rejected the installation setting", () => {
  const part = record();
  part.dimensions.bodyLengthMm.value = 24;
  part.dimensions.bodyWidthMm.value = 10;

  const answer = answerForBenchTest(
    { field: "formedLeadSpanMm", label: "Formed lead span", why: "too small", unit: "mm", scope: "part" },
    part
  );
  assert.equal(typeof answer, "number");
  assert.ok((answer as number) > 24);
});
