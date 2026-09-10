import type { ResolvedPart } from "../types";

/**
 * Tracked, evidence-shaped records for the official KiCad acceptance gate.
 *
 * The ignored replay cache is useful extra breadth on a developer machine, but
 * it cannot be the gate's only input: a fresh release runner has no cache. These
 * records exercise each distinct placement path and the KiCad electrical pin
 * tokens without pretending to measure datasheet extraction.
 */

const dimensions = (
  values: Partial<ResolvedPart["dimensions"]>
): ResolvedPart["dimensions"] => ({
  bodyLengthMm: null,
  bodyWidthMm: null,
  bodyHeightMm: null,
  pitchMm: null,
  leadLengthMm: null,
  leadCount: null,
  leadWidthMm: null,
  leadSpanMm: null,
  leadSpanCrossMm: null,
  leadContactMm: null,
  thermalPadLengthMm: null,
  thermalPadWidthMm: null,
  landPadLengthMm: null,
  landPadWidthMm: null,
  landSpanMm: null,
  landSpanCrossMm: null,
  leadSides: null,
  leadForm: null,
  mounting: null,
  leadDiameterMm: null,
  leadThicknessMm: null,
  holeDiameterMm: null,
  vacantLeadSlot: null,
  leadsPerSide: null,
  solderMaskExpansionMm: null,
  solderMaskDefined: null,
  thermalViaDiameterMm: null,
  thermalViaPitchMm: null,
  ...values
});

function part(
  partNumber: string,
  packageType: string,
  terminals: string[],
  values: Partial<ResolvedPart["dimensions"]>,
  options: { exposedPad?: boolean; ncTerminal?: string } = {}
): ResolvedPart {
  return {
    id: `official-kicad-${partNumber}`,
    partNumber,
    manufacturer: "Forge acceptance fixture",
    packageType,
    packageOutlineCode: null,
    jedecOutline: null,
    vendorLandPattern: null,
    pinCount: terminals.length,
    pins: terminals.map((number) => ({
      number,
      name: number === options.ncTerminal ? "NC" : `P${number}`,
      electricalType: number === options.ncTerminal ? "nc" : "passive"
    })),
    exposedPad: options.exposedPad ?? false,
    dimensions: dimensions(values),
    radiation: { tid: null, see: null, sel: null, qmlClass: null },
    sourceFileName: `${partNumber}.fixture`,
    notes: ["Tracked fixture for official KiCad syntax acceptance; not an extraction result."]
  };
}

export const KICAD_ACCEPTANCE_FIXTURES: ResolvedPart[] = [
  part("FORGE_SOIC8", "SOIC-8", ["1", "2", "3", "4", "5", "6", "7", "8"], {
    bodyLengthMm: 4.9,
    bodyWidthMm: 3.9,
    bodyHeightMm: 1.5,
    pitchMm: 1.27,
    leadLengthMm: 0.6,
    leadCount: 8,
    leadWidthMm: { minMm: 0.31, maxMm: 0.51 },
    leadSpanMm: { minMm: 5.8, maxMm: 6.2 },
    leadContactMm: { minMm: 0.4, maxMm: 0.625 },
    leadSides: 2,
    leadForm: "gullwing",
    mounting: "smd"
  }, { ncTerminal: "8" }),
  part("FORGE_WQFN14", "WQFN-14", Array.from({ length: 14 }, (_, index) => String(index + 1)), {
    bodyLengthMm: 3,
    bodyWidthMm: 2.5,
    bodyHeightMm: 0.8,
    pitchMm: 0.5,
    leadCount: 14,
    leadWidthMm: { minMm: 0.2, maxMm: 0.3 },
    leadContactMm: { minMm: 0.3, maxMm: 0.5 },
    thermalPadLengthMm: 1.5,
    thermalPadWidthMm: 1.2,
    landPadLengthMm: 0.6,
    landPadWidthMm: 0.25,
    landSpanMm: 2.3,
    landSpanCrossMm: 2.8,
    leadSides: 4,
    leadForm: "nolead",
    mounting: "smd",
    leadsPerSide: "5,2,5,2"
  }, { exposedPad: true }),
  part("FORGE_DIP8", "DIP-8", ["1", "2", "3", "4", "5", "6", "7", "8"], {
    bodyLengthMm: 9.27,
    bodyWidthMm: 6.35,
    bodyHeightMm: 4.2,
    pitchMm: 2.54,
    leadCount: 8,
    landSpanMm: 7.62,
    leadSides: 2,
    leadForm: "straight",
    mounting: "through-hole",
    leadDiameterMm: 0.5
  }),
  part("FORGE_BGA9", "DSBGA-9", ["A1", "A2", "A3", "B1", "B2", "B3", "C1", "C2", "C3"], {
    bodyLengthMm: 3,
    bodyWidthMm: 3,
    bodyHeightMm: 0.6,
    pitchMm: 0.5,
    leadCount: 9,
    landPadLengthMm: 0.28,
    landPadWidthMm: 0.28,
    mounting: "smd"
  })
];
