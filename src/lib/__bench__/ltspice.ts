/**
 * Runs one emitted model from every shipped class in the CUSTOMER'S simulator.
 * This is deliberately separate from `bench:model`: ngspice measures behaviour;
 * LTspice proves the files we hand over are accepted by the tool that consumes
 * them. Set LTSPICE_BIN to the executable extracted from Analog Devices' pkg.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { buildModel } from "../spice/build";
import { inspectVendorModel, VENDOR_PRIMITIVE_TERMINALS, wrapVendorCandidate } from "../spice/vendor";

const CASES = [
  { part: "OPA333", klass: "opamp", circuit: ["VCC VCC 0 5", "VEE VEE 0 0", "VINP INP 0 2.6", "VINN INN 0 2.5", "XU INP INN OUT VCC VEE OPA333", "RLOAD OUT 0 10k"] },
  { part: "LM139AQML-SP", klass: "comparator", circuit: ["VCC VCC 0 5", "VEE VEE 0 0", "VINP INP 0 2.6", "VINN INN 0 2.5", "XU INP INN OUT VCC VEE LM139AQML_SP", "RLOAD VCC OUT 10k"] },
  { part: "REF5025", klass: "reference", circuit: ["VIN IN 0 5", "XU IN OUT 0 REF5025", "RLOAD OUT 0 10k"] },
  { part: "L7805", klass: "ldo", circuit: ["VIN IN 0 12", "XU IN OUT 0 L7805", "RLOAD OUT 0 1k"] }
] as const;

/** One minimal, official-LTspice model card for every adapter contract. */
const PRIMITIVE_CASES: Readonly<Record<string, { source: string; instanceValue?: string }>> = {
  R: { source: ".model M_R R(TC1=.001)", instanceValue: "1k" },
  C: { source: ".model M_C C(TC1=.001)", instanceValue: "1u" },
  D: { source: ".model M_D D(Is=1e-12 N=1)" },
  NPN: { source: ".model M_NPN NPN(Bf=100)" },
  PNP: { source: ".model M_PNP PNP(Bf=100)" },
  NJF: { source: ".model M_NJF NJF(Vto=-2 Beta=1m)" },
  PJF: { source: ".model M_PJF PJF(Vto=2 Beta=1m)" },
  NMF: { source: ".model M_NMF NMF(Vto=-2 Beta=1m)" },
  PMF: { source: ".model M_PMF PMF(Vto=2 Beta=1m)" },
  NMOS: { source: ".model M_NMOS NMOS(Vto=2 Kp=1m)" },
  PMOS: { source: ".model M_PMOS PMOS(Vto=-2 Kp=1m)" },
  VDMOS: { source: ".model M_VDMOS VDMOS(Vto=2 Kp=1)" },
  NIGBT: { source: ".model M_NIGBT NIGBT" },
  SW: { source: ".model M_SW SW(Ron=.1 Roff=1Meg Vt=.5)" },
  CSW: { source: ".model M_CSW CSW(Ron=.1 Roff=1Meg It=.1)" },
  LTRA: { source: ".model M_LTRA LTRA(len=1 R=1 L=1u G=0 C=1n)" },
  URC: { source: ".model M_URC URC(K=2 Fmax=1Meg)", instanceValue: "0.01" }
};

const LARGE_SUBCIRCUIT_TERMINALS = Array.from({ length: 128 }, (_, index) => `T${index + 1}`);

