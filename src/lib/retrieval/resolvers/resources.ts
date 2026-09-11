import { fetchWithTimeout, readBodyWithLimit } from "./http";
import { SearchClient } from "./search";
import JSZip from "jszip";
import { officialManufacturer } from "./manufacturer-identity";

export type OfficialResourceKind = "spice" | "cad" | "step" | "pinout" | "package-drawing" | "application-note";
export interface OfficialResource { kind: OfficialResourceKind; label: string; url: string }
export interface ImportedOfficialFile { fileName: string; source: string }
export interface ImportedOfficialPdf { fileName: string; bytes: ArrayBuffer; url: string }

const resourceSearch = new SearchClient();

/** Provenance check shared by the requested URL and every resolved redirect. */
export function isOfficialResourceUrl(url: string, manufacturer: string): boolean {
  const vendor = officialManufacturer(manufacturer);
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
  // IBIS describes I/O-buffer signal integrity, not SPICE. BSDL is also not
  // SPICE, but its IEEE 1149.1 physical pin map is useful independent pinout
  // evidence and gets its own import path instead of being discarded.
  if (/\bibis\b/.test(clue)) return null;
  if (/\b(?:bsdl|boundary[ -]scan)\b|\.(?:bsd|bsdl)(?:[?#\s]|$)/.test(clue)) return "pinout";
  if (/\.(?:lib|cir|sub|mod|ckt|sp|spi|inc|zip)(?:[?#\s]|$)/.test(clue) && /\b(?:spice|pspice|ltspice|simulation|model|macro)|\.(?:lib|cir|sub|mod|ckt|sp|spi|inc)(?:[?#\s]|$)/.test(clue)) return "spice";
  // A navigation page labelled "Simulation/SPICE Models" is a place to
  // search, not a model artifact. Only a download-shaped URL may be advertised
  // as an importable resource from label text alone.
  if (/\b(?:spice|pspice|ltspice|simulation model|macromodel)\b/.test(clue) && /(?:download|attachment|file=|document=)/.test(url.toLowerCase())) return "spice";
  if (/\.(?:step|stp)(?:[?#\s]|$)|\b(?:3d cad model|3d model|step model)\b/.test(clue)) return "step";
  if (/\.(?:kicad_mod|lbr|bxl|dra|psm|pcb|pcblib)(?:[?#\s]|$)|\b(?:cad model|footprint|land pattern|pcb library)\b/.test(clue)) return "cad";
  // Manufacturer product tables often label the exact package link only as
  // "TQFP (PBS) | 32" (family/designator plus pin count); the target itself is
  // the package-outline PDF.  It contains neither the words "package drawing"
  // nor a descriptive filename, so the otherwise generic classifier dropped
  // the automatic recovery source even though the page exposed it plainly.
  const packageAndPins = /\b(?:BGA|CSP|DFN|DIP|LGA|QFN|QFP|SIP|SOIC|SON|SOP|SOT|SSOP|TQFP|TSSOP|VSSOP|WLCSP|WQFN)\b[^\n]{0,48}\|\s*\d{1,3}\b/i;
  const packageAndDesignator = /\b(?:BGA|CSP|DFN|DIP|LGA|QFN|QFP|SIP|SOIC|SON|SOP|SOT|SSOP|TQFP|TSSOP|VSSOP|WLCSP|WQFN)\b\s*\([A-Z0-9-]{1,12}\)/i;
  if (/(?:\.pdf(?:[?#\s]|$)|\/pdf\/[^/?#]+(?:[?#]|$))/.test(url.toLowerCase()) && (packageAndPins.test(label) || packageAndDesignator.test(label))) return "package-drawing";
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
export async function discoverOfficialResources(partNumber: string, manufacturer: string, packageType?: string): Promise<OfficialResource[]> {
  const vendor = officialManufacturer(manufacturer);
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

  // Product URLs are often category-pathed or generated from document IDs, so
  // they cannot be derived from a part number. Search is the generic recovery
  // route, but provenance remains strict: only HTTPS results on the identified
  // manufacturer's domain are inspected or returned.
  const outcome = await resourceSearch.search(
    `site:${vendor.domain} "${partNumber.trim()}" ${packageType ? `"${packageType.trim()}" ` : ""}SPICE model CAD footprint package drawing BSDL`
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
  const vendor = officialManufacturer(manufacturer);
  const parsed = new URL(url);
  if (!vendor || !isOfficialResourceUrl(parsed.href, manufacturer)) {
    throw new Error("That resource is not hosted by the identified manufacturer.");
  }
  // Official family archives can be several megabytes and some manufacturer
  // CDNs do not begin streaming within twelve seconds. The route itself has a
  // 60-second ceiling and every byte is independently bounded below, so allow
  // the download most of that budget instead of turning valid BSDL/CAD recovery
  // into a random refusal on a slow edge node.
  const response = await fetchWithTimeout(parsed.href, { headers: { Accept: "application/zip,text/plain,application/octet-stream", "User-Agent": "Forge/1.0 resource-import" } }, 45_000);
  // fetchWithTimeout validates every redirect against SSRF, but a public
  // third-party host is still not manufacturer evidence. Preserve the stronger
  // provenance boundary across redirects as well as the network-safety one.
  const finalUrl = response.url || parsed.href;
  if (!isOfficialResourceUrl(finalUrl, manufacturer)) {
    void response.body?.cancel();
    throw new Error("The manufacturer resource redirected outside the identified manufacturer's domain.");
  }
  if (!response.ok) throw new Error(`The manufacturer resource returned HTTP ${response.status}.`);
  const body = await readBodyWithLimit(response, parsed.href, 10_000_000);
  const bytes = new Uint8Array(body);
  const disposition = response.headers.get("content-disposition") ?? "";
  const dispositionName = disposition.match(/filename\*?=(?:UTF-8''|["']?)([^"';]+)/i)?.[1];
  const directName = decodeURIComponent(dispositionName ?? parsed.pathname.split("/").pop() ?? "vendor-resource");
  const accepted = /\.(?:kicad_mod|kicad_sym|lbr|step|stp|lib|cir|sub|mod|ckt|sp|spi|inc|bsd|bsdl|txt)$/i;
  const prefix = new TextDecoder().decode(bytes.slice(0, 512)).trimStart().toLowerCase();
  if (prefix.startsWith("<!doctype html") || prefix.startsWith("<html") || prefix.includes("<head")) {
    throw new Error("The manufacturer link is a web page, not a downloadable model or CAD artifact.");
  }
  const zipMagic = bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && [0x03, 0x05, 0x07].includes(bytes[2]) && [0x04, 0x06, 0x08].includes(bytes[3]);
  if (accepted.test(directName) && !zipMagic) return [{ fileName: directName, source: new TextDecoder().decode(bytes) }];
  if (!zipMagic) throw new Error("The manufacturer link did not return a supported model, CAD file, STEP file, or ZIP archive.");
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(bytes, { checkCRC32: true });
  } catch {
    throw new Error("The manufacturer ZIP archive is damaged or incomplete.");
  }
  const entries = Object.values(zip.files).filter((entry) => !entry.dir && accepted.test(entry.name));
  // Family BSDL/CAD archives legitimately contain one small file per package
  // and can exceed 32 entries. The compressed download, every expanded entry,
  // and the aggregate expanded bytes are already independently bounded; a
  // modest metadata cap prevents pathological directories without rejecting
  // ordinary manufacturer families before exact identity selection runs.
  if (entries.length > 256) throw new Error("The vendor archive contains too many artifact files to import safely.");
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
  if (files.length === 0) throw new Error("The vendor resource contains no supported SPICE text, pinout, KiCad/EAGLE footprint, or STEP model.");
  return files;
}

/** Downloads a supplemental manufacturer PDF under the same provenance and size boundary as other official imports. */
export async function importOfficialPdf(url: string, manufacturer: string): Promise<ImportedOfficialPdf> {
  const parsed = new URL(url);
  if (!isOfficialResourceUrl(parsed.href, manufacturer)) {
    throw new Error("That package drawing is not hosted by the identified manufacturer.");
  }
  const response = await fetchWithTimeout(
    parsed.href,
    { headers: { Accept: "application/pdf", "User-Agent": "Forge/1.0 package-drawing-import" } },
    20_000
  );
  const finalUrl = response.url || parsed.href;
  if (!isOfficialResourceUrl(finalUrl, manufacturer)) {
    void response.body?.cancel();
    throw new Error("The manufacturer package drawing redirected outside the identified manufacturer's domain.");
  }
  if (!response.ok) throw new Error(`The manufacturer package drawing returned HTTP ${response.status}.`);
  const body = await readBodyWithLimit(response, parsed.href, 12_000_000);
  const bytes = new Uint8Array(body);
  if (bytes.length < 5 || new TextDecoder().decode(bytes.slice(0, 5)) !== "%PDF-") {
    throw new Error("The manufacturer package-drawing link did not return a PDF.");
  }
  const disposition = response.headers.get("content-disposition") ?? "";
  const dispositionName = disposition.match(/filename\*?=(?:UTF-8''|["']?)([^"';]+)/i)?.[1];
  const fileName = decodeURIComponent(dispositionName ?? new URL(finalUrl).pathname.split("/").pop() ?? "package-drawing.pdf");
  return { fileName: /\.pdf$/i.test(fileName) ? fileName : `${fileName}.pdf`, bytes: body, url: finalUrl };
}
