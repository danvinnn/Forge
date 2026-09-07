/**
 * READING A SPECIFICATION TABLE, DETERMINISTICALLY, FROM GEOMETRY.
 *
 * This is the second of the two independent means RULES.md 7 requires for a
 * parameter. The other is a model reading the rendered page. They consume
 * different things, character codes here and pixels there, so they cannot fail
 * together: measured on AD8628, this reader is WRONG about the micro sign
 * because the PDF stores `m`, and a model looking at the drawn glyph is right.
 *
 * ## Why geometry and not text
 *
 * The flattened text layer of a specification table is unusable. OPA333's
 * gain-bandwidth row arrives as three fragments:
 *
 *     GBWGain-bandwidthproductC | L | = 100 pF350kHz
 *
 * But a specification table is a GRID, and every span carries its position. So
 * the MIN, TYP and MAX columns are located from the header's x coordinates and
 * every number is assigned to a column by where it is PRINTED. Measured against
 * a vision model on the same table: 5 of 5 against 3 of 5, and the two it fixed
 * were the two classic table errors, a value taken from the adjacent row and a
 * typical value filed under minimum.
 *
 * ## What this file will not do
 *
 * It does not decide which block, grade or supply the caller wants, and it does
 * not drop a row it cannot name. `SPICE.md` section 32 lists six places where an
 * earlier design threw away something it had already read, which is the single
 * most expensive failure shape in this codebase. The rule here is: read once,
 * store everything, decide later.
 */

import {
  normaliseHeader,
  normaliseSymbol,
  HEADER_MIN,
  HEADER_TYP,
  HEADER_MAX,
  HEADER_UNIT,
  HEADER_NOM,
  SECTION_SPEC,
  SECTION_NOT_SPEC,
  PARAMETERS,
  pickByUnit,
  READ_PREFIXES,
  type ParameterSpec
} from "./vocab";
import { parseUnit } from "./units";

/** A text span with the position the document drew it at. */
export interface Span {
  text: string;
  x: number;
  y: number;
}

/** Spans sharing a baseline, left to right. */
export interface Row {
  y: number;
  cells: Span[];
}

/** What a specification block says a value is. Any of the three may be absent. */
export interface SpecValues {
  min: number | null;
  typ: number | null;
  max: number | null;
}

/**
 * One row of one specification table, stored as the document prints it.
 *
 * `key` is null for a row whose description matches no parameter we model. The
 * row is KEPT anyway: the prompt and this reader are the expensive part, and a
 * row discarded here has to be read again when the model gains a block for it.
 */
export interface SpecRow {
  /** The description exactly as printed. */
  parameter: string;
  /** Our vocabulary key, or null when this is a parameter we do not model. */
  key: string | null;
  /**
   * The GRADE this value belongs to, where the table prints one inline.
   *
   * Some datasheets do not put the grade above a column group. They print it in
   * the test-conditions column, once per value sub-row: OPA2277 states four
   * offset voltages under one heading, labelled `OPA277P, U`, `OPA2277P, U`,
   * `OPAx277PA, UA` and `OPAx277AIDRM`, and the numbers differ by a factor of
   * eight. Dropped, all four look like readings of one row, and the two
   * readings of the page pick different ones and report a disagreement neither
   * of them made.
   *
   * It does NOT split the block. Measured on OPA2277: the gain and the
   * gain-bandwidth are discriminated by LOAD rather than by grade, so splitting
   * on it leaves every grade without the two parameters a model needs and
   * refuses a part that builds today.
   */
  grade?: string | null;
  /**
   * True when the KEY above came from the model rather than from our
   * vocabulary. The values on this row are still our own reading; only the
   * identity has a single source, and `confirm.ts` flags it as such.
   */
  namedByModel?: boolean;
  /** True when the visual reader recovered both the row and its values. */
  recoveredByModel?: boolean;
  /** The symbol as printed, or null when the document prints none. */
  symbol: string | null;
  /** Test conditions from the row, joined as printed. */
  conditions: string | null;
  /** The unit exactly as printed. NOT normalised: the glyph is evidence. */
  unit: string | null;
  values: SpecValues;
  /**
   * The label above this row's column group, where the table prints several.
   *
   * LT1013 prints three groups side by side, one of which is a different part
   * (LT1014). Reading the leftmost and calling it the requested part returns
   * 80/300 uV where the document guarantees 110/550, and NOTHING downstream
   * catches it: every value is valid, both readers agree, and a conformance
   * check compares the model against the same wrong column.
   */
  group: string | null;
  /** Scope parsed from the section heading, e.g. `VS = 5 V` or `LM358, LM358A`. */
  scope: string | null;
  /** 1-indexed page, for the citation. */
  page: number;
}

/** One MIN/TYP/MAX column group, with the x it was printed at. */
interface ColumnGroup {
  min: number | null;
  typ: number | null;
  max: number | null;
  label: string | null;
}

interface Header {
  groups: ColumnGroup[];
  unitX: number | null;
}

/** Cells nearer than this to a column's header x belong to that column. */
const COLUMN_TOLERANCE = 28;
/** How far above a header row to look for its group labels. */
const LABEL_LOOKUP_ROWS = 3;

