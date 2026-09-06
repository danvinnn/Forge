/**
 * A DISK CACHE FOR THE SPICE SECOND READING, for the benches only.
 *
 * ## Why this exists, having been argued against
 *
 * `SPICE.md` Part V decided against caching the second reading: "$0.012 a call
 * does not earn one, and caching a prompt that is still changing is a trap."
 * Measurement disproved both halves on the day the hold-out ran. A hold-out pass
 * is 21 calls, costs $0.65, and took two and a half hours because each
 * multi-image request returns in minutes. It was wanted three times in one
 * session: once for the baseline, once after the naming fix, once after the page
 * ranking. Two of those three were paid twice.
 *
 * The "prompt is still changing" objection is the reason the prompt is IN THE
 * KEY. A changed prompt does not read a stale answer; it misses, and the entry
 * for the old prompt is simply never read again.
 *
 * ## The product does NOT use this
 *
 * A user's datasheet is read fresh, every time. Caching a reading of somebody's
 * document is a decision about their data, not a performance tweak, and the
 * air-gapped deployment has nowhere to put it. This lives in `__bench__` and is
 * imported only by the bench runner.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SPEC_TABLE_PROMPT } from "../spice/prompt";
import type { ModelReadValue } from "../spice/confirm";

/** Beside the CAD benches' cache, in a directory of its own so neither reads the other's entries. */
export function spiceCacheDir(): string {
  return join(process.cwd(), ".model-cache", "spice");
}

/**
 * The key. Everything that can change the answer is in it: the prompt, the
 * document's bytes, and which pages were rendered.
 *
 * The DOCUMENT and not the part number, because a corpus file can be replaced
 * by a corrected one under the same name, and a cache that keyed on the name
 * would go on answering for the document that is no longer there.
 */
function keyFor(pdfBytes: ArrayBuffer, pages: number[]): string {
  return createHash("sha256")
    .update(SPEC_TABLE_PROMPT)
    .update(Buffer.from(pdfBytes))
    .update(pages.join(","))
    .digest("hex");
}

export interface CachedReading {
  values: ModelReadValue[] | null;
  unavailable: string | null;
  pages: number[];
}

export function readCached(pdfBytes: ArrayBuffer, pages: number[]): CachedReading | null {
  const file = join(spiceCacheDir(), `${keyFor(pdfBytes, pages)}.json`);
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, "utf8")) as CachedReading;
  } catch {
    // A half-written entry is not an answer. Miss, and it is overwritten.
    return null;
  }
}

/**
 * Stores a reading.
 *
 * A reading that was UNAVAILABLE is not stored. Caching "the spend ceiling was
 * reached" or "the model's reply was not the requested JSON" would make one bad
 * afternoon permanent, and the next run would report a corroboration failure
 * that had already been fixed.
 */
export function writeCached(pdfBytes: ArrayBuffer, pages: number[], reading: CachedReading): void {
  if (reading.values === null) return;
  const dir = spiceCacheDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${keyFor(pdfBytes, pages)}.json`), JSON.stringify(reading));
}

/** How many entries are on this machine, for the run header. */
export function spiceCacheSize(): number {
  const dir = spiceCacheDir();
  if (!existsSync(dir)) return 0;
  try {
    return readdirSync(dir).filter((name) => name.endsWith(".json")).length;
  } catch {
    return 0;
  }
}
