/**
 * `npm run bench:model` - does the emitted model do what the datasheet says?
 *
 * This is the instrument `SPICE.md` section 8 asked for and the only one with no
 * CAD counterpart: a footprint cannot be tested without building the board, but
 * a model is executable, so we can run it and measure.
 *
 * Free. No model calls, no network. It reads cached datasheets, emits, and runs
 * ngspice.
 *
 * THIS IS THE TUNED CORPUS AND ITS NUMBER PREDICTS NOTHING. Every rule in
 * `vocab.ts` was added because a part in the list below failed. Run
 * `bench:model-holdout` for the number that means something about a stranger's
 * datasheet.
 *
 * ## An instrument that cannot fail is not a check
 *
 * `LEARNINGS.md` records four benches that were green for weeks while blind, and
 * a copper bench that could not see a land moved 0.9 mm on 66 of 80 footprints.
 * So this one ships with `--prove`, which injects a defect into every model and
 * asserts the bench goes RED. A run that cannot fail reports nothing.
 *
 *   npm run bench:model             measure the corpus
 *   npm run bench:model -- --prove  inject a defect and require the bench to fail
 *   npm run bench:model -- --confirm  ALSO take the second reading. COSTS MONEY,
 *                                     about $0.012 a part, and is the only way
 *                                     to see whether RULES.md 7 actually holds.
 */

import * as path from "node:path";
import { measurePart, report, type SpiceRow } from "./spicerun";
import { readSpend } from "../spend";
import { TUNED_CORPUS } from "./spicecorpus";

/** Re-exported so the corpus-separation test and this runner name one list. */
export const CORPUS = TUNED_CORPUS;

const CACHE = path.join(process.cwd(), ".bench-cache");

async function main(): Promise<void> {
  const prove = process.argv.includes("--prove") || process.env.FORGE_INJECT === "spice.model";
  const second = process.argv.includes("--confirm");
  // A cached second reading is reused unless this says otherwise. See spicecache.ts.
  const fresh = process.argv.includes("--fresh");
  const spendBefore = readSpend().usd;
  console.log(`\nForge SPICE model bench${prove ? "  [PROVE: a defect is injected; this run MUST go red]" : ""}`);
  console.log("TUNED corpus, amplifier-shaped parts. free: no model calls, no network.");
  console.log("This number is fitted. `bench:model-holdout` is the honest one.\n");

  const rows: SpiceRow[] = [];
  const missing: string[] = [];
  for (const part of CORPUS) {
    const row = await measurePart(part, "tuned", CACHE, { sabotage: prove, second, fresh });
    if (row) rows.push(row);
    else missing.push(part);
  }

  report(rows, { prove, second, spendBefore, missing, groupLabel: "corpus" });
}

main().catch((error) => {
  console.error("bench:model failed:", error);
  process.exit(1);
});
