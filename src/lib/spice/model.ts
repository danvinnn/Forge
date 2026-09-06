/**
 * Turning specification rows into the parameters of one op-amp macromodel.
 *
 * ## The topology is a constant of this product, not a reading
 *
 * The circuit is a published behavioural macromodel: an offset source, a
 * slew-limited transconductance into a dominant pole, and an output behind the
 * amplifier's own output impedance. It is the same for every part and it is
 * cited by name, exactly as IPC-7351B is cited for a land pattern. RULES.md 1
 * permits "a published standard" as a source, and the CAD half already ships
 * courtyards, fillets and paste windows that appear in no datasheet.
 *
 * Only the PARAMETERS come from the document. Every one of them carries the page
 * it was read from.
 *
 * ## A missing corner produces NO corner
 *
 * This is the rule that matters most here. If a datasheet prints only a typical
 * gain-bandwidth and the corner set defaulted `max = typ`, the model would claim
 * the vendor guarantees a ceiling the document never states, and a worst-case
 * analysis built on it would be wrong in the direction that looks safe.
 *
 * `throughHoleFootprint` shipped a 3-lead TO-220 as two rows for the same
 * reason: null and unread were the same value. Here nothing is defaulted, ever.
 */

import type { SpecRow } from "./specs";
import { parseUnit } from "./units";

/** The parameters an OP-AMP macromodel can consume. */
export const MODEL_PARAMETERS = [
  "openLoopGain",
  "gbw",
  "slewRate",
  "offsetVoltage",
  "quiescentCurrent",
  "openLoopOutputZ"
] as const;

/**
 * The parameters a VOLTAGE REFERENCE model can consume.
 *
 * `quiescentCurrent` is shared with the amplifier list on purpose: it is the
 * same quantity, read by the same vocabulary entry, and a second key for it
 * would be a second place to fix.
 */
export const REFERENCE_PARAMETERS = [
  "outputVoltage",
  "lineRegulation",
  "loadRegulation",
  "outputDrift",
  "initialAccuracy",
  "quiescentCurrent",
  "dropoutVoltage",
  // Read, and used as the ANCHOR the line-regulation slope is measured from.
  // A slope has no absolute reference point, and the minimum supply is one the
  // document states rather than one this generator picks.
  "supplyVoltage"
] as const;

/**
 * The parameters a COMPARATOR model can consume.
 *
 * `offsetVoltage`, `quiescentCurrent` and `supplyVoltage` are shared with the
 * other classes on purpose: they are the same quantities read by the same
 * vocabulary entries, and a second key for any of them would be a second place
 * to fix.
 */
export const COMPARATOR_PARAMETERS = [
  "propagationDelay",
  "offsetVoltage",
  "outputLowVoltage",
  "outputSinkCurrent",
  "hysteresis",
  // Read and reported, not modelled: an open-collector output's leakage matters
  // to whoever sizes the pull-up, and it is on the record for them.
  "outputLeakageCurrent",
  "quiescentCurrent",
  "supplyVoltage"
] as const;

/**
 * The parameters a LOW-DROPOUT REGULATOR model can consume.
 *
 * Mostly the reference's list, because a regulator IS a reference with a pass
 * element in front of it: the same output voltage, the same two regulation
 * terms, the same quiescent current. What is new is the dropout - the input-to-
 * output headroom below which the output stops regulating and simply follows
 * the input down - and that is also the class's DISCRIMINATOR. No voltage
 * reference states a dropout voltage, because a reference has no pass element
 * to drop across.
 *
 * The two regulation terms are NOT the reference's. See `vocab.ts`: a reference
 * states a slope in ppm/V and a regulator states a change over a stated range,
 * and reading one as the other is a factor of fifty thousand.
 */
export const LDO_PARAMETERS = [
  "outputVoltage",
  "dropoutVoltage",
  "lineRegulationOverRange",
  "loadRegulationOverRange",
  "quiescentCurrent",
  "supplyVoltage"
] as const;

