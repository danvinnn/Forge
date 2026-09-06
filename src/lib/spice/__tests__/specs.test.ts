/**
 * Every trap that was found in the SPICE design before it was built, held shut.
 *
 * `SPICE.md` sections 29 to 35 record sixteen instances of four failure shapes,
 * fourteen of which were a vocabulary gap or a word-boundary trap. Each one that
 * can be expressed as data has a test here, so it cannot come back quietly.
 *
 * These run on SYNTHETIC spans, never on a PDF. `specs.ts` takes plain
 * positioned text and opens nothing, which is what makes this possible.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { toRows, readPage, type Span, type SpecRow } from "../specs";
import { normaliseHeader, normaliseSymbol } from "../vocab";

/** Builds spans from a compact `[x, y, text]` table. */
function spans(rows: Array<[number, number, string]>): Span[] {
  return rows.map(([x, y, text]) => ({ x, y, text }));
}

function read(cells: Array<[number, number, string]>): SpecRow[] {
  return readPage(toRows(spans(cells)), 1, { header: null, scope: null });
}

const HEADER_Y = 10;
/** A plain MIN/TYP/MAX header at the usual TI column positions. */
const HEADER: Array<[number, number, string]> = [
  [110, HEADER_Y, "PARAMETER"],
  [260, HEADER_Y, "TEST CONDITIONS"],
  [406, HEADER_Y, "MIN"],
  [450, HEADER_Y, "TYP"],
  [494, HEADER_Y, "MAX"],
  [527, HEADER_Y, "UNIT"]
];

test("normaliseSymbol keeps digits, so IQ1 is not IQ", () => {
  // Stripping every non-letter turned IQ1 into IQ, which on a dual amplifier
  // reads a per-channel current as the part's supply current.
  assert.equal(normaliseSymbol("I_Q"), "IQ");
  assert.equal(normaliseSymbol("I Q"), "IQ");
  assert.notEqual(normaliseSymbol("IQ1"), "IQ");
  assert.notEqual(normaliseSymbol("IQSD"), "IQ");
});

test("normaliseHeader strips footnote markers and trailing periods", () => {
  // TI writes TYP(2); ST writes Typ. Both defeated a strict /^TYP$/ and each
  // cost a whole datasheet: LM358 and TSV911 respectively read nothing.
  assert.equal(normaliseHeader("TYP(2)"), "TYP");
  assert.equal(normaliseHeader("TYP (2)"), "TYP");
  assert.equal(normaliseHeader("Typ."), "TYP");
  assert.equal(normaliseHeader("Min."), "MIN");
  // A digit inside a word is identity, not decoration.
  assert.equal(normaliseHeader("LQFP64"), "LQFP64");
});

test("a footnote marker is stripped however the vendor brackets it", () => {
  // Renesas uses SQUARE brackets: ISL71001M heads its table `Min[1] Typ[2]
  // Max[1]`, and while only round brackets were stripped that 37-page datasheet
  // produced ZERO specification rows off a perfectly typeset table.
  assert.equal(normaliseHeader("Min[1]"), "MIN");
  assert.equal(normaliseHeader("Typ[2]"), "TYP");
  assert.equal(normaliseHeader("Max[1]"), "MAX");
  assert.equal(normaliseHeader("Min[1][2]"), "MIN");
});

test("a bare trailing digit is NOT a footnote marker", () => {
  // The line this rule refuses to cross, and it is refused on evidence.
  //
  // `Typ1` really is a footnote marker on ADXL345 and VA10820 - but the PDF text
  // layer stores the superscript as an ordinary `1`, so nothing here can tell it
  // from VA10820's own `tDV(Typ1)`, where the digit is part of the symbol, or
  // from `MAX232`, which is a part number that would become the header `MAX`.
  //
  // Reading a part number as a column header is a worse failure than missing a
  // footnote, so the marker has to be bracketed to be stripped.
  assert.equal(normaliseHeader("Typ1"), "TYP1");
  assert.equal(normaliseHeader("MAX232"), "MAX232");
  assert.equal(normaliseHeader("tDV(Typ1)"), "TDV(TYP1)");
});

