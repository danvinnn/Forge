/**
 * WHICH STATES OF THE PRODUCT HAS ANYTHING EVER EXERCISED?
 *
 * ## Why this exists
 *
 * Every other bench answers "is the output right". None of them answers "have we
 * ever been in this state at all". Those are different questions, and the second
 * one is how a product ships with a whole branch nobody has run: the browser
 * bench found the application had been serving a dead page for its entire life
 * while eleven instruments were green, because none of them was asking whether
 * anyone had ever loaded it.
 *
 * ## The cell is the unit, not the datasheet
 *
 * A corpus is only "exhaustive" against a written-down list of states, so the
 * axes below are the list. One part covers several cells. The deliverable is a
 * table of cells with the parts that reach each, and **a cell with no part is
 * the finding**: it is a state the product can enter that nothing has tested.
 *
 * Adding parts until every cell has one is the point. Adding parts because the
 * total looks small is not.
 *
 * ## What it does NOT do
 *
 * It does not judge whether the output is correct. `bench:copper`,
 * `bench:outputs` and the oracles do that, and duplicating them here would be a
 * second answer to a question that already has one.
 *
 * Air-gap safe and free: replays records already on disk, no network, no model,
 * no spend. It never touches `.holdout-cache` or `.blind-cache`; importing
 * `holdout.ts` starts a measurement.
 *
 * Usage:
 *   npm run bench:states
 */

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildFootprintGeometry, createExportZip, FootprintUnavailableError, packageOptions } from "../exporters";
import { confirmations, MAX_FLAGGED } from "../confirm";
import { answersFromSettings, densityOf } from "../settings";
import { buildCachedParts } from "./oracle-match";
import { replayRecords } from "./replay";
import { BENCH_SETTINGS } from "./shipcheck";
import type { ResolvedPart } from "../types";
import { loadBenchEnv } from "./env";

loadBenchEnv();

/**
 * The axes. Each is a question the product answers differently depending on the
 * document, and each has a branch in the code behind it.
 */
const AXES = [
  "mounting",
  "arrangement",
  "thermalPad",
  "landSource",
  "packageChoice",
  "outcome",
  "flagBudget"
] as const;
type Axis = (typeof AXES)[number];

interface Row {
  part: string;
  packageType: string;
  /** One value per axis. */
  cells: Record<Axis, string>;
  pinCount: number;
  pins: number;
  /** Values that reached the output with no independent second reading. */
  flagged: number;
  /** Questions the user is asked before anything ships. */
  asked: number;
  refusal: string | null;
  ms: number;
}

function arrangementOf(part: ResolvedPart): string {
  try {
    return buildFootprintGeometry(part, densityOf(BENCH_SETTINGS)).provenance.arrangement;
  } catch {
    return "none";
  }
}

function landSourceOf(part: ResolvedPart): string {
  try {
    return buildFootprintGeometry(part, densityOf(BENCH_SETTINGS)).provenance.corroboration.from;
  } catch {
    return "none";
  }
}

/**
 * Why the export refused, in the vocabulary `/api/export` answers in.
 *
 * Read off the thrown error rather than re-derived, so this reports the code a
 * user would actually be shown instead of a second opinion about it.
 */
function refusalOf(part: ResolvedPart): string | null {
  try {
    buildFootprintGeometry(part, densityOf(BENCH_SETTINGS));
    return null;
  } catch (error) {
    if (error instanceof FootprintUnavailableError) {
      return error.needs?.length ? "INPUT_REQUIRED" : "INCOMPLETE_EXTRACTION";
    }
    return error instanceof Error ? error.name : "unknown";
  }
}

