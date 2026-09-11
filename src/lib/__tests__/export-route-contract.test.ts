import { test } from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import { POST } from "../../app/api/export/route";
import { extractedValue, resolveForExport, unknown, type PartRecord, type PinRecord, type LeadWidth } from "../types";
import { labelForField } from "../review";

/**
 * The shape `/api/export` answers a refusal with, which the UI reads directly.
 *
 * The route makes a distinction the exporter hands it and the user depends on:
 * a refusal they can ANSWER carries `code: INPUT_REQUIRED` and a populated
 * `needs`, and a refusal they cannot carries `PACKAGE_NOT_CHARACTERISED` and an
 * empty one. The UI prompts on the first and only reports the second, so if the
 * two ever collapse into one the user is either asked for something no answer
 * exists for, or not asked for something one number away.
 *
 * `exporters-geometry.test.ts` already proves the exporter raises the right
 * distinction. This proves the route still carries it across the wire, which is
 * the half the UI actually sees.
 */

function citedValue<T>(value: T) {
  return extractedValue(value, 0.95, { page: 1, snippet: "fixture", region: null });
}

function pins(count: number): PinRecord[] {
  return Array.from({ length: count }, (_, index) => ({
    number: String(index + 1),
    name: `P${index + 1}`,
    electricalType: "passive" as const
  }));
}

/** A record complete enough to reach the footprint step, in the given package. */
/**
 * A record complete enough to reach the footprint step.
 *
 * `leadForm` is a parameter because it is what decides which of the two
 * datasheet-derived paths applies, and one of the cases below is a flat pack.
 * It used to be inferred from the letters "CFP" in the designator by a family
 * table; the drawing shows it, so the drawing is where it comes from.
 */
function exportablePart(
  packageType: string,
  pinCount: number,
  leadForm: "gullwing" | "straight" = "gullwing"
): PartRecord {
  return {
    id: "fixture",
    partNumber: citedValue("ACME1234"),
    manufacturer: citedValue("ACME"),
    packageType: citedValue(packageType),
    packageOutlineCode: unknown<string>(),
    jedecOutline: unknown<string>(),
    packageVariants: [],
  vendorLandPattern: null,
  exposedPad: false,
    pinCount: citedValue(pinCount),
    pins: citedValue(pins(pinCount)),
    dimensions: {
      bodyLengthMm: citedValue(8.65),
      bodyWidthMm: citedValue(3.9),
      bodyHeightMm: citedValue(1.5),
      pitchMm: citedValue(1.27),
      leadLengthMm: citedValue(0.8),
      leadCount: citedValue(pinCount),
      leadWidthMm: citedValue({ minMm: 0.35, maxMm: 0.5 }),
      leadSpanMm: citedValue({ minMm: 5.8, maxMm: 6.2 }), leadContactMm: citedValue({ minMm: 0.4, maxMm: 0.625 }),
      leadSpanCrossMm: unknown<{ minMm: number; maxMm: number }>(),
      thermalPadLengthMm: unknown<number>(),
      thermalPadWidthMm: unknown<number>(),
      landPadLengthMm: unknown<number>(),
      landPadWidthMm: unknown<number>(),
      landSpanMm: unknown<number>(),
      landSpanCrossMm: unknown<number>(),
      leadSides: citedValue<2 | 4>(2),
      leadForm: citedValue<"gullwing" | "nolead" | "straight">(leadForm),
      mounting: leadForm === "straight"
        ? citedValue<"smd" | "through-hole">("smd")
        : unknown<"smd" | "through-hole">(),
      leadDiameterMm: unknown<number>(),
      leadThicknessMm: unknown<LeadWidth>(),
      holeDiameterMm: unknown<number>(),
      vacantLeadSlot: unknown<number>(),
      leadsPerSide: unknown<string>(),
      solderMaskExpansionMm: unknown<number>(),
      solderMaskDefined: unknown<"solder-mask-defined" | "non-solder-mask-defined">(),
      thermalViaDiameterMm: unknown<number>(),
      thermalViaPitchMm: unknown<number>()
    },
    radiation: {
      tid: unknown<string>(),
      see: unknown<string>(),
      sel: unknown<string>(),
      qmlClass: unknown<string>()
    },
    sourceFileName: "fixture.pdf",
    notes: []
  };
}

/**
 * `from` is the caller's address, and it varies per request on purpose.
 *
 * The route rate-limits per client, so a test that walks a field list from one
 * address hits the limiter partway through and reports a 429 as if it were the
 * route's answer about the field. Distinct addresses keep each assertion about
 * the thing it is asserting.
 */
let caller = 0;
function post(body: unknown): Request {
  caller += 1;
  const payload =
    typeof body === "object" && body !== null
      ? { assurance: { evaluated: true, findings: [] }, ...(body as Record<string, unknown>) }
      : body;
  return new Request("http://localhost/api/export", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-forwarded-for": `10.0.0.${caller % 251}` },
    body: JSON.stringify(payload)
  });
}

function importedFootprint(pinCount = 8): string {
  const half = pinCount / 2;
  const pads = Array.from({ length: pinCount }, (_, index) => {
    const left = index < half;
    const row = left ? index : pinCount - 1 - index;
    return `(pad "${index + 1}" smd rect (at ${left ? -3 : 3} ${row - (half - 1) / 2}) (size 1 0.6) (layers "F.Cu" "F.Paste" "F.Mask"))`;
  });
  return `(footprint "ACME1234-SOIC" ${pads.join(" ")})`;
}