export type ModelParameter =
  | (typeof MODEL_PARAMETERS)[number]
  | (typeof REFERENCE_PARAMETERS)[number]
  | (typeof COMPARATOR_PARAMETERS)[number]
  | (typeof LDO_PARAMETERS)[number];

/** Every parameter any class can consume, for the reader that fills a block. */
export const ALL_PARAMETERS: ModelParameter[] = [
  ...new Set<ModelParameter>([
    ...MODEL_PARAMETERS,
    ...REFERENCE_PARAMETERS,
    ...COMPARATOR_PARAMETERS,
    ...LDO_PARAMETERS
  ])
];

export type DeviceClassId = "opamp" | "reference" | "comparator" | "ldo";

/**
 * A KIND OF PART THIS PRODUCT CAN MODEL.
 *
 * The topology of each is a constant of the generator, cited by name, exactly
 * as IPC-7351B is cited for a land pattern. Only the parameters come from the
 * document.
 *
 * A class is chosen from what the document STATES, never from the part number.
 * A part number is a string somebody typed; a table that prints a line
 * regulation and no gain-bandwidth is evidence.
 */
export interface DeviceClass {
  id: DeviceClassId;
  label: string;
  parameters: readonly ModelParameter[];
  /** Without these there is no model of this kind, and the refusal says so. */
  required: readonly ModelParameter[];
  /**
   * At least ONE of these is also needed.
   *
   * A plain AND-list cannot express what makes a reference a reference. Its
   * output voltage alone is not enough evidence: an amplifier datasheet can
   * print a row called `Output voltage` too, and a class chosen on that would
   * hand an op-amp user a voltage source. What no amplifier prints is a LINE or
   * LOAD REGULATION, and either one is sufficient, so the requirement is a
   * genuine disjunction and is written as one rather than fudged into the list
   * above.
   */
  alsoOneOf?: readonly ModelParameter[];
  /**
   * Parameters NO member of this class states. Any one of them disqualifies it.
   *
   * The other two fields ask what a document contains; this asks what its
   * presence PROVES, and that turns out to be the only thing that separates
   * some pairs of classes.
   *
   * RHFL4913 is a rad-hard regulator whose datasheet prints two rows described
   * `tPLH` and `tPHL` - the timing of its INHIBIT pin. Those are a comparator's
   * symbols, they are correctly read as a propagation delay, and a propagation
   * delay is the comparator's discriminator. So a linear regulator was built as
   * a comparator, with every value read correctly and every check passing.
   *
   * Ordering the classes does not fix it, because this part states no output
   * voltage in the fixed sense and so fails the regulator's own requirement
   * too. What settles it is that the same page states a DROPOUT VOLTAGE, and a
   * comparator has no pass element to drop across. The document proves what it
   * is not, and the refusal that follows is the correct answer.
   */
  neverStates?: readonly ModelParameter[];
}

export const OPAMP: DeviceClass = {
  id: "opamp",
  label: "operational amplifier",
  parameters: MODEL_PARAMETERS,
  // Without these two the dominant pole is undefined and there is no model.
  // Everything else changes what the model can be trusted to REPRODUCE, and its
  // absence is reported rather than filled in.
  required: ["openLoopGain", "gbw"]
};

export const REFERENCE: DeviceClass = {
  id: "reference",
  label: "voltage reference",
  parameters: REFERENCE_PARAMETERS,
  // The output voltage is the device. Without at least one regulation term the
  // model is an ideal source, which reproduces nothing the datasheet promises
  // and would be worse than refusing: an ideal source looks like a perfect part.
  required: ["outputVoltage"],
  alsoOneOf: ["lineRegulation", "loadRegulation"]
};

