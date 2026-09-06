/**
 * THE AMPLIFIER HOLD-OUT CORPUS, as data.
 *
 * Air-gap safety: pure data, no network, no imports that reach the network.
 *
 * ## Why this exists
 *
 * `bench:model` reads 90% on the tuned corpus, and that number cannot predict
 * anything. Every rule in `vocab.ts` was added because a part in THAT list
 * failed: `AVOL` went in because LT1013 lost its gain, `Typ.` because TSV911
 * read nothing, `AVD` because TSV911 was refused. So 90% says how well ten
 * datasheets were fitted, and it will keep rising as long as anyone keeps
 * fitting them.
 *
 * This project has paid for that lesson twice already. The extraction parser
 * read 69% tuned and 49% hold-out. Retrieval read 95% tuned and 87% hold-out.
 *
 * And the existing hold-out corpora cannot measure THIS feature: measured
 * 2026-09-04, the 43-part blind corpus contains exactly TWO op-amps
 * (`SPICE.md` section 28). A number from it says more about corpus composition
 * than about the reader.
 *
 * ## How these were chosen
 *
 * Written down on 2026-09-04, BEFORE any of them was opened, and deliberately
 * NOT restricted to vendors whose phrasing the vocabulary already knows. That
 * restriction is what would make the number circular.
 *
 * The sample spans: the two big analogue vendors and five smaller ones; parts
 * from the 1970s to the 2020s, because an old datasheet is typeset completely
 * differently; single, dual and quad packages; op-amps, comparators, voltage
 * references and instrumentation amplifiers, because the classes after op-amps
 * are the ones this feature grows into; and rad-hard parts, because that is the
 * market this product is positioned at.
 *
 * Public, non-controlled parts only, the same rule `test-data/` follows.
 *
 * ## The rule that makes the number mean anything
 *
 * **Nothing here may ever be tuned against.** Do not look up why a hold-out part
 * failed and then add the vocabulary entry that would have caught it. The moment
 * you do, this becomes a second training set and the feature loses the only
 * honest signal it has.
 *
 * If a hold-out miss needs diagnosing, the finding is the CLASS of failure, not
 * the part: fix the class, re-measure, and if a specific part had to be examined
 * to get there, MOVE it into the tuned corpus and add a replacement here.
 *
 * ONE EXCEPTION, because it is a bug in the instrument rather than the product:
 * if a part number here turns out not to exist or to be misspelled, that is a
 * corpus defect and correcting it is legitimate. A wrong part number scores as a
 * miss and would understate coverage, which is the opposite of the bias this
 * file guards against.
 */

import { join } from "node:path";

/**
 * Where these datasheets cache. Its own directory, not `.holdout-cache`: that
 * one belongs to the CAD hold-out and mixing them would let a part be scored by
 * two benches with two different rules about what may be tuned against.
 */
export const SPICE_HOLDOUT_CACHE_DIR = join(process.cwd(), ".spice-holdout-cache");

/** The sanitiser is lossy on purpose: it is a filename. The part number that
 * counts is the one in the list below. */
export function spiceHoldoutCachePath(partNumber: string): string {
  return join(SPICE_HOLDOUT_CACHE_DIR, `${partNumber.replace(/[^A-Za-z0-9._-]/g, "_")}.pdf`);
}

export type AmplifierClass = "opamp" | "comparator" | "reference" | "instrumentation";

/**
 * Every kind of part any hold-out list holds.
 *
 * The two lists stay separate below - each was written on its own day, before
 * the class it measures existed - but one RUNNER scores them, so it needs one
 * type. A second runner would be a second place to fix.
 */
export type HoldoutClass = AmplifierClass | "ldo";

export interface HoldoutPart {
  partNumber: string;
  manufacturer: string;
  klass: HoldoutClass;
  note?: string;
}

export interface HoldoutAmplifier {
  partNumber: string;
  manufacturer: string;
  klass: AmplifierClass;
  note?: string;
}

