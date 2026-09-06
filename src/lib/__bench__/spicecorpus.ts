/**
 * The TUNED amplifier corpus, as data.
 *
 * Its own module so the hold-out runner can check for overlap without importing
 * the tuned RUNNER, which would execute a whole bench as a side effect of asking
 * a question about a list.
 */

/**
 * Amplifier-shaped parts fitted against.
 *
 * Every rule in `vocab.ts` was added because one of these failed, so the number
 * this list produces describes how well ten datasheets were fitted. The honest
 * number comes from `spice/__bench__/holdout-corpus.ts`.
 */
export const TUNED_CORPUS = [
  // Amplifiers.
  "OPA333",
  "AD8628",
  "OPA2277",
  "TLV9061",
  "LT1013",
  "OPA2189",
  "LM358",
  "LMP7704-SP",
  "TSV911",
  "AD8232",
  // PROMOTED OUT OF THE HOLD-OUT on 2026-09-04, deliberately and once. It was
  // the only hold-out part whose model FAILED a check rather than being
  // refused, and a failure cannot be diagnosed without the page. MAX4239
  // replaced it there, so the hold-out is the same size and still unseen.
  "MAX44242",
  // PROMOTED OUT OF THE HOLD-OUT on 2026-09-05 after the general Renesas
  // bracketed-header fix did not move either zero-row result. They may now be
  // inspected and fixed without fitting the hold-out; ISL28118 and
  // ISL70218SEH replaced them there before either replacement was opened.
  "ISL28110",
  "ISL70444SEH",
  // A VOLTAGE REFERENCE, so the second device class is measured on every run
  // rather than the day someone remembers it. Deliberately REF5025 and not
  // ADR4525: the latter is in the amplifier hold-out, and a corpus that fits
  // against a hold-out part reads high forever without ever looking broken.
  "REF5025",
  // A COMPARATOR, and a rad-hard one. Its QML table prints MIN and MAX and no
  // typical, which is the shape this reader refused outright until 2026-09-04,
  // so it measures the military-table path as well as the class.
  "LM139AQML-SP",
  // SIX LOW-DROPOUT REGULATORS, so the fourth device class is measured on every
  // run rather than on the day someone remembers it.
  //
  // These are the class's TUNED corpus and they say so: every rule the LDO
  // class needed was found by opening one of them. `REGULATOR_HOLDOUT` in
  // `spice/__bench__/holdout-corpus.ts` was written before any of this existed
  // and is the honest number.
  //
  // Deliberately spanning what makes regulators differ: a 1970s 78xx family
  // sheet with sixteen captioned per-voltage tables, an adjustable part whose
  // output is set externally, two rad-hard parts, and both of the two ways a
  // vendor prints a regulation figure (a change in millivolts, and a percentage
  // of the output).
  "L7805",
  "LD1117",
  "TPS7A4501-SP",
  "TPS7A4700",
  "RHFL4913",
  "RHFL4913A",
  // THE ASK PATH, measured on every run.
  //
  // LP5907 states an output ACCURACY and no nominal anywhere, because on a fixed
  // LDO the voltage is an ordering option. It is the only thing in either corpus
  // that exercises the one question `/api/model` is allowed to ask, and without
  // it that path would be tested and never measured.
  "LP5907",
  // Promoted out of the hold-out before diagnosis of a zero-row table read;
  // LP5912 replaced it there first.
  "LP2985"
];
