/**
 * SIMULATING THE MODEL AND COMPARING IT AGAINST THE DATASHEET.
 *
 * This is the one thing this product can do for a SPICE model that it can never
 * do for a footprint: TEST THE OUTPUT. A land pattern can only be shipped on two
 * readings and hope, because verifying it would mean building the board. A model
 * is executable, so we can run it and measure whether it does what the document
 * says.
 *
 * ## Conformance is NOT confirmation, and conflating them would be a lie
 *
 * RULES.md 7 asks whether a value was READ correctly, and is answered by two
 * independent readings of the document. This file asks whether the emitted model
 * EXHIBITS the value that was read. A model built from a misread number will
 * reproduce that misread number perfectly, so nothing here can confirm a
 * reading. It belongs with `validateGeometry` as a gate on the output.
 *
 * ## Three verdicts, because two would accuse correct models
 *
 * Measured on OPA333: its slew rate is specified as `G = +1` and nothing else.
 * No step size, no load. Two engineers measuring that from what the document
 * prints would get different answers, and so would we. Reporting that as a
 * FAILURE would blame the model for the datasheet's silence, so there is a third
 * verdict for it.
 */

import { spawn } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { usableAt, valueAt, type ModelBlock, type ModelParameter } from "./model";
import { toSpice } from "./units";
import { spiceName } from "./emit";

export type Verdict = "pass" | "fail" | "unverifiable";

export interface Check {
  parameter: ModelParameter;
  corner: "typ" | "min" | "max";
  /** What the datasheet says, in SI. */
  expected: number;
  /** What the simulation measured, in SI. Null when it could not be measured. */
  measured: number | null;
  verdict: Verdict;
  /** Present on anything that is not a plain pass. */
  reason?: string;
  errorPct: number | null;
}

export interface ConformanceReport {
  checks: Check[];
  /** True when ngspice could not be run at all. */
  simulatorMissing: boolean;
}

/**
 * How close counts as a match.
 *
 * Not a tuned number: it is the precision a datasheet itself offers. Values are
 * printed to two or three significant figures, so agreement closer than about a
 * percent is not meaningful and demanding it would fail correct models.
 */
export const TOLERANCE_PCT = 2;

/** Parameters that can be measured from a small-signal or DC analysis. */
const MEASURABLE: ModelParameter[] = ["openLoopGain", "gbw", "offsetVoltage", "quiescentCurrent"];

/**
 * Slew rate is deliberately absent from `MEASURABLE`.
 *
 * A generic rig measuring it is defeated by capacitive feedthrough: a fast edge
 * couples through the amplifier's own open-loop output impedance before the loop
 * can respond, and a naive threshold crossing reports the spike. Measured on
 * OPA333, that reads 4 V/us for a 0.16 V/us part. Reproducing the datasheet's
 * own test circuit is required and the datasheet does not print one.
 *
 * So it is reported `unverifiable` rather than measured badly, and this comment
 * is here so nobody adds it back without solving that.
 */
const UNVERIFIABLE_REASON = "the datasheet does not state enough of the test circuit to reproduce this measurement";

function deck(subckt: string, name: string, corner: number, aolGuess: number, gbwGuess: number, loadCapF: number | null): string {
  // Aol must be measured BELOW the dominant pole, and the pole is at gbw/Aol.
  // A fixed low frequency silently under-reports gain on exactly the high-gain
  // precision parts this product is aimed at: measured on AD8628, a rig fixed
  // at 0.1 Hz read 143.2 dB against a true 145 dB because the pole sits at
  // 0.14 Hz. Two decades below the pole is far enough to be on the asymptote.
  const pole = gbwGuess / Math.max(aolGuess, 1);
  const start = Math.max(pole / 100, 1e-6);
  const load = loadCapF === null ? "" : `CL out 0 ${toSpice(loadCapF)}\n`;
  return [
    `* Forge conformance deck for ${name}, corner ${corner}`,
    subckt,
    `Xol inp inn out vcc vee ${name} CORNER=${corner}`,
    "Vin inp 0 DC 0 AC 1",
    "Lf out inn 1T",
    "Cf inn 0 1T",
    "RL out 0 10k",
    load,
    `Xfo 0 fo fo vcc2 vee2 ${name} CORNER=${corner}`,
    "Vcc vcc 0 DC 2.5",
    "Vee vee 0 DC -2.5",
    "Vcc2 vcc2 0 DC 2.5",
    "Vee2 vee2 0 DC -2.5",
    ".control",
    `ac dec 40 ${toSpice(start)} ${toSpice(Math.max(gbwGuess * 20, 1e3))}`,
    `meas ac aol_db find vdb(out) at=${toSpice(start)}`,
    "meas ac gbw_hz when vdb(out)=0 fall=1",
    "op",
    "print v(fo)",
    "print i(Vcc2)",
    ".endc",
    ".end",
    ""
  ].join("\n");
}

