/**
 * THE ONE THING A SCREEN HAS TO SAY AFTER A READ, computed once.
 *
 * ## Why this is not in a component
 *
 * `/` and `/suite` both have to answer the same three questions - what part is
 * this, can I have my library, and what do I do next - and they must answer them
 * the same way. `VerdictCard` was moved into `record-ui.tsx` on 2026-09-03 so the
 * two screens SAY the same thing; this moves the decision of WHAT to say, which
 * is the half that can actually diverge.
 *
 * Two screens with two verdicts is two products, and the divergence would be
 * invisible: each screen looks self-consistent.
 *
 * ## Why the order of the states is what it is
 *
 * Ranked by what BLOCKS the build, hardest first, because only the first one is
 * actionable. Offering someone a package chooser and eight questions and a
 * review list at once is three next-actions, which is none.
 *
 * The package choice leads because it is the only one the product genuinely
 * cannot make for the user: a footprint is per package, and a document describes
 * several. Questions come next because they have answers. The review list comes
 * last because it blocks nothing until the export says so.
 *
 * Every comment inside records a defect that reached a user. Do not reorder the
 * branches without reading them.
 */

import { labelForField } from "./review";
import type { PackageChoice, PackageOption, RequiredInput } from "./exporters";
import type { PartRecord } from "./types";

export interface Verdict {
  tone: "ready" | "choose" | "ask" | "check";
  headline: string;
  detail: string;
  /** The thing the detail line is telling them to do, where there is one. */
  action?: "re-read";
}

/** One entry per package the chooser returned, by designator. */
export function packageOutcomesOf(packageChoice: PackageChoice | null): Map<string, PackageOption> {
  return new Map(packageChoice?.ok ? packageChoice.options.map((option) => [option.designator, option]) : []);
}

/**
 * The chooser succeeded and every package it returned is `unsupported`.
 *
 * ONE VALUE, read by both the verdict and the Build button, because the two
 * disagreeing is the defect. `packageChoice.ok` is true in this state - the
 * record resolved and options were produced - so the button's own condition saw
 * nothing wrong and stayed live under a card that had just said nothing could be
 * built. Found on RTAX2000S, 2026-08-30.
 */
export function nothingBuildableIn(outcomes: Map<string, PackageOption>): boolean {
  return outcomes.size > 0 && [...outcomes.values()].every((option) => option.status === "unsupported");
}

/**
 * THE PACKAGES TO OFFER, from the drawings the document actually gave us.
 *
 * `packageVariants` is a scan of the ordering table's TEXT. `packageOptions` is
 * built from the packages the reader LOCATED, each with its own pin table,
 * outline drawing and printed land pattern, and it is what `/api/export` will
 * accept. Measured on OPA333, 2026-08-28: two variants scanned against FIVE
 * located tables, all five of which build a complete bundle, so three packages a
 * user could have had were never offered.
 *
 * Falls back to the scanned list when the chooser has not run or could not
 * build, because then it is the only list there is.
 */
export function choosableFrom(
  packageChoice: PackageChoice | null,
  offeredVariants: PartRecord["packageVariants"]
): Array<{ designator: string; family: string; leadCount: number | null }> {
  if (packageChoice?.ok && packageChoice.options.length > 0) {
    return packageChoice.options.map((option) => ({
      designator: option.designator,
      family: option.family,
      leadCount: option.leadCount
    }));
  }
  return offeredVariants.map((variant) => ({
    designator: variant.designator,
    family: variant.family,
    leadCount: variant.leadCount
  }));
}

/**
 * The questions we ALREADY know the answer to, before anything is pressed.
 *
 * With several unresolved packages the questions differ per package, and showing
 * one package's questions as if they were the part's would be a guess.
 */
export function knownNeedsFor(packageChoice: PackageChoice | null, activePackage: string | null): RequiredInput[] {
  if (!packageChoice?.ok) return [];
  const chosen = packageChoice.options.find((option) => option.designator === activePackage);
  const option = chosen ?? (packageChoice.options.length === 1 ? packageChoice.options[0] : undefined);
  return option?.status === "needs-input" ? option.needs : [];
}

export interface VerdictInput {
  part: PartRecord;
  packageChoice: PackageChoice | null;
  chosenPackage: string | null;
  /** Packages the user may pick between. */
  choosable: ReadonlyArray<{ designator: string }>;
  /** Questions on screen, pending or already known. */
  needs: readonly RequiredInput[];
  /** Review items that block an export. */
  blockingReview: number;
  /** Values worth a glance. */
  toCheck: number;
  outcomes: Map<string, PackageOption>;
  nothingBuildable: boolean;
}

