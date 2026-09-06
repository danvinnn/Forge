/**
 * `/api/model` - a SPICE model and its conformance receipt, from a datasheet.
 *
 * ## Why a route of its own rather than a fourth export format
 *
 * `SPICE.md` section 12 answered this the other way, before the pipeline
 * existed, on the reasoning that a format on `/api/export` inherits
 * `resolveForExport`'s traceability gate for free.
 *
 * Building it showed that reasoning was wrong in a specific way.
 * `createExportZip` is footprint, courtyard, paste and 3D-body generation from a
 * `ResolvedPart`; a SPICE model is built from the DOCUMENT, needs none of that,
 * and would enter as a branch that skips the entire body of the function. And
 * the gate it was supposed to inherit does not apply: `resolveForExport` checks
 * that package DIMENSIONS are citable, while a model's traceability is that
 * every parameter carries the page it was read from, which `model.ts` enforces
 * at the point of reading.
 *
 * A separate route is the smaller thing. The decision is recorded here rather
 * than left as a silent divergence from the document.
 */

import { NextResponse } from "next/server";
import JSZip from "jszip";
import { buildModel, type ModelCorrection } from "../../../lib/spice/build";
import { spiceName } from "../../../lib/spice/emit";
import { readWithModel } from "../../../lib/spice/read-model";
import { tablePagesOf } from "../../../lib/spice/read-model";
import { ALL_PARAMETERS, DEVICE_CLASSES, canonicalValue, supportedCorners, type DeviceClassId, type ModelParameter } from "../../../lib/spice/model";
import { pdfPageCount, renderPages } from "../../../lib/pagerender";
import { verify, type Check } from "../../../lib/spice/verify";
import { isOpenCollector, verifyComparator } from "../../../lib/spice/comparator";
import { verifyReference } from "../../../lib/spice/reference";
import { verifyLdo } from "../../../lib/spice/ldo";
import { assessModelAssurance } from "../../../lib/spice/assurance";
import {
  compatibleVendorCandidates,
  inspectVendorModel,
  vendorResource,
  wrapVendorCandidate,
  wrapVendorModel,
  type VendorCandidate
} from "../../../lib/spice/vendor";
import { GENERATED_OPPORTUNITY, VENDOR_OPPORTUNITY, unresolvedOpportunity } from "../../../lib/spice/opportunity";
import { getDeploymentMode, clientKey, activeUploadLimiter, MAX_PDF_BYTES } from "../../../lib/retrieval";

/** A part number is a short printed token. Bounded like every other input here. */
const MAX_PART_NUMBER_CHARS = 64;
const MAX_CAD_BUNDLE_BYTES = 20_000_000;
const MAX_VENDOR_MODEL_BYTES = 5_000_000;

/**
 * How long this route may run, declared rather than inherited.
 *
 * `/api/parse` declares 150 and races the model pass against it. This route
 * declared nothing at all, so it inherited the platform default and a slow
 * second reading killed the whole request: the user got a generic failure
 * instead of the model, which the deterministic reading alone can always
 * produce. That is `forge-route-budget-gap` on a route written afterwards.
 */
export const maxDuration = 150;

/**
 * How much of that the SECOND READING may take.
 *
 * Deliberately less than the whole, because everything after it - the fit loop,
 * up to three ngspice runs per corner, the zip - still has to happen. Measured
 * 2026-09-04, a second reading of a specification table takes tens of seconds
 * and occasionally minutes on a busy endpoint.
 */
const SECOND_READING_BUDGET_MS = 90_000;

/**
 * The second reading, or nothing, within the budget.
 *
 * DEGRADES, never fails. A reading that does not arrive in time leaves the
 * parameters flagged as single-source, which is exactly what `confirm.ts`
 * already reports when no second reading was taken, and the user gets a model
 * with an honest receipt instead of an error page. Silence is not agreement,
 * and a timeout is silence.
 */
async function secondReadingWithin(pdfBytes: ArrayBuffer, pages: number[]) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      readWithModel(pdfBytes, pages).then((reading) => reading.values),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), SECOND_READING_BUDGET_MS);
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * THE ONLY VALUES A USER MAY SUPPLY, and the list is short on purpose.
 *
 * A number typed into a box is not a reading, so each entry here has to clear a
 * bar: the document genuinely does not state it, the person holding the part
 * knows it without looking anything up, and getting it wrong is obvious rather
 * than silent.
 *
 * `outputVoltage` on a regulator clears all three. Measured across fourteen
 * regulator datasheets outside the hold-out, SEVEN state no nominal output
 * anywhere - TPS7A02, ADP151, TLV70012, LP5907, MIC5205 and TPS736 among them -
 * because on a fixed LDO the nominal is an ordering option and the number lives
 * in the part-number suffix. Decoding that suffix is not available to this
 * product: `-1.8` means 1.8 V on one vendor and `3302` means 3.3 V on another.
 *
 * Nothing else is on this list. An open-loop gain or a propagation delay is a
 * characterisation the vendor measured, and a box inviting somebody to type one
 * would turn this product into the thing it exists to replace.
 */
