# Forge

Forge turns component datasheets into usable CAD libraries and auditable SPICE models. It is for any
engineer working with PCB/CAD or circuit simulation, from a first board through staff-level review.
Radiation-hardened aerospace and defense parts remain a deliberate strength rather than the boundary
of the product. Give Forge a part number or upload a datasheet PDF; it extracts the pinout, package
geometry, dimensions, electrical specifications, and qualification data, then generates schematic
symbols, footprints, STEP bodies, and supported LTspice macromodels.

**Every extracted value carries a confidence score and a citation back to the page it was read
from.** That is the point of the product, not a feature of it: IPC Class 3 and QML/QPL sign-off
require traceability, and a value nobody can trace is not usable on a flight part.

## The two things that make this different

**Rad-hard focus.** COTS-focused tools handle mainstream parts and break on rad-hard. The rad-hard
supply base (Cobham/CAES, Teledyne e2v, Microchip, Honeywell, VORAGO) documents inconsistently, and
several of those vendors publish no public datasheets at all.

**Air-gapped / ITAR deployment.** Controlled datasheets cannot leave the customer network. In
air-gapped mode Forge makes no network call on any reachable code path, and that is enforced
structurally (dynamic imports, a source scan, and merge-blocking tests) rather than by convention.

## How it works

Three layers, with the "use AI or not" question answered separately for each.

### 1. Retrieval, deterministic, no model

A part number resolves to a datasheet PDF, or you upload one.

- **Manufacturer-direct**: builds the datasheet URL from the part number and fetches it from the
  vendor. Ships verified patterns for TI, STMicroelectronics, and Analog Devices. A pattern enters
  the registry only after someone fetched a real datasheet through it.
- **Scrape**: multi-backend search with failover and a circuit breaker, plus known distributor
  paths. Last resort, since it is the only route to parts no vendor pattern claims.

No credentials are required. Part-number lookup works on a fresh checkout with an empty `.env`.

A model is never used to find or generate a datasheet URL. That would hallucinate dead links and
poison the citation trail the whole product depends on.

Every retrieved file is validated by its `%PDF` magic bytes (Content-Type is never trusted), size
bounded, filename sanitized, hashed with sha256, and tagged with the resolver that produced it.

### 2. Extraction, deterministic-first, model optional

The text parser always runs first and always wins. A model is only ever asked about fields the
parser could not resolve, and it can never overwrite a value that was read off the page by code.

- **Unknown is representable.** A field the parser cannot determine is recorded as `null` with a null
  confidence and no citation, so honest gaps are visible in the data instead of being filled with a
  guess.
- **Conflicting evidence resolves to unknown.** When two independent signals disagree (for example a
  package designator that says 2 leads and a pin table that yields 3 rows), neither is trusted.
- **Model citations are verified, not believed.** A model reports the page it read a value from, and
  that claim is checked against the page before it becomes a citation. Values whose claim does not
  hold keep the value but carry no citation, and the record says they are not traceable.

Which model runs depends on deployment mode. Commercial may use a cloud model (Gemini). **Air-gapped
permits only a locally hosted open-weight model** over an OpenAI-compatible endpoint (vLLM, Ollama,
llama.cpp; the architecture names Qwen3-VL), and that endpoint must resolve to a private address:
a public one is refused, because a misconfigured "local" model pointing at a cloud host is exactly
the leak air-gapped mode exists to prevent.

Parsing is resource-bounded (pages, extracted characters, objects per page, wall clock), so a small
PDF crafted to expand catastrophically returns a clean `PARSE_LIMIT_EXCEEDED` rather than hanging.

### 3. Generation, deterministic templating, no model

A model never writes footprint or symbol geometry. Output must be exact, reproducible, and
auditable.

**Export refuses incomplete records.** If the values the geometry depends on were never actually
extracted, the export returns `422 INCOMPLETE_EXTRACTION` listing what is missing, rather than
generating a footprint from numbers nobody read off a datasheet.

Every extracted value is escaped at the sink before being interpolated into generated files.

## Current support

- **Input**: part number with an optional manufacturer hint, or a PDF upload. Upload works in every
  deployment mode and is the primary path for controlled parts. A typed part is retrieved and
  verified in a model-free identification step first, so package selection and official-resource
  recovery happen before the paid read; SPICE-only and combined builds do not require a separate
  browser-side PDF upload.
- **Extracted**: part number, manufacturer, package type, pin count, pin table, package dimensions,
  and radiation qualification (TID, SEE, SEL, QML class), each with confidence and citation.
- **CAD export formats**: KiCad (`.kicad_sym` + `.kicad_mod` + STEP) and native Altium libraries.
  Cadence/OrCAD is shown as unavailable rather than emitting a misleading substitute.
- **Official-resource recovery**: once a manufacturer and part are known, Forge inspects the
  manufacturer's own product page for CAD, package-drawing, application-note, and SPICE resources.
  A supported direct file or archive can be imported in place. Vendor KiCad and EAGLE copper is parsed into
  Forge's format-neutral geometry, checked against the extracted terminal set and geometry
  invariants, then emitted wherever the selected format can represent it exactly; it is never
  trusted merely because it came from a vendor archive.
  Official STEP/STP package bodies are recovered as a distinct resource. Their bounded,
  structurally valid source is preserved byte-for-byte in KiCad bundles and embedded in native
  Altium output; Forge does not reinterpret the solid as copper or replace it with an approximate
  generated body. Altium asks for the installed component height only when that format requires
  the duplicated metadata and the datasheet does not provide it.
  When the archive also carries a KiCad symbol, or an EAGLE library contains an exactly scoped
  device-to-package connection table, exact agreement on every pin number and name is independent
  pinout evidence; an exact disagreement refuses export and never overwrites the datasheet reading.
  Ranked resources are tried automatically before the paid read, unique archive
  members are selected by part/package evidence, and redirects must remain on the identified
  manufacturer's HTTPS domain.
