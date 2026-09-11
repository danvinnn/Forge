/**
 * Product-independent black-box corpus, frozen 2026-09-07 before any selected
 * datasheet was opened or sent to Forge.
 *
 * Selection is from the population a component engineer can present, not from
 * Forge's emitters or recognisers. Unsupported devices and packages stay in the
 * panel: a correct recovery/question/refusal is as important as a correct file.
 */

export const UNIVERSE_CELLS = [
  // Device populations.
  "device:mcu", "device:converter", "device:clock-rf", "device:sensor",
  "device:module", "device:transistor", "device:diode", "device:opto",
  "device:magnetic", "device:connector", "device:resistor", "device:capacitor",
  "device:opamp", "device:comparator", "device:reference", "device:ldo",
  "device:instrumentation", "device:switching-regulator", "device:rad-hard-logic",
  // Physical construction populations.
  "package:grid-array", "package:quad-leaded", "package:no-lead-thermal",
  "package:lga", "package:castellated-module", "package:dual-row-smd",
  "package:through-hole", "package:axial", "package:custom-mechanical",
  "package:chip-passive", "package:ceramic-flatpack",
  // Document/evidence populations visible before running Forge.
  "document:modern", "document:legacy", "document:family", "document:multi-package",
  "document:long", "document:separate-mechanical", "document:high-reliability",
  "evidence:pin-table", "evidence:pin-drawing", "evidence:printed-land-pattern",
  "evidence:outline-only", "evidence:vendor-cad", "evidence:package-choice",
  // SPICE source populations, defined by what vendors publish, not what Forge supports.
  "spice:behavioral-spec", "spice:primitive-model", "spice:standalone-subckt",
  "spice:multi-subckt", "spice:switching-behavior", "spice:digital-or-no-behavior",
  // Acquisition and market populations.
  "acquisition:search", "acquisition:upload", "market:commercial",
  "market:automotive", "market:aerospace", "vendor:major", "vendor:unfamiliar"
] as const;

export type UniverseCell = (typeof UNIVERSE_CELLS)[number];

export interface UniversePart {
  partNumber: string;
  manufacturer: string;
  orderable?: string;
  packageHint?: string;
  cells: UniverseCell[];
  /** Selection rationale based only on catalog/product metadata. */
  selection: string;
}

const common = (...cells: UniverseCell[]): UniverseCell[] => [
  "document:modern", "acquisition:search", "acquisition:upload", "market:commercial", ...cells
];

