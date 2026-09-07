import { test } from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import { compareEagleLibraryPins, compareKicadSymbolPins, importCadFootprint, importEagleFootprint, importKicadFootprint } from "../cad-import";
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

test("a multi-part vendor symbol library corroborates only the requested part", () => {
  const symbol = `(kicad_symbol_lib
    (symbol "OTHER4"
      (pin input line (at 0 0 0) (length 2.54) (name "WRONG1") (number "1"))
      (pin input line (at 0 0 0) (length 2.54) (name "WRONG2") (number "2")))
    (symbol "ACME4"
      (pin input line (at 0 0 0) (length 2.54) (name "P1") (number "1"))
      (pin input line (at 0 0 0) (length 2.54) (name "P2") (number "2"))
      (pin output line (at 0 0 0) (length 2.54) (name "P3") (number "3"))
      (pin power_in line (at 0 0 0) (length 2.54) (name "P4") (number "4"))))`;
  assert.equal(compareKicadSymbolPins(symbol, part).agrees, true);
  assert.throws(() => compareKicadSymbolPins(symbol.replace('"ACME4"', '"ANOTHER4"'), part), /none uniquely names ACME4/i);
});

test("a vendor symbol alias follows only its explicit KiCad inheritance", () => {
  const symbol = `(kicad_symbol_lib
    (symbol "BASE4"
      (pin input line (at 0 0 0) (length 2.54) (name "P1") (number "1"))
      (pin input line (at 0 0 0) (length 2.54) (name "P2") (number "2"))
      (pin output line (at 0 0 0) (length 2.54) (name "P3") (number "3"))
      (pin power_in line (at 0 0 0) (length 2.54) (name "P4") (number "4")))
    (symbol "ACME4" (extends "BASE4")))`;
  assert.equal(compareKicadSymbolPins(symbol, part).agrees, true);
});

test("preserves general manufacturer geometry instead of normalising it away", async () => {
  const rich = `(footprint "ACME:Rich-4"
    (fp_rect (start -3 -2) (end 3 2) (layer "F.Fab"))
    (fp_rect (start -3.5 -2.5) (end 3.5 2.5) (layer "F.CrtYd"))
    (pad "1" smd roundrect (at -2 -0.5) (size 1 0.7) (layers "F.Cu" "F.Mask") (roundrect_rratio 0.1))
    (pad "1" smd rect (at -2.4 -0.5) (size 0.2 0.2) (layers "F.Cu" "F.Mask"))
    (pad "2" smd roundrect (at -2 0.5) (size 1 0.7) (layers "F.Cu" "F.Paste" "F.Mask"))
    (pad "3" smd roundrect (at 2 0.5) (size 1 0.7) (layers "F.Cu" "F.Paste" "F.Mask"))
    (pad "4" smd roundrect (at 2 -0.5) (size 1 0.7) (layers "F.Cu" "F.Paste" "F.Mask"))
    (pad "" np_thru_hole circle (at 0 1.5) (size 1.2 1.2) (drill oval 0.6 1) (layers "*.Cu" "*.Mask")))`;
  const geometry = importKicadFootprint({ fileName: "rich.kicad_mod", source: rich }, part);
  assert.equal(geometry.pads.filter((pad) => pad.number === "1").length, 2);
  assert.deepEqual(geometry.body, { halfWidthMm: 3, halfHeightMm: 2 });
  assert.deepEqual(geometry.courtyard, { halfWidthMm: 3.5, halfHeightMm: 2.5 });
  assert.equal(geometry.pads[0].hasPaste, false);
  assert.equal(geometry.pads[0].cornerRadiusRatio, 0.1);
  assert.equal(geometry.pads.at(-1)?.plated, false);
  assert.equal(geometry.pads.at(-1)?.drillWidthMm, 0.6);

  const bundle = await createExportZip(part, "kicad", { importedFootprint: geometry, generatedAt: new Date(0) });
  const archive = await JSZip.loadAsync(bundle.buffer);
  const footprint = await archive.file(/\.kicad_mod$/)[0].async("string");
  assert.match(footprint, /np_thru_hole circle/);
  assert.match(footprint, /\(drill oval 0\.600 1\.000\)/);
  assert.match(footprint, /roundrect_rratio 0\.1/);
  assert.doesNotMatch(footprint.split('\n').find((line) => line.includes('(pad "1" smd roundrect')) ?? "", /F\.Paste/);

  const altiumBundle = await createExportZip(part, "altium", { importedFootprint: geometry, generatedAt: new Date(0) });
  const altiumArchive = await JSZip.loadAsync(altiumBundle.buffer);
  assert.ok(altiumArchive.file(/\.PcbLib$/)[0], "the same arbitrary imported geometry, including its slot, reaches native Altium");
});