export function readVerdict(input: VerdictInput): Verdict {
  const { part, packageChoice, chosenPackage, choosable, needs, blockingReview, toCheck, outcomes, nothingBuildable } = input;

  // THE RECORD ITSELF CANNOT BUILD, whatever is chosen. `packageChoice.ok` is
  // false when the reading is short of something no package selection can
  // supply, and `blockedBy` names it.
  //
  // Checked FIRST, and it is the reason this state exists. Without it the card
  // said "Ready to build" on an LMP7704-SP whose pinout had not been read, and
  // the export then refused with "this datasheet is missing values the footprint
  // needs". A verdict that contradicts the button beneath it is worse than no
  // verdict: it spends the user's trust and then their time.
  if (packageChoice && !packageChoice.ok) {
    const named = packageChoice.blockedBy.map(labelForField);
    // BLAME THE RIGHT LAYER.
    //
    // "This datasheet has no pinout" and "we read one and refused it" are
    // different facts. The card said the first for both, so every encounter with
    // a discard was filed as the model failing, and a code defect survived from
    // 2026-08-10 to 2026-08-25 being reported as a bad read.
    const discarded = part.notes.find((note) => /pin table that was discarded/.test(note));
    if (discarded && packageChoice.blockedBy.includes("pins")) {
      return {
        tone: "check",
        headline: "A pinout was read and then refused, so nothing can be built yet.",
        detail: `${discarded} Reading again often returns a table that passes.`,
        action: "re-read"
      };
    }
    return {
      tone: "check",
      headline: `Not enough was read to build anything: ${named.join(" and ")}.`,
      detail:
        choosable.length > 1
          ? "Choosing the exact package below re-reads the datasheet for it, which usually finds them."
          : "A read varies: the same document can give up its pinout on a second pass. Failing that, a different revision often does.",
      // TOLD WHAT TO DO, AND GIVEN THE MEANS. This said "reading the datasheet
      // again sometimes finds them" and put nothing on the screen to do it with.
      ...(choosable.length > 1 ? {} : { action: "re-read" as const })
    };
  }

  // NOT READY IF NOTHING ON OFFER CAN BE BUILT.
  //
  // Ahead of "which package?": a document offering several packages of which
  // NONE can be built told the user to pick one, and the Build button under it
  // stayed live. Asking somebody to choose between three things that do not work
  // is the same defect as promising "Ready to build" above them.
  if (nothingBuildable) {
    return {
      tone: "check",
      headline: "No package in this datasheet can be built yet.",
      detail:
        `All ${outcomes.size} were read, and each is short of something the footprint needs. Open a card ` +
        `to see what is missing for that package.`
    };
  }

  if (choosable.length > 1 && chosenPackage === null && part.packageType.value === null) {
    return {
      tone: "choose",
      // COUNTS WHAT WAS READ. "This datasheet describes N" asserts the list is
      // complete, and it is the list this run produced.
      headline: `Which package? ${choosable.length} were read from this datasheet.`,
      detail: "A footprint is a manufacturing instruction for one package, so this is the one choice nothing can make for you."
    };
  }

  if (needs.length > 0) {
    return {
      tone: "ask",
      headline: needs.length === 1 ? "One number is needed before this can be built." : `${needs.length} numbers are needed before this can be built.`,
      // NOT "the datasheet does not print them". We do not know that; we know we
      // did not read them. See `askForLandPattern` in `exporters.ts`.
      detail: "They were not read from this datasheet, so they are asked rather than invented."
    };
  }

  if (blockingReview > 0) {
    return {
      tone: "check",
      headline: `${blockingReview} ${blockingReview === 1 ? "value needs" : "values need"} checking first.`,
      detail: "These were read but could not be located on a page, so they cannot be signed off unchecked."
    };
  }

  return {
    tone: "ready",
    headline: "Ready to build.",
    // State the evidence policy precisely: traceability and applicable
    // consistency checks are sufficient; genuine uncertainty remains listed.
    detail:
      toCheck > 0
        ? `${toCheck} ${toCheck === 1 ? "value is" : "values are"} worth a glance. Everything else has traceable evidence and passed the applicable consistency checks.`
        : "Every output-driving value has traceable evidence and passed the applicable consistency checks."
  };
}