export const UNIVERSE_CORPUS: UniversePart[] = [
  {
    partNumber: "STM32H573II", manufacturer: "STMicroelectronics", orderable: "STM32H573IIK6",
    packageHint: "UFBGA176+25", selection: "high-pin-count secure MCU in a grid package",
    cells: common("device:mcu", "package:grid-array", "document:family", "document:multi-package", "document:long", "evidence:pin-table", "evidence:vendor-cad", "evidence:package-choice", "spice:digital-or-no-behavior", "vendor:major")
  },
  {
    partNumber: "ADS131M08", manufacturer: "Texas Instruments", orderable: "ADS131M08IPBS",
    packageHint: "TQFP (PBS)", selection: "mixed-signal ADC with both leaded and no-lead orderings",
    cells: common("device:converter", "package:quad-leaded", "package:no-lead-thermal", "document:multi-package", "evidence:pin-table", "evidence:package-choice", "spice:digital-or-no-behavior", "vendor:major")
  },
  {
    partNumber: "SI5341B", manufacturer: "Skyworks", packageHint: "64-QFN",
    selection: "clock generator from a vendor absent from Forge's analog model scope",
    cells: common("device:clock-rf", "package:no-lead-thermal", "document:long", "evidence:pin-table", "spice:digital-or-no-behavior", "vendor:unfamiliar")
  },
  {
    partNumber: "BME280", manufacturer: "Bosch Sensortec", packageHint: "LGA-8",
    selection: "metal-lid environmental sensor in a land-grid package",
    cells: common("device:sensor", "package:lga", "evidence:pin-drawing", "evidence:printed-land-pattern", "spice:digital-or-no-behavior", "vendor:unfamiliar")
  },
  {
    partNumber: "ESP32-S3-WROOM-1", manufacturer: "Espressif", orderable: "ESP32-S3-WROOM-1-N8",
    packageHint: "castellated module", selection: "RF module with antenna keepout and exposed ground land",
    cells: common("device:module", "package:castellated-module", "document:family", "document:separate-mechanical", "evidence:pin-table", "evidence:printed-land-pattern", "spice:digital-or-no-behavior", "vendor:unfamiliar")
  },
  {
    partNumber: "BSS138P", manufacturer: "Nexperia", orderable: "BSS138P,215",
    packageHint: "SOT-23", selection: "discrete MOSFET with a primitive-model path",
    cells: common("device:transistor", "package:dual-row-smd", "evidence:pin-drawing", "evidence:outline-only", "spice:primitive-model", "vendor:major")
  },
  {
    partNumber: "1N4007", manufacturer: "Vishay", orderable: "1N4007-E3/54",
    packageHint: "DO-204AL", selection: "legacy axial rectifier family",
    cells: ["document:legacy", "document:family", "acquisition:search", "acquisition:upload", "market:commercial", "device:diode", "package:axial", "package:through-hole", "evidence:pin-drawing", "evidence:outline-only", "spice:primitive-model", "vendor:major"]
  },
  {
    partNumber: "LTV-817", manufacturer: "Lite-On", packageHint: "DIP-4",
    selection: "optoisolator sold in through-hole and surface-mount variants",
    cells: common("device:opto", "package:through-hole", "document:family", "document:multi-package", "evidence:pin-drawing", "evidence:package-choice", "spice:standalone-subckt", "vendor:unfamiliar")
  },
  {
    // The initially frozen catalogue transcription dropped the final zero. The
    // manufacturer's product table identifies 7490120110; correcting a typo is
    // not replacing a hard case with one Forge supports.
    partNumber: "7490120110", manufacturer: "Würth Elektronik", packageHint: "transformer",
    selection: "multi-winding magnetic with non-IC terminal geometry",
    cells: common("device:magnetic", "package:through-hole", "package:custom-mechanical", "document:separate-mechanical", "evidence:pin-drawing", "evidence:printed-land-pattern", "spice:multi-subckt", "vendor:unfamiliar")
  },
  {
    partNumber: "1-1734592-0", manufacturer: "TE Connectivity", packageHint: "FFC/FPC connector",
    selection: "electromechanical connector with mechanical keepouts and contacts",
    cells: common("device:connector", "package:custom-mechanical", "document:separate-mechanical", "evidence:pin-drawing", "evidence:vendor-cad", "spice:digital-or-no-behavior", "vendor:unfamiliar")
  },
  {
    partNumber: "CRCW060310K0FKEA", manufacturer: "Vishay", packageHint: "0603",
    selection: "ordering-code-specific member of a chip-resistor family",
    cells: common("device:resistor", "package:chip-passive", "document:family", "evidence:outline-only", "spice:primitive-model", "vendor:major")
  },
  {
    partNumber: "GRM188R71C104KA01D", manufacturer: "Murata", packageHint: "0603",
    selection: "ordering-code-specific multilayer capacitor in a large family",
    cells: common("device:capacitor", "package:chip-passive", "document:family", "evidence:outline-only", "spice:primitive-model", "vendor:unfamiliar")
  },
  {
    partNumber: "OPA810", manufacturer: "Texas Instruments", orderable: "OPA810IDBVR", packageHint: "SOT-23 (DBV)",
    selection: "high-speed operational amplifier with behavioral specifications",
    cells: common("device:opamp", "package:no-lead-thermal", "evidence:pin-table", "evidence:printed-land-pattern", "spice:behavioral-spec", "spice:standalone-subckt", "vendor:major")
  },
  {
    partNumber: "MAX40025", manufacturer: "Analog Devices", packageHint: "WLP",
    selection: "very-fast comparator in a wafer-level package",
    cells: common("device:comparator", "package:grid-array", "evidence:pin-drawing", "evidence:printed-land-pattern", "spice:behavioral-spec", "spice:standalone-subckt", "vendor:major")
  },
  {
    partNumber: "MCP1501", manufacturer: "Microchip", packageHint: "SOT-23-6",
    selection: "voltage-reference family with multiple fixed output orderings",
    cells: common("device:reference", "package:dual-row-smd", "document:family", "evidence:pin-table", "spice:behavioral-spec", "vendor:major")
  },
  {
    partNumber: "NCP163", manufacturer: "onsemi", packageHint: "XDFN-4",
    selection: "fixed-output low-noise LDO from an independently styled vendor",
    cells: common("device:ldo", "package:no-lead-thermal", "document:family", "evidence:pin-drawing", "spice:behavioral-spec", "market:automotive", "vendor:major")
  },
  {
    partNumber: "INA821", manufacturer: "Texas Instruments", orderable: "INA821IDR", packageHint: "SOIC (D)",
    selection: "instrumentation amplifier whose gain depends on an external resistor",
    cells: common("device:instrumentation", "package:dual-row-smd", "evidence:pin-table", "evidence:printed-land-pattern", "spice:behavioral-spec", "spice:standalone-subckt", "vendor:major")
  },
  {
    partNumber: "LT8609S", manufacturer: "Analog Devices", packageHint: "16-Lead LQFN",
    selection: "switching regulator whose dynamic behavior is topology-specific",
    cells: common("device:switching-regulator", "package:no-lead-thermal", "evidence:pin-table", "evidence:printed-land-pattern", "spice:switching-behavior", "spice:standalone-subckt", "market:automotive", "vendor:major")
  },
  {
    partNumber: "HCS27MS", manufacturer: "Renesas", orderable: "HCS27KMSR", packageHint: "14-lead ceramic flatpack",
    selection: "radiation-hardened logic with formed leads and legacy military presentation",
    cells: ["document:legacy", "document:high-reliability", "acquisition:search", "acquisition:upload", "market:aerospace", "device:rad-hard-logic", "package:ceramic-flatpack", "evidence:pin-table", "evidence:outline-only", "spice:digital-or-no-behavior", "vendor:unfamiliar"]
  }
];

/** Cross-risk combinations selected independently because each changes what a user can present. */
export const REQUIRED_UNIVERSE_PAIRS: ReadonlyArray<readonly [UniverseCell, UniverseCell]> = [
  ["document:family", "document:multi-package"],
  ["document:family", "evidence:package-choice"],
  ["document:legacy", "package:through-hole"],
  ["document:legacy", "market:aerospace"],
  ["document:long", "package:grid-array"],
  ["document:separate-mechanical", "package:custom-mechanical"],
  ["package:no-lead-thermal", "evidence:printed-land-pattern"],
  ["package:castellated-module", "evidence:printed-land-pattern"],
  ["package:ceramic-flatpack", "market:aerospace"],
  ["device:instrumentation", "spice:standalone-subckt"],
  ["device:switching-regulator", "spice:switching-behavior"],
  ["device:transistor", "spice:primitive-model"],
  ["device:magnetic", "spice:multi-subckt"],
  ["market:automotive", "package:no-lead-thermal"],
  ["vendor:unfamiliar", "acquisition:search"]
];