const eagle = `<?xml version="1.0" encoding="utf-8"?>
<eagle version="9.6"><drawing><library><packages>
  <package name="UNKNOWN-VENDOR-PACKAGE">
    <wire x1="-2" y1="-1" x2="2" y2="-1" width="0.1" layer="51"/>
    <wire x1="2" y1="-1" x2="2" y2="1" width="0.1" layer="51"/>
    <wire x1="2" y1="1" x2="-2" y2="1" width="0.1" layer="51"/>
    <wire x1="-2" y1="1" x2="-2" y2="-1" width="0.1" layer="51"/>
    <smd name="1" x="-2" y="0.5" dx="1" dy="0.7" layer="1" roundness="20" cream="no" rot="R90"/>
    <smd name="2" x="-2" y="-0.5" dx="1" dy="0.7" layer="1"/>
    <smd name="3" x="2" y="-0.5" dx="1" dy="0.7" layer="1"/>
    <smd name="4" x="2" y="0.5" dx="1" dy="0.7" layer="1"/>
    <hole x="0" y="0" drill="0.8"/>
  </package>
</packages></library></drawing></eagle>`;

test("imports EAGLE XML copper into the same neutral geometry", () => {
  const geometry = importCadFootprint({ fileName: "vendor.lbr", source: eagle }, part);
  assert.deepEqual(geometry.pads.filter((pad) => pad.number).map((pad) => pad.number), ["1", "2", "3", "4"]);
  assert.deepEqual(geometry.pads[0].centre, { xMm: -2, yMm: -0.5 });
  assert.equal(geometry.pads[0].rotationDeg, 90);
  assert.equal(geometry.pads[0].cornerRadiusRatio, 0.1);
  assert.equal(geometry.pads[0].hasPaste, false);
  assert.equal(geometry.pads.at(-1)?.plated, false);
  assert.deepEqual(geometry.body, { halfWidthMm: 2, halfHeightMm: 1 });
  assert.match(geometry.provenance.source, /vendor\.lbr/);
});

test("an exactly identified EAGLE device independently corroborates package pins", () => {
  const connections = pins.map((pin) => `<connect gate="G$1" pin="${pin.name}" pad="${pin.number}"/>`).join("");
  const withDevice = eagle.replace(
    "</library>",
    `<devicesets><deviceset name="ACME4"><devices><device name="" package="UNKNOWN-VENDOR-PACKAGE"><connects>${connections}</connects></device></devices></deviceset></devicesets></library>`
  );
  assert.deepEqual(compareEagleLibraryPins(withDevice, part), {
    agrees: true,
    detail: "All 4 pin numbers and names agree with the vendor EAGLE device."
  });
  assert.equal(compareEagleLibraryPins(withDevice.replace('pin="P3"', 'pin="OUT"'), part).agrees, false);
  assert.throws(
    () => compareEagleLibraryPins(withDevice.replace('deviceset name="ACME4"', 'deviceset name="OTHER4"'), part),
    /no device exactly identifying ACME4/i
  );
});

test("selects one EAGLE package only from the requested package identity", () => {
  const other = `<package name="OTHER"><smd name="1" x="0" y="0" dx="1" dy="1" layer="1"/></package>`;
  const library = eagle.replace("<packages>", `<packages>${other}`);
  assert.equal(importEagleFootprint({ fileName: "multi.lbr", source: library }, part).name, "UNKNOWN-VENDOR-PACKAGE");
  assert.throws(
    () => importEagleFootprint({ fileName: "multi.lbr", source: library }, { ...part, packageType: "unmatched" }),
    /none uniquely matches/i
  );
  assert.throws(
    () => importEagleFootprint({ fileName: "multi.lbr", source: library }, { ...part, packageType: "unknown-vendor" }),
    /none uniquely matches/i,
    "a shorter similar name must not silently select a different package"
  );
});

test("refuses EAGLE features that cannot be preserved exactly", () => {
  assert.throws(
    () => importEagleFootprint({ fileName: "custom.lbr", source: eagle.replace("</package>", '<polygon width="0.1" layer="1"></polygon></package>') }, part),
    /arbitrary top-layer copper/i
  );
  assert.throws(
    () => importEagleFootprint({ fileName: "mirrored.lbr", source: eagle.replace('rot="R90"', 'rot="MR90"') }, part),
    /mirrored/i
  );
  const implicit = eagle.replace(/<smd[\s\S]*?<\/package>/, '<pad name="1" x="0" y="0" drill="0.8"/></package>');
  assert.throws(() => importEagleFootprint({ fileName: "implicit.lbr", source: implicit }, part), /state its copper diameter/i);
  const longPad = eagle.replace(/<smd[\s\S]*?<\/package>/, '<pad name="1" x="0" y="0" drill="0.8" diameter="1.5" shape="long"/></package>');
  assert.throws(() => importEagleFootprint({ fileName: "long.lbr", source: longPad }, part), /unsupported shape long/i);
});
