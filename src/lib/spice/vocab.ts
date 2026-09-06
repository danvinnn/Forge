/**
 * EVERY VOCABULARY THIS FEATURE MATCHES ON, IN ONE PLACE, WITH ONE NORMALISER.
 *
 * `LEARNINGS.md` records four classes of defect that recur in this codebase.
 * Sixteen instances of them were found in the SPICE design before a line was
 * written (`SPICE.md` sections 29 to 35). Fourteen of the sixteen were a
 * vocabulary gap or a word-boundary trap, and every one of those was a
 * comparison made somewhere other than here, against a list written from memory.
 *
 * So there is exactly one normaliser and exactly one list per vocabulary, and a
 * test asserts the corpus never prints a term the lists lack.
 *
 * ## The traps these lists exist to close, each measured on a real datasheet
 *
 * - `^TYP$` cannot match `TYP(2)`. TI fuses footnote markers to header cells, so
 *   LM358's five pages of electrical characteristics were invisible.
 * - `^TYP$` cannot match `Typ.`. ST writes trailing periods, so TSV911 read
 *   ZERO parameters, silently, as a whole part.
 * - Stripping every non-letter from a symbol turns `IQ1` into `IQ`. On a dual
 *   amplifier that reads a per-channel current as the part's supply current.
 * - `AVOL` was missing from the open-loop-gain symbols, so LT1013 lost its gain.
 * - `SPECIFICATIONS` is ADI's word for the section TI calls `Electrical
 *   Characteristics`. Anchoring on one refuses the other.
 *
 * These are the same shape as `\bLQFP\b` failing to match `LQFP64`, which cost
 * this project three separate instances in two days.
 */

/**
 * Header and description text, normalised for comparison.
 *
 * Strips what vendors decorate a cell with and nothing else: footnote markers
 * (`TYP(2)`, `TYP (2)`, `Min[1]`), trailing punctuation (`Typ.`), surrounding
 * whitespace, and case.
 *
 * DIGITS INSIDE A WORD ARE KEPT. `LQFP64` must not become `LQFP`, and a
 * footnote marker is always bracketed, never fused into the middle of a word.
 *
 * ## Brackets, and the two Renesas datasheets that read NOTHING
 *
 * Renesas marks its footnotes with SQUARE brackets. `ISL71001M` heads its
 * Electrical Specifications table `Parameter | Test Conditions | Min[1] |
 * Typ[2] | Max[1] | Unit`, and because only round brackets were stripped,
 * `MIN[1]` did not equal `MIN`, `readHeader` found no header, and a 37-page
 * datasheet with a perfectly typeset table produced ZERO specification rows.
 *
 * A bracketed group of digits and nothing else is a footnote marker in every
 * document this reader has been pointed at. It is never a value, a unit or a
 * symbol, which is what makes stripping it safe rather than convenient.
 *
 * ## What is deliberately NOT stripped, and why
 *
 * A BARE trailing digit. `Typ1` appears on ADXL345 and VA10820 and is a
 * footnote marker there - but VA10820 also prints `tDV(Typ1)`, where the 1 is
 * part of the symbol, and `MAX232` is a part number that would become the
 * column header `MAX`. There is no way to tell the three apart from the text
 * alone: the PDF text layer stores the superscript as an ordinary `1`, so the
 * typography that distinguishes them is already gone by the time this runs.
 * Stripping it would read a part number as a column, which is worse than
 * missing a footnote.
 */
