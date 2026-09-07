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
const MAX_GAIN_EQUATION_PAGES = 1_000;
const GAIN_SCAN_BUDGET_MS = 10_000;

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

export interface GainEquationEvidence {
  resistanceOhm: number;
  printed: number;
  unit: string;
  page: number;
  equation: string;
}

/**
 * Reads K only from an explicit G = 1 + K/RG law (or RG = K/(G-1)).
 * The ohmic unit is mandatory, so a bare coefficient can never acquire a
 * magnitude from code. Distinct constants make the result ambiguous and are
 * refused rather than selecting one mode silently.
 */
export function gainEquationFromText(pages: Array<{ page: number; text: string }>): GainEquationEvidence | null {
  const all = pages.map((page) => page.text).join("\n");
  if (!/\b(?:instrumentation\s+amplifier|in-amp)\b/i.test(all)) return null;

  const numberAndUnit = String.raw`(\d+(?:\.\d+)?)\s*([kKmM]?)\s*(Ω|Ω|ohms?)`;
  const rg = String.raw`R\s*[_{}()\-]?\s*G`;
  const patterns = [
    new RegExp(String.raw`(?:\bG\b|\bGAIN\b)\s*=\s*1\s*\+\s*\(?\s*${numberAndUnit}\s*\)?\s*\/\s*${rg}`, "gi"),
    new RegExp(String.raw`${rg}\s*=\s*\(?\s*${numberAndUnit}\s*\)?\s*\/\s*\(?\s*(?:\bG\b|\bGAIN\b)\s*-\s*1\s*\)?`, "gi")
  ];
  const found: GainEquationEvidence[] = [];

  for (const page of pages) {
    const normalized = page.text.replace(/[−–—]/g, "-").replace(/\s+/g, " ");
    for (const pattern of patterns) {
      for (const match of normalized.matchAll(pattern)) {
        const value = Number(match[1]);
        const prefix = match[2];
        const scale = prefix === "k" || prefix === "K" ? 1e3 : prefix === "M" ? 1e6 : prefix === "m" ? 1e-3 : 1;
        const resistance = value * scale;
        if (!(resistance > 0) || !Number.isFinite(resistance)) continue;
        found.push({ resistanceOhm: resistance, printed: value, unit: `${prefix}${match[3]}`, page: page.page, equation: match[0] });
      }
    }
  }
  const magnitudes = new Set(found.map((item) => item.resistanceOhm));
  return magnitudes.size === 1 ? found[0] : null;
}

/** Scans the native PDF text for the instrumentation-amplifier gain law. */
export async function readGainEquation(pdfBytes: ArrayBuffer): Promise<GainEquationEvidence | null> {
  let mupdf: typeof import("mupdf");
  try { mupdf = await import("mupdf"); } catch { return null; }
  let document: ReturnType<typeof mupdf.Document.openDocument>;
  try { document = mupdf.Document.openDocument(new Uint8Array(pdfBytes), "application/pdf"); } catch { return null; }
  const started = Date.now();
  const pages: Array<{ page: number; text: string }> = [];
  try {
    const count = Math.min(document.countPages(), MAX_GAIN_EQUATION_PAGES);
    for (let index = 0; index < count && Date.now() - started < GAIN_SCAN_BUDGET_MS; index++) {
      try {
        const structured = JSON.parse(document.loadPage(index).toStructuredText().asJSON()) as { blocks?: MuPdfBlock[] };
        const lines = (structured.blocks ?? []).flatMap((block) => block.lines ?? []).map((line) => line.text ?? "").filter(Boolean);
        // Adjacent lines are joined as well: PDF producers often split the
        // numerator, slash and RG across separate text runs.
        pages.push({ page: index + 1, text: [...lines, ...lines.slice(0, -1).map((line, at) => `${line} ${lines[at + 1]}`)].join("\n") });
      } catch { /* one unreadable page does not hide the rest */ }
    }
    return gainEquationFromText(pages);
  } finally {
    try { document.destroy(); } catch { /* process owns no persistent handle */ }
  }
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