/** Clusters spans into rows by baseline, then orders each row left to right. */
export function toRows(spans: Span[], tolerance = 2.5): Row[] {
  const sorted = [...spans].sort((a, b) => a.y - b.y || a.x - b.x);
  const rows: Row[] = [];
  for (const span of sorted) {
    const row = rows.find((r) => Math.abs(r.y - span.y) < tolerance);
    if (row) row.cells.push(span);
    else rows.push({ y: span.y, cells: [span] });
  }
  for (const row of rows) row.cells.sort((a, b) => a.x - b.x);
  return rows;
}

function isOneOf(text: string, list: readonly string[]): boolean {
  return list.includes(normaliseHeader(text));
}

/**
 * Reads a header row into one or more column groups.
 *
 * Returns null when the row is not a header. A header must carry at least a MIN
 * and a MAX: those two are what every specification table prints, and requiring
 * TYP as well would be a rule that happens to exclude absolute-maximum tables
 * for the wrong reason. Section identity is decided by heading, not by shape.
 */
function readHeader(row: Row, underSpecHeading = false): Header | null {
  const marks: Array<{ kind: "min" | "typ" | "max"; x: number }> = [];
  let unitX: number | null = null;
  let sawNominal = false;
  for (const cell of row.cells) {
    const headerText = normaliseHeader(cell.text);
    // PDF producers sometimes fuse the final heading and UNIT into one text
    // object (`MAX UNIT`). The x coordinate still belongs to MAX; the unit
    // column is recovered from the unit cells below by `adoptUnitColumn`.
    const fused = headerText.match(/^(MIN|MINIMUM|TYP|TYPICAL|MAX|MAXIMUM)\s+UNITS?$/);
    if (fused) {
      const token = fused[1];
      marks.push({ kind: HEADER_MIN.includes(token) ? "min" : HEADER_TYP.includes(token) ? "typ" : "max", x: cell.x });
    } else if (isOneOf(cell.text, HEADER_MIN)) marks.push({ kind: "min", x: cell.x });
    else if (isOneOf(cell.text, HEADER_TYP)) marks.push({ kind: "typ", x: cell.x });
    else if (isOneOf(cell.text, HEADER_MAX)) marks.push({ kind: "max", x: cell.x });
    else if (isOneOf(cell.text, HEADER_UNIT)) unitX = cell.x;
    else if (isOneOf(cell.text, HEADER_NOM)) sawNominal = true;
  }
  // A TYPICAL COLUMN IS WHAT MAKES A TABLE A CHARACTERISATION.
  //
  // Absolute Maximum Ratings and Recommended Operating Conditions print MIN/MAX
  // or MIN/NOM/MAX: there is no such thing as a "typical maximum rating". So
  // requiring a typical identifies the right table STRUCTURALLY, without relying
  // on a heading, which matters because 3 of 10 corpus parts print their
  // specification table under no heading this can find, and because a heading
  // vocabulary can always be missing the next vendor's wording.
  //
  // This is the stronger of the two guards. The heading list stays as the
  // cheaper first answer, not as the only one.
  const hasTyp = marks.some((m) => m.kind === "typ");
  const hasMin = marks.some((m) => m.kind === "min");
  const hasMax = marks.some((m) => m.kind === "max");
  // A MILITARY TABLE PRINTS NO TYPICAL, and it is still a characterisation.
  //
  // The typical is required because it is what tells an Electrical
  // Characteristics table apart from an Absolute Maximum Ratings one
  // STRUCTURALLY, without trusting a heading: there is no such thing as a
  // typical maximum rating. That reasoning is sound and stays.
  //
  // It has one blind spot, and it is this product's own market. A QML 883 table
  // states guaranteed limits only: LM139AQML-SP prints `Symbol | Parameters |
  // Conditions | Notes | Min | Max | Unit` and read ZERO rows, for a rad-hard
  // comparator whose whole table is on the page.
  //
  // So a table with min AND max and no typical is admitted only when the SECTION
  // HEADING has positively identified it, which is the evidence the typical was
  // standing in for. An absolute-maximum heading is refused before this by
  // `headingRejects`, so the protection is unchanged: nothing is admitted on
  // structure alone that was not admitted before.
  if (!hasTyp && !(underSpecHeading && hasMin && hasMax)) return null;
  if (!hasMin && !hasMax) return null;
  if (sawNominal && !hasTyp) return null;

  // A new group starts whenever a column kind repeats. LT1013's header is
  // MIN TYP MAX MIN TYP MAX MIN TYP MAX and must become three groups, not one
  // with the last of each winning.
  const groups: ColumnGroup[] = [];
  let current: ColumnGroup = { min: null, typ: null, max: null, label: null };
  for (const mark of marks.sort((a, b) => a.x - b.x)) {
    if (current[mark.kind] !== null) {
      groups.push(current);
      current = { min: null, typ: null, max: null, label: null };
    }
    current[mark.kind] = mark.x;
  }
  groups.push(current);
  return { groups, unitX };
}

/**
 * A header may be drawn on two INTERLEAVED baselines rather than two semantic
 * lines. Renesas places MIN/MAX ten points above TYP/UNIT, so `toRows` quite
 * correctly produces two rows even though all four labels describe one set of
 * columns. Looking only at either baseline loses the typical and the units;
 * every magnitude then becomes unusable.
 *
 * Merge only recognised header tokens from the immediate neighbouring
 * baselines. Data, captions and group labels never enter the synthetic row, so
 * this cannot turn an ordinary value line into a header.
 */
