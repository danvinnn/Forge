/**
 * The read bar, broken on purpose before it is trusted.
 *
 * The version this replaces could not have failed: a fill pinned at a constant
 * width and a stage list with the active index hardcoded to 2. It said the same
 * thing at one second and at two minutes, which is the shape RULES.md calls an
 * instrument that cannot fail.
 *
 * So every property the bar claims is asserted here, and each assertion is one
 * the old code would have failed.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { clock, progressAt, searchLine, stagesFor } from "../readprogress";
import type { Intent } from "../intent";

const INTENTS: Intent[] = ["cad", "spice", "both"];

function total(intent: Intent): number {
  return stagesFor(intent).reduce((sum, stage) => sum + stage.seconds, 0);
}

test("every intent gets four stages and a positive schedule", () => {
  for (const intent of INTENTS) {
    const stages = stagesFor(intent);
    assert.equal(stages.length, 4, intent);
    for (const stage of stages) {
      assert.ok(stage.seconds > 0, `${intent}: ${stage.name} has no duration`);
      assert.ok(stage.name.length > 0 && stage.note.length > 0, `${intent}: ${stage.name} says nothing`);
    }
  }
});

test("the third stage names what this intent is actually reading", () => {
  // A footprint and a macromodel are aimed at different pages. A bar that named
  // the same third stage for both would be describing a read that did not happen.
  const cad = stagesFor("cad")[2].name;
  const spice = stagesFor("spice")[2].name;
  assert.notEqual(cad, spice);
  assert.match(cad, /outline/i);
  assert.match(spice, /specification/i);
});

test("the fill only ever increases, over the whole run and well past it", () => {
  for (const intent of INTENTS) {
    const stages = stagesFor(intent);
    let previous = -1;
    for (let ms = 0; ms <= 400_000; ms += 250) {
      const at = progressAt(ms, stages, false);
      assert.ok(
        at.fraction >= previous,
        `${intent}: fill went backwards at ${ms}ms, ${at.fraction} after ${previous}`
      );
      previous = at.fraction;
    }
  }
});

test("the fill moves inside every stage, not just between them", () => {
  // "Only ever increases" is satisfied by a bar that never moves at all, which
  // is exactly the defect being replaced. This is the assertion that fails on a
  // constant, so it is the one that earns the rest.
  for (const intent of INTENTS) {
    const stages = stagesFor(intent);
    let cumulative = 0;
    for (const stage of stages) {
      const start = progressAt(cumulative * 1000, stages, false).fraction;
      const end = progressAt((cumulative + stage.seconds - 1) * 1000, stages, false).fraction;
      assert.ok(end > start + 0.01, `${intent}: ${stage.name} showed no movement, ${start} to ${end}`);
      cumulative += stage.seconds;
    }
  }
});

test("the fill never reaches full while the read is still running", () => {
  for (const intent of INTENTS) {
    const stages = stagesFor(intent);
    for (const ms of [0, 1_000, 30_000, 90_000, 300_000, 3_600_000]) {
      const at = progressAt(ms, stages, false);
      assert.ok(at.fraction < 1, `${intent}: claimed done at ${ms}ms while still reading`);
    }
  }
});

test("only the response landing fills it", () => {
  const stages = stagesFor("cad");
  const done = progressAt(120_000, stages, true);
  assert.equal(done.fraction, 1);
  assert.equal(done.index, stages.length);
});

test("it moves visibly inside the first second, and keeps moving after the schedule", () => {
  const stages = stagesFor("cad");
  // A bar that does nothing for the first few seconds is indistinguishable from
  // a bar that is broken, which is what the constant-width version looked like.
  assert.ok(progressAt(750, stages, false).fraction > 0.005);
  // And a slow read must not freeze: the last of the ceiling is spent creeping.
  const at90 = progressAt(total("cad") * 1000, stages, false).fraction;
  const at150 = progressAt(150_000, stages, false).fraction;
  assert.ok(at150 > at90 + 0.005, `overrun stalled: ${at90} then ${at150}`);
});

test("the stage advances with the clock rather than sitting on one index", () => {
  const stages = stagesFor("cad");
  const seen = new Set<number>();
  for (let seconds = 0; seconds <= total("cad"); seconds += 1) {
    seen.add(progressAt(seconds * 1000, stages, false).index);
  }
  assert.deepEqual([...seen].sort(), [0, 1, 2, 3]);
});

test("the last stage never closes on a timer", () => {
  // Stages one to three are estimated. The fourth means "the reading is in
  // hand", so nothing but the response is allowed to close it.
  const stages = stagesFor("cad");
  const lastStartsAt = stages.slice(0, -1).reduce((sum, stage) => sum + stage.seconds, 0) * 1000;
  for (const ms of [lastStartsAt, 200_000, 600_000]) {
    assert.equal(progressAt(ms, stages, false).index, 3, `moved past the last stage at ${ms}ms`);
  }
});

test("a stage has no start time until the clock has reached it", () => {
  const stages = stagesFor("cad");
  const early = progressAt(2_000, stages, false);
  assert.equal(early.startedAt[0], 0);
  assert.equal(early.startedAt[1], null);
  assert.equal(early.startedAt[3], null);

  // A finished read shows the whole history: printing dashes beside four
  // completed stages is the em-dash defect wearing a green tick.
  const finished = progressAt(90_000, stages, true);
  assert.ok(finished.startedAt.every((at) => at !== null));
});

test("overrun is reported, and not before the schedule is spent", () => {
  const stages = stagesFor("cad");
  assert.equal(progressAt(60_000, stages, false).overrun, false);
  assert.equal(progressAt(200_000, stages, false).overrun, true);
});

test("negative and absurd clocks do not produce a broken bar", () => {
  const stages = stagesFor("cad");
  for (const ms of [-5_000, 0, Number.MAX_SAFE_INTEGER]) {
    const at = progressAt(ms, stages, false);
    assert.ok(at.fraction >= 0 && at.fraction < 1, `fraction out of range at ${ms}ms: ${at.fraction}`);
    assert.ok(at.index >= 0 && at.index < stages.length, `index out of range at ${ms}ms: ${at.index}`);
  }
});

test("the clock reads as minutes and seconds", () => {
  assert.equal(clock(0), "0:00");
  assert.equal(clock(7), "0:07");
  assert.equal(clock(95), "1:35");
  assert.equal(clock(-3), "0:00");
});


/**
 * THE STAGE THAT ONLY EXISTS ON ONE PATH.
 *
 * A lookup pays for retrieval and an upload does not. Before 2026-09-04 the bar
 * told both the same story, so a lookup spent its fetch claiming the model was
 * already reading a document that had not been found yet.
 */

