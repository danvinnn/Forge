import { extractedValue, type PartRecord, type PinRecord } from "./types";

export class BsdlPinoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BsdlPinoutError";
  }
}

function withoutComments(source: string): string {
  return source.replace(/--[^\r\n]*/g, " ");
}

function unquoteVhdl(value: string): string {
  return [...value.matchAll(/"((?:[^"]|"")*)"/g)]
    .map((match) => match[1].replace(/""/g, '"'))
    .join("");
}

function normalPinName(value: string): string {
  return value.trim().replace(/\((\d+)\)/g, "$1").replace(/\s+/g, "");
}

function electricalTypeForBsdlName(name: string): PinRecord["electricalType"] {
  // BSDL declares boundary-scan cells, not schematic directions. Supply rails
  // are the one direction-independent class its logical names establish.
  return /^(?:VDD|VSS|VCC|GND|VBAT|VDDA|VSSA|VREF[+-]?)\d*$/i.test(name.replace(/_/g, "")) ? "power" : "unspecified";
}

/**
 * Reads the IEEE 1149.1 `PIN_MAP_STRING` from a vendor BSDL file.
 *
 * BSDL is VHDL, but the physical mapping contract is intentionally small: a
 * named string constant selected by `PHYSICAL_PIN_MAP`, containing comma-
 * separated `logical-name : physical-designator` pairs. Parsing only that
 * declaration keeps this an evidence reader rather than a permissive VHDL
 * interpreter. Anything outside the contract is rejected instead of guessed.
 */
export function parseBsdlPins(source: string): PinRecord[] {
  const clean = withoutComments(source);
  const selected = /\bPHYSICAL_PIN_MAP\s*:\s*string\s*:=\s*"([A-Za-z0-9_+.-]+)"/i.exec(clean)?.[1];
  const constants = [...clean.matchAll(/\bconstant\s+([A-Za-z0-9_+.-]+)\s*:\s*PIN_MAP_STRING\s*:=\s*((?:"(?:[^"]|"")*"\s*(?:&\s*)?)+)\s*;/gi)];
  if (constants.length === 0) throw new BsdlPinoutError("The BSDL file contains no PIN_MAP_STRING declaration.");
  const chosen = selected
    ? constants.filter((match) => match[1].toUpperCase() === selected.toUpperCase())
    : constants;
  if (chosen.length !== 1) {
    throw new BsdlPinoutError(selected
      ? `The BSDL file does not define exactly one ${selected} physical pin map.`
      : "The BSDL file declares several physical pin maps but does not select one.");
  }

  const mapping = unquoteVhdl(chosen[0][2]);
  const pins: PinRecord[] = [];
  let at = 0;
  while (at < mapping.length) {
    while (at < mapping.length && /[\s,]/.test(mapping[at])) at += 1;
    if (at >= mapping.length) break;
    const colon = mapping.indexOf(":", at);
    if (colon < 0) throw new BsdlPinoutError("The selected BSDL pin map contains an incomplete mapping entry.");
    const name = normalPinName(mapping.slice(at, colon));
    at = colon + 1;
    while (at < mapping.length && /\s/.test(mapping[at])) at += 1;
    let physical = "";
    if (mapping[at] === "(") {
      const close = mapping.indexOf(")", at + 1);
      if (close < 0) throw new BsdlPinoutError("The selected BSDL pin map contains an unterminated physical-pin group.");
      physical = mapping.slice(at, close + 1);
      at = close + 1;
    } else {
      const token = /^[A-Za-z0-9]+/.exec(mapping.slice(at));
      if (!token) throw new BsdlPinoutError("The selected BSDL pin map contains an unsupported physical designator.");
      physical = token[0];
      at += token[0].length;
    }
    while (at < mapping.length && /\s/.test(mapping[at])) at += 1;
    if (at < mapping.length && mapping[at] !== ",") {
      throw new BsdlPinoutError("The selected BSDL pin map contains an unsupported or incomplete mapping entry.");
    }
    const numbers = physical.startsWith("(")
      ? physical.slice(1, -1).split(",").map((value) => value.trim()).filter(Boolean)
      : [physical];
    if (!name || numbers.length === 0 || numbers.some((number) => !/^[A-Za-z0-9]+$/.test(number))) {
      throw new BsdlPinoutError("The selected BSDL pin map contains an empty or unsupported physical designator.");
    }
    for (const number of numbers) pins.push({ number, name, electricalType: electricalTypeForBsdlName(name) });
    if (at < mapping.length && mapping[at] === ",") at += 1;
  }
  if (pins.length < 2) throw new BsdlPinoutError("The selected BSDL physical pin map is empty.");
  if (new Set(pins.map((pin) => pin.number.toUpperCase())).size !== pins.length) {
    throw new BsdlPinoutError("The selected BSDL physical pin map repeats a package designator.");
  }
  return pins;
}

const comparable = (value: string) => value.toUpperCase().replace(/[^A-Z0-9]/g, "");

/** Adds complete manufacturer BSDL evidence without overwriting a disagreement. */
export function withBsdlPinout(part: PartRecord, source: string, fileName: string): PartRecord {
  const vendorPins = parseBsdlPins(source);
  const existing = new Map((part.pins.value ?? []).map((pin) => [pin.number.toUpperCase(), pin]));
  const disagreements = vendorPins.filter((pin) => {
    const prior = existing.get(pin.number.toUpperCase());
    return prior && comparable(prior.name) !== comparable(pin.name);
  });
  if (disagreements.length > 0) {
    throw new BsdlPinoutError(
      `The manufacturer BSDL disagrees with the datasheet reading at ${disagreements.slice(0, 6).map((pin) => pin.number).join(", ")}.`
    );
  }

  const expected = part.pinCount.value ?? part.dimensions.leadCount.value;
  if (expected !== null && vendorPins.length !== expected) {
    throw new BsdlPinoutError(
      `The manufacturer BSDL maps ${vendorPins.length} physical terminals, but this selected package declares ${expected}.`
    );
  }
  return {
    ...part,
    pinCount: extractedValue(vendorPins.length, 1, null, "vendor"),
    pins: extractedValue(vendorPins, 1, null, "vendor"),
    notes: [`Pin names and physical designators imported from manufacturer BSDL ${fileName}.`, ...part.notes]
  };
}
