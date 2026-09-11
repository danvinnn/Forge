import assert from "node:assert/strict";
import test from "node:test";
import { parseBsdlPins, withBsdlPinout } from "../bsdl";
import { buildPartRecord } from "../datasheet";
import { extractedValue } from "../types";

const blank = () => buildPartRecord({ text: "", pages: [], pageCount: 0, truncated: false }, "acme.pdf");

const source = `
entity ACME is
  generic (PHYSICAL_PIN_MAP : string := "UFBGA4");
  constant UFBGA4 : PIN_MAP_STRING :=
    "VDD : A1, " &
    "GPIO(0) : A2, " &
    "GPIO(1) : B1, " &
    "VSS : (B2, C2)";
end ACME;`;

test("BSDL physical pin maps become package-designator pin rows", () => {
  assert.deepEqual(parseBsdlPins(source).map(({ number, name }) => ({ number, name })), [
    { number: "A1", name: "VDD" },
    { number: "A2", name: "GPIO0" },
    { number: "B1", name: "GPIO1" },
    { number: "B2", name: "VSS" },
    { number: "C2", name: "VSS" }
  ]);
});

test("a complete manufacturer BSDL fills an otherwise missing pin table", () => {
  const part = blank();
  part.pinCount = extractedValue(5, 1, null);
  const recovered = withBsdlPinout(part, source, "ACME_UFBGA4.bsdl");
  assert.equal(recovered.pins.value?.length, 5);
  assert.equal(recovered.pins.method, "vendor");
  assert.match(recovered.notes[0], /manufacturer BSDL/);
});

test("BSDL cannot overwrite a conflicting datasheet pin name", () => {
  const part = blank();
  part.pinCount = extractedValue(5, 1, null);
  part.pins = extractedValue([{ number: "A1", name: "GND", electricalType: "power" }], 1, null);
  assert.throws(() => withBsdlPinout(part, source, "ACME_UFBGA4.bsdl"), /disagrees/);
});
