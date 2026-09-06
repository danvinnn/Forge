/**
 * NAMING A ROW OUR OWN VOCABULARY COULD NOT.
 *
 * ## The class this closes
 *
 * `vocab.ts` names a specification row by matching its printed description
 * against a list of phrasings. That list is an ALLOWLIST, and `LEARNINGS.md`
 * records allowlists being broken by the next case over and over in this
 * codebase. Measured on the amplifier hold-out, 2026-09-04: three of eleven
 * unseen op-amps were refused outright for want of an open-loop gain, with the
 * gain PRINTED PLAINLY on the page in a wording the list did not carry. The
 * numbers were read. Only the name was missing.
 *
 * That is `forge-we-had-it-and-threw-it-away`, the shape this project has hit
 * more than any other.
 *
 * ## Why the model, and what it is and is not allowed to do
 *
 * The product already takes a second reading of the same tables from the
 * RENDERED page, on every request, and already asks it to report every row. It
 * can also say which standard quantity a row states, which is a naming question
 * about text on the page rather than a measurement. Asking costs nothing extra:
 * it is one more field in a reply we are already paying for.
 *
 * The model NEVER supplies a value here. Numbers come from the deterministic
 * reader, as they always have, so a row named this way still has both readings
 * agreeing on what it SAYS. Only its identity has one source.
 *
 * ## Three ways a name is refused
 *
 * Each rejects on PROOF, never on absence, which is this reader's rule
 * throughout:
 *
 *   1. The name is not one we model. An answer outside the list is not a name.
 *   2. The row's printed unit CONTRADICTS that quantity's dimension. A gain
 *      cannot be in amps, and this is the check that catches a plausible-looking
 *      mislabel without a person reading the page.
 *   3. Our own vocabulary already named the row something ELSE. Two readings
 *      disagreeing about identity is a conflict, not an upgrade, and `confirm.ts`
 *      exists precisely so we never rank the readers. The deterministic name
 *      stands and the disagreement is reported.
 *
 * ## The value ships FLAGGED
 *
 * A row named this way carries `namedByModel`, and `confirm.ts` turns that into
 * a flag saying which parameter was named by one means only, on which page. It
 * is never silent. RULES.md 7 is about what ships without being told, and this
 * is told.
 */

import { PARAMETERS, unitContradicts } from "./vocab";
import { parseUnit } from "./units";
import { EXPECTED_BASE } from "./model";
import { findTheirs, type ModelReadValue } from "./confirm";
import type { SpecRow } from "./specs";

export interface Naming {
  /** The row's printed description, so a person can find it on the page. */
  parameter: string;
  key: string;
  page: number;
}

export interface IdentifyResult {
  rows: SpecRow[];
  /** Rows the model named that our vocabulary could not. Every one is flagged. */
  named: Naming[];
  /** Rows where the two readings named DIFFERENT quantities. Never resolved here. */
  conflicts: Array<{ parameter: string; ours: string; theirs: string; page: number }>;
  /**
   * Rows the model named that STILL cannot become a parameter, and why.
   *
   * Naming a row is not the end of the road: `readBlocks` then needs a unit it
   * can scale into the base that parameter is held in. A row named and then
   * dropped at that gate is invisible - the count of names goes up and the
   * coverage does not - so the gate is reported here instead of being
   * discovered by wondering why a mechanism bought nothing.
   */
  blocked: Array<{ parameter: string; key: string; unit: string | null; why: string; page: number }>;
}

/**
 * Applies the model's naming to rows the vocabulary left unnamed.
 *
 * Pure and synchronous: the model call has already happened. Passing `null`
 * returns the rows untouched, because no second reading means no second
 * opinion, not a licence to guess.
 */
export function applyModelIdentities(rows: SpecRow[], modelRead: ModelReadValue[] | null): IdentifyResult {
  if (!modelRead || modelRead.length === 0) return { rows, named: [], conflicts: [], blocked: [] };

  const named: Naming[] = [];
  const conflicts: IdentifyResult["conflicts"] = [];
  const blocked: IdentifyResult["blocked"] = [];

  const out = rows.map((row) => {
    const theirs = findTheirs(row, modelRead);
    const proposed = theirs?.means ?? null;
    if (!proposed) return row;

    const spec = PARAMETERS.find((p) => p.key === proposed);
    if (!spec) return row; // an answer outside the list is not a name

    if (row.key !== null) {
      // Both readings named it. Agreement is silent; disagreement is REPORTED
      // and changes nothing, because ranking two readers is the rule this
      // project has broken and paid for more than once.
      if (row.key !== spec.key) conflicts.push({ parameter: row.parameter, ours: row.key, theirs: spec.key, page: row.page });
      return row;
    }

    // The unit the DOCUMENT printed, read by our own reader, against what this
    // quantity must be dimensionally. A gain is not in amps.
    if (unitContradicts(spec, row.unit, parseUnit(row.unit)?.base ?? null)) return row;

    named.push({ parameter: row.parameter, key: spec.key, page: row.page });

    // WHAT HAPPENS TO IT NEXT, recorded here rather than discovered later.
    // `readBlocks` drops a row whose unit will not scale, or whose base is not
    // one this parameter is held in, and drops it silently.
    const parsed = parseUnit(row.unit);
    const expected = EXPECTED_BASE[spec.key as keyof typeof EXPECTED_BASE];
    if (expected) {
      if (!parsed) blocked.push({ parameter: row.parameter, key: spec.key, unit: row.unit, why: "the unit cannot be scaled", page: row.page });
      else if (!expected.includes(parsed.base)) blocked.push({ parameter: row.parameter, key: spec.key, unit: row.unit, why: `unit base ${parsed.base} is not one of ${expected.join(", ")}`, page: row.page });
      else if (row.values.min === null && row.values.typ === null && row.values.max === null) blocked.push({ parameter: row.parameter, key: spec.key, unit: row.unit, why: "the row carries no value", page: row.page });
    }

    return { ...row, key: spec.key, namedByModel: true };
  });

  return { rows: out, named, conflicts, blocked };
}