function importedEagleFootprint(pinCount = 8, pinThreeName = "P3"): string {
  const half = pinCount / 2;
  const pads = Array.from({ length: pinCount }, (_, index) => {
    const left = index < half;
    const row = left ? index : pinCount - 1 - index;
    return `<smd name="${index + 1}" x="${left ? -3 : 3}" y="${row - (half - 1) / 2}" dx="1" dy="0.6" layer="1"/>`;
  });
  const connections = pins(pinCount).map((pin) =>
    `<connect gate="G$1" pin="${pin.number === "3" ? pinThreeName : pin.name}" pad="${pin.number}"/>`
  );
  return `<eagle version="9.6"><drawing><library><packages><package name="8-pin SOIC">${pads.join("")}</package></packages><devicesets><deviceset name="ACME1234"><devices><device name="" package="8-pin SOIC"><connects>${connections.join("")}</connects></device></devices></deviceset></devicesets></library></drawing></eagle>`;
}

function importedSymbol(name = "ACME1234", wrong = false): string {
  const rows = pins(8).map((pin) =>
    `(pin passive line (at 0 0 0) (length 2.54) (name "${wrong && pin.number === "3" ? "WRONG" : pin.name}") (number "${pin.number}"))`
  );
  return `(kicad_symbol_lib (symbol "${name}" ${rows.join(" ")}))`;
}

const importedStep = `ISO-10303-21;
HEADER;
FILE_DESCRIPTION(('manufacturer body'),'2;1');
ENDSEC;
DATA;
#1=CARTESIAN_POINT('',(0.,0.,0.));
ENDSEC;
END-ISO-10303-21;
`;

test("the file boundary requires the CAD assurance result", async () => {
  const response = await POST(
    post({ part: exportablePart("8-pin SOIC", 8), format: "kicad", assurance: undefined })
  );
  assert.equal(response.status, 422);
  assert.equal((await response.json()).code, "ASSURANCE_REQUIRED");
});

test("the file boundary preserves many review notes without refusing a buildable library", async () => {
  const findings = Array.from({ length: 6 }, (_, index) => ({
    id: `review-${index}`,
    label: `Review ${index}`,
    state: "review",
    detail: "Needs a page check."
  }));
  const response = await POST(
    post({ part: exportablePart("8-pin SOIC", 8), format: "kicad", assurance: { evaluated: true, findings } })
  );
  assert.equal(response.status, 200);
  const zip = await JSZip.loadAsync(await response.arrayBuffer());
  const manifest = JSON.parse(await zip.file("manifest.json")!.async("string"));
  assert.equal(manifest.releaseAssurance.review.length, 6);
});

test("an official vendor symbol contradiction refuses imported copper", async () => {
  const response = await POST(post({
    part: exportablePart("8-pin SOIC", 8),
    format: "kicad",
    importedCad: { fileName: "ACME1234.kicad_mod", source: importedFootprint(), pinEvidence: importedSymbol("ACME1234", true) }
  }));
  assert.equal(response.status, 422);
  const payload = await response.json();
  assert.equal(payload.code, "FOOTPRINT_INVALID", payload.error);
  assert.match(payload.error, /pin names and numbering/i);
});

test("a complete manufacturer BSDL unlocks export when the datasheet pin table was unreadable", async () => {
  const part = exportablePart("8-pin SOIC", 8);
  part.pins = unknown();
  const mapping = Array.from({ length: 8 }, (_, index) => `P${index + 1} : ${index + 1}`).join(", ");
  const bsdl = `entity ACME is generic (PHYSICAL_PIN_MAP : string := "SOIC8"); constant SOIC8 : PIN_MAP_STRING := "${mapping}"; end ACME;`;
  const response = await POST(post({
    part,
    format: "kicad",
    importedPinout: { fileName: "ACME_SOIC8.bsdl", source: bsdl }
  }));
  assert.equal(response.status, 200, await response.clone().text());
});

test("a manufacturer BSDL with the wrong terminal count cannot unlock export", async () => {
  const part = exportablePart("8-pin SOIC", 8);
  part.pins = unknown();
  const response = await POST(post({
    part,
    format: "kicad",
    importedPinout: {
      fileName: "WRONG.bsdl",
      source: `entity ACME is generic (PHYSICAL_PIN_MAP : string := "MAP"); constant MAP : PIN_MAP_STRING := "P1 : 1, P2 : 2"; end ACME;`
    }
  }));
  assert.equal(response.status, 422);
  assert.equal((await response.json()).code, "VENDOR_PINOUT_UNUSABLE");
});

test("an unscopable optional symbol library does not discard valid imported copper", async () => {
  const ambiguous = `(kicad_symbol_lib ${importedSymbol("OTHER1").replace(/^\(kicad_symbol_lib |\)$/g, "")} ${importedSymbol("OTHER2").replace(/^\(kicad_symbol_lib |\)$/g, "")})`;
  const response = await POST(post({
    part: exportablePart("8-pin SOIC", 8),
    format: "kicad",
    importedCad: { fileName: "ACME1234.kicad_mod", source: importedFootprint(), pinEvidence: ambiguous }
  }));
  assert.equal(response.status, 200, await response.text());
});

test("an official EAGLE footprint crosses the ordinary route and emits native Altium", async () => {
  const response = await POST(post({
    part: exportablePart("8-pin SOIC", 8),
    format: "altium",
    importedCad: { fileName: "ACME1234.lbr", source: importedEagleFootprint() }
  }));
  const body = await response.arrayBuffer();
  assert.equal(response.status, 200, response.status === 200 ? undefined : Buffer.from(body).toString("utf8"));
  const archive = await JSZip.loadAsync(body);
  assert.ok(archive.file(/\.PcbLib$/).length === 1);
  const manifest = JSON.parse(await archive.file("manifest.json")!.async("string"));
  assert.match(manifest.footprint.source, /ACME1234\.lbr/);
  assert.ok(manifest.releaseAssurance.findings.some((finding: { id: string; state: string }) => finding.id === "pinout" && finding.state === "confirmed"));
});

