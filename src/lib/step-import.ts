import { sanitizeArtifactFileName } from "./retrieval";

export interface ImportedStepModel {
  fileName: string;
  source: string;
}

const MAX_STEP_BYTES = 10_000_000;

/**
 * Accepts an exact vendor-authored STEP Part 21 exchange file without trying to
 * reconstruct or "repair" its geometry. The two exchange-file sentinels are
 * deliberately checked at the boundary: embedding arbitrary text under a STEP
 * filename would make both KiCad and Altium report a model that does not open.
 */
export function importStepModel(input: ImportedStepModel): ImportedStepModel {
  const fileName = sanitizeArtifactFileName(input.fileName);
  if (!/\.(?:step|stp)$/i.test(fileName)) {
    throw new Error("A vendor 3D model must use the .step or .stp extension.");
  }
  const size = Buffer.byteLength(input.source, "utf8");
  if (size === 0 || size > MAX_STEP_BYTES) {
    throw new Error("The vendor STEP model must be non-empty and no larger than 10MB.");
  }
  if (input.source.includes("\0")) {
    throw new Error("The vendor STEP model contains binary data instead of STEP Part 21 text.");
  }
  const normalized = input.source.replace(/^\uFEFF/, "").trim();
  if (!/^ISO-10303-21\s*;/i.test(normalized) || !/END-ISO-10303-21\s*;\s*$/i.test(normalized)) {
    throw new Error("The vendor 3D model is not a complete STEP Part 21 exchange file.");
  }
  // A Part 21 exchange file has two independently terminated sections. Merely
  // finding HEADER, DATA and one ENDSEC accepted a truncated DATA section, so a
  // file could pass Forge and then fail only when the customer opened it. DATA
  // may carry an edition-3 parameter list, hence the deliberately bounded text
  // between DATA and its semicolon.
  const exchange = /^ISO-10303-21\s*;\s*HEADER\s*;[\s\S]*?ENDSEC\s*;\s*DATA(?:\s*\([^;]{0,4096}\))?\s*;[\s\S]*?ENDSEC\s*;\s*END-ISO-10303-21\s*;\s*$/i;
  if (!exchange.test(normalized)) {
    throw new Error("The vendor STEP model is missing or truncates a required Part 21 section.");
  }
  return { fileName, source: input.source };
}