function headerAt(rows: Row[], index: number, underSpecHeading = false): Header | null {
  const origin = rows[index];
  const cells = rows
    .filter((candidate, candidateIndex) =>
      Math.abs(candidateIndex - index) <= 1 && Math.abs(candidate.y - origin.y) <= 12
    )
    .flatMap((candidate) => candidate.cells)
    .filter((cell) =>
      isOneOf(cell.text, HEADER_MIN) ||
      isOneOf(cell.text, HEADER_TYP) ||
      isOneOf(cell.text, HEADER_MAX) ||
      isOneOf(cell.text, HEADER_UNIT) ||
      isOneOf(cell.text, HEADER_NOM) ||
      /^(MIN|MINIMUM|TYP|TYPICAL|MAX|MAXIMUM)\s+UNITS?$/.test(normaliseHeader(cell.text))
    );
  return readHeader({ y: origin.y, cells }, underSpecHeading);
}

/**
 * Binds each column group to the label printed above it.
 *
 * LT1013 prints `LT1013AM`, `LT1014AM` and `LT1013M/LT1014M` on the row above
 * the header, each positioned over its own group. A label belongs to the group
 * whose columns it sits over.
 */
/**
 * Finds the UNIT column when it is printed on a DIFFERENT LINE from MIN/TYP/MAX.
 *
 * A table with two column groups is usually typeset over two header lines: the
 * group names and the words PARAMETER, TEST CONDITIONS and UNIT on the first,
 * then MIN TYP MAX MIN TYP MAX on the second. `readHeader` reads one line, so
 * it accepts the second and comes back with no unit column at all.
 *
 * Measured on REF5025: EVERY value on its specification page lost its unit, so
 * every magnitude was unknown and nothing on the page was usable. The units are
 * printed plainly at x=524..535 and the word UNIT is directly above them.
 *
 * This looks UP for the printed word, exactly as `labelGroups` looks up for the
 * group names, and takes the x it is drawn at. It finds nothing on a table whose
 * header is one line, which is the common case and is unaffected.
 */
function adoptUnitColumn(header: Header, rows: Row[], headerIndex: number): void {
  if (header.unitX !== null) return;
  for (let i = headerIndex - 1; i >= Math.max(0, headerIndex - LABEL_LOOKUP_ROWS); i--) {
    const hit = rows[i].cells.find((c) => isOneOf(c.text, HEADER_UNIT));
    if (hit) {
      header.unitX = hit.x;
      return;
    }
  }
  // Some PDF generators fuse `MAX UNIT`, so there is no standalone UNIT word
  // to locate. Units themselves form a strong repeated column to the right of
  // the value headings. Infer only from at least two dimensionally parseable
  // cells in the next part of this table, and take the densest x cluster.
  const rightmostValue = Math.max(...header.groups.flatMap((group) => [group.min, group.typ, group.max]).filter((x): x is number => x !== null));
  const clusters = new Map<number, number[]>();
  for (let i = headerIndex + 1; i < Math.min(rows.length, headerIndex + 41); i++) {
    for (const cell of rows[i].cells) {
      // The header x is the LEFT EDGE of its word, not the centre of the
      // numeric column. In tightly set tables the UNIT column can therefore be
      // less than one normal column tolerance to its right (LP2985: MAX starts
      // at 510, units start at 536). Requiring a whole tolerance silently loses
      // that column. Six points still puts the candidate beyond the heading,
      // while the dimensional parse and repeated-x requirement below keep
      // adjacent values from being mistaken for units.
      if (cell.x <= rightmostValue + 6) continue;
      if (!parseUnit(cell.text.trim())) continue;
      const bucket = Math.round(cell.x / 4) * 4;
      clusters.set(bucket, [...(clusters.get(bucket) ?? []), cell.x]);
    }
  }
  const best = [...clusters.values()].sort((a, b) => b.length - a.length)[0];
  if (best?.length >= 2) header.unitX = best.reduce((sum, x) => sum + x, 0) / best.length;
}

function labelGroups(header: Header, rows: Row[], headerIndex: number): void {
  if (header.groups.length < 2) return;
  for (let i = headerIndex - 1; i >= Math.max(0, headerIndex - LABEL_LOOKUP_ROWS); i--) {
    const candidates = rows[i].cells.filter((c) => /[A-Za-z]/.test(c.text) && c.text.trim().length > 1);
    if (candidates.length < header.groups.length) continue;
    for (const group of header.groups) {
      const left = group.min ?? group.typ ?? group.max;
      const right = group.max ?? group.typ ?? group.min;
      if (left === null || right === null) continue;
      const hit = candidates.find((c) => c.x >= left - COLUMN_TOLERANCE * 2 && c.x <= right + COLUMN_TOLERANCE);
      if (hit && !group.label) group.label = hit.text.trim();
    }
    if (header.groups.every((g) => g.label)) return;
  }
}

/**
 * How far a value sub-row may sit from the label it belongs to.
 *
 * Measured on OPA333, whose condition sub-rows are 6pt from their centred
 * label and whose NEXT parameter is 12pt away. Nearest-label-wins settles the
 * boundary, so this only has to be tight enough not to reach past one row.
 */
const LABEL_WINDOW = 34;

/**
 * How much nearer the best label must be than the next best.
 *
 * LM358 centres `VOS` across a 46pt row of variant sub-rows, and its `dVOS/dT`
 * label sits 6pt below the last of them. Some sub-rows are genuinely ambiguous
 * between the two by geometry alone.
 *
 * This reader is the SECOND source, so a row it declines is flagged for the
 * user, and a row it attributes to the wrong parameter is a silent wrong value.
 * Declining the ambiguous case is therefore strictly better, and it is a
 * refusal on PROOF: two labels are equally close, so nothing here can say which.
 */
