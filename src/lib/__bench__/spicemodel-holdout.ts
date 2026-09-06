/**
 * `npm run bench:model-holdout` - the only SPICE number that predicts anything.
 *
 * `bench:model` reads 90% on ten datasheets that every rule in `vocab.ts` was
 * fitted to. This project has paid twice to learn what that is worth: the
 * extraction parser read 69% tuned and 49% hold-out, retrieval 95% and 87%.
 *
 * The corpus, and the rule that makes the number mean anything, live in
 * `spice/__bench__/holdout-corpus.ts`. Read that header before touching this.
 * The short version: NOTHING HERE MAY EVER BE TUNED AGAINST. If a miss needs
 * diagnosing, the finding is the CLASS of failure, not the part.
 *
 *   npm run bench:model-holdout -- --fetch    fetch what is missing (network, free)
 *   npm run bench:model-holdout               measure (free, offline)
 *   npm run bench:model-holdout -- --prove    inject a defect; this MUST go red
 *   npm run bench:model-holdout -- --confirm  take the second reading. COSTS
 *                                             MONEY, about $0.012 a part. By
 *                                             default this uses the exact
 *                                             minimum risk-covering panel.
 *   npm run bench:model-holdout -- --confirm --all
 *                                             pay for the full census.
 *   npm run bench:model-holdout -- --gate     enforce the hold-out coverage floor.
 *   npm run bench:model-holdout -- --parts=A,B measure only named hold-out
 *                                             parts when testing one mechanism.
 *
 * Deliberately not a test. It reads a cache that is not in the repository, and
 * gating merges on a network measurement makes CI flaky for reasons unrelated to
 * the change under review.
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { checkFetchedDatasheet } from "./fetchcheck";
import { measurePart, pct, report, type SpiceRow } from "./spicerun";
import { TUNED_CORPUS } from "./spicecorpus";
import { readSpend } from "../spend";
import {
  AMPLIFIER_HOLDOUT,
  REGULATOR_HOLDOUT,
  SPICE_HOLDOUT_CACHE_DIR,
  spiceHoldoutCachePath,
  type HoldoutPart
} from "../spice/__bench__/holdout-corpus";
import { minimumCoveragePanel, uncoveredCells } from "../spice/__bench__/coverage";

/**
 * BOTH HOLD-OUTS, MEASURED BY ONE RUNNER.
 *
 * The regulator list is its own array in the corpus file because it was written
 * on its own day under its own rule, and merging the two THERE would blur which
 * parts were chosen before which class existed. Merging them HERE is the
 * opposite: a second runner would be a second place to fix, and the two would
 * drift on the day one of them gained a flag the other did not.
 *
 * `klass` carries through to the per-class breakdown at the end, which is the
 * number that says whether a class generalises rather than whether the average
 * happens to look healthy.
 */
const HOLDOUT: HoldoutPart[] = [
  ...AMPLIFIER_HOLDOUT,
  ...REGULATOR_HOLDOUT.map((part) => ({ ...part, klass: "ldo" as const }))
];

/** We are an uninvited client of a dozen vendor hosts. Same delay as the others. */
const FETCH_DELAY_MS = 750;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * A datasheet the CAD corpus already holds, for a part retrieval cannot find.
 *
 * Ten of the 28 here do not resolve through the commercial chain at all, and a
 * part we never fetched says nothing about the reader: it just shrinks the
 * sample. Where the same public document is already on this machine, using it
 * measures more of the corpus and biases nothing.
 *
 * THIS IS NOT A LICENCE TO TUNE. `.bench-cache` is the CAD corpus, fitted for
 * footprints; not one rule in `vocab.ts` was written against a specification
 * table in it. What the hold-out rule forbids is FITTING against these parts,
 * and copying a file does not do that. The separation test still refuses any
 * part named in both corpus lists.
 *
 * The same gate every corpus write goes through applies, so a document for the
 * wrong device cannot enter this way either.
 */
async function borrowFromCadCache(part: HoldoutPart): Promise<string> {
  const source = join(process.cwd(), ".bench-cache", `${part.partNumber.replace(/[^A-Za-z0-9._-]/g, "_")}.pdf`);
  if (!existsSync(source)) return "not found";
  const bytes = readFileSync(source);
  const verdict = await checkFetchedDatasheet(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
    part.partNumber
  );
  if (!verdict.ok) return `not found (a file of that name exists in .bench-cache and ${verdict.why})`;
  copyFileSync(source, spiceHoldoutCachePath(part.partNumber));
  return "";
}

/**
 * NOBODY IS WAITING FOR THIS ONE.
 *
 * The resolver chain gives up after 12 seconds, which is right for a person who
 * has typed a part number: it is better to say no quickly than to be slow and
 * then say no. Assembling a corpus is not that. Measured on the first fetch of
 * this list, most of the misses logged `budgetExhausted: true` - the chain ran
 * out of TIME rather than out of places to look.
 *
 * Raised here and nowhere else. The product keeps its 12 seconds, and
 * `bench:retrieval-holdout` measures retrieval under the budget a user actually
 * gets. What this changes is how much of the amplifier corpus exists to score
 * the READER on, which is the only thing this bench is for.
 */
