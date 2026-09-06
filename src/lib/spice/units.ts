/**
 * Turning a printed unit into an SI scale factor, and the two traps that live
 * here.
 *
 * ## Trap 1: the prefix can be in the DENOMINATOR
 *
 * A slew rate is printed `V/us`. The prefix scales the unit DOWN and therefore
 * scales the VALUE UP: 0.16 V/us is 160000 V/s, not 0.00000016. Treating every
 * prefix as a multiplier gets slew rate wrong by 1e12.
 *
 * ## Trap 2: the text layer can lie about the micro sign
 *
 * Measured on AD8628: the PDF draws a micro sign and stores the letter `m`, so
 * its slew rate unit arrives as `V/ms` where the page reads `V/us`. That is a
 * factor of 1000 and the dimension check cannot see it, because `V/ms` is a
 * perfectly valid slew-rate unit.
 *
 * Nothing here can fix that, and guessing would be an invention. What this file
 * does is refuse to hide it: `parseUnit` reports the micro sign it actually
 * found, so the caller can pair the reading against a model that consumed
 * pixels rather than character codes, which is what RULES.md 7 requires anyway.
 */

/**
 * COMPATIBILITY NORMALISATION, applied before any character comparison.
 *
 * Unicode has several code points that draw the same glyph, and datasheets use
 * them interchangeably. TI writes kilohms with U+2126 OHM SIGN; this file's
 * table was written with U+03A9 GREEK CAPITAL OMEGA. They are visually
 * identical, they are not equal, and `toUpperCase` does not reconcile them. The
 * result was that OPA333's open-loop output impedance was read correctly,
 * carried all the way here, and then silently dropped for want of a scale.
 *
 * The micro sign is the same story: U+00B5 MICRO SIGN and U+03BC GREEK SMALL
 * LETTER MU both appear, sometimes in one document.
 *
 * NFKC folds every one of these onto a single representative, so this is one
 * change that closes the whole class rather than a list of look-alikes to
 * maintain.
 */
export function foldUnicode(text: string): string {
  return text.normalize("NFKC");
}

/** SI prefixes as a datasheet writes them, including both micro code points. */
const PREFIX: Record<string, number> = {
  T: 1e12,
  G: 1e9,
  M: 1e6,
  k: 1e3,
  K: 1e3,
  m: 1e-3,
  u: 1e-6,
  "µ": 1e-6, // MICRO SIGN
  "μ": 1e-6, // GREEK SMALL LETTER MU
  n: 1e-9,
  p: 1e-12,
  f: 1e-15
};

/**
 * Base units this feature understands.
 *
 * Matching is exact on the whole token, so the order here does not decide
 * anything; a prefix is stripped first and the remainder matched exactly.
 *
 * `ppm` and `°C` are here for the reference class. A voltage reference states
 * its drift and both regulation terms as parts per million of the output, per
 * degree, per volt and per amp, and without these three the whole class reads
 * as unscalable and nothing it prints may reach a model.
 */
const BASE = ["V/V", "Hz", "dB", "sqrtHz", "√Hz", "Ohm", "Ω", "ohm", "V", "A", "F", "s", "%", "ppm", "°C", "degC", "C"];

/**
 * Units whose NAME carries a magnitude, rather than a prefix in front of it.
 *
 * A part per million is 1e-6 and a percent is 1e-2, and both are written with no
 * prefix at all. Treating them as scale 1 puts `0.9%` on the record as 0.9,
 * which is a hundred times the value the page states.
 */
const BASE_SCALE: Record<string, number> = { ppm: 1e-6, "%": 1e-2 };

export interface ParsedUnit {
  /** Multiply a value printed in this unit by this to get SI. */
  scale: number;
  /** The base unit, upper-cased: `V`, `A`, `HZ`, `DB`, `V/S`, `OHM`. */
  base: string;
  /** True when a micro prefix was written as the letter `m` might have been. */
  ambiguousMicro: boolean;
}