const LABEL_MARGIN = 4;

/**
 * The wordy cell that NAMES a parameter, if this row has one.
 *
 * A test condition is not a name. `RLOAD = 10 kOhm` and `Tmin < Top < Tmax` are
 * wordy, and treating them as labels made them win the nearest-label contest
 * against the real one: OPA2189's open-loop gain sits at y=320 with its values
 * on sub-rows at 301 and 335, and the condition rows between them were closer.
 * The part was refused for a gain printed plainly on page 10.
 *
 * A relational operator is the tell, and it needs no vocabulary to recognise.
 */
/**
 * A RELATION, however the vendor typeset it.
 *
 * A test condition is recognised by the relational operator in it, and the
 * operator is very often NOT an ASCII one: Maxim writes `250mV <= VOUT <=` with
 * U+2264, and matching only `[=<>]` reads that as the row's own DESCRIPTION.
 *
 * The cost, measured on MAX44242: the row carrying its open-loop gain - min
 * 134, typ 145 dB - was filed under the parameter name `250mV <= VOUT <=`, the
 * gain was taken from an offset-current sub-row instead, and the model shipped
 * with an open-loop gain of 25 dB. Every check passed except the offset, which
 * came back 5% low because a 25 dB follower attenuates its own offset. That was
 * the only thing in the product that noticed.
 *
 * Same shape as `foldUnicode`: the glyph a vendor chose is not the glyph a
 * naive matcher expects, and this is a reader of other people's typesetting.
 */
const RELATION = /[=<>\u2260\u2264\u2265\u2248\u2243\u2264\u226A\u226B~]/;

function describedBy(row: Row): string | undefined {
  return row.cells
    .map((c) => c.text)
    .filter((t) => /[A-Za-z]{4,}/.test(t) && !RELATION.test(t))
    .sort((a, b) => b.length - a.length)[0];
}

/**
 * True for a band heading like `OFFSET VOLTAGE` or `POWER SUPPLY`, which groups
 * the rows beneath it and names no parameter of its own.
 *
 * It is a lone cell at the left margin with no unit and no values. Without this
 * it would be the nearest "description" for the first row of its own band and
 * would steal it from the real label.
 */
function isBandHeading(row: Row): boolean {
  if (row.cells.length !== 1) return false;
  const text = row.cells[0].text.trim();
  return text === text.toUpperCase() && /^[A-Z][A-Z\s/&-]{2,}$/.test(text);
}

/**
 * A cell that might be an inline GRADE label rather than a test condition.
 *
 * The shape of a device designator: it carries both a letter and a digit, which
 * is what separates `OPA2277P, U` from `dc`, and it states no relation, which is
 * what separates it from `RL = 2 kΩ`. That alone is not enough - `To 0.01%`
 * passes it - so the caller additionally requires the text to RECUR across more
 * than one parameter. A grade discriminates the whole table; a condition
 * belongs to one row.
 */
function gradeCandidate(row: Row, description: string, header: Header): string | null {
  for (const cell of row.cells) {
    const text = cell.text.trim();
    if (text === description.trim()) continue;
    if (parseNumber(text) !== null) continue;
    if (/[=<>]/.test(text)) continue;
    if (header.unitX !== null && Math.abs(cell.x - header.unitX) < COLUMN_TOLERANCE + 6) continue;
    if (text.length < 3 || text.length > 30) continue;
    if (!/[A-Z]/.test(text) || !/[0-9]/.test(text)) continue;
    return text;
  }
  return null;
}

/** True when a row carries a number under one of the header's columns. */
function hasValueUnderColumn(row: Row, header: Header): boolean {
  return row.cells.some((c) => {
    if (parseNumber(c.text) === null) return false;
    return header.groups.some((g) =>
      [g.min, g.typ, g.max].some((x) => x !== null && Math.abs(x - c.x) < COLUMN_TOLERANCE)
    );
  });
}

/**
 * The nearest row that NAMES a parameter, for a value row that does not.
 *
 * Nearest wins, so a sub-row between two parameters attaches to the closer one.
 *
 * ## A row that carries its own values is NOT a donor
 *
 * That is a parameter in its own right rather than a centred label.
 *
 * MEASURED NEGATIVE, 2026-09-04. This exclusion is not always right: Maxim
 * writes a parameter's first sub-row ON the label line and the rest beneath it,
 *
 *     Input Offset Current  IOS  -40C <= TA <= +85C   10   pA   <- label AND value
 *                                -40C <= TA <= +125C  25         <- belongs to it
 *
 * so the `25` orphan finds no donor nearer than the NEXT parameter's label
 * twenty-two points away, and MAX44242's record carries an open-loop gain of
 * 25 dB taken from an offset-current row.
 *
 * Letting such a row compete on distance instead of excluding it was tried and
 * measured across the 19-part tuned corpus: it moves row attribution on twelve
 * of them in both directions. AD8628 loses its supply rejection entirely,
 * OPA2277 drops from three offset-voltage rows to one, TLV9061 from four
 * open-loop-gain rows to two, LMP7704-SP loses its input voltage range. Some of
 * those re-attributions may be right and there is no oracle here that can say
 * which, so it stays as it is.
 *
 * The phantom row it leaves is on the record and does not ship: `readBlocks`
 * prefers a candidate carrying a typical, and the correct gain row has one.
 */