async function main(): Promise<void> {
  const vendorOnly = process.argv.includes("--vendor-only");
  const executable = process.env.LTSPICE_BIN;
  if (!executable || !fs.existsSync(executable)) {
    console.error("LTSPICE_BIN must name a real LTspice executable.");
    process.exitCode = 2;
    return;
  }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "forge-ltspice-"));
  const failures: string[] = [];
  try {
    for (const one of vendorOnly ? [] : CASES) {
      const pdfPath = path.join(process.cwd(), ".bench-cache", `${one.part}.pdf`);
      if (!fs.existsSync(pdfPath)) {
        failures.push(`${one.part}: cached datasheet is absent`);
        continue;
      }
      const pdf = fs.readFileSync(pdfPath);
      const result = await buildModel(pdf.buffer.slice(pdf.byteOffset, pdf.byteOffset + pdf.byteLength) as ArrayBuffer, one.part);
      if (!result.subckt || result.deviceClass?.id !== one.klass) {
        failures.push(`${one.part}: no ${one.klass} model was built`);
        continue;
      }
      const folder = path.join(root, one.part.replace(/[^A-Za-z0-9._-]/g, "_"));
      fs.mkdirSync(folder);
      fs.writeFileSync(path.join(folder, "model.lib"), result.subckt);
      fs.writeFileSync(path.join(folder, "case.net"), [
        `* Forge LTspice acceptance: ${one.part}`,
        ".include model.lib",
        ...one.circuit,
        ".op",
        ".end",
        ""
      ].join("\n"));
      const run = spawnSync(executable, ["-b", "case.net"], { cwd: folder, encoding: "utf8", timeout: 30_000 });
      const logPath = path.join(folder, "case.log");
      const log = fs.existsSync(logPath) ? fs.readFileSync(logPath).toString("utf16le") : "";
      const rejected = run.status !== 0 || /fatal error|unknown subckt|missing node|syntax error/i.test(`${run.stderr}\n${log}`);
      console.log(`${one.part.padEnd(16)} ${rejected ? "REJECTED" : "accepted"}`);
      if (rejected) failures.push(`${one.part}: ${run.stderr || log.slice(0, 500) || `exit ${run.status}`}`);
    }
    const vendorCases: Array<{ part: string; source: string; circuit: string[] }> = [
      {
        part: "GENERIC",
        source: `.subckt 2N_BIG ${LARGE_SUBCIRCUIT_TERMINALS.join(" ")}\nR1 T1 T2 1k\n.ends 2N_BIG\n`,
        circuit: [
          "V1 N1 0 0",
          `XU ${LARGE_SUBCIRCUIT_TERMINALS.map((_, index) => index === 0 ? "N1" : "0").join(" ")} GENERIC_FORGE`
        ]
      },
    ];
    const declaredTypes = Object.keys(VENDOR_PRIMITIVE_TERMINALS).sort();
    const exercisedTypes = Object.keys(PRIMITIVE_CASES).sort();
    if (declaredTypes.join("\n") !== exercisedTypes.join("\n")) {
      failures.push(`primitive adapter gate is out of sync: declared ${declaredTypes.join(", ")}; exercised ${exercisedTypes.join(", ")}`);
    }
    for (const [modelType, primitive] of Object.entries(PRIMITIVE_CASES)) {
      const terminals = VENDOR_PRIMITIVE_TERMINALS[modelType];
      const nodes: string[] = terminals.map((_, index) => index === 0 ? "N1" : "0");
      const support = ["Vtest N1 0 0"];
      if (modelType === "CSW") {
        nodes[2] = "NCTRL";
        support.push("Rcontrol NCTRL 0 1");
      }
      vendorCases.push({
        part: modelType,
        source: `${primitive.source}\n`,
        circuit: [
          ...support,
          `XU ${nodes.join(" ")} ${modelType}_FORGE`
        ]
      });
    }
    for (const one of vendorCases) {
      const [candidate] = inspectVendorModel(one.source);
      if (!candidate) {
        failures.push(`${one.part}: vendor declaration was not inspected`);
        continue;
      }
      const adapter = wrapVendorCandidate(candidate, "vendor.lib", one.part, PRIMITIVE_CASES[one.part]?.instanceValue);
      const folder = path.join(root, `vendor-${one.part}`);
      fs.mkdirSync(folder);
      fs.writeFileSync(path.join(folder, "vendor.lib"), one.source);
      fs.writeFileSync(path.join(folder, "adapter.lib"), adapter.text);
      fs.writeFileSync(path.join(folder, "case.net"), [
        `* Forge LTspice vendor-adapter acceptance: ${one.part}`,
        ".include adapter.lib",
        ...one.circuit,
        ".op",
        ".end",
        ""
      ].join("\n"));
      const run = spawnSync(executable, ["-b", "case.net"], { cwd: folder, encoding: "utf8", timeout: 30_000 });
      const logPath = path.join(folder, "case.log");
      const log = fs.existsSync(logPath) ? fs.readFileSync(logPath).toString("utf16le") : "";
      const rejected = run.status !== 0 || /fatal error|unknown subckt|unknown device|unrecognized|missing node|syntax error|can't find definition/i.test(`${run.stderr}\n${log}`);
      console.log(`${`vendor ${one.part}`.padEnd(16)} ${rejected ? "REJECTED" : "accepted"}`);
      if (rejected) failures.push(`${one.part}: ${run.stderr || log.slice(0, 500) || `exit ${run.status}`}`);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
  if (failures.length > 0) {
    for (const failure of failures) console.error(failure);
    process.exitCode = 1;
  }
}

void main();
