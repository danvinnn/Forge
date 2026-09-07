import { fetchWithTimeout, readBodyWithLimit } from "./http";
import { SearchClient } from "./search";
import JSZip from "jszip";

export type OfficialResourceKind = "spice" | "cad" | "step" | "package-drawing" | "application-note";
export interface OfficialResource { kind: OfficialResourceKind; label: string; url: string }
export interface ImportedOfficialFile { fileName: string; source: string }

const VENDORS: Array<{ matches: RegExp; host: RegExp; domain: string; page?: (part: string) => string }> = [
  { matches: /texas instruments|\bti\b/i, host: /(^|\.)ti\.com$/i, domain: "ti.com", page: (part) => `https://www.ti.com/product/${encodeURIComponent(part)}` },
  { matches: /analog devices|maxim|linear technology/i, host: /(^|\.)analog\.com$/i, domain: "analog.com", page: (part) => `https://www.analog.com/en/products/${encodeURIComponent(part.toLowerCase())}.html` },
  { matches: /renesas|intersil/i, host: /(^|\.)renesas\.com$/i, domain: "renesas.com", page: (part) => `https://www.renesas.com/en/products/${encodeURIComponent(part.toLowerCase())}` },
  { matches: /stmicroelectronics|\bst\b/i, host: /(^|\.)st\.com$/i, domain: "st.com", page: (part) => `https://www.st.com/en/search.html#q=${encodeURIComponent(part)}` },
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
  { matches: /te connectivity|tyco/i, host: /(^|\.)te\.com$/i, domain: "te.com" },
  { matches: /amphenol/i, host: /(^|\.)amphenol(?:-cs)?\.com$/i, domain: "amphenol.com" },
  { matches: /\bjst\b/i, host: /(^|\.)jst-mfg\.com$/i, domain: "jst-mfg.com" },
  { matches: /espressif/i, host: /(^|\.)espressif\.com$/i, domain: "espressif.com" },
  { matches: /raspberry pi/i, host: /(^|\.)raspberrypi\.com$/i, domain: "raspberrypi.com" }
];

const resourceSearch = new SearchClient();

/** Provenance check shared by the requested URL and every resolved redirect. */
export function isOfficialResourceUrl(url: string, manufacturer: string): boolean {
  const vendor = VENDORS.find((candidate) => candidate.matches.test(manufacturer));
  if (!vendor) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && vendor.host.test(parsed.hostname);
  } catch {
    return false;
  }
}

