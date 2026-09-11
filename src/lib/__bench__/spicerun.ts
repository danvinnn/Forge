/**
 * THE SPICE MODEL INSTRUMENT, shared by the tuned bench and the hold-out bench.
 *
 * One file, because `LEARNINGS.md` calls "fixed in one place, not the other" the
 * dominant failure mode of this project, and two corpora scored by two copies of
 * a measurement is that shape exactly: the copies drift, and the drift shows up
 * as a generalisation gap that is really a bench difference.
 *
 * So the hold-out is not a second instrument. It is this one, pointed at a
 * different directory. The ONLY thing the two runners set differently is which
 * folder the PDFs come from and what the header says.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { buildModel } from "../spice/build";
import { assessModelAssurance } from "../spice/assurance";
import type { AssuranceOutcome } from "../assurance";
import { supportedCorners } from "../spice/model";
import { readWithModel } from "../spice/read-model";
import { readCached, spiceCacheSize, writeCached } from "./spicecache";
import { readSpend } from "../spend";
import { loadBenchEnv } from "./env";

// The benches run under plain tsx, which does not read `.env.local`. Without
// this, `--confirm` reports every part as "no second reading was taken" and
// spends nothing, which is indistinguishable in the output from a reading that
// was taken and agreed with nothing. `env.ts` was written for exactly this
// failure and this bench never imported it: "fixed in one place, not the other".
loadBenchEnv();

/**
 * The voltage the bench answers with, and it is a PROBE rather than a value.
 *
 * Deliberately not a plausible rail: 3.3 V would let a wrong answer look right
 * in a diff. Nothing is scored from the model this builds - see
 * `wouldBuildIfAsked` - so the only property that matters is that it is a legal
 * answer the route would accept.
 */
const PLACEHOLDER_OUTPUT_V = 7.77;

export interface SpiceRow {
  part: string;
  /** Whatever the corpus groups by: a device class, a vendor, a family. */
  group: string;
  parameters: number;
  corners: number;
  built: boolean;
  /** The same decision the public model route applies before releasing bytes. */
  releaseOutcome: AssuranceOutcome;
  pass: number;
  fail: number;
  unverifiable: number;
  alternatives: number;
  note: string;
  /** Descriptions read from a spec table that matched no known parameter. */
  unnamed: string[];
  /** RULES.md 7: did a second reading agree? Null when none was taken. */
  confirmed: boolean | null;
  confirmDetail: string;
  /**
   * Why no second reading happened, when none did.
   *
   * Separate from `confirmed` on purpose. "We could not ask" and "we asked and
   * the readings did not agree" are different results, and a bench that renders
   * them the same way is how a missing API key reads as a corroboration
   * failure for a whole corpus.
   */
  secondReadingUnavailable: string | null;
  /**
   * WHY nothing was built, as a slug rather than a sentence.
   *
   * The hold-out's stop condition is stated in classes, not parts, so the
   * grouping has to exist in the instrument. Reading 28 refusal sentences and
   * sorting them by eye is how a corpus gets tuned against by accident.
   */
  because: string | null;
  /** Which class it was built as, decided from what the document states. */
  builtAs: string;
  /**
   * REFUSED, BUT ONE ANSWER AWAY.
   *
   * A refusal and a question are not the same outcome and a bench that scores
   * them alike understates the product by exactly the parts it would have
   * built. Seven of fourteen regulator datasheets state no nominal output
   * voltage anywhere, because on a fixed LDO the voltage is an ordering option;
   * `/api/model` asks for that one number and builds.
   *
   * Counted SEPARATELY from `built`, and its conformance checks are NOT
   * counted at all: a model built from a number the bench invented reproduces
   * that number perfectly, and scoring it would be the bench marking its own
   * homework.
   */
  wouldBuildIfAsked: boolean;
  /**
   * The corpus said one kind of part and the reader built another.
   *
   * A DISAGREEMENT, not a failure. The corpus's class was written down before
   * the datasheet was opened, so it is an independent witness worth having -
   * and it is a hand-written oracle, so it can also simply be wrong.
   */
  misclassified: boolean;
  /**
   * Why checks could not be made, and why any failed, in the verifier's own
   * words.
   *
   * A count of `unverifiable` is not a finding. Two references built cleanly and
   * scored 0 of 9, and the number alone could not say whether that was the
   * datasheets being silent or the rig being wrong.
   */
  reasons: string[];
  /** Rows the model named that still could not become a parameter, and why. */
  blockedNames: string[];
  /** How many specification rows were read at all, buildable or not. */
  rowsRead: number;
  /**
   * Parameters the model NAMED that our vocabulary could not, and that the
   * model was then built from.
   *
   * Printed per part, because this is the mechanism that turns a refusal into a
   * shipped model and it must be visible rather than inferred from a total
   * going up. Each one also reaches the user as a flag.
   */
  modelNamed: string[];
}

