/**
 * Black-box universe runner.
 *
 * The corpus is selected in universe-corpus.ts without inspecting Forge. This
 * process starts the production application and uses only the same HTTP routes
 * a browser uses. It does not import extraction, generation, assurance, or
 * model-building code. Results are resumable because a compact run is still too
 * expensive to repeat merely because the shell was interrupted.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { UNIVERSE_CORPUS, type UniversePart } from "./universe-corpus";

const ROOT = process.cwd();
const RESULTS = join(ROOT, ".universe-results");
const PORT = Number(process.env.FORGE_UNIVERSE_PORT ?? 3220);
const BASE = process.env.FORGE_UNIVERSE_BASE_URL ?? `http://127.0.0.1:${PORT}`;
const ESTIMATE = process.argv.includes("--estimate");
const FRESH = process.argv.includes("--fresh");
const RESOURCES_ONLY = process.argv.includes("--resources-only");
const ONLY_PART = process.argv.find((argument) => argument.startsWith("--part="))?.slice("--part=".length);
const CAD = !process.argv.includes("--spice-only");
const SPICE = !process.argv.includes("--cad-only");
const REQUEST_MS = 270_000;

interface RouteReceipt {
  status: number;
  code: string | null;
  error: string | null;
  asks: number;
  review: number;
  contradictions: number;
  packageChoices: string[];
  artifact?: string;
  needs?: string[];
}

interface PartReceipt {
  partNumber: string;
  manufacturer: string;
  selectedPackage: string | null;
  cad?: { read: RouteReceipt; selectedPackage?: string | null; kicad?: RouteReceipt; altium?: RouteReceipt };
  spice?: RouteReceipt;
  officialResources?: ResourceRecoveryReceipt;
}

interface ResourceRecoveryReceipt {
  status: number;
  discovered: Array<{ kind: string; label: string; url: string }>;
  imports: Array<{
    kind: string;
    label: string;
    url: string;
    status: number;
    error: string | null;
    files: string[];
  }>;
}

type CadReceipt = NonNullable<PartReceipt["cad"]>;

const safe = (value: string) => value.replace(/[^A-Za-z0-9._-]+/g, "_");
const resultPath = (part: UniversePart) => join(RESULTS, `${safe(part.partNumber)}.json`);
const normalize = (value: string) => value.toUpperCase().replace(/[^A-Z0-9]/g, "");

function clearPreviousArtifacts(part: UniversePart): void {
  for (const suffix of ["kicad", "altium", "spice"]) {
    const path = join(RESULTS, `${safe(part.partNumber)}-${suffix}.zip`);
    if (existsSync(path)) unlinkSync(path);
  }
}

function summary(status: number, payload: Record<string, unknown>, artifact?: string): RouteReceipt {
  const assurance = payload.assurance as { findings?: unknown[]; contradictions?: unknown[] } | undefined;
  const choices = payload.packageChoice as { ok?: boolean; options?: Array<{ designator?: string }> } | undefined;
  const needs = Array.isArray(payload.needs)
    ? payload.needs.map((need) => typeof need === "object" && need !== null && "field" in need ? String((need as { field: unknown }).field) : String(need))
    : undefined;
  const part = payload.part as { packageVariants?: Array<{ designator?: string }> } | undefined;
  const identified = Array.isArray(payload.packages)
    ? payload.packages as Array<{ designator?: string }>
    : [];
  const packageChoices = choices?.ok
    ? (choices.options ?? []).map((option) => option.designator ?? "").filter(Boolean)
    : [...(part?.packageVariants ?? []), ...identified].map((option) => option.designator ?? "").filter(Boolean);
  return {
    status,
    code: typeof payload.code === "string" ? payload.code : null,
    error: typeof payload.error === "string" ? payload.error : null,
    asks: Array.isArray(payload.asks) ? payload.asks.length : needs?.length ?? 0,
    review: Array.isArray(payload.review) ? payload.review.length : assurance?.findings?.length ?? 0,
    contradictions: assurance?.contradictions?.length ?? (Array.isArray(payload.contradictions) ? payload.contradictions.length : 0),
    packageChoices,
    ...(artifact ? { artifact } : {}),
    ...(needs?.length ? { needs } : {})
  };
}

async function jsonRequest(url: string, init: RequestInit): Promise<{ response: Response; payload: Record<string, unknown> }> {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(REQUEST_MS) });
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  return { response, payload };
}

function choosePackage(part: UniversePart, payload: Record<string, unknown>): string | null {
  const choice = payload.packageChoice as { ok?: boolean; options?: Array<{ designator?: string; label?: string }> } | undefined;
  const record = payload.part as { packageVariants?: Array<{ designator?: string; label?: string }> } | undefined;
  const identified = Array.isArray(payload.packages)
    ? payload.packages as Array<{ designator?: string; label?: string }>
    : [];
  const options = choice?.ok && choice.options?.length ? choice.options : (record?.packageVariants?.length ? record.packageVariants : identified);
  if (!options.length) return null;
  if (!part.packageHint) return options.length === 1 ? options[0].designator ?? null : null;
  const wanted = normalize(part.packageHint);
  const matches = options.filter((option) => {
    const text = normalize(`${option.designator ?? ""} ${option.label ?? ""}`);
    return text.includes(wanted) || wanted.includes(text);
  });
  return matches.length === 1 ? matches[0].designator ?? null : null;
}

async function exportCad(
  part: UniversePart,
  read: Record<string, unknown>,
  selectedPackage: string | null,
  format: "kicad" | "altium"
): Promise<RouteReceipt> {
  const assurance = read.assurance as { findings?: Array<Record<string, unknown>> } | undefined;
  const findings = (assurance?.findings ?? []).filter((finding) => finding.state === "review");
  const response = await fetch(`${BASE}/api/export`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    signal: AbortSignal.timeout(REQUEST_MS),
    body: JSON.stringify({
      part: read.part,
      format,
      ...(selectedPackage ? { packageType: selectedPackage } : {}),
      settings: { densityLevel: "B", footprintSource: "manufacturer" },
      assurance: { evaluated: true, findings }
    })
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
    return summary(response.status, payload);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  const artifact = `${safe(part.partNumber)}-${format}.zip`;
  writeFileSync(join(RESULTS, artifact), bytes);
  return summary(response.status, {}, artifact);
}

async function runCad(part: UniversePart): Promise<CadReceipt> {
  // Follow the browser's real two-stage path: the free deterministic identify
  // pass exposes package choices first, then the paid read is aimed at the
  // package the user selected. Exporting an unselected family record would
  // skip the very user-assisted route this benchmark is meant to measure.
  const identified = await jsonRequest(`${BASE}/api/identify`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ partNumber: part.partNumber, manufacturer: part.manufacturer })
  });
  const identifiedRead = summary(identified.response.status, identified.payload);
  const selectedFromIdentify = identified.response.ok ? choosePackage(part, identified.payload) : null;
  if (identifiedRead.packageChoices.length > 1 && !selectedFromIdentify) {
    return { read: { ...identifiedRead, code: "PACKAGE_SELECTION_UNRESOLVED", asks: 1 }, selectedPackage: null };
  }
  const { response, payload } = await jsonRequest(`${BASE}/api/lookup`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      partNumber: part.partNumber,
      manufacturer: part.manufacturer,
      intent: "cad",
      ...(selectedFromIdentify ? { packageType: selectedFromIdentify } : {}),
      settings: { densityLevel: "B", footprintSource: "manufacturer" }
    })
  });
  const summarized = summary(response.status, payload);
  const read = {
    ...summarized,
    packageChoices: summarized.packageChoices.length > 0 ? summarized.packageChoices : identifiedRead.packageChoices
  };
  if (!response.ok || typeof payload.part !== "object" || payload.part === null) return { read };
  const selectedPackage = selectedFromIdentify ?? choosePackage(part, payload);
  if (read.packageChoices.length > 1 && !selectedPackage) {
    return { read: { ...read, code: "PACKAGE_SELECTION_UNRESOLVED", asks: read.asks + 1 }, selectedPackage: null };
  }
  return {
    read,
    selectedPackage,
    kicad: await exportCad(part, payload, selectedPackage, "kicad"),
    altium: await exportCad(part, payload, selectedPackage, "altium")
  };
}

async function runSpice(part: UniversePart): Promise<RouteReceipt> {
  const body = new FormData();
  body.append("partNumber", part.partNumber);
  body.append("manufacturer", part.manufacturer);
  body.append("response", "json");
  const { response, payload } = await jsonRequest(`${BASE}/api/model`, { method: "POST", body });
  if (response.ok && typeof payload.zipBase64 === "string") {
    const artifact = `${safe(part.partNumber)}-spice.zip`;
    writeFileSync(join(RESULTS, artifact), Buffer.from(payload.zipBase64, "base64"));
    delete payload.zipBase64;
    return summary(response.status, payload, artifact);
  }
  return summary(response.status, payload);
}

async function resourceRequest(url: string, init: RequestInit = {}): Promise<{ response: Response; payload: Record<string, unknown> }> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const result = await jsonRequest(url, init);
    if (result.response.status !== 429 || attempt === 1) return result;
    // The public route deliberately allows only 30 discovery/import requests
    // per minute. Waiting exercises the real route without bypassing its guard.
    await new Promise((resolve) => setTimeout(resolve, 61_000));
  }
  throw new Error("unreachable");
}

async function runOfficialResources(part: UniversePart): Promise<ResourceRecoveryReceipt> {
  const query = new URLSearchParams({ partNumber: part.partNumber, manufacturer: part.manufacturer });
  const { response, payload } = await resourceRequest(`${BASE}/api/resources?${query}`);
  const discovered = (Array.isArray(payload.resources) ? payload.resources : [])
    .filter((resource): resource is { kind: string; label: string; url: string } =>
      typeof resource === "object" && resource !== null &&
      typeof (resource as { kind?: unknown }).kind === "string" &&
      typeof (resource as { label?: unknown }).label === "string" &&
      typeof (resource as { url?: unknown }).url === "string")
    .map((resource) => ({ kind: resource.kind, label: resource.label, url: resource.url }));
  const imports: ResourceRecoveryReceipt["imports"] = [];
  const completed = new Set<string>();
  for (const resource of discovered) {
    if (!["cad", "step", "spice"].includes(resource.kind) || completed.has(resource.kind)) continue;
    const imported = await resourceRequest(`${BASE}/api/resources`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: resource.url, manufacturer: part.manufacturer })
    });
    const files = Array.isArray(imported.payload.files)
      ? imported.payload.files.flatMap((file) =>
          typeof file === "object" && file !== null && typeof (file as { fileName?: unknown }).fileName === "string"
            ? [(file as { fileName: string }).fileName]
            : [])
      : [];
    imports.push({
      kind: resource.kind,
      label: resource.label,
      url: resource.url,
      status: imported.response.status,
      error: typeof imported.payload.error === "string" ? imported.payload.error : null,
      files
    });
    // This matches the browser: a successfully imported archive stops further
    // attempts for that artifact kind, even when it requires a user choice.
    if (imported.response.ok && files.length > 0) completed.add(resource.kind);
  }
  return { status: response.status, discovered, imports };
}

async function responds(): Promise<boolean> {
  try {
    return (await fetch(`${BASE}/api/config`, { signal: AbortSignal.timeout(2_000) })).ok;
  } catch {
    return false;
  }
}

async function waitForServer(): Promise<boolean> {
  const until = Date.now() + 60_000;
  while (Date.now() < until) {
    if (await responds()) return true;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

function stop(server: ChildProcess | null): void {
  if (!server?.pid) return;
  try { process.kill(-server.pid, "SIGKILL"); } catch { server.kill("SIGKILL"); }
}

function report(receipts: PartReceipt[]): void {
  const cadRead = receipts.filter((receipt) => receipt.cad?.read.status === 200).length;
  const kicad = receipts.filter((receipt) => receipt.cad?.kicad?.status === 200).length;
  const altium = receipts.filter((receipt) => receipt.cad?.altium?.status === 200).length;
  const spice = receipts.filter((receipt) => receipt.spice?.status === 200).length;
  const questions = receipts.reduce((count, receipt) => count + (receipt.cad?.kicad?.asks ?? receipt.cad?.read.asks ?? 0) + (receipt.spice?.asks ?? 0), 0);
  console.log(`\nBlack-box universe: ${receipts.length}/${UNIVERSE_CORPUS.length} completed`);
  if (CAD) console.log(`  CAD read ${cadRead}/${receipts.length}; KiCad ${kicad}; Altium ${altium}`);
  if (SPICE) console.log(`  SPICE artifact ${spice}/${receipts.length}`);
  console.log(`  ${questions} explicit question(s); details are in .universe-results/*.json`);
}

async function main(): Promise<void> {
  const corpus = ONLY_PART
    ? UNIVERSE_CORPUS.filter((part) => normalize(part.partNumber) === normalize(ONLY_PART))
    : UNIVERSE_CORPUS;
  if (corpus.length === 0) throw new Error(`The frozen universe has no part named ${ONLY_PART}.`);
  const ordinaryCalls = RESOURCES_ONLY ? 0 : corpus.length * (CAD && SPICE ? 4 : 2);
  const observedAverageUsd = 21.7380793 / 863;
  console.log(`\nFrozen product-independent universe: ${UNIVERSE_CORPUS.length} documents.`);
  console.log(`At most ${ordinaryCalls} ordinary model calls before retries; projected about $${(ordinaryCalls * observedAverageUsd).toFixed(2)} from the current ledger average.`);
  if (ESTIMATE) return;

  mkdirSync(RESULTS, { recursive: true });
  const receipts: PartReceipt[] = [];
  let server: ChildProcess | null = null;
  if (!process.env.FORGE_UNIVERSE_BASE_URL) {
    if (await responds()) throw new Error(`Port ${PORT} is already in use; refusing to measure an unknown server.`);
    const log = openSync(join(RESULTS, "server.log"), "a");
    server = spawn("npx", ["next", "start", "-p", String(PORT)], {
      cwd: ROOT,
      env: { ...process.env, PORT: String(PORT) },
      stdio: ["ignore", log, log],
      detached: true
    });
    if (!(await waitForServer())) throw new Error("The production server did not become ready.");
  }

  try {
    for (const [index, part] of corpus.entries()) {
      if (RESOURCES_ONLY) {
        const path = resultPath(part);
        const receipt: PartReceipt = existsSync(path)
          ? JSON.parse(readFileSync(path, "utf8")) as PartReceipt
          : { partNumber: part.partNumber, manufacturer: part.manufacturer, selectedPackage: null };
        console.log(`${String(index + 1).padStart(2)}/${corpus.length} ${part.partNumber}: discovering official resources`);
        receipt.officialResources = await runOfficialResources(part);
        writeFileSync(path, `${JSON.stringify(receipt, null, 2)}\n`);
        receipts.push(receipt);
        continue;
      }
      if (!FRESH && existsSync(resultPath(part))) {
        receipts.push(JSON.parse(readFileSync(resultPath(part), "utf8")) as PartReceipt);
        console.log(`${String(index + 1).padStart(2)}/${UNIVERSE_CORPUS.length} ${part.partNumber}: cached receipt`);
        continue;
      }
      console.log(`${String(index + 1).padStart(2)}/${UNIVERSE_CORPUS.length} ${part.partNumber}: running`);
      clearPreviousArtifacts(part);
      const receipt: PartReceipt = existsSync(resultPath(part))
        ? JSON.parse(readFileSync(resultPath(part), "utf8")) as PartReceipt
        : { partNumber: part.partNumber, manufacturer: part.manufacturer, selectedPackage: null };
      if (CAD) {
        try {
          const cad = await runCad(part);
          receipt.cad = cad;
          receipt.selectedPackage = cad.selectedPackage ?? null;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          receipt.cad = { read: { status: 0, code: "HARNESS_ERROR", error: message, asks: 0, review: 0, contradictions: 0, packageChoices: [] } };
        }
      }
      if (SPICE) {
        try {
          receipt.spice = await runSpice(part);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          receipt.spice = { status: 0, code: "HARNESS_ERROR", error: message, asks: 0, review: 0, contradictions: 0, packageChoices: [] };
        }
      }
      writeFileSync(resultPath(part), `${JSON.stringify(receipt, null, 2)}\n`);
      receipts.push(receipt);
      report(receipts);
    }
  } finally {
    stop(server);
  }
  report(receipts);
}

void main();
