import { test } from "node:test";
import assert from "node:assert/strict";
import { compareKicadSymbolPins, importKicadFootprint } from "../cad-import";
import { createExportZip } from "../exporters";
import type { PinRecord, ResolvedPart } from "../types";

const pins: PinRecord[] = [1, 2, 3, 4].map((number) => ({ number: String(number), name: `P${number}`, electricalType: "passive" }));
const part = {
  id: "fixture", partNumber: "ACME4", manufacturer: "ACME", packageType: "unknown vendor package",
  packageOutlineCode: null, jedecOutline: null, vendorLandPattern: null, exposedPad: false, pinCount: 4, pins,
  dimensions: {
    bodyLengthMm: 4, bodyWidthMm: 3, bodyHeightMm: 1, pitchMm: 1, leadLengthMm: null, leadCount: 4,
    leadSides: 2, leadForm: "nolead", mounting: "smd", leadDiameterMm: null, holeDiameterMm: null,
    leadWidthMm: null, leadSpanMm: null, leadSpanCrossMm: null, leadContactMm: null,
    thermalPadLengthMm: null, thermalPadWidthMm: null, landPadLengthMm: null, landPadWidthMm: null,
    landSpanMm: null, landSpanCrossMm: null, vacantLeadSlot: null, leadsPerSide: null,
    solderMaskExpansionMm: null, solderMaskDefined: null, thermalViaDiameterMm: null, thermalViaPitchMm: null
  },
  radiation: { tid: null, see: null, sel: null, qmlClass: null }, sourceFileName: "acme.pdf", notes: []
} satisfies ResolvedPart;

const source = `(footprint "ACME:Odd-4"
  (pad "1" smd roundrect (at -2 -0.5) (size 1 0.7) (layers "F.Cu" "F.Paste" "F.Mask"))
  (pad "2" smd roundrect (at -2 0.5) (size 1 0.7) (layers "F.Cu" "F.Paste" "F.Mask"))
  (pad "3" smd roundrect (at 2 0.5) (size 1 0.7) (layers "F.Cu" "F.Paste" "F.Mask"))
  (pad "4" smd roundrect (at 2 -0.5) (size 1 0.7) (layers "F.Cu" "F.Paste" "F.Mask")))`;

test("imports arbitrary numbered KiCad copper into neutral geometry", () => {
  const geometry = importKicadFootprint({ fileName: "odd.kicad_mod", source }, part);
  assert.deepEqual(geometry.pads.map((pad) => pad.number), ["1", "2", "3", "4"]);
  assert.equal(geometry.provenance.corroboration.from, "vendor");
  assert.match(geometry.description, /revalidated/i);
});

test("rejects malformed and unbounded vendor CAD", () => {
  assert.throws(() => importKicadFootprint({ fileName: "odd.kicad_mod", source: source.slice(0, -1) }, part), /unmatched opening/i);
  assert.throws(() => importKicadFootprint({ fileName: "odd.txt", source }, part), /\.kicad_mod/i);
});

test("the ordinary export boundary revalidates imported copper against the part", async () => {
  const geometry = importKicadFootprint({ fileName: "odd.kicad_mod", source }, part);
  const bundle = await createExportZip(part, "kicad", { importedFootprint: geometry, generatedAt: new Date(0) });
  assert.equal(bundle.geometry.provenance.corroboration.from, "vendor");

  const missingPin = { ...geometry, pads: geometry.pads.slice(0, -1) };
  await assert.rejects(() => createExportZip(part, "kicad", { importedFootprint: missingPin }), /pin|pad|terminal/i);
});

test("a vendor symbol independently corroborates pin names and numbering", () => {
  const symbol = `(kicad_symbol_lib (symbol "ACME4"
    (pin input line (at 0 0 0) (length 2.54) (name "P1") (number "1"))
    (pin input line (at 0 0 0) (length 2.54) (name "P2") (number "2"))
    (pin output line (at 0 0 0) (length 2.54) (name "P3") (number "3"))
    (pin power_in line (at 0 0 0) (length 2.54) (name "P4") (number "4"))))`;
  assert.deepEqual(compareKicadSymbolPins(symbol, part), {
    agrees: true,
    detail: "All 4 pin numbers and names agree with the vendor KiCad symbol."
  });
  assert.equal(compareKicadSymbolPins(symbol.replace('(name "P3")', '(name "OUT")'), part).agrees, false);
});
