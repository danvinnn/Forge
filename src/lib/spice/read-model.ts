/**
 * THE SECOND READING, taken by a model looking at the rendered pages.
 *
 * `specs.ts` reads the same tables from the text layer's geometry. These two
 * consume different things, pixels and character codes, which is what makes them
 * independent in the sense RULES.md 7 requires. Without this, every parameter
 * ships FLAGGED as single-source, which is honest and is not the finished
 * product.
 *
 * ## Only the pages that hold a table
 *
 * The deterministic reader has already found the specification tables and knows
 * which pages they are on, so this renders those and nothing else. The CAD path
 * has to let the model choose its own pages; here that question is already
 * answered for free, which makes this both cheaper and more accurate than a
 * whole-document read.
 *
 * ## Air gap
 *
 * The provider is loaded through a dynamic import inside the call, so this
 * module is safe to load in an air-gapped deployment and simply reports that no
 * second reading was available.
 */

import { renderPages } from "../pagerender";
import { assertUnderLimit, recordSpend } from "../spend";
import { SPEC_TABLE_PROMPT, flattenModelReading, type ModelSpecReading } from "./prompt";
import { toSI } from "./units";
import type { ModelReadValue } from "./confirm";
import type { SpecRow } from "./specs";

/**
 * Rendered at the resolution a specification table needs to be legible.
 *
 * 150 DPI was measured as the point where a table reads cleanly; the figure
 * work in `pagerender.ts` uses its own default for a different job.
 */
const TABLE_DPI = 150;

/** More than this many table pages and something has gone wrong upstream. */
const MAX_TABLE_PAGES = 8;

export interface SecondReading {
  values: ModelReadValue[] | null;
  /** Why there is no second reading, when there is not. Never a silent null. */
  unavailable: string | null;
  pages: number[];
}

export type SecondReadingProvider = "vertex" | "gemini" | null;

/** Mirrors the commercial extraction factory: Vertex wins when both are configured. */
export function secondReadingProvider(): SecondReadingProvider {
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS && process.env.FORGE_VERTEX_PROJECT) return "vertex";
  if (process.env.GOOGLE_GEMINI_API_KEY) return "gemini";
  return null;
}

/**
 * The pages worth paying to render, most specification-like first.
 *
 * ## Ranked by rows that look like SPECIFICATIONS, not by row count
 *
 * A Typical Characteristics page is full of graphs, and their axis labels come
 * out of the text layer as rows: `Frequency (Hz)`, `Temperature (°C)`, and a
 * "unit" that is another axis label. Counting rows therefore ranks a page of
 * graphs above a real continuation page.
 *
 * Measured 2026-09-04: LM358 sent pages 16 and 19, three rows each and NOT ONE
 * of them carrying a unit that scales, while pages 7, 9 and 13 - two rows each,
 * both scalable - were dropped. REF5025 spent half its rendered pages on graphs.
 * That is money spent on the wrong pages and a second reading given the wrong
 * evidence.
 *
 * The test is whether a row carries a unit this reader can SCALE, which is what
 * separates a specification from an axis label. Deliberately NOT whether the
 * vocabulary could name the row: naming is the very thing the second reading is
 * asked to help with, and ranking on it would starve the pages it is needed for.
 *
 * Where no page has a scalable row the raw count is the fallback, so a document
 * this reader understands poorly is still read rather than skipped.
 */
export function tablePagesOf(rows: SpecRow[]): number[] {
  const counted = new Map<number, { all: number; scalable: number }>();
  for (const row of rows) {
    const entry = counted.get(row.page) ?? { all: 0, scalable: 0 };
    entry.all += 1;
    if (row.unit !== null && toSI(1, row.unit) !== null) entry.scalable += 1;
    counted.set(row.page, entry);
  }
  const anyScalable = [...counted.values()].some((e) => e.scalable > 0);
  return [...counted.entries()]
    .sort((a, b) => (anyScalable ? b[1].scalable - a[1].scalable || b[1].all - a[1].all : b[1].all - a[1].all))
    .filter(([, e]) => !anyScalable || e.scalable > 0)
    .slice(0, MAX_TABLE_PAGES)
    .map(([page]) => page)
    .sort((a, b) => a - b);
}

/** Pulls the JSON object out of a reply that may be fenced or prefaced. */
export function parseReading(text: string): ModelSpecReading | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = (fenced ? fenced[1] : text).trim();
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(candidate.slice(start, end + 1)) as ModelSpecReading;
    return Array.isArray(parsed?.tables) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Converts a model reading into the shape `confirm.ts` compares.
 *
 * A value whose unit cannot be scaled is DROPPED from the comparison rather than
 * compared as a bare number: comparing 350 against 350 tells us nothing if one
 * of them is kHz and the other MHz, and a false confirmation is the one outcome
 * this product may never produce.
 */