function nearestDescriptionRow(rows: Row[], index: number, header: Header): Row | null {
  const candidates: Array<{ row: Row; distance: number }> = [];
  for (let j = index - 6; j <= index + 6; j++) {
    if (j < 0 || j >= rows.length || j === index) continue;
    const candidate = rows[j];
    if (!describedBy(candidate)) continue;
    if (isBandHeading(candidate)) continue;
    if (hasValueUnderColumn(candidate, header)) continue;
    const distance = Math.abs(candidate.y - rows[index].y);
    if (distance <= LABEL_WINDOW) candidates.push({ row: candidate, distance });
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => a.distance - b.distance);
  // Two labels equally close means nothing here can attribute this row. Decline.
  if (candidates.length > 1 && candidates[1].distance - candidates[0].distance < LABEL_MARGIN) return null;
  return candidates[0].row;
}

/**
 * A repeated inline qualifier such as `Legacy chip` or `A grade` is not a
 * parameter name. It repeats at the same x on adjacent value rows, while the
 * actual vertically-centred parameter label appears once nearby.
 */
function repeatedQualifier(rows: Row[], index: number, description: string): boolean {
  const source = rows[index].cells.find((cell) => cell.text.trim() === description.trim());
  if (!source || description.length > 30) return false;
  let repeats = 0;
  for (let i = Math.max(0, index - 8); i <= Math.min(rows.length - 1, index + 8); i++) {
    if (i === index) continue;
    if (rows[i].cells.some((cell) => cell.text.trim() === description.trim() && Math.abs(cell.x - source.x) < 12)) repeats++;
  }
  return repeats >= 1;
}

/** A number as datasheets write it, including a leading sign and a plus/minus. */
const NUMERIC = /^[±+-]?\d+(\.\d+)?$/;

function parseNumber(text: string): number | null {
  if (!NUMERIC.test(text.trim())) return null;
  const value = Number.parseFloat(text.replace(/^[±+]/, ""));
  return Number.isFinite(value) ? value : null;
}

/**
 * Identifies a row's parameter from its description, or failing that from its
 * SYMBOL.
 *
 * The symbol is an identifier in its own right and using it only to reject
 * throws away the more reliable of the two signals. OPA2189 prints
 * `UGB  Unity-gain Bandwith`: TI misspelled "bandwidth", so no description
 * pattern can match it, and the part was refused for want of a gain-bandwidth
 * that is printed plainly on page 10. `UGB` is unambiguous.
 *
 * Descriptions are tried first because they are what most documents agree on,
 * and the symbol is the fallback rather than the other way round: symbols
 * collide across vendors far more often than descriptions do.
 */
function classify(description: string, cells: Span[]): ParameterSpec | null {
  const norm = normaliseHeader(description);
  const byDescription = PARAMETERS.find((p) => p.describes.test(norm));
  if (byDescription) return byDescription;

  const printed = cells
    .map((c) => c.text.trim())
    .filter((t) => /^[A-Za-z][A-Za-z0-9+\-_()]{0,6}$/.test(t))
    .map(normaliseSymbol);
  // Only an EXACT symbol match identifies. A near miss is evidence of a
  // different parameter, never of this one.
  return PARAMETERS.find((p) => p.symbols.some((s) => printed.includes(normaliseSymbol(s)))) ?? null;
}

/**
 * Decides whether a printed symbol CONTRADICTS the parameter we matched.
 *
 * Rejects on proof, never on absence. `IQSD` against `IQ` is a near miss of an
 * accepted symbol and therefore a different row, which is how a shutdown
 * current was nearly read as a supply current, a factor of a thousand. But
 * OPA2189 prints NO symbol on its quiescent current row, and refusing that
 * would be this reader inventing a requirement the document does not have.
 */
function symbolContradicts(spec: ParameterSpec, cells: Span[]): boolean {
  const accepted = spec.symbols.map(normaliseSymbol);
  const printed = cells
    .map((c) => c.text.trim())
    .filter((t) => /^[A-Za-z][A-Za-z0-9+\-_()]{0,6}$/.test(t))
    .map(normaliseSymbol);
  if (printed.length === 0) return false; // no symbol printed: trust the description
  if (printed.some((p) => accepted.includes(p))) return false; // it matches
  // A symbol IS printed. Only treat it as a contradiction when it is a near
  // miss of one we accept, so unrelated tokens on the row cannot veto a read.
  //
  // A one-letter accepted symbol cannot prove anything: with `A` on the list,
  // ST's `AVD` for large-signal gain "near missed" it and TSV911's gain row was
  // refused. A prefix is only evidence when it is long enough to be specific.
  //
  // ## ONE DIRECTION ONLY, and which one is the whole point
  //
  // `IQSD` against an accepted `IQ` is a contradiction: the page's symbol
  // carries a qualifier ours does not, and that qualifier is what makes it a
  // different row. A shutdown current read as a supply current is a factor of a
  // thousand.
  //
  // `Vd` against an accepted `VDO` is the opposite case and is NOT evidence of
  // anything. The page's symbol is SHORTER than ours, so it is our list being
  // more verbose than the document, not the document naming something narrower.
  // A symbol carrying less information cannot single out a different parameter.
  //
  // Both directions were vetoed until 2026-09-04, and it cost the whole
  // regulator class: `Vd` is how ST writes a dropout voltage on L7805, LD1117,
  // RHFL4913 and RHFL4913A, and `Id` is how it writes a quiescent current. Every
  // one of those rows was read correctly, matched its description, carried the
  // right unit, and was then thrown away because our own vocabulary spells the
  // symbol out in full.
  return printed.some((p) => accepted.some((a) => a.length >= 2 && p.length >= 2 && p.startsWith(a)));
}

