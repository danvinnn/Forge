/**
 * Independent release oracle for the frozen universe.
 *
 * These facts come from the manufacturers' product pages and datasheets, not
 * from Forge output. Only an artifact that actually shipped needs a full pin
 * oracle; non-ships are judged on whether they stopped or exposed a real
 * recovery path.
 */
export interface UniverseOracle {
  source: string;
  /** Frozen manufacturer-authored copy used only when the official host blocks automation. */
  uploadSource?: { url: string; sha256: string };
  packageMustInclude?: string;
  pins?: Record<string, string>;
  spiceClass?: "voltage reference" | "operational amplifier" | "instrumentation amplifier" | "low-dropout regulator" | "comparator";
  noBehavioralSpice?: boolean;
  configurationRequired?: boolean;
  /** End-to-end contract, authored from manufacturer evidence rather than Forge output. */
  e2e?: {
    cad: {
      terminal: "ship" | "honest-refusal";
      /** Minimum non-numbered lands/holes independently visible on the board drawing. */
      minimumAuxiliaryPads?: number;
      answers?: Record<string, { value: unknown; source: string }>;
      /** Exact manufacturer artifact selected by the independently frozen ordering option when an archive contains real variants. */
      vendorPinoutFile?: string;
      /** Fields independently checked against the cited page and safe to confirm unchanged. */
      confirm?: Record<string, { value: unknown; source: string }>;
    };
    spice: {
      terminal: "generated" | "vendor" | "honest-refusal";
      supplied?: Record<string, { value: number | string; source: string }>;
      blockChoice?: number;
      reviewedClass?: "opamp" | "reference" | "comparator" | "ldo" | "instrumentation";
      corrections?: Array<{
        parameter: string;
        unit: string;
        page: number;
        printed: { min: number | null; typ: number | null; max: number | null };
        source: string;
      }>;
    };
  };
}

