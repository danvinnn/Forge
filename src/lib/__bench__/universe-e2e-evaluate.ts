/** Independent evaluator for the multi-turn black-box journeys. */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import JSZip from "jszip";
import { UNIVERSE_CORPUS } from "./universe-corpus";
import { UNIVERSE_ORACLE } from "./universe-oracle";

const RESULTS = join(process.cwd(), ".universe-e2e-results");
const safe = (value: string) => value.replace(/[^A-Za-z0-9._-]+/g, "_");
const norm = (value: string) => value.toUpperCase().replace(/[^A-Z0-9]/g, "");
const standardPackageName = (value: string) => {
  const key = norm(value);
  // JEDEC DO-204AL is the registered outline commonly sold as DO-41. Every
  // unknown designation remains literal; only this formal alias is unified.
  return key.includes("DO204AL") || key.includes("DO41") ? "DO204AL" : key;
};
interface Step { route?: string; status: number; code: string | null; needs: string[]; submitted: string[]; correctionNeeds?: string[]; choices?: unknown[]; untraceable?: string[]; missing?: string[]; artifact?: string; error?: string | null }
interface Journey { partNumber: string; selectedPackage: string | null; cad: { read: Step[]; kicad: Step[]; altium: Step[] }; spice: Step[] }
interface Finding { severity: "P0" | "P1"; part: string; detail: string }
interface ExpectedTerminalPad { number: string; xMm: number; yMm: number; widthMm: number; heightMm: number; shape: string }

const last = (steps: Step[]) => steps.at(-1);
const shipped = (steps: Step[]) => last(steps)?.status === 200 && Boolean(last(steps)?.artifact);

function questionFindings(partNumber: string, steps: Step[], allowed: Set<string>, prefix = ""): Finding[] {
  const findings: Finding[] = [];
  for (const [index, step] of steps.entries()) {
    for (const field of step.needs) {
      if (!allowed.has(field)) findings.push({ severity: "P0", part: partNumber, detail: `${prefix} asked ${field}, but the independent oracle has no authoritative answer for it.` });
      const later = steps.slice(index + 1).some((candidate) => candidate.submitted.includes(`${prefix === "SPICE" ? "supplied." : ""}${field}`));
      if (!later) findings.push({ severity: "P1", part: partNumber, detail: `${prefix} question ${field} was never answered through the public route.` });
    }
    if (index > 0 && step.needs.length > 0 && step.needs.slice().sort().join() === steps[index - 1].needs.slice().sort().join()) {
      findings.push({ severity: "P0", part: partNumber, detail: `${prefix} repeated the same question after its answer was submitted.` });
    }
  }
  return findings;
}

function correctionFindings(partNumber: string, steps: Step[], allowed: Set<string>): Finding[] {
  const findings: Finding[] = [];
  for (const [index, step] of steps.entries()) {
    for (const parameter of step.correctionNeeds ?? []) {
      if (!allowed.has(parameter)) findings.push({ severity: "P0", part: partNumber, detail: `SPICE requested an unsupported reviewed correction for ${parameter}.` });
      if (!steps.slice(index + 1).some((candidate) => candidate.submitted.includes(`correction.${parameter}`))) {
        findings.push({ severity: "P1", part: partNumber, detail: `SPICE correction ${parameter} was never submitted through the public route.` });
      }
    }
  }
  return findings;
}

const close = (actual: number, expected: number) => Math.abs(actual - expected) <= 0.001;