export const LDO: DeviceClass = {
  id: "ldo",
  label: "low-dropout regulator",
  parameters: LDO_PARAMETERS,
  // The output voltage is what the part is FOR; the dropout is what makes it a
  // regulator rather than a reference, and it is the one number a person opens
  // a regulator model to see. A part stating an output voltage and no dropout
  // is either a reference, and the reference class will take it, or a document
  // this reader did not get the dropout row out of - and in both cases building
  // an LDO would be claiming a headroom limit nobody stated.
  //
  // NO REGULATION TERM IS REQUIRED, which is the one place this class is looser
  // than the reference. A reference with no regulation term is an ideal source
  // and reproduces nothing the datasheet promised. A regulator with a dropout
  // still reproduces the thing it is bought for: it holds its output until the
  // input gets too close, and then it does not. That is a real, useful and
  // stated behaviour, and the missing regulation is reported rather than filled.
  required: ["outputVoltage", "dropoutVoltage"],
  // A DROPOUT VOLTAGE IS NOT ENOUGH TO SEPARATE THIS FROM A REFERENCE, because
  // a low-dropout SERIES reference states one too. Measured 2026-09-04: the
  // amplifier hold-out's two voltage references were both built as regulators,
  // with correct values and the wrong word on the receipt.
  //
  // What does separate them is the CONVENTION each states its regulation in. A
  // precision reference states a slope - `dVOUT/dVIN = 1 ppm/V` - and all six
  // regulators on this machine state a change over a stated range, in
  // millivolts or as a percentage, not one of them in parts per million. A
  // regulator printing 0.2% line regulation as 2000 ppm/V is not something any
  // vendor does; the ppm slope is a precision-reference idiom.
  //
  // So a ppm slope proves this is a reference, and `vocab.ts` already routes
  // the two conventions to different keys on the strength of the printed unit.
  neverStates: ["lineRegulation", "loadRegulation"]
};

export const COMPARATOR: DeviceClass = {
  id: "comparator",
  label: "comparator",
  parameters: COMPARATOR_PARAMETERS,
  // The propagation delay is what makes this a comparator rather than an
  // amplifier used as one, and it is the number a person simulates a comparator
  // to see. Without it there is a threshold detector, which every simulator can
  // already draw with a B-source, and no reason to have read a datasheet.
  required: ["propagationDelay"],
  // See `neverStates`. A dropout voltage is a statement about a pass element,
  // and a comparator has none.
  neverStates: ["dropoutVoltage"]
};

/**
 * Ordered by how STRICT the test is, not by preference.
 *
 * The amplifier needs an open-loop gain AND a gain-bandwidth, which no other
 * class prints. The comparator needs a propagation delay, which no amplifier
 * prints. The reference needs an output voltage and a regulation term, and the
 * regulation term is what no other class prints. Each class is therefore
 * identified by something the others cannot accidentally satisfy, and the order
 * only decides which is tried first.
 */
/**
 * ORDER MATTERS WHERE ONE CLASS'S EVIDENCE IS A SUBSET OF ANOTHER'S.
 *
 * The LDO is tried before both the comparator and the reference, and both
 * placements were forced by a real misclassification rather than chosen for
 * tidiness.
 *
 * - **Before the reference.** A regulator satisfies the reference's
 *   requirement as well as its own: it states an output voltage and a
 *   regulation term. The reverse is not true, because a reference has no pass
 *   element and states no dropout.
 *
 * - **Before the comparator.** RHFL4913A is a rad-hard regulator, and it was
 *   built as a COMPARATOR: it prints `tPHL` and `tPLH` for its inhibit pin, the
 *   vocabulary reads those as a propagation delay, and a propagation delay is
 *   the comparator's discriminator. Every value in that model was read
 *   correctly and the part it described did not exist. No comparator states a
 *   dropout voltage, so this ordering cannot cost a real comparator anything.
 *
 * The amplifier stays first: it needs an open-loop gain AND a gain-bandwidth,
 * which nothing else on this list prints.
 */
export const DEVICE_CLASSES: DeviceClass[] = [OPAMP, LDO, COMPARATOR, REFERENCE];

/** Kept for callers that still mean the amplifier requirement by name. */
export const REQUIRED: readonly ModelParameter[] = OPAMP.required;

/** SI values at each corner the document actually prints. */
export interface Corner {
  min: number | null;
  typ: number | null;
  max: number | null;
}

