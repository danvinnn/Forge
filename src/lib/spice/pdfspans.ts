/**
 * Positioned text out of a PDF, for the deterministic specification reader.
 *
 * Air-gap safety: `mupdf` is loaded through a dynamic import inside the
 * function, the same discipline `pagerender.ts` follows, so this module is safe
 * to load in an air-gapped deployment and degrades to an empty result rather
 * than throwing when the native binary is absent.
 *
 * This file does no interpretation. Everything that decides what a span MEANS
 * lives in `specs.ts`, so the two can be tested apart: `specs.ts` takes plain
 * data and never opens a file.
 */

import { toRows, readPage, carryFrom, type Row, type Span, type SpecRow } from "./specs";

/** How many pages to scan. Specification tables are always in the front matter. */
const MAX_PAGES = 40;

interface MuPdfLine {
  text?: string;
  bbox?: { x: number; y: number };
}
interface MuPdfBlock {
  lines?: MuPdfLine[];
}

function spansOf(json: { blocks?: MuPdfBlock[] }): Span[] {
  const spans: Span[] = [];
  for (const block of json.blocks ?? []) {
    for (const line of block.lines ?? []) {
      const text = (line.text ?? "").trim();
      if (text && line.bbox) spans.push({ text, x: line.bbox.x, y: line.bbox.y });
    }
  }
  return spans;
}

/**
 * Reads every specification row in a datasheet.
 *
 * Never throws. A document that will not open, a page that will not parse and a
 * missing native binary all produce a shorter list, because a thinner reading is
 * a worse product and not a broken one.
 */
export async function readSpecRows(pdfBytes: ArrayBuffer): Promise<SpecRow[]> {
  let mupdf: typeof import("mupdf");
  try {
    mupdf = await import("mupdf");
  } catch {
    return [];
  }

  let document: ReturnType<typeof mupdf.Document.openDocument>;
  try {
    document = mupdf.Document.openDocument(new Uint8Array(pdfBytes), "application/pdf");
  } catch {
    return [];
  }

  const rows: SpecRow[] = [];
  // Carried so a table continuing onto a new page keeps the header it was
  // introduced with. Not every vendor repeats it.
  let carried: { header: null; scope: string | null } | ReturnType<typeof carryFrom> = { header: null, scope: null };
  const pages = Math.min(document.countPages(), MAX_PAGES);

  for (let index = 0; index < pages; index++) {
    let pageRows: Row[];
    try {
      const structured = JSON.parse(document.loadPage(index).toStructuredText().asJSON()) as { blocks?: MuPdfBlock[] };
      pageRows = toRows(spansOf(structured));
    } catch {
      continue;
    }
    const found = readPage(pageRows, index + 1, carried);
    rows.push(...found);
    const next = carryFrom(pageRows, carried);

    // A TABLE CONTINUES ONTO THE NEXT PAGE, NOT ONTO ALL OF THEM.
    //
    // Carrying a header indefinitely made the Typical Characteristics pages look
    // like continuations, so graph axis labels were read as specification rows:
    // `Frequency (Hz)`, `Positive rail` and even `SOIC` arrived as parameters.
    // They were harmless, because nothing could name them and the model never
    // saw them, but they are noise on the record and the next reader of it would
    // have to work out why they are there.
    //
    // So a carried header survives one page of silence and no more. A page that
    // reads nothing and declares no header of its own has ended the table.
    const declaredItsOwn = next.header !== null && next.header !== carried.header;
    carried = found.length > 0 || declaredItsOwn ? next : { header: null, scope: next.scope };
  }
  return rows;
}
