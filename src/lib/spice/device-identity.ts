import type { DeviceClassId } from "./model";

export interface DocumentDeviceIdentity {
  supported: DeviceClassId | null;
  unsupported: string | null;
  ambiguous: boolean;
}

/**
 * Identifies what the document says the product IS, independently of the
 * electrical rows that parameterise a model.
 *
 * Specification overlap is not identity: an ADC has propagation delays, and a
 * series reference has dropout voltage.  Only front-matter descriptions are
 * considered so an application section mentioning a comparator cannot
 * reclassify the component described by the datasheet.
 */
export function identifyDocumentDevice(pageTexts: readonly string[]): DocumentDeviceIdentity {
  const text = pageTexts.slice(0, 2).join("\n").toLowerCase().replace(/\s+/g, " ");
  const supported: Array<[DeviceClassId, RegExp]> = [
    ["instrumentation", /\binstrumentation\s+amplifier\b/],
    // Family datasheets commonly pluralise the title ("Operational
    // Amplifiers"), and several analogue houses use "Precision Amplifier" as
    // the product noun without spelling out "operational".  These are subject
    // identities, not parameters; neither form should make a readable op-amp
    // fall back to electrical-row guessing.
    ["opamp", /\b(?:operational\s+amplifiers?|op[ -]?amps?|precision\s+amplifiers?)\b/],
    ["comparator", /\bcomparator\b/],
    ["reference", /\b(?:voltage|bandgap)\s+reference\b/],
    ["ldo", /\b(?:low[ -]?dropout|linear)\s+(?:voltage\s+)?regulator\b|\bldo(?:\s+regulator)?\b/]
  ];
  const unsupported: Array<[string, RegExp]> = [
    ["wireless module", /\b(?:wi-?fi|bluetooth|wireless)\b.{0,80}\bmodule\b|\bmodule\b.{0,80}\b(?:wi-?fi|bluetooth|wireless)\b/],
    ["analog-to-digital converter", /\b(?:analog[- ]to[- ]digital converter|a\/d converter|adc)\b/],
    ["digital logic device", /\b(?:nor|nand|xor|xnor)\s+gate\b|\b(?:flip[- ]flop|shift register|logic gate)\b/],
    ["microcontroller", /\bmicrocontroller\b|\bmcu\b/],
    ["switching regulator", /\b(?:buck|boost|flyback|switching)\s+(?:converter|regulator)\b/],
    ["sensor", /\b(?:pressure|temperature|humidity|magnetic|inertial)\s+sensor\b/],
    ["clock device", /\b(?:clock generator|jitter attenuator|frequency synthesizer)\b/],
    ["passive component", /\b(?:ceramic|film|electrolytic)\s+capacitors?\b|\b(?:chip|fixed|thin[ -]?film|thick[ -]?film)\s+resistors?\b/],
    ["discrete semiconductor", /\brectifiers?\b|\b(?:switching|schottky|zener)\s+diodes?\b|\b(?:mosfet|field[ -]?effect transistor|bipolar transistor)\b/],
    ["optoelectronic isolator", /\b(?:optocouplers?|optoisolators?|photocouplers?)\b/],
    ["magnetic component", /\b(?:lan|pulse|power)\s+transformers?\b|\b(?:common[ -]?mode )?inductors?\b/],
    ["connector", /\b(?:ffc|fpc|board[ -]?to[ -]?board|wire[ -]?to[ -]?board)\s+connectors?\b/]
  ];

  const hits = [
    ...supported.flatMap(([id, pattern]) => {
      const match = pattern.exec(text);
      return match ? [{ at: match.index, supported: id, unsupported: null as string | null }] : [];
    }),
    ...unsupported.flatMap(([label, pattern]) => {
      const match = pattern.exec(text);
      return match ? [{ at: match.index, supported: null as DeviceClassId | null, unsupported: label }] : [];
    })
  ].sort((a, b) => a.at - b.at);
  const first = hits[0];
  const ties = first ? hits.filter((hit) => hit.at === first.at) : [];
  // The title/lead description appears before incidental internal blocks or
  // application comparisons, so the earliest positive identity is the subject.
  return {
    supported: ties.length === 1 ? first?.supported ?? null : null,
    unsupported: ties.length === 1 ? first?.unsupported ?? null : null,
    ambiguous: ties.length > 1
  };
}

/** Fixed-output families sometimes state several orderable voltages while a
 * bare family number names none of them.  This detects only explicit option
 * prose, never arbitrary voltage values in a specification table. */
export function statedOutputVoltageOptions(pageTexts: readonly string[]): number[] {
  const text = pageTexts.slice(0, 4).join("\n").replace(/\s+/g, " ");
  const windows = [...text.matchAll(/(?:output\s+voltage(?:s)?\s+(?:(?:option|selection)s?|available)|voltage\s+variants?\s+available)(.{0,420})/gi)];
  const values = new Set<number>();
  for (const window of windows) {
    for (const match of window[1].matchAll(/\b(0?\.\d+|\d{1,2}(?:\.\d+)?)\s*V\b/gi)) {
      const value = Number(match[1]);
      if (value > 0 && value <= 100) values.add(value);
    }
  }
  return [...values].sort((a, b) => a - b);
}
