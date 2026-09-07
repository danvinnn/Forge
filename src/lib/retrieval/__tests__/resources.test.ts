import { test } from "node:test";
import assert from "node:assert/strict";
import { officialResourcesFromHtml, importOfficialResource, isOfficialResourceUrl } from "../resolvers/resources";

test("official product-page resources are classified without accepting mirrors", () => {
  const resources = officialResourcesFromHtml(`
    <a href="/models/part.lib#download">PSpice macromodel</a>
    <a href='https://www.ti.com/cad/part.kicad_mod'>PCB footprint</a>
    <a href="https://mirror.invalid/part.lib">SPICE model mirror</a>
    <a href="javascript:alert(1)">CAD model</a>
  `, "https://www.ti.com/product/PART", /(^|\.)ti\.com$/i);
  assert.deepEqual(resources.map((resource) => resource.kind), ["spice", "cad"]);
  assert.ok(resources.every((resource) => new URL(resource.url).hostname.endsWith("ti.com")));
  assert.ok(resources.every((resource) => !resource.url.includes("#")));
});

test("official import refuses a manufacturer mismatch before fetching", async () => {
  await assert.rejects(
    () => importOfficialResource("https://www.analog.com/model.lib", "Texas Instruments"),
    /not hosted by the identified manufacturer/i
  );
});

test("official provenance does not survive a redirect to a merely public mirror", () => {
  assert.equal(isOfficialResourceUrl("https://software-dl.ti.com/models/part.lib", "Texas Instruments"), true);
  assert.equal(isOfficialResourceUrl("https://mirror.invalid/models/part.lib", "Texas Instruments"), false);
  assert.equal(isOfficialResourceUrl("http://www.ti.com/models/part.lib", "Texas Instruments"), false);
});

test("official discovery recognizes common standalone SPICE library extensions", () => {
  const resources = officialResourcesFromHtml(`
    <a href="/models/part.ckt">Circuit model</a>
    <a href="/models/part.spi">Simulator model</a>
    <a href="/models/part.inc">Include file</a>
  `, "https://www.ti.com/product/PART", /(^|\.)ti\.com$/i);
  assert.deepEqual(resources.map((resource) => resource.kind), ["spice", "spice", "spice"]);
});

test("official discovery recognizes textual EAGLE footprint libraries", () => {
  const resources = officialResourcesFromHtml(
    `<a href="/cad/part.lbr">EAGLE library</a>`,
    "https://www.ti.com/product/PART",
    /(^|\.)ti\.com$/i
  );
  assert.deepEqual(resources.map((resource) => resource.kind), ["cad"]);
});

test("official discovery keeps a 3D model distinct from copper CAD", () => {
  const resources = officialResourcesFromHtml(
    `<a href="/cad/part.step">3D CAD model</a><a href="/cad/part.kicad_mod">PCB footprint</a>`,
    "https://www.ti.com/product/PART",
    /(^|\.)ti\.com$/i
  );
  assert.deepEqual(resources.map((resource) => resource.kind), ["step", "cad"]);
});
