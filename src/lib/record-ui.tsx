"use client";

// The three pieces that render ONE value of the record: where it came from, how
// it reads, and the row that carries both.
//
// ## Why these live in `src/lib` and not beside a screen
//
// Extracted from `src/app/page.tsx` on 2026-09-03, when the `/suite` shell needed
// the full record panel that `page.tsx` already had.
//
// The alternative was to copy them into `src/app/suite/`, and `HANDOFF.md` is
// explicit about why that is the wrong move: two `Provenance` implementations
// means two screens that can disagree about where a value came from, and that
// disagreement is the one thing this product cannot ship. The whole argument for
// the citation is that it is the same claim wherever it appears.
//
// This file is presentational only. It reads a field and returns markup; it
// decides nothing about the record and imports nothing that reaches the network,
// so it is safe in an air-gapped deployment like everything else under `src/lib`.

import { useState } from "react";
import { isUntraceable, userEdited } from "./provenance";
import { shownRecord } from "./review";
import type { Confirmation } from "./confirm";
import FootprintPreview from "./FootprintPreview";
import type { FootprintGeometry } from "./geometry";
import type { ConfidenceCheck } from "./confidence";
import type { RenderedPage } from "./pagerender";
import type { ReviewItem } from "./review";
import type { RequiredInput } from "./exporters";

/** What the screen says after a read, and the one thing to do next. */
export interface Verdict {
  tone: "ready" | "choose" | "ask" | "check";
  headline: string;
  detail: string;
  /** The thing the detail line is telling them to do, where there is one. */
  action?: "re-read";
}
import type { Extracted, PartRecord, PinRecord } from "./types";

/**
 * Where a value came from, in as few characters as carry the meaning.
 *
 * Always present, never loud. Someone signing off a part has to tell a value the
 * document stated from one a model inferred from one they typed, and has to do
 * it by scanning rather than by clicking.
 */
export function Provenance({ field }: { field: Extracted<unknown> }) {
  if (field.value === null) return <span className="prov prov-none">not read</span>;
  if (isUntraceable(field)) {
    return (
      <span
        className="prov prov-warn"
        title="A model produced this and it could not be located in the datasheet. Check it against the source, then confirm."
      >
        unverified
      </span>
    );
  }
  const parts: string[] = [];
  if (field.citation) parts.push(`p${field.citation.page}`);
  if (field.method === "user") parts.push("you");
  else if (field.method === "user-confirmed") parts.push("checked");
  else if (field.method === "vlm-drawing") parts.push("drawing");
  else if (field.method === "vlm") parts.push("read");
  else if (field.method) parts.push(field.method);
  return (
    <span className="prov" title={field.citation?.snippet ?? undefined}>
      {parts.join(" · ")}
    </span>
  );
}

/** A value, or a min/max pair the way a drawing prints it. */
export function showValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "object") {
    const range = value as { minMm?: number; maxMm?: number };
    if (typeof range.minMm === "number" && typeof range.maxMm === "number") {
      return range.minMm === range.maxMm ? `${range.minMm}` : `${range.minMm}–${range.maxMm}`;
    }
  }
  return String(value);
}

/** One row of the record: label, value, provenance. The unit lives in the label. */
export function Row({ label, unit, field }: { label: string; unit?: string; field: Extracted<unknown> }) {
  return (
    <tr className={field.value === null ? "row-empty" : undefined}>
      <th scope="row">
        {label}
        {unit && <span className="unit"> {unit}</span>}
      </th>
      <td className="num">{showValue(field.value)}</td>
      <td className="meta">
        <Provenance field={field} />
      </td>
    </tr>
  );
}

function clonePart(part: PartRecord): PartRecord {
  return JSON.parse(JSON.stringify(part)) as PartRecord;
}