export function toComparable(reading: ModelSpecReading): ModelReadValue[] {
  return flattenModelReading(reading)
    .filter((row) => row.unit === null || toSI(1, row.unit) !== null)
    .map((row) => ({
      parameter: row.parameter,
      // The model's answer to the NAMING question. Carried because our own
      // vocabulary is an allowlist of printed phrasings, and an allowlist is
      // broken by the next vendor: three of eleven unseen op-amps were refused
      // for a gain row worded outside it, with the number printed plainly on
      // the page. See `identify.ts` for what is and is not done with this.
      means: typeof row.means === "string" && row.means.trim() !== "" ? row.means.trim() : null,
      // Carried because it joins the two readings more reliably than the
      // description does: a vendor typo the model silently corrects breaks a
      // description join, and a symbol does not change.
      symbol: row.symbol,
      // The GRADE printed beside this value, where the table states one there
      // instead of above the column. Dropped, OPA2277's four offset voltages
      // look like four readings of one number, and the two readings pick
      // different lines and report a disagreement neither of them made.
      grade: typeof row.grade === "string" && row.grade.trim() !== "" ? row.grade.trim() : null,
      // The BLOCK this row belongs to. Dropped, a row from the 5 V block joins
      // the 10 V block's row and the two correct readings are reported as a
      // disagreement: LMP7704-SP's gain is 84 dB at one supply and 100 dB at
      // the other, and both readings had both right.
      scope: row.scope,
      unit: row.unit,
      // An unlabelled group is null on both sides. The model sometimes answers
      // with an index instead, and an index is not a label: treating "0" as one
      // makes every comparison miss, silently, and report a corroborated part as
      // single-source.
      group: typeof row.group === "string" && row.group.trim() !== "" && !/^\d+$/.test(row.group.trim()) ? row.group : null,
      min: numeric(row.min),
      typ: numeric(row.typ),
      max: numeric(row.max)
    }));
}

/**
 * A model's value cell as a number, or null.
 *
 * Datasheet cells are not always numbers, and the model reports what it sees:
 * `See note (1)`, `(V-) - 0.1`, `±70`. Only a plain magnitude can be compared,
 * and anything else must become null rather than NaN, because NaN compared
 * against a real number silently reads as a disagreement.
 */
function numeric(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const trimmed = value.trim().replace(/^[±+]/, "");
  if (!/^-?\d+(\.\d+)?$/.test(trimmed)) return null;
  const parsed = Number.parseFloat(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Asks a model to read the specification tables on the pages given.
 *
 * Never throws. Every failure becomes `unavailable` with a reason, because a
 * missing second reading must leave the parameters FLAGGED rather than
 * accidentally confirmed. Silence is not agreement.
 */
export async function readWithModel(pdfBytes: ArrayBuffer, pages: number[]): Promise<SecondReading> {
  if (pages.length === 0) return { values: null, unavailable: "no specification table pages were located", pages };

  const provider = secondReadingProvider();
  if (!provider) return { values: null, unavailable: "no model is configured for a second reading", pages };

  const rendered = await renderPages(pdfBytes, pages, { dpi: TABLE_DPI, maxPages: MAX_TABLE_PAGES });
  if (rendered.length === 0) return { values: null, unavailable: "the specification pages could not be rendered", pages };

  // ONE definition of the model and Vertex endpoint, shared with the CAD path.
  const { modelId } = await import("../extraction/models/gemini");
  const vertex = provider === "vertex" ? await import("../extraction/models/vertex") : null;
  const model = vertex ? vertex.vertexModelId() : modelId();
  const label = `${provider}:${model}`;
  try {
    // The ceiling is checked BEFORE the call, not after, so a run that would
    // cross it never happens rather than being reported once it has.
    assertUnderLimit(label);
  } catch (error) {
    return { values: null, unavailable: error instanceof Error ? error.message : "the spend ceiling was reached", pages };
  }

  try {
    const parts = [
      { text: SPEC_TABLE_PROMPT },
      ...rendered.map((image) => ({ inlineData: { mimeType: image.mimeType, data: image.base64 } }))
    ];
    let text: string;
    let usage: { inputTokens: number; outputTokens: number } | undefined;
    if (vertex) {
      const { GoogleGenAI } = await import("@google/genai");
      const client = new GoogleGenAI({
        vertexai: true,
        project: vertex.vertexProject(),
        location: vertex.vertexLocation()
      });
      const response = await client.models.generateContent({
        model,
        contents: [{ role: "user", parts }],
        config: { temperature: 0, responseMimeType: "application/json" }
      });
      text = response.text ?? "";
      usage = response.usageMetadata
        ? {
            inputTokens: response.usageMetadata.promptTokenCount ?? 0,
            outputTokens:
              (response.usageMetadata.candidatesTokenCount ?? 0) +
              (response.usageMetadata.thoughtsTokenCount ?? 0)
          }
        : undefined;
    } else {
      const { GoogleGenerativeAI } = await import("@google/generative-ai");
      const client = new GoogleGenerativeAI(process.env.GOOGLE_GEMINI_API_KEY!).getGenerativeModel({
        model,
        generationConfig: { temperature: 0, responseMimeType: "application/json" }
      });
      const response = await client.generateContent({ contents: [{ role: "user", parts }] });
      const metadata = response.response.usageMetadata;
      text = response.response.text();
      usage = metadata
        ? {
            inputTokens: metadata.promptTokenCount ?? 0,
            outputTokens:
              (metadata.candidatesTokenCount ?? 0) +
              ((metadata as { thoughtsTokenCount?: number }).thoughtsTokenCount ?? 0)
          }
        : undefined;
    }
    recordSpend(label, usage);

    const reading = parseReading(text);
    if (!reading) return { values: null, unavailable: "the model's reply was not the requested JSON", pages };
    return { values: toComparable(reading), unavailable: null, pages };
  } catch (error) {
    return { values: null, unavailable: error instanceof Error ? error.message : "the second reading failed", pages };
  }
}