const ASKABLE = [
  {
    field: "outputVoltage",
    label: "Nominal output voltage",
    unit: "V",
    why: "This datasheet states an output ACCURACY but no nominal, because the voltage is an ordering option. It is on the part's label and in its part number; this product will not decode a part number into a specification."
  }
] as const;

/** An upper bound, so a typo cannot become a model. No LDO this product models
 * regulates above this, and a value past it is a slipped decimal point. */
const MAX_SUPPLIED_OUTPUT_V = 100;

/**
 * The values the caller supplied, kept to the list above and bounded.
 *
 * Anything not on `ASKABLE` is dropped in silence rather than rejected: the
 * field simply does not exist as far as the model builder is concerned, which
 * is the same posture `parseSettings` takes on the other route.
 */
function suppliedFrom(formData: FormData): Partial<Record<"outputVoltage", number>> {
  const out: Partial<Record<"outputVoltage", number>> = {};
  for (const ask of ASKABLE) {
    const raw = formData.get(`supplied.${ask.field}`);
    if (typeof raw !== "string") continue;
    const value = Number.parseFloat(raw.trim());
    if (!Number.isFinite(value) || value <= 0 || value > MAX_SUPPLIED_OUTPUT_V) continue;
    out[ask.field] = value;
  }
  return out;
}

class InvalidCorrectionError extends Error {}

/** Reviewed parameter edits sent by the correction screen. */
function correctionsFrom(formData: FormData): ModelCorrection[] {
  const raw = formData.get("corrections");
  if (raw === null) return [];
  if (typeof raw !== "string" || raw.length > 12_000) throw new InvalidCorrectionError("The correction list is invalid.");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new InvalidCorrectionError("The correction list is not valid JSON.");
  }
  if (!Array.isArray(parsed) || parsed.length > 20) throw new InvalidCorrectionError("At most 20 parameters can be corrected at once.");
  return parsed.map((entry): ModelCorrection => {
    if (!entry || typeof entry !== "object") throw new InvalidCorrectionError("A correction is malformed.");
    const value = entry as Record<string, unknown>;
    const parameter = value.parameter;
    const unit = value.unit;
    const page = value.page;
    const printed = value.printed as Record<string, unknown> | null;
    if (typeof parameter !== "string" || !ALL_PARAMETERS.includes(parameter as ModelParameter)) {
      throw new InvalidCorrectionError("A correction names an unsupported parameter.");
    }
    if (typeof unit !== "string" || unit.trim().length === 0 || unit.length > 24) {
      throw new InvalidCorrectionError(`${parameter} needs the unit printed on the page.`);
    }
    if (!Number.isInteger(page) || (page as number) < 1 || (page as number) > 10_000) {
      throw new InvalidCorrectionError(`${parameter} needs a valid source page.`);
    }
    if (!printed || typeof printed !== "object") throw new InvalidCorrectionError(`${parameter} has no corrected value.`);
    const corners = { min: null, typ: null, max: null } as ModelCorrection["printed"];
    for (const corner of ["min", "typ", "max"] as const) {
      const candidate = printed[corner];
      if (candidate === null || candidate === undefined || candidate === "") continue;
      if (typeof candidate !== "number" || !Number.isFinite(candidate)) {
        throw new InvalidCorrectionError(`${parameter} ${corner} is not a number.`);
      }
      if (canonicalValue(parameter as ModelParameter, candidate, unit) === null) {
        throw new InvalidCorrectionError(`${unit} is not a valid unit for ${parameter}.`);
      }
      corners[corner] = candidate;
    }
    if (Object.values(corners).every((candidate) => candidate === null)) {
      throw new InvalidCorrectionError(`${parameter} has no corrected value.`);
    }
    return {
      parameter: parameter as ModelParameter,
      unit: unit.trim(),
      page: page as number,
      printed: corners,
      ...(value.scope === null || typeof value.scope === "string" ? { scope: value.scope as string | null } : {}),
      ...(value.group === null || typeof value.group === "string" ? { group: value.group as string | null } : {})
    };
  });
}

/** Parameters on the built block that nobody read. See `ASKABLE`. */
function supplied(built: { block: { values: Record<string, { page: number | null }> } | null }): string[] {
  if (!built.block) return [];
  return Object.entries(built.block.values)
    .filter(([, value]) => value.page === null)
    .map(([key]) => key);
}

function fail(error: string, code: string, status: number) {
  return NextResponse.json({ error, code, mode: getDeploymentMode() }, { status });
}

/**
 * A vendor-authored model does not need Forge to understand its behaviour in
 * order to be usable. Preserve its declared terminal order, make a neutral
 * symbol, and keep the original file outside the archive. This is explicitly a
 * structural handoff, never presented as datasheet conformance.
 */
