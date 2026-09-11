/**
 * The whole feature, end to end: a datasheet in, a model and its receipt out.
 *
 * ## The generator is a loop around the verifier
 *
 * This is the shape the measurements pushed us into and it is worth naming.
 * Emitting a model and checking it are not two stages; checking is how the model
 * is BUILT. A first emission substitutes the datasheet's numbers, the simulation
 * says what the model actually does at its pins, and the difference is solved
 * away. Measured on OPA333 that converges in two iterations, from 20% out to
 * 0.2%.
 *
 * The alternative, templating the printed values and shipping, is wrong by 20%
 * on every part whose datasheet states a load condition.
 */

import { readGainEquation, readSpecRows } from "./pdfspans";
import { ALL_PARAMETERS, readBlocks, buildable, canonicalValue, supportedCorners, disqualifies, fillMissing, valueAt, DEVICE_CLASSES, type Corner, type DeviceClass, type DeviceClassId, type ModelBlock, type ModelParameter } from "./model";
import { emitSubckt, emitAsy, NO_TRIM, type Trim } from "./emit";
import { verify, type ConformanceReport } from "./verify";
import { emitReferenceAsy, emitReferenceSubckt, verifyReference } from "./reference";
import { emitComparatorAsy, emitComparatorSubckt, verifyComparator } from "./comparator";
import { emitLdoAsy, emitLdoSubckt, verifyLdo } from "./ldo";
import { emitInstrumentationAsy, emitInstrumentationSubckt, verifyInstrumentation } from "./instrumentation";
import { confirmParameters, type ModelReadValue, type SpiceConfirmationReport } from "./confirm";
import { applyModelIdentities, type Naming } from "./identify";
import { tablePagesOf } from "./read-model";
import type { SpecRow } from "./specs";
import { extractDatasheetText, type DatasheetText } from "../pdftext";
import { identifyDocumentDevice, statedOutputVoltageOptions } from "./device-identity";

export interface BuildResult {
  /** Every specification row read, including ones no model consumes. */
  rows: SpecRow[];
  /** Every coherent specification block found. */
  blocks: ModelBlock[];
  /** The block this model was built from, or null when none was buildable. */
  block: ModelBlock | null;
  /** Blocks the user may have to choose between. More than one means ask. */
  alternatives: ModelBlock[];
  /**
   * HOW the block above was chosen, when there was more than one.
   *
   * A family datasheet carries one block per part - L7805's has sixteen - and
   * the screen has to be able to tell the user whether the one it used was
   * NAMED by the document or simply came first. Those are very different claims
   * and printing the scope alone makes them look identical.
   */
  blockChosenBy: "the-caller-asked" | "caption-names-the-part" | "first-of-several" | "only-one";
  subckt: string | null;
  asy: string | null;
  report: ConformanceReport | null;
  trim: Trim;
  /**
   * RULES.md 7 for the parameters: what a second reading agreed with, and what
   * it did not. Null only when no model was built.
   */
  confirmations: SpiceConfirmationReport | null;
  /** Why no model was produced, in the engineer's language. */
  refusal: string | null;
  /**
   * The same reason as a SLUG, for grouping a bench's output into classes.
   *
   * Returned as data rather than left for a caller to recover from the sentence
   * above with a regular expression. A bench that greps its own product's prose
   * measures the prose: the refusal was reworded to name every device class and
   * the grep went on reporting an amplifier's missing gain-bandwidth for a
   * voltage reference.
   */
  refusalBecause: string | null;
  /** Rows the model named that our vocabulary could not. Each one is flagged. */
  named: Naming[];
  /** Rows the model named that still cannot become a parameter, and why. */
  blockedNames: Array<{ parameter: string; key: string; unit: string | null; why: string; page: number }>;
  /**
   * Which KIND of part this was built as, decided from what the table states.
   *
   * Null when nothing was built. Never decided from the part number: that is a
   * string somebody typed, and a table that prints a line regulation and no
   * gain-bandwidth is evidence.
   */
  deviceClass: DeviceClass | null;
  /** Fixed output options stated by the document, for a caller presenting the
   * one safe configuration question. Empty means the document stated none. */
  outputVoltageOptions: number[];
}

/** Two passes is what OPA333 needed; a third catches anything slower. */
const MAX_FIT_PASSES = 3;
/** Stop refining once the loaded response is this close to the document. */
const FIT_TOLERANCE_PCT = 0.5;