test("a footnote-marked header is still a header", () => {
  const rows = read([
    [110, HEADER_Y, "PARAMETER"],
    [406, HEADER_Y, "MIN"],
    [450, HEADER_Y, "TYP(2)"],
    [494, HEADER_Y, "MAX"],
    [527, HEADER_Y, "UNIT"],
    [58, 30, "VOS"],
    [97, 30, "Input offset voltage"],
    [452, 30, "3"],
    [496, 30, "7"],
    [529, 30, "mV"]
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].key, "offsetVoltage");
  assert.deepEqual(rows[0].values, { min: null, typ: 3, max: 7 });
});

test("a period-suffixed header is still a header", () => {
  const rows = read([
    [406, HEADER_Y, "Min."],
    [450, HEADER_Y, "Typ."],
    [494, HEADER_Y, "Max."],
    [527, HEADER_Y, "Unit"],
    [97, 30, "Gain bandwidth product"],
    [452, 30, "10"],
    [529, 30, "MHz"]
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].key, "gbw");
  assert.equal(rows[0].values.typ, 10);
});

test("a header staggered over two baselines keeps its typical and unit columns", () => {
  // Renesas draws MIN/MAX ten points above TYP/UNITS. They are one visual
  // header but two text-layer rows, and reading either row alone made every
  // parameter unusable on ISL28110 and ISL70444SEH.
  const rows = read([
    [110, 10, "PARAMETER"],
    [406, 10, "MIN"],
    [494, 10, "MAX"],
    [450, 20, "TYP"],
    [527, 20, "UNITS"],
    [58, 40, "AVOL"],
    [97, 40, "Open-loop gain"],
    [408, 40, "104"],
    [529, 40, "dB"]
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].key, "openLoopGain");
  assert.equal(rows[0].unit, "dB");
  assert.deepEqual(rows[0].values, { min: 104, typ: null, max: null });
});

test("an AC specifications subheading keeps the supply scope it belongs to", () => {
  const cells: Array<[number, number, string]> = [
    [50, 1, "Electrical Specifications VS = ±18V"],
    ...HEADER,
    [97, 30, "Open-loop gain"],
    [452, 30, "125"],
    [529, 30, "dB"],
    [50, 50, "AC SPECIFICATIONS"],
    [97, 70, "Gain bandwidth product"],
    [452, 70, "19"],
    [529, 70, "MHz"]
  ];
  const rows = read(cells);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((row) => row.scope), ["VS = ±18V", "VS = ±18V"]);
});

test("several column groups become several entries, each with its label", () => {
  // LT1013 prints three grades side by side, one of which is a different part.
  // Reading only the leftmost returns another variant's guarantee.
  const rows = read([
    [327, 4, "LT1013AM"],
    [404, 4, "LT1014AM"],
    [467, 4, "LT1013M"],
    [45, HEADER_Y, "SYMBOL PARAMETER"],
    [313, HEADER_Y, "MIN"],
    [339, HEADER_Y, "TYP"],
    [363, HEADER_Y, "MAX"],
    [390, HEADER_Y, "MIN"],
    [416, HEADER_Y, "TYP"],
    [441, HEADER_Y, "MAX"],
    [467, HEADER_Y, "MIN"],
    [494, HEADER_Y, "TYP"],
    [518, HEADER_Y, "MAX"],
    [545, HEADER_Y, "UNITS"],
    [45, 30, "VOS"],
    [81, 30, "Input Offset Voltage"],
    [341, 30, "80"],
    [365, 30, "300"],
    [419, 30, "90"],
    [442, 30, "350"],
    [494, 30, "110"],
    [520, 30, "550"],
    [558, 30, "uV"]
  ]);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map((r) => r.group), ["LT1013AM", "LT1014AM", "LT1013M"]);
  assert.deepEqual(rows[0].values, { min: null, typ: 80, max: 300 });
  assert.deepEqual(rows[2].values, { min: null, typ: 110, max: 550 });
});