function updatePin(part: PartRecord, index: number, field: keyof PinRecord, value: string) {
  const next = clonePart(part);
  const pins = next.pins.value;
  const pin = pins?.[index];
  if (!pins || !pin) return next;
  if (field === "electricalType") pin.electricalType = value as PinRecord["electricalType"];
  else if (field === "number" || field === "name") pin[field] = value;
  // The table was edited by hand, so the array's provenance changes with it,
  // INCLUDING the citation. This used to pass `next.pins.citation` through, so
  // a pin table a person had retyped went on claiming it was read from the page
  // the model found it on. See `userEdited`.
  next.pins = userEdited(pins);
  return next;
}

/**
 * THE FULL RECORD: every dimension, where each value came from, and the pin
 * table, editable in place.
 *
 * ## Why this is here and not on a screen
 *
 * Moved out of `src/app/page.tsx` on 2026-09-03 so `/suite` could render it.
 * `HANDOFF.md` singles it out as the one panel whose absence would not have been
 * noticed: every other panel is missing from `/suite` in a way you can see, but
 * the record is a disclosure that is closed by default, so a finished-looking
 * screen without it still looks finished.
 *
 * It is the panel the product's whole argument rests on. A user signing off a
 * part checks it here, against the page each value cites.
 *
 * ## Editing the pin table changes its provenance
 *
 * `updatePin` re-stamps `pins` through `userEdited`, citation included. It used
 * to pass the old citation through, so a pin table a person had retyped went on
 * claiming it was read from the page the model found it on.
 */