const FETCH_BUDGET_MS = 60_000;

async function fetchToCache(part: HoldoutPart): Promise<string> {
  // Imported lazily, matching the air-gap discipline the rest of the layer
  // follows: this file must be loadable without pulling the network subtree in.
  process.env.FORGE_CHAIN_BUDGET_MS = String(FETCH_BUDGET_MS);
  const { makeResolver } = await import("../retrieval/factory");
  const resolver = await makeResolver("commercial");
  if (!resolver) return borrowFromCadCache(part);
  try {
    const ref = await resolver.resolve(part.partNumber, { manufacturer: part.manufacturer });
    if (!ref) return borrowFromCadCache(part);
    // The hold-out is the number this project quotes as its honest one, so a
    // document for the wrong device is worse here than anywhere: it scores as a
    // read of a part we never asked for. Same gate as every other corpus.
    const verdict = await checkFetchedDatasheet(ref.bytes as ArrayBuffer, part.partNumber);
    if (!verdict.ok) return `REFUSED ${verdict.why}`;
    writeFileSync(spiceHoldoutCachePath(part.partNumber), Buffer.from(ref.bytes));
    return "";
  } catch (error) {
    const borrowed = await borrowFromCadCache(part);
    if (borrowed === "") return "";
    return `ERROR ${error instanceof Error ? error.message.slice(0, 70) : String(error)}`;
  }
}

/**
 * THE GUARD.
 *
 * A hold-out that quietly scores a tuned part reads high forever and never looks
 * broken; three parts sat in both CAD corpora for months. The rule was written
 * in a comment and enforced nowhere, so it is enforced here, and it refuses to
 * run rather than warning.
 */
function assertSeparate(): void {
  const tuned = new Set(TUNED_CORPUS.map((p) => p.trim().toUpperCase()));
  const overlap = HOLDOUT.map((p) => p.partNumber).filter((p) => tuned.has(p.trim().toUpperCase()));
  if (overlap.length > 0) {
    console.error(`\nREFUSING TO RUN: ${overlap.join(", ")} are in the tuned corpus AND counted here as unseen.`);
    console.error("A contaminated hold-out reads high forever and never looks broken.");
    process.exit(1);
  }
}

