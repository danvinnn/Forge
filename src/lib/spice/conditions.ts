/**
 * THE RANGE A REGULATOR'S REGULATION FIGURE WAS MEASURED OVER.
 *
 * ## Why this file exists
 *
 * A voltage reference states line regulation as a slope - `1 ppm/V` - and that
 * is a complete statement. A regulator does not. It states a CHANGE, and the
 * range that change was measured over is printed in the test-conditions column
 * beside it:
 *
 *     Line regulation   7 mV typ, 50 mV max     VI = 7.5 to 25 V, IO = 500 mA
 *     Load regulation   30 mV typ, 100 mV max   IO = 5 mA to 1.5 A, TJ = 25 C
 *
 * Without the range those numbers mean nothing: 50 mV over 17.5 V and 50 mV
 * over 2 V are different parts by an order of magnitude. So the range is READ,
 * from the same row, and where it cannot be read the value is not used and the
 * refusal says so. Nothing here guesses a range.
 *
 * ## What it refuses, deliberately
 *
 * RHFL4913 states `VI = VO+2.5 V to 12 V`. The low end is symbolic: it depends
 * on an output voltage this row does not carry. There is a plausible arithmetic
 * to be done there and it is not done, because the plausible arithmetic is how
 * a reader starts inventing operating points. It returns null and the regulation
 * term is reported as read-but-not-modelled.
 *
 * Air-gap safe: pure string and number work, no imports that reach the network.
 */

import { parseUnit } from "./units";

/**
 * Which quantity's range is wanted.
 *
 * Line regulation is measured against the INPUT, load regulation against the
 * OUTPUT CURRENT, and a row states both. Asking for the wrong one is how a
 * 17.5 V span would end up dividing a load-regulation figure.
 */
export type RangeOf = "input" | "load";

/**
 * The left-hand names a vendor uses, and the base unit that quantity must be in.
 *
 * Enumerated from what the six regulator datasheets on this machine actually
 * print, 2026-09-04: `VI`, `VIN`, `Vin`, `ΔVIN`, `Vin - VO`, `VI - VO` for the
 * input; `IO`, `IOUT`, `ILOAD`, `IL` for the load. Anchored at both ends so
 * `VIO` and `IOS` cannot match, and the delta and difference forms are included
 * because they name the same span.
 *
 * The base unit is checked as well as the name. A row whose `IO = ...` range
 * parses in volts is not a load range, whatever it is called.
 */
const NAMES: Record<RangeOf, { pattern: RegExp; base: string }> = {
  input: { pattern: /^(Δ|D)?\s*V\s*(I|IN|CC|DD|S)\s*(-\s*V\s*(O|OUT)\s*)?$/i, base: "V" },
  load: { pattern: /^(Δ|D)?\s*I\s*(O|OUT|LOAD|L)\s*$/i, base: "A" }
};

/**
 * A number, an optional unit, `to`, a number, an optional unit.
 *
 * `to` and an en/em dash are the only separators accepted. A bare hyphen is
 * NOT: `Vin - VO = 1.5 to 13.75 V` already contains one that is a subtraction,
 * and `-55 to +125` contains two that are signs. Accepting it would turn every
 * one of those into a range.
 */
const SPAN =
  /^\s*([-+]?\d+(?:\.\d+)?)\s*([A-Za-zµμΩ°%/√]*)\s*(?:to|–|—)\s*([-+]?\d+(?:\.\d+)?)\s*([A-Za-zµμΩ°%/√]*)\s*$/;

/**
 * The span of a stated range, in SI units, or null.
 *
 * `conditions` is the row's condition text as `specs.ts` joined it: a list of
 * `name = value` clauses separated by commas.
 */
export function rangeFromConditions(conditions: string | null, quantity: RangeOf): number | null {
  if (!conditions) return null;
  const want = NAMES[quantity];

  for (const clause of conditions.split(",")) {
    const at = clause.indexOf("=");
    if (at < 0) continue;
    const name = clause.slice(0, at).trim();
    if (!want.pattern.test(name)) continue;

    // A trailing parenthetical is a temperature or a grade, not part of the
    // range: `IO = 5 mA to 400 mA (-55 °C)`.
    const value = clause.slice(at + 1).replace(/\([^)]*\)\s*$/, "");
    const match = SPAN.exec(value);
    if (!match) continue;

    const [, lowText, lowUnit, highText, highUnit] = match;
    // THE UNIT IS OFTEN PRINTED ONCE, ON THE SECOND NUMBER. `IO = 250 to 750 mA`
    // means both are milliamps; reading the first as bare amps is a factor of a
    // thousand on the wrong side of the division.
    const low = parseUnit(lowUnit || highUnit);
    const high = parseUnit(highUnit || lowUnit);
    if (!low || !high) continue;
    if (low.base !== want.base || high.base !== want.base) continue;

    const span = Math.abs(Number.parseFloat(highText) * high.scale - Number.parseFloat(lowText) * low.scale);
    // A zero span is not a range. It would divide a real regulation figure by
    // nothing and produce an infinite slope, which is the one answer that must
    // never reach a netlist.
    if (!Number.isFinite(span) || span <= 0) continue;
    return span;
  }
  return null;
}
