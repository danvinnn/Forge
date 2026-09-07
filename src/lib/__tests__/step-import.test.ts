import assert from "node:assert/strict";
import test from "node:test";
import { importStepModel } from "../step-import";

const COMPLETE_STEP = `ISO-10303-21;
HEADER;
FILE_DESCRIPTION(('fixture'),'2;1');
ENDSEC;
DATA;
#1=CARTESIAN_POINT('',(0.,0.,0.));
ENDSEC;
END-ISO-10303-21;
`;

test("a complete STEP Part 21 model is preserved exactly", () => {
  const imported = importStepModel({ fileName: "../ACME body.STP", source: COMPLETE_STEP });
  assert.equal(imported.fileName, "ACME-body.STP");
  assert.equal(imported.source, COMPLETE_STEP);
});

test("a STEP file with a truncated data section is refused", () => {
  assert.throws(
    () => importStepModel({
      fileName: "body.step",
      source: COMPLETE_STEP.replace("ENDSEC;\nEND-ISO-10303-21;", "END-ISO-10303-21;")
    }),
    /truncates a required Part 21 section/i
  );
});

test("arbitrary text under a STEP filename is refused", () => {
  assert.throws(
    () => importStepModel({ fileName: "body.step", source: "not a model" }),
    /not a complete STEP Part 21/i
  );
});
