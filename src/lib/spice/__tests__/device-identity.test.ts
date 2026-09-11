import assert from "node:assert/strict";
import test from "node:test";
import { identifyDocumentDevice, statedOutputVoltageOptions } from "../device-identity";

test("an ADC timing table cannot identify the document as a comparator", () => {
  const identity = identifyDocumentDevice([
    "ADS Example 8-channel 24-bit delta-sigma ADC Data Sheet. CS to DOUT propagation delay 20 ns."
  ]);
  assert.equal(identity.supported, null);
  assert.equal(identity.unsupported, "analog-to-digital converter");
});

test("a buffered reference remains a reference even when it states dropout", () => {
  const identity = identifyDocumentDevice([
    "High-Precision Buffered Voltage Reference. Low dropout voltage: 200 mV."
  ]);
  assert.equal(identity.supported, "reference");
  assert.equal(identity.unsupported, null);
});

test("family-title plurals and precision-amplifier titles identify op-amps", () => {
  assert.equal(identifyDocumentDevice(["Low-Power Operational Amplifiers"]).supported, "opamp");
  assert.equal(identifyDocumentDevice(["Ultra-Low Offset Precision Amplifiers"]).supported, "opamp");
});

test("digital gate front matter is outside generated behavioural support", () => {
  const identity = identifyDocumentDevice(["Radiation Hardened Triple 3-Input NOR Gate datasheet"]);
  assert.equal(identity.unsupported, "digital logic device");
});

test("a wireless module is not mislabeled from an incidental internal ADC", () => {
  const identity = identifyDocumentDevice([
    "ESP32-S3-WROOM-1 Wi-Fi and Bluetooth module. Includes a 12-bit ADC."
  ]);
  assert.equal(identity.supported, null);
  assert.equal(identity.unsupported, "wireless module");
});

test("passives and discrete devices do not offer behavioral-class corrections", () => {
  assert.equal(identifyDocumentDevice(["Chip Multilayer Ceramic Capacitors GRM Series"]).unsupported, "passive component");
  assert.equal(identifyDocumentDevice(["General Purpose Plastic Rectifier 1N4007"]).unsupported, "discrete semiconductor");
  assert.equal(identifyDocumentDevice(["Photocoupler LTV-817 Series"]).unsupported, "optoelectronic isolator");
  assert.equal(identifyDocumentDevice(["WE-LAN LAN Transformer"]).unsupported, "magnetic component");
});

test("only explicit output-option prose creates a family choice", () => {
  assert.deepEqual(
    statedOutputVoltageOptions(["Output voltage options are 1.024 V, 2.048 V, 2.500 V and 4.096 V."]),
    [1.024, 2.048, 2.5, 4.096]
  );
  assert.deepEqual(statedOutputVoltageOptions(["Output voltage 2.5 V at input voltage 5 V"]), []);
  assert.deepEqual(
    statedOutputVoltageOptions(["10 Voltage Variants Available: - 1.024V - 1.250V - 2.500V - 5.000V"]),
    [1.024, 1.25, 2.5, 5]
  );
});