async function main(): Promise<void> {
  assertSeparate();
  const prove = process.argv.includes("--prove") || process.env.FORGE_INJECT === "spice.model-holdout";
  const second = process.argv.includes("--confirm");
  // A cached second reading is reused unless this says otherwise. See spicecache.ts.
  const fresh = process.argv.includes("--fresh");
  const fetch = process.argv.includes("--fetch");
  const gate = process.argv.includes("--gate");
  const requested = new Set(
    (process.argv.find((argument) => argument.startsWith("--parts="))?.slice("--parts=".length) ?? "")
      .split(",")
      .map((part) => part.trim().toUpperCase())
      .filter(Boolean)
  );
  const paidMinimum = second && !process.argv.includes("--all");
  const selected = requested.size === 0
    ? paidMinimum ? minimumCoveragePanel(HOLDOUT) : HOLDOUT
    : HOLDOUT.filter((part) => requested.has(part.partNumber.toUpperCase()));
  if (requested.size > 0 && selected.length !== requested.size) {
    const known = new Set(HOLDOUT.map((part) => part.partNumber.toUpperCase()));
    const unknown = [...requested].filter((part) => !known.has(part));
    console.error(`Unknown hold-out part${unknown.length === 1 ? "" : "s"}: ${unknown.join(", ")}`);
    process.exit(2);
  }
  const spendBefore = readSpend().usd;

  if (!existsSync(SPICE_HOLDOUT_CACHE_DIR)) mkdirSync(SPICE_HOLDOUT_CACHE_DIR, { recursive: true });

  console.log(`\nForge SPICE model HOLD-OUT${prove ? "  [PROVE: a defect is injected; this run MUST go red]" : ""}`);
  console.log(
    `${AMPLIFIER_HOLDOUT.length} amplifier-shaped parts and ${REGULATOR_HOLDOUT.length} regulators, ` +
      "chosen before any was opened, never tuned against."
  );
  console.log("A miss here is a CLASS to fix, never a part to special-case.\n");
  if (paidMinimum) {
    console.log(`Paid second reading: exact minimum coverage panel, ${selected.length}/${HOLDOUT.length} parts.`);
    console.log(`Risk cells left uncovered: ${uncoveredCells(selected).length}. Pass --all to pay for the full census.\n`);
  }
  if (requested.size > 0) console.log(`Targeted mechanism check: ${selected.map((part) => part.partNumber).join(", ")}\n`);

  if (fetch) {
    const failures: string[] = [];
    for (const part of selected) {
      if (existsSync(spiceHoldoutCachePath(part.partNumber))) {
        process.stdout.write("=");
        continue;
      }
      const why = await fetchToCache(part);
      process.stdout.write(why === "" ? "." : "x");
      if (why !== "") failures.push(`${part.partNumber}: ${why}`);
      await sleep(FETCH_DELAY_MS);
    }
    const got = selected.filter((p) => existsSync(spiceHoldoutCachePath(p.partNumber))).length;
    console.log(`\ncached ${got}/${selected.length}`);
    // Named, because a retrieval miss is not a reader miss and the report must
    // never let one read as the other.
    if (failures.length > 0) {
      console.log("\nCould not fetch, NOT scored:");
      for (const line of failures) console.log(`  ${line}`);
    }
    console.log("");
  }

  const rows: SpiceRow[] = [];
  const missing: string[] = [];
  for (const part of selected) {
    const row = await measurePart(part.partNumber, part.klass, SPICE_HOLDOUT_CACHE_DIR, { sabotage: prove, second, fresh });
    if (row) rows.push(row);
    else missing.push(part.partNumber);
  }

  report(rows, { prove, second, spendBefore, missing, groupLabel: "class", allowNoChecks: gate });

  // By CLASS, because the classes after op-amps are what this feature grows into
  // and a single average hides which of them works.
  const classes = new Map<string, SpiceRow[]>();
  for (const row of rows) classes.set(row.group, [...(classes.get(row.group) ?? []), row]);
  console.log("by device class:");
  for (const [name, list] of classes) {
    console.log(`  ${name.padEnd(18)}${String(list.filter((r) => r.built).length)}/${list.length}  ${pct(list.filter((r) => r.built).length, list.length)}`);
  }

  // THE STOP CONDITION, stated in the plan and checked by the instrument rather
  // than by whoever reads the output. Not an exit code: a low number here is a
  // finding, not a broken build.
  // A required block selection is a successful, safe path through the product:
  // the model exists, but the datasheet cannot tell Forge which grade or test
  // condition the user is holding. Count it as buildable, never as automatic.
  // Only a shared-policy refusal is excluded.
  const releasePaths = rows.filter((row) => row.built && row.releaseOutcome !== "refused");
  const builtRate = rows.length === 0 ? 0 : releasePaths.length / rows.length;
  console.log("");
  if (builtRate < 0.5) {
    console.log(`STOP: ${pct(releasePaths.length, rows.length)} with a safe release path is below the 50% the plan set as the point to stop and`);
    console.log("report classes rather than build anything further on this reader.");
  }

  if (gate) {
    const actionable = rows.filter((row) =>
      (row.built && row.releaseOutcome !== "refused") || row.wouldBuildIfAsked
    ).length;
    const failures: string[] = [];
    if (missing.length > 0) failures.push(`${missing.length} hold-out documents are not cached`);
    if (uncoveredCells(selected).length > 0) failures.push(`${uncoveredCells(selected).length} declared risk cells are uncovered`);
    // The exact paid panel is a SET COVER, not a prevalence sample: it
    // intentionally contains rare hard strata, so its percentage is not an
    // estimate of product success. Rates are gated only on the full frozen
    // census; the paid panel gates independent-reading availability and every
    // declared risk cell.
    if (!paidMinimum && builtRate < 0.5) failures.push(`safe model build rate ${pct(releasePaths.length, rows.length)} is below 50%`);
    if (!paidMinimum && (rows.length === 0 || actionable / rows.length < 0.8)) {
      failures.push(`safe completion rate ${pct(actionable, rows.length)} is below 80%`);
    }
    if (rows.some((row) => row.fail > 0)) failures.push("at least one emitted model fails conformance");
    if (rows.some((row) => row.releaseOutcome === "refused" && row.fail === 0 && row.built)) {
      failures.push("at least one generated model exceeds the shared assurance budget");
    }
    if (rows.reduce((total, row) => total + row.pass + row.fail, 0) === 0) {
      failures.push("no measurable conformance check ran; install ngspice or set NGSPICE_BIN");
    }
    if (rows.some((row) => row.misclassified)) failures.push("at least one model disagrees with the frozen corpus class");
    if (second && rows.some((row) => row.secondReadingUnavailable !== null)) {
      failures.push("the paid second reading was unavailable for at least one selected document");
    }
    if (failures.length > 0) {
      console.error("\nCOVERAGE GATE: FAILED");
      for (const failure of failures) console.error(`  - ${failure}`);
      process.exitCode = 1;
    } else {
      console.log(
        paidMinimum
          ? `COVERAGE GATE: PASS — every declared risk cell received the independent reading.`
          : `COVERAGE GATE: PASS — ${pct(actionable, rows.length)} safe completion, every declared risk cell covered.`
      );
    }
  }
}

main().catch((error) => {
  console.error("bench:model-holdout failed:", error);
  process.exit(1);
});
