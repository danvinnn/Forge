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
 * No model call, no network, no spend. It is the deterministic text pass
 * `/api/parse` already runs before the model leg, returned on its own. The
 * moment this needs a model it belongs behind the Read button with everything
 * else that costs money, and `SuiteWorkspace` says so in the same words.
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
import { PdfExtractionError, PdfUnreadableError } from "../../../lib/pdftext";
import { sha256Hex } from "../../../lib/retrieval/hash";
import { getDeploymentMode, clientKey, activeUploadLimiter, MAX_PDF_BYTES } from "../../../lib/retrieval";

/**
 * Declared rather than inherited. This pass is deterministic and fast, but a
 * fifty-megabyte document is still real work, and a route with no declared
 * budget inherits whatever the platform happens to default to.
 */
export const maxDuration = 60;

function fail(error: string, code: string, status: number) {
  return NextResponse.json({ error, code, mode: getDeploymentMode() }, { status });
}

export async function POST(request: Request) {
  const limit = await activeUploadLimiter().check(clientKey(request));
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
    const { doc, part } = await extractPartRecord(file.name, bytes);
    const partNumber = part.partNumber.value ?? "";

    return NextResponse.json({
      partNumber,
      /**
       * Where that string came from. Always the file name today, because the
       * deterministic pass has no reader for it; the field exists so a screen
       * cannot present one as the other, and so the day a document reading
       * exists nothing downstream has to change to notice.
       */
      partNumberFrom: part.partNumber.method === "user" ? "file-name" : "document",
      manufacturer: part.manufacturer.value ?? null,
      pageCount: doc.pages.length,
      // THE RECORD'S OWN LIST, not a second computation of it.
      //
      // `buildPartRecord` already resolves this, and it falls back from the
      // ordering table to the front matter when the ordering table yields
      // nothing. Recomputing it here would be a second answer to one question,
      // and the two would drift the first time either rule changed.
      packages: part.packageVariants.map((variant) => ({
        designator: variant.designator,
        family: variant.family,
        leadCount: variant.leadCount
      })),
      // Both are answered by the read itself, not by this pass. Null rather
      // than a placeholder: an unread field and a field read as nothing must
      // never be the same value, which is what shipped a TO-220 as two rows.
      specPages: null,
      outlinePage: null,
      sha256: sha256Hex(bytes),
      fileName: file.name,
      mode: getDeploymentMode()
    });
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
