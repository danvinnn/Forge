/**
 * THE SECOND READING OF THE SPECIFICATION TABLE, done by a model looking at the
 * rendered page.
 *
 * `specs.ts` reads the same table from the text layer's geometry. These two
 * consume different things, character codes and pixels, so they cannot fail
 * together. That is what RULES.md 7 means by different MEANS, and it is not
 * academic here: measured on AD8628, the PDF draws a micro sign and STORES the
 * letter `m`, so the deterministic reader turns 1 V/us into 1 V/ms. A model
 * looking at the drawn glyph gets it right, and the disagreement surfaces.
 *
 * ## Why this asks for the whole table
 *
 * THE PROMPT IS THE CACHE KEY. Any wording change strands every cached answer
 * and re-reads the corpus for money. So it asks for every row once, rather than
 * a list of the parameters today's macromodel happens to consume.
 *
 * That is also the cheaper option. A specification table is one table; reading
 * five rows of it and reading all of them cost the same. Asking narrowly is how
 * `forge-we-had-it-and-threw-it-away` happens: the expensive part is having the
 * page open, and a row not asked for has to be paid for again.
 *
 * The field list below was enumerated from 260 rows across ten amplifier
 * datasheets (`SPICE.md` section 31), not from memory. It is deliberately wider
 * than the model builder uses.
 */

/**
 * What the model is asked to return, as a schema description rather than as
 * prose, so the shape is unambiguous.
 */
export const SPEC_TABLE_SCHEMA = `{
  "tables": [
    {
      "heading": "the section heading exactly as printed, e.g. 6.6 Electrical Characteristics VS = 5 V",
      "appliesTo": "what that heading says this block covers: a supply, a grade, a temperature, or null",
      "columnGroups": ["the label printed above each MIN/TYP/MAX group, in left-to-right order. Use [] when the table has ONE group with no label above it."],
      "rows": [
        {
          "page": "the 1-indexed PDF page where this row is printed",
          "parameter": "the description exactly as printed",
          "symbol": "the symbol exactly as printed, or null if none is printed",
          "means": "which standard quantity this row states, from the list below, or null",
          "conditions": "the test conditions for THIS row exactly as printed, or null",
          "unit": "the unit exactly as printed, INCLUDING the micro sign if that is the character drawn",
          "values": [
            { "group": "the column group's LABEL, or null when the table has one unlabelled group", "grade": "the device grade or variant printed BESIDE this value, or null", "min": null, "typ": null, "max": null }
          ]
        }
      ]
    }
  ]
}`;