test("an official EAGLE device contradiction refuses imported copper", async () => {
  const response = await POST(post({
    part: exportablePart("8-pin SOIC", 8),
    format: "kicad",
    importedCad: { fileName: "ACME1234.lbr", source: importedEagleFootprint(8, "WRONG") }
  }));
  assert.equal(response.status, 422);
  const payload = await response.json();
  assert.equal(payload.code, "FOOTPRINT_INVALID", payload.error);
  assert.match(payload.violations.join(" "), /EAGLE device/i);
});

test("a validated manufacturer STEP model replaces an unavailable generated body", async () => {
  const part = exportablePart("8-pin SOIC", 8);
  part.dimensions.bodyHeightMm = unknown();
  const response = await POST(post({
    part,
    format: "kicad",
    importedStep: { fileName: "ACME package.stp", source: importedStep }
  }));
  const body = await response.arrayBuffer();
  assert.equal(response.status, 200, response.status === 200 ? undefined : Buffer.from(body).toString("utf8"));
  const archive = await JSZip.loadAsync(body);
  const stepEntry = archive.file(/\.step$/)[0];
  assert.ok(stepEntry, `expected a STEP file in ${Object.keys(archive.files).join(", ")}`);
  assert.equal(await stepEntry.async("string"), importedStep);
  const footprint = await archive.file(/\.kicad_mod$/)[0].async("string");
  assert.match(footprint, /\$\{KIPRJMOD\}\/acme1234\.step/);
  const manifest = JSON.parse(await archive.file("manifest.json")!.async("string"));
  assert.equal(manifest.stepSupported, true);
  assert.match(manifest.stepNote, /manufacturer-authored ACME-package\.stp/i);
  assert.equal(manifest.omitted, undefined);
});

test("a truncated manufacturer STEP model is refused at the file boundary", async () => {
  const response = await POST(post({
    part: exportablePart("8-pin SOIC", 8),
    format: "kicad",
    importedStep: { fileName: "ACME package.step", source: importedStep.replace("ENDSEC;\nEND-ISO-10303-21;", "END-ISO-10303-21;") }
  }));
  assert.equal(response.status, 422);
  assert.match((await response.json()).error, /truncates a required Part 21 section/i);
});

test("Altium asks for missing installed height instead of writing zero beside a vendor STEP", async () => {
  const part = exportablePart("8-pin SOIC", 8);
  part.dimensions.bodyHeightMm = unknown();
  const response = await POST(post({
    part,
    format: "altium",
    importedStep: { fileName: "ACME package.step", source: importedStep }
  }));
  assert.equal(response.status, 422);
  const payload = await response.json();
  assert.equal(payload.code, "INPUT_REQUIRED");
  assert.deepEqual(payload.needs.map((need: { field: string }) => need.field), ["bodyHeightMm"]);
  assert.match(payload.error, /native Altium also requires the installed component height/i);
});

test("a supplied installed height lets Altium embed the exact vendor STEP", async () => {
  const part = exportablePart("8-pin SOIC", 8);
  part.dimensions.bodyHeightMm = unknown();
  const response = await POST(post({
    part,
    format: "altium",
    bodyHeightMm: 1.5,
    importedStep: { fileName: "ACME package.step", source: importedStep }
  }));
  const body = await response.arrayBuffer();
  assert.equal(response.status, 200, response.status === 200 ? undefined : Buffer.from(body).toString("utf8"));
  const archive = await JSZip.loadAsync(body);
  assert.ok(archive.file(/\.PcbLib$/).length === 1);
  assert.equal(await archive.file(/\.step$/)[0].async("string"), importedStep);
});

test("a refusal the user can answer arrives as INPUT_REQUIRED with the field named", async () => {
  const response = await POST(post({ part: exportablePart("14-lead CFP", 14, "straight"), format: "kicad" }));
  const payload = await response.json();

  assert.equal(response.status, 422);
  assert.equal(payload.code, "INPUT_REQUIRED");
  assert.ok(Array.isArray(payload.needs) && payload.needs.length > 0, "the UI prompts off this array");
  assert.equal(payload.needs[0].field, "formedLeadSpanMm");
  assert.equal(payload.needs[0].unit, "mm");
  assert.equal(payload.needs[0].scope, "install", "asked once per assembler, not once per part");
  assert.ok(payload.needs[0].label, "the prompt needs a label");
  assert.ok(payload.needs[0].why, "and a reason no datasheet carries it");
});

test("supplying the value over the wire produces the bundle", async () => {
  const response = await POST(
    // BOTH formed numbers. A flat pack's land is sized around a foot the
    // assembler makes, and the drawing prints neither that nor the seated span.
    post({
      part: exportablePart("14-lead CFP", 14, "straight"),
      format: "kicad",
      formedLeadSpanMm: 10.16,
      formedLeadContactMm: 0.6
    })
  );

  assert.equal(response.status, 200, "the same request that 422'd now succeeds");
  assert.equal(response.headers.get("Content-Type"), "application/zip");
  const bytes = await response.arrayBuffer();
  assert.ok(bytes.byteLength > 0);
  const zip = await JSZip.loadAsync(bytes);
  const manifest = JSON.parse(await zip.file("manifest.json")!.async("string"));
  assert.equal(manifest.releaseAssurance.outcome, "ready");
  assert.ok(Array.isArray(manifest.releaseAssurance.findings));
});