/**
 * A heading with its section number removed.
 *
 * Datasheets number their sections: `6.1 Absolute Maximum Ratings`,
 * `5.7 Electrical Characteristics`. Matching the raw string means every numbered
 * heading fails, so absolute-maximum tables were never actually rejected. The
 * test that was supposed to catch this passed for an unrelated reason (the unit
 * `V` was being mistaken for a symbol and vetoing the row), which is the
 * `LEARNINGS.md` "a check that never ran" shape exactly.
 */
function withoutSectionNumber(heading: string): string {
  return normaliseHeader(heading.replace(/^\s*\d+(\.\d+)*\.?\s+/, ""));
}

/** True when a heading proves this is not a specification table. */
function headingRejects(heading: string | null): boolean {
  if (!heading) return false;
  const norm = withoutSectionNumber(heading);
  return SECTION_NOT_SPEC.some((s) => norm.startsWith(s));
}

/**
 * A heading is a SHORT line that opens a section, not a sentence that happens
 * to begin with the section's name.
 *
 * Without the length cap, TLV9061's body prose starting "Electrical
 * Characteristics ... similar to the OPAx316 and TLVx316" was read as a heading
 * and its tail stored as the block's scope. That is the shape-only-rule trap
 * again: a rule that matches text and not the ROLE of the text.
 */
const MAX_HEADING_CHARS = 90;

function headingAccepts(heading: string): boolean {
  if (heading.length > MAX_HEADING_CHARS) return false;
  const norm = withoutSectionNumber(heading);
  // A PREFIX, OR ONE SHORT TOKEN AHEAD OF IT.
  //
  // Military QML datasheets title the section with the die and the standard
  // first: LM139AQML-SP prints `LM133 883 Electrical Characteristics DC
  // Parameters`. A prefix match refuses that, and this product is positioned at
  // rad-hard parts, so the segment it is aimed at was the one it could not read.
  //
  // Bounded to a short lead-in rather than a bare `includes`, because "see the
  // Electrical Characteristics table on page 6" is a sentence and not a heading.
  // The length cap above already refuses long lines; this refuses a long PREFIX.
  return SECTION_SPEC.some((section) => {
    const at = norm.indexOf(section);
    return at === 0 || (at > 0 && at <= MAX_HEADING_LEAD_IN);
  });
}

/**
 * How much may precede the section name on its own heading line.
 *
 * `LM133 883 ` is ten characters. Enough for a die name and a standard number,
 * and not enough for a sentence.
 */
const MAX_HEADING_LEAD_IN = 16;

/**
 * The scope a heading states, which is the rest of it after the section name.
 *
 * LMP7704-SP separates its supply blocks as `Electrical Characteristics VS = 5 V`
 * and `VS = 10 V`. LM358 writes `Electrical Characteristics: LM358, LM358A`.
 * Both answer a question the caller would otherwise have to ask the user, and
 * both are thrown away by treating the heading as a section marker.
 */
function scopeOf(heading: string): string | null {
  const norm = withoutSectionNumber(heading);
  // THE SAME LEAD-IN WINDOW `headingAccepts` USES, and it has to be the same one.
  //
  // These two functions read the same line and disagreed: `headingAccepts`
  // allows a short lead-in before the section name, `scopeOf` demanded the name
  // at position zero. So `Table 3. Electrical characteristics of L7805A` was
  // ACCEPTED as a heading and then yielded NO SCOPE, and the seven per-voltage
  // tables in a 78xx family datasheet - 5 V, 6 V, 8 V, 9 V, 12 V, 15 V, 24 V,
  // each with its own caption - all merged into one block. The product could
  // not then offer the user the choice between them, and whichever row came
  // first silently became the part.
  //
  // This is `LEARNINGS.md`'s "fixed in one place, not the other" exactly, and
  // the fix is not a second rule but the same rule, asked once.
  const matched = SECTION_SPEC.find((section) => {
    const at = norm.indexOf(section);
    return at === 0 || (at > 0 && at <= MAX_HEADING_LEAD_IN);
  });
  if (!matched) return null;
  const tail = heading.slice(heading.toUpperCase().indexOf(matched) + matched.length).trim();
  const cleaned = tail
    .replace(/^[:\-,\s]+/, "")
    // `of L7805A` is a scope; the preposition is not part of it.
    .replace(/^of\s+/i, "")
    .replace(/\(continued\)/i, "")
    .trim();
  // A scope names a supply, a variant or a temperature. Punctuation alone is
  // not a scope, and neither is a clause: both mean this was not a heading.
  if (!/[A-Za-z0-9]/.test(cleaned)) return null;
  return cleaned.length > 0 ? cleaned : null;
}

/**
 * AC/DC SPECIFICATIONS is a subsection of the supply-scoped electrical table,
 * not a new operating condition. Renesas repeats it between the DC rows and
 * gain-bandwidth rows; clearing the current scope there stranded the two
 * parameters in different blocks and made an otherwise complete op-amp look as
 * if it stated no bandwidth.
 */
function scopeAfter(heading: string, current: string | null): string | null {
  const stated = scopeOf(heading);
  if (stated !== null) return stated;
  const normal = withoutSectionNumber(heading);
  if (/^(AC|DC)\s+(ELECTRICAL\s+)?SPECIFICATIONS?$/.test(normal)) return current;
  return null;
}