export const SPEC_TABLE_PROMPT = `You are reading the SPECIFICATION TABLES of a semiconductor datasheet.

Return every row of every table that states electrical performance. Return the
WHOLE table, not a selection: rows you think are unimportant are still wanted.

WHICH TABLES
  INCLUDE  Electrical Characteristics, Specifications, DC Characteristics,
           AC Characteristics, and any continuation of one.
  EXCLUDE  Absolute Maximum Ratings, Recommended Operating Conditions, Thermal
           Information, ESD Ratings, Timing Requirements, Package Information.
           An absolute maximum is a destruction limit, not a performance value,
           and confusing the two puts a destruction limit into a simulation.

THE THREE COLUMNS
  Report min, typ and max SEPARATELY and only where the document PRINTS them.
  Report them as NUMBERS. A cell that is a cross-reference ("See note 1"), a
  formula ("(V-) - 0.1") or a range is not a number: report null for it and
  leave the text in the conditions instead. A leading plus-or-minus sign is a
  tolerance, so report its magnitude as the number.
  If a row prints only a typical, report min and max as null. Do NOT copy the
  typical into them. A datasheet that prints no maximum has made no promise
  about a maximum, and repeating the typical there invents a guarantee.
  If a value is blank, it is null. If a row is struck through or marked as not
  applicable, it is null.

TEST CONDITIONS ARE PART OF THE VALUE
  A specification is measured at the pins under stated conditions, so a number
  without them cannot be used or checked. Copy the conditions for each row
  exactly, including load resistance, load capacitance, supply voltage, gain
  setting, temperature and output swing. Where a parameter has several rows with
  different conditions, return each as its own row.

SEVERAL COLUMN GROUPS
  Some tables print MIN/TYP/MAX more than once across the page, one group per
  grade or per part variant, with the labels above the header. Return every
  group, tagged with its label. Never merge them: one grade's minimum beside
  another's maximum describes a device that does not exist.

A GRADE PRINTED BESIDE THE VALUE, NOT ABOVE IT
  Some tables do not put the grade above a column group. They print it in the
  test-conditions column, once per value line, so one parameter has several
  lines that differ only by which device the number is for:

    VOS   Input offset voltage    OPA277P, U        ±10   ±20   µV
                                  OPA2277P, U       ±10   ±25
                                  OPAx277PA, UA     ±20   ±50

  Return each of those as its own entry in the values list, with "grade" set to
  the device text printed beside it. Without it these look like three readings of
  one number that disagree, and the difference here is a factor of two and a
  half. Use null where no device is named beside the value.

SEVERAL BLOCKS
  A datasheet often repeats the whole table for each supply voltage or each
  variant, and says which in the heading. Return each block separately with its
  heading, and do not merge blocks.

RADIATION
  Radiation-hardened parts state values AFTER irradiation, in rows or columns
  labelled post-TID, post-HDR, post-LDR, or with a dose in krad. These are real
  specifications and are wanted like any other: return them with their exposure
  stated in the conditions. Do not merge them with the pre-irradiation values.

WHICH STANDARD QUANTITY EACH ROW STATES
  Vendors word the same quantity differently. One datasheet prints "Open-loop
  voltage gain", another "Large signal voltage gain", another "Differential
  voltage amplification", and they are the same specification. So alongside the
  description EXACTLY as printed, name which of these standard quantities the
  row states, or null:

    openLoopGain        the amplifier's DC open-loop voltage gain
    gbw                 gain-bandwidth product, or unity-gain bandwidth
    slewRate            output slew rate
    offsetVoltage       input offset voltage
    offsetDrift         input offset voltage drift with temperature
    biasCurrent         input bias current
    offsetCurrent       input offset current
    cmrr                common-mode rejection ratio
    psrr                power-supply rejection ratio
    outputSwing         output voltage swing, or headroom to either rail
    shortCircuitCurrent output short-circuit current
    openLoopOutputZ     open-loop output impedance or resistance
    quiescentCurrent    supply or quiescent current
    voltageNoise        input voltage noise
    currentNoise        input current noise
    inputCapacitance    input capacitance
    inputVoltageRange   common-mode input voltage range
    phaseMargin         phase margin
    settlingTime        settling time
    overloadRecovery    overload or overvoltage recovery time
    supplyVoltage       operating or specified supply voltage
    channelSeparation   channel separation or crosstalk
    outputVoltage       nominal regulated or reference output voltage
    lineRegulation      reference output slope with input, printed in ppm/V
    loadRegulation      reference output slope with load, printed in ppm/A or ppm/mA
    outputDrift         reference output temperature drift, printed in ppm/degree
    initialAccuracy     initial output-voltage accuracy, printed as percent or V/V
    dropoutVoltage      regulator input-to-output dropout or headroom voltage
    lineRegulationOverRange
                        regulator output CHANGE over a stated input range, in V or percent
    loadRegulationOverRange
                        regulator output CHANGE over a stated load range, in V or percent
    propagationDelay    comparator propagation delay or response time
    outputLowVoltage    comparator low-level or saturation output voltage
    outputSinkCurrent   comparator stated output sink current
    outputLeakageCurrent
                        comparator high-state or off-state output leakage
    hysteresis          comparator input hysteresis voltage
    gainResistance      the resistance numerator K printed in an instrumentation-
                        amplifier law G = 1 + K/RG or RG = K/(G-1)

  For a printed instrumentation-amplifier gain law, return one row even when it
  is outside a table: copy the equation exactly into "parameter", set "means"
  to "gainResistance", and report only the printed numerator K and its ohmic
  unit as the typical value. Do not infer K from example gains or resistor
  tables, and do not supply a family-typical constant.

  This is a NAMING question, not a reading one. Do not change what you report
  for the description, the unit or the values because of it. Use null whenever
  the row is some other quantity, or whenever you are not sure: a wrong name
  puts one specification's number where another belongs, and null simply leaves
  the row named by its printed description, which is never worse than today.

UNITS
  Copy the unit exactly as it is DRAWN on the page. This matters more than it
  looks: some documents store a micro sign as the letter m, so a page reading
  V/us can be stored as V/ms, a factor of a thousand. You are reading the page,
  so report what is drawn.

WHAT NOT TO DO
  Do not convert units. Do not compute a value from other values. Do not fill a
  blank with a number from a similar part, another column, or another block. Do
  not round. Report what is printed, and null where nothing is.

Return JSON of exactly this shape and nothing else:
${SPEC_TABLE_SCHEMA}`;

/** One value group as the model reports it. */
export interface ModelSpecValues {
  group: string | null;
  /** A device grade printed beside this value rather than above its column. */
  grade?: string | null;
  min: number | null;
  typ: number | null;
  max: number | null;
}

/** One row of a specification table as the model reports it. */
export interface ModelSpecRow {
  /** 1-indexed PDF page where the row is printed. */
  page?: number | null;
  parameter: string;
  symbol: string | null;
  /** Which standard quantity the model says this row states, or null. */
  means?: string | null;
  conditions: string | null;
  unit: string | null;
  values: ModelSpecValues[];
}

export interface ModelSpecTable {
  heading: string | null;
  appliesTo: string | null;
  columnGroups: string[];
  rows: ModelSpecRow[];
}

export interface ModelSpecReading {
  tables: ModelSpecTable[];
}

/**
 * Flattens a model reading into rows comparable with the deterministic one.
 *
 * Kept separate from the prompt so the comparison can be tested against fixed
 * data without a model call.
 */
export function flattenModelReading(reading: ModelSpecReading): Array<{
  parameter: string;
  symbol: string | null;
  means: string | null;
  grade: string | null;
  conditions: string | null;
  unit: string | null;
  group: string | null;
  scope: string | null;
  min: number | null;
  typ: number | null;
  max: number | null;
  page: number | null;
}> {
  const out = [];
  for (const table of reading.tables ?? []) {
    for (const row of table.rows ?? []) {
      for (const value of row.values ?? []) {
        out.push({
          parameter: row.parameter,
          symbol: row.symbol,
          means: row.means ?? null,
          grade: value.grade ?? null,
          conditions: row.conditions,
          unit: row.unit,
          group: value.group,
          scope: table.appliesTo,
          min: value.min,
          typ: value.typ,
          max: value.max,
          page: Number.isInteger(row.page) && (row.page ?? 0) > 0 ? row.page! : null
        });
      }
    }
  }
  return out;
}