test("a contradicting symbol is refused: IQSD is not IQ", () => {
  const rows = read([
    ...HEADER,
    [58, 30, "IQSD"],
    [99, 30, "Quiescent current per amplifier"],
    [452, 30, "0.5"],
    [496, 30, "1.5"],
    [529, 30, "uA"]
  ]);
  assert.equal(rows.filter((r) => r.key === "quiescentCurrent").length, 0);
});

test("a row with NO symbol is accepted, because the document prints none", () => {
  // Requiring a symbol refused OPA2189's quiescent current for a reason that
  // was ours and not the document's. Reject on proof, never on absence.
  const rows = read([
    ...HEADER,
    [99, 30, "Quiescent current per amplifier"],
    [452, 30, "1.3"],
    [496, 30, "1.7"],
    [529, 30, "mA"]
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].key, "quiescentCurrent");
  assert.equal(rows[0].symbol, null);
});

test("an Absolute Maximum table is refused even when shaped like a spec table", () => {
  const rows = read([
    [58, 2, "6.1 Absolute Maximum Ratings"],
    ...HEADER,
    [99, 30, "Supply voltage"],
    [408, 30, "-0.5"],
    [496, 30, "7"],
    [529, 30, "V"]
  ]);
  assert.equal(rows.length, 0);
});

test("MIN/NOM/MAX without TYP is Recommended Operating Conditions, not a spec table", () => {
  const rows = read([
    [406, HEADER_Y, "MIN"],
    [450, HEADER_Y, "NOM"],
    [494, HEADER_Y, "MAX"],
    [527, HEADER_Y, "UNIT"],
    [99, 30, "Supply voltage"],
    [408, 30, "1.8"],
    [496, 30, "5.5"],
    [529, 30, "V"]
  ]);
  assert.equal(rows.length, 0);
});

test("the heading's scope is kept, because it answers the supply question", () => {
  const rows = read([
    [58, 2, "Electrical Characteristics VS = 5 V"],
    ...HEADER,
    [99, 30, "Gain bandwidth product"],
    [452, 30, "2.5"],
    [529, 30, "MHz"]
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].scope, "VS = 5 V");
});

test("prose beginning with the section name is not a heading", () => {
  const rows = read([
    [58, 2, "Electrical Characteristics for this device are similar to the OPAx316 and TLVx316 family described elsewhere in this document"],
    ...HEADER,
    [99, 30, "Gain bandwidth product"],
    [452, 30, "2.5"],
    [529, 30, "MHz"]
  ]);
  assert.equal(rows[0].scope, null);
});

test("a parameter we do not model is still stored, with a null key", () => {
  // Six of the sixteen defects found before building were a value read and then
  // discarded. The prompt and the reader are the expensive part; a row dropped
  // here has to be paid for again when the model gains a block for it.
  const rows = read([
    ...HEADER,
    [99, 30, "Total harmonic distortion plus noise"],
    [452, 30, "0.0001"],
    [529, 30, "%"]
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].key, null);
  assert.equal(rows[0].parameter, "Total harmonic distortion plus noise");
  assert.equal(rows[0].values.typ, 0.0001);
});

test("a value sub-row attaches to a vertically centred label", () => {
  // TI centres the name and unit across a parameter's condition sub-rows, so
  // OPA333's quiescent current values sit on baselines the label does not.
  const rows = read([
    ...HEADER,
    [228, 35, "IO = 0 A"],
    [456, 35, "17"],
    [501, 35, "25"],
    [57, 41, "IQ"],
    [97, 41, "Quiescent current per amplifier"],
    [530, 41, "uA"]
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].key, "quiescentCurrent");
  assert.deepEqual(rows[0].values, { min: null, typ: 17, max: 25 });
  assert.equal(rows[0].unit, "uA");
  assert.equal(rows[0].conditions, "IO = 0 A");
});