test("a package with nothing read for it asks for the land pattern instead of dead-ending", async () => {
  // Inverted deliberately on 2026-08-13. This asserted an EMPTY needs array, on
  // the reasoning that a missing land pattern was our gap rather than the user's
  // input. Measurement changed the reasoning: every shipping part was being fed
  // by a hand-typed family table, and closing the gap that way means inventing
  // numbers about parts. Asking is the only honest option left.
  //
  // Rewritten again on 2026-08-14, when that table was deleted. It used to name a
  // package the table had never heard of; there is no table to have heard of
  // anything now, so the case is stated as what it always really was: a record
  // with no land pattern and no package drawing read.
  const blank = exportablePart("12-Pin BGA", 12);
  blank.dimensions.leadSpanMm = unknown();
  blank.dimensions.leadContactMm = unknown();
  blank.dimensions.leadWidthMm = unknown();

  const response = await POST(post({ part: blank, format: "kicad" }));
  const payload = await response.json();

  assert.equal(response.status, 422);
  // INPUT_REQUIRED, not PACKAGE_NOT_CHARACTERISED: the route already told those
  // two apart by whether `needs` was populated, so making the refusal answerable
  // moved it into the answerable bucket on its own.
  assert.equal(payload.code, "INPUT_REQUIRED");
  assert.ok(payload.needs.length > 0, "the UI has something to prompt for");
});

test("a land pattern the user supplies is validated before it becomes copper", async () => {
  // As strictly as formedLeadSpanMm, and for the same reason: these are emitted
  // as pads. A units mistake would be built faithfully.
  for (const bad of [0, -1, 500, "1.1"]) {
    const response = await POST(
      post({ part: exportablePart("12-Pin BGA", 12), format: "kicad", landPadLengthMm: bad })
    );
    assert.equal(response.status, 400, `landPadLengthMm ${JSON.stringify(bad)} must be rejected`);
  }
  // 1 IS VALID and is asserted below, not here. It became a valid reading on
  // 2026-08-17 so a TO-220, TO-92 or SIP could be represented at all, and this
  // route went on rejecting it: the generator asked for it, the UI offered a box
  // that accepts it, and the answer came back 400. This test pinned that.
  for (const bad of [0, 8, "2"]) {
    const response = await POST(
      post({ part: exportablePart("12-Pin BGA", 12), format: "kicad", leadSides: bad })
    );
    assert.equal(response.status, 400, `leadSides ${JSON.stringify(bad)} must be rejected`);
  }
  // Every value the record accepts is accepted here. A field the record admits
  // and the route refuses is an unanswerable question.
  for (const good of [1, 2, 3, 4]) {
    const response = await POST(
      post({ part: exportablePart("12-Pin BGA", 12), format: "kicad", leadSides: good })
    );
    assert.notEqual(response.status, 400, `leadSides ${good} must be accepted`);
  }
});

test("a nonsense lead span is refused before it reaches the generator", async () => {
  for (const span of [0, -1, 500, "10.16"]) {
    const response = await POST(
      post({ part: exportablePart("14-lead CFP", 14, "straight"), format: "kicad", formedLeadSpanMm: span })
    );
    assert.equal(response.status, 400, `formedLeadSpanMm ${JSON.stringify(span)} must be rejected`);
  }
});