export const AMPLIFIER_HOLDOUT: HoldoutAmplifier[] = [
  // --- Texas Instruments, across four decades of datasheet typesetting --------
  { partNumber: "OPA192", manufacturer: "Texas Instruments", klass: "opamp" },
  { partNumber: "OPA210", manufacturer: "Texas Instruments", klass: "opamp" },
  { partNumber: "TLV2372", manufacturer: "Texas Instruments", klass: "opamp" },
  { partNumber: "LM324", manufacturer: "Texas Instruments", klass: "opamp", note: "1970s part, quad, typeset unlike anything modern" },
  { partNumber: "TL072", manufacturer: "Texas Instruments", klass: "opamp", note: "same era, different family" },
  { partNumber: "INA333", manufacturer: "Texas Instruments", klass: "instrumentation" },
  { partNumber: "TLV3201", manufacturer: "Texas Instruments", klass: "comparator" },
  { partNumber: "REF3025", manufacturer: "Texas Instruments", klass: "reference" },

  // --- Analog Devices, including the legacy Linear naming --------------------
  { partNumber: "AD8605", manufacturer: "Analog Devices", klass: "opamp" },
  { partNumber: "ADA4077-2", manufacturer: "Analog Devices", klass: "opamp" },
  { partNumber: "LT1677", manufacturer: "Analog Devices", klass: "opamp", note: "legacy Linear typesetting, multi-grade columns likely" },
  { partNumber: "LTC2050", manufacturer: "Analog Devices", klass: "opamp" },
  { partNumber: "AD8226", manufacturer: "Analog Devices", klass: "instrumentation" },
  { partNumber: "LT1716", manufacturer: "Analog Devices", klass: "comparator" },
  { partNumber: "ADR4525", manufacturer: "Analog Devices", klass: "reference" },

  // --- STMicroelectronics, which writes `Min.` with a trailing period --------
  { partNumber: "TSZ182", manufacturer: "STMicroelectronics", klass: "opamp" },
  { partNumber: "TSB611", manufacturer: "STMicroelectronics", klass: "opamp" },
  { partNumber: "TS3011", manufacturer: "STMicroelectronics", klass: "comparator" },

  // --- Smaller vendors, whose phrasing nothing here was fitted to ------------
  { partNumber: "MCP6V01", manufacturer: "Microchip", klass: "opamp" },
  { partNumber: "MCP6541", manufacturer: "Microchip", klass: "comparator" },
  { partNumber: "NCS325", manufacturer: "onsemi", klass: "opamp" },
  // ISL28110 was promoted into the tuned corpus on 2026-09-05 so its zero-row
  // failure could be diagnosed without fitting the hold-out. ISL28118 replaces
  // it: same vendor and class, selected before its datasheet was opened.
  { partNumber: "ISL28118", manufacturer: "Renesas", klass: "opamp" },
  // MAX44242 WAS HERE UNTIL 2026-09-04, and where it went is recorded rather
  // than quietly patched.
  //
  // It was the only part in this corpus whose model FAILED a conformance check
  // rather than being refused: 47.34 uV reproduced against a stated 50 uV. That
  // ratio is the attenuation a unity-gain follower shows at an open-loop gain
  // of about 25 dB, which is not an amplifier's gain, so the offset check was
  // acting as an independent witness of something else being wrong - and it was
  // the only thing in the product that noticed.
  //
  // Diagnosing that needs the page. So it was PROMOTED into the tuned corpus,
  // where opening it is allowed, and MAX4239 replaces it here: same vendor
  // heritage, same house style, never opened. The corpus is the same size and
  // the measurement is still honest. `SPICE.md` records the trade.
  { partNumber: "MAX4239", manufacturer: "Analog Devices", klass: "opamp", note: "Maxim heritage, a third house style" },
  { partNumber: "NJM4580", manufacturer: "JRC", klass: "opamp", note: "a vendor no rule here has ever seen" },

  // --- Rad-hard, the market this product is positioned at --------------------
  { partNumber: "OPA4H014-SEP", manufacturer: "Texas Instruments", klass: "opamp" },
  { partNumber: "LM6142QML-SP", manufacturer: "Texas Instruments", klass: "opamp" },
  { partNumber: "RHF43B", manufacturer: "STMicroelectronics", klass: "opamp" },
  // ISL70444SEH was promoted with ISL28110. ISL70218SEH preserves the rad-hard
  // Renesas stratum and was selected before its datasheet was opened.
  { partNumber: "ISL70218SEH", manufacturer: "Renesas", klass: "opamp", note: "rad-hard Renesas replacement, selected unseen" }
];