async function main(): Promise<void> {
  // A resolved replay deliberately omits the unresolved package tables. Measure
  // this axis from the cached records consumed by the live chooser instead.
  const built = await buildCachedParts();
  if (!built) {
    console.log("No extraction model configured, so package-choice states cannot be rebuilt from cache.");
    process.exitCode = 1;
    return;
  }
  const packageChoiceByPart = new Map(
    built.map((entry) => {
      const choice = packageOptions(entry.record, answersFromSettings(BENCH_SETTINGS));
      return [
        entry.part,
        !choice.ok ? "blocked" : choice.options.length === 0 ? "none offered" : choice.options.length === 1 ? "one" : "several"
      ] as const;
    })
  );
  const rows: Row[] = [];
  for (const part of replayRecords()) {
    const startedAt = Date.now();
    let flagged = 0;
    try {
      const geometry = buildFootprintGeometry(part, densityOf(BENCH_SETTINGS));
      flagged = confirmations(part, geometry, null).flagged.length;
    } catch {
      // A part that does not build has no copper to confirm. Counted as its own
      // cell below rather than as zero flags, which would read as "clean".
      flagged = -1;
    }
    // DOES A BUNDLE ACTUALLY COME OUT? Asked by building one, not by predicting
    // it: `bench:replay` already learned that a record which resolves can still
    // fail in the emitter.
    let ships = false;
    let asked = 0;
    try {
      await createExportZip(part, "kicad", {});
      ships = true;
    } catch (error) {
      if (error instanceof FootprintUnavailableError) asked = error.needs?.length ?? 0;
    }
    rows.push({
      part: part.partNumber,
      packageType: part.packageType,
      pinCount: part.pinCount,
      pins: part.pins.length,
      flagged,
      asked,
      refusal: refusalOf(part),
      ms: Date.now() - startedAt,
      cells: {
        mounting: part.dimensions.mounting ?? "not read",
        arrangement: arrangementOf(part),
        thermalPad: part.dimensions.thermalPadLengthMm !== null ? "yes" : "no",
        landSource: landSourceOf(part),
        packageChoice: packageChoiceByPart.get(part.partNumber.split("#")[0]) ?? "not rebuilt",
        outcome: ships ? "ships unaided" : asked > 0 ? "refuses, answerable" : "refuses",
        flagBudget: flagged < 0 ? "no copper" : flagged === 0 ? "nothing flagged" : flagged > MAX_FLAGGED ? "over budget" : "some flagged"
      }
    });
  }

  // THE CELLS, and the empty ones are the finding.
  const seen = new Map<string, string[]>();
  for (const row of rows) {
    for (const axis of AXES) {
      const key = `${axis}=${row.cells[axis]}`;
      seen.set(key, [...(seen.get(key) ?? []), row.part]);
    }
  }

  const lines: string[] = [];
  lines.push("# Product state coverage");
  lines.push("");
  lines.push(`Generated ${new Date().toISOString().slice(0, 10)} by \`npm run bench:states\`. Free: no network, no model.`);
  lines.push("");
  lines.push(`${rows.length} parts replayed from records already on disk.`);
  lines.push("");
  lines.push("## Cells reached");
  lines.push("");
  lines.push("| axis | value | parts | example |");
  lines.push("| --- | --- | ---: | --- |");
  for (const axis of AXES) {
    for (const [key, parts] of [...seen].filter(([k]) => k.startsWith(`${axis}=`)).sort()) {
      lines.push(`| ${axis} | ${key.slice(axis.length + 1)} | ${parts.length} | ${parts[0]} |`);
    }
  }
  lines.push("");
  lines.push("## Every part, as a user would meet it");
  lines.push("");
  lines.push("| part | package | pins | outcome | asked | flagged | refusal | mounting | arrangement | land |");
  lines.push("| --- | --- | ---: | --- | ---: | ---: | --- | --- | --- | --- |");
  for (const row of [...rows].sort((a, b) => a.part.localeCompare(b.part))) {
    lines.push(
      `| ${row.part} | ${row.packageType} | ${row.pins}/${row.pinCount} | ${row.cells.outcome} | ${row.asked} | ` +
        `${row.flagged < 0 ? "n/a" : row.flagged} | ${row.refusal ?? ""} | ${row.cells.mounting} | ` +
        `${row.cells.arrangement} | ${row.cells.landSource} |`
    );
  }

  // AN AXIS WITH ONE VALUE IS NOT A MEASUREMENT.
  //
  // Where every part lands in the same cell, the axis is far more likely to be
  // blind than the product uniform. Measured 2026-09-03: `packageChoice` read
  // `none` for every part because resolved replays omit package tables. It now
  // calls the product's chooser over rebuilt cached records.
  const blind = AXES.filter((axis) => [...seen].filter(([k]) => k.startsWith(`${axis}=`)).length === 1);
  if (blind.length > 0) {
    lines.push("");
    lines.push("## Axes that measured nothing");
    lines.push("");
    lines.push("Every part landed in one cell. An axis with a single value is far more likely to be");
    lines.push("blind than the product uniform, so these are reported as NOT MEASURED rather than as");
    lines.push("findings about the product.");
    lines.push("");
    for (const axis of blind) lines.push(`- \`${axis}\`: one value across all ${rows.length} parts. NOT MEASURED.`);
  }

  writeFileSync(join(process.cwd(), "STATES-2026-09-03.md"), lines.join("\n") + "\n");
  writeFileSync(join(process.cwd(), "STATES-2026-09-03.json"), JSON.stringify({ generated: new Date().toISOString(), rows }, null, 2));

  console.log(`\n${rows.length} parts across ${AXES.length} axes.\n`);
  for (const axis of AXES) {
    const values = [...seen].filter(([k]) => k.startsWith(`${axis}=`));
    console.log(`  ${axis.padEnd(14)} ${values.length} value(s): ${values.map(([k, p]) => `${k.slice(axis.length + 1)}(${p.length})`).join(", ")}`);
  }
  if (blind.length > 0) {
    console.log(`\n  NOT MEASURED: ${blind.join(", ")} - one value across all parts, so the axis is blind.`);
  }
  console.log("\nWritten to STATES-2026-09-03.md and .json\n");
}

main().catch((error) => {
  console.error("bench:states failed:", error);
  process.exit(1);
});