test("only a lookup gets a retrieval stage, and it comes first", () => {
  for (const intent of INTENTS) {
    const upload = stagesFor(intent, { retrieving: false });
    const lookup = stagesFor(intent, { retrieving: true });

    assert.equal(upload.length, 4, `${intent}: an upload has nothing to find`);
    assert.equal(lookup.length, 5, intent);
    assert.match(lookup[0].name, /finding/i, "retrieval happens before anything can be read");
    // The model half must be IDENTICAL on both paths. If the two ever drift, the
    // bar is describing two different pipelines and one of them is wrong.
    assert.deepEqual(lookup.slice(1), upload, intent);
  }
});

test("omitting the option is the upload shape, not a fifth stage by accident", () => {
  // `/api/parse` callers pass no options. A default that silently added the
  // retrieval stage would put eight seconds of fetch into a request that has
  // none, which is the same lie in the other direction.
  for (const intent of INTENTS) {
    assert.deepEqual(stagesFor(intent), stagesFor(intent, { retrieving: false }), intent);
  }
});

test("a normal lookup is not reported as an overrun", () => {
  // THE DEFECT THIS ASSERTS AGAINST. The schedule totalled 90 seconds while a
  // lookup can legitimately run to 45 of retrieval plus the model pass, so the
  // common case reached the end of the schedule and dropped into the creep the
  // bar reserves for a read that has gone long.
  const stages = stagesFor("cad", { retrieving: true });
  const scheduled = stages.reduce((sum, stage) => sum + stage.seconds, 0);
  const upload = stagesFor("cad").reduce((sum, stage) => sum + stage.seconds, 0);

  assert.ok(scheduled > upload, "a lookup must be given more of a schedule than an upload");
  assert.equal(progressAt(upload * 1000, stages, false).overrun, false);
});