/**
 * Reads every specification row on one page.
 *
 * `carried` lets a table that continues onto a new page keep the header it was
 * introduced with. TI prints `Electrical Characteristics (continued)` with a
 * fresh header, but not every vendor does, and a page of values whose header is
 * on the previous page must not be silently dropped.
 */
export function readPage(rows: Row[], page: number, carried: { header: Header | null; scope: string | null }): SpecRow[] {
  const out: SpecRow[] = [];
  let header = carried.header;
  let scope = carried.scope;
  let rejected = false;
  /**
   * A heading on THIS page has named the section as electrical characteristics.
   *
   * Carried so a header row a line or two below it can be admitted without a
   * typical column. Reset by a rejecting heading, so an absolute-maximum table
   * further down the page cannot borrow the permission.
   */
  let acceptedHeading = false;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const line = row.cells.map((c) => c.text).join(" ").trim();

    if (headingRejects(line)) {
      rejected = true;
      acceptedHeading = false;
      header = null;
      continue;
    }
    if (headingAccepts(line)) {
      rejected = false;
      acceptedHeading = true;
      scope = scopeAfter(line, scope);
      continue;
    }

    const maybeHeader = headerAt(rows, i, acceptedHeading);
    if (maybeHeader) {
      if (rejected) continue;
      adoptUnitColumn(maybeHeader, rows, i);
      labelGroups(maybeHeader, rows, i);
      header = maybeHeader;
      continue;
    }
    if (rejected || !header) continue;

    // A value row: at least one number under a column. Its DESCRIPTION may not
    // be on the same baseline.
    //
    // TI centres a parameter's name and unit vertically across its condition
    // sub-rows, so OPA333's quiescent current is drawn as three baselines:
    //
    //     y=535   [IO = 0 A]                       17   25
    //     y=541   IQ | Quiescent current per amplifier |  uA
    //     y=547   [TA = -40C to 125C]                    28
    //
    // Reading only same-baseline rows loses every value of every parameter
    // written this way, silently. Each sub-row keeps its OWN conditions and
    // values and becomes its own entry, because "17 uA at IO = 0 A" and
    // "28 uA over temperature" are different statements about the part.
    const own = describedBy(row);
    // If the row's own prose is an unnamed repeated qualifier, continue to the
    // real parameter label instead of allowing `Legacy chip` to name dozens of
    // unrelated values. A legitimate named parameter always keeps priority.
    const ownClass = own ? classify(own, row.cells) : null;
    const qualifier = own !== undefined && ownClass === null && repeatedQualifier(rows, i, own);
    const donor = !own || qualifier ? nearestDescriptionRow(rows, i, header) : null;
    const description = own ?? (donor ? describedBy(donor) : undefined);
    const effectiveDescription = qualifier && donor ? describedBy(donor) : description;
    if (!effectiveDescription) continue;

    // The symbol sits on whichever baseline carries the name, so the
    // contradiction test must see the donor's cells too, or `IQSD` on a centred
    // label would never be noticed.
    // The unit sits under the UNIT column and has a symbol's shape, so it must
    // be excluded before anything reasons about symbols. Leaving it in, the `V`
    // of a supply-voltage row "near missed" `VS` and vetoed the row by accident.
    const symbolCells = (donor ? [...row.cells, ...donor.cells] : row.cells).filter(
      (c) => header!.unitX === null || Math.abs(c.x - header!.unitX!) >= COLUMN_TOLERANCE + 6
    );
    const matched = classify(effectiveDescription, symbolCells);
    // A contradicting symbol means this is not the parameter we matched. It does
    // NOT mean the row is not a row: TLV9061's shutdown current is a real
    // specification a user may want. Keep it, unnamed, rather than discard it.
    const spec = matched && symbolContradicts(matched, symbolCells) ? null : matched;

    // The unit and symbol are printed once for the whole parameter, on whichever
    // baseline carries the name, so look on this row and then on the donor.
    const unitFrom = (r: Row): string | null =>
      header!.unitX === null
        ? null
        : r.cells.find((c) => Math.abs(c.x - header!.unitX!) < COLUMN_TOLERANCE + 6 && parseNumber(c.text) === null)?.text.trim() ?? null;
    // The unit sits under the UNIT column and is short and alphabetic, so it
    // matches a symbol's shape exactly. Excluding that column is what stops
    // `mA` being reported as the parameter's symbol.
    const symbolFrom = (r: Row): string | null =>
      r.cells
        .filter((c) => header!.unitX === null || Math.abs(c.x - header!.unitX!) >= COLUMN_TOLERANCE + 6)
        .map((c) => c.text.trim())
        .find((t) => /^[A-Za-z][A-Za-z0-9+\-_()]{0,6}$/.test(t) && t !== effectiveDescription) ?? null;

    // The unit can be on a THIRD baseline again: TSV911 draws the conditions
    // above, the label and value in the middle, and the unit below with the rest
    // of the conditions. Losing it costs the whole parameter, because a value
    // whose magnitude cannot be established is not one the model may use.
    const unitNearby = (): string | null => {
      for (let j = i - 3; j <= i + 3; j++) {
        if (j < 0 || j >= rows.length) continue;
        if (Math.abs(rows[j].y - row.y) > LABEL_WINDOW) continue;
        const found = unitFrom(rows[j]);
        if (found) return found;
      }
      return null;
    };
    const unit = unitFrom(row) ?? (donor ? unitFrom(donor) : null) ?? unitNearby();
    const symbol = symbolFrom(row) ?? (donor ? symbolFrom(donor) : null);
    // Conditions come from THIS baseline only. Each sub-row states its own.
    const conditions = row.cells.filter((c) => /[=<>]/.test(c.text)).map((c) => c.text.trim()).join(", ") || null;

    // Every column of every group, so each number is assigned to its GLOBALLY
    // nearest column. Assigning within one group at a time lets adjacent groups
    // steal from each other: on LT1013 the second group's MAX at x=441 is 25pt
    // from the third group's MIN at x=467, inside the tolerance, so the third
    // group claimed a value belonging to the second.
    const columns: Array<{ group: number; kind: "min" | "typ" | "max"; x: number }> = [];
    header.groups.forEach((g, index) => {
      if (g.min !== null) columns.push({ group: index, kind: "min", x: g.min });
      if (g.typ !== null) columns.push({ group: index, kind: "typ", x: g.typ });
      if (g.max !== null) columns.push({ group: index, kind: "max", x: g.max });
    });

    const perGroup: SpecValues[] = header.groups.map(() => ({ min: null, typ: null, max: null }));
    for (const cell of row.cells) {
      const value = parseNumber(cell.text);
      if (value === null) continue;
      const nearest = columns
        .slice()
        .sort((a, b) => Math.abs(a.x - cell.x) - Math.abs(b.x - cell.x))[0];
      if (nearest && Math.abs(nearest.x - cell.x) < COLUMN_TOLERANCE) perGroup[nearest.group][nearest.kind] = value;
    }

    // A unit that contradicts the parameter's dimension proves this is not that
    // parameter. Measured on the tuned corpus: 28 rows carried a slew rate in
    // pF, a short-circuit current in mV, a quiescent current in ohms, each a
    // unit picked up from a neighbouring column. The row is KEPT, unnamed, for
    // the same reason a contradicting symbol keeps it: our failure to name it is
    // not evidence that it is not a specification.
    //
    // And where the unit contradicts the FIRST parameter this description
    // matches, a second one may fit it: `Line regulation` is a slope in ppm/V
    // on a voltage reference and a change over a stated range in mV on a
    // regulator, and only the unit can tell them apart. See `pickByUnit`.
    const named = spec ? pickByUnit(spec, effectiveDescription, unit, parseUnit(unit)?.base ?? null) : null;

    for (let g = 0; g < header.groups.length; g++) {
      const group = header.groups[g];
      const values = perGroup[g];
      if (values.min === null && values.typ === null && values.max === null) continue;
      out.push({
        parameter: effectiveDescription.trim(),
        key: named?.key ?? null,
        symbol,
        conditions,
        unit,
        values,
        group: group.label,
        grade: qualifier ? own?.trim() ?? null : gradeCandidate(row, effectiveDescription, header),
        scope,
        page
      });
    }
  }
  // A GRADE DISCRIMINATES THE TABLE; A CONDITION BELONGS TO ONE ROW.
  //
  // Applied here rather than per row because the evidence is only visible
  // across the page: `OPA277P, U` labels a value under offset voltage, offset
  // drift, supply rejection, bias current and offset current, while `To 0.01%`
  // labels one settling time and nothing else. Recurrence across more than one
  // parameter is the proof; a single appearance stays what it was, a condition
  // we did not capture, rather than being promoted on a guess.
  const seenWith = new Map<string, Set<string>>();
  for (const row of out) {
    if (!row.grade) continue;
    const parameters = seenWith.get(row.grade) ?? new Set<string>();
    parameters.add(row.parameter);
    seenWith.set(row.grade, parameters);
  }
  for (const row of out) {
    if (row.grade && (seenWith.get(row.grade)?.size ?? 0) < 2) row.grade = null;
  }

  return out;
}