function measured(report: ConformanceReport, parameter: "openLoopGain" | "gbw"): number | null {
  const check = report.checks.find((c) => c.parameter === parameter && c.corner === "typ");
  return check?.measured ?? null;
}

/**
 * A missing parameter's name, marked when the value is ON THE RECORD.
 *
 * "The datasheet does not state an open-loop gain" and "it states one this
 * model cannot use" are different facts, and until 2026-09-04 the refusal
 * census reported both as the first. That sends whoever reads the census
 * looking for a vocabulary gap when the row was read, named and understood -
 * and it is the difference between a reading problem and a modelling one.
 *
 * The second case is real and has a known cause: a parameter must produce a
 * value at EVERY corner the block expresses, because a corner expression with a
 * hole in it emits no `.param` at all and the netlist then references something
 * it never declared. A military table stating a guaranteed minimum gain and no
 * typical, in a block whose other rows do have typicals, lands exactly there.
 */
function nameMissing(block: ModelBlock | undefined, parameter: ModelParameter): string {
  return block?.values[parameter] ? `${parameter}(read-not-every-corner)` : parameter;
}

/**
 * The block whose scope names this part, or null.
 *
 * Compared on alphanumerics only, because a scope is a caption and carries the
 * document's punctuation: `LD1117#18` and `LD1117-18` are the same statement.
 * Containment rather than equality, in both directions, because a caption names
 * a variant of the part (`L7805A` for `L7805`) as often as the part itself.
 *
 * Returns null when more than one block matches, which is not a failure: two
 * captions naming the same part is the document declining to discriminate, and
 * the caller then presents the choice as it would have anyway.
 */
/**
 * The user's answers, written onto every block as if they were read - except for
 * the one thing that must never be faked, which is the citation.
 *
 * Applied to EVERY block rather than to the chosen one, because the choice
 * happens after this and a value present on only some blocks would silently
 * decide which of them is buildable.
 *
 * A value the document DOES state is never overwritten. The user is answering a
 * question this product asked because the page was silent; if the page was not
 * silent, the question should not have been asked and the page wins.
 */
function withSupplied(
  blocks: ModelBlock[],
  supplied: Partial<Record<ModelParameter, number>> | undefined,
  replaceOutputVoltage = false
): ModelBlock[] {
  if (!supplied) return blocks;
  const entries = Object.entries(supplied) as Array<[ModelParameter, number]>;
  if (entries.length === 0) return blocks;
  return blocks.map((block) => {
    const values = { ...block.values };
    for (const [parameter, value] of entries) {
      if (!Number.isFinite(value) || (values[parameter] && !(replaceOutputVoltage && parameter === "outputVoltage"))) continue;
      values[parameter] = {
        // Every corner, because a supplied nominal is a single number and a
        // block expressing three corners would otherwise find it unusable.
        si: { min: value, typ: value, max: value },
        printed: { min: null, typ: value, max: null },
        unit: "V",
        conditions: null,
        // NULL, and this is the whole provenance mechanism. Every citation in
        // the netlist header and the receipt is `page N`; a supplied value has
        // no page and must not be given one.
        page: null,
        ambiguousMicro: false,
        suppliedByUser: true
      };
    }
    // RECOMPUTED, because `missingFor` was written when the block was grouped
    // and a value added afterwards does not reach it. Without this the block
    // holds the supplied output voltage and still reports it as missing, which
    // is a refusal naming a value the product was just handed.
    return fillMissing({ ...block, values, missingFor: {} as ModelBlock["missingFor"] });
  });
}

/** A human correction made while looking at the cited rendered page. */
export interface ModelCorrection {
  parameter: ModelParameter;
  printed: Corner;
  unit: string;
  page: number;
  scope?: string | null;
  group?: string | null;
}

/**
 * Apply reviewed corrections to the block they came from. Unlike an answer to
 * a silent datasheet, a correction MUST carry a page and retains the exact
 * printed unit. Invalid dimensions are ignored here and rejected at the route
 * boundary; keeping this function total protects non-route callers too.
 */
