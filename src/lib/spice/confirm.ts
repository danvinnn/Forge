/**
 * RULES.md 7, for model parameters.
 *
 *     No value ships silently unless two INDEPENDENT sources agree on it.
 *
 * The two here are a model reading the RENDERED page and `specs.ts` reading the
 * text layer's GEOMETRY. They consume pixels and character codes respectively,
 * which is what makes them independent in the sense the rule means. A second
 * model call would not be: a reader that misreads a table misreads it the same
 * way twice.
 *
 * ## This names the CONFLICT. It does not rank the readers.
 *
 * `LEARNINGS.md`: "Two readers disagreeing is not the same as one being better",
 * and every rule this project built on "reader N is more reliable" scored worse
 * than the one it replaced.
 *
 * The temptation here is specific and should be resisted. Where a document has
 * the Symbol-font mapping, the geometric reader is KNOWN to be wrong about the
 * micro sign, so preferring the model on those pages looks obviously right. It
 * is still a ranking rule. Flag the document, show both readings, let the person
 * who can see the page decide.
 *
 * ## The unit of a flag is a GLANCE
 *
 * A specification block read off one table in one look is ONE item, exactly as a
 * pinout is one item whether the part has 8 pins or 144. Sixteen parameters do
 * not make sixteen flags, because a person settles them by looking at one page
 * once. Without that, every part would exceed `MAX_FLAGGED` and the SPICE half
 * would refuse everything.
 */

import { MAX_FLAGGED } from "../confirm";
import { canonicalValue } from "./model";
import type { SpecRow } from "./specs";
import type { ModelBlock, ModelParameter } from "./model";

export type SpiceConfirmState = "confirmed" | "flagged";

export interface SpiceConfirmation {
  id: string;
  label: string;
  state: SpiceConfirmState;
  /** Written to be read alone, naming both readings where they differ. */
  detail: string;
  /** What goes wrong if this is wrong. Present on flagged items only. */
  consequence?: string;
  /** A short slug naming WHY, for grouping a bench's output into classes. */
  because?: string;
  page: number | null;
}

export interface SpiceConfirmationReport {
  items: SpiceConfirmation[];
  flagged: SpiceConfirmation[];
  overBudget: boolean;
}

/**
 * How far apart two readings of the same printed number may be.
 *
 * They are reading the SAME characters off the same page, so any real
 * disagreement is a different row, a different column or a different unit, not
 * a rounding difference. This is tight on purpose.
 */
const AGREEMENT_TOLERANCE = 0.005;

function agrees(a: number | null, b: number | null): boolean {
  if (a === null && b === null) return true;
  if (a === null || b === null) return false;
  if (a === 0 || b === 0) return a === b;
  return Math.abs(a - b) / Math.abs(a) <= AGREEMENT_TOLERANCE;
}

export interface ModelReadValue {
  parameter: string;
  /**
   * Which standard quantity the model says this row states, or null.
   *
   * Used by `identify.ts` to name a row our own vocabulary could not, which is
   * the only way an allowlist of printed phrasings stops costing whole parts.
   */
  means?: string | null;
  /** The symbol as printed, where the document prints one. */
  symbol?: string | null;
  /** Which specification block this came from, e.g. `VS = 5 V`. */
  scope?: string | null;
  /** A device grade printed beside the value rather than above its column. */
  grade?: string | null;
  unit: string | null;
  group: string | null;
  min: number | null;
  typ: number | null;
  max: number | null;
}