/** Carried state after a page, so a continuation keeps its header. */
export function carryFrom(rows: Row[], previous: { header: Header | null; scope: string | null }): { header: Header | null; scope: string | null } {
  let header = previous.header;
  let scope = previous.scope;
  let rejected = false;
  let acceptedHeading = false;
  for (let i = 0; i < rows.length; i++) {
    const line = rows[i].cells.map((c) => c.text).join(" ").trim();
    if (headingRejects(line)) {
      rejected = true;
      acceptedHeading = false;
      header = null;
      continue;
    }
    if (headingAccepts(line)) {
      rejected = false;
      acceptedHeading = true;
      scope = scopeAfter(line, scope);
      continue;
    }
    const maybeHeader = headerAt(rows, i, acceptedHeading);
    if (maybeHeader && !rejected) {
      adoptUnitColumn(maybeHeader, rows, i);
      labelGroups(maybeHeader, rows, i);
      header = maybeHeader;
    }
  }
  return { header, scope };
}

/**
 * Scales a value by the prefix on its unit, e.g. `350` with `kHz` to `350000`.
 *
 * Returns null when the unit carries a prefix this does not know, because a
 * value whose magnitude we cannot establish is not a value we can use. It is
 * still KEPT on the row as printed; only the derived SI number is withheld.
 */
export function toSI(value: number, unit: string | null): number | null {
  if (unit === null) return null;
  const trimmed = unit.trim();
  for (const [prefix, scale] of Object.entries(READ_PREFIXES)) {
    if (prefix === "") continue;
    if (trimmed.startsWith(prefix) && trimmed.length > prefix.length) return value * scale;
  }
  return value;
}
