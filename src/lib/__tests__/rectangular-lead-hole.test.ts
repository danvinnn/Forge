import { test } from "node:test";
import assert from "node:assert/strict";
import { buildFootprintGeometry, FootprintUnavailableError } from "../exporters";
import type { ResolvedPart } from "../types";

/**
 * A DIP LEAD IS FLAT, AND ITS DRAWING NEVER PRINTS A DIAMETER.
 *
 * Reported 2026-09-10 against an AT17LV256-10PU: the PDIP read cleanly and the
 * footprint refused for `leadDiameterMm` alone. It was not that part. The
 * through-hole path took a diameter and nothing else, so every package with
 * stamped pins refused for a number no such datasheet carries - and the
 * hand-read dimension oracle records `leadDiameterMm` zero times across every
 * entry it holds.
 *
 * The numbers below are the oracle's own PDIP-8, hand-read off NCP1200 page 15,
 * CASE 626-05 ISSUE N: `b` 0.35-0.56 is the width, `C` 0.20-0.36 the thickness,
 * and the drawing letters neither a diameter.
 */
function pdip8(over: Record<string, unknown> = {}): ResolvedPart {
  return {
    id: "t", partNumber: "NCP1200", manufacturer: "onsemi", packageType: "PDIP-8",
    packageOutlineCode: "CASE 626-05", jedecOutline: null, vendorLandPattern: null,
    exposedPad: false, pinCount: 8,
    pins: Array.from({ length: 8 }, (_, i) => ({
      number: String(i + 1), name: `P${i + 1}`, electricalType: "unspecified" as const
    })),
    dimensions: {
      bodyLengthMm: 9.02, bodyWidthMm: 6.1, bodyHeightMm: 5.33, pitchMm: 2.54,
      leadLengthMm: 3.3, leadCount: 8,
      leadWidthMm: { minMm: 0.35, maxMm: 0.56 },
      leadThicknessMm: { minMm: 0.2, maxMm: 0.36 },
      leadSpanMm: { minMm: 7.62, maxMm: 8.26 },
      leadSpanCrossMm: null, leadContactMm: null,
      thermalPadLengthMm: null, thermalPadWidthMm: null,
      landPadLengthMm: null, landPadWidthMm: null, landSpanMm: null, landSpanCrossMm: null,
      leadSides: 2, leadForm: "straight", mounting: "through-hole",
      leadDiameterMm: null, holeDiameterMm: null,
      vacantLeadSlot: null, leadsPerSide: null, solderMaskExpansionMm: null,
      solderMaskDefined: null, thermalViaDiameterMm: null, thermalViaPitchMm: null,
      ...over
    },
    radiation: { tid: null, see: null, sel: null, qmlClass: null },
    sourceFileName: "ncp1200.pdf", notes: []
  } as never as ResolvedPart;
}

test("a flat lead's two dimensions size the hole, with no diameter printed anywhere", () => {
  const geometry = buildFootprintGeometry(pdip8(), "B");
  const drilled = geometry.pads.filter((pad) => (pad.drillMm ?? 0) > 0);
  assert.equal(drilled.length, 8, "every pin passes through the board");

  // IPC-7251 sizes the hole from the maximum lead cross-section, which for a
  // rectangular pin is its diagonal: hypot(0.56, 0.36) = 0.6657 mm. The hole is
  // that plus the standard's allowance, so it must CLEAR the diagonal and not
  // merely the wider side.
  const diagonal = Math.hypot(0.56, 0.36);
  for (const pad of drilled) {
    assert.ok(pad.drillMm! > diagonal, `a ${pad.drillMm} mm hole does not pass a ${diagonal.toFixed(3)} mm lead`);
    assert.ok(pad.drillMm! < diagonal + 1, `a ${pad.drillMm} mm hole is not sized from this lead at all`);
  }
});

test("one side of a rectangle is not a cross-section", () => {
  // Thickness unread. Guessing the missing side is the invention the derivation
  // exists to avoid, so this still asks rather than sizing a hole on the width.
  assert.throws(
    () => buildFootprintGeometry(pdip8({ leadThicknessMm: null }), "B"),
    (error: unknown) => {
      assert.ok(error instanceof FootprintUnavailableError);
      assert.ok(
        error.needs.some((need) => need.field === "leadDiameterMm"),
        "it asks for the lead, naming the field that receives the answer"
      );
      return true;
    }
  );
});

test("a round lead still uses its own diameter", () => {
  // The derivation is a fallback, not a replacement: where the drawing states a
  // diameter that is the reading, and a reading always outranks a derivation.
  const geometry = buildFootprintGeometry(pdip8({ leadDiameterMm: 1.2 }), "B");
  const drilled = geometry.pads.filter((pad) => (pad.drillMm ?? 0) > 0);
  const fromDiagonal = Math.hypot(0.56, 0.36);
  for (const pad of drilled) {
    assert.ok(pad.drillMm! > 1.2, "sized from the stated diameter");
    assert.ok(pad.drillMm! > fromDiagonal + 0.4, "and not from the flat-lead diagonal, which is smaller");
  }
});