export interface ModelValue {
  /** SI, scaled from the printed unit. */
  si: Corner;
  /**
   * The numbers exactly as the document prints them, before scaling.
   *
   * Kept so the emitted file's header can quote the datasheet rather than a
   * scaled float: `typ 2, max 10 uV` is checkable against page 7, whereas
   * `max 0.000009999999999999999` is the same fact made unreadable.
   */
  printed: Corner;
  /** The unit exactly as the document printed it. */
  unit: string;
  conditions: string | null;
  /**
   * The page it was read from, or NULL when nobody read it.
   *
   * Null means the user supplied it, and the two must be distinguishable
   * everywhere a value is shown. A citation is a claim that a number is on a
   * page; printing `page 1` beside a value a person typed is the product
   * fabricating provenance, which is the one thing it exists not to do.
   */
  page: number | null;
  /**
   * True when the unit's denominator prefix was the letter `m` where a micro
   * sign is likely. A 1000x ambiguity that only a reading of the PIXELS can
   * settle, so it travels with the value instead of being guessed.
   */
  ambiguousMicro: boolean;
  /**
   * The user answered a question this product asked, because the document is
   * silent.
   *
   * Redundant with `page === null` on purpose: a reader of this struct should
   * not have to know that a null page MEANS anything, and a flag that says so
   * in words is what the netlist header and the receipt render.
   */
  suppliedByUser?: boolean;
  /** The user replaced a machine reading after checking the cited page. */
  correctedByUser?: boolean;
}

/**
 * One coherent specification block: all values read under the same heading
 * scope and the same column group.
 *
 * Mixing blocks is the defect where every input passes. LT1013 prints three
 * grades side by side, one of them a different part, and a model built from one
 * grade's minimum and another's maximum describes a device that does not exist.
 */
export interface ModelBlock {
  /** The heading's scope, e.g. `VS = 5 V`. Null when the table stated none. */
  scope: string | null;
  /** The column group's label, e.g. `LT1013AM`. Null for a single-group table. */
  group: string | null;
  values: Partial<Record<ModelParameter, ModelValue>>;
  /** Required AMPLIFIER parameters this block does not carry. */
  missing: ModelParameter[];
  /** The same question asked of every device class this product can model. */
  missingFor: Record<DeviceClassId, ModelParameter[]>;
}

/**
 * Which spec key feeds which model parameter.
 *
 * The identity, and written as a function rather than a hand-kept table so a
 * parameter added to a class cannot be silently absent from the mapping.
 */
const fromSpec = (parameter: ModelParameter): string => parameter;

/**
 * A printed value in the one unit the record holds for that parameter.
 *
 * Exported because `confirm.ts` must put the MODEL'S reading through exactly the
 * same conversion before comparing. Applying it to one side only reported LM358
 * as a disagreement when both readings said `70 V/mV`: ours had become 96.9 dB
 * and theirs was still 70000 V/V. A false disagreement is not a safe failure. It
 * is noise that teaches a user to click past the flags that matter.
 */
export function canonicalValue(parameter: ModelParameter, value: number, unit: string | null): number | null {
  const parsed = parseUnit(unit);
  if (!parsed) return null;
  if (!EXPECTED_BASE[parameter].includes(parsed.base)) return null;
  return canonicalise(parameter, value * parsed.scale, parsed.base);
}

/** The base unit each model parameter must be expressed in. */
export const EXPECTED_BASE: Record<ModelParameter, string[]> = {
  openLoopGain: ["DB", "V/V"],
  gbw: ["HZ"],
  slewRate: ["V/S"],
  offsetVoltage: ["V"],
  quiescentCurrent: ["A"],
  openLoopOutputZ: ["OHM", "Ω"],
  // A reference states its regulation terms per volt and per amp, and its
  // drift per degree. `%` and `V/V` are both accepted for the initial accuracy
  // because vendors print both, and `units.ts` scales a percent to a fraction
  // so the two arrive here as the same number.
  outputVoltage: ["V"],
  lineRegulation: ["PPM/V"],
  loadRegulation: ["PPM/A"],
  outputDrift: ["PPM/°C", "PPM/C", "PPM/DEGC"],
  initialAccuracy: ["%", "V/V"],
  dropoutVoltage: ["V"],
  supplyVoltage: ["V"],
  propagationDelay: ["S"],
  outputLowVoltage: ["V"],
  outputSinkCurrent: ["A"],
  outputLeakageCurrent: ["A"],
  hysteresis: ["V"],
  // A REGULATOR'S CHANGE OVER A STATED RANGE, in either of the two forms
  // vendors print. The base unit is carried onto the record and read again by
  // `ldo.ts`, because `%` is already a fraction of the output and `V` is not.
  lineRegulationOverRange: ["V", "%"],
  loadRegulationOverRange: ["V", "%"]
};