export function RecordPanel({
  part,
  activePackage,
  onPartChange
}: {
  part: PartRecord;
  /** The package whose pinout and dimensions to show, or null for the flat record. */
  activePackage: string | null;
  onPartChange: (next: PartRecord) => void;
}) {
  // OPEN/CLOSED IS THIS PANEL'S OWN BUSINESS. It was `page.tsx` state only
  // because the markup lived there; nothing outside reads it.
  const [showRecord, setShowRecord] = useState(false);
  const shown = shownRecord(part, activePackage);
  const pins = shown.pins;
  const setPart = onPartChange;
  // Section 6 of `page.tsx` before the move. The banner comment that marked it
  // there is a line comment here: inside a `return (...)` it would be a second
  // top-level node beside the section, and it names a layout this file no longer
  // sits in.
  return (
    <section className="step">
      <button
        type="button"
        className="disclose"
        onClick={() => setShowRecord(!showRecord)}
        aria-expanded={showRecord}
      >
        <span className="rev-caret">{showRecord ? "▾" : "▸"}</span>
        {showRecord ? "Hide" : "Show"} the full record
        <span className="disclose-sub">{pins.length} pins, every dimension, and where each value came from</span>
      </button>

      {showRecord && (
        <div className="record">
          <div className="record-col">
            <h3>Package</h3>
            <table className="facts">
              <tbody>
                <Row label="Body length" unit="mm" field={shown.dimensions.bodyLengthMm} />
                <Row label="Body width" unit="mm" field={shown.dimensions.bodyWidthMm} />
                <Row label="Body height" unit="mm" field={shown.dimensions.bodyHeightMm} />
                <Row label="Pitch" unit="mm" field={shown.dimensions.pitchMm} />
                <Row label="Lead span" unit="mm" field={shown.dimensions.leadSpanMm} />
                <Row label="Lead span, other axis" unit="mm" field={shown.dimensions.leadSpanCrossMm} />
                <Row label="Lead width" unit="mm" field={shown.dimensions.leadWidthMm} />
                <Row label="Lead length" unit="mm" field={shown.dimensions.leadLengthMm} />
                <Row label="Seated foot" unit="mm" field={shown.dimensions.leadContactMm} />
                <Row label="Lead form" field={shown.dimensions.leadForm} />
                <Row label="Mounting" field={shown.dimensions.mounting} />
                <Row label="Lead diameter" unit="mm" field={shown.dimensions.leadDiameterMm} />
                <Row label="Sides with leads" field={shown.dimensions.leadSides} />
                <Row label="Leads per side" field={shown.dimensions.leadsPerSide} />
                <Row label="Empty grid position" field={shown.dimensions.vacantLeadSlot} />
                <Row label="Lead count" field={shown.dimensions.leadCount} />
              </tbody>
            </table>

            <h3>Printed footprint</h3>
            {/*
              EVERY dimension, because the disclosure above says so.
              This showed fifteen of twenty-five and called itself "every
              dimension". Two of the omissions mattered: the exposed pad
              was one row labelled "Exposed pad", so a rectangular pad
              read to a reviewer as a single number, and the cross-axis
              centre span was invisible, so the value that places half a
              quad's copper could not be seen or corrected.
            */}
            <table className="facts">
              <tbody>
                <Row label="Land length" unit="mm" field={shown.dimensions.landPadLengthMm} />
                <Row label="Land width" unit="mm" field={shown.dimensions.landPadWidthMm} />
                <Row label="Centre span" unit="mm" field={shown.dimensions.landSpanMm} />
                <Row label="Centre span, other axis" unit="mm" field={shown.dimensions.landSpanCrossMm} />
                <Row label="Mask expansion" unit="mm" field={shown.dimensions.solderMaskExpansionMm} />
                <Row label="Mask defined by" field={shown.dimensions.solderMaskDefined} />
                <Row label="Exposed pad length" unit="mm" field={shown.dimensions.thermalPadLengthMm} />
                <Row label="Exposed pad width" unit="mm" field={shown.dimensions.thermalPadWidthMm} />
                <Row label="Via drill" unit="mm" field={shown.dimensions.thermalViaDiameterMm} />
                <Row label="Via pitch" unit="mm" field={shown.dimensions.thermalViaPitchMm} />
              </tbody>
            </table>
          </div>

          <div className="record-col">
            <h3>
              Pins <span className="count">{pins.length}</span>
            </h3>
            {pins.length === 0 ? (
              <p className="empty">No pin table was read from this datasheet.</p>
            ) : (
              <div className="pins-scroll">
                <table className="pins">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Name</th>
                      <th>Type</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pins.map((pin, index) => (
                      <tr key={`${pin.number}-${index}`}>
                        <td className="num">
                          <input
                            value={pin.number}
                            onChange={(event) => setPart(updatePin(part, index, "number", event.target.value))}
                          />
                        </td>
                        <td>
                          <input
                            value={pin.name}
                            onChange={(event) => setPart(updatePin(part, index, "name", event.target.value))}
                          />
                        </td>
                        <td className="meta">{pin.electricalType}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* FOLDED AWAY BY DEFAULT.
          These are the reader's own working notes, and they are written
          in field paths: "dimensions.landSpanCrossMm",
          "radiation.qmlClass", "vertex:gemini-3.6-flash looked for 35
          field(s)". On a part that read cleanly this was thirty lines of
          internal vocabulary under the export button, which is the bulk
          of what made this screen feel like it had too much on it. Kept,
          because they are the honest account of what the reader did and
          did not find, and one click away. */}
      {part.notes.length > 0 && (
        <details className="notes-fold">
          <summary>
            What the reader reported <span className="count">{part.notes.length}</span>
          </summary>
          <ul className="notes">
            {part.notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

/**
 * WORTH A GLANCE: the values no second reading could check.
 *
 * The whole product in one list. `confirm.ts` holds the rule: a value ships
 * without being mentioned only where two INDEPENDENT readings of this datasheet
 * agree on it, and everything that did not clear that bar is here.
 *
 * Above the review panel and never folded, because it is the shorter and the
 * more consequential of the two: the panel below says how confident ONE reading
 * was, this says whether a second one agreed. Bounded at five by `MAX_FLAGGED`;
 * past that the chooser refuses the package outright rather than handing back a
 * form.
 *
 * Moved out of `src/app/page.tsx` on 2026-09-03 so `/suite` shows the same list.
 * Renders nothing when there is nothing to check, so a caller can drop it in
 * unconditionally.
 */
export function WorthAGlance({ items }: { items: readonly Confirmation[] }) {
  if (items.length === 0) return null;
  return (
    <section className="step">
      <div className="step-head">
        <span className="step-eyebrow">Worth a glance</span>
        <h2 className="step-title">
          {items.length} {items.length === 1 ? "value" : "values"} nothing independent could check
        </h2>
      </div>
      <p className="step-note">
        Everything not listed here was agreed by two separate readings of this datasheet, taken by
        different means, so it needs no checking.
      </p>
      <ul className="reviews">
        {items.map((item) => (
          <li key={item.id} className="rev">
            <div className="rev-head rev-static">
              <span className="rev-label">{item.label}</span>
              {item.page !== null && <span className="rev-where">page {item.page}</span>}
            </div>
            <div className="rev-body rev-body-plain">
              <p className="rev-consequence">{item.detail}</p>
              {item.consequence && <p className="rev-snippet">{item.consequence}</p>}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * THE ANSWER: one card saying what the part is, whether it can be built, and the
 * one thing to do next.
 *
 * Replaced four numbered steps competing for attention. Moved out of
 * `src/app/page.tsx` on 2026-09-03 so `/suite` says the same thing in the same
 * words; two screens with two verdicts is two products.
 *
 * `onRetry` is the caller's flow rather than this card's: `/` re-runs its own
 * upload or lookup, and the suite re-runs its read. Omit it and the button is
 * not rendered, which is the honest state for a caller that has nothing to
 * re-run.
 */
export function VerdictCard({
  part,
  shown,
  pins,
  verdict,
  previewGeometry,
  activePackage,
  sourceUrl,
  checks,
  failedChecks,
  openChecks,
  busy,
  onRetry
}: {
  part: PartRecord;
  shown: ReturnType<typeof shownRecord>;
  pins: readonly PinRecord[];
  verdict: Verdict;
  previewGeometry: FootprintGeometry | null;
  /** The package this card is describing, or null for the flat record. */
  activePackage: string | null;
  /** Where the datasheet came from, already validated to http(s) by the caller. */
  sourceUrl: URL | null;
  checks: readonly ConfidenceCheck[];
  failedChecks: readonly ConfidenceCheck[];
  openChecks: readonly ConfidenceCheck[];
  busy: boolean;
  onRetry?: () => void;
}) {
  return (
      <section className="step">
        <div className="result">
          <div className="result-id">
            <span className="ident-part">{part.partNumber.value ?? "unknown part"}</span>
            <span className="ident-sub">
              {[part.manufacturer.value, activePackage].filter(Boolean).join(" · ") || "package not read"}
            </span>
          </div>
          <dl className="identity-facts">
            <div>
              <dt>Pins</dt>
              {/* THE COUNT AND THE PINOUT ARE DIFFERENT READINGS.
                  A package named "CFP (14)" states a count with no table
                  behind it. Printing a bare "14" beside a verdict saying
                  the pin names were never read, above a record disclosure
                  reading "0 pins", is three numbers disagreeing on one
                  screen. Reported 2026-08-25 from a screenshot. */}
              <dd>
                {part.pinCount.value === null && pins.length === 0
                  ? "—"
                  : pins.length === 0
                    ? `${part.pinCount.value}, no pinout`
                    : (part.pinCount.value ?? pins.length)}
              </dd>
            </div>
            <div>
              <dt>Outline</dt>
              <dd>{part.packageOutlineCode.value ?? part.jedecOutline.value ?? "—"}</dd>
            </div>
            <div>
              <dt>Mounting</dt>
              <dd>{shown.dimensions.mounting.value ?? "—"}</dd>
            </div>
            <div>
              <dt>Source</dt>
              <dd>
                {sourceUrl ? (
                  <a href={sourceUrl.toString()} target="_blank" rel="noreferrer noopener">
                    {sourceUrl.hostname}
                  </a>
                ) : (
                  part.sourceFileName || "—"
                )}
              </dd>
            </div>
          </dl>
          <p className={`result-verdict result-${verdict.tone}`}>
            <span className="result-mark" aria-hidden="true">
              {verdict.tone === "ready" ? "\u2713" : "\u2192"}
            </span>
            <span>
              <strong>{verdict.headline}</strong>
              <span className="result-detail">{verdict.detail}</span>
              {verdict.action === "re-read" && onRetry && (
                <span className="result-action">
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={busy}
                    onClick={onRetry}
                  >
                    Read it again
                  </button>
                  <span className="result-action-note">Another minute and a half, and another model call.</span>
                </span>
              )}
            </span>
          </p>

          {/* THE FOOTPRINT, DRAWN, directly under the verdict.
              Placed here on purpose: this is the moment the person decides
              whether to trust the reading, and every other thing on this
              screen is a number. A picture answers "is this the part" in
              two seconds; a table of millimetres does not answer it at
              all. See `FootprintPreview` for why it draws the geometry
              that ships rather than one of its own. */}
          {previewGeometry && (
            <FootprintPreview geometry={previewGeometry} source={previewGeometry.provenance.source} />
          )}
        </div>


        {/* FOLDED WHEN IT IS GOOD NEWS.
            Four checks with their reasoning, open, directly under the
            verdict. Every one of them passing is worth a line and not a
            list: the reader has just been told what to do next and this
            sat between them and doing it. A FAILED check is a different
            thing and opens itself. */}
        {checks.length > 0 && (
          <details
            className={`checks${failedChecks.length > 0 ? " checks-bad" : ""}`}
            open={failedChecks.length > 0}
          >
            <summary className="checks-head">
              {failedChecks.length > 0
                ? `${failedChecks.length} consistency check${failedChecks.length === 1 ? "" : "s"} failed`
                : /* WHAT COULD NOT RUN IS PART OF THE ANSWER.
                     This counted the PASSING checks and called them "all runnable", so a
                     record where two passed and six were unavailable read as "All 2
                     runnable consistency checks passed" while the manifest in the same
                     bundle said "2 of 8 checks passed, 6 could not run on this record".
                     The engineer who found that put it plainly: the manifest is honest and
                     the screen is not, and the six that did not run included the two they
                     cared about. */
                  checks.length === checks.filter((c) => c.state === "pass").length
                  ? `All ${checks.length} consistency checks passed`
                  : `${checks.filter((c) => c.state === "pass").length} of ${checks.length} consistency checks passed, ${
                      checks.filter((c) => c.state !== "pass").length
                    } could not run`}
            </summary>
            {openChecks.length > 0 && (
              <ul>
                {openChecks.map((check) => (
                  <li key={check.id} className={`check check-${check.state}`}>
                    <span className="check-label">{check.label}</span>
                    <span className="check-detail">{check.detail}</span>
                    {check.consequence && <span className="check-why">{check.consequence}</span>}
                  </li>
                ))}
              </ul>
            )}
          </details>
        )}
      </section>
  );
}

/**
 * A rendered page, or an honest sentence about why there is none.
 *
 * Moved out of `src/app/page.tsx` on 2026-09-04 so `/suite` shows the same
 * evidence beside the same question. Two screens with two ways of saying "we
 * could not locate this" is two products.
 */
export function PageImage({
  image,
  caption,
  page
}: {
  image: RenderedPage | undefined;
  caption: string;
  page: number | null | undefined;
}) {
  if (!image) {
    return (
      <div className="page-missing">
        {page
          ? `${caption}, page ${page}. Could not be rendered.`
          : // NOT "no page of this datasheet answers this". What is known is that
            // the value carries no citation, which is a fact about the reading.
            "This value was not located on any page, so there is no page to show."}
      </div>
    );
  }
  return (
    <figure className="page">
      {/* A base64 data URI of a page this process just rendered. `next/image`
          optimises remote and static assets; there is nothing here for it to
          fetch, resize or cache, and routing it through the loader would add a
          request for bytes already in memory. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={`data:${image.mimeType};base64,${image.base64}`} alt={`${caption}, page ${image.page}`} />
      <figcaption>
        {caption} <span className="page-n">page {image.page}</span>
      </figcaption>
    </figure>
  );
}

/**
 * THE READING ITSELF, folded unless something is blocking.
 *
 * NOT a list of things to check: that is `WorthAGlance`, and it is bounded at
 * five. This is every value a model produced with the page it came from.
 * Measured 2026-08-27 across the tuned corpus: 740 items over 71 parts, of which
 * exactly ONE blocks an export. Titled "worth a look" and counted at seventeen,
 * it sat beside a two-item list saying the opposite, and the user is entitled to
 * believe the smaller number.
 *
 * Its two real jobs are kept: clearing a value that cannot be located on a page,
 * which is the only thing that blocks an export, and correcting one the user
 * disagrees with.
 */
export function ReviewList({
  review,
  imageFor,
  onConfirm,
  onCorrect
}: {
  review: readonly ReviewItem[];
  imageFor: (page: number | null | undefined) => RenderedPage | undefined;
  onConfirm: (item: ReviewItem) => void;
  onCorrect: (item: ReviewItem, raw: string) => void;
}) {
  const [openField, setOpenField] = useState<string | null>(null);
  const [correction, setCorrection] = useState("");
  if (review.length === 0) return null;
  const blocking = review.filter((item) => item.blocking);

  return (
    <details className="step reviews-fold" open={blocking.length > 0}>
      <summary className="step-head">
        <span className="step-eyebrow">The reading</span>
        <h2 className="step-title">
          {blocking.length > 0
            ? `${blocking.length} ${blocking.length === 1 ? "value cannot" : "values cannot"} be signed off unchecked`
            : `All ${review.length} model-read ${review.length === 1 ? "value" : "values"}, with their pages`}
        </h2>
        {blocking.length > 0 && <span className="badge">{blocking.length} blocking export</span>}
      </summary>
      <p className="step-note">
        {blocking.length > 0
          ? "These were read but could not be located on a page. Open one to confirm it against the page or correct it."
          : "Nothing here is outstanding. Open any value to see the page it came from, or to correct it."}
      </p>

      <ul className="reviews">
        {review.map((item) => {
          const open = openField === item.field;
          return (
            <li key={item.field} className={`rev${item.blocking ? " rev-block" : ""}`}>
              <button
                type="button"
                className="rev-head"
                onClick={() => {
                  setOpenField(open ? null : item.field);
                  setCorrection("");
                }}
                aria-expanded={open}
              >
                <span className="rev-caret">{open ? "▾" : "▸"}</span>
                <span className="rev-label">{item.label}</span>
                <span className="rev-value">{item.display}</span>
                <span className="rev-where">{item.page ? `p${item.page}` : "no page"}</span>
              </button>

              {open && (
                <div className="rev-body">
                  <div className="rev-left">
                    <p className="rev-consequence">{item.consequence}</p>
                    {item.snippet && <p className="rev-snippet">“{item.snippet}”</p>}
                    <div className="rev-actions">
                      <button type="button" className="btn btn-primary" onClick={() => onConfirm(item)}>
                        Correct as read
                      </button>
                      <div className="rev-correct">
                        <input
                          value={correction}
                          placeholder="or the right value"
                          onChange={(event) => setCorrection(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") {
                              event.preventDefault();
                              onCorrect(item, correction);
                            }
                          }}
                        />
                        <button type="button" className="btn" onClick={() => onCorrect(item, correction)}>
                          Set
                        </button>
                      </div>
                    </div>
                  </div>
                  <div className="rev-right">
                    <PageImage image={imageFor(item.page)} caption="Cited page" page={item.page} />
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </details>
  );
}

/**
 * THE QUESTIONS, grouped under the page each is answered from.
 *
 * ONE DRAWING PER GROUP, NOT ONE PER QUESTION. Every question here is answered
 * off the same package outline, and each used to render its own copy of it. On
 * an LMP7704-SP that is eight questions carrying eight identical 613px images:
 * 5764px of a 7118px page, the same drawing eight times. It read as an endless
 * form and it was mostly one picture repeated.
 */
export function AskPanel({
  needs,
  drawingPage,
  imageFor,
  values,
  onChange,
  onSupply,
  busy,
  maxes
}: {
  needs: readonly RequiredInput[];
  drawingPage: number | null;
  imageFor: (page: number | null | undefined) => RenderedPage | undefined;
  values: Record<string, string>;
  onChange: (field: string, raw: string) => void;
  onSupply: (need: RequiredInput, raw: string) => void;
  busy: boolean;
  /** Upper bounds the settings panel shows, so the two screens agree. */
  maxes: { formedContactMm: number; leadSpanMm: number };
}) {
  if (needs.length === 0) return null;

  const groups = new Map<string, { page: number | null; needs: RequiredInput[] }>();
  for (const need of needs) {
    // `formedLeadSpanMm` belongs to the assembler's die rather than to a page of
    // this document, so it is never filed under the outline drawing.
    const page = need.page ?? (need.field === "formedLeadSpanMm" ? null : drawingPage);
    const key = String(page ?? "none");
    const existing = groups.get(key);
    if (existing) existing.needs.push(need);
    else groups.set(key, { page, needs: [need] });
  }

  return (
    <>
      {[...groups.entries()].map(([key, group]) => (
        <div key={key} className="ask-group">
          <div className="ask-list">
            {group.needs.map((need, position) => (
              <div key={need.field} className="ask-row-full">
                <label className="ask-label" htmlFor={`need-${need.field}`}>
                  {need.label}
                  {need.unit === "mm" && <span className="unit"> mm</span>}
                </label>
                {/* Said ONCE per run of questions that share it. Three
                    consecutive fields explaining themselves with the same
                    paragraph is three times the height and no more information. */}
                {need.why !== group.needs[position - 1]?.why && <p className="ask-why">{need.why}</p>}
                <div className="ask-row">
                  {need.unit === "choice" ? (
                    <select
                      id={`need-${need.field}`}
                      value={values[need.field] ?? ""}
                      onChange={(event) => onChange(need.field, event.target.value)}
                    >
                      <option value="">Choose…</option>
                      {(need.choices ?? []).map((choice) => (
                        <option key={choice.value} value={choice.value}>{choice.label}</option>
                      ))}
                    </select>
                  ) : (
                    <input
                      id={`need-${need.field}`}
                      type={need.unit === "counts" ? "text" : "number"}
                      min={need.unit === "mm" ? "0" : "1"}
                      step={need.unit === "mm" ? "0.01" : "1"}
                      {...(need.unit === "mm"
                        ? { max: need.field === "formedLeadContactMm" ? maxes.formedContactMm : maxes.leadSpanMm }
                        : {})}
                      value={values[need.field] ?? ""}
                      /* THE UNIT, NEVER AN EXAMPLE VALUE. This seeded every
                         millimetre box with "1.55" - the same hint for a seated
                         foot, where it is plausible, and for a toe-to-toe span,
                         where on an 8-lead flat pack it is impossible. A rad-hard
                         engineer called it "an invitation to type a wrong number". */
                      placeholder={need.unit === "counts" ? "6,6,6,5" : need.unit === "count" ? "how many" : need.unit ?? "mm"}
                      onChange={(event) => onChange(need.field, event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          onSupply(need, values[need.field] ?? "");
                        }
                      }}
                    />
                  )}
                  <button type="button" className="btn btn-primary" disabled={busy || !(values[need.field] ?? "").trim()} onClick={() => onSupply(need, values[need.field] ?? "")}>
                    Use this
                  </button>
                </div>
                {need.scope === "install" && (
                  <p className="ask-scope">
                    Asked once. This belongs to your assembly line rather than to this part, so it is remembered for
                    every part after this one.
                  </p>
                )}
              </div>
            ))}
          </div>
          <div className="ask-page">
            <PageImage image={imageFor(group.page)} caption={group.needs[0]?.pageLabel ?? "Package outline"} page={group.page} />
          </div>
        </div>
      ))}
    </>
  );
}
