/**
 * Manufacturer identity used by official-resource discovery and datasheet search.
 *
 * This belongs inside the commercial resolver subtree: some entries contain
 * official product-page URLs, even though the module itself performs no I/O.
 */
export interface OfficialManufacturer {
  matches: RegExp;
  host: RegExp;
  domain: string;
  page?: (part: string) => string;
}

export const OFFICIAL_MANUFACTURERS: OfficialManufacturer[] = [
  { matches: /texas instruments|\bti\b/i, host: /(^|\.)ti\.com$/i, domain: "ti.com", page: (part) => `https://www.ti.com/product/${encodeURIComponent(part)}` },
  { matches: /analog devices|maxim|linear technology/i, host: /(^|\.)analog\.com$/i, domain: "analog.com", page: (part) => `https://www.analog.com/en/products/${encodeURIComponent(part.toLowerCase())}.html` },
  { matches: /renesas|intersil/i, host: /(^|\.)renesas\.com$/i, domain: "renesas.com", page: (part) => `https://www.renesas.com/en/products/${encodeURIComponent(part.toLowerCase())}` },
  { matches: /stmicroelectronics|\bst\b/i, host: /(^|\.)st\.com$/i, domain: "st.com", page: (part) => `https://www.st.com/en/microcontrollers-microprocessors/${encodeURIComponent(part.toLowerCase())}.html` },
  { matches: /microchip|atmel|microsemi/i, host: /(^|\.)microchip\.com$/i, domain: "microchip.com", page: (part) => `https://www.microchip.com/en-us/product/${encodeURIComponent(part)}` },
  { matches: /onsemi|on semiconductor|fairchild/i, host: /(^|\.)onsemi\.com$/i, domain: "onsemi.com", page: (part) => `https://www.onsemi.com/products?searchTerm=${encodeURIComponent(part)}` },
  { matches: /\bnxp\b|freescale|philips semiconductor/i, host: /(^|\.)nxp\.com$/i, domain: "nxp.com" },
  { matches: /infineon|international rectifier|cypress/i, host: /(^|\.)infineon\.com$/i, domain: "infineon.com" },
  { matches: /vishay/i, host: /(^|\.)vishay\.com$/i, domain: "vishay.com" },
  { matches: /diodes incorporated|\bdiodes\b|zetex/i, host: /(^|\.)diodes\.com$/i, domain: "diodes.com" },
  { matches: /nexperia/i, host: /(^|\.)nexperia\.com$/i, domain: "nexperia.com" },
  { matches: /\brohm\b/i, host: /(^|\.)rohm\.com$/i, domain: "rohm.com" },
  { matches: /toshiba/i, host: /(^|\.)toshiba\.semicon-storage\.com$/i, domain: "toshiba.semicon-storage.com" },
  { matches: /littelfuse/i, host: /(^|\.)littelfuse\.com$/i, domain: "littelfuse.com" },
  { matches: /wolfspeed|cree/i, host: /(^|\.)wolfspeed\.com$/i, domain: "wolfspeed.com" },
  { matches: /qorvo/i, host: /(^|\.)qorvo\.com$/i, domain: "qorvo.com" },
  { matches: /skyworks/i, host: /(^|\.)skyworksinc\.com$/i, domain: "skyworksinc.com" },
  { matches: /monolithic power|\bmps\b/i, host: /(^|\.)monolithicpower\.com$/i, domain: "monolithicpower.com" },
  { matches: /nordic semiconductor/i, host: /(^|\.)nordicsemi\.com$/i, domain: "nordicsemi.com" },
  { matches: /silicon labs|silicon laboratories/i, host: /(^|\.)silabs\.com$/i, domain: "silabs.com" },
  { matches: /broadcom|avago/i, host: /(^|\.)broadcom\.com$/i, domain: "broadcom.com" },
  { matches: /molex/i, host: /(^|\.)molex\.com$/i, domain: "molex.com" },
  {
    matches: /te connectivity|tyco/i,
    host: /(^|\.)te\.com$/i,
    domain: "te.com",
    page: (part) => `https://www.te.com/en/product-${encodeURIComponent(part)}.html`
  },
  { matches: /amphenol/i, host: /(^|\.)amphenol(?:-cs)?\.com$/i, domain: "amphenol.com" },
  { matches: /\bjst\b/i, host: /(^|\.)jst-mfg\.com$/i, domain: "jst-mfg.com" },
  { matches: /espressif/i, host: /(^|\.)espressif\.com$/i, domain: "espressif.com" },
  { matches: /raspberry pi/i, host: /(^|\.)raspberrypi\.com$/i, domain: "raspberrypi.com" },
  { matches: /w(?:ü|u|ue)rth|wurth elektronik/i, host: /(^|\.)we-online\.com$/i, domain: "we-online.com", page: () => "https://www.we-online.com/en/components/products/WE-LAN" }
];

export function officialManufacturer(manufacturer?: string): OfficialManufacturer | undefined {
  if (!manufacturer) return undefined;
  return OFFICIAL_MANUFACTURERS.find((candidate) => candidate.matches.test(manufacturer));
}