/**
 * The one unit each model parameter is expressed in, once it is on the record.
 *
 * A gain may be printed in decibels or as a plain ratio, and vendors use both:
 * OPA333 prints `130 dB` while LM358 prints `100 V/mV`. Carrying whichever the
 * document used and hoping the emitter checks is the "fixed in one place, not
 * the other" shape that `LEARNINGS.md` calls this codebase's dominant failure
 * mode. It bit immediately: the emitter computes `pow(10, gain/20)`, so LM358's
 * ratio of 1e5 became `10^5000` and the model produced no measurable value at
 * all.
 *
 * So conversion happens HERE, where the unit is still known, and everything
 * downstream can rely on one representation.
 */
export function canonicalise(parameter: ModelParameter, value: number, base: string): number {
  if (parameter === "openLoopGain" && base === "V/V") return 20 * Math.log10(value);
  return value;
}

function toCorner(row: SpecRow, scale: number, parameter: ModelParameter, base: string): Corner {
  // Nothing is derived from anything else. A corner the document does not
  // print stays null all the way to the emitter, which then emits no corner.
  const at = (raw: number | null): number | null => (raw === null ? null : canonicalise(parameter, raw * scale, base));
  return { min: at(row.values.min), typ: at(row.values.typ), max: at(row.values.max) };
}

/**
 * A stable key for the block a row belongs to.
 *
 * Joined on NUL because it is the one character that cannot appear in a scope
 * or a grade read off a page, so two different pairs can never collide on one
 * key. Written as an ESCAPE rather than as a literal NUL byte: a literal one
 * makes this a binary file to `file`, `grep` and every tool that asks them,
 * and a source file that greps as binary silently disappears from searches.
 */
function blockKey(row: SpecRow): string {
  return `${row.scope ?? ""}\u0000${row.group ?? ""}`;
}

/**
 * Groups rows into coherent blocks and reports every one.
 *
 * ALL blocks are returned, never just the fullest. Choosing between a 5 V and a
 * 10 V block, or between two grades, is a decision about which part the user
 * has in their hand, and this file cannot know that. Presenting the choice is
 * the product's job; picking one silently would be an assumption under
 * RULES.md 2.
 */
export function readBlocks(rows: SpecRow[]): ModelBlock[] {
  const byBlock = new Map<string, SpecRow[]>();
  for (const row of rows) {
    if (!row.key) continue;
    const list = byBlock.get(blockKey(row)) ?? [];
    list.push(row);
    byBlock.set(blockKey(row), list);
  }

  const blocks: ModelBlock[] = [];
  for (const list of byBlock.values()) {
    const values: Partial<Record<ModelParameter, ModelValue>> = {};
    for (const parameter of ALL_PARAMETERS) {
      const specKey = fromSpec(parameter);
      // Several rows can state the same parameter under different conditions
      // (25 C and over temperature). Prefer the one carrying a typical, which
      // is the characterised value; keep the others out of the model but they
      // remain on the record for the user.
      const candidates = list.filter((r) => r.key === specKey);
      // A row BOTH readings named outranks one only the model named.
      //
      // This is not ranking the readers, which is the rule this project has
      // broken and paid for: it is preferring the better-attested identity, and
      // it only ever chooses between rows that all claim to be this parameter.
      // Without it a model-named row displaced a vocabulary-named one on
      // OPA2189 and took two conformance checks from pass to unverifiable,
      // because the row it displaced was the one carrying the test conditions.
      const ranked = [...candidates].sort((a, b) => Number(a.namedByModel ?? false) - Number(b.namedByModel ?? false));
      const chosen = ranked.find((r) => r.values.typ !== null) ?? ranked[0];
      if (!chosen) continue;

      const parsed = parseUnit(chosen.unit);
      if (!parsed) continue; // magnitude unknown: refuse to scale, keep nothing
      if (!EXPECTED_BASE[parameter].includes(parsed.base)) continue; // wrong dimension

      values[parameter] = {
        si: toCorner(chosen, parsed.scale, parameter, parsed.base),
        printed: { min: chosen.values.min, typ: chosen.values.typ, max: chosen.values.max },
        unit: chosen.unit ?? "",
        conditions: chosen.conditions,
        page: chosen.page,
        ambiguousMicro: parsed.ambiguousMicro
      };
    }
    const first = list[0];
    blocks.push({
      scope: first.scope,
      group: first.group,
      values,
      missing: [] as ModelParameter[], // filled below, once the block exists
      missingFor: {} as Record<DeviceClassId, ModelParameter[]>
    });
  }
  for (const block of blocks) fillMissing(block);
  return blocks.sort((a, b) => Object.keys(b.values).length - Object.keys(a.values).length);
}

