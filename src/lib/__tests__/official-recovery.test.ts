import assert from "node:assert/strict";
import test from "node:test";
import { automaticOfficialImports, recognizedOfficialArtifact, type RecoverableOfficialResource } from "../official-recovery";

const resources: RecoverableOfficialResource[] = [
  { kind: "package-drawing", url: "https://maker.test/drawing.pdf" },
  { kind: "cad", url: "https://maker.test/part.pretty.zip" },
  { kind: "step", url: "https://maker.test/part.step" },
  { kind: "pinout", url: "https://maker.test/part-bsdl.zip" },
  { kind: "spice", url: "https://maker.test/part.lib" },
  { kind: "cad", url: "https://maker.test/part-alt.pretty.zip" },
  { kind: "application-note", url: "https://maker.test/note.pdf" }
];

test("automatic official recovery attempts only artifact types needed by the chosen intent", () => {
  assert.deepEqual(automaticOfficialImports(resources, "cad", { cad: false, step: false, spice: false, pinout: false }, new Set()).map((r) => r.kind), ["cad", "step", "pinout", "cad"]);
  assert.deepEqual(automaticOfficialImports(resources, "spice", { cad: false, spice: false }, new Set()).map((r) => r.kind), ["spice"]);
  assert.deepEqual(automaticOfficialImports(resources, "both", { cad: false, step: false, spice: false, pinout: false }, new Set()).map((r) => r.kind), ["cad", "step", "pinout", "spice", "cad"]);
});

test("automatic official recovery never replaces an artifact or retries a failed URL", () => {
  const attempted = new Set(["https://maker.test/part.pretty.zip"]);
  assert.deepEqual(
    automaticOfficialImports(resources, "both", { cad: true, step: true, pinout: true, spice: false }, attempted).map((r) => r.url),
    ["https://maker.test/part.lib"]
  );
});

test("an archive file is selected only when the requested part identifies exactly one candidate", () => {
  const files = [{ fileName: "helpers.lib" }, { fileName: "TPS7A4901_trans.lib" }, { fileName: "TPS7A3301_trans.lib" }];
  assert.equal(recognizedOfficialArtifact(files, "spice", { partNumber: "TPS7A4901" })?.fileName, "TPS7A4901_trans.lib");
  assert.equal(recognizedOfficialArtifact(files.slice(0, 2), "spice", { partNumber: "TPS7A" }), null);
});

test("a selected CAD package can uniquely narrow several manufacturer footprints", () => {
  const files = [{ fileName: "SOIC-8.kicad_mod" }, { fileName: "VSSOP-8.kicad_mod" }, { fileName: "VQFN-16.kicad_mod" }];
  assert.equal(recognizedOfficialArtifact(files, "cad", { packageType: "8-lead VSSOP" })?.fileName, "VSSOP-8.kicad_mod");
  assert.equal(recognizedOfficialArtifact(files, "cad", { packageType: "8-lead package" }), null);
});

test("a selected CAD package can uniquely narrow several manufacturer 3D models", () => {
  const files = [{ fileName: "SOIC-8.step" }, { fileName: "VSSOP-8.step" }, { fileName: "VQFN-16.step" }];
  assert.equal(recognizedOfficialArtifact(files, "step", { packageType: "8-lead VSSOP" })?.fileName, "VSSOP-8.step");
  assert.equal(recognizedOfficialArtifact(files, "step", { packageType: "8-lead package" }), null);
});

test("recognition refuses two equally plausible files instead of choosing archive order", () => {
  const files = [{ fileName: "OPA333.lib" }, { fileName: "OPA333_typ.lib" }];
  assert.equal(recognizedOfficialArtifact(files, "spice", { partNumber: "OPA333" }), null);
});