export function normaliseHeader(text: string): string {
  return text
    .normalize("NFKC") // fold look-alike code points; see foldUnicode in units.ts
    .replace(/[([{]\s*\d+\s*[)\]}]/g, "") // footnote marker, however the vendor brackets it
    .replace(/[\s.,:;]+$/g, "") // trailing punctuation
    .replace(/^[\s.,:;]+/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

/**
 * A parameter SYMBOL, normalised for comparison.
 *
 * Separators go, digits NEVER do. `I_Q` and `I Q` are both `IQ`; `IQ1` stays
 * `IQ1` because on a dual amplifier that is a different row, and `IQSD` stays
 * `IQSD` because that is the shutdown current. Measured over 11 real symbol
 * spellings: stripping digits got 5 wrong, this gets 0.
 */
export function normaliseSymbol(text: string): string {
  return text.normalize("NFKC").replace(/[\s_()\-.,]/g, "").toUpperCase();
}

/** Column header cells, as the corpus actually prints them. */
export const HEADER_MIN = ["MIN", "MINIMUM"];
export const HEADER_TYP = ["TYP", "TYPICAL"];
export const HEADER_MAX = ["MAX", "MAXIMUM"];
export const HEADER_UNIT = ["UNIT", "UNITS"];
/**
 * A NOMINAL column. Not a value column we read, and POSITIVE EVIDENCE about
 * which table this is: min/nom/max is the shape of Recommended Operating
 * Conditions, not of Electrical Characteristics. Three corpus parts print it.
 */
export const HEADER_NOM = ["NOM", "NOMINAL"];

/**
 * Section headings that INTRODUCE a specification table.
 *
 * `SPECIFICATIONS` is ADI's word (AD8232). The rest are TI's and ST's. Matched
 * as a prefix so `Electrical Characteristics (continued)`, `Electrical
 * Characteristics VS = 5 V` and `Electrical Characteristics: LM358, LM358A` all
 * match, because the tail of those headings is SCOPE and is parsed separately.
 */
export const SECTION_SPEC = ["ELECTRICAL CHARACTERISTICS", "SPECIFICATIONS", "DC CHARACTERISTICS", "AC CHARACTERISTICS"];

/**
 * Section headings that PROVE this is not a specification table.
 *
 * An absolute-maximum supply voltage substituted into a model is not a small
 * error. These are the only refusal on section: everything else is accepted,
 * including a table under no heading we could find, because our inability to
 * locate a heading is not evidence about the document.
 */
export const SECTION_NOT_SPEC = [
  "ABSOLUTE MAXIMUM RATINGS",
  "ABSOLUTE MAXIMUM",
  "RECOMMENDED OPERATING CONDITIONS",
  "THERMAL INFORMATION",
  "THERMAL CHARACTERISTICS",
  "ESD RATINGS",
  "TIMING REQUIREMENTS",
  "PACKAGE INFORMATION"
];

/**
 * The parameters an op-amp macromodel can consume, with the descriptions and
 * symbols the corpus prints for each.
 *
 * Enumerated from 260 spec rows across 10 amplifier datasheets, not from
 * memory. `SPICE.md` section 31 has the census.
 *
 * `symbols` is used to REJECT a contradicting row, never to require a
 * confirming one: `IQSD` against `IQ` proves a different parameter, but
 * OPA2189 prints no symbol at all for its quiescent current row and refusing
 * that would be a guard inventing a requirement the document does not have.
 */
export interface ParameterSpec {
  /** Stable key used on the record and by the model builder. */
  key: string;
  /** Matched against the normalised row description. */
  describes: RegExp;
  /** Symbols that mean THIS parameter. A near-miss of one of these is a reject. */
  symbols: string[];
  /** What a value of this parameter must be dimensionally. */
  dimension:
    | "Hz"
    | "V/s"
    | "gain"
    | "V"
    | "A"
    | "ohm"
    | "degrees"
    | "V/sqrtHz"
    | "A/sqrtHz"
    | "s"
    | "F"
    | "ratio"
    // A reference states its drift and its two regulation terms as PARTS PER
    // MILLION of the output, per degree, per volt and per amp. That is a
    // dimension of its own and not a bare ratio: `ppm/V` and `%` are both
    // dimensionless-per-something and mean entirely different things.
    | "ppm/degrees"
    | "ppm/V"
    | "ppm/A"
    // A REGULATOR'S CHANGE OVER A STATED RANGE, printed either as a fraction of
    // the output (`%`) or in volts (`mV`). Both are the same statement; which
    // one a vendor used decides whether the output voltage is needed to turn it
    // into a slope, and that is `ldo.ts`'s job rather than this file's.
    | "change";
}

export const PARAMETERS: ParameterSpec[] = [
  // Ordered so that the MORE SPECIFIC description wins: "input offset voltage
  // drift" must not be matched by the "input offset voltage" pattern.
  { key: "offsetDrift", describes: /OFFSET VOLTAGE DRIFT|OFFSET VOLTAGE VS TEMPERATURE/, symbols: ["DVOSDT", "TCVOS", "VOSTC"], dimension: "V/s" },
  { key: "offsetVoltage", describes: /^INPUT OFFSET VOLTAGE$|^OFFSET VOLTAGE$/, symbols: ["VOS", "VIO"], dimension: "V" },
  { key: "biasCurrent", describes: /INPUT BIAS CURRENT|^BIAS CURRENT$/, symbols: ["IB", "IIB"], dimension: "A" },
  { key: "offsetCurrent", describes: /INPUT OFFSET CURRENT|^OFFSET CURRENT$/, symbols: ["IOS", "IIO"], dimension: "A" },
  { key: "openLoopGain", describes: /OPEN.?LOOP VOLTAGE GAIN|LARGE.?SIGNAL VOLTAGE GAIN|^VOLTAGE GAIN$|^OPEN.?LOOP GAIN$/, symbols: ["AOL", "AVO", "AVOL", "AVD", "GV"], dimension: "gain" },
  { key: "cmrr", describes: /COMMON.?MODE REJECTION/, symbols: ["CMRR"], dimension: "gain" },
  { key: "psrr", describes: /POWER.?SUPPLY REJECTION|^SUPPLY REJECTION/, symbols: ["PSRR", "KSVR", "SVR"], dimension: "gain" },
  { key: "gbw", describes: /GAIN.?BANDWIDTH|UNITY.?GAIN BANDWIDTH|^BANDWIDTH$/, symbols: ["GBW", "GBP", "GBWP", "UGBW", "BW"], dimension: "Hz" },
  { key: "slewRate", describes: /^SLEW RATE$/, symbols: ["SR"], dimension: "V/s" },
  { key: "outputSwing", describes: /OUTPUT (VOLTAGE )?SWING|VOLTAGE OUTPUT SWING/, symbols: ["VO", "VOH", "VOL", "VOM"], dimension: "V" },
  { key: "shortCircuitCurrent", describes: /SHORT.?CIRCUIT (OUTPUT )?CURRENT|^OUTPUT CURRENT$/, symbols: ["ISC", "IOUT", "IO"], dimension: "A" },
  { key: "openLoopOutputZ", describes: /OPEN.?LOOP OUTPUT (IMPEDANCE|RESISTANCE)/, symbols: ["ZO", "RO"], dimension: "ohm" },
  { key: "quiescentCurrent", describes: /QUIESCENT CURRENT|^SUPPLY CURRENT/, symbols: ["IQ", "ISY", "IS", "ICC", "IDD", "IDD+"], dimension: "A" },
  { key: "voltageNoise", describes: /(INPUT )?VOLTAGE NOISE|NOISE VOLTAGE/, symbols: ["EN", "VN", "ENPP"], dimension: "V/sqrtHz" },
  { key: "currentNoise", describes: /(INPUT )?CURRENT NOISE|NOISE CURRENT/, symbols: ["IN"], dimension: "A/sqrtHz" },
  { key: "inputCapacitance", describes: /INPUT CAPACITANCE/, symbols: ["CIN", "CI"], dimension: "F" },
  { key: "inputVoltageRange", describes: /INPUT VOLTAGE RANGE|COMMON.?MODE VOLTAGE RANGE|COMMON.?MODE INPUT RANGE/, symbols: ["VCM", "VICR", "VI"], dimension: "V" },
  { key: "phaseMargin", describes: /PHASE MARGIN/, symbols: ["PM", "OM"], dimension: "degrees" },
  { key: "settlingTime", describes: /SETTLING TIME/, symbols: ["TS"], dimension: "s" },
  { key: "overloadRecovery", describes: /OVERLOAD RECOVERY|OVERVOLTAGE RECOVERY/, symbols: ["TOR"], dimension: "s" },
  { key: "supplyVoltage", describes: /SUPPLY VOLTAGE|SPECIFIED VOLTAGE RANGE|OPERATING VOLTAGE/, symbols: ["VS", "VCC", "VDD", "VSUP"], dimension: "V" },
  { key: "channelSeparation", describes: /CHANNEL SEPARATION|CROSSTALK/, symbols: ["CS"], dimension: "gain" },

  // --- A VOLTAGE REFERENCE ----------------------------------------------------
  //
  // Enumerated from what REF5025 prints, page 6, not from memory: `Output
  // voltage`, `Initial accuracy`, `Output voltage temperature drift`, `Line
  // regulation`, `Load regulation`, `Short-circuit current`, `Quiescent
  // current`, `Output voltage noise`. The last three are already above, because
  // an amplifier prints them too and one vocabulary entry per quantity is the
  // rule this file exists to enforce.
  //
  // The regulation terms are what make a reference modellable at all, and they
  // are not a topology we invented: line regulation IS the partial derivative
  // of the output with respect to the input, and load regulation IS the partial
  // derivative with respect to the output current. The datasheet defines them
  // that way, prints them beside the symbols `dVOUT/dVIN` and `dVOUT/dILOAD`,
  // and the model is those two derivatives expressed as a circuit.
  { key: "outputVoltage", describes: /^OUTPUT VOLTAGE$|^REFERENCE (OUTPUT )?VOLTAGE$|^NOMINAL OUTPUT VOLTAGE$/, symbols: ["VOUT", "VREF", "VO"], dimension: "V" },
  // MEASURED LIMITATION, 2026-09-04: REF5025 prints its initial accuracy as
  // `0%`, `0.9%`, `0.14%` with the percent sign fused to the number and an
  // empty unit column. `parseNumber` refuses a cell that is not a bare number,
  // so those rows carry no values and never reach the record at all. The entry
  // is right and will name the row wherever a vendor puts the unit in its own
  // column; reading a fused unit out of a value cell is a separate change and
  // is not made on one part's evidence.
  { key: "initialAccuracy", describes: /INITIAL ACCURACY|^ACCURACY$|OUTPUT VOLTAGE (ERROR|TOLERANCE)/, symbols: ["VOERR"], dimension: "ratio" },
  { key: "outputDrift", describes: /OUTPUT VOLTAGE TEMPERATURE DRIFT|^TEMPERATURE DRIFT|TEMPERATURE COEFFICIENT/, symbols: ["DVOUTDT", "TCVO", "TCVOUT"], dimension: "ppm/degrees" },
  { key: "lineRegulation", describes: /LINE REGULATION/, symbols: ["DVOUTDVIN"], dimension: "ppm/V" },
  { key: "loadRegulation", describes: /LOAD REGULATION/, symbols: ["DVOUTDILOAD"], dimension: "ppm/A" },
  { key: "dropoutVoltage", describes: /DROPOUT VOLTAGE|^DROPOUT$|INPUT.?OUTPUT (VOLTAGE )?DIFFERENTIAL/, symbols: ["VDO", "VDROP"], dimension: "V" },

  // --- A LOW-DROPOUT REGULATOR ------------------------------------------------
  //
  // THE SAME WORDS, A DIFFERENT QUANTITY, AND THE UNIT IS WHAT SAYS WHICH.
  //
  // A voltage reference states a SLOPE: `dVOUT/dVIN = 1 ppm/V`. A regulator
  // states a CHANGE OVER A RANGE, and the range is printed in the test
  // conditions beside it. Measured across the six regulator datasheets on this
  // machine, 2026-09-04, not one states a slope:
  //
  //     L7805         `Line regulation  7 mV typ, 50 mV max`   `VI = 7.5 to 25 V`
  //     LD1117        `Line regulation  0.035 % typ`           `Vin - VO = 1.5 to 13.75 V`
  //     RHFL4913      `Load regulation  0.3 % max`             `IO = 5 mA to 400 mA`
  //     TPS7A4501-SP  `Line regulation  1.5 mV typ`            `ΔVIN = 2.9 to 20 V`
  //
  // Reading `50 mV` into the reference's `lineRegulation` would make the model
  // claim 50000 ppm/V - a factor of fifty thousand, silently, on a value that
  // simulates perfectly. So these are their own keys, and the ONLY thing that
  // routes a row to one or the other is the unit the vendor printed.
  //
  // `%` and `V` share a key because they are the same statement, differing only
  // in whether the vendor expressed the change as a fraction of the output or
  // in volts. `ldo.ts` divides by the output voltage in the second case, which
  // is why the base unit is carried on the record and not thrown away.
  { key: "lineRegulationOverRange", describes: /LINE REGULATION/, symbols: [], dimension: "change" },
  { key: "loadRegulationOverRange", describes: /LOAD REGULATION/, symbols: [], dimension: "change" },

  // --- A COMPARATOR -----------------------------------------------------------
  //
  // Enumerated from what LM139AQML-SP prints, pages 4 and 5: `Response Time`,
  // `Saturation Voltage`, `Output Sink Current`, `Output Leakage Current`,
  // beside the offset, bias, CMRR, PSRR and supply current an amplifier states
  // too. The shared ones are already above; one entry per quantity is the rule
  // this file exists to enforce.
  //
  // `propagationDelay` is the class's DISCRIMINATOR. No operational amplifier
  // datasheet states one, and no comparator omits it, so a table carrying it is
  // characterising a comparator and a table without it is not.
  { key: "propagationDelay", describes: /PROPAGATION DELAY|^RESPONSE TIME$|^LARGE.?SIGNAL RESPONSE TIME$/, symbols: ["TPD", "TPHL", "TPLH", "TRESP"], dimension: "s" },
  { key: "outputLowVoltage", describes: /SATURATION VOLTAGE|^OUTPUT LOW VOLTAGE$|LOW.?LEVEL OUTPUT VOLTAGE|^VOL$/, symbols: ["VOL", "VSAT", "VOLSAT"], dimension: "V" },
  { key: "outputSinkCurrent", describes: /OUTPUT SINK CURRENT|^SINK CURRENT$|LOW.?LEVEL OUTPUT CURRENT/, symbols: ["ISINK", "IOL"], dimension: "A" },
  { key: "outputLeakageCurrent", describes: /OUTPUT LEAKAGE CURRENT/, symbols: ["IOLEAK", "IOH"], dimension: "A" },
  { key: "hysteresis", describes: /HYSTERESIS/, symbols: ["VHYS", "VHYST"], dimension: "V" }
];

/**
 * SI prefixes, and the reason `M` is not among them.
 *
 * In SPICE `Meg` is 1e6 and `m` is 1e-3, and suffixes are NOT case sensitive,
 * so emitting `1M` for a megohm produces a milliohm. That trap belongs to the
 * EMITTER; here we are reading a datasheet, where `M` is mega and `m` is milli
 * as everywhere else in engineering. The two conventions must never share a
 * table, which is why this one is named for reading.
 */
export const READ_PREFIXES: Record<string, number> = {
  T: 1e12,
  G: 1e9,
  M: 1e6,
  k: 1e3,
  K: 1e3,
  "": 1,
  m: 1e-3,
  u: 1e-6,
  µ: 1e-6, // U+00B5 MICRO SIGN
  μ: 1e-6, // U+03BC GREEK SMALL LETTER MU
  n: 1e-9,
  p: 1e-12,
  f: 1e-15
};

/**
 * The base units a dimension accepts, for the cheap deterministic check that a
 * value is not nonsense.
 *
 * This REJECTS, it never confirms. A gain-bandwidth product reported in dB is
 * wrong without any second reading; a gain-bandwidth product reported in Hz may
 * still be the wrong number.
 */
export const DIMENSION_UNITS: Record<ParameterSpec["dimension"], RegExp> = {
  Hz: /^HZ$/,
  "V/s": /^V\/S$/,
  gain: /^(DB|V\/V)$/,
  V: /^V$/,
  A: /^A$/,
  ohm: /^(OHM|Ω)$/,
  degrees: /^(DEG|°|DEGREES)$/,
  "V/sqrtHz": /^V\/√HZ$|^V\/RTHZ$|^VPP$/,
  "A/sqrtHz": /^A\/√HZ$|^A\/RTHZ$/,
  s: /^S$/,
  F: /^F$/,
  ratio: /^(V\/V|%)$/,
  "ppm/degrees": /^PPM\/(DEG|°C|°|C)$/,
  "ppm/V": /^PPM\/V$/,
  "ppm/A": /^PPM\/A$/,
  change: /^(V|%)$/
};

/**
 * THE SYMBOL FONT TRAP.
 *
 * Older ADI PDFs draw a micro sign and store the letter `m`, and draw a degree
 * sign and store U+221E INFINITY. Measured on AD8628: its slew rate unit is
 * stored as `V/ms` where the page reads `V/us`, a factor of 1000, and the
 * dimension check above CANNOT see it because `V/ms` is a valid slew-rate unit.
 *
 * U+221E inside a unit is a reliable signature of that font mapping. It does
 * not tell us the right value, so it flags the DOCUMENT rather than guessing:
 * every `m` in a unit position on such a page is suspect and must be settled by
 * the reading that consumes pixels rather than character codes.
 */
export function hasSymbolFontMapping(units: readonly string[]): boolean {
  return units.some((u) => u.includes("∞"));
}

/**
 * Does this printed unit CONTRADICT what the parameter must be dimensionally?
 *
 * Reject on proof, never on absence, which is the rule everywhere else in this
 * reader. A unit we cannot parse is not evidence of anything: `µV/°C` and
 * `nV/√ Hz` are perfectly good units this scaler does not know, and 87 rows in
 * the tuned corpus print one. Refusing those would delete correct readings to
 * satisfy a check, which is how `forge-fourth-arrangement` destroyed correct
 * figures by letting a downstream assumption leak back into extraction.
 *
 * Measured on the tuned corpus 2026-09-04: 404 rows agree, 28 contradict, 87
 * units cannot be parsed. The 28 are genuine misreads - a slew rate in `pF`, a
 * short-circuit current in `mV`, a quiescent current in ohms - each a unit
 * picked up from a neighbouring column. None of them reached a model, because
 * `model.ts` applies its own base check to the six parameters it consumes; all
 * 28 were on the RECORD, which is what the receipt shows the user.
 */
export function unitContradicts(spec: ParameterSpec, unit: string | null, base: string | null): boolean {
  if (!unit || !base) return false; // absence is not proof
  return !DIMENSION_UNITS[spec.dimension].test(base);
}

/**
 * THE SAME DESCRIPTION, PRINTED IN A DIFFERENT DIMENSION, IS A DIFFERENT
 * QUANTITY - and the unit is the evidence that says which one this row states.
 *
 * `Line regulation` means a slope in `ppm/V` on a voltage reference and a
 * change over a stated range in `mV` or `%` on a regulator. Those are not two
 * spellings of one number; they differ by four orders of magnitude and neither
 * can be converted into the other without reading the range out of the test
 * conditions.
 *
 * So the description narrows the row to a set of candidates and the UNIT picks
 * one. Where the printed unit fits the first candidate, nothing changes and
 * this returns it. Where it contradicts, the alternative is taken only if the
 * unit positively fits it - the same rule as everywhere else in this reader:
 * reject on proof, and never promote on absence.
 *
 * Returns null when the unit fits nothing, which leaves the row on the record
 * unnamed, exactly as before.
 */
export function pickByUnit(
  matched: ParameterSpec,
  description: string,
  unit: string | null,
  base: string | null
): ParameterSpec | null {
  if (!unitContradicts(matched, unit, base)) return matched;
  const norm = normaliseHeader(description);
  const alternative = PARAMETERS.find(
    (candidate) =>
      candidate.key !== matched.key &&
      candidate.describes.test(norm) &&
      !unitContradicts(candidate, unit, base)
  );
  return alternative ?? null;
}