async function cadArtifactFindings(
  partNumber: string,
  artifact: string,
  expectedPins?: Record<string, string>,
  minimumAuxiliaryPads = 0,
  expectedTerminalPads?: ExpectedTerminalPad[]
): Promise<Finding[]> {
  const findings: Finding[] = [];
  const path = join(RESULTS, artifact);
  if (!existsSync(path)) return [{ severity: "P1", part: partNumber, detail: `Receipt names missing artifact ${artifact}.` }];
  const zip = await JSZip.loadAsync(readFileSync(path));
  const recordName = Object.keys(zip.files).find((name) => /\.json$/i.test(name) && !/manifest\.json$/i.test(name));
  const manifest = zip.file("manifest.json");
  if (!recordName || !manifest) return [{ severity: "P0", part: partNumber, detail: "CAD archive lacks its portable record or release manifest." }];
  const record = JSON.parse(await zip.file(recordName)!.async("string")) as { pinCount: number; pins: Array<{ number: string; name: string }>; exposedPadPin?: { number: string; name: string } | null; footprint?: { arrangement?: string }; dimensions?: { auxiliaryPads?: unknown[] | null; terminalPads?: ExpectedTerminalPad[] | null } };
  const terminals = record.exposedPadPin ? [...record.pins, record.exposedPadPin] : record.pins;
  if (new Set(terminals.map((pin) => pin.number)).size !== terminals.length || record.pins.length !== record.pinCount) {
    findings.push({ severity: "P0", part: partNumber, detail: "CAD archive does not contain exactly one terminal for every declared pin." });
  }
  if (expectedPins) {
    const actual = Object.fromEntries(terminals.map((pin) => [pin.number, norm(pin.name)]));
    const wrong = Object.entries(expectedPins).filter(([number, name]) => actual[number] !== norm(name));
    if (wrong.length) findings.push({ severity: "P0", part: partNumber, detail: `CAD disagrees with independent pin facts: ${wrong.map(([n, v]) => `${n}=${v}`).join(", ")}.` });
  }
  if (partNumber === "ESP32-S3-WROOM-1" && record.footprint?.arrangement !== "tri") {
    findings.push({ severity: "P0", part: partNumber, detail: "The three-sided module was not emitted as a three-sided footprint." });
  }
  if ((record.dimensions?.auxiliaryPads?.length ?? 0) < minimumAuxiliaryPads) {
    findings.push({ severity: "P0", part: partNumber, detail: `CAD record omits required non-numbered board features; expected at least ${minimumAuxiliaryPads}.` });
  }
  if (expectedTerminalPads) {
    if (record.footprint?.arrangement !== "explicit-numbered-lands") {
      findings.push({ severity: "P0", part: partNumber, detail: "CAD did not preserve the independently required explicit numbered-land arrangement." });
    }
    const actual = new Map((record.dimensions?.terminalPads ?? []).map((pad) => [pad.number, pad]));
    const wrong = expectedTerminalPads.filter((expected) => {
      const pad = actual.get(expected.number);
      return !pad || pad.shape !== expected.shape || !close(pad.xMm, expected.xMm) || !close(pad.yMm, expected.yMm) || !close(pad.widthMm, expected.widthMm) || !close(pad.heightMm, expected.heightMm);
    });
    if (actual.size !== expectedTerminalPads.length || wrong.length > 0) {
      findings.push({ severity: "P0", part: partNumber, detail: `CAD portable record disagrees with the independent numbered-land geometry${wrong.length ? ` at terminal(s) ${wrong.map((pad) => pad.number).join(", ")}` : ""}.` });
    }
    if (/-kicad\.zip$/i.test(artifact)) {
      const footprintName = Object.keys(zip.files).find((name) => /\.kicad_mod$/i.test(name));
      const footprint = footprintName ? await zip.file(footprintName)!.async("string") : "";
      const emitted = new Map<string, ExpectedTerminalPad>();
      for (const line of footprint.split("\n")) {
        const match = /\(pad\s+"([^"]+)"\s+smd\s+(rect|roundrect|circle|oval)\s+\(at\s+(-?[\d.]+)\s+(-?[\d.]+)(?:\s+-?[\d.]+)?\)\s+\(size\s+([\d.]+)\s+([\d.]+)\)/.exec(line.trim());
        if (match) emitted.set(match[1], { number: match[1], shape: match[2], xMm: Number(match[3]), yMm: Number(match[4]), widthMm: Number(match[5]), heightMm: Number(match[6]) });
      }
      const wrongEmitted = expectedTerminalPads.filter((expected) => {
        const pad = emitted.get(expected.number);
        return !pad || pad.shape !== expected.shape || !close(pad.xMm, expected.xMm) || !close(pad.yMm, expected.yMm) || !close(pad.widthMm, expected.widthMm) || !close(pad.heightMm, expected.heightMm);
      });
      if (wrongEmitted.length > 0) {
        findings.push({ severity: "P0", part: partNumber, detail: `KiCad copper disagrees with the independent numbered-land geometry at terminal(s) ${wrongEmitted.map((pad) => pad.number).join(", ")}.` });
      }
    }
  }
  if (minimumAuxiliaryPads > 0 && /-kicad\.zip$/i.test(artifact)) {
    const footprintName = Object.keys(zip.files).find((name) => /\.kicad_mod$/i.test(name));
    const footprint = footprintName ? await zip.file(footprintName)!.async("string") : "";
    const emitted = (footprint.match(/\(pad\s+""\s+/g) ?? []).length;
    if (emitted < minimumAuxiliaryPads) {
      findings.push({ severity: "P0", part: partNumber, detail: `KiCad footprint emits ${emitted} non-numbered board features; expected at least ${minimumAuxiliaryPads}.` });
    }
  }
  return findings;
}

