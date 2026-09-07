/**
 * THE RELATIONSHIP BETWEEN THREE CONSTANTS THAT LIVE IN THREE FILES.
 *
 * `/api/lookup` does two expensive things in series inside one request: it walks
 * the resolver chain to find the datasheet, then it hands the bytes to the model.
 * The first is bounded by `resolveChainBudgetMs`, in the retrieval layer. The
 * second is bounded by `modelBudgetMs`, in the extraction layer. What they are
 * both bounded BY is the route's `maxDuration`, in the app layer, and no file
 * knows about more than one of the three.
 *
 * So the arithmetic that has to hold is:
 *
 *     chain budget + RESPONSE_MARGIN_MS + a typical model call  <=  maxDuration
 *
 * and until this file existed, nothing checked it. The chain budget was raised
 * from 12s to 45s on 2026-09-04 because six of seven retrieval misses turned out
 * to be time rather than absence (`SPICE.md` Part IX), and that change spends 33
 * more seconds of a budget the route has to fit a model call into afterwards.
 *
 * ## Why the failure this guards against is worth a test of its own
 *
 * It is SILENT. Overshoot the route's ceiling and the platform kills the
 * function: the user gets a 504, and the record that retrieval and the
 * deterministic pass had already produced is thrown away. Undershoot by less and
 * `worthAsking` returns false, the model pass is skipped, and the user gets a
 * text-only record with a NOTE on it - not an error, not a refusal, just a
 * quietly thinner answer. Neither outcome makes a test go red, which is exactly
 * the shape `LEARNINGS.md` calls "fixed in one place, not the other".
 *
 * `maxDuration` is read out of the route sources rather than imported, because
 * importing a Next.js route handler pulls the whole request stack into a unit
 * test. What is being asserted is the DECLARED platform ceiling, which is a
 * property of that line of source.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  DOCUMENT_READ_ROUTE_BUDGET_MS,
  MIN_MODEL_BUDGET_MS,
  RESPONSE_MARGIN_MS,
  TYPICAL_MODEL_CALL_MS,
  modelBudgetMs,
  worthAsking
} from "../extraction/budget";
import { resolveChainBudgetMs } from "../retrieval/resolvers/composite";

const ROOT = join(__dirname, "..", "..", "app", "api");
const REPOSITORY_ROOT = join(ROOT, "..", "..", "..");

/** The `maxDuration` a route declares to the platform, in milliseconds. */
function declaredCeilingMs(route: string): number {
  const source = readFileSync(join(ROOT, route, "route.ts"), "utf-8");
  const match = source.match(/^export const maxDuration = (\d+);$/m);
  assert.ok(match, `${route} declares no maxDuration, so nothing bounds it`);
  return Number(match[1]) * 1000;
}

/** The chain budget with no operator override, which is what a deployment gets. */
function defaultChainBudgetMs(): number {
  const previous = process.env.FORGE_CHAIN_BUDGET_MS;
  delete process.env.FORGE_CHAIN_BUDGET_MS;
  try {
    return resolveChainBudgetMs();
  } finally {
    if (previous !== undefined) process.env.FORGE_CHAIN_BUDGET_MS = previous;
  }
}

test("the shared instrument budget matches both declared document routes", () => {
  assert.equal(declaredCeilingMs("lookup"), DOCUMENT_READ_ROUTE_BUDGET_MS);
  assert.equal(declaredCeilingMs("parse"), DOCUMENT_READ_ROUTE_BUDGET_MS);
});