async function vendorOnlyResponse(options: {
  partNumber: string;
  manufacturer: string | null;
  vendorModel: File;
  candidate: VendorCandidate;
  instanceValue?: string;
  cadBundle: File | null;
  json: boolean;
}) {
  const { partNumber, manufacturer, vendorModel, candidate, instanceValue, cadBundle, json } = options;
  const name = spiceName(partNumber);
  const adapter = wrapVendorCandidate(candidate, vendorModel.name, partNumber, instanceValue);
  const receipt = [
    `${partNumber} vendor-model structural report`,
    "",
    "Forge did not generate or alter the vendor model.",
    `Selected ${candidate.kind === "subckt" ? ".SUBCKT" : `.MODEL ${candidate.modelType}`} ${candidate.name}.`,
    `Terminal order: ${candidate.terminals.map((terminal, index) => `${index + 1}=${terminal}`).join(", ")}.`,
    "",
    `Keep your original file named ${adapter.includeName} beside this adapter.`,
    "It is referenced with .include and is NOT redistributed in this archive.",
    "",
    "CONFIRMED",
    "  The selected declaration is bounded and parseable.",
    "  The adapter and symbol use exactly the terminal order printed by that declaration.",
    "",
    "NOT CONFIRMED",
    "  Forge could not build an independent behavioural model from this datasheet.",
    "  No numerical behaviour, pin meaning, vendor provenance, or datasheet conformance was inferred.",
    "  Compare the displayed terminal order with the vendor documentation before use.",
    ""
  ].join("\n");

  const zip = new JSZip();
  const spiceFolder = cadBundle ? "spice/" : "";
  zip.file(`${spiceFolder}${name}.lib`, adapter.text);
  zip.file(`${spiceFolder}${name}.asy`, adapter.asy);
  zip.file(`${spiceFolder}${name}-vendor-structural.txt`, receipt);
  if (cadBundle) {
    let cadZip: JSZip;
    try {
      cadZip = await JSZip.loadAsync(await cadBundle.arrayBuffer());
    } catch {
      return fail("The CAD bundle could not be opened as a ZIP archive.", "UPLOAD_INVALID", 400);
    }
    for (const entry of Object.values(cadZip.files)) {
      if (!entry.dir) zip.file(`cad/${entry.name}`, await entry.async("uint8array"));
    }
    zip.file(
      "README.txt",
      `Forge combined bundle\n\nCAD libraries are under cad/. The SPICE adapter is under spice/. Keep ${adapter.includeName} beside the adapter; the vendor file is not redistributed.\n`
    );
  }
  const bytes = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
  const fileName = cadBundle ? `${name}-forge.zip` : `${name}-spice.zip`;
  if (!json) {
    return new NextResponse(new Uint8Array(bytes), {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${fileName}"`,
        "Cache-Control": "no-store"
      }
    });
  }
  return NextResponse.json({
    fileName,
    zipBase64: Buffer.from(bytes).toString("base64"),
    partNumber,
    deviceClass: null,
    deviceClassLabel: "vendor-authored model adapter",
    suppliedByUser: [],
    block: { scope: null, group: null },
    blockChosenBy: "only-one",
    alternatives: [],
    parameters: [],
    reviewPages: [],
    asy: adapter.asy,
    vendorResource: vendorResource(partNumber, manufacturer),
    vendorVerification: {
      status: "checked",
      error: null,
      checks: [],
      simulatorMissing: false,
      structuralOnly: true,
      includeName: adapter.includeName,
      declaration: `${candidate.kind === "subckt" ? ".SUBCKT" : `.MODEL ${candidate.modelType}`} ${candidate.name}`,
      terminals: candidate.terminals
    },
    checks: [],
    toCheck: [
      {
        id: "vendor-terminal-order",
        label: "Vendor terminal order",
        state: "flagged",
        detail: candidate.terminals.map((terminal, index) => `${index + 1}=${terminal}`).join(", "),
        consequence: "A vendor declaration states order but not necessarily the physical package-pin mapping. Compare it with the vendor documentation.",
        page: null
      },
      {
        id: "vendor-behaviour",
        label: "Vendor-model behaviour",
        state: "flagged",
        detail: "Structurally accepted; no independent datasheet targets were available for comparison.",
        consequence: "The model is usable as supplied, but Forge is not claiming it reproduces this datasheet.",
        page: null
      }
    ],
    overBudget: false,
    modelOpportunity: VENDOR_OPPORTUNITY,
    mode: getDeploymentMode()
  });
}