test("a sub-row equally close to two labels is declined, not guessed", () => {
  // This reader is the SECOND source. A declined row is flagged for the user; a
  // row attributed to the wrong parameter is a silent wrong value.
  const rows = read([
    ...HEADER,
    [97, 30, "Input offset voltage"],
    [97, 50, "Input offset voltage drift"],
    [452, 40, "9"],
    [496, 40, "12"]
  ]);
  assert.equal(rows.length, 0);
});

test("a band heading does not steal the first row of its own band", () => {
  const rows = read([
    ...HEADER,
    [58, 26, "OFFSET VOLTAGE"],
    [452, 34, "3"],
    [496, 34, "7"],
    [57, 40, "VOS"],
    [97, 40, "Input offset voltage"],
    [529, 40, "mV"]
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].key, "offsetVoltage");
  assert.deepEqual(rows[0].values, { min: null, typ: 3, max: 7 });
});

test("a grade printed BESIDE the value is read, and does not split the block", () => {
  // OPA2277 states four offset voltages under one heading, labelled in the test
  // conditions column rather than above a column group, and they differ by a
  // factor of eight. Dropped, the four look like readings of one row, and the
  // two readings of the page pick different ones and report a disagreement
  // neither of them made.
  const rows = read([
    ...HEADER,
    [178, 30, "OPA277P, U"],
    [450, 30, "10"],
    [494, 30, "20"],
    [110, 36, "Input offset voltage"],
    [527, 36, "uV"],
    [178, 42, "OPA2277P, U"],
    [450, 42, "10"],
    [494, 42, "25"],
    [178, 54, "OPA277P, U"],
    [450, 54, "0.1"],
    [110, 60, "Input offset voltage drift"],
    [527, 60, "uV/s"],
    [178, 66, "OPA2277P, U"],
    [450, 66, "0.25"]
  ]);
  const offsets = rows.filter((r) => r.key === "offsetVoltage");
  assert.equal(offsets.length, 2);
  assert.deepEqual(offsets.map((r) => r.grade), ["OPA277P, U", "OPA2277P, U"]);
  assert.deepEqual(offsets.map((r) => r.values.max), [20, 25]);
  // NOT a column group. Splitting the block on it leaves every grade without
  // the gain and gain-bandwidth a model needs, because those are discriminated
  // by load rather than by grade, and refuses a part that builds today.
  assert.deepEqual(new Set(offsets.map((r) => r.group)), new Set([null]));
});

test("a label appearing under ONE parameter is a condition, not a grade", () => {
  // `To 0.01%` carries a letter and a digit and states no relation, exactly like
  // a device designator. What separates them is that a grade discriminates the
  // whole table and a condition belongs to one row. Promoting it would put a
  // test condition where the join looks for a device.
  const rows = read([
    ...HEADER,
    [294, 30, "To 0.1%"],
    [450, 30, "14"],
    [110, 36, "Settling time"],
    [527, 36, "us"],
    [294, 42, "To 0.01%"],
    [450, 42, "16"]
  ]);
  const settling = rows.filter((r) => r.key === "settlingTime");
  assert.equal(settling.length, 2);
  assert.deepEqual(settling.map((r) => r.grade), [null, null]);
});

test("a test condition with a relation is never mistaken for a grade", () => {
  const rows = read([
    ...HEADER,
    [178, 30, "RL = 10 kOhm"],
    [450, 30, "140"],
    [110, 36, "Open-loop voltage gain"],
    [527, 36, "dB"],
    [178, 42, "RL = 2 kOhm"],
    [450, 42, "134"]
  ]);
  for (const row of rows.filter((r) => r.key === "openLoopGain")) assert.equal(row.grade, null);
});

