import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import JSZip from "jszip";
import { UNIVERSE_CORPUS } from "./universe-corpus";
import { UNIVERSE_ORACLE } from "./universe-oracle";

const ROOT = process.cwd();
const RESULTS = join(ROOT, ".universe-results");
const safe = (value: string) => value.replace(/[^A-Za-z0-9._-]+/g, "_");
const norm = (value: string) => value.toUpperCase().replace(/[^A-Z0-9]/g, "");

interface Receipt {
  partNumber: string;
  cad?: { read: { status: number; code: string | null; error: string | null; packageChoices: string[] }; selectedPackage?: string | null; kicad?: { status: number; code: string | null; error: string | null; needs?: string[] }; altium?: { status: number } };
  spice?: { status: number; code: string | null; error: string | null; artifact?: string };
  officialResources?: { discovered: unknown[]; imports: Array<{ kind: string; status: number; files: string[]; error: string | null }> };
}

interface Finding { severity: "P0" | "P1" | "P2"; part: string; detail: string; }

interface ArtifactRecord {
  pins: Array<{ number: string; name: string }>;
  exposedPadPin?: { number: string; name: string } | null;
}

async function artifactRecord(part: string): Promise<ArtifactRecord | null> {
  const path = join(RESULTS, `${safe(part)}-kicad.zip`);
  if (!existsSync(path)) return null;
  const zip = await JSZip.loadAsync(readFileSync(path));
  const name = Object.keys(zip.files).find((candidate) => /\.json$/i.test(candidate) && !/manifest\.json$/i.test(candidate));
  return name ? JSON.parse(await zip.file(name)!.async("string")) as ArtifactRecord : null;
}

async function spiceText(part: string): Promise<string | null> {
  const path = join(RESULTS, `${safe(part)}-spice.zip`);
  if (!existsSync(path)) return null;
  const zip = await JSZip.loadAsync(readFileSync(path));
  const name = Object.keys(zip.files).find((candidate) => /\.lib$/i.test(candidate));
  return name ? zip.file(name)!.async("string") : null;
}