/**
 * THE REGULATOR HOLD-OUT, for the LDO class.
 *
 * Written down on 2026-09-04 BEFORE any of these was opened and before a single
 * line of `ldo.ts` was written, which is the only thing that makes it a hold-out
 * rather than a list of parts that happened to work.
 *
 * ## Why it needed its own list
 *
 * The amplifier hold-out above contains no regulators at all. Six LDO datasheets
 * were already on this machine when the class was built - L7805, LD1117,
 * TPS7A4501-SP, TPS7A4700, RHFL4913, RHFL4913A - and a class measured only on
 * those six would be measuring how well six documents were fitted, which is
 * exactly what `bench:model` is and says it is. Those six are the TUNED corpus
 * for this class. These are not, and never may be.
 *
 * ## What the sample is trying to span
 *
 * - **Six vendors**, because every reading defect found so far was one vendor's
 *   typesetting rather than a general rule.
 * - **Fixed AND adjustable parts.** This is the split the class is most likely
 *   to get wrong: an adjustable regulator's output is set by external resistors,
 *   so its datasheet states a REFERENCE voltage where a fixed one states an
 *   output voltage. A corpus of fixed parts only would hide that entirely.
 * - **Two rad-hard parts**, because that is the market this product is aimed at.
 * - **Both ends of the quiescent-current range**, from a 78xx-era pass element
 *   to a sub-microamp part, because that decides whether a supply-current row is
 *   even printed in a unit the reader scales.
 *
 * Public, non-controlled parts only. Same rule as everything else here.
 *
 * ## The rule
 *
 * Identical to the amplifier hold-out above, and it applies from the day this
 * list was written rather than from the first time a number looks disappointing.
 */
export interface HoldoutRegulator {
  partNumber: string;
  manufacturer: string;
  /** Why this one is on the list. NOT a claim about what the datasheet says:
   * none of these had been opened when this was written. */
  note?: string;
}

export const REGULATOR_HOLDOUT: HoldoutRegulator[] = [
  // --- Texas Instruments ------------------------------------------------------
  { partNumber: "TPS7A4901", manufacturer: "Texas Instruments", note: "high-voltage adjustable" },
  // LP2985 was promoted on 2026-09-05 to diagnose the class-wide
  // `no-spec-table-read` failure. LP5912 was selected before its document was
  // opened and preserves the small fixed, many-output-options stratum.
  { partNumber: "LP5912", manufacturer: "Texas Instruments", note: "small fixed part, many output-voltage options; selected unseen" },
  { partNumber: "TLV70033", manufacturer: "Texas Instruments", note: "modern low-Iq fixed" },

  // --- Analog Devices, including the legacy Linear and Maxim house styles -----
  { partNumber: "LT1763", manufacturer: "Analog Devices", note: "legacy Linear typesetting" },
  { partNumber: "ADP7142", manufacturer: "Analog Devices" },
  { partNumber: "LT3080", manufacturer: "Analog Devices", note: "set by a current rather than a divider; may not be an LDO by this reader's definition at all" },
  { partNumber: "MAX8880", manufacturer: "Analog Devices", note: "Maxim heritage" },

  // --- STMicroelectronics -----------------------------------------------------
  { partNumber: "LDL1117", manufacturer: "STMicroelectronics" },
  { partNumber: "STLQ020", manufacturer: "STMicroelectronics", note: "sub-microamp quiescent current" },

  // --- Smaller vendors --------------------------------------------------------
  { partNumber: "MCP1700", manufacturer: "Microchip" },
  { partNumber: "MIC5219", manufacturer: "Microchip", note: "Micrel heritage, another house style" },
  { partNumber: "NCP1117", manufacturer: "onsemi" },
  { partNumber: "NCV8705", manufacturer: "onsemi", note: "automotive-qualified variant typesetting" },

  // --- Rad-hard, the market this product is positioned at ---------------------
  { partNumber: "TPS7H1101A-SP", manufacturer: "Texas Instruments" },
  { partNumber: "ISL75052SEH", manufacturer: "Renesas" }
];