function withCorrections(blocks: ModelBlock[], corrections: ModelCorrection[] | undefined): ModelBlock[] {
  if (!corrections?.length) return blocks;
  // A total table-reader miss used to make reviewed corrections a dead end:
  // there was no block for them to attach to. A cited human reading is itself
  // enough to seed one unlabelled block; class recognition still requires the
  // full independent parameter contract below, so this does not guess a kind.
  const targets = blocks.length > 0 ? blocks : [{
    scope: corrections[0].scope ?? null,
    group: corrections[0].group ?? null,
    values: {},
    missing: [],
    missingFor: {} as ModelBlock["missingFor"]
  } satisfies ModelBlock];
  return targets.map((block) => {
    const values = { ...block.values };
    for (const correction of corrections) {
      if (correction.scope !== undefined && correction.scope !== block.scope) continue;
      if (correction.group !== undefined && correction.group !== block.group) continue;
      const si = (Object.keys(correction.printed) as Array<keyof Corner>).reduce<Corner>(
        (out, corner) => {
          const printed = correction.printed[corner];
          out[corner] = printed === null ? null : canonicalValue(correction.parameter, printed, correction.unit);
          return out;
        },
        { min: null, typ: null, max: null }
      );
      if (Object.values(si).every((value) => value === null)) continue;
      values[correction.parameter] = {
        si,
        printed: correction.printed,
        unit: correction.unit,
        conditions: values[correction.parameter]?.conditions ?? null,
        page: correction.page,
        ambiguousMicro: false,
        correctedByUser: true
      };
    }
    return fillMissing({ ...block, values, missingFor: {} as ModelBlock["missingFor"] });
  });
}

export function namedBlock(blocks: ModelBlock[], partNumber: string): ModelBlock | null {
  const fold = (text: string) => text.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  const key = fold(partNumber);
  if (key.length < 3) return null;
  const scoped = blocks
    .map((block) => ({ block, scope: fold(block.scope ?? "") }))
    .filter((entry) => entry.scope.length >= 3);

  // AN EXACT CAPTION BEATS A CONTAINING ONE, and it has to, or a family sheet
  // that captions both `LD1117` and `LD1117-33` would report the two as an
  // ambiguity when one of them is the part that was asked for.
  const exact = scoped.filter((entry) => entry.scope === key);
  if (exact.length === 1) return exact[0].block;
  if (exact.length > 1) return null;

  const matches = scoped.filter((entry) => entry.scope.includes(key) || key.includes(entry.scope));
  return matches.length === 1 ? matches[0].block : null;
}

/**
 * Solves for the internal parameters whose LOADED behaviour matches the
 * document, then reports how well the final model conforms.
 */