function parse(output: string, pattern: RegExp): number | null {
  const match = output.match(pattern);
  if (!match) return null;
  const value = Number.parseFloat(match[1]);
  return Number.isFinite(value) ? value : null;
}

export type NgspiceFailure = "missing" | "timeout" | "rejected";

export function ngspiceFailureReason(failure: NgspiceFailure | null): string {
  if (failure === "timeout") return "ngspice did not finish within the 30-second verification budget";
  if (failure === "rejected") return "ngspice rejected the conformance deck";
  return "ngspice is not available on this host";
}

export async function runNgspice(
  file: string,
  options: { executable?: string; args?: string[]; timeoutMs?: number } = {}
): Promise<{ stdout: string; ok: boolean; failure: NgspiceFailure | null }> {
  return new Promise((resolve) => {
    // Production normally resolves ngspice from PATH. Release hosts and CI may
    // keep independently installed tools outside the application PATH, so an
    // explicit executable can be supplied without mutating global process
    // lookup rules.
    const executable = options.executable ?? (process.env.NGSPICE_BIN?.trim() || "ngspice");
    const child = spawn(executable, options.args ?? ["-b", file], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let settled = false;
    const append = (data: unknown) => {
      if (stdout.length < 2_000_000) stdout += String(data).slice(0, 2_000_000 - stdout.length);
    };
    const finish = (result: { stdout: string; ok: boolean; failure: NgspiceFailure | null }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    child.stdout.on("data", append);
    child.stderr.on("data", append);
    child.on("error", () => finish({ stdout, ok: false, failure: "missing" }));
    child.on("close", (code) => finish({ stdout, ok: code === 0, failure: code === 0 ? null : "rejected" }));
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish({ stdout, ok: false, failure: "timeout" });
    }, options.timeoutMs ?? 30_000);
  });
}

/** Pulls a capacitive load out of a condition string, e.g. `CL = 100 pF`. */
export function loadCapacitanceOf(conditions: string | null): number | null {
  if (!conditions) return null;
  const match = conditions.match(/C\s*L?\s*=\s*([\d.]+)\s*([pnuµμm]?)F/i);
  if (!match) return null;
  const scale: Record<string, number> = { p: 1e-12, n: 1e-9, u: 1e-6, "µ": 1e-6, "μ": 1e-6, m: 1e-3, "": 1 };
  const factor = scale[match[2]] ?? 1;
  return Number.parseFloat(match[1]) * factor;
}

/**
 * Runs the model and compares it against the values it was built from.
 *
 * Never throws. A missing simulator reports every check `unverifiable` with the
 * reason, because a product that cannot verify is a worse product and not a
 * broken one.
 */