/**
 * What each class would still need from this block, written onto it.
 *
 * Separated from `readBlocks` because a block's values can change AFTER it is
 * grouped: a value the user supplied is written on later, and a block whose
 * `missingFor` was computed before that would report a parameter as absent
 * while holding it. Anything that adds a value to a block calls this again.
 *
 * `missing` needs the finished block, because usability depends on which
 * corners the block as a whole can express.
 */
export function fillMissing(block: ModelBlock): ModelBlock {
  const available = (parameter: ModelParameter): boolean =>
    Boolean(block.values[parameter]) && cornersOf(block).some((corner) => valueAt(block, parameter, corner) !== null);
  for (const deviceClass of DEVICE_CLASSES) {
    const missing = deviceClass.required.filter((p) => !available(p));
    // The disjunction is reported as a GROUP when none of it is present, so
    // the refusal names every value that would have unblocked the model
    // rather than one of them chosen arbitrarily.
    if (deviceClass.alsoOneOf && !deviceClass.alsoOneOf.some((p) => available(p))) {
      missing.push(...deviceClass.alsoOneOf);
    }
    block.missingFor[deviceClass.id] = missing;
  }
  // `missing` names the AMPLIFIER requirement, which is what every existing
  // caller means by it. The per-class record beside it is what a second class
  // reads, so neither has to know about the other.
  block.missing = block.missingFor.opamp;
  return block;
}

/**
 * True when a parameter can actually produce a number at every corner.
 *
 * Presence on the record is NOT the same as usability: LMP7704-SP prints an
 * open-loop gain row with no typical, so the value existed, `missing` was empty,
 * and the emitter then wrote a subcircuit referencing a `.param` it had not
 * emitted. The netlist simulated to nothing.
 *
 * This is the one definition of "usable", and both the completeness check and
 * the emitter ask it, so they cannot drift apart.
 */
export function usable(block: ModelBlock, parameter: ModelParameter): boolean {
  if (!block.values[parameter]) return false;
  return cornersOf(block).every((corner) => valueAt(block, parameter, corner) !== null);
}

/** True when a parameter has a value at every corner this model will emit. */
export function usableAt(
  block: ModelBlock,
  parameter: ModelParameter,
  corners: Array<"typ" | "min" | "max">
): boolean {
  return Boolean(block.values[parameter]) && corners.length > 0 && corners.every((corner) => valueAt(block, parameter, corner) !== null);
}

/**
 * Corners jointly supported by a particular topology's REQUIRED parameters.
 *
 * `cornersOf` deliberately reports everything printed anywhere in a block. It
 * is the right provenance answer, but not necessarily the set a model can
 * express. A min/max-only output voltage and a typical dropout voltage, for
 * example, support honest min and max LDO models; the unrelated typical corner
 * must not make the whole part unusable. We therefore intersect the printed
 * corners with the class contract and emit only the surviving set.
 */
