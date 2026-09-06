import { test } from "node:test";
import assert from "node:assert/strict";
import { officialResourcesFromHtml, importOfficialResource } from "../resolvers/resources";

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
