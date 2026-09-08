import assert from "node:assert/strict";
import { test } from "node:test";
import JSZip from "jszip";
import { KICAD_ACCEPTANCE_FIXTURES } from "../__bench__/kicad-fixtures";
import { createExportZip } from "../exporters";

test("the clean-checkout KiCad gate always has buildable tracked inputs", async () => {
  assert.ok(KICAD_ACCEPTANCE_FIXTURES.length >= 4, "the gate covers more than one placement path");
  for (const part of KICAD_ACCEPTANCE_FIXTURES) {
    const bundle = await createExportZip(part, "kicad", {});
    const zip = await JSZip.loadAsync(bundle.buffer);
    const names = Object.keys(zip.files);
    assert.ok(names.some((name) => name.endsWith(".kicad_mod")), `${part.partNumber} emits a footprint`);
    assert.ok(names.some((name) => name.endsWith(".kicad_sym")), `${part.partNumber} emits a symbol`);
  }
});