async function main(): Promise<void> {
  const findings: Finding[] = [];
  const receipts = new Map<string, Receipt>();
  for (const part of UNIVERSE_CORPUS) {
    const path = join(RESULTS, `${safe(part.partNumber)}.json`);
    if (!existsSync(path)) {
      findings.push({ severity: "P1", part: part.partNumber, detail: "No black-box receipt exists." });
      continue;
    }
    receipts.set(part.partNumber, JSON.parse(readFileSync(path, "utf8")) as Receipt);
  }

  for (const part of UNIVERSE_CORPUS) {
    const receipt = receipts.get(part.partNumber);
    if (!receipt) continue;
    const oracle = UNIVERSE_ORACLE[part.partNumber];
    // A targeted rerun can refuse an artifact that an older run shipped. The
    // receipt describes this run; a ZIP left on disk is only diagnostic data.
    const spice = receipt.spice?.status === 200 ? await spiceText(part.partNumber) : null;
    if (spice && oracle?.noBehavioralSpice) {
      findings.push({ severity: "P0", part: part.partNumber, detail: "Shipped a behavioral SPICE model for a device whose manufacturer class has no supported behavioral contract." });
    }
    if (spice && oracle?.spiceClass && !spice.toLowerCase().includes(oracle.spiceClass)) {
      findings.push({ severity: "P0", part: part.partNumber, detail: `Shipped the wrong SPICE topology; expected ${oracle.spiceClass}.` });
    }
    if (spice && oracle?.configurationRequired && receipt.spice?.status === 200) {
      findings.push({ severity: "P0", part: part.partNumber, detail: "Shipped one fixed family value without an orderable-number or user configuration answer." });
    }

    const cad = receipt.cad?.kicad?.status === 200 ? await artifactRecord(part.partNumber) : null;
    if (cad && oracle?.pins) {
      const terminals = cad.exposedPadPin ? [...cad.pins, cad.exposedPadPin] : cad.pins;
      const actual = Object.fromEntries(terminals.map((pin) => [pin.number, norm(pin.name)]));
      const wrong = Object.entries(oracle.pins).filter(([number, name]) => actual[number] !== norm(name));
      if (wrong.length > 0) {
        findings.push({ severity: "P0", part: part.partNumber, detail: `Shipped CAD with missing/wrong oracle pins: ${wrong.map(([number, name]) => `${number}=${name}`).join(", ")}.` });
      }
    }

    const packageEvidence = [receipt.cad?.selectedPackage ?? "", ...(receipt.cad?.read.packageChoices ?? [])].join(" ");
    if (oracle?.packageMustInclude && receipt.cad?.read.status === 200 && !norm(packageEvidence).includes(norm(oracle.packageMustInclude))) {
      findings.push({ severity: "P1", part: part.partNumber, detail: `Retrieved/read package evidence does not include the manufacturer package ${oracle.packageMustInclude}.` });
    }
    if (receipt.cad?.kicad?.status === 400) {
      findings.push({ severity: "P1", part: part.partNumber, detail: `A successful read became an invalid internal part record: ${receipt.cad.kicad.error ?? "HTTP 400"}.` });
    }
    if (/contradicts[\s\S]*agrees/i.test(receipt.cad?.kicad?.error ?? "")) {
      findings.push({ severity: "P1", part: part.partNumber, detail: "The release guard calls agreeing evidence a contradiction." });
    }
    if (oracle?.noBehavioralSpice && receipt.spice?.code === "MODEL_SELECTION_REQUIRED") {
      findings.push({ severity: "P1", part: part.partNumber, detail: "Asked the user to choose a specification block even though no choice can unlock a supported model." });
    }
    for (const imported of receipt.officialResources?.imports ?? []) {
      if (imported.status >= 400) findings.push({ severity: "P2", part: part.partNumber, detail: `Discovered an official ${imported.kind} resource but could not import it: ${imported.error ?? `HTTP ${imported.status}`}.` });
    }
  }

  const completed = receipts.size;
  const cadRead = [...receipts.values()].filter((receipt) => receipt.cad?.read.status === 200).length;
  const cadShip = [...receipts.values()].filter((receipt) => receipt.cad?.kicad?.status === 200 && receipt.cad?.altium?.status === 200).length;
  const spiceShip = [...receipts.values()].filter((receipt) => receipt.spice?.status === 200).length;
  const recoveredVendorModels = [...receipts.values()].filter((receipt) => receipt.officialResources?.imports.some((item) => item.kind === "spice" && item.status === 200 && item.files.length > 0)).length;
  console.log(`\nIndependent black-box universe: ${completed}/${UNIVERSE_CORPUS.length} receipts`);
  console.log(`CAD: ${cadRead} read, ${cadShip} shipped both formats`);
  console.log(`SPICE: ${spiceShip} generated, ${recoveredVendorModels} additional official vendor-model imports`);
  console.log(`Release findings: ${findings.filter((item) => item.severity === "P0").length} P0, ${findings.filter((item) => item.severity === "P1").length} P1, ${findings.filter((item) => item.severity === "P2").length} P2\n`);
  for (const finding of findings) console.log(`${finding.severity} ${finding.part}: ${finding.detail}`);
  const releaseBlocked = findings.some((finding) => finding.severity === "P0" || finding.severity === "P1");

  // Refuse to call a partial/stale directory a complete panel.
  const known = new Set(UNIVERSE_CORPUS.map((part) => `${safe(part.partNumber)}.json`));
  const unexpected = readdirSync(RESULTS).filter((name) => name.endsWith(".json") && !known.has(name));
  if (unexpected.length > 0) console.log(`\nIgnored stale receipts: ${unexpected.join(", ")}`);
  if (releaseBlocked) throw new Error("Black-box universe release gate failed.");
}

void main();
