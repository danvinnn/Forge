/**
 * RULES.md 7 for parameters: two independent readings, or the user is told.
 *
 * The property under test throughout is that SILENCE IS NEVER AGREEMENT. A
 * value read once is flagged, not confirmed, and a disagreement shows BOTH
 * readings rather than picking a winner.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { confirmParameters, type ModelReadValue } from "../confirm";
import { readBlocks } from "../model";
import { flattenModelReading, SPEC_TABLE_PROMPT, type ModelSpecReading } from "../prompt";
import type { SpecRow } from "../specs";

function row(key: string, parameter: string, values: Partial<SpecRow["values"]>, unit: string): SpecRow {
  return {
    parameter,
    key,
    symbol: null,
    conditions: null,
    unit,
    values: { min: null, typ: null, max: null, ...values },
    group: null,
    scope: null,
    page: 7
  };
}

const ROWS: SpecRow[] = [
  row("openLoopGain", "Open-loop voltage gain", { min: 106, typ: 130 }, "dB"),
  row("gbw", "Gain-bandwidth product", { typ: 350 }, "kHz")
];

function agreeing(): ModelReadValue[] {
  return [
    { parameter: "Open-loop voltage gain", unit: "dB", group: null, min: 106, typ: 130, max: null },
    { parameter: "Gain-bandwidth product", unit: "kHz", group: null, min: null, typ: 350, max: null }
  ];
}

test("no second reading means FLAGGED, never confirmed", () => {
  const report = confirmParameters(readBlocks(ROWS)[0], ROWS, null);
  assert.equal(report.items[0].state, "flagged");
  assert.equal(report.items[0].because, "single-source");
  assert.match(report.items[0].detail, /one means only/);
});

test("two readings that agree are confirmed and ship silently", () => {
  const report = confirmParameters(readBlocks(ROWS)[0], ROWS, agreeing());
  assert.equal(report.items[0].state, "confirmed");
  assert.equal(report.flagged.length, 0);
});

test("a disagreement shows BOTH readings and picks no winner", () => {
  const theirs = agreeing();
  theirs[1].typ = 106; // the classic error: the adjacent row's value
  const report = confirmParameters(readBlocks(ROWS)[0], ROWS, theirs);
  assert.equal(report.items[0].state, "flagged");
  assert.equal(report.items[0].because, "readers-disagree");
  // Both numbers appear. Nothing here says which is right.
  assert.match(report.items[0].detail, /350/);
  assert.match(report.items[0].detail, /106/);
  assert.equal(/prefer|correct|use the/i.test(report.items[0].detail), false);
});

test("a unit disagreement surfaces as a value disagreement, because it is one", () => {
  // V/ms against V/us is a factor of 1000, and the dimension check cannot see it.
  const rows = [...ROWS, row("slewRate", "Slew rate", { typ: 0.16 }, "V/ms")];
  const theirs = [...agreeing(), { parameter: "Slew rate", unit: "V/us", group: null, min: null, typ: 0.16, max: null }];
  const report = confirmParameters(readBlocks(rows)[0], rows, theirs);
  assert.equal(report.items[0].state, "flagged");
  assert.equal(report.items[0].because, "readers-disagree");
});

test("a milli under the line is its own flagged item, with the consequence named", () => {
  const rows = [...ROWS, row("slewRate", "Slew rate", { typ: 0.16 }, "V/ms")];
  const report = confirmParameters(readBlocks(rows)[0], rows, null);
  const unit = report.items.find((i) => i.id === "unit-ambiguity");
  assert.ok(unit, "the ambiguous unit is not reported");
  assert.equal(unit!.state, "flagged");
  assert.match(unit!.detail, /factor of a thousand/);
});

test("a parameter block is ONE glance, not one flag per parameter", () => {
  // Sixteen parameters read once must not produce sixteen flags, or every part
  // would exceed MAX_FLAGGED and the whole half would refuse everything.
  const many: SpecRow[] = [
    ...ROWS,
    row("slewRate", "Slew rate", { typ: 0.16 }, "V/us"),
    row("offsetVoltage", "Input offset voltage", { typ: 2, max: 10 }, "uV"),
    row("quiescentCurrent", "Quiescent current", { typ: 17, max: 25 }, "uA"),
    row("openLoopOutputZ", "Open-loop output impedance", { typ: 2 }, "kOhm")
  ];
  const report = confirmParameters(readBlocks(many)[0], many, null);
  assert.equal(report.flagged.length, 1);
  assert.equal(report.overBudget, false);
});

test("both readings go through the SAME unit conversion", () => {
  // LM358 prints its gain as `70 V/mV`, which the record canonicalises to dB.
  // Converting one side only reported a disagreement where both readings said
  // exactly the same thing. A false disagreement is not a safe failure: it is
  // noise that teaches a user to click past the flags that matter.
  const rows: SpecRow[] = [
    row("openLoopGain", "Large signal voltage gain", { min: 70 }, "V/mV"),
    row("gbw", "Gain-bandwidth product", { typ: 350 }, "kHz")
  ];
  const theirs: ModelReadValue[] = [
    { parameter: "Large signal voltage gain", unit: "V/mV", group: null, min: 70, typ: null, max: null },
    { parameter: "Gain-bandwidth product", unit: "kHz", group: null, min: null, typ: 350, max: null }
  ];
  const report = confirmParameters(readBlocks(rows)[0], rows, theirs);
  assert.equal(report.items[0].state, "confirmed");
});

test("the SYMBOL joins the two readings when the wording differs", () => {
  // OPA2189 prints `Unity-gain Bandwith`. A model reading the page corrects the
  // vendor's typo, so a description-only join misses a row both readings got
  // right and reports it as single-source: quieter than the truth, never louder.
  const rows: SpecRow[] = [
    { ...row("openLoopGain", "Open-loop voltage gain", { typ: 130 }, "dB"), symbol: "AOL" },
    { ...row("gbw", "Gain-bandwith Product", { typ: 350 }, "kHz"), symbol: "GBW" }
  ];
  const theirs: ModelReadValue[] = [
    { parameter: "Open-loop voltage gain", symbol: "AOL", unit: "dB", group: null, min: null, typ: 130, max: null },
    { parameter: "Gain-bandwidth Product", symbol: "GBW", unit: "kHz", group: null, min: null, typ: 350, max: null }
  ];
  const report = confirmParameters(readBlocks(rows)[0], rows, theirs);
  assert.equal(report.items[0].state, "confirmed");
});

test("the join does not cross a block boundary the document drew", () => {
  // LMP7704-SP repeats its table for VS = 5 V and VS = 10 V, and states a
  // different gain in each. Joining across the two reports two CORRECT readings
  // as a disagreement, which is the "every input passes" shape: both readings
  // are right and the comparison is wrong.
  const rows: SpecRow[] = [
    { ...row("openLoopGain", "Open-loop voltage gain", { min: 84 }, "dB"), scope: "VS = 5 V" },
    { ...row("gbw", "Gain bandwidth", { typ: 2.5 }, "MHz"), scope: "VS = 5 V" }
  ];
  const theirs: ModelReadValue[] = [
    { parameter: "Open-loop voltage gain", unit: "dB", group: null, scope: "VS = 10 V", min: 100, typ: null, max: null },
    { parameter: "Open-loop voltage gain", unit: "dB", group: null, scope: "VS = 5 V", min: 84, typ: null, max: null },
    { parameter: "Gain bandwidth", unit: "MHz", group: null, scope: "VS = 5 V", min: null, typ: 2.5, max: null }
  ];
  const report = confirmParameters(readBlocks(rows)[0], rows, theirs);
  assert.equal(report.items[0].state, "confirmed");
});

test("a differently-worded scope does not break the join", () => {
  // The two readings describe one heading differently: `LM358, LM358A` against
  // `LM358 and LM358A`. Excluding on that mismatch matched NOTHING and reported
  // a fully corroborated part as zero of six. A wording difference is not proof
  // of a different block.
  const rows: SpecRow[] = [
    { ...row("openLoopGain", "Open-loop voltage gain", { typ: 100 }, "dB"), scope: "LM358, LM358A" },
    { ...row("gbw", "Gain bandwidth", { typ: 700 }, "kHz"), scope: "LM358, LM358A" }
  ];
  const theirs: ModelReadValue[] = [
    { parameter: "Open-loop voltage gain", unit: "dB", group: null, scope: "LM358 and LM358A", min: null, typ: 100, max: null },
    { parameter: "Gain bandwidth", unit: "kHz", group: null, scope: "LM358 and LM358A", min: null, typ: 700, max: null }
  ];
  assert.equal(confirmParameters(readBlocks(rows)[0], rows, theirs).items[0].state, "confirmed");
});

test("the prompt asks for the whole table and forbids filling blanks", () => {
  // The prompt is the cache key: widening it later re-reads the corpus for
  // money, so what it asks for is checked here rather than discovered.
  assert.match(SPEC_TABLE_PROMPT, /WHOLE table, not a selection/);
  assert.match(SPEC_TABLE_PROMPT, /Do NOT copy the\s*\n\s*typical into them/);
  assert.match(SPEC_TABLE_PROMPT, /post-TID, post-HDR, post-LDR/); // radiation corners
  assert.match(SPEC_TABLE_PROMPT, /Absolute Maximum Ratings/); // and what to exclude
  assert.match(SPEC_TABLE_PROMPT, /micro sign as the letter m/); // the unit trap
  assert.match(SPEC_TABLE_PROMPT, /one grade's minimum beside/); // no merging grades
  assert.match(SPEC_TABLE_PROMPT, /Do not convert units/);
});

test("a model reading flattens to one entry per column group", () => {
  const reading: ModelSpecReading = {
    tables: [
      {
        heading: "Electrical Characteristics VS = 5 V",
        appliesTo: "VS = 5 V",
        columnGroups: ["LT1013AM", "LT1013M"],
        rows: [
          {
            parameter: "Input Offset Voltage",
            symbol: "VOS",
            conditions: null,
            unit: "uV",
            values: [
              { group: "LT1013AM", min: null, typ: 80, max: 300 },
              { group: "LT1013M", min: null, typ: 110, max: 550 }
            ]
          }
        ]
      }
    ]
  };
  const flat = flattenModelReading(reading);
  assert.equal(flat.length, 2);
  assert.deepEqual(flat.map((f) => f.group), ["LT1013AM", "LT1013M"]);
  assert.equal(flat[0].scope, "VS = 5 V");
  assert.equal(flat[1].max, 550);
});

test("a parameter named by the model alone is FLAGGED, with the row quoted", () => {
  // The numbers on such a row were read by both means. What has one source is
  // the claim that the row IS that quantity, so the flag has to say that and
  // not something vaguer.
  const rows: SpecRow[] = [
    { ...row("openLoopGain", "Differential voltage amplification", { typ: 130 }, "dB"), namedByModel: true },
    row("gbw", "Gain-bandwidth product", { typ: 350 }, "kHz")
  ];
  const theirs: ModelReadValue[] = [
    { parameter: "Differential voltage amplification", unit: "dB", group: null, means: "openLoopGain", min: null, typ: 130, max: null },
    { parameter: "Gain-bandwidth product", unit: "kHz", group: null, min: null, typ: 350, max: null }
  ];
  const report = confirmParameters(readBlocks(rows)[0], rows, theirs, {
    named: [{ parameter: "Differential voltage amplification", key: "openLoopGain", page: 7 }],
    conflicts: []
  });
  const item = report.items.find((i) => i.id === "parameter-naming");
  assert.ok(item, "a model-named parameter is not reported at all");
  assert.equal(item!.state, "flagged");
  assert.match(item!.detail, /Differential voltage amplification/);
  assert.match(item!.detail, /page 7/);
  // And the VALUES are still reported as agreed, because they are.
  assert.equal(report.items.find((i) => i.id === "parameters")!.state, "confirmed");
});

test("a parameter our own vocabulary named is not flagged as model-named", () => {
  const report = confirmParameters(readBlocks(ROWS)[0], ROWS, agreeing(), { named: [], conflicts: [] });
  assert.equal(report.items.find((i) => i.id === "parameter-naming"), undefined);
});

test("the two readings naming a row differently is reported, and changes nothing", () => {
  const report = confirmParameters(readBlocks(ROWS)[0], ROWS, agreeing(), {
    named: [],
    conflicts: [{ parameter: "Voltage gain", ours: "openLoopGain", theirs: "cmrr", page: 7 }]
  });
  const item = report.items.find((i) => i.id === "parameter-naming-conflict");
  assert.ok(item);
  assert.equal(item!.because, "readers-name-differently");
  // BOTH names appear, and the detail says which was used rather than which is right.
  assert.match(item!.detail, /openLoopGain/);
  assert.match(item!.detail, /cmrr/);
  assert.equal(/prefer|correct|more reliable/i.test(item!.detail), false);
});

test("the prompt asks the naming question, and asks it as a naming question", () => {
  assert.match(SPEC_TABLE_PROMPT, /WHICH STANDARD QUANTITY EACH ROW STATES/);
  assert.match(SPEC_TABLE_PROMPT, /openLoopGain/);
  assert.match(SPEC_TABLE_PROMPT, /gbw/);
  // It must not license changing what is REPORTED, only what it is called.
  assert.match(SPEC_TABLE_PROMPT, /NAMING question, not a reading one/);
  assert.match(SPEC_TABLE_PROMPT, /Use null whenever/);
});

test("a grade printed beside the value joins the two readings of it", () => {
  // OPA2277's offset voltage is 25 µV for one device and 20 µV for another,
  // printed as two lines of one row. Both readings had both right, and joining
  // across them reported a disagreement neither of them made.
  const rows: SpecRow[] = [
    { ...row("openLoopGain", "Open-loop voltage gain", { typ: 130 }, "dB"), grade: "OPA2277P, U" },
    { ...row("offsetVoltage", "Input offset voltage", { typ: 10, max: 25 }, "uV"), grade: "OPA2277P, U" }
  ];
  const theirs: ModelReadValue[] = [
    { parameter: "Input offset voltage", unit: "uV", group: null, grade: "OPA277P, U", min: null, typ: 10, max: 20 },
    { parameter: "Input offset voltage", unit: "uV", group: null, grade: "OPA2277P, U", min: null, typ: 10, max: 25 },
    { parameter: "Open-loop voltage gain", unit: "dB", group: null, grade: "OPA2277P, U", min: null, typ: 130, max: null }
  ];
  const report = confirmParameters(readBlocks(rows)[0], rows, theirs);
  assert.equal(report.items[0].state, "confirmed");
});

test("a grade we could not read does not exclude the model's reading", () => {
  // Reject on proof, never on absence: the same rule the scope follows. Our
  // failure to read a grade is not evidence of a different device, and gating
  // on it once took LM358 from one disagreement to zero of six corroborated.
  const rows: SpecRow[] = [
    row("openLoopGain", "Open-loop voltage gain", { typ: 130 }, "dB"),
    row("gbw", "Gain-bandwidth product", { typ: 350 }, "kHz")
  ];
  const theirs: ModelReadValue[] = [
    { parameter: "Open-loop voltage gain", unit: "dB", group: null, grade: "OPA277P, U", min: null, typ: 130, max: null },
    { parameter: "Gain-bandwidth product", unit: "kHz", group: null, grade: "OPA277P, U", min: null, typ: 350, max: null }
  ];
  assert.equal(confirmParameters(readBlocks(rows)[0], rows, theirs).items[0].state, "confirmed");
});

test("the prompt asks for a grade printed beside a value", () => {
  assert.match(SPEC_TABLE_PROMPT, /A GRADE PRINTED BESIDE THE VALUE, NOT ABOVE IT/);
  assert.match(SPEC_TABLE_PROMPT, /Use null where no device is named beside the value/);
});