export async function verify(subckt: string, block: ModelBlock, partNumber: string, corners: Array<"typ" | "min" | "max">): Promise<ConformanceReport> {
  const name = spiceName(partNumber);
  const checks: Check[] = [];
  const directory = await mkdtemp(join(tmpdir(), "forge-spice-"));
  let simulatorMissing = false;

  try {
    for (const corner of corners) {
      const aol = valueAt(block, "openLoopGain", corner);
      const gbw = valueAt(block, "gbw", corner);
      if (aol === null || gbw === null) continue;
      const aolLinear = Math.pow(10, aol / 20);
      const loadCap = loadCapacitanceOf(block.values.gbw?.conditions ?? null);

      const file = join(directory, `${name}-${corner}.cir`);
      await writeFile(file, deck(subckt, name, corner === "typ" ? 1 : corner === "min" ? 2 : 3, aolLinear, gbw, loadCap), "utf8");
      const { stdout, ok, failure } = await runNgspice(file);
      if (!ok) {
        simulatorMissing ||= failure === "missing";
        for (const parameter of MEASURABLE) {
          if (!usableAt(block, parameter, corners)) continue;
          const expected = valueAt(block, parameter, corner);
          if (expected !== null) checks.push({ parameter, corner, expected, measured: null, verdict: "unverifiable", reason: ngspiceFailureReason(failure), errorPct: null });
        }
        for (const parameter of ["slewRate"] as ModelParameter[]) {
          if (!usableAt(block, parameter, corners)) continue;
          const expected = valueAt(block, parameter, corner);
          if (expected !== null) checks.push({ parameter, corner, expected, measured: null, verdict: "unverifiable", reason: UNVERIFIABLE_REASON, errorPct: null });
        }
        continue;
      }

      const measured: Partial<Record<ModelParameter, number | null>> = {
        openLoopGain: parse(stdout, /aol_db\s*=\s*([-\d.eE+]+)/),
        gbw: parse(stdout, /gbw_hz\s*=\s*([-\d.eE+]+)/),
        offsetVoltage: parse(stdout, /v\(fo\)\s*=\s*([-\d.eE+]+)/),
        quiescentCurrent: parse(stdout, /i\(vcc2\)\s*=\s*([-\d.eE+]+)/)
      };

      for (const parameter of MEASURABLE) {
        // ASKED OF THE ONE DEFINITION OF USABLE, which is what the emitter asks.
        //
        // A parameter can have a value at THIS corner and not at every corner,
        // and `usable` is false when any corner is missing. The emitter then
        // writes no element for it while this loop went on measuring it, so the
        // rig read a part with no offset source at all and reported the model
        // as disagreeing with its own datasheet by the whole offset. That is
        // the LMP7704-SP presence-versus-usability defect a second time, in the
        // one other place that had its own idea of when a value counts.
        if (!usableAt(block, parameter, corners)) continue;
        const expected = valueAt(block, parameter, corner);
        if (expected === null) continue;
        let value = measured[parameter] ?? null;
        // The supply current is drawn THROUGH the source, so ngspice reports it
        // negative. Compare magnitudes.
        if (parameter === "quiescentCurrent" && value !== null) value = Math.abs(value);
        if (value === null) {
          checks.push({ parameter, corner, expected, measured: null, verdict: "unverifiable", reason: "the simulation produced no value for this measurement", errorPct: null });
          continue;
        }
        const errorPct = expected === 0 ? (value === 0 ? 0 : 100) : Math.abs((value - expected) / expected) * 100;
        checks.push({
          parameter,
          corner,
          expected,
          measured: value,
          verdict: errorPct <= TOLERANCE_PCT ? "pass" : "fail",
          reason: errorPct <= TOLERANCE_PCT ? undefined : `measured ${value.toPrecision(4)} against a stated ${expected.toPrecision(4)}`,
          errorPct
        });
      }

      // Parameters the model carries but no generic rig can measure.
      for (const parameter of ["slewRate"] as ModelParameter[]) {
        if (!usableAt(block, parameter, corners)) continue;
        const expected = valueAt(block, parameter, corner);
        if (expected !== null) checks.push({ parameter, corner, expected, measured: null, verdict: "unverifiable", reason: UNVERIFIABLE_REASON, errorPct: null });
      }
    }
  } finally {
    await rm(directory, { recursive: true, force: true }).catch(() => {});
  }

  return { checks, simulatorMissing };
}