export async function POST(request: Request) {
  const limit = await activeUploadLimiter().check(clientKey(request));
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many uploads. Try again shortly.", code: "RATE_LIMITED", mode: getDeploymentMode() },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } }
    );
  }

  // Reject on the declared size BEFORE buffering the body, exactly as
  // `/api/parse` does: `formData()` reads the whole request into memory, so a
  // huge POST would exhaust the process before any validation ran.
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_PDF_BYTES + MAX_CAD_BUNDLE_BYTES + MAX_VENDOR_MODEL_BYTES) {
    return fail("The uploaded files exceed the 75MB combined limit.", "UPLOAD_INVALID", 413);
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return fail("Could not read the uploaded file.", "UPLOAD_INVALID", 400);
  }

  const file = formData.get("file");
  if (!(file instanceof File)) return fail("Missing PDF upload.", "UPLOAD_INVALID", 400);
  if (file.size > MAX_PDF_BYTES) return fail("File is larger than the 50MB limit.", "UPLOAD_INVALID", 413);

  const cadBundle = formData.get("cadBundle");
  if (cadBundle !== null && !(cadBundle instanceof File)) return fail("The CAD bundle is invalid.", "UPLOAD_INVALID", 400);
  if (cadBundle instanceof File && cadBundle.size > MAX_CAD_BUNDLE_BYTES) {
    return fail("The CAD bundle is larger than the 20MB limit.", "UPLOAD_INVALID", 413);
  }
  const vendorModel = formData.get("vendorModel");
  if (vendorModel !== null && !(vendorModel instanceof File)) return fail("The vendor model is invalid.", "UPLOAD_INVALID", 400);
  if (vendorModel instanceof File && vendorModel.size > MAX_VENDOR_MODEL_BYTES) {
    return fail("The vendor model is larger than the 5MB limit.", "UPLOAD_INVALID", 413);
  }

  const partField = formData.get("partNumber");
  const partNumber = typeof partField === "string" ? partField.trim().slice(0, MAX_PART_NUMBER_CHARS) : "";
  if (!partNumber) return fail("Missing part number.", "INPUT_REQUIRED", 400);
  const manufacturerField = formData.get("manufacturer");
  const manufacturer = typeof manufacturerField === "string" ? manufacturerField.trim().slice(0, 100) : null;
  const vendorCandidateField = formData.get("vendorCandidate");
  const vendorCandidateId = typeof vendorCandidateField === "string" ? vendorCandidateField : undefined;
  const vendorInstanceValueField = formData.get("vendorInstanceValue");
  const vendorInstanceValue = typeof vendorInstanceValueField === "string" ? vendorInstanceValueField.trim().slice(0, 32) : undefined;

  // Which specification block the user is holding, where they have said. A
  // datasheet printing one block per supply, or several grades side by side,
  // states what they are and cannot state which one is on the bench. Choosing
  // silently would be an assumption; this takes the answer and otherwise
  // reports the alternatives.
  const scopeField = formData.get("scope");
  const groupField = formData.get("group");
  const blockChoiceField = formData.get("blockChoice");
  let blockIndex: number | undefined;
  if (blockChoiceField !== null) {
    if (typeof blockChoiceField !== "string" || !/^\d{1,3}$/.test(blockChoiceField)) {
      return fail("The specification block choice is invalid.", "INPUT_INVALID", 400);
    }
    blockIndex = Number(blockChoiceField);
  }
  const reviewedClassField = formData.get("reviewDeviceClass");
  const reviewedClass = typeof reviewedClassField === "string" && DEVICE_CLASSES.some((candidate) => candidate.id === reviewedClassField)
    ? reviewedClassField as DeviceClassId
    : undefined;
  if (reviewedClassField !== null && reviewedClass === undefined) {
    return fail("The reviewed device class is invalid.", "INPUT_INVALID", 400);
  }
  const choose =
    typeof scopeField === "string" || typeof groupField === "string" || blockIndex !== undefined || reviewedClass !== undefined
      ? {
          scope: typeof scopeField === "string" ? scopeField.slice(0, 200) : undefined,
          group: typeof groupField === "string" ? groupField.slice(0, 200) : undefined,
          blockIndex,
          deviceClass: reviewedClass
        }
      : undefined;

  // The second reading of the same tables, so RULES.md 7 has two independent
  // means. It never throws: where it cannot run, the parameters come back
  // flagged as single-source and the receipt says so.
  const pdfBytes = await file.arrayBuffer();
  let corrections: ModelCorrection[];
  try {
    corrections = correctionsFrom(formData);
  } catch (error) {
    return fail(error instanceof Error ? error.message : "The correction list is invalid.", "INPUT_INVALID", 400);
  }
  if (corrections.length > 0) {
    const pageCount = await pdfPageCount(pdfBytes);
    if (pageCount === null || corrections.some((correction) => correction.page > pageCount)) {
      return fail("A correction cites a page that is not in this PDF.", "INPUT_INVALID", 400);
    }
  }
  const built = await buildModel(
    pdfBytes,
    partNumber,
    choose,
    (pages) => secondReadingWithin(pdfBytes, pages),
    suppliedFrom(formData),
    corrections
  );

  if (!built.subckt || !built.block) {
    if (vendorModel instanceof File) {
      let candidates: VendorCandidate[];
      try {
        candidates = inspectVendorModel(await vendorModel.text());
      } catch (error) {
        return NextResponse.json(
          {
            error: error instanceof Error ? error.message : "The vendor model could not be inspected safely.",
            code: "VENDOR_MODEL_REFUSED",
            mode: getDeploymentMode(),
            modelOpportunity: { disposition: "vendor-file-unusable", resolved: false }
          },
          { status: 422 }
        );
      }
      if (candidates.length === 0) {
        return NextResponse.json(
          {
            error: "No standalone .SUBCKT or supported primitive .MODEL declaration was found in this vendor file.",
            code: "VENDOR_MODEL_REFUSED",
            mode: getDeploymentMode(),
            modelOpportunity: { disposition: "vendor-file-unusable", resolved: false }
          },
          { status: 422 }
        );
      }
      const selected = vendorCandidateId
        ? candidates.find((candidate) => candidate.id === vendorCandidateId)
        : candidates.length === 1 ? candidates[0] : undefined;
      if (!selected) {
        return NextResponse.json(
          {
            error: "This vendor file contains more than one usable declaration. Choose the part-level model; Forge will not guess among helper subcircuits.",
            code: "VENDOR_SELECTION_REQUIRED",
            mode: getDeploymentMode(),
            vendorCandidates: candidates,
            vendorResource: vendorResource(partNumber, manufacturer),
            modelOpportunity: { disposition: "user-selection-required", resolved: false }
          },
          { status: 422 }
        );
      }
      if (selected.instanceParameter && !vendorInstanceValue) {
        return NextResponse.json(
          {
            error: `This .MODEL card needs its instance ${selected.instanceParameter}. Supply the value printed for this part; Forge will not invent it.`,
            code: "VENDOR_CONFIGURATION_REQUIRED",
            mode: getDeploymentMode(),
            vendorCandidates: candidates.length > 1 ? candidates : [],
            vendorConfiguration: { parameter: selected.instanceParameter },
            vendorUploadAccepted: true,
            vendorResource: vendorResource(partNumber, manufacturer),
            modelOpportunity: { disposition: "configuration-required", resolved: false }
          },
          { status: 422 }
        );
      }
      try {
        return await vendorOnlyResponse({
          partNumber,
          manufacturer,
          vendorModel,
          candidate: selected,
          instanceValue: vendorInstanceValue,
          cadBundle: cadBundle instanceof File ? cadBundle : null,
          json: formData.get("response") === "json"
        });
      } catch (error) {
        return fail(error instanceof Error ? error.message : "The vendor-model configuration is invalid.", "INPUT_INVALID", 400);
      }
    }
    const reasonParts = (built.refusalBecause ?? "").split(/[:+]/);
    const reviewable = reasonParts
      .slice(1)
      .filter((parameter): parameter is ModelParameter => ALL_PARAMETERS.includes(parameter as ModelParameter))
      // Output voltage has the safer ordering-option flow below. Everything in
      // this list is a measured datasheet value and therefore requires a page.
      .filter((parameter) => parameter !== "outputVoltage");
    const tablePages = tablePagesOf(built.rows);
    const correctionOptions = built.refusalBecause === "no-class-matched" && tablePages.length > 0
      ? DEVICE_CLASSES.map((candidate) => ({
          deviceClass: candidate.id,
          label: candidate.label,
          required: candidate.required,
          oneOf: candidate.alsoOneOf ?? []
        }))
      : [];
    const reviewPages = reviewable.length > 0 || correctionOptions.length > 0
      ? await renderPages(pdfBytes, tablePagesOf(built.rows), { dpi: 150, maxPages: 4, budgetMs: 8_000 })
      : [];
    const firstBlock = built.blocks[0] ?? null;
    // The refusal names what the DOCUMENT does not state, never a generic
    // failure. `INCOMPLETE_EXTRACTION` is the existing code for exactly this.
    return NextResponse.json(
      {
        error: built.refusal ?? "This datasheet does not state enough to build a model.",
        code: "INCOMPLETE_EXTRACTION",
        mode: getDeploymentMode(),
        // Everything read is still returned. A refusal is not a reason to throw
        // away what the reader found, and a user can see how close it came.
        parametersRead: built.rows.filter((r) => r.key).length,
        blocks: built.blocks.map((b) => ({ scope: b.scope, group: b.group, missing: b.missing })),
        // A measured value is never accepted as an uncited free-form answer.
        // When the deterministic reader missed one, show the specification
        // pages and accept the printed value only as a reviewed correction.
        correctionNeeds: reviewable.map((parameter) => ({ parameter })),
        correctionOptions,
        reviewPages,
        correctionBlock: firstBlock ? { scope: firstBlock.scope, group: firstBlock.group } : null,
        // A refusal to INVENT behaviour is not a dead end. Any standalone
        // vendor subcircuit can still be adapted after its declared terminal
        // order is shown to the user; this path never depends on part number.
        vendorResource: vendorResource(partNumber, manufacturer),
        vendorUploadAccepted: true,
        modelOpportunity: unresolvedOpportunity({
          correctionAvailable: reviewable.length > 0 || correctionOptions.length > 0,
          configurationAvailable: ASKABLE.some((ask) => (built.refusalBecause ?? "").split(/[:+]/).includes(ask.field))
        }),
        // WHAT THE USER COULD ANSWER, when the refusal is one they can lift.
        //
        // Empty for every refusal that is not on the short list below, so a
        // screen cannot turn "this datasheet states no gain-bandwidth" into a
        // box inviting somebody to type one.
        //
        // SPLIT rather than matched as a substring, so the marked form of the
        // same slug does NOT offer the question. `ldo:outputVoltage` means the
        // document is silent and an answer lifts the refusal;
        // `ldo:outputVoltage(read-not-every-corner)` means the document states
        // one this model cannot use, an answer would be ignored, and asking
        // would be a question whose answer goes nowhere.
        asks: ASKABLE.filter((ask) => (built.refusalBecause ?? "").split(/[:+]/).includes(ask.field))
      },
      { status: 422 }
    );
  }

  const name = spiceName(partNumber);
  const report = built.report;
  const assurance = assessModelAssurance({
    confirmations: built.confirmations,
    checks: report?.checks ?? [],
    selectionRequired: built.blockChosenBy === "first-of-several",
    findings:
      built.deviceClass?.id === "comparator" && !isOpenCollector(built.block)
        ? [{
            id: "comparator-output-stage",
            label: "Comparator output stage",
            state: "review",
            detail:
              "No saturation-voltage or sink-current evidence established an open-collector output. " +
              "The generated model uses a disclosed push-pull output; confirm the datasheet identifies this part as push-pull."
          }]
        : []
  });
  if (assurance.outcome === "needs-input") {
    const choices = [built.block, ...built.alternatives].map((block, index) => ({
      index,
      scope: block.scope,
      group: block.group
    }));
    return NextResponse.json(
      {
        error: "This datasheet has more than one usable specification block and none of their captions uniquely names this part. Choose the conditions or grade you are holding; Forge will not pick one silently.",
        code: "MODEL_SELECTION_REQUIRED",
        mode: getDeploymentMode(),
        blockChoices: choices,
        vendorUploadAccepted: true,
        vendorResource: vendorResource(partNumber, manufacturer),
        modelOpportunity: { disposition: "user-selection-required", resolved: false }
      },
      { status: 422 }
    );
  }
  if (assurance.outcome === "refused") {
    return NextResponse.json(
      {
        error: `The generated model contradicted the datasheet and was not released: ${assurance.contradictions.map((item) => item.label).join(", ")}.`,
        code: "MODEL_CONFORMANCE_FAILED",
        mode: getDeploymentMode(),
        toCheck: assurance.review,
        contradictions: assurance.contradictions,
        vendorUploadAccepted: true,
        vendorResource: vendorResource(partNumber, manufacturer),
        modelOpportunity: { disposition: "vendor-model-required", resolved: false }
      },
      { status: 422 }
    );
  }
  let vendorVerification: {
    status: "not-supplied" | "checked" | "refused";
    error: string | null;
    checks: Check[];
    simulatorMissing: boolean;
  } = { status: "not-supplied", error: null, checks: [], simulatorMissing: false };
  let vendorCandidates: VendorCandidate[] = [];
  if (vendorModel instanceof File) {
    try {
      const vendorText = await vendorModel.text();
      const compatible = compatibleVendorCandidates(vendorText, built.deviceClass!.id);
      if (compatible.length > 1 && !vendorCandidateId) {
        vendorCandidates = compatible;
        throw new Error("More than one subcircuit has the required terminal contract. Choose the part-level declaration; Forge will not guess among helpers.");
      }
      const wrapped = wrapVendorModel(vendorText, built.deviceClass!.id, "FORGE_VENDOR", vendorCandidateId);
      const modelCorners = supportedCorners(built.block, built.deviceClass!);
      const typical = modelCorners.includes("typ") ? ["typ" as const] : [modelCorners[0]].filter(Boolean) as Array<"typ" | "min" | "max">;
      const checked = built.deviceClass!.id === "opamp"
        ? await verify(wrapped.text, built.block, "FORGE_VENDOR", typical)
        : built.deviceClass!.id === "comparator"
          ? await verifyComparator(wrapped.text, built.block, "FORGE_VENDOR", typical)
          : built.deviceClass!.id === "reference"
            ? await verifyReference(wrapped.text, built.block, "FORGE_VENDOR", typical)
            : await verifyLdo(wrapped.text, built.block, "FORGE_VENDOR", typical);
      vendorVerification = { status: "checked", error: null, checks: checked.checks, simulatorMissing: checked.simulatorMissing };
    } catch (error) {
      vendorVerification = {
        status: "refused",
        error: error instanceof Error ? error.message : "The vendor model could not be verified.",
        checks: [],
        simulatorMissing: false
      };
    }
  }
  const deviceLabel = built.deviceClass?.label ?? "model";
  const deviceArticle = /^[aeiou]/i.test(deviceLabel) ? "an" : "a";
  const receipt = [
    `${partNumber} model conformance report`,
    "",
    // WHICH KIND OF PART THIS WAS BUILT AS, first and in plain words.
    //
    // A class chosen wrongly produces a model that simulates cleanly and
    // describes a different kind of device, and no conformance check below can
    // catch that: they verify against the numbers the class chose. The only
    // defence is telling the person holding the datasheet, on the first line.
    `Built as ${deviceArticle} ${deviceLabel}, decided from what this datasheet states`,
    reviewedClass
      ? "and from the device kind you selected while reading it, never from the part number."
      : "and not from the part number. If that is not what this part is, stop here.",
    "",
    `Specification block: ${built.block.scope ?? "unlabelled"}${built.block.group ? `, grade ${built.block.group}` : ""}`,
    `Block chosen by: ${built.blockChosenBy}`,
    `Release assurance: ${assurance.outcome.toUpperCase()} (${assurance.review.length} item${assurance.review.length === 1 ? "" : "s"} to review, ${assurance.contradictions.length} contradictions)`,
    "",
    "PARAMETERS READ, WITH THEIR SOURCE PAGE",
    "",
    ...Object.entries(built.block.values).map(([key, value]) => {
      const printed = (["min", "typ", "max"] as const)
        .filter((corner) => value.printed[corner] !== null)
        .map((corner) => `${corner} ${value.printed[corner]}`)
        .join(", ");
      const source = value.page === null
        ? "supplied by you, not stated by this datasheet"
        : value.correctedByUser
          ? `corrected by you from page ${value.page}`
          : `page ${value.page}`;
      return `  ${key.padEnd(22)}${printed} ${value.unit}  (${source})`;
    }),
    "",
    // A CHECK AGAINST A NUMBER THE USER TYPED IS NOT A CHECK, and the receipt
    // has to say so before the table that looks like one. Every row here
    // compares the model against the value it was built from; where that value
    // was supplied rather than read, the row confirms the generator did what it
    // was told and confirms nothing about the part.
    ...supplied(built).length > 0
      ? [
          `SUPPLIED, NOT READ: ${supplied(built).join(", ")}.`,
          "This datasheet does not state it, so it was asked for. Any row below for",
          "that parameter checks this generator against your own number, not against",
          "the datasheet, and is not evidence about the part.",
          ""
        ]
      : [],
    "Every row below compares the emitted model against the datasheet it was",
    "built from, simulated under the conditions the datasheet states.",
    "",
    "  pass          reproduced the stated value",
    "  fail          reproduced it and disagreed",
    "  unverifiable  the datasheet does not state enough of the test circuit",
    "",
    "verdict        parameter          corner  datasheet      measured       error",
    "-".repeat(76),
    ...(report?.checks ?? []).map((c) => {
      const measured = c.measured === null ? "-" : c.measured.toPrecision(5);
      const error = c.errorPct === null ? "" : `${c.errorPct.toFixed(2)}%`;
      return `${c.verdict.padEnd(15)}${c.parameter.padEnd(19)}${c.corner.padEnd(8)}${c.expected.toPrecision(5).padEnd(15)}${measured.padEnd(15)}${error}`;
    }),
    "",
    ...(built.alternatives.length > 0
      ? [
          "This datasheet prints more than one specification block. This model was",
          `built from: ${built.block.scope ?? "the only block with no stated scope"}${built.block.group ? `, grade ${built.block.group}` : ""}.`,
          "Others available, re-request with `scope` or `group` to choose:",
          ...built.alternatives.map((b) => `  scope=${b.scope ?? "-"}  group=${b.group ?? "-"}`),
          ""
        ]
      : []),
    "WHAT WAS CONFIRMED, AND WHAT WAS NOT",
    "",
    "A value ships silently only when two independent readings of the document",
    "agree on it. Everything else is listed here for you to check.",
    "",
    ...(built.confirmations?.items ?? []).map((c) => `  ${c.state.toUpperCase().padEnd(10)}${c.label}\n    ${c.detail}${c.consequence ? `\n    Why it matters: ${c.consequence}` : ""}`),
    "",
    ...(Object.values(built.block.values).some((v) => v.ambiguousMicro)
      ? [
          "UNIT AMBIGUITY: at least one unit was stored by the PDF with a milli",
          "prefix where the page may draw a micro sign. Check the flagged rows",
          "against the printed page before relying on them.",
          ""
        ]
      : [])
  ].join("\n");

  const zip = new JSZip();
  const spiceFolder = cadBundle instanceof File ? "spice/" : "";
  zip.file(`${spiceFolder}${name}.lib`, built.subckt);
  zip.file(`${spiceFolder}${name}.asy`, built.asy!);
  zip.file(`${spiceFolder}${name}-conformance.txt`, receipt);
  if (vendorModel instanceof File) {
    zip.file(
      `${spiceFolder}${name}-vendor-conformance.txt`,
      [
        `${partNumber} vendor-model conformance report`,
        "",
        "The vendor file was supplied by you and is NOT redistributed in this archive.",
        vendorVerification.status === "refused" ? `REFUSED: ${vendorVerification.error}` : "",
        vendorVerification.simulatorMissing ? "UNVERIFIABLE: ngspice is not available on this host." : "",
        ...vendorVerification.checks.map((check) => `${check.verdict.padEnd(14)} ${check.parameter} ${check.corner} expected=${check.expected} measured=${check.measured ?? "-"}`)
      ].filter(Boolean).join("\n")
    );
  }
  if (cadBundle instanceof File) {
    let cadZip: JSZip;
    try {
      cadZip = await JSZip.loadAsync(await cadBundle.arrayBuffer());
    } catch {
      return fail("The CAD bundle could not be opened as a ZIP archive.", "UPLOAD_INVALID", 400);
    }
    for (const entry of Object.values(cadZip.files)) {
      if (entry.dir) continue;
      // JSZip sanitises relative components while loading. Keep the original
      // hierarchy beneath one explicit folder so CAD and SPICE names cannot
      // collide and the combined archive can be moved as a unit.
      zip.file(`cad/${entry.name}`, await entry.async("uint8array"));
    }
    zip.file(
      "README.txt",
      "Forge combined bundle\n\nCAD libraries are under cad/. LTspice model, symbol and conformance receipt are under spice/.\n"
    );
  }
  const bytes = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
  const bundleFileName = cadBundle instanceof File ? `${name}-forge.zip` : `${name}-spice.zip`;

  // THE SAME BUNDLE, PLUS WHAT IS IN IT, FOR A SCREEN.
  //
  // A browser cannot show a person what it just downloaded, and a screen that
  // hands over a zip and says nothing about it is the CAD half's "silent
  // primary action" all over again: the user learns what was checked only by
  // unzipping a file. So a caller may ask for the bundle as JSON and get the
  // conformance rows and the flags beside it.
  //
  // The BYTES ARE THE SAME BYTES. Assembling a second zip on the client would
  // be a second implementation of the bundle, and the two would drift.
  if (formData.get("response") === "json") {
    const reviewPages = await renderPages(
      pdfBytes,
      [...new Set(Object.values(built.block.values).map((value) => value.page).filter((page): page is number => page !== null))],
      { dpi: 150, maxPages: 4, budgetMs: 8_000 }
    );
    return NextResponse.json({
      fileName: bundleFileName,
      zipBase64: Buffer.from(bytes).toString("base64"),
      partNumber,
      deviceClass: built.deviceClass?.id ?? null,
      deviceClassLabel: built.deviceClass?.label ?? null,
      deviceClassChosenBy: reviewedClass ? "the-caller-reviewed" : "parameter-contract",
      // WHICH OF THESE NUMBERS NOBODY READ. The screen prints them differently,
      // because a value the user typed carries none of the two-source guarantee
      // the rest of the table is built on.
      suppliedByUser: supplied(built),
      block: { scope: built.block.scope, group: built.block.group },
      // HOW that block was chosen, not just which one. A family datasheet
      // carries one block per part - L7805's has sixteen - and "the document
      // captions this table with the part you asked for" and "it came first"
      // are very different claims that the scope alone renders identically.
      blockChosenBy: built.blockChosenBy,
      alternatives: built.alternatives.map((b) => ({ scope: b.scope, group: b.group })),
      parameters: Object.entries(built.block.values).map(([key, value]) => ({
        key,
        printed: value.printed,
        unit: value.unit,
        // Null where nobody read it. The screen must not render `page null`,
        // and it must not render a page number that does not exist either.
        page: value.page,
        correctedByUser: value.correctedByUser ?? false
      })),
      reviewPages,
      asy: built.asy,
      vendorResource: vendorResource(partNumber, manufacturer),
      vendorVerification,
      vendorCandidates,
      modelOpportunity: GENERATED_OPPORTUNITY,
      checks: (report?.checks ?? []).map((c) => ({
        verdict: c.verdict,
        parameter: c.parameter,
        corner: c.corner,
        expected: c.expected,
        measured: c.measured,
        errorPct: c.errorPct
      })),
      // What a person has to check, in the product's own words. Flagged items
      // are the point of the receipt, not a footnote to it.
      toCheck: assurance.findings.map((finding) => {
        const confirmation = built.confirmations?.items.find((item) => item.id === finding.id);
        return {
          id: finding.id,
          label: finding.label,
          state: finding.state === "review" ? "flagged" : finding.state,
          detail: finding.detail,
          consequence: confirmation?.consequence ?? null,
          page: confirmation?.page ?? null
        };
      }),
      overBudget: false,
      mode: getDeploymentMode()
    });
  }

  return new NextResponse(new Uint8Array(bytes), {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${bundleFileName}"`,
      "Cache-Control": "no-store"
    }
  });
}