export function pct(n: number, d: number): string {
  return d === 0 ? "n/a" : `${Math.round((n / d) * 100)}%`;
}

export interface MeasureOptions {
  /** Injects a defect into every model. The run MUST then go red. */
  sabotage: boolean;
  /** Take the paid second reading of the rendered page. */
  second: boolean;
  /** Ignore any cached reading and pay for a fresh one. */
  fresh?: boolean;
}

/**
 * Builds one part's model and measures it. Returns null when the PDF is absent,
 * which the caller reports as "not cached" rather than as a failure to build:
 * a document we never fetched says nothing about the reader.
 */
export async function measurePart(
  part: string,
  group: string,
  cacheDir: string,
  options: MeasureOptions
): Promise<SpiceRow | null> {
  const file = path.join(cacheDir, `${part.replace(/[^A-Za-z0-9._-]/g, "_")}.pdf`);
  if (!fs.existsSync(file)) return null;
  // A Node Buffer can be a view into a larger pooled ArrayBuffer. Passing its
  // backing store directly made the PDF start at the wrong byte whenever
  // `byteOffset` was non-zero; two Renesas hold-out documents consequently
  // reported zero rows even though the production File path read both. Slice
  // the exact view so the bench measures the document it names.
  const cachedPdf = fs.readFileSync(file);
  const bytes = cachedPdf.buffer.slice(
    cachedPdf.byteOffset,
    cachedPdf.byteOffset + cachedPdf.byteLength
  ) as ArrayBuffer;
  let unavailable: string | null = options.second ? "the second reading was never attempted" : null;
  const result = await buildModel(
    bytes,
    part,
    undefined,
    options.second
      ? async (pages) => {
          // CACHED, for the bench only. A hold-out pass is 21 multi-image calls
          // and takes hours; the same pass is wanted again after every change
          // to anything upstream of it. The prompt is in the key, so a reworded
          // prompt misses rather than reading a stale answer.
          const cached = options.fresh ? null : readCached(bytes, pages);
          if (cached) {
            unavailable = cached.unavailable;
            return cached.values;
          }
          const reading = await readWithModel(bytes, pages);
          unavailable = reading.unavailable;
          writeCached(bytes, pages, { values: reading.values, unavailable: reading.unavailable, pages: reading.pages });
          return reading.values;
        }
      : undefined
  );

  const unnamed = [...new Set(result.rows.filter((r) => !r.key).map((r) => r.parameter))];

  if (!result.block || !result.subckt) {
    // REFUSED, OR ONE QUESTION AWAY FROM BUILDING?
    //
    // `/api/model` offers exactly one value for a user to supply - a fixed
    // device's nominal output, which an LDO or fixed reference family
    // datasheet may state only as an ordering option. The bench has no user, so
    // it answers with a placeholder purely to find out WHICH refusal this is.
    //
    // The rebuilt model is thrown away. Its conformance checks would compare
    // the model against a number this file made up, and counting them would be
    // the bench marking its own homework.
    let wouldBuildIfAsked = false;
    if ((result.refusalBecause ?? "").split(/[:+]/).includes("outputVoltage")) {
      // When the document lists fixed options, probe those actual choices. A
      // deliberately odd placeholder is valid only when the document lists no
      // options. Nothing from the rebuilt model is scored; this establishes
      // only that at least one authoritative answer unlocks the path.
      const candidates = result.outputVoltageOptions.length > 0
        ? result.outputVoltageOptions
        : [PLACEHOLDER_OUTPUT_V];
      for (const outputVoltage of candidates) {
        if ((await buildModel(bytes, part, undefined, undefined, { outputVoltage })).subckt !== null) {
          wouldBuildIfAsked = true;
          break;
        }
      }
    }
    return {
      part,
      group,
      parameters: 0,
      corners: 0,
      built: false,
      releaseOutcome: wouldBuildIfAsked ? "needs-input" : "refused",
      wouldBuildIfAsked,
      // Nothing was built, so there is no class to disagree with.
      misclassified: false,
      pass: 0,
      fail: 0,
      unverifiable: 0,
      alternatives: result.alternatives.length,
      note: result.refusal ?? "refused",
      unnamed,
      confirmed: null,
      confirmDetail: "",
      builtAs: "-",
      reasons: [],
      blockedNames: result.blockedNames.map((b) => `${b.key} (${b.unit ?? "no unit"}): ${b.why}`),
      // Taken as DATA from the build rather than recovered from its sentence.
      // A bench that greps its own product's prose measures the prose.
      because: result.rows.length === 0 ? "no-spec-table-read" : result.refusalBecause ?? "unknown",
      rowsRead: result.rows.length,
      modelNamed: result.named.map((n) => n.key),
      secondReadingUnavailable: unavailable
    };
  }

  let report = result.report!;
  const modelCorners = supportedCorners(result.block, result.deviceClass!);
  if (options.sabotage) {
    // A DEFECT EVERY CLASS CAN CARRY.
    //
    // Halve something INSIDE the model without touching what the model claims
    // the datasheet said. A bench that still passes is not measuring
    // conformance, it is measuring that a file parses.
    //
    // Per class, because the amplifier's injection is a parameter a reference
    // does not have: `--prove` reported "the bench can go red" while the whole
    // reference class went through it untouched. An instrument that cannot fail
    // on half its output is not a check on that half.
    if (result.deviceClass?.id === "comparator") {
      const { verifyComparator } = await import("../spice/comparator");
      const broken = result.subckt.replace(/^\.param propagationDelay=\{(.+)\}$/m, ".param propagationDelay={($1)*0.5}");
      report = await verifyComparator(broken, result.block, part, modelCorners);
    } else if (result.deviceClass?.id === "ldo") {
      const { verifyLdo } = await import("../spice/ldo");
      // The DROPOUT, because it is what makes this class not the reference. A
      // sabotage aimed at the output voltage would go red here for a reason
      // that has nothing to do with the pass element.
      const broken = result.subckt.replace(/^\.param dropoutVoltage=\{(.+)\}$/m, ".param dropoutVoltage={($1)*0.5}");
      report = await verifyLdo(broken, result.block, part, modelCorners);
    } else if (result.deviceClass?.id === "reference") {
      const { verifyReference } = await import("../spice/reference");
      const broken = result.subckt.replace(/^\.param outputVoltage=\{(.+)\}$/m, ".param outputVoltage={($1)*0.5}");
      report = await verifyReference(broken, result.block, part, modelCorners);
    } else if (result.deviceClass?.id === "instrumentation") {
      const { verifyInstrumentation } = await import("../spice/instrumentation");
      // K is the defining evidence for this class. Halving it must be observed
      // through the external resistor, or the rig is not checking the gain law.
      const broken = result.subckt.replace(/^\.param gainResistance=\{(.+)\}$/m, ".param gainResistance={($1)*0.5}");
      report = await verifyInstrumentation(broken, result.block, part, modelCorners);
    } else {
      const { verify } = await import("../spice/verify");
      const broken = result.subckt.replace(/\.param GBW_TRIM=[\d.e-]+/, ".param GBW_TRIM=0.5");
      report = await verify(broken, result.block, part, modelCorners);
    }
  }

  const assurance = assessModelAssurance({
    confirmations: result.confirmations,
    checks: report.checks,
    selectionRequired: result.blockChosenBy === "first-of-several"
  });
  return {
    part,
    group,
    parameters: Object.keys(result.block.values).length,
    corners: modelCorners.length,
    built: true,
    releaseOutcome: assurance.outcome,
    pass: report.checks.filter((c) => c.verdict === "pass").length,
    fail: report.checks.filter((c) => c.verdict === "fail").length,
    unverifiable: report.checks.filter((c) => c.verdict === "unverifiable").length,
    alternatives: result.alternatives.length,
    note: report.simulatorMissing ? "ngspice unavailable" : "",
    unnamed,
    confirmed: options.second ? result.confirmations?.items.find((i) => i.id === "parameters")?.state === "confirmed" : null,
    confirmDetail: result.confirmations?.items.find((i) => i.id === "parameters")?.detail ?? "",
    wouldBuildIfAsked: false,
    builtAs: result.deviceClass?.id ?? "-",
    // THE CORPUS SAID WHAT KIND OF PART THIS IS, BEFORE ANYONE OPENED IT.
    //
    // That expectation was sitting unused in the corpus file while both voltage
    // references in the hold-out were quietly built as regulators - correct
    // values, correct checks, the wrong word on the receipt and on the symbol.
    // The hold-out already knew and nothing asked it.
    //
    // Reported as a DISAGREEMENT rather than a failure: the hand-written class
    // is an oracle and an oracle can be wrong. `LEARNINGS.md` records a whole
    // pass spent chasing four "defects" that were the oracle's.
    misclassified: result.deviceClass !== null && group !== "tuned" && result.deviceClass.id !== group,
    blockedNames: result.blockedNames.map((b) => `${b.key} (${b.unit ?? "no unit"}): ${b.why}`),
    // The PARAMETER is part of the finding. A bare "measured 0.0000473 against
    // a stated 0.0000500" cannot be acted on without knowing what was measured.
    reasons: [
      ...new Set(
        report.checks
          .filter((c) => c.verdict !== "pass" && c.reason)
          .map((c) => `${c.verdict === "fail" ? "FAIL" : "----"} ${c.parameter} ${c.corner}: ${c.reason!}`)
      )
    ],
    because: null,
    rowsRead: result.rows.length,
    modelNamed: result.named
      .filter((n) => Object.keys(result.block!.values).includes(n.key))
      .map((n) => n.key),
    secondReadingUnavailable: unavailable
  };
}