test("the retrieval stage is a typical fetch, not the chain's ceiling", () => {
  // A schedule built from `resolveChainBudgetMs()` would crawl for 45 seconds
  // through a fetch that usually takes a few, then jump when the model started.
  // Asserted as a band rather than a value so the measurement can be retaken.
  const finding = stagesFor("cad", { retrieving: true })[0];
  assert.ok(finding.seconds >= 3, "a fetch is not instant");
  assert.ok(finding.seconds <= 20, `${finding.seconds}s is the ceiling of a miss, not a typical hit`);
});

test("the retrieval stage closes on the clock, and the last one still does not", () => {
  const stages = stagesFor("spice", { retrieving: true });
  // Retrieval genuinely finishes mid-request, so unlike the last stage it is
  // allowed to complete on a timer.
  assert.equal(progressAt(1_000, stages, false).index, 0);
  assert.ok(progressAt(20_000, stages, false).index > 0, "the fetch must not hold the bar forever");
  for (const ms of [200_000, 600_000]) {
    assert.equal(progressAt(ms, stages, false).index, stages.length - 1, `moved past the last stage at ${ms}ms`);
  }
});

// THE SEARCH LINE ROTATES SO A THIRTY-SECOND LOOKUP DOES NOT READ AS A HANG.
//
// Asked for 2026-09-10: one frozen "Finding X…" for the length of a miss looks
// like the click did nothing. What is asserted here is that it MOVES, that it
// moves in the order the resolver chain actually runs, and that it never says
// anything about the outcome.
test("the search line advances through the chain and then holds", () => {
  const first = searchLine(0, "HS9-26CLV32RH-Q");
  const manufacturer = searchLine(5000, "HS9-26CLV32RH-Q");
  const wider = searchLine(12000, "HS9-26CLV32RH-Q");
  const tail = searchLine(25000, "HS9-26CLV32RH-Q");

  assert.match(first, /Finding HS9-26CLV32RH-Q/, "opens by naming what it is looking for");
  assert.notEqual(manufacturer, first, "it moves");
  assert.notEqual(wider, manufacturer, "and moves again");
  assert.notEqual(tail, wider, "and again");

  // `buildCommercialResolver` is composite(manufacturer, scrape): vendor URLs
  // first, the search fallback second. The lines follow that, so the second one
  // is the next thing that happens rather than a synonym for the first.
  assert.match(manufacturer, /manufacturer/i, "stage one is the vendor patterns");
  assert.match(wider, /searching more widely/i, "stage two is the fallback");

  // Held, not looped. A list that cycles keeps animating past the point where
  // the honest thing to say is that this is taking a while.
  assert.equal(searchLine(45000, "HS9-26CLV32RH-Q"), tail, "the last line holds");
  assert.equal(searchLine(600000, "HS9-26CLV32RH-Q"), tail);
});

test("the search line never claims an outcome", () => {
  for (const ms of [0, 4000, 10000, 20000, 60000]) {
    const line = searchLine(ms, "LMP7704-SP");
    assert.doesNotMatch(line, /\bfound\b|\bgot\b|\bretrieved\b/i, `"${line}" asserts a result it does not have`);
  }
});