function splitPrefix(token: string): { scale: number; base: string; prefixed: boolean } {
  for (const base of BASE) {
    if (token.toUpperCase() === base.toUpperCase()) return { scale: BASE_SCALE[base] ?? 1, base, prefixed: false };
  }
  for (const [prefix, scale] of Object.entries(PREFIX)) {
    if (!token.startsWith(prefix) || token.length === prefix.length) continue;
    const rest = token.slice(prefix.length);
    for (const base of BASE) {
      if (rest.toUpperCase() === base.toUpperCase()) return { scale: scale * (BASE_SCALE[base] ?? 1), base, prefixed: true };
    }
  }
  return { scale: NaN, base: token, prefixed: false };
}

/**
 * Parses a printed unit.
 *
 * Returns null when the unit is not one this understands, which is a REFUSAL to
 * scale and not a refusal to store: the row keeps its unit exactly as printed,
 * and only the derived SI number is withheld. A value whose magnitude cannot be
 * established is not a value that may reach a model.
 */
export function parseUnit(unit: string | null): ParsedUnit | null {
  if (!unit) return null;
  const cleaned = foldUnicode(unit)
    .trim()
    .replace(/[()[\]]/g, "")
    // `%VO` IS A PERCENT, and of the one quantity a regulator row could mean.
    //
    // TPS7A4700 heads its line and load regulation columns `%VO`. Nothing else
    // parses it, so both rows were read, named and then dropped for having no
    // magnitude - on a part whose regulation is the thing being modelled.
    //
    // Anchored to `VO` and `VOUT` deliberately, and NOT generalised to a percent
    // of anything. ADS8688 prints `%FSR`, a fraction of an ADC's full-scale
    // range, and folding that to a bare percent would silently redefine it.
    .replace(/^%\s*V(O|OUT)$/i, "%");
  if (cleaned.length === 0) return null;

  const [numerator, denominator] = cleaned.split("/");
  const top = splitPrefix(numerator);
  if (Number.isNaN(top.scale)) return null;

  if (denominator === undefined) {
    return { scale: top.scale, base: top.base.toUpperCase(), ambiguousMicro: false };
  }

  // `V/V` and `A/sqrtHz` are single units that happen to contain a slash.
  const whole = splitPrefix(cleaned);
  if (!Number.isNaN(whole.scale)) {
    return { scale: whole.scale, base: whole.base.toUpperCase(), ambiguousMicro: false };
  }

  const bottom = splitPrefix(denominator);
  if (Number.isNaN(bottom.scale)) return null;
  // A prefix under the line scales the value the other way: V/us is 1e6 V/s.
  return {
    scale: top.scale / bottom.scale,
    base: `${top.base}/${bottom.base}`.toUpperCase(),
    // A milli under the line is real in principle and, on the vendors measured,
    // is far more often a micro sign the text layer failed to encode. Say so
    // rather than choose.
    ambiguousMicro: bottom.prefixed && denominator.startsWith("m")
  };
}

/** Converts a printed value to SI, or null when the unit cannot be parsed. */
export function toSI(value: number, unit: string | null): number | null {
  const parsed = parseUnit(unit);
  if (!parsed) return null;
  return value * parsed.scale;
}

/**
 * Formats a number for a SPICE netlist.
 *
 * THE `Meg` TRAP. In SPICE `Meg` is 1e6 and `m` is 1e-3, and suffixes are NOT
 * case sensitive, so `1M` is one MILLI, not one mega. Emitting a megohm as `1M`
 * produces a milliohm: a 1e9 error that passes every check this product has,
 * because the value was read correctly, cited correctly and confirmed by two
 * independent sources, then formatted wrong on the way out.
 *
 * Plain exponential notation has no suffix and therefore no ambiguity, so that
 * is what is emitted. It is less pretty and it cannot be wrong.
 */
export function toSpice(value: number): string {
  if (!Number.isFinite(value)) throw new Error(`refusing to emit a non-finite value: ${value}`);
  if (value === 0) return "0";
  return value.toExponential(6).replace(/e\+?(-?)(\d+)/, "e$1$2");
}
