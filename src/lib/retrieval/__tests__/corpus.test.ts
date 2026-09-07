import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// Merge-blocking gate protecting the air-gap story: no controlled or customer datasheet may live
// in the repo. Every PDF under test-data/ must be an explicitly allowlisted public part.
test("test-data contains only allowlisted public datasheets", () => {
  const dir = join(process.cwd(), "test-data");

  const allowlist = new Set(
    readFileSync(join(dir, "ALLOWLIST.txt"), "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"))
  );

  const pdfs = readdirSync(dir)
    .filter((name) => name.toLowerCase().endsWith(".pdf"))
    .map((name) => name.replace(/\.pdf$/i, ""));

  const unlisted = pdfs.filter((base) => !allowlist.has(base));
  assert.deepEqual(
    unlisted,
    [],
    `Unlisted datasheets in test-data/: ${unlisted.join(", ")}. Add the public part to test-data/ALLOWLIST.txt, or remove the file if it is not public.`
  );
});

// Merge-blocking gate, and the companion to the one above. The corpora are NOT in the
// repository: `.bench-cache/`, `.holdout-cache/`, `.blind-cache/` and `.model-cache/` are
// gitignored precisely because no vendor datasheet is ever committed. A unit test therefore
// cannot see them on a fresh checkout.
//
// ## Why this exists
//
// On 2026-09-07 two test files read `.bench-cache/NCP1200.pdf` and `.bench-cache/DRV8825.pdf`
// at module scope with no guard. They passed on the machine that wrote them, where the cache
// happens to sit, and crashed with ENOENT on every runner. Four tests stopped running and CI
// went red. Nothing caught it before the push because the developer's machine is the one
// machine where the bug is invisible.
//
// ## What is allowed
//
// Naming one of these directories is fine when the test CHECKS whether it is there first.
// Two shapes already do that and both are correct: model-route and identify-route skip the
// test on a missing file, namedblock and extraction/run return early or fall back. What is
// banned is reading from one unconditionally.
//
// The rule is therefore "an existence check appears in the file", not "a skip appears". The
// first version of this gate demanded a skip, and flagged namedblock and extraction/run,
// which guard correctly by another route. A gate that cries wolf gets switched off.
test("no unit test reads from a gitignored corpus cache without checking it is there", () => {
  const CACHES = [".bench-cache", ".holdout-cache", ".blind-cache", ".model-cache", ".phase0-cache"];

  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const full = join(dir, name);
      if (name === "node_modules" || name.startsWith(".")) return [];
      if (statSync(full).isDirectory()) return walk(full);
      return full.endsWith(".test.ts") ? [full] : [];
    });

  const offenders: string[] = [];
  for (const file of walk(join(process.cwd(), "src"))) {
    const source = readFileSync(file, "utf8");
    const named = CACHES.filter((cache) => source.includes(`"${cache}"`) || source.includes(`'${cache}'`));
    if (named.length === 0) continue;
    // A file that asks whether the cache is there is doing the right thing, whether it then
    // skips, returns early, or falls back. A file that never asks is reading a path that will
    // not exist wherever the checkout is fresh.
    const guarded = /existsSync/.test(source);
    if (!guarded) offenders.push(`${file.replace(`${process.cwd()}/`, "")} (${named.join(", ")})`);
  }

  assert.deepEqual(
    offenders,
    [],
    `These tests read a gitignored corpus cache unconditionally, so they cannot run on a fresh checkout:\n  ${offenders.join("\n  ")}\nUse a tracked fixture from test-data/, or skip on existsSync of the cache file.`
  );
});