async function spiceArtifactFindings(partNumber: string, artifact: string, expectedClass: string | undefined, vendor: boolean, supplied: Array<number | string>): Promise<Finding[]> {
  const path = join(RESULTS, artifact);
  if (!existsSync(path)) return [{ severity: "P1", part: partNumber, detail: `Receipt names missing artifact ${artifact}.` }];
  const zip = await JSZip.loadAsync(readFileSync(path));
  const libName = Object.keys(zip.files).find((name) => /\.lib$/i.test(name));
  const receiptName = Object.keys(zip.files).find((name) => /(?:conformance|receipt|vendor-structural).*\.txt$/i.test(name));
  if (!libName || !receiptName) return [{ severity: "P0", part: partNumber, detail: "SPICE archive lacks its model or release receipt." }];
  const [lib, receipt] = await Promise.all([zip.file(libName)!.async("string"), zip.file(receiptName)!.async("string")]);
  const combined = `${lib}\n${receipt}`.toLowerCase();
  const findings: Finding[] = [];
  if (expectedClass && !combined.includes(expectedClass.toLowerCase())) findings.push({ severity: "P0", part: partNumber, detail: `SPICE artifact does not identify the required ${expectedClass} topology.` });
  if (vendor && !/vendor|structural/.test(combined)) findings.push({ severity: "P0", part: partNumber, detail: "Vendor-model artifact is not disclosed as a vendor/structural adaptation." });
  if (!vendor && !/generated by forge|behaviou?ral/.test(combined)) findings.push({ severity: "P0", part: partNumber, detail: "Generated-model artifact does not disclose its generated behavioral origin." });
  for (const value of supplied) {
    if (!combined.includes(String(value).toLowerCase())) findings.push({ severity: "P0", part: partNumber, detail: `SPICE artifact does not contain the supplied value ${value}.` });
  }
  return findings;
}

