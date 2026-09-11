/**
 * Multi-turn black-box release journey for the frozen universe.
 *
 * This file deliberately imports only the corpus and the independent oracle.
 * It talks to a production build over HTTP, exactly like the browser: identify,
 * read/search (or upload the oracle's official document), answer questions, and
 * request the final files. It never imports Forge extraction or generation code.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, openSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { UNIVERSE_CORPUS, type UniversePart } from "./universe-corpus";
import { UNIVERSE_ORACLE } from "./universe-oracle";

const ROOT = process.cwd();
const RESULTS = join(ROOT, ".universe-e2e-results");
const PORT = Number(process.env.FORGE_UNIVERSE_E2E_PORT ?? 3221);
const BASE = process.env.FORGE_UNIVERSE_E2E_BASE_URL ?? `http://127.0.0.1:${PORT}`;
const REQUEST_MS = 270_000;
const FRESH = process.argv.includes("--fresh");
const ESTIMATE = process.argv.includes("--estimate");
const ONLY_PART = process.argv.find((value) => value.startsWith("--part="))?.slice(7);

type Json = Record<string, unknown>;
type SpiceCorrection = NonNullable<NonNullable<NonNullable<(typeof UNIVERSE_ORACLE)[string]["e2e"]>["spice"]["corrections"]>[number]>;
interface Step {
  route: string;
  status: number;
  code: string | null;
  needs: string[];
  submitted: string[];
  correctionNeeds?: string[];
  choices?: unknown[];
  untraceable?: string[];
  untraceableValues?: Record<string, unknown>;
  missing?: string[];
  artifact?: string;
  error?: string | null;
}
interface Journey {
  partNumber: string;
  manufacturer: string;
  source: string;
  selectedPackage: string | null;
  cad: { read: Step[]; kicad: Step[]; altium: Step[] };
  spice: Step[];
}
interface ImportedFile { fileName: string; source: string }

const safe = (value: string) => value.replace(/[^A-Za-z0-9._-]+/g, "_");
const norm = (value: string) => value.toUpperCase().replace(/[^A-Z0-9]/g, "");
const pathOf = (part: UniversePart) => join(RESULTS, `${safe(part.partNumber)}.json`);
const needsOf = (payload: Json): string[] => Array.isArray(payload.needs)
  ? payload.needs.flatMap((item) => item && typeof item === "object" && "field" in item ? [String((item as { field: unknown }).field)] : [])
  : [];
const codeOf = (payload: Json) => typeof payload.code === "string" ? payload.code : null;
const errorOf = (payload: Json) => typeof payload.error === "string" ? payload.error : null;
const stringsOf = (payload: Json, key: string): string[] => Array.isArray(payload[key]) ? (payload[key] as unknown[]).filter((item): item is string => typeof item === "string") : [];

function confirmField(record: Json, path: string): Json {
  if (!path.includes(".")) {
    const current = record[path];
    return current && typeof current === "object" ? { ...record, [path]: { ...(current as Json), confidence: 1, method: "user-confirmed" } } : record;
  }
  const [group, key] = path.split(".");
  const bag = record[group];
  if (!bag || typeof bag !== "object") return record;
  const current = (bag as Json)[key];
  if (!current || typeof current !== "object") return record;
  return { ...record, [group]: { ...(bag as Json), [key]: { ...(current as Json), confidence: 1, method: "user-confirmed" } } };
}

function extractedValueAt(record: Json, path: string): unknown {
  const current = path.split(".").reduce<unknown>((value, key) =>
    value && typeof value === "object" ? (value as Json)[key] : undefined, record);
  return current && typeof current === "object" && "value" in current
    ? (current as { value: unknown }).value
    : undefined;
}

async function jsonRequest(url: string, init: RequestInit): Promise<{ response: Response; payload: Json }> {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(REQUEST_MS) });
  return { response, payload: await response.json().catch(() => ({})) as Json };
}

function packages(payload: Json): Array<{ designator: string; label: string }> {
  const choice = payload.packageChoice as { ok?: boolean; options?: Array<{ designator?: string; label?: string }> } | undefined;
  const part = payload.part as { packageVariants?: Array<{ designator?: string; label?: string }> } | undefined;
  const identified = Array.isArray(payload.packages) ? payload.packages as Array<{ designator?: string; label?: string }> : [];
  const values = choice?.ok && choice.options?.length ? choice.options : part?.packageVariants?.length ? part.packageVariants : identified;
  return values.flatMap((value) => value.designator ? [{ designator: value.designator, label: value.label ?? "" }] : []);
}

const family = (value: string) => ["UFBGA", "TFBGA", "BGA", "WLCSP", "LGA", "TQFP", "LQFP", "QFN", "LQFN", "XDFN", "DFN", "SON", "SOIC", "SOT", "DIP", "FLATPACK", "MODULE", "0603"]
  .find((token) => norm(value).includes(token)) ?? null;
const count = (value: string) => Number(/\d{1,3}/.exec(value)?.[0] ?? NaN);

function choosePackage(part: UniversePart, payload: Json): string | null {
  const options = packages(payload);
  if (!part.packageHint) return options.length === 1 ? options[0].designator : null;
  const standardName = (value: string) => {
    const key = norm(value);
    // JEDEC DO-204AL is the package commonly sold as DO-41.  This is a formal
    // package alias, not fuzzy matching; every unknown designation remains its
    // own key and therefore cannot select a merely similar package.
    if (key.includes("DO204AL") || key.includes("DO41")) return "DO204AL";
    return key;
  };
  const wanted = standardName(part.packageHint);
  const exact = options.filter((option) =>
    standardName(`${option.designator} ${option.label}`) === wanted ||
    standardName(option.designator) === wanted
  );
  // An additive grid designation such as UFBGA176+25 legitimately sits beside
  // UFBGA176 in the same family table.  Exact printed identity decides that
  // choice; substring matching is only a fallback for labels that add a vendor
  // code or prose around the same package.
  if (exact.length === 1) return exact[0].designator;
  const direct = options.filter((option) => {
    const candidate = standardName(`${option.designator} ${option.label}`);
    return candidate.includes(wanted) || wanted.includes(candidate);
  });
  if (direct.length === 1) return direct[0].designator;
  const wantedFamily = family(part.packageHint);
  const wantedCount = count(part.packageHint);
  const semantic = options.filter((option) => {
    const text = `${option.designator} ${option.label}`;
    return (!wantedFamily || family(text) === wantedFamily) && (!Number.isFinite(wantedCount) || count(text) === wantedCount);
  });
  return semantic.length === 1 ? semantic[0].designator : null;
}

async function officialPdf(part: UniversePart): Promise<File | null> {
  const oracle = UNIVERSE_ORACLE[part.partNumber];
  const source = oracle?.source;
  if (!source) return null;
  for (const candidate of [
    { url: source, sha256: null },
    ...(oracle.uploadSource ? [oracle.uploadSource] : [])
  ]) {
    try {
      const response = await fetch(candidate.url, { redirect: "follow", signal: AbortSignal.timeout(60_000) });
      if (!response.ok) continue;
      const bytes = await response.arrayBuffer();
      const buffer = Buffer.from(bytes);
      if (buffer.subarray(0, 5).toString() !== "%PDF-") continue;
      if (candidate.sha256 && createHash("sha256").update(buffer).digest("hex") !== candidate.sha256) continue;
      return new File([bytes], `${safe(part.partNumber)}.pdf`, { type: "application/pdf" });
    } catch {
      // Try the independently pinned upload copy when the official host blocks
      // unattended requests.  The hash prevents a mirror change from silently
      // changing the frozen black-box population.
    }
  }
  return null;
}

async function readCad(part: UniversePart): Promise<{ payload: Json | null; selected: string | null; steps: Step[]; pdf: File | null }> {
  const steps: Step[] = [];
  const identify = await jsonRequest(`${BASE}/api/identify`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ partNumber: part.partNumber, manufacturer: part.manufacturer })
  });
  const selected = identify.response.ok ? choosePackage(part, identify.payload) : null;
  steps.push({ route: "/api/identify", status: identify.response.status, code: codeOf(identify.payload), needs: [], submitted: [], error: errorOf(identify.payload) });
  const lookup = await jsonRequest(`${BASE}/api/lookup`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ partNumber: part.partNumber, manufacturer: part.manufacturer, intent: "cad", ...(selected ? { packageType: selected } : {}), settings: { densityLevel: "B", footprintSource: "manufacturer" } })
  });
  steps.push({ route: "/api/lookup", status: lookup.response.status, code: codeOf(lookup.payload), needs: needsOf(lookup.payload), submitted: selected ? ["packageType"] : [], error: errorOf(lookup.payload) });
  const lookupSelected = selected ?? choosePackage(part, lookup.payload);
  if (lookup.response.ok && lookup.payload.part && typeof lookup.payload.part === "object" && (!part.packageHint || lookupSelected)) {
    return { payload: lookup.payload, selected: lookupSelected, steps, pdf: null };
  }
  const pdf = await officialPdf(part);
  if (!pdf) return { payload: null, selected, steps, pdf: null };
  const form = new FormData();
  form.append("file", pdf);
  if (selected ?? part.packageHint) form.append("packageType", selected ?? part.packageHint!);
  form.append("settings", JSON.stringify({ densityLevel: "B", footprintSource: "manufacturer" }));
  const upload = await jsonRequest(`${BASE}/api/parse`, { method: "POST", body: form });
  steps.push({ route: "/api/parse", status: upload.response.status, code: codeOf(upload.payload), needs: needsOf(upload.payload), submitted: ["file", ...(selected ?? part.packageHint ? ["packageType"] : [])], error: errorOf(upload.payload) });
  return {
    payload: upload.response.ok && upload.payload.part && typeof upload.payload.part === "object" ? upload.payload : null,
    selected: selected ?? choosePackage(part, upload.payload), steps, pdf
  };
}

async function recoverOfficialPinout(part: UniversePart, selected: string | null, expectedCount: number | null, steps: Step[]): Promise<ImportedFile | null> {
  const discovered = await jsonRequest(
    `${BASE}/api/resources?partNumber=${encodeURIComponent(part.partNumber)}&manufacturer=${encodeURIComponent(part.manufacturer)}${selected ? `&packageType=${encodeURIComponent(selected)}` : ""}`,
    { method: "GET" }
  );
  steps.push({ route: "/api/resources", status: discovered.response.status, code: codeOf(discovered.payload), needs: [], submitted: [], error: errorOf(discovered.payload) });
  const resources = Array.isArray(discovered.payload.resources)
    ? (discovered.payload.resources as Array<{ kind?: unknown; url?: unknown }>).filter((item) => item.kind === "pinout" && typeof item.url === "string")
    : [];
  for (const resource of resources) {
    const imported = await jsonRequest(`${BASE}/api/resources`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: resource.url, manufacturer: part.manufacturer })
    });
    steps.push({ route: "/api/resources", status: imported.response.status, code: codeOf(imported.payload), needs: [], submitted: ["url", "manufacturer"], error: errorOf(imported.payload) });
    if (!imported.response.ok || !Array.isArray(imported.payload.files)) continue;
    const candidates = (imported.payload.files as unknown[]).flatMap((file) => {
      if (!file || typeof file !== "object") return [];
      const value = file as { fileName?: unknown; source?: unknown };
      return typeof value.fileName === "string" && typeof value.source === "string" && /\.(?:bsd|bsdl)$/i.test(value.fileName)
        ? [{ fileName: value.fileName, source: value.source }]
        : [];
    });
    if (candidates.length === 1) return candidates[0];
    const frozenFile = UNIVERSE_ORACLE[part.partNumber]?.e2e?.cad.vendorPinoutFile;
    const frozen = frozenFile ? candidates.filter((candidate) => candidate.fileName === frozenFile) : [];
    if (frozen.length === 1) return frozen[0];
    const packageKey = norm(selected ?? part.packageHint ?? "");
    const matched = packageKey
      ? candidates.filter((candidate) => norm(candidate.fileName).includes(packageKey))
      : [];
    if (matched.length === 1) return matched[0];
    const family = /(?:UFBGA|TFBGA|WLCSP|LQFP|TQFP|QFN|BGA|LGA)/.exec(packageKey)?.[0];
    const countMatched = family && expectedCount
      ? candidates.filter((candidate) => norm(candidate.fileName).includes(family) && norm(candidate.fileName).includes(String(expectedCount)))
      : [];
    if (countMatched.length === 1) return countMatched[0];
  }
  return null;
}

async function exportCad(part: UniversePart, read: Json, selected: string | null, format: "kicad" | "altium", importedPinout: ImportedFile | null = null): Promise<Step[]> {
  const steps: Step[] = [];
  const answers = UNIVERSE_ORACLE[part.partNumber]?.e2e?.cad.answers ?? {};
  const supplied: Record<string, unknown> = {};
  let partRecord = read.part as Json;
  let previous = "";
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const assurance = read.assurance as { findings?: Array<Record<string, unknown>> } | undefined;
    const response = await fetch(`${BASE}/api/export`, {
      method: "POST", headers: { "content-type": "application/json" }, signal: AbortSignal.timeout(REQUEST_MS),
      body: JSON.stringify({ part: partRecord, format, ...(selected ? { packageType: selected } : {}), ...(importedPinout ? { importedPinout } : {}), settings: { densityLevel: "B", footprintSource: "manufacturer" }, assurance: { evaluated: true, findings: (assurance?.findings ?? []).filter((item) => item.state === "review") }, ...supplied })
    });
    if (response.ok) {
      const artifact = `${safe(part.partNumber)}-${format}.zip`;
      writeFileSync(join(RESULTS, artifact), Buffer.from(await response.arrayBuffer()));
      steps.push({ route: "/api/export", status: response.status, code: null, needs: [], submitted: Object.keys(supplied), artifact });
      return steps;
    }
    const payload = await response.json().catch(() => ({})) as Json;
    const needs = needsOf(payload);
    const untraceable = stringsOf(payload, "untraceable");
    const missing = stringsOf(payload, "missing");
    const untraceableValues = Object.fromEntries(untraceable.map((field) => [field, extractedValueAt(partRecord, field)]));
    steps.push({ route: "/api/export", status: response.status, code: codeOf(payload), needs, ...(untraceable.length ? { untraceable, untraceableValues } : {}), ...(missing.length ? { missing } : {}), submitted: Object.keys(supplied), error: errorOf(payload) });
    if (codeOf(payload) === "UNTRACEABLE_EXTRACTION" && untraceable.length > 0) {
      const allowed = UNIVERSE_ORACLE[part.partNumber]?.e2e?.cad.confirm ?? {};
      if (untraceable.every((field) => allowed[field] && JSON.stringify(allowed[field].value) === JSON.stringify(extractedValueAt(partRecord, field)))) {
        for (const field of untraceable) partRecord = confirmField(partRecord, field);
        continue;
      }
    }
    // The product's review panel lets a person correct a value that was read
    // incorrectly before trying export again. Exercise that public request
    // shape too: when the geometry guard identifies a contradiction, submit
    // only the remaining manufacturer-backed values declared by the independent
    // oracle. This is not an automatic product assumption—the receipt records
    // every corrected field as user-supplied, exactly as the browser does.
    if (codeOf(payload) === "FOOTPRINT_INVALID") {
      const corrections = Object.entries(answers).filter(([field]) => supplied[field] === undefined);
      if (corrections.length > 0) {
        for (const [field, answer] of corrections) supplied[field] = answer.value;
        continue;
      }
    }
    if (codeOf(payload) !== "INPUT_REQUIRED" || needs.length === 0) return steps;
    const signature = needs.slice().sort().join(",");
    if (signature === previous) return steps;
    previous = signature;
    let complete = true;
    for (const field of needs) {
      const answer = answers[field];
      if (!answer) complete = false;
      else supplied[field] = answer.value;
    }
    if (!complete) return steps;
  }
  return steps;
}

async function runSpice(part: UniversePart, pdfFromCad: File | null): Promise<Step[]> {
  const steps: Step[] = [];
  const contract = UNIVERSE_ORACLE[part.partNumber]?.e2e?.spice;
  let pdf = pdfFromCad;
  let blockChoice: number | undefined;
  let reviewedClass: string | undefined;
  let corrections: SpiceCorrection[] = [];
  const supplied: Record<string, number | string> = {};
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const form = new FormData();
    form.append("partNumber", part.partNumber);
    form.append("manufacturer", part.manufacturer);
    form.append("response", "json");
    if (pdf) form.append("file", pdf);
    if (blockChoice !== undefined) form.append("blockChoice", String(blockChoice));
    if (reviewedClass !== undefined) form.append("reviewDeviceClass", reviewedClass);
    if (corrections.length > 0) form.append("corrections", JSON.stringify(corrections.map(({ source: _source, ...correction }) => correction)));
    for (const [field, value] of Object.entries(supplied)) form.append(`supplied.${field}`, String(value));
    const { response, payload } = await jsonRequest(`${BASE}/api/model`, { method: "POST", body: form });
    const asks = Array.isArray(payload.asks) ? payload.asks.flatMap((item) => item && typeof item === "object" && "field" in item ? [String((item as { field: unknown }).field)] : []) : [];
    const correctionNeeds = Array.isArray(payload.correctionNeeds) ? payload.correctionNeeds.flatMap((item) => item && typeof item === "object" && "parameter" in item ? [String((item as { parameter: unknown }).parameter)] : []) : [];
    const submitted = [...(pdf ? ["file"] : []), ...(blockChoice !== undefined ? ["blockChoice"] : []), ...(reviewedClass !== undefined ? ["reviewDeviceClass"] : []), ...corrections.map((item) => `correction.${item.parameter}`), ...Object.keys(supplied).map((field) => `supplied.${field}`)];
    if (response.ok && typeof payload.zipBase64 === "string") {
      const artifact = `${safe(part.partNumber)}-spice.zip`;
      writeFileSync(join(RESULTS, artifact), Buffer.from(payload.zipBase64, "base64"));
      steps.push({ route: "/api/model", status: response.status, code: null, needs: [], submitted, artifact });
      return steps;
    }
    const choices = Array.isArray(payload.blockChoices) ? payload.blockChoices : Array.isArray(payload.correctionOptions) ? payload.correctionOptions : undefined;
    steps.push({ route: "/api/model", status: response.status, code: codeOf(payload), needs: asks, correctionNeeds, ...(choices ? { choices } : {}), submitted, error: errorOf(payload) });
    if (!pdf && response.status === 404) {
      pdf = await officialPdf(part);
      if (pdf) continue;
    }
    if (codeOf(payload) === "MODEL_SELECTION_REQUIRED" && contract?.blockChoice !== undefined && blockChoice === undefined) {
      blockChoice = contract.blockChoice;
      continue;
    }
    if (codeOf(payload) === "INCOMPLETE_EXTRACTION" && correctionNeeds.length > 0) {
      const available = contract?.corrections ?? [];
      const selected = correctionNeeds.map((parameter) => available.find((item) => item.parameter === parameter));
      if (selected.every((item) => item !== undefined)) {
        corrections = selected as SpiceCorrection[];
        if (contract?.reviewedClass) reviewedClass = contract.reviewedClass;
        continue;
      }
    }
    if (codeOf(payload) === "INCOMPLETE_EXTRACTION" && contract?.reviewedClass && reviewedClass === undefined && Array.isArray(payload.correctionOptions)) {
      reviewedClass = contract.reviewedClass;
      corrections = contract.corrections ?? [];
      continue;
    }
    if (asks.length > 0) {
      let complete = true;
      for (const field of asks) {
        const answer = contract?.supplied?.[field];
        if (!answer) complete = false;
        else supplied[field] = answer.value;
      }
      if (complete) continue;
    }
    if (contract?.terminal === "vendor") return [...steps, ...await runVendorSpice(part)];
    return steps;
  }
  return contract?.terminal === "vendor" ? [...steps, ...await runVendorSpice(part)] : steps;
}

async function runVendorSpice(part: UniversePart): Promise<Step[]> {
  const steps: Step[] = [];
  const query = new URLSearchParams({ partNumber: part.partNumber, manufacturer: part.manufacturer });
  const discovery = await jsonRequest(`${BASE}/api/resources?${query}`, { method: "GET" });
  steps.push({ route: "/api/resources", status: discovery.response.status, code: codeOf(discovery.payload), needs: [], submitted: [], error: errorOf(discovery.payload) });
  const resources = (Array.isArray(discovery.payload.resources) ? discovery.payload.resources : [])
    .filter((item): item is { kind: string; url: string } => Boolean(item && typeof item === "object" && (item as { kind?: unknown }).kind === "spice" && typeof (item as { url?: unknown }).url === "string"));
  for (const resource of resources) {
    const imported = await jsonRequest(`${BASE}/api/resources`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: resource.url, manufacturer: part.manufacturer })
    });
    const files = (Array.isArray(imported.payload.files) ? imported.payload.files : [])
      .filter((item): item is { fileName: string; source: string } => Boolean(item && typeof item === "object" && typeof (item as { fileName?: unknown }).fileName === "string" && typeof (item as { source?: unknown }).source === "string"));
    steps.push({ route: "/api/resources", status: imported.response.status, code: codeOf(imported.payload), needs: [], submitted: ["resource.url"], error: errorOf(imported.payload) });
    for (const file of files) {
      let candidate: string | undefined;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const form = new FormData();
        form.append("partNumber", part.partNumber);
        form.append("manufacturer", part.manufacturer);
        form.append("response", "json");
        form.append("vendorModel", new File([file.source], file.fileName, { type: "text/plain" }));
        if (candidate) form.append("vendorCandidate", candidate);
        const response = await jsonRequest(`${BASE}/api/model`, { method: "POST", body: form });
        if (response.response.ok && typeof response.payload.zipBase64 === "string") {
          const artifact = `${safe(part.partNumber)}-spice.zip`;
          writeFileSync(join(RESULTS, artifact), Buffer.from(response.payload.zipBase64, "base64"));
          steps.push({ route: "/api/model", status: 200, code: null, needs: [], submitted: ["vendorModel", ...(candidate ? ["vendorCandidate"] : [])], artifact });
          return steps;
        }
        steps.push({ route: "/api/model", status: response.response.status, code: codeOf(response.payload), needs: [], submitted: ["vendorModel", ...(candidate ? ["vendorCandidate"] : [])], error: errorOf(response.payload) });
        if (codeOf(response.payload) !== "VENDOR_SELECTION_REQUIRED" || candidate) break;
        const candidates = Array.isArray(response.payload.vendorCandidates) ? response.payload.vendorCandidates as Array<{ id?: string; name?: string }> : [];
        const matching = candidates.filter((item) => item.id && norm(item.name ?? "").includes(norm(part.partNumber)));
        if (matching.length !== 1) break;
        candidate = matching[0].id;
      }
    }
  }
  return steps;
}

async function responds(): Promise<boolean> {
  try { return (await fetch(`${BASE}/api/config`, { signal: AbortSignal.timeout(2_000) })).ok; } catch { return false; }
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

async function main(): Promise<void> {
  const corpus = ONLY_PART ? UNIVERSE_CORPUS.filter((part) => norm(part.partNumber) === norm(ONLY_PART)) : UNIVERSE_CORPUS;
  if (corpus.length === 0) throw new Error(`No frozen universe part matches ${ONLY_PART}.`);
  console.log(`\nEnd-to-end black-box universe: ${corpus.length} part(s), up to 7 paid reads per part before recovery retries.`);
  if (ESTIMATE) return;
  mkdirSync(RESULTS, { recursive: true });
  let server: ChildProcess | null = null;
  if (!process.env.FORGE_UNIVERSE_E2E_BASE_URL) {
    if (await responds()) throw new Error(`Port ${PORT} is already occupied.`);
    const log = openSync(join(RESULTS, "server.log"), "a");
    server = spawn("npx", ["next", "start", "-p", String(PORT)], { cwd: ROOT, env: { ...process.env, PORT: String(PORT) }, stdio: ["ignore", log, log], detached: true });
    if (!(await waitForServer())) throw new Error("The production server did not become ready.");
  }
  try {
    for (const [index, part] of corpus.entries()) {
      if (!FRESH && existsSync(pathOf(part))) {
        console.log(`${index + 1}/${corpus.length} ${part.partNumber}: cached journey`);
        continue;
      }
      for (const suffix of ["kicad", "altium", "spice"]) {
        const artifact = join(RESULTS, `${safe(part.partNumber)}-${suffix}.zip`);
        if (existsSync(artifact)) unlinkSync(artifact);
      }
      console.log(`${index + 1}/${corpus.length} ${part.partNumber}: search/upload → answer → artifact`);
      const read = await readCad(part);
      const journey: Journey = {
        partNumber: part.partNumber, manufacturer: part.manufacturer,
        source: UNIVERSE_ORACLE[part.partNumber]?.source ?? "", selectedPackage: read.selected,
        cad: { read: read.steps, kicad: [], altium: [] }, spice: []
      };
      if (read.payload) {
        const readPart = read.payload.part as Json;
        const pinField = readPart?.pins as Json | undefined;
        const packageEntries = Array.isArray(readPart?.packagesInThisDocument)
          ? readPart.packagesInThisDocument as Json[]
          : [];
        const selectedEntry = read.selected
          ? packageEntries.find((entry) =>
              norm(String(entry.packageType ?? "")) === norm(read.selected!) ||
              (Array.isArray(entry.alsoKnownAs) && entry.alsoKnownAs.some((name) => norm(String(name)) === norm(read.selected!)))
            )
          : undefined;
        const selectedPins = selectedEntry && Array.isArray(selectedEntry.pins) ? selectedEntry.pins : null;
        const needsPins = selectedPins
          ? selectedPins.length === 0
          : !Array.isArray(pinField?.value) || pinField.value.length === 0;
        const countField = readPart?.pinCount as Json | undefined;
        const expectedCount = selectedPins?.length ?? (typeof countField?.value === "number" ? countField.value : null);
        const importedPinout = needsPins ? await recoverOfficialPinout(part, read.selected, expectedCount, journey.cad.read) : null;
        journey.cad.kicad = await exportCad(part, read.payload, read.selected, "kicad", importedPinout);
        journey.cad.altium = await exportCad(part, read.payload, read.selected, "altium", importedPinout);
      }
      journey.spice = await runSpice(part, read.pdf);
      writeFileSync(pathOf(part), `${JSON.stringify(journey, null, 2)}\n`);
    }
  } finally {
    stop(server);
  }
  console.log(`Journeys written to ${RESULTS}`);
}

void main();