- **SPICE output**: deterministic LTspice `.lib` and `.asy` files plus a conformance receipt for
  operational amplifiers, instrumentation amplifiers, comparators, voltage references, and LDO
  regulators. Instrumentation gain is generated only when Forge reads the resistance numerator
  from the printed gain equation; no family constant is assumed. Forge refuses a topology it
  cannot support.
  A refusal is not a dead end: a page-backed review can recover a missed supported-class value,
  and any standalone vendor `.SUBCKT` (plus supported LTspice primitive `.MODEL` cards) can be
  turned into a terminal-order-preserving adapter and neutral symbol. Where the simulator requires
  an instance value, Forge asks for it instead of guessing. Vendor-backed results are labelled
  structural rather than falsely described as datasheet-conformant.
- **Combined output**: the approved `Both` flow returns one archive with `cad/` and `spice/`
  directories and a root README.
- **Bundle contents**: symbol, footprint, STEP package body, normalized JSON, and a manifest.

## Known limitations

Stated rather than hidden.

- **Coverage is structural, not incidental.** Microchip, NXP, Vishay, and Infineon name datasheets by
  document number, so no part-number pattern can reach them. VORAGO, CAES, Teledyne e2v, and
  Honeywell publish no public datasheets at all. Connectors have no derivable pattern anywhere. Run
  `npm run bench:coverage` for the measured per-category numbers rather than trusting an estimate.
- **The deterministic text parser is strongest on common table layouts.** The commercial visual
  reader can recover cited rows from broken-text and image-only PDFs across every shipped SPICE
  class; visual-only values remain explicitly review-visible rather than confirming themselves.
  A malformed unit glyph receives one focused page-pixel retry before it becomes a user review.
- **Generated STEP export creates the package body enclosure only**; pin-lead geometry is still
  approximate. When a matching manufacturer STEP/STP is available, Forge preserves that exact
  model instead.
- **A native Cadence emitter is not built yet.** KiCad and native Altium bundles are available.
- **Vendor CAD ingestion currently accepts textual KiCad footprints, Autodesk EAGLE/Fusion
  Electronics XML libraries, and STEP/STP package bodies.** Other vendor CAD formats
  remain downloadable evidence but are not silently converted by a lossy parser. The import path
  preserves arbitrary pad positions, holes and rotations; unsupported back-side copper is rejected
  with an actionable choice instead of being mirrored implicitly. EAGLE package choice is exact,
  not a similar-name match; arbitrary signal-layer copper and design-rule-dependent elongated pads
  are not approximated. Native Altium output preserves rectangular, rounded, oval, and slotted-hole
  geometry rather than flattening it. A uniquely applicable official KiCad/EAGLE footprint or SPICE model is
  imported automatically; Forge asks only when the manufacturer
  archive contains several plausible package or model files.
- **Footprint math is IPC-7351B-based**, not a full implementation of the standard. It is described
  that way deliberately.
- **Scanned or image-only datasheets** need the model path; the text pass will report unknowns.

## Run locally

```bash
npm install
python3 -m pip install -r requirements-oracles.txt # independent CAD readers used by npm test
npm run dev
```

Dev defaults to commercial mode, so lookup works with no configuration. Copy `.env.example` to
`.env.local` to change deployment mode, add a model, or tune limits. Every variable is documented
there.

```bash
npm test                 # unit + integration + air-gap guard + security tests
npx tsc --noEmit         # type check
npm run bench:coverage   # measured RETRIEVAL coverage (add -- --live for the real chain)
npm run bench:extraction # measured EXTRACTION coverage (add -- --fetch to populate the cache)
npm run bench:cad-opportunity # no avoidable CAD questions + frozen blind coverage floor
npm run bench:cad-release     # complete CAD gate; fails unless kicad-cli is installed
npm run bench:release         # full CAD + SPICE gate; requires ngspice, KiCad and official LTspice
npm run bench:model-holdout # free, offline SPICE census over all cached unseen parts
npm run bench:model-capabilities # every generated/review/vendor route is reachable
NGSPICE_BIN=/path/to/ngspice npm run bench:model-coverage # exhaustive SPICE gate
npm run bench:model-holdout -- --confirm --gate # paid second read of the exact minimum panel
NGSPICE_BIN=/path/to/ngspice LTSPICE_BIN=/path/to/LTspice npm run bench:model-release
```

The two benchmarks answer different questions, and both matter:

- `bench:coverage` asks **can we find the datasheet**. Run `-- --live` from the target deploy host:
  search engines block datacenter IP ranges, so the block rate on a laptop is not the block rate in
  production.
- `bench:extraction` asks **once we have it, how much can we read, and is the result good enough to
  export**. It caches fetched PDFs under `.bench-cache/` (gitignored, never committed, since the
  same rule that keeps datasheets out of `test-data/` applies).

Measure before building. Judgment about coverage has been wrong twice in this repo, and both times a
benchmark was what caught it.

## Validation

Primary target: **TI LMP7704-SP**, a 14-pin QMLV rad-hard amplifier. Ideas are also sanity-checked
against a harder rad-hard part (VORAGO or Microchip rad-hard), because easy parts hide extraction
failures.

## Documentation

- `ARCHITECTURE.md` is the top-level intent: the three-layer rationale and the hard constraints.
- `src/lib/retrieval/LAYER1.md` is the decided record for retrieval, with every decision and its
  reasoning.
- `DEFERRED.md` is the open backlog, each item with how to close it and how to prove it.

Where documents disagree, the decided records beat prose and **the code beats every document**.