function plain(text: string): string {
  return text.replace(/<[^>]*>/g, " ").replace(/&amp;/gi, "&").replace(/&quot;/gi, '"').replace(/&#39;/gi, "'").replace(/\s+/g, " ").trim();
}

function kindOf(url: string, label: string): OfficialResourceKind | null {
  const clue = `${url} ${label}`.toLowerCase();
  if (/\.(?:lib|cir|sub|mod|ckt|sp|spi|inc)(?:[?#\s]|$)|\b(?:spice|pspice|ltspice|simulation model|macromodel)\b/.test(clue)) return "spice";
  if (/\.(?:step|stp)(?:[?#\s]|$)|\b(?:3d cad model|3d model|step model)\b/.test(clue)) return "step";
  if (/\.(?:kicad_mod|lbr|bxl|dra|psm|pcb|pcblib)(?:[?#\s]|$)|\b(?:cad model|footprint|land pattern|pcb library)\b/.test(clue)) return "cad";
  if (/\b(?:package drawing|package outline|mechanical drawing)\b/.test(clue)) return "package-drawing";
  if (/\b(?:application note|design note)\b/.test(clue)) return "application-note";
  return null;
}

export function officialResourcesFromHtml(html: string, page: string, officialHost: RegExp): OfficialResource[] {
  const found = new Map<string, OfficialResource>();
  const link = /<a\b[^>]*\bhref\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))[^>]*>([\s\S]*?)<\/a>/gi;
  for (const match of html.matchAll(link)) {
    try {
      const url = new URL(match[1] ?? match[2] ?? match[3], page);
      if (url.protocol !== "https:" || !officialHost.test(url.hostname)) continue;
      const label = plain(match[4]) || url.pathname.split("/").pop() || "Manufacturer resource";
      const kind = kindOf(url.href, label);
      if (!kind) continue;
      url.hash = "";
      found.set(url.href, { kind, label: label.slice(0, 160), url: url.href });
      if (found.size >= 24) break;
    } catch { /* malformed vendor link */ }
  }
  return [...found.values()];
}

/** Finds artifacts linked by the manufacturer's own product page; it never searches unofficial mirrors. */
export async function discoverOfficialResources(partNumber: string, manufacturer: string): Promise<OfficialResource[]> {
  const vendor = VENDORS.find((candidate) => candidate.matches.test(manufacturer));
  if (!vendor) return [];
  const officialHost = vendor.host;
  const found = new Map<string, OfficialResource>();

  async function inspectPage(page: string): Promise<void> {
    try {
      const response = await fetchWithTimeout(page, { headers: { Accept: "text/html", "User-Agent": "Forge/1.0 resource-discovery" } }, 8_000);
      if (!response.ok || !(response.headers.get("content-type") ?? "").toLowerCase().includes("text/html")) return;
      const html = new TextDecoder().decode(await readBodyWithLimit(response, page, 2_000_000));
      for (const resource of officialResourcesFromHtml(html, page, officialHost)) found.set(resource.url, resource);
    } catch { /* another automatic route may still succeed */ }
  }

  if (vendor.page) await inspectPage(vendor.page(partNumber.trim()));
  if (found.size > 0) return [...found.values()];

  // Product URLs are often category-pathed or generated from document IDs, so
  // they cannot be derived from a part number. Search is the generic recovery
  // route, but provenance remains strict: only HTTPS results on the identified
  // manufacturer's domain are inspected or returned.
  const outcome = await resourceSearch.search(
    `site:${vendor.domain} "${partNumber.trim()}" SPICE model CAD footprint package drawing`
  );
  const official = outcome.urls.filter((candidate) => {
    try {
      const parsed = new URL(candidate);
      return parsed.protocol === "https:" && vendor.host.test(parsed.hostname);
    } catch { return false; }
  });
  const pages: string[] = [];
  for (const candidate of official) {
    const kind = kindOf(candidate, candidate.split("/").pop() ?? "");
    if (kind) found.set(candidate, { kind, label: plain(decodeURIComponent(candidate.split("/").pop() ?? "Manufacturer resource")), url: candidate });
    else if (pages.length < 3) pages.push(candidate);
  }
  await Promise.all(pages.map(inspectPage));
  return [...found.values()].slice(0, 24);
}

/** Downloads only files hosted by the same official vendor selected above. */
export async function importOfficialResource(url: string, manufacturer: string): Promise<ImportedOfficialFile[]> {
  const vendor = VENDORS.find((candidate) => candidate.matches.test(manufacturer));
  const parsed = new URL(url);
  if (!vendor || !isOfficialResourceUrl(parsed.href, manufacturer)) {
    throw new Error("That resource is not hosted by the identified manufacturer.");
  }
  const response = await fetchWithTimeout(parsed.href, { headers: { Accept: "application/zip,text/plain,application/octet-stream", "User-Agent": "Forge/1.0 resource-import" } }, 12_000);
  // fetchWithTimeout validates every redirect against SSRF, but a public
  // third-party host is still not manufacturer evidence. Preserve the stronger
  // provenance boundary across redirects as well as the network-safety one.
  const finalUrl = response.url || parsed.href;
  if (!isOfficialResourceUrl(finalUrl, manufacturer)) {
    void response.body?.cancel();
    throw new Error("The manufacturer resource redirected outside the identified manufacturer's domain.");
  }
  if (!response.ok) throw new Error(`The manufacturer resource returned HTTP ${response.status}.`);
  const bytes = await readBodyWithLimit(response, parsed.href, 10_000_000);
  const directName = decodeURIComponent(parsed.pathname.split("/").pop() || "vendor-resource");
  const accepted = /\.(?:kicad_mod|kicad_sym|lbr|step|stp|lib|cir|sub|mod|ckt|sp|spi|inc|txt)$/i;
  if (accepted.test(directName)) return [{ fileName: directName, source: new TextDecoder().decode(bytes) }];
  const zip = await JSZip.loadAsync(bytes, { checkCRC32: true });
  const entries = Object.values(zip.files).filter((entry) => !entry.dir && accepted.test(entry.name));
  if (entries.length > 32) throw new Error("The vendor archive contains too many model or footprint files to import safely.");
  const files: ImportedOfficialFile[] = [];
  let total = 0;
  for (const entry of entries) {
    // JSZip exposes the declared expanded size only on its internal record.
    // Check it before `async()` allocates the result; the running total below
    // remains the second line of defence against dishonest metadata.
    const declaredExpanded = (entry as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize;
    if (declaredExpanded !== undefined && (declaredExpanded > 2_000_000 || total + declaredExpanded > 5_000_000)) {
      throw new Error("The expanded vendor resource is larger than Forge's safe import limit.");
    }
    const source = await entry.async("string");
    total += Buffer.byteLength(source, "utf8");
    if (total > 5_000_000) throw new Error("The expanded vendor resource is larger than 5MB.");
    files.push({ fileName: entry.name.split("/").pop() || entry.name, source });
  }
  if (files.length === 0) throw new Error("The vendor resource contains no supported SPICE text, KiCad/EAGLE footprint, or STEP model.");
  return files;
}