/**
 * Prints the table, the totals, the vocabulary audit and the `--prove` verdict.
 *
 * Exits the process on a result that is not a pass, including the two shapes
 * that LOOK like a pass and are not: no data at all, and nothing checkable.
 */
export function report(
  rows: SpiceRow[],
  options: { prove: boolean; second: boolean; spendBefore: number; missing: string[]; groupLabel: string; allowNoChecks?: boolean }
): void {
  if (options.second) console.log(`Second readings: ${spiceCacheSize()} cached on this machine. --fresh to ignore them.\n`);
  console.log(`part                 ${options.groupLabel.padEnd(16)}built as    params  corners  pass  fail  unverif`);
  console.log("-".repeat(92));
  for (const r of rows) {
    console.log(
      `${r.part.padEnd(21)}${r.group.slice(0, 15).padEnd(16)}${(r.built ? r.builtAs : "NO").padEnd(12)}` +
        `${String(r.parameters).padStart(4)}${String(r.corners).padStart(9)}${String(r.pass).padStart(6)}${String(r.fail).padStart(6)}` +
        `${String(r.unverifiable).padStart(9)}  ${(r.built ? `${r.releaseOutcome}${r.note ? `; ${r.note}` : ""}` : (r.because ?? "")).slice(0, 28)}`
    );
  }

  const built = rows.filter((r) => r.built);
  const totalPass = rows.reduce((n, r) => n + r.pass, 0);
  const totalFail = rows.reduce((n, r) => n + r.fail, 0);
  const totalUnverifiable = rows.reduce((n, r) => n + r.unverifiable, 0);
  console.log("-".repeat(92));
  console.log(`${"TOTAL".padEnd(21)}${String(built.length).padStart(4)} built of ${rows.length}    pass ${totalPass}  fail ${totalFail}  unverifiable ${totalUnverifiable}`);
  console.log(`\nmodels built: ${pct(built.length, rows.length)}   checks passing: ${pct(totalPass, totalPass + totalFail)} of those that could be checked`);

  // A REFUSAL AND A QUESTION ARE NOT THE SAME OUTCOME, and reporting them as
  // one understates the product by exactly the parts it would have built.
  //
  // Printed as its own line rather than folded into the first, because the two
  // numbers answer different questions: the first is what this product does
  // with a datasheet and nothing else, and the second is what it does with a
  // datasheet and one number an engineer has in front of them.
  const asked = rows.filter((r) => r.wouldBuildIfAsked);
  if (asked.length > 0) {
    console.log(
      `plus ${asked.length} more after ONE supplied value: ${pct(built.length + asked.length, rows.length)} ` +
        `(${asked.map((r) => r.part).join(", ")})`
    );
    console.log("Their checks are NOT counted: a model built from a number this bench invented reproduces it perfectly.");
  }

  // A part with no cached PDF is not a miss, and blurring the two would let a
  // failed fetch read as a reader failure. Named, never counted.
  if (options.missing.length > 0) {
    console.log(`\nNot cached (${options.missing.length}), NOT counted as misses: ${options.missing.join(", ")}`);
  }

  // A second reading that could not be taken is evidence even when no model
  // was buildable. Print it before the no-data guard, or the process exits with
  // the reason hidden and an unmade external call looks like a failed attempt.
  if (options.second) {
    const blocked = rows.filter((r) => r.secondReadingUnavailable !== null);
    if (blocked.length > 0) {
      console.log(`\nNO SECOND READING was possible for ${blocked.length} of ${rows.length} parts. This is not a corroboration result:`);
      const why = new Map<string, number>();
      for (const r of blocked) why.set(r.secondReadingUnavailable!, (why.get(r.secondReadingUnavailable!) ?? 0) + 1);
      for (const [reason, n] of why) console.log(`  ${String(n).padStart(2)}x  ${reason}`);
      if (blocked.length === rows.length) {
        console.log("\nEvery part. Nothing about RULES.md 7 was measured by this run.");
      }
    }
  }

  // A row of zeros is not a pass. Say so rather than printing a clean table.
  if (rows.length === 0) {
    console.log("\nNO DATA: no cached datasheets found. This is not a pass.");
    process.exit(1);
  }
  if (totalPass + totalFail === 0) {
    console.log("\nNO DATA: nothing could be checked. This is not a pass.");
    if (!options.allowNoChecks) process.exit(1);
  }

  // The refusals, grouped by MECHANISM. This is the output a hold-out run is
  // read for: a class is something to fix, a part is something to tune against.
  // WHY A CHECK DID NOT PASS, in the verifier's own words and grouped.
  //
  // `unverifiable` is an honest verdict and a large count of it is still a
  // finding: it is the difference between a datasheet that is silent and a rig
  // that cannot measure. Printing the reasons is what tells them apart.
  const reasons = new Map<string, string[]>();
  for (const r of rows) for (const reason of r.reasons) reasons.set(reason, [...(reasons.get(reason) ?? []), r.part]);
  if (reasons.size > 0) {
    // A FAILURE IS NOT A LONG UNVERIFIABLE, and sorting the two together by
    // count buried the only three failures in the corpus under ten copies of
    // "the datasheet does not state enough of the test circuit". A model
    // disagreeing with its own datasheet is the finding this bench exists to
    // surface; an honest "cannot measure" is context.
    //
    // So every FAIL is printed, always, and the unverifiables fill what is
    // left. Truncating the interesting half to keep the output short is how an
    // instrument stops being able to report the thing it is for.
    const ordered = [...reasons.entries()].sort((a, b) => {
      const failing = (reason: string) => (reason.startsWith("FAIL") ? 1 : 0);
      return failing(b[0]) - failing(a[0]) || b[1].length - a[1].length;
    });
    const failures = ordered.filter(([reason]) => reason.startsWith("FAIL"));
    const shown = [...failures, ...ordered.filter(([reason]) => !reason.startsWith("FAIL")).slice(0, 10)];
    console.log("\nWhy checks did not pass:\n");
    for (const [reason, parts] of shown) {
      console.log(`  ${String(parts.length).padStart(2)}x  ${reason.slice(0, 110)}`);
      console.log(`      ${[...new Set(parts)].join(", ").slice(0, 76)}`);
    }
  }

  // WHAT EACH PART WAS BUILT AS. A class chosen wrongly produces a model that
  // simulates cleanly and describes a different kind of device, which no
  // conformance check can catch: it verifies against the numbers it chose.
  const builtAs = new Map<string, number>();
  for (const r of built) builtAs.set(r.builtAs, (builtAs.get(r.builtAs) ?? 0) + 1);
  if (builtAs.size > 0) {
    console.log(`\nBuilt as: ${[...builtAs.entries()].map(([id, n]) => `${n} ${id}`).join(", ")}`);
  }

  // AND WHERE THAT DISAGREES WITH WHAT THE CORPUS SAID THE PART WAS.
  //
  // The corpus records a class for every hold-out part, written down before the
  // datasheet was opened. It sat unused while both voltage references in the
  // hold-out were built as regulators: correct values, every check passing, and
  // the wrong kind of device on the receipt and on the symbol. Nothing else in
  // this product could have noticed, because a conformance check verifies
  // against the numbers the class chose.
  //
  // Printed as a disagreement to look at. The corpus class is a hand-written
  // oracle and `LEARNINGS.md` records a pass spent chasing four "defects" that
  // turned out to be the oracle's.
  const disagreed = built.filter((r) => r.misclassified);
  if (disagreed.length > 0) {
    console.log(`\nBuilt as a DIFFERENT class than the corpus expected (${disagreed.length}), for a human to settle:`);
    for (const r of disagreed) console.log(`  ${r.part.padEnd(20)} corpus says ${r.group.padEnd(16)} built as ${r.builtAs}`);
  }

  const refused = rows.filter((r) => !r.built);
  if (refused.length > 0) {
    const classes = new Map<string, string[]>();
    for (const r of refused) {
      const key = r.because ?? "unknown";
      classes.set(key, [...(classes.get(key) ?? []), r.part]);
    }
    console.log(`\nRefused (${refused.length}), by CLASS:\n`);
    for (const [name, parts] of [...classes.entries()].sort((a, b) => b[1].length - a[1].length)) {
      console.log(`  ${String(parts.length).padStart(2)}x  ${name.padEnd(28)}${parts.join(", ").slice(0, 60)}`);
    }
  }

  if (options.second) {
    // What the naming question actually bought, per part. A total that moves
    // without this is a number nobody can check.
    const namedRows = rows.filter((r) => r.modelNamed.length > 0);
    if (namedRows.length > 0) {
      console.log(`\nNamed by the rendered page where our vocabulary could not (${namedRows.length} parts).`);
      console.log("Each of these reaches the user as a flag; none of them supplied a NUMBER.\n");
      for (const r of namedRows) console.log(`  ${r.part.padEnd(16)}${r.modelNamed.join(", ")}${r.built ? "" : "  (still not enough to build)"}`);
    }

    // AND WHAT IT DID NOT BUY. A count of names going up while coverage stays
    // flat is a mechanism that produces flags and nothing else, and the only
    // way to tell that from "one gate short" is to print the gate.
    const stopped = new Map<string, string[]>();
    for (const r of rows) for (const b of r.blockedNames) stopped.set(b, [...(stopped.get(b) ?? []), r.part]);
    if (stopped.size > 0) {
      console.log("\nNamed, and STILL not usable as a parameter:\n");
      for (const [why, parts] of [...stopped.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, 10)) {
        console.log(`  ${String(parts.length).padStart(2)}x  ${why.slice(0, 78)}`);
        console.log(`      ${[...new Set(parts)].join(", ").slice(0, 76)}`);
      }
    }

    const asked = built.filter((r) => r.secondReadingUnavailable === null);
    const agreed = asked.filter((r) => r.confirmed === true).length;
    console.log(`\nRULES.md 7: ${agreed} of ${asked.length} built models WHERE A SECOND READING WAS TAKEN had both readings agree on every parameter.`);
    for (const r of asked.filter((x) => x.confirmed !== true)) {
      console.log(`  ${r.part.padEnd(14)}${r.confirmDetail.slice(0, 110)}`);
    }
    const spent = readSpend().usd - options.spendBefore;
    console.log(`\nSecond readings cost $${spent.toFixed(4)} this run. Running total $${readSpend().usd.toFixed(2)}.`);
  }

  // THE VOCABULARY AUDIT, run every time rather than when something breaks.
  //
  // Fourteen of the sixteen defects found in this design before it was built
  // were a vocabulary gap: `AVOL` missing, `SPECIFICATIONS` missing, `TYP(2)`
  // unmatched. Each cost a whole datasheet and each was found by accident.
  // Printing what the corpus says and we cannot name turns that into something
  // continuously visible.
  const unnamed = new Map<string, number>();
  for (const row of rows) for (const name of row.unnamed) unnamed.set(name, (unnamed.get(name) ?? 0) + 1);
  const recurring = [...unnamed.entries()].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]);
  if (recurring.length > 0) {
    console.log(`\nRead from a specification table and not named by the vocabulary (${unnamed.size} distinct,`);
    console.log(`showing the ${Math.min(recurring.length, 12)} that appear on more than one part):\n`);
    for (const [name, count] of recurring.slice(0, 12)) console.log(`  ${String(count).padStart(2)}x  ${name.slice(0, 62)}`);
    console.log("\nThese are KEPT on the record. A recurring one is a candidate for the");
    console.log("vocabulary, not evidence of a bug.");
  }

  if (options.prove) {
    if (totalFail === 0) {
      console.log("\nTHE BENCH DID NOT GO RED with a defect injected into every model.");
      console.log("It is not measuring conformance. Fix the bench before believing any run.");
      process.exit(1);
    }
    console.log(`\nProved: the injected defect produced ${totalFail} failures. The bench can go red.`);
  }
  console.log("");
}
