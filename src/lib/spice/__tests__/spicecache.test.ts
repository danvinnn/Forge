/**
 * The bench's cache for the second reading.
 *
 * Two properties, both of which have bitten this project elsewhere: a changed
 * prompt must MISS rather than answer from the old one, and a failure must not
 * be stored, or one bad afternoon becomes permanent.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readCached, writeCached, spiceCacheDir } from "../../__bench__/spicecache";
import { existsSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";

/** Distinct bytes per test run, so a real corpus entry is never touched. */
function bytes(seed: string): ArrayBuffer {
  const buffer = new Uint8Array(64);
  for (let i = 0; i < buffer.length; i++) buffer[i] = (seed.charCodeAt(i % seed.length) + i) % 256;
  return buffer.buffer;
}

const VALUE = [{ parameter: "Gain-bandwidth product", unit: "kHz", group: null, min: null, typ: 350, max: null }];

test("a stored reading comes back for the same document and pages", () => {
  const pdf = bytes(`forge-cache-hit-${process.pid}`);
  writeCached(pdf, [7, 8], { values: VALUE, unavailable: null, pages: [7, 8] });
  const back = readCached(pdf, [7, 8]);
  assert.ok(back);
  assert.equal(back!.values![0].typ, 350);
});

test("different PAGES are a different reading", () => {
  const pdf = bytes(`forge-cache-pages-${process.pid}`);
  writeCached(pdf, [7], { values: VALUE, unavailable: null, pages: [7] });
  assert.equal(readCached(pdf, [7, 8]), null);
});

test("a different DOCUMENT is a different reading, even at the same path", () => {
  // Keyed on the bytes and not on a part number: a corpus file can be replaced
  // by a corrected one under the same name, and a cache keyed on the name would
  // go on answering for the document that is no longer there. That is exactly
  // how three datasheets for the wrong device survived in the CAD corpora.
  const a = bytes(`forge-cache-doc-a-${process.pid}`);
  const b = bytes(`forge-cache-doc-b-${process.pid}`);
  writeCached(a, [7], { values: VALUE, unavailable: null, pages: [7] });
  assert.equal(readCached(b, [7]), null);
});

test("a FAILED reading is never stored", () => {
  // Caching "the spend ceiling was reached" would make one bad afternoon
  // permanent, and the next run would report a corroboration failure that had
  // already been fixed.
  const pdf = bytes(`forge-cache-fail-${process.pid}`);
  writeCached(pdf, [7], { values: null, unavailable: "the spend ceiling was reached", pages: [7] });
  assert.equal(readCached(pdf, [7]), null);
});

test("the cache lives beside the CAD benches' and not inside it", () => {
  // Its entries have a different shape. One directory holding two formats is a
  // listing that lies about how many responses are cached.
  assert.match(spiceCacheDir(), /\.model-cache[/\\]spice$/);
});

test.after(() => {
  // Leave the machine as we found it. The keys are internal, so entries are
  // identified by content: every one this file wrote holds exactly the single
  // value above, and a real corpus reading never does.
  const dir = spiceCacheDir();
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    try {
      const entry = JSON.parse(readFileSync(path, "utf8")) as { values?: Array<{ parameter: string; typ: number | null }> };
      if (entry.values?.length === 1 && entry.values[0].parameter === "Gain-bandwidth product" && entry.values[0].typ === 350) {
        rmSync(path);
      }
    } catch {
      // Anything unreadable is left alone: it is not ours to delete.
    }
  }
});