test("an irregular small bottom-terminal package asks once for its exact numbered lands and then ships them", async () => {
  const part = exportablePart("XDFN4", 4);
  part.dimensions.leadForm = citedValue<"gullwing" | "nolead" | "straight">("nolead");
  part.dimensions.mounting = citedValue<"smd" | "through-hole">("smd");
  part.dimensions.leadSpanMm = unknown();
  part.dimensions.leadContactMm = unknown();
  part.dimensions.leadWidthMm = unknown();
  part.dimensions.leadSides = unknown();

  const first = await POST(post({ part, format: "kicad" }));
  const question = await first.json();
  assert.equal(first.status, 422);
  assert.equal(question.code, "INPUT_REQUIRED");
  assert.deepEqual(question.needs.map((need: { field: string }) => need.field), ["terminalPads"]);
  assert.equal(question.needs[0].unit, "terminal-layout");

  const terminalPads = [
    { number: "1", xMm: -0.325, yMm: 0.48, widthMm: 0.26, heightMm: 0.24, shape: "rect" },
    { number: "2", xMm: -0.325, yMm: -0.48, widthMm: 0.26, heightMm: 0.24, shape: "rect" },
    { number: "3", xMm: 0.325, yMm: -0.48, widthMm: 0.26, heightMm: 0.24, shape: "rect" },
    { number: "4", xMm: 0.325, yMm: 0.48, widthMm: 0.26, heightMm: 0.24, shape: "rect" }
  ];
  const incomplete = await POST(post({ part, format: "kicad", terminalPads: terminalPads.slice(0, 3) }));
  assert.equal(incomplete.status, 400);
  assert.match((await incomplete.json()).error, /Missing: 4/);

  const second = await POST(post({ part, format: "kicad", terminalPads }));
  const bytes = await second.arrayBuffer();
  assert.equal(second.status, 200, second.status === 200 ? undefined : Buffer.from(bytes).toString("utf8"));
  const zip = await JSZip.loadAsync(bytes);
  const footprint = await zip.file(/\.kicad_mod$/)[0].async("string");
  assert.match(footprint, /\(pad "1" smd rect \(at -0\.325 0\.480\) \(size 0\.260 0\.240\)/);
  const recordName = Object.keys(zip.files).find((name) => /\.json$/i.test(name) && name !== "manifest.json");
  assert.ok(recordName);
  const record = JSON.parse(await zip.file(recordName)!.async("string"));
  assert.equal(record.footprint.arrangement, "explicit-numbered-lands");
  assert.deepEqual(record.dimensions.terminalPads, terminalPads);
});

// ---------------------------------------------------------------------------
// Every question the generator can ask has an answer this route accepts
// ---------------------------------------------------------------------------

/**
 * The invariant: asking for a value the route rejects is worse than refusing.
 *
 * `leadsPerSide` and `vacantLeadSlot` were both in `RequiredInput["field"]` and
 * both absent from the route's accept-list, so a quad with unequal sides and a
 * five-lead SOT-23 each refused, named the value that would fix it, and then
 * dropped that value on the floor when it arrived. The user had no move.
 *
 * This walks the whole field union rather than the two that were broken, so the
 * next field added to an ask has to be plumbed before it can pass.
 */
const ASKABLE: Array<{ field: string; good: unknown; bad: unknown }> = [
  { field: "bodyLengthMm", good: 4.9, bad: 0 },
  { field: "bodyWidthMm", good: 3.9, bad: -1 },
  { field: "bodyHeightMm", good: 1.75, bad: 500 },
  { field: "leadDiameterMm", good: 0.5, bad: 0 },
  { field: "pitchMm", good: 2.54, bad: -2 },
  { field: "formedLeadSpanMm", good: 10.16, bad: -1 },
  // The seated foot, asked for alongside the span since 2026-08-17. An unformed
  // lead has none until the assembler's die makes one, so no datasheet prints
  // it. Bounded at 5 mm: a foot is a feature of one lead, not a distance across
  // the package, so 500 is a typo or a different dimension.
  { field: "formedLeadContactMm", good: 0.6, bad: 500 },
  { field: "landPadLengthMm", good: 1.5, bad: 0 },
  { field: "landPadWidthMm", good: 0.6, bad: 500 },
  { field: "landSpanMm", good: 5.4, bad: "1.2" },
  // The cross-axis span, askable since 2026-08-18. A four-sided package has two
  // centre spans and the record carried one, so an unread second axis was being
  // read as "the same as the first", which is a guess dressed as a reading.
  { field: "landSpanCrossMm", good: 6.4, bad: 0 },
  { field: "leadSides", good: 3, bad: 5 },
  { field: "leadsPerSide", good: "14,12,14", bad: "6" },
  { field: "thermalPadLengthMm", good: 2.1, bad: 0 },
  { field: "thermalPadWidthMm", good: 2.1, bad: -2 },
  { field: "vacantLeadSlot", good: 2, bad: 0 },
  { field: "mounting", good: "smd", bad: "maybe" },
  { field: "thermalPadRotationDeg", good: 45, bad: 500 },
  {
    field: "terminalPads",
    good: pins(8).map((pin, index) => ({
      number: pin.number,
      xMm: index < 4 ? -3 : 3,
      yMm: index < 4 ? index - 1.5 : 6.5 - index,
      widthMm: 1,
      heightMm: 0.6,
      shape: "rect"
    })),
    bad: [
      { number: "1", xMm: -1, yMm: 0, widthMm: 1, heightMm: 0.6, shape: "rect" },
      { number: "1", xMm: 1, yMm: 0, widthMm: 1, heightMm: 0.6, shape: "rect" }
    ]
  }
];

/**
 * Every field the exporter ACTUALLY asks for, collected by asking it.
 *
 * The hand-written list below says what a good answer looks like for each field.
 * This says which fields exist, and it is gathered by driving the real generator
 * over records that are incomplete in different ways rather than by someone
 * remembering to add a line.
 *
 * That distinction is not theoretical. The through-hole path was written on
 * 2026-08-15 asking for a lead diameter under `landPadWidthMm` and a pitch under
 * `landPadLengthMm`. Both are real accepted fields, so the hand-written list
 * passed while the questions were unanswerable: supplying either filled a land
 * dimension and left the asked-for value missing, so the same question came back
 * forever. A list that is COLLECTED cannot miss that.
 */
async function askedFields(): Promise<Set<string>> {
  const { createExportZip, FootprintUnavailableError } = await import("../exporters");
  const fields = new Set<string>();

  const strip = (part: PartRecord, drop: string[]): PartRecord => {
    const next = JSON.parse(JSON.stringify(part)) as PartRecord;
    for (const field of drop) {
      (next.dimensions as unknown as Record<string, unknown>)[field] = unknown<number>();
    }
    return next;
  };

  const cases: PartRecord[] = [
    // Surface mount with no printed footprint and no drawing.
    strip(exportablePart("8-pin SOIC", 8), ["leadSpanMm", "leadContactMm", "leadWidthMm"]),
    // Nothing at all, including the body the 3D solid is built from.
    strip(exportablePart("8-pin SOIC", 8), [
      "leadSpanMm",
      "leadContactMm",
      "leadWidthMm",
      "bodyLengthMm",
      "bodyWidthMm",
      "bodyHeightMm",
      "leadSides"
    ]),
    // Untrimmed leads: the one question no datasheet answers.
    exportablePart("14-lead CFP", 14, "straight"),
    // An exposed pad whose size was not read.
    { ...exportablePart("8-pin SOIC", 8), exposedPad: true },
    // A quad whose sides do not divide.
    (() => {
      const part = exportablePart("QFN-38", 38);
      part.dimensions.leadSides = citedValue<2 | 4>(4);
      return part;
    })(),
    // Through-hole with nothing read.
    (() => {
      const part = strip(exportablePart("DIP-8", 8), ["leadSpanMm", "leadContactMm", "leadWidthMm", "pitchMm"]);
      part.dimensions.mounting = citedValue<"smd" | "through-hole">("through-hole");
      return part;
    })(),
    // A small bottom-terminal package whose drawing could not be reduced to
    // ordinary rows. Its one honest answer is the complete numbered layout.
    (() => {
      const part = strip(exportablePart("XDFN4", 4), ["leadSpanMm", "leadContactMm", "leadWidthMm", "leadSides"]);
      part.dimensions.leadForm = citedValue<"gullwing" | "nolead" | "straight">("nolead");
      part.dimensions.mounting = citedValue<"smd" | "through-hole">("smd");
      return part;
    })()
  ];

  for (const part of cases) {
    const resolved = resolveForExport(part);
    if (!resolved.ok) continue;
    try {
      await createExportZip(resolved.part, "kicad");
    } catch (error) {
      if (error instanceof FootprintUnavailableError) {
        for (const need of error.needs) fields.add(need.field);
      }
    }
  }
  return fields;
}

test("every field the generator actually asks for is in the accept-list", async () => {
  const asked = await askedFields();
  assert.ok(asked.size >= 6, `the fixtures should provoke several questions, got ${[...asked].join(", ")}`);
  const accepted = new Set(ASKABLE.map((entry) => entry.field));
  for (const field of asked) {
    assert.ok(accepted.has(field), `the exporter asks for "${field}" and nothing below tests that the route takes it`);
  }
});

test("every field the generator can ask for is accepted by the route", async () => {
  for (const entry of ASKABLE) {
    const response = await POST(
      post({ part: exportablePart("8-pin SOIC", 8), format: "kicad", [entry.field]: entry.good })
    );
    assert.notEqual(
      response.status,
      400,
      `${entry.field} is asked for by the exporter and must be accepted here`
    );
  }
});

test("and validated, because every one of them becomes geometry", async () => {
  for (const entry of ASKABLE) {
    const response = await POST(
      post({ part: exportablePart("8-pin SOIC", 8), format: "kicad", [entry.field]: entry.bad })
    );
    assert.equal(response.status, 400, `${entry.field} accepted ${JSON.stringify(entry.bad)}`);
  }
});

test("the export note says what the lands actually are, not what they usually are", async () => {
  // This header read "generated from the IPC-7351B land pattern" on every
  // export, including the common case where the lands are the vendor's own
  // printed footprint and IPC-7351B supplied only the courtyard margin. Those
  // are different claims to anyone signing off a board.
  const printed = exportablePart("8-pin SOIC", 8);
  printed.dimensions.landPadLengthMm = citedValue(1.95);
  printed.dimensions.landPadWidthMm = citedValue(0.6);
  printed.dimensions.landSpanMm = citedValue(4.95);
  printed.dimensions.leadSides = citedValue<2 | 4>(2);

  const response = await POST(post({ part: printed, format: "kicad" }));
  assert.equal(response.status, 200);
  const note = decodeURIComponent(response.headers.get("X-Forge-Export-Note") ?? "");
  assert.match(note, /printed in this datasheet/i, `note claimed: ${note}`);
  assert.doesNotMatch(note, /generated from the IPC-7351B land pattern/);
});

/**
 * A footprint that fails its OWN invariants is a refusal, not a crash.
 *
 * `validateGeometry` throws `FootprintInvalidError` when the built footprint
 * contradicts itself: lands overlapping, a pad for a pin the part does not
 * have, a courtyard inside its own copper. It is the only guard measured as
 * catching real defects, and it caught two quad packages shipping with shorted
 * corners on its first run.
 *
 * Nothing caught the error. `createExportZip` rethrows anything that is not a
 * `FootprintUnavailableError` carrying needs, and this route rethrows anything
 * that is neither that nor a `GeneratorUnavailableError`, so it left the handler
 * and Next.js turned it into a 500. The user saw "Export failed."
 *
 * So the guard fired correctly, withheld the bad file correctly, and then told
 * the user nothing at all. Its own message names what to check and says a
 * corrected value rebuilds the footprint, and that message was unreachable.
 *
 * `geometry-invariants.test.ts` proves the throw. This proves it arrives.
 */
test("a footprint that fails its own invariants is refused, not a 500", async () => {
  // A PIN TABLE THAT LISTS A PIN THE COUNT DOES NOT REACH, which is the defect
  // `geometryViolations` was written for and which the UI allows inline: rename
  // pin 8 to 9 in the record panel and the footprint comes out with pads 1..8
  // and the symbol with seven pins, every other check passing. Pin 9 simply does
  // not exist on the board and pad 8 connects to nothing in the netlist.
  //
  // This used to plant a `PAD` row and rely on the pad placer reading its
  // designator. That lookup could never fire on a real record (`normalizeModelPins`
  // strips non-numeric rows before they reach `part.pins`), so the test was
  // exercising a path only a hand-built record could reach, and it went green for
  // the wrong reason.
  const part = exportablePart("8-pin SOIC", 8);
  const renamed = [...pins(8)];
  renamed[7] = { ...renamed[7], number: "9" };
  const invalid: PartRecord = {
    ...part,
    pins: citedValue(renamed),
    dimensions: {
      ...part.dimensions,
      landPadLengthMm: citedValue(1.4),
      landPadWidthMm: citedValue(0.6),
      landSpanMm: citedValue(5.0),
      landSpanCrossMm: unknown<number>()
    }
  };

  const response = await POST(post({ part: invalid, format: "kicad" }));
  assert.notEqual(response.status, 500, "a guard doing its job must not read as a crash");
  assert.equal(response.status, 422);

  const payload = await response.json();
  assert.equal(payload.code, "FOOTPRINT_INVALID");
  assert.ok(Array.isArray(payload.violations) && payload.violations.length > 0, "what failed, itemised");
  assert.match(payload.error, /not valid and was not written/, "and the guard's own words reach the user");
});

// ---------------------------------------------------------------------------
// Naming a package is what supplies the pinout, so it has to happen first
// ---------------------------------------------------------------------------

/**
 * The half-fixed deadlock, closed 2026-08-18.
 *
 * A family datasheet that tabulates a pinout per package gets `pins` and
 * `pinCount` null on purpose: the model is told not to pick among several, and
 * returns them all labelled in `packagesInThisDocument`. The CHOOSER learned to read
 * those on 2026-08-16 and duly reported `ships` for each package. Pressing one
 * exported nothing.
 *
 * The route ran `resolveForExport` first and `asPackage` second, so the
 * traceability gate refused the record for having no pins one step before the
 * function that would have supplied them. Ten of the fifty-six hold-out parts
 * were reported as "missing pinCount,pins" with their pinouts sitting on the
 * record.
 *
 * The two halves must agree about the same click, which is what these assert.
 */
function familyRecord(): PartRecord {
  const base = exportablePart("SOIC-8", 8);
  const located = { page: 3, snippet: "PIN CONFIGURATION", region: null };
  return {
    ...base,
    // The part number names no package, so neither does the record.
    packageType: unknown<string>(),
    pins: unknown<PinRecord[]>(),
    pinCount: unknown<number>(),
    packageVariants: [
      { designator: "SOIC-8", family: "SOIC", leadCount: 8, inFrontMatter: true },
      { designator: "SOIC-14", family: "SOIC", leadCount: 14, inFrontMatter: true }
    ],
    // Each package carries its OWN pinout and its OWN measurements, which is
    // what the document prints: one outline drawing and one recommended
    // footprint per package it sells.
    packagesInThisDocument: [
      { packageType: "SOIC-8", pins: pins(8), exposedPad: false, citation: located, dimensions: soicDimensions(4.9) },
      { packageType: "SOIC-14", pins: pins(14), exposedPad: false, citation: located, dimensions: soicDimensions(8.65) }
    ]
  };
}

/** The fields a narrow SOIC's two drawings state, as the reader returns them. */
function soicDimensions(bodyLengthMm: number): Partial<PartRecord["dimensions"]> {
  return {
    bodyLengthMm: citedValue(bodyLengthMm),
    bodyWidthMm: citedValue(3.9),
    bodyHeightMm: citedValue(1.5),
    pitchMm: citedValue(1.27),
    leadSides: citedValue<2 | 4>(2),
    leadForm: citedValue<"gullwing" | "nolead" | "straight">("gullwing"),
    landPadLengthMm: citedValue(1.55),
    landPadWidthMm: citedValue(0.6),
    landSpanMm: citedValue(5.4)
  };
}

test("a family datasheet exports once the caller names which package", async () => {
  const part = familyRecord();

  const unnamed = await POST(post({ part, format: "kicad" }));
  assert.equal(unnamed.status, 422, "with no package named there is still nothing to build");
  assert.equal((await unnamed.json()).code, "INCOMPLETE_EXTRACTION");

  // Naming one is not new information about the part. It says WHICH of the
  // readings already on the record is the one being ordered, and NOTHING else is
  // supplied: the pinout, the drawings and the printed footprint were all read
  // for this package and stored against it.
  const named = await POST(post({ part, format: "kicad", packageType: "SOIC-8" }));

  assert.equal(named.status, 200, "one click, no questions: it was all on the record");
  assert.equal(named.headers.get("Content-Type"), "application/zip");
});

test("the pins that get built are the named package's own, not the other's", async () => {
  // The failure this rules out is worse than a refusal: a fourteen-pin table
  // reaching an eight-pin footprint. `asPackage` refuses a pinout that
  // contradicts the designator, so the wrong table cannot silently become pads.
  const part = familyRecord();

  const fourteen = await POST(post({ part, format: "kicad", packageType: "SOIC-14" }));
  assert.equal(fourteen.status, 200, "the fourteen-pin package builds from the fourteen-pin table");

  // A package this document tabulates nothing for is refused rather than given
  // whichever table happened to be first.
  const absent = await POST(post({ part, format: "kicad", packageType: "VQFN-16" }));
  assert.equal(absent.status, 422, "no table for it means no pinout, and no footprint");
  assert.equal((await absent.json()).code, "INCOMPLETE_EXTRACTION");
});

test("naming a package cannot substitute a pinout past an unrelated gap", async () => {
  // The substitution is allowed only when the pinout is the ONLY thing missing.
  // A record short of a part number has a different problem, and filling in pins
  // would move the refusal rather than answer it.
  const part = { ...familyRecord(), partNumber: unknown<string>() };
  const response = await POST(post({ part, format: "kicad", packageType: "SOIC-8" }));

  assert.equal(response.status, 422);
  const payload = await response.json();
  assert.equal(payload.code, "INCOMPLETE_EXTRACTION");
  assert.ok(payload.missing.includes("partNumber"), "and it still says what is actually wrong");
});

/**
 * EVERY REFUSAL NAMES ITS FIELDS, and the screen shows them.
 *
 * Reported 2026-08-24 as "I got an export failed error with LMP7704-SP". The
 * route was doing its job: it answered 422 with `code: INCOMPLETE_EXTRACTION`
 * and `missing: ["pinCount", "pins"]`, which is the whole truth. The screen
 * handled `INPUT_REQUIRED` and let everything else fall through to a generic
 * error, so the user was shown "required values were not extracted from the
 * datasheet. Fill them in before exporting" and never told which values, or
 * that the pinout was the thing that had not been read.
 *
 * The same shape as every other defect in this repo's history: the information
 * existed, was carried across the wire, and was discarded by the last hop.
 *
 * These tests pin the wire format the UI now reads. If a field list stops being
 * sent, or a code is renamed, this fails here rather than silently returning
 * the screen to a sentence that names nothing.
 */

test("an incomplete record is refused WITH the list of what was never read", async () => {
  const part = exportablePart("SOIC-8", 8);
  part.pins = unknown<PinRecord[]>();
  part.pinCount = unknown<number>();

  const response = await POST(post({ part, format: "kicad" }));
  assert.equal(response.status, 422);

  const payload = await response.json();
  assert.equal(payload.code, "INCOMPLETE_EXTRACTION");
  assert.ok(Array.isArray(payload.missing), "the UI renders this array");
  assert.ok(payload.missing.length > 0, "a refusal that names nothing is what the user complained about");
  assert.ok(payload.missing.includes("pins"), "and it names the pinout specifically");

  // The field paths must be the ones the label table knows, or the screen shows
  // raw source identifiers to an engineer.
  for (const field of payload.missing as string[]) {
    assert.notEqual(labelForField(field), field, `${field} has a human name`);
  }
});

test("an untraceable record is refused WITH the list of what could not be located", async () => {
  // A record that would otherwise build, with ONE value nobody can locate. The
  // family fixture is deliberately unresolved until a package is named, so it
  // trips the missing check first and never reaches the traceability one.
  const part = exportablePart("SOIC-8", 8);
  part.dimensions.pitchMm = { value: 1.27, confidence: 0.5, method: "vlm", citation: null };

  const response = await POST(post({ part, format: "kicad" }));
  assert.equal(response.status, 422);

  const payload = await response.json();
  assert.equal(payload.code, "UNTRACEABLE_EXTRACTION");
  assert.ok(Array.isArray(payload.untraceable) && payload.untraceable.length > 0);
  assert.ok(payload.untraceable.includes("dimensions.pitchMm"));
  for (const field of payload.untraceable as string[]) {
    assert.notEqual(labelForField(field), field, `${field} has a human name`);
  }
});

test("the two refusals stay distinct, because they need opposite things from a person", () => {
  // An untraceable value is ON the record and needs checking against the page
  // it claims. A missing one was never read at all, and no amount of confirming
  // will produce it. Collapsing them into one message is how "fill them in"
  // ended up being said about a pinout that did not exist to be filled in.
  const absent = resolveForExport({ ...exportablePart("SOIC-8", 8), pins: unknown<PinRecord[]>(), pinCount: unknown<number>() });
  assert.equal(absent.ok, false);
  assert.ok(absent.ok === false && absent.missing.length > 0);
  assert.ok(absent.ok === false && !absent.untraceable?.length);

  const uncited = exportablePart("SOIC-8", 8);
  uncited.dimensions.pitchMm = { value: 1.27, confidence: 0.5, method: "vlm", citation: null };
  const shaky = resolveForExport(uncited);
  assert.equal(shaky.ok, false);
  assert.ok(shaky.ok === false && shaky.missing.length === 0);
  assert.ok(shaky.ok === false && (shaky.untraceable?.length ?? 0) > 0);
});

test("a name the format cannot write is a refusal, not a 500", async () => {
  // Reported 2026-08-24 as "export failed" on an LMP7704-SP. The emitter
  // refused correctly, nothing in the route caught it, Next answered 500, and
  // the screen showed the bare words "Export failed." The user could not tell a
  // working guard from a broken server.
  //
  // The character in that report was a U+2013 en dash, which turned out to be a
  // bug in the encoder rather than a real limit and now encodes fine. This is
  // about a character that genuinely does not fit.
  const part = exportablePart("SOIC-8", 8);
  const pinTable = part.pins.value as PinRecord[];
  pinTable[0] = { ...pinTable[0]!, name: `IN${String.fromCodePoint(0x4e2d)}` };

  const response = await POST(post({ part, format: "altium" }));

  assert.notEqual(response.status, 500, "a refusal is never a crash");
  assert.equal(response.status, 422);

  const payload = await response.json();
  assert.equal(payload.code, "FORMAT_CANNOT_ENCODE");
  assert.match(payload.error, /U\+4E2D/, "it names the character");
  assert.deepEqual(payload.availableFormats, ["kicad"], "and where the user can still go");
});

test("the en dash that caused the report exports cleanly in both formats", async () => {
  // The real fix for the reported case: Windows-1252 holds an en dash at 0x96
  // and always did, so nothing about this part should have refused.
  const part = exportablePart("SOIC-8", 8);
  const pinTable = part.pins.value as PinRecord[];
  pinTable[0] = { ...pinTable[0]!, name: `IN A${String.fromCodePoint(0x2013)}` };

  for (const format of ["kicad", "altium"] as const) {
    const response = await POST(post({ part, format }));
    assert.equal(response.status, 200, `${format} writes the en dash`);
    assert.equal(response.headers.get("Content-Type"), "application/zip");
  }
});

test("a preview asks for the same build and gets the geometry instead of the bytes", async () => {
  // The screen draws the footprint the user is about to take. A part that had to
  // be asked a question has no chooser geometry until it is answered - and a
  // ceramic flat pack always is - so the preview would go missing on exactly the
  // packages this product is for.
  //
  // The point of routing it through here rather than computing one on the client
  // is that it CANNOT be a different footprint: everything above this branch has
  // already run, including `createExportZip` itself.
  const zipped = await POST(
    post({
      part: exportablePart("14-lead CFP", 14, "straight"),
      format: "kicad",
      formedLeadSpanMm: 10.16,
      formedLeadContactMm: 0.6
    })
  );
  assert.equal(zipped.status, 200);
  assert.equal(zipped.headers.get("Content-Type"), "application/zip");

  const preview = await POST(
    post({
      part: exportablePart("14-lead CFP", 14, "straight"),
      format: "kicad",
      formedLeadSpanMm: 10.16,
      formedLeadContactMm: 0.6,
      preview: true
    })
  );
  assert.equal(preview.status, 200);
  const payload = await preview.json();
  assert.ok(payload.geometry, "the preview carries the geometry");
  assert.ok(Array.isArray(payload.geometry.pads) && payload.geometry.pads.length > 0);
  assert.ok(payload.geometry.courtyard.halfWidthMm > 0);
  assert.ok(payload.geometry.body.halfWidthMm > 0);
  // One land per lead, which is what the drawing has to show.
  assert.equal(payload.geometry.pads.filter((pad: { number: string }) => pad.number !== "").length, 14);
});

test("a preview of a build that cannot happen refuses exactly as the build would", async () => {
  // A picture must never be available where the files are not: that would put a
  // footprint on the screen that no click can produce.
  const response = await POST(
    post({ part: exportablePart("14-lead CFP", 14, "straight"), format: "kicad", preview: true })
  );
  assert.equal(response.status, 422);
  const payload = await response.json();
  assert.equal(payload.code, "INPUT_REQUIRED");
  assert.ok(Array.isArray(payload.needs) && payload.needs.length > 0);
});
