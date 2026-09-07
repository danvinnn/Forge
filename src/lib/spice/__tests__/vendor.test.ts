import { test } from "node:test";
import assert from "node:assert/strict";
import { inspectVendorModel, vendorResource, wrapVendorCandidate, wrapVendorModel } from "../vendor";

test("a vendor model is wrapped into canonical order without changing its text", () => {
  const source = ".subckt THEIR_OP VCC IN- OUT IN+ VEE\nR1 OUT VEE 1k\n.ends THEIR_OP\n";
  const wrapped = wrapVendorModel(source, "opamp");
  assert.ok(wrapped.text.startsWith(source.trimEnd()));
  assert.match(wrapped.text, /Xvendor VCC IN- OUT IN\+ VEE THEIR_OP/);
  assert.match(wrapped.text, /\.subckt FORGE_VENDOR IN\+ IN- OUT VCC VEE CORNER=1/);
});

test("an unfamiliar vendor terminal is refused rather than guessed", () => {
  assert.throws(
    () => wrapVendorModel(".subckt X IN+ IN- OUT VCC ENABLE\n.ends X", "opamp"),
    /could not be mapped/
  );
});

test("only a model verified to exist is described as one", () => {
  assert.equal(vendorResource("OPA333", "Texas Instruments")?.modelKnown, true);
  const unknown = vendorResource("SOME_NEW_PART", "Texas Instruments");
  assert.equal(unknown?.modelKnown, false);
  assert.match(unknown?.label ?? "", /product resources/);
});

test("a generic subcircuit keeps arbitrary terminal order without assigning meaning", () => {
  const [candidate] = inspectVendorModel(".subckt SENSOR EXC+ SENSE/OUT EXC- SHIELD params: gain=1\n.ends SENSOR\n");
  assert.deepEqual(candidate.terminals, ["EXC+", "SENSE/OUT", "EXC-", "SHIELD"]);
  const wrapped = wrapVendorCandidate(candidate, "sensor.lib", "AB-123");
  assert.match(wrapped.text, /\.include "sensor\.lib"/);
  assert.match(wrapped.text, /\.subckt AB_123_FORGE P1 P2 P3 P4/);
  assert.match(wrapped.text, /Xvendor P1 P2 P3 P4 SENSOR/);
  assert.match(wrapped.asy, /PINATTR PinName SENSE_OUT\nPINATTR SpiceOrder 2/);
});

test("a continued subcircuit declaration preserves the entire terminal list", () => {
  const [candidate] = inspectVendorModel(".subckt LONG IN+ IN- OUT\n+ VCC VEE PARAMS: Vos=0\n.ends LONG\n");
  assert.deepEqual(candidate.terminals, ["IN+", "IN-", "OUT", "VCC", "VEE"]);
});

test("numeric-leading names, optional pins, and large declarations remain usable", () => {
  const pins = Array.from({ length: 128 }, (_, index) => `P${index + 1}`);
  const [candidate] = inspectVendorModel(`.subckt 2N_BIG ${pins.join(" ")} OPTIONAL: VCC=$G_VCC PARAMS: scale=1\n.ends 2N_BIG\n`);
  assert.equal(candidate.name, "2N_BIG");
  assert.deepEqual(candidate.terminals, pins);
  const wrapped = wrapVendorCandidate(candidate, "vendor.lib", "BIG");
  assert.match(wrapped.text, new RegExp(`Xvendor ${pins.map((_, index) => `P${index + 1}`).join(" ")} 2N_BIG`));

  const [model] = inspectVendorModel(".model 2N3904 NPN(Bf=100)\n");
  assert.equal(model.name, "2N3904");
});

test("a self-contained library section may use a nameless .ENDL", () => {
  const candidates = inspectVendorModel(".lib TT\n.subckt PART A B\n.ends PART\n.endl\n");
  assert.equal(candidates[0].name, "PART");
  assert.throws(() => inspectVendorModel(".lib external.lib\n.subckt PART A B\n.ends PART\n"), /depends on another file/);
});

