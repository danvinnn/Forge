/**
 * JUDGING WHAT A PERSON TYPED, in one place for every screen.
 *
 * `/` and `/suite` both take corrections to the record and answers to the
 * product's questions. What counts as a valid answer, and what the refusal says
 * when it is not, is a property of the PRODUCT and not of a screen: two screens
 * accepting different things is two products, and the one that accepts more is
 * the one that writes a record `partSchema` rejects at the export boundary.
 *
 * Every rule below is carried over unchanged from `src/app/page.tsx`, comments
 * included, because each records a defect that reached a user.
 *
 * Pure: no React, no network, no state. The screens keep their own wiring.
 */

import { isRangeField, parseRange } from "./review";
import type { RequiredInput } from "./exporters";
import type { Extracted, PartRecord } from "./types";

/** Largest span the export route accepts, mirrored so the UI refuses it first. */
export const MAX_LEAD_SPAN_MM = 200;

/**
 * The route's own bound on the formed FOOT, which is far tighter than the span.
 *
 * A foot is a feature of one lead rather than a distance across the package, so
 * `/api/export` caps it at 5 mm. The screen validated every millimetre answer
 * against the span's 200, so 8 was accepted here and rejected there with a
 * message about a limit the user had never been shown. Mirrored per field
 * rather than one number for all of them, which is what let the two drift.
 */
export const MAX_FORMED_CONTACT_MM = 5;

export type Judged<T> = { ok: true; value: T } | { ok: false; message: string };

/**
 * Writes one field of a record, merging rather than replacing.
 *
 * `MERGES` is load-bearing: a patch that does not mention the citation keeps the
 * one already there. See `correctionFor`, which relies on it the other way.
 */
export function withField(record: PartRecord, path: string, patch: Partial<Extracted<unknown>>): PartRecord {
  if (!path.includes(".")) {
    const current = (record as unknown as Record<string, Extracted<unknown>>)[path];
    return { ...record, [path]: { ...current, ...patch } } as PartRecord;
  }
  const [group, key] = path.split(".");
  const bag = (record as unknown as Record<string, Record<string, Extracted<unknown>>>)[group];
  return { ...record, [group]: { ...bag, [key]: { ...bag[key], ...patch } } } as PartRecord;
}

/**
 * What a typed correction to a read value should be stored as.
 *
 * Numeric fields must stay numeric or the export schema rejects the record at
 * the boundary, which surfaces as an unrelated-looking failure.
 *
 * AND A RANGE FIELD HAS TO STAY A RANGE. A drawing prints a lead span as a
 * tolerance pair and IPC-7351B uses both ends, so the record holds
 * `{minMm, maxMm}`; writing a bare number there produced a record `partSchema`
 * rejects, and every export afterwards answered "Invalid part record" until the
 * page was reloaded. Caught by `bench:browser --full` on 2026-08-27, on the
 * correction the panel invites most.
 *
 * One number means the drawing states one, which is what a dimension marked TYP
 * or BSC gives. See `parseRange`.
 */
export function correctionFor(field: string, label: string, raw: string): Judged<unknown> {
  const text = raw.trim();
  if (!text) return { ok: false, message: `Enter a value for ${label.toLowerCase()}, or confirm what was read.` };

  if (isRangeField(field)) {
    const range = parseRange(text);
    if (!range) return { ok: false, message: `${label} is a range: enter one number, or two as "5.8 to 6.2".` };
    return { ok: true, value: range };
  }
  if (field === "pinCount" || /Mm$/.test(field)) {
    const parsed = Number(text);
    if (!Number.isFinite(parsed) || parsed <= 0) return { ok: false, message: `${label} must be a positive number.` };
    return { ok: true, value: field === "pinCount" ? Math.round(parsed) : parsed };
  }
  return { ok: true, value: text };
}

/**
 * What a typed answer to one of the product's questions should be sent as.
 *
 * Checked here so a typo is caught beside the box rather than as a 400 from the
 * route.
 */
export function answerFor(need: RequiredInput, raw: string): Judged<number | string> {
  const text = raw.trim();

  if (need.unit === "choice") {
    const allowed = need.choices?.map((choice) => choice.value) ?? [];
    if (!allowed.includes(text)) return { ok: false, message: `Choose ${need.label.toLowerCase()}.` };
    return { ok: true, value: text };
  }

  if (need.unit === "counts") {
    // One count per SIDE, for the arrangements this generator builds: 1, 2 or 4.
    // This demanded exactly four, so a two-sided package with unequal rows had a
    // question it could not answer here.
    if (!/^\d{1,3}(?:,\d{1,3})?$|^\d{1,3}(?:,\d{1,3}){3}$/.test(text)) {
      return { ok: false, message: "Enter one count per side, separated by commas, e.g. 6,6,6,5." };
    }
    return { ok: true, value: text };
  }
  if (need.unit === "count") {
    const parsed = Number(text);
    if (!Number.isInteger(parsed) || parsed < 1) return { ok: false, message: `${need.label} must be a whole number of 1 or more.` };
    return { ok: true, value: parsed };
  }
  const ceiling = need.field === "formedLeadContactMm" ? MAX_FORMED_CONTACT_MM : MAX_LEAD_SPAN_MM;
  const parsed = Number(text);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > ceiling) {
    return { ok: false, message: `Enter ${need.label.toLowerCase()} in mm, greater than 0 and no more than ${ceiling}.` };
  }
  return { ok: true, value: parsed };
}
