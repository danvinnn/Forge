/**
 * `/api/identify` - what this document is, before anyone spends anything.
 *
 * ## Why it exists
 *
 * `/suite` posts every chosen file here the moment it lands, so the screen can
 * say what the part is and offer a package before the user decides what to
 * build. Until 2026-09-04 the route was a `TODO(merge)` and did not exist: every
 * upload on that screen 404'd, the component caught the failure and carried on,
 * and nothing looked broken. `bench:browser --spice` found it on its first run,
 * which is the whole argument for pressing the button rather than typechecking
 * it.
 *
 * ## Free, and it must stay free
 *
 * No model call and no model spend. For an upload it is entirely local. For a
 * typed part number it performs the same public-datasheet retrieval as lookup,
 * verifies that document names the requested part, and then runs the same
 * deterministic text pass `/api/parse` uses before the model leg. The moment
 * identification needs a model it belongs behind the Read button with
 * everything else that costs money.
 *
 * ## THE PART NUMBER IS THE FILE NAME, and this says so
 *
 * `buildPartRecord` derives it from the uploaded name and marks it `user`: it
 * is what the person uploading `lm358.pdf` has told us they think this is, not
 * something read off the page. The document's own name for itself is read by
 * the model pass, behind the Read button.
 *
 * So `partNumberFrom` travels with it. Returning the string alone would let a
 * screen present a file name as an identification, which is RULES.md 2 exactly:
 * an assumption made on the user's behalf and shown as a fact.
 *
 * ## Nothing here is a reading
 *
 * A designator listed here is a package the ordering table NAMES. It is text,
 * with no drawing behind it, and the screen labels it as such. Choosing one
 * aims the read; it does not assert that a footprint can be built from it.
 */

import { NextResponse } from "next/server";
import { extractPartRecord } from "../../../lib/datasheet";
import { looksLikeWrongDocument, namesThePart, PdfExtractionError, PdfUnreadableError } from "../../../lib/pdftext";
import { sha256Hex } from "../../../lib/retrieval/hash";
import {
  getDeploymentMode,
  makeResolver,
  clientKey,
  activeLookupLimiter,
  activeUploadLimiter,
  MAX_PDF_BYTES
} from "../../../lib/retrieval";

/**
 * Declared rather than inherited. This pass is deterministic and fast, but a
 * fifty-megabyte document is still real work, and a route with no declared
 * budget inherits whatever the platform happens to default to.
 */
export const maxDuration = 60;

function fail(error: string, code: string, status: number) {
  return NextResponse.json({ error, code, mode: getDeploymentMode() }, { status });
}

async function identifyBytes(
  fileName: string,
  bytes: ArrayBuffer,
  options: { pdfUrl?: string; requestedPart?: string } = {}
) {
  const { doc, part } = await extractPartRecord(fileName, bytes, options.pdfUrl);
  if (options.requestedPart && (looksLikeWrongDocument(doc) || !namesThePart(doc, options.requestedPart))) {
    return fail(
      `The retrieved document could not be verified as the datasheet for ${options.requestedPart}. Upload the correct PDF directly.`,
      "WRONG_DOCUMENT",
      422
    );
  }
  const partNumber = options.requestedPart ?? part.partNumber.value ?? "";

  return NextResponse.json({
    partNumber,
    partNumberFrom: options.requestedPart
      ? "user-input"
      : part.partNumber.method === "user" ? "file-name" : "document",
    manufacturer: part.manufacturer.value ?? null,
    pageCount: doc.pages.length,
    packages: part.packageVariants.map((variant) => ({
      designator: variant.designator,
      family: variant.family,
      leadCount: variant.leadCount
    })),
    specPages: null,
    outlinePage: null,
    sha256: sha256Hex(bytes),
    fileName,
    sourceUrl: options.pdfUrl ?? null,
    mode: getDeploymentMode()
  });
}

export async function POST(request: Request) {
  const isLookup = (request.headers.get("content-type") ?? "").toLowerCase().includes("application/json");
  const limit = await (isLookup ? activeLookupLimiter() : activeUploadLimiter()).check(clientKey(request));
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many uploads. Try again shortly.", code: "RATE_LIMITED", mode: getDeploymentMode() },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } }
    );
  }

  // Rejected on the declared size BEFORE the body is buffered, exactly as the
  // other two upload routes do: `formData()` reads the whole request into
  // memory, so a huge POST would exhaust the process before any validation ran.
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_PDF_BYTES) {
    return fail("File is larger than the 50MB limit.", "UPLOAD_INVALID", 413);
  }

  if (isLookup) {
    if (getDeploymentMode() === "air-gapped") {
      return fail("Upload the datasheet PDF in air-gapped mode; part-number lookup is disabled.", "INPUT_REQUIRED", 422);
    }
    const payload = await request.json().catch(() => null) as { partNumber?: unknown; manufacturer?: unknown } | null;
    const partNumber = typeof payload?.partNumber === "string" ? payload.partNumber.trim() : "";
    const manufacturer = typeof payload?.manufacturer === "string" ? payload.manufacturer.trim() : "";
    if (!/^[A-Za-z0-9][A-Za-z0-9._+\-/ ]{0,79}$/.test(partNumber) || manufacturer.length > 120) {
      return fail("A valid part number is required.", "INPUT_INVALID", 400);
    }
    try {
      const resolver = await makeResolver(getDeploymentMode());
      const ref = await resolver?.resolve(partNumber, manufacturer ? { manufacturer } : undefined);
      if (!ref) return fail(`No public datasheet was found for ${partNumber}. Upload it directly instead.`, "DATASHEET_NOT_FOUND", 404);
      return await identifyBytes(ref.fileName, ref.bytes, { pdfUrl: ref.pdfUrl, requestedPart: partNumber });
    } catch {
      // Resolver and transport detail can contain internal endpoints or
      // credentials. The action the user can take is stable even when the
      // underlying backend is not.
      return fail("The datasheet lookup failed. Try again or upload the PDF directly.", "LOOKUP_FAILED", 502);
    }
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

  const bytes = await file.arrayBuffer();

  try {
    return await identifyBytes(file.name, bytes);
  } catch (error) {
    // Same two doors `/api/parse` uses, and for the same reason: a file that
    // will not open is bad input, not a server fault, and a person seeing
    // "something went wrong" learns nothing they can act on.
    if (error instanceof PdfExtractionError) {
      return fail(error.message, "PARSE_LIMIT_EXCEEDED", 422);
    }
    if (error instanceof PdfUnreadableError) {
      console.error("upload could not be opened as a PDF", error.underlying);
      return fail(error.message, "UPLOAD_INVALID", 400);
    }
    throw error;
  }
}