test("a lookup that spends the whole retrieval budget still fits a full model call", () => {
  const ceiling = declaredCeilingMs("lookup");
  const chain = defaultChainBudgetMs();

  // The route computes the model's budget from what the chain actually spent,
  // so the worst case is a chain that used every millisecond it was given.
  const left = modelBudgetMs(ceiling, chain);

  // Spelled out rather than trusted, so this test states the relationship
  // instead of restating whatever `modelBudgetMs` happens to compute. If the
  // response margin stops being subtracted, this is what notices.
  assert.equal(left, ceiling - RESPONSE_MARGIN_MS - chain);

  assert.ok(
    left >= TYPICAL_MODEL_CALL_MS,
    `a ${chain}ms chain leaves ${left}ms for a call that takes about ${TYPICAL_MODEL_CALL_MS}ms. ` +
      `Either lower FORGE_CHAIN_BUDGET_MS's default in composite.ts or raise maxDuration on /api/lookup.`
  );
  // Stated separately because they fail differently: below the minimum the call
  // is never made and the record silently loses the model pass; above the
  // minimum but below a typical call, the call is made, paid for, and abandoned.
  assert.equal(worthAsking(left), true);
});

test("the deployment template does not silently override the tested retrieval budget", () => {
  const template = readFileSync(join(REPOSITORY_ROOT, ".env.example"), "utf8");
  const match = template.match(/^FORGE_CHAIN_BUDGET_MS=(\d+)$/m);
  assert.ok(match, ".env.example must state the retrieval budget deployments receive");
  assert.equal(Number(match[1]), defaultChainBudgetMs());
});

test("the retrieval budget is not the thing that decides whether to ask", () => {
  // A guard against the shape where the two constants are tuned to each other
  // until the chain budget sits exactly on the worthAsking boundary and any
  // slow vendor host tips a normal lookup into a text-only record.
  const ceiling = declaredCeilingMs("lookup");
  const chain = defaultChainBudgetMs();
  const slack = modelBudgetMs(ceiling, chain) - TYPICAL_MODEL_CALL_MS;

  assert.ok(
    slack >= MIN_MODEL_BUDGET_MS,
    `only ${slack}ms of slack over a typical call. There is no room for the PDF parse, ` +
      "which happens after this budget is computed and is not counted in it."
  );
});

test("the upload route, which does no retrieval, has at least as much room", () => {
  // `/api/parse` is handed the bytes, so it never pays the chain. If it ever has
  // LESS room than the route that does, one of the two ceilings is wrong.
  const parse = modelBudgetMs(declaredCeilingMs("parse"), 0);
  const lookup = modelBudgetMs(declaredCeilingMs("lookup"), defaultChainBudgetMs());

  assert.ok(parse >= lookup, `parse leaves ${parse}ms and lookup leaves ${lookup}ms`);
  assert.ok(parse >= TYPICAL_MODEL_CALL_MS);
});

test("every route that reads a document declares a ceiling, and it fits a model call", () => {
  // Named rather than globbed: a new route with no maxDuration is the defect,
  // and a glob over the directory would silently pass by not finding it.
  //
  // `/api/model` takes a SECOND reading after the first, which is why its own
  // budget is checked here rather than assumed from the others.
  for (const route of ["lookup", "parse", "model"]) {
    const left = modelBudgetMs(declaredCeilingMs(route), 0);
    assert.ok(left >= TYPICAL_MODEL_CALL_MS, `/api/${route} leaves only ${left}ms`);
  }
});

test("an operator raising the chain budget past the route cannot do it silently", () => {
  // The env var is the escape hatch for a host with a different function
  // timeout, and it is unvalidated on purpose - but a value that leaves no room
  // for the model must at least be visible as a failure here rather than as a
  // 504 in production.
  const previous = process.env.FORGE_CHAIN_BUDGET_MS;
  process.env.FORGE_CHAIN_BUDGET_MS = "300000";
  try {
    const left = modelBudgetMs(declaredCeilingMs("lookup"), resolveChainBudgetMs());
    assert.ok(left < 0, "a chain budget past the route ceiling must read as no budget at all");
    assert.equal(worthAsking(left), false, "and must stop the call rather than start one to be killed");
  } finally {
    if (previous === undefined) delete process.env.FORGE_CHAIN_BUDGET_MS;
    else process.env.FORGE_CHAIN_BUDGET_MS = previous;
  }
});
