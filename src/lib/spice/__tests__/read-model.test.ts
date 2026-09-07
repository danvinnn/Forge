/**
 * The contract between the two readings.
 *
 * Both read the same table. If they describe what they read DIFFERENTLY, every
 * comparison misses and a fully corroborated part is reported as single-source:
 * silently weaker, never louder. That happened on the first live run, twice at
 * once, and both are held shut here.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { malformedUnitRows, parseReading, secondReadingProvider, secondReadingProviders, toComparable, toComparableWithUnitRepairs, tablePagesOf } from "../read-model";
import { ALL_PARAMETERS } from "../model";
import { SPEC_TABLE_PROMPT } from "../prompt";
import type { SpecRow } from "../specs";

function row(page: number): SpecRow {
  return {
    parameter: "Input offset voltage",
    key: "offsetVoltage",
    symbol: null,
    conditions: null,
    unit: "uV",
    values: { min: null, typ: 2, max: 10 },
    group: null,
    scope: null,
    page
  };
}

test("the second reading chooses providers exactly as the extraction path does", () => {
  const previous = {
    key: process.env.GOOGLE_GEMINI_API_KEY,
    credential: process.env.GOOGLE_APPLICATION_CREDENTIALS,
    project: process.env.FORGE_VERTEX_PROJECT
  };
  try {
    delete process.env.GOOGLE_GEMINI_API_KEY;
    delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
    delete process.env.FORGE_VERTEX_PROJECT;
    assert.equal(secondReadingProvider(), null);

    process.env.GOOGLE_GEMINI_API_KEY = "test";
    assert.equal(secondReadingProvider(), "gemini");
    assert.deepEqual(secondReadingProviders(), ["gemini"]);

    process.env.GOOGLE_APPLICATION_CREDENTIALS = "/tmp/test.json";
    process.env.FORGE_VERTEX_PROJECT = "test-project";
    assert.equal(secondReadingProvider(), "vertex");
    assert.deepEqual(secondReadingProviders(), ["vertex", "gemini"]);
  } finally {
    if (previous.key === undefined) delete process.env.GOOGLE_GEMINI_API_KEY;
    else process.env.GOOGLE_GEMINI_API_KEY = previous.key;
    if (previous.credential === undefined) delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
    else process.env.GOOGLE_APPLICATION_CREDENTIALS = previous.credential;
    if (previous.project === undefined) delete process.env.FORGE_VERTEX_PROJECT;
    else process.env.FORGE_VERTEX_PROJECT = previous.project;
  }
});

test("an unlabelled group is null on BOTH sides, never an index", () => {
  // The deterministic reader reports null for a single unlabelled group. The
  // model answered `0`. An index is not a label, and treating it as one made
  // every comparison miss and OPA333 report 0 of 6 corroborated when the two
  // readings in fact agreed on all six.
  const values = toComparable({
    tables: [
      {
        heading: null,
        appliesTo: null,
        columnGroups: [],
        rows: [
          { parameter: "Input offset voltage", symbol: "VOS", conditions: null, unit: "uV", values: [{ group: "0" as unknown as string, min: null, typ: 2, max: 10 }] }
        ]
      }
    ]
  });
  assert.equal(values[0].group, null);
});

test("a real group label survives", () => {
  const values = toComparable({
    tables: [
      {
        heading: null,
        appliesTo: null,
        columnGroups: ["LT1013AM"],
        rows: [{ parameter: "Input Offset Voltage", symbol: "VOS", conditions: null, unit: "uV", values: [{ group: "LT1013AM", min: null, typ: 80, max: 300 }] }]
      }
    ]
  });
  assert.equal(values[0].group, "LT1013AM");
});

test("a cell that is not a number becomes null, never NaN", () => {
  // Datasheet cells include cross-references and formulae, and the model
  // reports what it sees. NaN compared against a real number reads as a
  // DISAGREEMENT, which would flag a part for a cell nobody disagreed about.
  const values = toComparable({
    tables: [
      {
        heading: null,
        appliesTo: null,
        columnGroups: [],
        rows: [
          { parameter: "Long-term stability", symbol: null, conditions: null, unit: "uV", values: [{ group: null, min: null, typ: "See note (1)" as unknown as number, max: null }] },
          { parameter: "Input bias current", symbol: "IB", conditions: null, unit: "pA", values: [{ group: null, min: null, typ: "±70" as unknown as number, max: "±200" as unknown as number }] },
          { parameter: "Common-mode voltage range", symbol: null, conditions: null, unit: "V", values: [{ group: null, min: "(V-) - 0.1" as unknown as number, typ: null, max: null }] }
        ]
      }
    ]
  });
  assert.equal(values[0].typ, null);
  // A plus-or-minus is a tolerance: the magnitude is the number.
  assert.equal(values[1].typ, 70);
  assert.equal(values[1].max, 200);
  assert.equal(values[2].min, null);
  for (const v of values) for (const k of ["min", "typ", "max"] as const) assert.equal(Number.isNaN(v[k] as number), false);
});

test("a value whose unit cannot be scaled is dropped from the comparison", () => {
  // Comparing 350 against 350 says nothing if one is kHz and the other MHz. A
  // false confirmation is the one outcome this product may never produce.
  const values = toComparable({
    tables: [
      {
        heading: null,
        appliesTo: null,
        columnGroups: [],
        rows: [{ parameter: "Something", symbol: null, conditions: null, unit: "furlongs", values: [{ group: null, min: null, typ: 1, max: null }] }]
      }
    ]
  });
  assert.equal(values.length, 0);
});

test("a malformed drawn unit is eligible for one focused repair without changing its value", () => {
  const first = {
    tables: [{
      heading: "Electrical Characteristics",
      appliesTo: "VIN = 3.3 V",
      columnGroups: [],
      rows: [{ parameter: "Quiescent current", symbol: "IQ", conditions: "no load", unit: "�A", page: 7, values: [{ group: null, min: null, typ: 18, max: 25 }] }]
    }]
  };
  assert.equal(malformedUnitRows(first).length, 1);
  const repaired = structuredClone(first);
  repaired.tables[0].rows[0].unit = "µA";
  const values = toComparableWithUnitRepairs(first, repaired);
  assert.equal(values.length, 1);
  assert.equal(values[0].unit, "µA");
  assert.equal(values[0].typ, 18, "the repair may not replace the first reading's number");
});

test("a unit repair with different row identity cannot attach to the wrong value", () => {
  const first = {
    tables: [{ heading: null, appliesTo: null, columnGroups: [], rows: [
      { parameter: "Quiescent current", symbol: "IQ", conditions: "no load", unit: "�A", page: 7, values: [{ group: null, min: null, typ: 18, max: null }] }
    ] }]
  };
  const wrong = structuredClone(first);
  wrong.tables[0].rows[0].parameter = "Output current";
  wrong.tables[0].rows[0].unit = "µA";
  assert.equal(toComparableWithUnitRepairs(first, wrong).length, 0);
});

test("a reply that is fenced, prefaced or truncated is handled honestly", () => {
  assert.ok(parseReading('```json\n{"tables":[]}\n```'));
  assert.ok(parseReading('Here is the table:\n{"tables":[]}'));
  // Truncated JSON is not a reading. Accepting a partial one would silently
  // compare against half a table and report the rest as uncorroborated.
  assert.equal(parseReading('{"tables":[{"rows":[{"parameter":"Offset'), null);
  assert.equal(parseReading("no json at all"), null);
  // The right shape but the wrong contents is still not a reading.
  assert.equal(parseReading('{"something":1}'), null);
});

test("only the pages that carry a table are rendered", () => {
  // The deterministic read has already found them, so the second reading pays
  // for those pages and no others.
  assert.deepEqual(tablePagesOf([row(7), row(7), row(13), row(14), row(14), row(14)]), [7, 13, 14]);
  assert.deepEqual(tablePagesOf([]), []);
});

test("a page of GRAPH AXES loses to a page of specifications, however many rows it has", () => {
  // A Typical Characteristics page comes out of the text layer as rows whose
  // "unit" is another axis label. Counting rows ranks it above a real
  // continuation page: measured on LM358, two graph pages were rendered and
  // three continuation pages were dropped.
  const axis = (page: number): SpecRow => ({ ...row(page), unit: "Short-Circuit Current (mA)" });
  const pages = tablePagesOf([
    axis(20), axis(20), axis(20), axis(20), axis(20),
    row(6), row(6),
    row(9)
  ]);
  assert.deepEqual(pages, [6, 9]);
});

test("a document with no scalable unit anywhere is still read", () => {
  // The fallback matters: refusing every page because this reader could not
  // scale any unit would send NOTHING to the second reading on exactly the
  // documents that need it most.
  const axis = (page: number): SpecRow => ({ ...row(page), unit: "Frequency (Hz)" });
  assert.deepEqual(tablePagesOf([axis(4), axis(4), axis(9)]), [4, 9]);
});

test("never more pages than the cap, whatever the document does", () => {
  const many: SpecRow[] = [];
  for (let page = 1; page <= 30; page++) many.push(row(page));
  assert.equal(tablePagesOf(many).length, 8);
});

test("visual recovery can name every parameter a shipped behavior class consumes", () => {
  for (const parameter of ALL_PARAMETERS) {
    assert.match(SPEC_TABLE_PROMPT, new RegExp(`\\b${parameter}\\b`), `${parameter} is absent from the visual reader's vocabulary`);
  }
});
