import { fetchWithTimeout, readBodyWithLimit } from "./http";
import JSZip from "jszip";

export type OfficialResourceKind = "spice" | "cad" | "package-drawing" | "application-note";
export interface OfficialResource { kind: OfficialResourceKind; label: string; url: string }
export interface ImportedOfficialFile { fileName: string; source: string }

const VENDORS: Array<{ matches: RegExp; host: RegExp; page: (part: string) => string }> = [
  { matches: /texas instruments|\bti\b/i, host: /(^|\.)ti\.com$/i, page: (part) => `https://www.ti.com/product/${encodeURIComponent(part)}` },
  { matches: /analog devices|maxim|linear technology/i, host: /(^|\.)analog\.com$/i, page: (part) => `https://www.analog.com/en/products/${encodeURIComponent(part.toLowerCase())}.html` },
  { matches: /renesas|intersil/i, host: /(^|\.)renesas\.com$/i, page: (part) => `https://www.renesas.com/en/products/${encodeURIComponent(part.toLowerCase())}` },
  { matches: /stmicroelectronics|\bst\b/i, host: /(^|\.)st\.com$/i, page: (part) => `https://www.st.com/en/search.html#q=${encodeURIComponent(part)}` },
  { matches: /microchip/i, host: /(^|\.)microchip\.com$/i, page: (part) => `https://www.microchip.com/en-us/product/${encodeURIComponent(part)}` },
  { matches: /onsemi|on semiconductor/i, host: /(^|\.)onsemi\.com$/i, page: (part) => `https://www.onsemi.com/products?searchTerm=${encodeURIComponent(part)}` }
];

function plain(text: string): string {
  return text.replace(/<[^>]*>/g, " ").replace(/&amp;/gi, "&").replace(/&quot;/gi, '"').replace(/&#39;/gi, "'").replace(/\s+/g, " ").trim();
}

function kindOf(url: string, label: string): OfficialResourceKind | null {
  const clue = `${url} ${label}`.toLowerCase();
  if (/\.(?:lib|cir|sub|mod)(?:[?#]|$)|\b(?:spice|pspice|ltspice|simulation model|macromodel)\b/.test(clue)) return "spice";
  if (/\.(?:kicad_mod|bxl|dra|psm|pcb|pcblib|step|stp)(?:[?#]|$)|\b(?:cad model|footprint|land pattern|pcb library)\b/.test(clue)) return "cad";
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
  const page = vendor.page(partNumber.trim());
  const response = await fetchWithTimeout(page, { headers: { Accept: "text/html", "User-Agent": "Forge/1.0 resource-discovery" } }, 8_000);
  if (!response.ok || !(response.headers.get("content-type") ?? "").toLowerCase().includes("text/html")) return [];
  const html = new TextDecoder().decode(await readBodyWithLimit(response, page, 2_000_000));
  return officialResourcesFromHtml(html, page, vendor.host);
}

/** Downloads only files hosted by the same official vendor selected above. */
export async function importOfficialResource(url: string, manufacturer: string): Promise<ImportedOfficialFile[]> {
  const vendor = VENDORS.find((candidate) => candidate.matches.test(manufacturer));
  const parsed = new URL(url);
  if (!vendor || parsed.protocol !== "https:" || !vendor.host.test(parsed.hostname)) {
    throw new Error("That resource is not hosted by the identified manufacturer.");
  }
  const response = await fetchWithTimeout(parsed.href, { headers: { Accept: "application/zip,text/plain,application/octet-stream", "User-Agent": "Forge/1.0 resource-import" } }, 12_000);
  if (!response.ok) throw new Error(`The manufacturer resource returned HTTP ${response.status}.`);
  const bytes = await readBodyWithLimit(response, parsed.href, 10_000_000);
  const directName = decodeURIComponent(parsed.pathname.split("/").pop() || "vendor-resource");
  const accepted = /\.(?:kicad_mod|kicad_sym|lib|cir|sub|mod|txt)$/i;
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
  if (files.length === 0) throw new Error("The vendor resource contains no supported SPICE text or KiCad footprint.");
  return files;
}