test("a UNIT column printed on the line ABOVE the columns is still found", () => {
  // A table with two column groups is typeset over two header lines: the words
  // PARAMETER, TEST CONDITIONS and UNIT on the first, MIN TYP MAX MIN TYP MAX
  // on the second. Reading one line at a time accepts the second and comes back
  // with no unit column, and EVERY value on the page then has an unknown
  // magnitude. Measured on REF5025: 15 rows, not one of them usable.
  const rows = read([
    [94, 6, "PARAMETER"],
    [216, 6, "TEST CONDITIONS"],
    [529, 6, "UNIT"],
    [332, 12, "MIN"],
    [366, 12, "TYP"],
    [399, 12, "MAX"],
    [437, 12, "MIN"],
    [471, 12, "TYP"],
    [499, 12, "MAX"],
    [111, 30, "Quiescent current"],
    [366, 30, "0.8"],
    [399, 30, "1.2"],
    [529, 30, "mA"]
  ]);
  const iq = rows.find((r) => r.key === "quiescentCurrent");
  assert.ok(iq, "the row was not read at all");
  assert.equal(iq!.unit, "mA");
});

test("a one-line header is unaffected by looking up for the unit", () => {
  const rows = read([...HEADER, [110, 30, "Quiescent current"], [450, 30, "17"], [494, 30, "25"], [527, 30, "uA"]]);
  assert.equal(rows.find((r) => r.key === "quiescentCurrent")!.unit, "uA");
});

test("a final MAX UNIT text object still yields both columns", () => {
  const rows = read([
    [390, 10, "MIN"],
    [445, 10, "TYP"],
    [494, 10, "MAX UNIT"],
    [110, 30, "Dropout voltage"],
    [445, 30, "120"],
    [494, 30, "150"],
    [540, 30, "mV"],
    [110, 42, "Quiescent current"],
    [445, 42, "65"],
    [494, 42, "95"],
    [540, 42, "uA"]
  ]);
  const dropout = rows.find((row) => row.key === "dropoutVoltage");
  assert.ok(dropout);
  assert.equal(dropout.unit, "mV");
  assert.deepEqual(dropout.values, { min: null, typ: 120, max: 150 });
});

test("a tightly set unit column can sit within one value-column tolerance", () => {
  const rows = read([
    [390, 10, "MIN"],
    [470, 10, "TYP"],
    [510, 10, "MAX UNIT"],
    [110, 30, "Dropout voltage"],
    [490, 30, "120"],
    [514, 30, "150"],
    [536, 30, "mV"],
    [110, 42, "Quiescent current"],
    [494, 42, "65"],
    [519, 42, "95"],
    [537, 42, "uA"]
  ]);
  assert.equal(rows.find((row) => row.key === "dropoutVoltage")?.unit, "mV");
});

test("a repeated inline qualifier does not replace the centred parameter label", () => {
  const rows = read([
    ...HEADER,
    [110, 26, "Legacy chip"],
    [452, 26, "120"],
    [110, 34, "VIN - VOUT"],
    [190, 34, "Dropout voltage"],
    [527, 34, "mV"],
    [110, 42, "Legacy chip"],
    [452, 42, "180"]
  ]);
  assert.equal(rows.length, 2);
  assert.ok(rows.every((row) => row.key === "dropoutVoltage"));
  assert.ok(rows.every((row) => row.parameter === "Dropout voltage"));
});

/**
 * THREE READING RULES THE REGULATOR CLASS FORCED, 2026-09-04.
 *
 * All three were found by pointing the existing reader at six regulator
 * datasheets. None of them is about regulators: each is a general rule that
 * happened to cost nothing until a document exercised it.
 */

test("a printed symbol SHORTER than ours is an abbreviation, not a contradiction", () => {
  // ST writes a dropout voltage `Vd`. Our vocabulary spells it `VDO`, and the
  // near-miss veto fired in BOTH directions, so the page's own correct symbol
  // vetoed the row. Four regulator datasheets lost their dropout voltage to
  // this - the parameter that decides the whole device class - and LM139AQML-SP
  // lost its open-loop gain.
  const rows = read([
    ...HEADER,
    [58, 30, "Vd"],
    [110, 30, "Dropout voltage"],
    [452, 30, "2"],
    [529, 30, "V"]
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].key, "dropoutVoltage");
});