export const UNIVERSE_ORACLE: Record<string, UniverseOracle> = {
  STM32H573II: {
    source: "https://www.st.com/en/microcontrollers-microprocessors/stm32h573ii.html",
    packageMustInclude: "UFBGA",
    e2e: { cad: {
      terminal: "ship",
      // The frozen orderable is STM32H573IIK6 (no Q suffix); ST defines Q as
      // the dedicated SMPS pinout, so the non-SMPS UFBGA201 map is the exact
      // official artifact for this population.
      vendorPinoutFile: "STM32H562_H563_H573_UFBGA201.bsd"
    }, spice: { terminal: "honest-refusal" } }
  },
  ADS131M08: { source: "https://www.ti.com/product/ADS131M08/part-details/ADS131M08IPBS", packageMustInclude: "TQFP", noBehavioralSpice: true, e2e: { cad: { terminal: "ship" }, spice: { terminal: "honest-refusal" } } },
  SI5341B: { source: "https://www.skyworksinc.com/-/media/SkyWorks/SL/documents/public/data-sheets/si5341-40-d-datasheet.pdf", packageMustInclude: "QFN", noBehavioralSpice: true, e2e: { cad: { terminal: "ship" }, spice: { terminal: "honest-refusal" } } },
  BME280: { source: "https://www.bosch-sensortec.com/media/boschsensortec/downloads/datasheets/bst-bme280-ds002.pdf", packageMustInclude: "LGA", noBehavioralSpice: true, e2e: { cad: { terminal: "ship" }, spice: { terminal: "honest-refusal" } } },
  "ESP32-S3-WROOM-1": {
    source: "https://documentation.espressif.com/esp32-s3-wroom-1_wroom-1u_datasheet_en.pdf", packageMustInclude: "MODULE", noBehavioralSpice: true,
    e2e: { cad: { terminal: "ship", answers: {
      leadSides: { value: 3, source: "Figure 11-1 shows lands on the left, bottom, and right edges." },
      leadsPerSide: { value: "15,11,14", source: "Figure 11-1 numbers perimeter lands 1-15, 16-26, and 27-40." },
      landSpanMm: { value: 16.5, source: "Figure 11-1 shows the 18 mm module width with 1.5 mm inward lands, giving 16.5 mm between opposing land centres." },
      landSpanCrossMm: { value: 24, source: "Figure 11-1 locates the bottom land centre line from the 25.5 mm body edge and 1.5 mm land length." }
    } }, spice: { terminal: "honest-refusal" } }
  },
  BSS138P: { source: "https://assets.nexperia.com/documents/data-sheet/BSS138P.pdf", packageMustInclude: "SOT-23", e2e: { cad: { terminal: "ship" }, spice: { terminal: "honest-refusal" } } },
  "1N4007": {
    source: "https://www.vishay.com/docs/88503/1n4001.pdf",
    packageMustInclude: "DO-41",
    e2e: { cad: { terminal: "ship", answers: {
      // Axial lead spacing is a board-layout choice within the available lead
      // length, not a fact the package drawing can decide for the user.
      pitchMm: { value: 10.16, source: "User-selected 0.4 inch axial lead spacing; the Vishay DO-204AL drawing provides sufficient lead length for this forming choice." }
    } }, spice: { terminal: "honest-refusal" } }
  },
  "LTV-817": {
    source: "https://optoelectronics.liteon.com/upload/download/DS-70-96-0016/LTV-8X7%20series%20RevQ.PDF",
    uploadSource: {
      url: "https://datasheet.octopart.com/LTV-817-Lite-On-datasheet-7280802.pdf",
      sha256: "2069b43eddfb78209eb1f0a9667d667d6e0f39d56be71bdf7d10d07535bcdde3"
    },
    packageMustInclude: "DIP", e2e: { cad: { terminal: "ship" }, spice: { terminal: "honest-refusal" } }
  },
  "7490120110": { source: "https://www.we-online.com/components/products/datasheet/7490120110.pdf", e2e: { cad: { terminal: "ship" }, spice: { terminal: "vendor" } } },
  "1-1734592-0": { source: "https://www.te.com/commerce/DocumentDelivery/DDEController?Action=showdoc&DocId=Customer+Drawing%7F1734592%7FC1%7Fpdf%7FEnglish%7FENG_CD_1734592_C1.pdf%7F1-1734592-0", e2e: { cad: {
    terminal: "ship",
    // Sheet 2 labels the tin-plated hold-down footprint `2 PLC`; these are
    // mandatory soldered features separate from the ten contact lands.
    minimumAuxiliaryPads: 2
  }, spice: { terminal: "honest-refusal" } } },
  CRCW060310K0FKEA: { source: "https://www.vishay.com/docs/28773/crcwce3.pdf", packageMustInclude: "0603", e2e: { cad: { terminal: "ship" }, spice: { terminal: "honest-refusal" } } },
  GRM188R71C104KA01D: {
    source: "https://search.murata.co.jp/Ceramy/image/img/A01X/G101/ENG/GRM188R71C104KA01-01.pdf",
    packageMustInclude: "0603",
    e2e: { cad: { terminal: "ship", answers: {
      // Murata explicitly requires the board owner to choose within these
      // ranges after evaluating the actual PCB.  This is therefore a genuine
      // user manufacturing answer, not a Forge-invented nominal: for reflow on
      // GRM18 within ±0.10 mm, b=0.7 and c=0.8 give centre span b+c=1.5 mm.
      landSpanMm: { value: 1.5, source: "Murata GRM application notice, Table 2 reflow land dimensions for GRM18 (b 0.6-0.7 mm, c 0.6-0.8 mm); user-selected b=0.7 mm and c=0.8 mm." }
    } }, spice: { terminal: "honest-refusal" } }
  },
  MCP1501: {
    source: "https://ww1.microchip.com/downloads/aemDocuments/documents/MSLD/ProductDocuments/DataSheets/MCP1501-Data-Sheet-DS20005474F.pdf",
    packageMustInclude: "SOT",
    pins: { "1": "OUT", "2": "GND", "3": "GND", "4": "SHDN", "5": "GND", "6": "VDD" },
    spiceClass: "voltage reference",
    configurationRequired: true,
    e2e: { cad: { terminal: "ship" }, spice: {
      terminal: "generated",
      supplied: { outputVoltage: { value: 2.5, source: "MCP1501 2.500 V ordering option in Table 2-1." } },
      reviewedClass: "reference",
      corrections: [
        { parameter: "lineRegulation", unit: "ppm/V", page: 6, printed: { min: null, typ: 5, max: 50 }, source: "MCP1501 Table 2-1, Line Regulation row." },
        { parameter: "loadRegulation", unit: "ppm/mA", page: 6, printed: { min: null, typ: 10, max: 40 }, source: "MCP1501 Table 2-1, sink Load Regulation row." }
      ]
    } }
  },
  OPA810: {
    source: "https://www.ti.com/lit/ds/symlink/opa810.pdf",
    packageMustInclude: "SOT-23",
    pins: { "1": "VO", "2": "VS-", "3": "VIN+", "4": "VIN-", "5": "VS+" },
    spiceClass: "operational amplifier",
    e2e: { cad: { terminal: "ship" }, spice: { terminal: "generated", blockChoice: 0 } }
  },
  INA821: {
    source: "https://www.ti.com/lit/ds/symlink/ina821.pdf",
    packageMustInclude: "SOIC",
    pins: { "1": "-IN", "2": "RG", "3": "RG", "4": "+IN", "5": "-VS", "6": "REF", "7": "OUT", "8": "+VS" },
    spiceClass: "instrumentation amplifier",
    e2e: { cad: { terminal: "ship" }, spice: { terminal: "generated" } }
  },
  LT8609S: {
    source: "https://www.analog.com/media/en/technical-documentation/data-sheets/lt8609s.pdf",
    packageMustInclude: "LQFN",
    pins: { "1": "RT", "2": "INTVCC", "3": "GND", "4": "GND", "5": "SW", "6": "SW", "7": "N/C", "8": "GND", "9": "VIN", "10": "VIN", "11": "EN/UV", "12": "PG", "13": "FB", "14": "GND", "15": "TR/SS", "16": "SYNC", "17": "GND" },
    noBehavioralSpice: true,
    e2e: { cad: { terminal: "ship" }, spice: { terminal: "honest-refusal" } }
  },
  MAX40025: {
    source: "https://www.analog.com/media/en/technical-documentation/data-sheets/max40025a-max40026.pdf",
    packageMustInclude: "WLP",
    pins: { A1: "IN+", A2: "VCC", A3: "OUT+", B1: "IN-", B2: "GND", B3: "OUT-" },
    spiceClass: "comparator",
    e2e: {
      cad: { terminal: "ship", answers: {
        pitchMm: { value: 0.4, source: "Maxim W60D1+1 package outline 21-100296, terminal pitch e." },
        landPadLengthMm: { value: 0.25, source: "Analog Devices WLP assembly guide Table 1 recommends a 250 µm NSMD pad for 0.4 mm pitch." }
      } },
      spice: { terminal: "generated" }
    }
  },
  NCP163: {
    source: "https://www.onsemi.com/pdf/datasheet/ncp163-d.pdf",
    packageMustInclude: "XDFN",
    spiceClass: "low-dropout regulator",
    e2e: {
      cad: { terminal: "ship", answers: {
        terminalPads: {
          value: [
            { number: "1", xMm: -0.325, yMm: 0.48, widthMm: 0.26, heightMm: 0.24, shape: "rect" },
            { number: "2", xMm: -0.325, yMm: -0.48, widthMm: 0.26, heightMm: 0.24, shape: "rect" },
            { number: "3", xMm: 0.325, yMm: -0.48, widthMm: 0.26, heightMm: 0.24, shape: "rect" },
            { number: "4", xMm: 0.325, yMm: 0.48, widthMm: 0.26, heightMm: 0.24, shape: "rect" }
          ],
          source: "Onsemi 711AJ recommended mounting footprint: 0.65 mm horizontal pitch, 1.20 mm outer height, and 0.26 x 0.24 mm numbered lands determine these four corner centres exactly."
        },
        thermalPadRotationDeg: {
          value: 45,
          source: "Onsemi XDFN4 case 711AJ draws the central exposed pad as a square rotated 45 degrees between the four corner terminals."
        },
      } },
      spice: {
        terminal: "generated",
        supplied: { outputVoltage: { value: 3.3, source: "A fixed 3.3 V NCP163 ordering option." } },
        reviewedClass: "ldo",
        corrections: [
          { parameter: "dropoutVoltage", unit: "mV", page: 3, printed: { min: null, typ: 80, max: 145 }, source: "NCP163 electrical characteristics, 3.3 V WLCSP/XDFN dropout row." }
        ]
      }
    }
  },
  HCS27MS: {
    source: "https://www.renesas.com/en/document/dst/hcs27ms-datasheet", packageMustInclude: "FLATPACK", noBehavioralSpice: true,
    e2e: { cad: { terminal: "ship", answers: {
      mounting: { value: "smd", source: "The selected CDFP3-F14 ceramic flatpack is surface mounted." },
      pitchMm: { value: 1.27, source: "MIL-STD-1835 CDFP3-F14 / Renesas K14.A specifies 0.050 inch (1.27 mm) BSC pitch." },
      landPadLengthMm: { value: 1.5, source: "The frozen assembly-process land drawing specifies 1.5 mm land length for this formed K14.A package." },
      landPadWidthMm: { value: 0.6, source: "The frozen assembly-process land drawing specifies 0.6 mm land width for this formed K14.A package." },
      landSpanMm: { value: 8.5, source: "The frozen assembly-process land drawing specifies 8.5 mm opposing-row centre span for this formed K14.A package." }
    } }, spice: { terminal: "honest-refusal" } }
  }
};