export function supportedCorners(block: ModelBlock, deviceClass: DeviceClass): Array<"typ" | "min" | "max"> {
  return cornersOf(block).filter(
    (corner) =>
      deviceClass.required.every((parameter) => valueAt(block, parameter, corner) !== null) &&
      (!deviceClass.alsoOneOf || deviceClass.alsoOneOf.some((parameter) => valueAt(block, parameter, corner) !== null))
  );
}

/**
 * A parameter this block states that PROVES it is not this class, or null.
 *
 * Separate from `missing` because the two are opposite kinds of evidence and
 * the refusal has to say which: "it does not state a gain-bandwidth" and "it
 * states a dropout voltage, so it is not a comparator" send a reader to
 * different pages.
 */
export function disqualifies(block: ModelBlock, deviceClass: DeviceClass): ModelParameter | null {
  // Disqualification is evidence that the document STATES a quantity, not a
  // promise that every other corner can use it. A min-only dropout still proves
  // a device is not a comparator.
  return deviceClass.neverStates?.find((p) => {
    const value = block.values[p];
    return value !== undefined && Object.values(value.si).some((at) => at !== null);
  }) ?? null;
}

/** Blocks that carry everything a model of this class needs, and nothing that rules it out. */
export function buildable(blocks: ModelBlock[], deviceClass: DeviceClass = OPAMP): ModelBlock[] {
  return blocks.filter(
    (b) =>
      (b.missingFor[deviceClass.id] ?? b.missing).length === 0 &&
      supportedCorners(b, deviceClass).length > 0 &&
      disqualifies(b, deviceClass) === null
  );
}


/**
 * The corners a block can actually express, as a list of names.
 *
 * `typ` is present whenever any parameter has one. `min` and `max` are present
 * only where the document prints them, so a part whose datasheet gives no
 * maxima simply has no `max` corner rather than a fabricated one.
 */
export function cornersOf(block: ModelBlock): Array<"typ" | "min" | "max"> {
  const present: Array<"typ" | "min" | "max"> = [];
  for (const corner of ["typ", "min", "max"] as const) {
    if (Object.values(block.values).some((v) => v.si[corner] !== null)) present.push(corner);
  }
  return present;
}

/**
 * The value to use for a parameter at a corner, or null.
 *
 * A parameter with no entry at this corner FALLS BACK TO TYPICAL, and that is
 * not the defaulting this file forbids: it is the document's own statement that
 * the parameter does not vary in a way the vendor characterises. The difference
 * matters and is worth stating plainly. Inventing `max = typ` claims a
 * GUARANTEE that was never made. Using the typical value in a corner sweep
 * claims only that this is the one number the datasheet gives for it, which is
 * true, and the receipt says which parameters moved.
 */
export function valueAt(block: ModelBlock, parameter: ModelParameter, corner: "typ" | "min" | "max"): number | null {
  const value = block.values[parameter];
  if (!value) return null;
  if (value.si[corner] !== null) return value.si[corner];
  if (value.si.typ !== null) return value.si.typ;
  // Some datasheets guarantee a parameter without characterising it: LMP7704-SP
  // prints an open-loop gain of "84 dB min" and no typical. Refusing the part
  // over that loses a model the document fully supports, for a reason that is
  // ours. Where exactly ONE bound is printed it is the only thing the vendor
  // says about the parameter, so it is what the model uses, and the emitted
  // header states plainly that only a minimum (or only a maximum) was printed.
  //
  // Where BOTH bounds are printed and no typical is, there is no single answer
  // and this returns null rather than choosing one.
  const bounds = [value.si.min, value.si.max].filter((v): v is number => v !== null);
  return bounds.length === 1 ? bounds[0] : null;
}

/** Parameters that genuinely vary across the corners this block can express. */
export function varyingParameters(block: ModelBlock): ModelParameter[] {
  return MODEL_PARAMETERS.filter((p) => {
    const v = block.values[p];
    if (!v) return false;
    return (v.si.min !== null || v.si.max !== null) && v.si.typ !== null;
  });
}