test("a printed symbol LONGER than ours still vetoes, which is the case the rule exists for", () => {
  // `IQSD` against an accepted `IQ` carries a qualifier ours does not, and that
  // qualifier is what makes it a different row: a shutdown current read as a
  // supply current is a factor of a thousand.
  const rows = read([
    ...HEADER,
    [58, 30, "IQSD"],
    [110, 30, "Quiescent current"],
    [452, 30, "1"],
    [529, 30, "uA"]
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].key, null, "the row is KEPT, and it is not named as a quiescent current");
});

test("the same description in a different dimension is a different quantity", () => {
  // `Line regulation` is a SLOPE in ppm/V on a voltage reference and a CHANGE
  // over a stated range in mV on a regulator. They differ by four orders of
  // magnitude, and only the unit can tell them apart.
  const slope = read([
    ...HEADER,
    [110, 30, "Line regulation"],
    [452, 30, "1"],
    [529, 30, "ppm/V"]
  ]);
  assert.equal(slope[0].key, "lineRegulation");

  const change = read([
    ...HEADER,
    [110, 50, "Line regulation"],
    [452, 50, "7"],
    [529, 50, "mV"]
  ]);
  assert.equal(change[0].key, "lineRegulationOverRange");

  // A percentage is the regulator's other spelling of the same statement.
  const percent = read([
    ...HEADER,
    [110, 70, "Load regulation"],
    [452, 70, "0.1"],
    [529, 70, "%"]
  ]);
  assert.equal(percent[0].key, "loadRegulationOverRange");
});

test("a unit that fits NEITHER reading leaves the row unnamed", () => {
  // Promoting to the alternative on absence rather than on proof is how an
  // allowlist starts guessing. A line regulation printed in hertz is not a
  // regulator's statement either.
  const rows = read([
    ...HEADER,
    [110, 30, "Line regulation"],
    [452, 30, "1"],
    [529, 30, "Hz"]
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].key, null);
});

test("a table CAPTION that names the part is a scope", () => {
  // `headingAccepts` allows a short lead-in before the section name and
  // `scopeOf` demanded it at position zero, so `Table 3. Electrical
  // characteristics of L7805A` was accepted as a heading and yielded NO scope.
  // The seven per-voltage tables in a 78xx family datasheet all merged into one
  // block, and whichever row came first silently became the part.
  const rows = readPage(
    toRows(
      spans([
        [204, 1, "Table 3. Electrical characteristics of L7805A"],
        ...HEADER.map(([x, y, t]) => [x, y + 10, t] as [number, number, string]),
        [110, 40, "Output voltage"],
        [452, 40, "5"],
        [529, 40, "V"]
      ])
    ),
    6,
    { header: null, scope: null }
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].scope, "L7805A", "the caption says which part this table describes");
});

test("a relation written with a Unicode operator is a CONDITION, not a description", () => {
  // Maxim writes `250mV ≤ VOUT ≤` with U+2264, and matching only `[=<>]` read
  // that as the row's own description. The cost, on MAX44242: the row carrying
  // its open-loop gain - min 134, typ 145 dB - was filed under the parameter
  // name `250mV ≤ VOUT ≤`, the gain was taken from an offset-current sub-row
  // instead, and the model shipped with an open-loop gain of 25 dB.
  //
  // Every conformance check passed except the offset, which came back 5% low
  // because a 25 dB follower attenuates its own offset. That was the only thing
  // in the product that noticed.
  const rows = read([
    ...HEADER,
    [242, 26, "250mV ≤ VOUT ≤"],
    [315, 26, "TA = +25°C"],
    [423, 26, "134"],
    [458, 26, "145"],
    [58, 33, "Open Loop Gain"],
    [204, 33, "AVOL"],
    [533, 33, "dB"]
  ]);
  const gain = rows.filter((r) => r.key === "openLoopGain");
  assert.equal(gain.length, 1, "the value row must attach to the label above it");
  assert.deepEqual(gain[0].values, { min: 134, typ: 145, max: null });
  assert.equal(gain[0].parameter, "Open Loop Gain");
});
