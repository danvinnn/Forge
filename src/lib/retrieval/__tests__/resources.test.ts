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

test("a vendor's model navigation page is not advertised as a downloadable model", () => {
  const resources = officialResourcesFromHtml(
    '<a href="https://www.onsemi.com/design/technical-documentation/simulation-spice-models">Simulation/SPICE Models</a>',
    "https://www.onsemi.com/products/example",
    /(^|\.)onsemi\.com$/i
  );
  assert.deepEqual(resources, []);
});

test("IBIS is ignored while boundary-scan gets a distinct pinout route", () => {
  const resources = officialResourcesFromHtml(
    `<a href="/models/device-ibis.zip">Device IBIS models</a>
     <a href="/models/device-bsdl.zip">BSDL boundary-scan models</a>`,
    "https://www.st.com/en/product/device",
    /(^|\.)st\.com$/i
  );
  assert.deepEqual(resources.map((resource) => resource.kind), ["pinout"]);
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

test("an exact package-and-pin PDF link is recognized as a package drawing", () => {
  const resources = officialResourcesFromHtml(
    `<a href="/lit/pdf/MPQF027A">TQFP (PBS) | 32</a>`,
    "https://www.ti.com/product/PART/part-details/PARTIPBS",
    /(^|\.)ti\.com$/i
  );
  assert.deepEqual(resources.map((resource) => resource.kind), ["package-drawing"]);
});

test("an official PDF labelled by package family and vendor designator is a package drawing", () => {
  const resources = officialResourcesFromHtml(
    `<a href="/lit/pdf/MPQF027A">TQFP (PBS)</a>`,
    "https://www.ti.com/product/PART",
    /(^|\.)ti\.com$/i
  );
  assert.deepEqual(resources.map((resource) => resource.kind), ["package-drawing"]);
});

test("Würth resource provenance accepts its official catalogue host", () => {
  assert.equal(isOfficialResourceUrl("https://www.we-online.com/components/media/o123.zip", "Würth Elektronik"), true);
  assert.equal(isOfficialResourceUrl("https://mirror.invalid/o123.zip", "Würth Elektronik"), false);
});
