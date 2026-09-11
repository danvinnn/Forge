import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPartRecord } from "../datasheet";
import { datasheetTextFromPages, type DatasheetText } from "../pdftext";

function doc(text: string): DatasheetText {
  return datasheetTextFromPages([text]);
}

test("a non-polar two-ended chip passive gets interchangeable numbered terminals", () => {
  const record = buildPartRecord(
    doc("Standard thick film chip resistors. CRCW series."),
    "CRCW0603.pdf",
    undefined,
    { packageType: "0603" }
  );
  assert.equal(record.pinCount.value, 2);
  assert.deepEqual(record.pins.value?.map((pin) => [pin.number, pin.name, pin.electricalType]), [
    ["1", "1", "passive"],
    ["2", "2", "passive"]
  ]);
  assert.equal(record.pins.method, "deterministic");
  assert.equal(record.pins.citation?.page, 1);
});

test("terminal derivation does not apply to networks, polarized parts, or unknown packages", () => {
  for (const [text, packageType] of [
    ["Thick film chip resistor network", "0603"],
    ["Polarized multilayer ceramic capacitor", "0603"],
    ["Standard thick film chip resistors", "custom"]
  ]) {
    const record = buildPartRecord(doc(text), "part.pdf", undefined, { packageType });
    assert.equal(record.pinCount.value, null);
    assert.equal(record.pins.value, null);
  }
});

test("a single marked axial diode gets a polarity-preserving CAD convention", () => {
  const record = buildPartRecord(
    doc("General Purpose Plastic Rectifier. Circuit configuration (TA = 25 °C unless otherwise noted)Single. Polarity: color band denotes cathode end. For bridge rectifier applications, see note 1."),
    "1N4007.pdf",
    undefined,
    { packageType: "DO-41 (DO-204AL)" }
  );
  assert.equal(record.pinCount.value, 2);
  assert.deepEqual(record.pins.value?.map((pin) => [pin.number, pin.name]), [["1", "K"], ["2", "A"]]);
  assert.equal(record.pins.citation?.page, 1);
  assert.match(record.notes.join("\n"), /1=K.*2=A/);
});

test("the common cathode-indicated-by-band wording establishes the same diode orientation", () => {
  const record = buildPartRecord(
    doc("Axial lead standard recovery rectifier. Cathode indicated by polarity band."),
    "rectifier.pdf",
    undefined,
    { packageType: "DO-204AL" }
  );
  assert.deepEqual(record.pins.value?.map((pin) => pin.name), ["K", "A"]);
});

test("an axial package alone does not invent diode polarity", () => {
  const record = buildPartRecord(
    doc("Dual diode array. Polarity: color band denotes cathode end."),
    "array.pdf",
    undefined,
    { packageType: "DO-41" }
  );
  assert.equal(record.pins.value, null);
});