async function main(): Promise<void> {
  const findings: Finding[] = [];
  let completed = 0;
  let cadShipped = 0;
  let spiceShipped = 0;
  for (const part of UNIVERSE_CORPUS) {
    const oracle = UNIVERSE_ORACLE[part.partNumber];
    const path = join(RESULTS, `${safe(part.partNumber)}.json`);
    if (!oracle?.e2e) {
      findings.push({ severity: "P1", part: part.partNumber, detail: "No independent end-to-end contract exists." });
      continue;
    }
    if (!existsSync(path)) {
      findings.push({ severity: "P1", part: part.partNumber, detail: "No end-to-end journey receipt exists." });
      continue;
    }
    completed += 1;
    const journey = JSON.parse(readFileSync(path, "utf8")) as Journey;
    if (oracle.packageMustInclude && !standardPackageName(journey.selectedPackage ?? "").includes(standardPackageName(oracle.packageMustInclude))) {
      findings.push({ severity: shipped(journey.cad.kicad) && shipped(journey.cad.altium) ? "P0" : "P1", part: part.partNumber, detail: `Selected package ${journey.selectedPackage ?? "none"} does not match the independent ${oracle.packageMustInclude} package contract.` });
    }
    const cadAllowed = new Set(Object.keys(oracle.e2e.cad.answers ?? {}));
    findings.push(...questionFindings(part.partNumber, journey.cad.kicad, cadAllowed, "CAD"));
    findings.push(...questionFindings(part.partNumber, journey.cad.altium, cadAllowed, "CAD"));
    const bothCad = shipped(journey.cad.kicad) && shipped(journey.cad.altium);
    if (bothCad) cadShipped += 1;
    if (oracle.e2e.cad.terminal === "ship" && !bothCad) {
      const end = last(journey.cad.kicad) ?? last(journey.cad.read);
      findings.push({ severity: "P1", part: part.partNumber, detail: `CAD did not reach both artifacts after available answers (${end?.code ?? end?.status ?? "no response"}: ${end?.error ?? ""}).` });
    }
    for (const steps of [journey.cad.kicad, journey.cad.altium]) {
      const artifact = last(steps)?.artifact;
      if (artifact) {
        const terminalPads = oracle.e2e.cad.answers?.terminalPads?.value;
        findings.push(...await cadArtifactFindings(
          part.partNumber,
          artifact,
          oracle.pins,
          oracle.e2e.cad.minimumAuxiliaryPads,
          Array.isArray(terminalPads) ? terminalPads as ExpectedTerminalPad[] : undefined
        ));
      }
    }

    const spiceAllowed = new Set(Object.keys(oracle.e2e.spice.supplied ?? {}));
    findings.push(...questionFindings(part.partNumber, journey.spice, spiceAllowed, "SPICE"));
    findings.push(...correctionFindings(part.partNumber, journey.spice, new Set((oracle.e2e.spice.corrections ?? []).map((item) => item.parameter))));
    const spiceMade = shipped(journey.spice);
    if (spiceMade) spiceShipped += 1;
    if ((oracle.e2e.spice.terminal === "generated" || oracle.e2e.spice.terminal === "vendor") && !spiceMade) {
      const end = last(journey.spice);
      findings.push({ severity: "P1", part: part.partNumber, detail: `SPICE did not reach the required ${oracle.e2e.spice.terminal} artifact (${end?.code ?? end?.status ?? "no response"}: ${end?.error ?? ""}).` });
    }
    const selection = journey.spice.findIndex((step) => step.code === "MODEL_SELECTION_REQUIRED");
    if (selection >= 0) {
      if (oracle.e2e.spice.blockChoice === undefined) findings.push({ severity: "P0", part: part.partNumber, detail: "SPICE asked for a specification-block choice absent from the independent contract." });
      else if (!journey.spice.slice(selection + 1).some((step) => step.submitted.includes("blockChoice"))) findings.push({ severity: "P1", part: part.partNumber, detail: "SPICE block choice was not accepted through the public route." });
    }
    const finalArtifact = last(journey.spice)?.artifact;
    if (finalArtifact) findings.push(...await spiceArtifactFindings(
      part.partNumber,
      finalArtifact,
      oracle.spiceClass,
      oracle.e2e.spice.terminal === "vendor",
      Object.values(oracle.e2e.spice.supplied ?? {}).map((item) => item.value)
    ));
    if (oracle.e2e.spice.terminal === "honest-refusal" && spiceMade) {
      findings.push({ severity: "P0", part: part.partNumber, detail: "SPICE shipped where the oracle permits only an honest refusal." });
    }
    if (oracle.e2e.spice.terminal === "honest-refusal") {
      const end = last(journey.spice);
      if (!end || end.status !== 422 || end.needs.length > 0 || !["INCOMPLETE_EXTRACTION", "MODEL_CONFORMANCE_FAILED"].includes(end.code ?? "")) {
        findings.push({ severity: "P1", part: part.partNumber, detail: "SPICE did not end in a specific, question-free honest refusal." });
      }
      if (journey.spice.some((step) => (step.choices?.length ?? 0) > 0)) {
        findings.push({ severity: "P1", part: part.partNumber, detail: "SPICE offered a device/specification choice even though no answer can unlock a supported model." });
      }
    }
  }
  console.log(`\nMulti-turn black-box universe: ${completed}/${UNIVERSE_CORPUS.length} journeys`);
  console.log(`CAD shipped both formats: ${cadShipped}/${UNIVERSE_CORPUS.length}`);
  console.log(`SPICE artifacts: ${spiceShipped}/${UNIVERSE_CORPUS.length}`);
  console.log(`Findings: ${findings.filter((item) => item.severity === "P0").length} P0, ${findings.filter((item) => item.severity === "P1").length} P1\n`);
  for (const finding of findings) console.log(`${finding.severity} ${finding.part}: ${finding.detail}`);
  if (findings.length > 0) throw new Error("End-to-end black-box universe gate failed.");
}

void main();