test("a vendor declaration named exactly like the part cannot recurse through its adapter", () => {
  const [candidate] = inspectVendorModel(".subckt OPA333 IN+ IN- OUT VCC VEE\n.ends OPA333\n");
  const wrapped = wrapVendorCandidate(candidate, "OPA333.lib", "OPA333");
  assert.match(wrapped.text, /\.subckt OPA333_FORGE P1 P2 P3 P4 P5/);
  assert.match(wrapped.text, /Xvendor P1 P2 P3 P4 P5 OPA333/);
  assert.match(wrapped.asy, /SYMATTR Value OPA333_FORGE/);
});

test("common primitive model cards get their standard terminal contract", () => {
  const candidates = inspectVendorModel(".model DMOD D(Is=1e-12)\n.model QMOD NPN(Bf=100)\n.model MMOD NMOS(Vto=2)\n.model POWER VDMOS(Vto=2)\n.model LINE LTRA(len=1 R=1 L=1u C=1n)\n");
  assert.deepEqual(candidates.map((candidate) => candidate.terminals), [
    ["A", "K"],
    ["C", "B", "E"],
    ["D", "G", "S", "B"],
    ["D", "G", "S"],
    ["L+", "L-", "R+", "R-"]
  ]);
});

test("primitive adapters use LTspice's device-specific instance contracts", () => {
  const source = [
    ".model MES NMF(Vto=-2 Beta=1m)",
    ".model POWER VDMOS(Vto=2 Kp=1)",
    ".model CURRENT CSW(Ron=.1 Roff=1Meg It=.1)",
    ".model LINE LTRA(len=1 R=1 L=1u C=1n)"
  ].join("\n");
  const candidates = inspectVendorModel(source);
  assert.match(wrapVendorCandidate(candidates[0], "vendor.lib", "MES").text, /Zvendor P1 P2 P3 MES/);
  assert.match(wrapVendorCandidate(candidates[1], "vendor.lib", "POWER").text, /Mvendor P1 P2 P3 POWER/);
  assert.match(wrapVendorCandidate(candidates[2], "vendor.lib", "CURRENT").text, /Vsense P3 P4 0\nWvendor P1 P2 Vsense CURRENT/);
  assert.match(wrapVendorCandidate(candidates[3], "vendor.lib", "LINE").text, /Ovendor P1 P2 P3 P4 LINE/);
});

test("value-bearing model cards require a validated instance value", () => {
  const candidates = inspectVendorModel(".model RMOD R\n.model CMOD C\n.model LMOD L\n.model UMOD URC(K=2 Fmax=1Meg)\n");
  assert.deepEqual(candidates.map((candidate) => candidate.instanceParameter), ["resistance", "capacitance", "length"]);
  assert.throws(() => wrapVendorCandidate(candidates[0], "vendor.lib", "R"), /numeric resistance/);
  assert.match(wrapVendorCandidate(candidates[0], "vendor.lib", "R", "10k").text, /Rvendor P1 P2 RMOD 10k/);
  assert.match(wrapVendorCandidate(candidates[2], "vendor.lib", "U", "0.01").text, /Uvendor P1 P2 P3 UMOD L=0.01/);
  assert.throws(() => wrapVendorCandidate(candidates[0], "vendor.lib", "R", "0"), /positive SPICE numeric resistance/);
  assert.throws(() => wrapVendorCandidate(candidates[1], "vendor.lib", "C", "0u"), /positive SPICE numeric capacitance/);
  assert.throws(() => wrapVendorCandidate(candidates[1], "vendor.lib", "C", "1u; .shell nope"), /numeric capacitance/);
});

test("simulator control is refused before a vendor cross-check executes it", () => {
  assert.throws(
    () => wrapVendorModel(".subckt X IN+ IN- OUT VCC VEE\n.ends X\n.control\nshell touch nope\n.endc", "opamp"),
    /will not execute/
  );
  // Structural inspection is deliberately still possible: this path never
  // executes or redistributes the uploaded file.
  assert.equal(inspectVendorModel(".subckt X A K\n.ends X\n.control\n.endc").length, 1);
});

test("a structurally incomplete vendor library is not presented as standalone", () => {
  assert.throws(
    () => inspectVendorModel(".include helper.lib\n.subckt PART A B\n.ends PART\n"),
    /depends on another file/
  );
  assert.throws(
    () => inspectVendorModel(".subckt PART A B\n.ends PART\n.end\n"),
    /top-level \.END/
  );
});