/** Normalises a description or symbol enough to join the two readings. */
function key(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Finds the model's reading of the row our reader read.
 *
 * The SYMBOL is tried first. Two readings of one table can describe a row
 * differently: OPA2189 prints `Unity-gain Bandwith`, and a model reading the
 * page silently corrects the vendor's typo, so a description-only join misses a
 * row both readings got right and reports it as single-source. `UGB` does not
 * change.
 *
 * The description is the fallback, because not every row prints a symbol.
 */
export function findTheirs(mine: SpecRow, theirs: ModelReadValue[]): ModelReadValue | undefined {
  const sameGroup = theirs.filter((t) => (t.group ?? null) === mine.group);
  const named = (t: ModelReadValue) =>
    (mine.symbol && t.symbol && key(t.symbol) === key(mine.symbol)) || key(t.parameter) === key(mine.parameter);
  const candidates = sameGroup.filter(named);
  if (candidates.length === 0) return undefined;
  if (candidates.length === 1) return candidates[0];

  // SCOPE DISAMBIGUATES; IT DOES NOT GATE.
  //
  // A datasheet that repeats its table per supply states different values in
  // each, so with several candidates the block matters: LMP7704-SP's gain is
  // 84 dB at 5 V and 100 dB at 10 V, and joining across reports two correct
  // readings as a disagreement.
  //
  // But filtering ON scope broke the opposite case. The two readings word the
  // same heading differently, `LM358, LM358A` against `LM358 and LM358A`, and
  // excluding on that mismatch matched nothing at all: LM358 went from one
  // disagreement to zero of six corroborated. A wording difference is not proof
  // of a different block, and this is the same rule as everywhere else here.
  // Reject on proof, never on absence.
  // THE GRADE, FIRST, for the same reason as the scope and by the same rule.
  //
  // A table that prints its grades inline states several values for one
  // parameter, and joining across them reports two correct readings as a
  // disagreement: OPA2277's offset voltage is 25 µV for one device and 20 µV
  // for another, and both readings had both right. Like the scope, this
  // DISAMBIGUATES and does not gate: a candidate set that shares no grade is
  // still joined, because our failure to read a grade is not proof of a
  // different device.
  const ourGrade = mine.grade ? key(mine.grade) : null;
  if (ourGrade !== null) {
    const sameGrade = candidates.filter((t) => t.grade && key(t.grade) === ourGrade);
    if (sameGrade.length > 0) return sameGrade[0];
  }

  const ours = mine.scope ? key(mine.scope) : null;
  if (ours !== null) {
    const compatible = candidates.filter((t) => {
      const yours = t.scope ? key(t.scope) : null;
      return yours !== null && (ours === yours || ours.includes(yours) || yours.includes(ours));
    });
    if (compatible.length > 0) return compatible[0];
  }
  return candidates[0];
}

/**
 * Compares the two readings of the parameters a model was built from.
 *
 * `modelRead` is null when no second reading was taken, which is an honest and
 * common state: the block is then flagged as single-source rather than treated
 * as confirmed. Silence is never agreement.
 */
export function confirmParameters(
  block: ModelBlock,
  rows: SpecRow[],
  modelRead: ModelReadValue[] | null,
  /**
   * What `identify.ts` did with the model's naming of the same rows. Optional
   * so every existing caller keeps working; absent means nothing was named that
   * way, which is the state of every part whose vocabulary already sufficed.
   */
  naming?: { named: Array<{ parameter: string; key: string; page: number }>; conflicts: Array<{ parameter: string; ours: string; theirs: string; page: number }> }
): SpiceConfirmationReport {
  const items: SpiceConfirmation[] = [];
  const used = Object.keys(block.values) as ModelParameter[];
  const corrected = used.filter((parameter) => block.values[parameter]?.correctedByUser);
  const machineRead = used.filter((parameter) => !block.values[parameter]?.correctedByUser);
  const page = Object.values(block.values)[0]?.page ?? null;

  const consequence =
    "These are the numbers the model reproduces. A wrong one gives a simulation that agrees with itself and disagrees with the part.";

  if (!modelRead && machineRead.length > 0) {
    items.push({
      id: "parameters",
      label: "Specification parameters",
      state: "flagged",
      because: "single-source",
      detail:
        `${machineRead.length} parameters were read from the specification table by one means only, the document's text layer. ` +
        `No second reading of the rendered page was taken, so nothing here is confirmed. Check them against page ${page ?? "?"}.`,
      consequence,
      page
    });
  } else if (machineRead.length > 0 && modelRead) {
    const disagreements: string[] = [];
    const unmatched: string[] = [];
    for (const parameter of machineRead) {
      const value = block.values[parameter]!;
      const source = rows.find((r) => r.key === parameter && r.page === value.page);
      const theirs = source ? findTheirs(source, modelRead) : undefined;
      if (!theirs) {
        unmatched.push(parameter);
        continue;
      }
      // Compare in the SAME canonical form, so a unit disagreement shows up as a
      // value disagreement, which is exactly what it is: `V/ms` against `V/us`
      // is a factor of 1000. Both sides go through one conversion.
      const ours = value.si;
      const scale = (v: number | null) => (v === null ? null : canonicalValue(parameter, v, theirs.unit));
      for (const corner of ["min", "typ", "max"] as const) {
        if (!agrees(ours[corner], scale(theirs[corner]))) {
          disagreements.push(
            `${parameter} ${corner}: text layer reads ${value.printed[corner] ?? "nothing"} ${value.unit}, the page reads ${theirs[corner] ?? "nothing"} ${theirs.unit ?? ""}`
          );
        }
      }
    }

    if (disagreements.length > 0) {
      items.push({
        id: "parameters",
        label: "Specification parameters",
        state: "flagged",
        because: "readers-disagree",
        // BOTH readings, never a winner. The person looking at the page decides.
        detail: `The two readings of this table disagree. ${disagreements.slice(0, 4).join("; ")}${disagreements.length > 4 ? `; and ${disagreements.length - 4} more` : ""}.`,
        consequence,
        page
      });
    } else if (unmatched.length > 0) {
      items.push({
        id: "parameters",
        label: "Specification parameters",
        state: "flagged",
        because: "one-source-only",
        detail:
          `${machineRead.length - unmatched.length} of ${machineRead.length} parameters are corroborated by both readings. ` +
          `${unmatched.join(", ")} ${unmatched.length === 1 ? "was" : "were"} read by one means only.`,
        consequence,
        page
      });
    } else {
      items.push({
        id: "parameters",
        label: "Specification parameters",
        state: "confirmed",
        detail: `All ${machineRead.length} parameters agree between a reading of the rendered page and a reading of the text layer's geometry.`,
        page
      });
    }
  }

  if (corrected.length > 0) {
    items.push({
      id: "parameter-corrections",
      label: "Reviewed parameter corrections",
      state: "confirmed",
      detail: `${corrected.join(", ")} ${corrected.length === 1 ? "was" : "were"} corrected by you while viewing the cited datasheet page.`,
      page: block.values[corrected[0]]?.page ?? null
    });
  }

  // A PARAMETER NAMED BY ONE READING ONLY.
  //
  // The values on such a row are ours and are corroborated like any other; what
  // has a single source is the claim that this row IS that quantity. That is a
  // different question from "do the two readings agree on the number", so it is
  // its own item rather than folded into the one above, and it is one glance:
  // a person settles it by looking at the row's printed description once.
  // Asked of the ROWS this block was actually built from, rather than of the
  // whole document: a row named this way that no parameter consumed is not
  // something to make a person check.
  const consumed = used
    .map((parameter) => {
      const value = block.values[parameter]!;
      const source = rows.find((r) => r.key === parameter && r.page === value.page && r.namedByModel);
      return source ? { parameter: source.parameter, key: parameter as string, page: source.page } : null;
    })
    .filter((n): n is { parameter: string; key: string; page: number } => n !== null);
  if (consumed.length > 0) {
    items.push({
      id: "parameter-naming",
      label: "What these rows are",
      state: "flagged",
      because: "named-by-one-reading",
      detail:
        `Our vocabulary did not recognise the wording of ${consumed.map((n) => `"${n.parameter}"`).join(", ")}, ` +
        `so ${consumed.length === 1 ? "it was" : "they were"} identified as ${consumed.map((n) => n.key).join(", ")} by the reading of the rendered page alone. ` +
        `The numbers are the document's own and were read by both means. Check on page ${consumed[0].page} that ${consumed.length === 1 ? "this row states" : "these rows state"} what the model called ${consumed.length === 1 ? "it" : "them"}.`,
      consequence: "If a row was named wrongly, the model reproduces the right number for the wrong specification.",
      page: consumed[0].page
    });
  }

  // The two readings naming a row DIFFERENTLY. Reported, never resolved: this
  // file names conflicts and does not rank readers.
  const clashing = (naming?.conflicts ?? []).filter((c) => used.includes(c.ours as ModelParameter));
  if (clashing.length > 0) {
    items.push({
      id: "parameter-naming-conflict",
      label: "What these rows are",
      state: "flagged",
      because: "readers-name-differently",
      detail: clashing
        .map((c) => `"${c.parameter}" on page ${c.page}: the text layer reads it as ${c.ours}, the rendered page as ${c.theirs}. The model was built using ${c.ours}.`)
        .join(" "),
      consequence: "If the wrong one was used, the model reproduces the right number for the wrong specification.",
      page: clashing[0].page
    });
  }

  // A unit the document may have stored wrongly is its own glance, because it
  // is settled by looking at one printed unit rather than at the table.
  const ambiguous = used.filter((p) => block.values[p]!.ambiguousMicro);
  if (ambiguous.length > 0) {
    items.push({
      id: "unit-ambiguity",
      label: "Unit prefix",
      state: "flagged",
      because: "symbol-font",
      detail:
        `The text layer stores a milli prefix for ${ambiguous.join(", ")} where the page may draw a micro sign. ` +
        `That is a factor of a thousand and no dimension check can see it, because both are valid units for this parameter.`,
      consequence: "A slew rate wrong by 1000 makes a stable design look unstable, or the reverse.",
      page
    });
  }

  // More than one block means a question only the user can answer.
  const flagged = items.filter((i) => i.state === "flagged");
  return { items, flagged, overBudget: flagged.length > MAX_FLAGGED };
}