export async function buildModel(
  pdfBytes: ArrayBuffer,
  partNumber: string,
  choose?: { scope?: string | null; group?: string | null; deviceClass?: DeviceClassId; blockIndex?: number },
  /**
   * A second reading of the same tables, taken from the RENDERED page.
   *
   * Passed as a CALLBACK rather than a value so this function decides which
   * pages are worth rendering: the deterministic read has already located the
   * tables, and rendering the rest of the document would be paying for pages
   * nobody needs.
   *
   * Absent means no second source was available, and the parameters are then
   * flagged as single-source rather than treated as agreed. Silence is not
   * agreement, and this stays network-free unless a caller opts in.
   */
  secondReader?: (pages: number[]) => Promise<ModelReadValue[] | null>,
  /**
   * VALUES THE USER SUPPLIED, because the document genuinely does not state them.
   *
   * There is exactly one so far and it is the regulator's nominal output. A
   * modern fixed LDO states an ACCURACY and not a nominal, because the nominal
   * is an ordering option: measured across fourteen regulator datasheets
   * outside the hold-out, seven state no output voltage anywhere - TPS7A02,
   * ADP151, TLV70012, LP5907, MIC5205 and TPS736 among them. The number is in
   * the part-number suffix and NOWHERE ELSE.
   *
   * Decoding that suffix is not available to this product. `-1.8` means 1.8 V on
   * one vendor and `3302` means 3.3 V on another, and RULES.md 1 forbids
   * inventing a value while the class doctrine forbids reading anything out of
   * a part number. So the honest options are to refuse or to ask, and asking for
   * one number an engineer has in front of them is the friction this product is
   * built to trade for.
   *
   * A supplied value is marked as such everywhere it appears - `page` is null,
   * and the netlist header and the receipt say who supplied it. It is never
   * cited to a page, because nobody read it off one.
   */
  supplied?: Partial<Record<ModelParameter, number>>,
  corrections?: ModelCorrection[],
  /** Already-validated text from automatic retrieval; avoids parsing the same
   * bytes twice and losing front-matter identity on only the second parse. */
  identityTextOverride?: DatasheetText
): Promise<BuildResult> {
  const [tableRows, gainEquation, identityText] = await Promise.all([
    readSpecRows(pdfBytes),
    readGainEquation(pdfBytes, partNumber),
    identityTextOverride
      ? Promise.resolve(identityTextOverride)
      : extractDatasheetText(pdfBytes, { maxPages: 4 }).catch(() => null)
  ]);
  const read: SpecRow[] = gainEquation
    ? [...tableRows, {
        parameter: gainEquation.equation,
        key: "gainResistance",
        symbol: "K",
        conditions: "Printed instrumentation-amplifier gain equation",
        unit: gainEquation.unit,
        values: { min: null, typ: gainEquation.printed, max: null },
        group: null,
        scope: null,
        page: gainEquation.page
      }]
    : tableRows;
  const modelRead = secondReader ? await secondReader(tablePagesOf(read)) : null;
  // A visual reader may recover a row the text geometry never exposed. It can
  // become evidence only when it names a supported quantity, quotes a unit and
  // value, and cites a real source page. These rows remain `namedByModel`, so
  // confirmation presents them as single-source rather than silently trusted.
  const recovered = (modelRead ?? []).flatMap((candidate): SpecRow[] => {
    if (!candidate.means || !ALL_PARAMETERS.includes(candidate.means as ModelParameter)) return [];
    if (!candidate.unit || !Number.isInteger(candidate.page) || (candidate.page ?? 0) <= 0) return [];
    if ([candidate.min, candidate.typ, candidate.max].every((value) => value === null)) return [];
    const folded = (text: string | null | undefined) => (text ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
    const alreadyRead = read.some((row) =>
      (row.group ?? null) === (candidate.group ?? null) &&
      ((row.symbol && candidate.symbol && folded(row.symbol) === folded(candidate.symbol)) || folded(row.parameter) === folded(candidate.parameter))
    );
    if (alreadyRead) return [];
    return [{
      parameter: candidate.parameter,
      key: candidate.means,
      symbol: candidate.symbol ?? null,
      conditions: candidate.conditions ?? null,
      unit: candidate.unit,
      values: { min: candidate.min, typ: candidate.typ, max: candidate.max },
      group: candidate.group,
      grade: candidate.grade ?? null,
      scope: candidate.scope ?? null,
      page: candidate.page!,
      namedByModel: true,
      recoveredByModel: true
    }];
  });
  // A row the vocabulary could not name but the model could. The numbers are
  // still ours; only the identity is single-source, and it ships flagged. This
  // runs BEFORE the blocks are grouped, because an unnamed row is invisible to
  // `readBlocks` and a part is refused for a gain that was read and discarded.
  const identified = applyModelIdentities([...read, ...recovered], modelRead);
  const rows = identified.rows;
  // A recovered row and the model answer it came from are ONE reading, not two
  // agreeing readings. Recording its identity here makes the shared
  // confirmation policy flag it rather than self-confirming it.
  const named = [
    ...identified.named,
    ...recovered.map((row) => ({ parameter: row.parameter, key: row.key!, page: row.page }))
  ];
  const { conflicts, blocked } = identified;
  const rawBlocks = readBlocks(rows);
  const outputOptions = identityText ? statedOutputVoltageOptions(identityText.pages.map((page) => page.text)) : [];
  const foldedPart = partNumber.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  const variantOutputRow = rows.some((row) => {
    if (row.key !== "outputVoltage") return false;
    const qualifier = row.parameter.replace(/(?:OUTPUT|REFERENCE)\s*(?:OUTPUT\s*)?VOLTAGE/gi, "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
    return qualifier.length > foldedPart.length && qualifier.includes(foldedPart);
  });
  const familyOutputAmbiguous = namedBlock(rawBlocks, partNumber) === null && (outputOptions.length > 1 || variantOutputRow);
  const selectedOutputVoltage = supplied?.outputVoltage !== undefined && (
    outputOptions.length === 0 || outputOptions.some((option) => Math.abs(option - supplied.outputVoltage!) < 1e-9)
  );
  const blocks = withCorrections(withSupplied(rawBlocks, supplied, familyOutputAmbiguous && selectedOutputVoltage), corrections);

  // WHICH KIND OF PART, from what the document states.
  //
  // Every class is tried and the first that any block satisfies is the one
  // built. The amplifier comes first only because it is the stricter test: it
  // needs an open-loop gain AND a gain-bandwidth, which a reference never
  // prints, so a reference cannot satisfy it by accident. Order is not a
  // preference and nothing here looks at the part number.
  let deviceClass: DeviceClass | null = null;
  let ready: ModelBlock[] = [];
  const documentIdentity = identityText
    ? identifyDocumentDevice(identityText.pages.map((page) => page.text))
    : { supported: null, unsupported: null, ambiguous: false };
  const candidateClasses = choose?.deviceClass
    ? DEVICE_CLASSES.filter((candidate) => candidate.id === choose.deviceClass)
    : documentIdentity.supported
      ? DEVICE_CLASSES.filter((candidate) => candidate.id === documentIdentity.supported)
      : documentIdentity.unsupported || documentIdentity.ambiguous
        ? []
        : DEVICE_CLASSES;
  for (const candidate of candidateClasses) {
    const fits = buildable(blocks, candidate);
    if (fits.length > 0) {
      deviceClass = candidate;
      // A second visual reading may recover values, but its free-form scope is
      // not by itself an independent reason to invent a new selectable grade.
      // When at least one buildable block is anchored by deterministic table
      // geometry, only those anchored blocks may become user-facing choices.
      // Recovery-only blocks remain usable when deterministic extraction found
      // no block at all, preserving the page-review escape hatch.
      const anchored = fits.filter((block) => read.some((row) =>
        row.key && (row.scope ?? null) === block.scope && (row.group ?? null) === block.group
      ));
      ready = anchored.length > 0 ? anchored : fits;
      break;
    }
  }

  const base: BuildResult = { rows, blocks, block: null, alternatives: [], blockChosenBy: "only-one", subckt: null, asy: null, report: null, trim: NO_TRIM, confirmations: null, refusal: null, refusalBecause: null, named, blockedNames: blocked, deviceClass: null, outputVoltageOptions: outputOptions };

  if (!choose?.deviceClass && (documentIdentity.unsupported || documentIdentity.ambiguous)) {
    return {
      ...base,
      refusalBecause: "unsupported-device-class",
      refusal: documentIdentity.unsupported
        ? `This document identifies the part as a ${documentIdentity.unsupported}, for which Forge has no generated behavioural-model contract. A standalone vendor model can still be adapted without inferring its behaviour.`
        : "The document's front matter names more than one supported device kind, so Forge cannot choose a behavioural topology without a reviewed device-kind selection."
    };
  }

  if (ready.length === 0 || deviceClass === null) {
    // THE REFUSAL NAMES WHAT EVERY CLASS WOULD HAVE NEEDED.
    //
    // Naming only the amplifier's two parameters told the reader of a
    // comparator or a reference datasheet that their document was missing a
    // gain-bandwidth, which is true and useless: their part has none, and the
    // sentence pointed them at a page that will never carry one.
    const first = blocks[0];
    const diagnosticClasses = choose?.deviceClass
      ? DEVICE_CLASSES.filter((candidate) => candidate.id === choose.deviceClass)
      : documentIdentity.supported
        ? DEVICE_CLASSES.filter((candidate) => candidate.id === documentIdentity.supported)
        : DEVICE_CLASSES;
    const perClass = diagnosticClasses.map((candidate) => {
      // A class ruled OUT by what the document states is a different sentence
      // from one short of something, and saying the wrong one sends the reader
      // looking for a row that is on the page.
      const ruledOut = first ? disqualifies(first, candidate) : null;
      if (ruledOut) return `it is not a ${candidate.label}, because it states a ${ruledOut}`;
      const missing = first?.missingFor[candidate.id] ?? candidate.required;
      return `as a ${candidate.label}, it does not state ${[...missing].join(" or ")}`;
    });
    // THE CLOSEST CLASS, AND ONLY IF SOMETHING WAS ACTUALLY CLOSE.
    //
    // A class is "close" only when the document supplied PART of what it needs.
    // Ranking by the raw count of missing parameters instead made every op-amp
    // that failed report `comparator:propagationDelay`, because a comparator
    // needs one parameter and an amplifier needs two: NJM4580, which states
    // neither a gain nor a gain-bandwidth and is not remotely a comparator, was
    // filed under the comparator class. A slug that groups a bench's findings
    // has to group them by something true.
    const evidence = diagnosticClasses.map((candidate) => {
      const missing = first?.missingFor[candidate.id] ?? [...candidate.required];
      const ruledOut = first ? disqualifies(first, candidate) !== null : false;
      return {
        candidate,
        missing,
        // A class the document RULES OUT is not the closest one, however few
        // parameters separate it. Ranking it as such would name the wrong class
        // in the census and point the reader at the wrong page.
        partial:
          !ruledOut && missing.length > 0 && missing.length < candidate.required.length + (candidate.alsoOneOf?.length ?? 0)
      };
    });
    const closest = evidence.filter((entry) => entry.partial).sort((a, b) => a.missing.length - b.missing.length)[0];

    return {
      ...base,
      refusalBecause:
        first === undefined || Object.keys(first.values).length === 0
          ? "no-spec-table-read"
          : closest
            ? `${closest.candidate.id}:${closest.missing.map((p) => nameMissing(first, p)).join("+")}`
            : // Rows were read and NOTHING this product models was even partly
              // described. That is a class boundary, not a reading failure, and
              // it is worth its own name in the census.
              "no-class-matched",
      refusal:
        `This datasheet does not state enough to build any model this product knows how to make. ` +
        `Read ${first ? Object.keys(first.values).length : 0} parameters from it, and ${perClass.join("; ")}. ` +
        `Nothing was assumed in their place.`
    };
  }

  // Choosing between a 5 V block and a 10 V block, or between two grades, is a
  // question about which part the user is holding. Present it; never pick.
  //
  // WITH ONE EXCEPTION, AND IT IS A READ RATHER THAN A PICK: where a block's
  // scope NAMES the part that was asked for, that is the document itself saying
  // which table describes this part, and ignoring it would be throwing away
  // evidence in order to look neutral.
  //
  // It matters most exactly where the choice is hardest. L7805's datasheet
  // carries sixteen blocks, captioned `Electrical characteristics of L7805A`
  // through `of L7824A`, and a fallback to the first of them is a coin flip
  // between a 5 V part and a 24 V one - with every value read correctly, every
  // check passing, and nothing downstream able to tell.
  const captioned = namedBlock(ready, partNumber);
  const hasBlockChoice = choose?.blockIndex !== undefined || choose?.scope !== undefined || choose?.group !== undefined;
  const requested = choose?.blockIndex !== undefined
    ? ready[choose.blockIndex]
    : hasBlockChoice
      ? ready.find((b) => (choose!.scope === undefined || b.scope === choose!.scope) && (choose!.group === undefined || b.group === choose!.group))
      : undefined;
  const chosen = requested ?? captioned ?? ready[0];
  const blockChosenBy: BuildResult["blockChosenBy"] =
    ready.length === 1 ? "only-one" : requested ? "the-caller-asked" : chosen === captioned ? "caption-names-the-part" : "first-of-several";
  const alternatives = ready.filter((b) => b !== chosen);

  // A bare family number can name several fixed output products.  One table's
  // first voltage is not evidence that this is the variant the user holds.
  // Stop before emission unless the caller selected a table/value explicitly.
  if (
    (deviceClass.id === "reference" || deviceClass.id === "ldo") &&
    familyOutputAmbiguous &&
    !selectedOutputVoltage &&
    !requested &&
    !captioned
  ) {
    return {
      ...base,
      deviceClass,
      block: chosen,
      alternatives,
      blockChosenBy,
      refusalBecause: `${deviceClass.id}:outputVoltage`,
      refusal:
        (outputOptions.length > 1
          ? `This family datasheet states ${outputOptions.length} fixed output-voltage options (${outputOptions.join(", ")} V), `
          : "This family datasheet labels its output-voltage row as a specific ordering variant, ") +
        "but the requested part number does not select one. Supply the exact ordering value; Forge will not use the first table as the part's voltage."
    };
  }

  const corners = supportedCorners(chosen, deviceClass);

  if (deviceClass.id === "instrumentation") {
    const instrumentationSubckt = emitInstrumentationSubckt(chosen, { partNumber });
    return {
      ...base,
      deviceClass,
      block: chosen,
      blockChosenBy,
      alternatives,
      subckt: instrumentationSubckt,
      asy: emitInstrumentationAsy(partNumber),
      report: await verifyInstrumentation(instrumentationSubckt, chosen, partNumber, corners),
      confirmations: confirmParameters(chosen, rows, modelRead, { named, conflicts }),
      refusal: null
    };
  }

  // A REFERENCE IS NOT FITTED. The amplifier's fit loop exists because its
  // parameters are specified at the pins under a load, so the printed number
  // already contains a divider the model has to solve back out. A reference's
  // two regulation slopes ARE the pin behaviour: the datasheet defines them as
  // derivatives measured at the output, so there is nothing to solve for and a
  // loop here would be machinery that changes no number.
  // A COMPARATOR IS NOT FITTED EITHER. Its propagation delay is a property of
  // the part measured at its own pins under a step, not a loaded response with a
  // divider hidden inside it, so there is nothing to solve back out.
  if (deviceClass.id === "comparator") {
    const comparatorSubckt = emitComparatorSubckt(chosen, { partNumber });
    return {
      ...base,
      deviceClass,
      block: chosen,
      blockChosenBy,
      alternatives,
      subckt: comparatorSubckt,
      asy: emitComparatorAsy(partNumber),
      report: await verifyComparator(comparatorSubckt, chosen, partNumber, corners),
      confirmations: confirmParameters(chosen, rows, modelRead, { named, conflicts }),
      refusal: null
    };
  }

  // A REGULATOR IS NOT FITTED EITHER, and for the reference's reason: its two
  // regulation terms are defined at the output pin, so there is no divider
  // hidden inside the printed number for a fit loop to solve back out.
  if (deviceClass.id === "ldo") {
    const ldoSubckt = emitLdoSubckt(chosen, { partNumber });
    return {
      ...base,
      deviceClass,
      block: chosen,
      blockChosenBy,
      alternatives,
      subckt: ldoSubckt,
      asy: emitLdoAsy(partNumber),
      report: await verifyLdo(ldoSubckt, chosen, partNumber, corners),
      confirmations: confirmParameters(chosen, rows, modelRead, { named, conflicts }),
      refusal: null
    };
  }

  if (deviceClass.id === "reference") {
    const referenceSubckt = emitReferenceSubckt(chosen, { partNumber });
    return {
      ...base,
      deviceClass,
      block: chosen,
      blockChosenBy,
      alternatives,
      subckt: referenceSubckt,
      asy: emitReferenceAsy(partNumber),
      report: await verifyReference(referenceSubckt, chosen, partNumber, corners),
      confirmations: confirmParameters(chosen, rows, modelRead, { named, conflicts }),
      refusal: null
    };
  }

  let trim: Trim = { ...NO_TRIM };
  let subckt = emitSubckt(chosen, { partNumber, trim });
  let report = await verify(subckt, chosen, partNumber, corners);

  const targetGain = valueAt(chosen, "openLoopGain", "typ");
  const targetGbw = valueAt(chosen, "gbw", "typ");

  for (let pass = 1; pass < MAX_FIT_PASSES && targetGain !== null && targetGbw !== null; pass++) {
    const gain = measured(report, "openLoopGain");
    const gbw = measured(report, "gbw");
    if (gain === null || gbw === null || gbw === 0) break;
    const gainError = Math.abs(gain - targetGain);
    const gbwError = Math.abs((gbw - targetGbw) / targetGbw) * 100;
    if (gainError < 0.05 && gbwError < FIT_TOLERANCE_PCT) break;

    trim = { gainDb: trim.gainDb + (targetGain - gain), gbw: trim.gbw * (targetGbw / gbw) };
    subckt = emitSubckt(chosen, { partNumber, trim });
    report = await verify(subckt, chosen, partNumber, corners);
  }

  return {
    ...base,
    deviceClass,
    block: chosen,
    blockChosenBy,
    alternatives,
    subckt,
    asy: emitAsy(partNumber),
    report,
    trim,
    confirmations: confirmParameters(chosen, rows, modelRead, { named, conflicts }),
    refusal: null
  };
}
