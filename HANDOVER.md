# Running Forge

## 2026-09-10 black-box universe gate

The product-independent release panel is in `src/lib/__bench__/universe-corpus.ts`.
It freezes 19 previously unseen manufacturer documents covering all 55 declared
external populations and the required cross-risk pairs. The multi-turn runner
uses only production HTTP routes and follows search/upload, package selection,
CAD questions, page-backed SPICE corrections, fixed-voltage answers, vendor
resource discovery, vendor declaration selection, and final artifact download.

```bash
npm run build
npm run bench:universe:e2e -- --fresh
npm run bench:universe:e2e:gate
```

The evaluator checks every question against the independent oracle, proves its
answer was accepted on a later request, rejects repeated/dead-end questions,
opens both CAD archives, checks terminal uniqueness and available pin sentinels,
and checks independently specified irregular numbered-land geometry against the
portable record and the actual KiCad copper. It also opens SPICE archives,
checks their declared topology/provenance, and distinguishes generated models
from structural vendor adapters. Results live in the ignored
`.universe-e2e-results/` directory.

Latest complete receipts: 19/19 journeys, 19/19 CAD parts shipped in both
formats, 6/19 supported SPICE artifacts, and 0 P0 / 0 P1 findings. The other 13
SPICE journeys ended in the independently required question-free honest refusal
paths. A long fresh run exhausted external search/model capacity near its end;
only those contaminated receipts were rerun individually, using the same fresh
production-route runner, before the aggregate gate passed. Provider 429s and
request timeouts must never be reported as product coverage failures or passes;
rerun the affected receipt cleanly.

Latest local verification on 2026-09-10: 1,316/1,316 tests, TypeScript, ESLint,
production build, diff integrity, both universe gates, independent Altium reads
of all 130 emitted files, and the SPICE holdout gate are green. The holdout has
60% unaided generation and 88% safe completion after one manufacturer-listed
fixed-output choice, with 197 passing and zero failing conformance checks. The
instrument now probes the document's stated voltage choices rather than an
arbitrary placeholder; probe-built models are still excluded from conformance
scoring. A subsequent operator run installed KiCad 10.0.6, extracted official
LTspice without installing it, refreshed the 43-document blind cache, and made
those three previously unavailable stages green. That run also exposed two
vacuous-green instrument defects: mutation M11 no longer matched the source and
`bench:confirm` measured zero artifacts. M11 is retargeted and the mutation gate
now fails on both SURVIVED and NOT APPLIED; the confirmation gate now fails when
its shipping, hand-read pinout, or hand-read copper populations are empty. These
changes are verified: the confirmation gate measured nonzero pinout and copper
oracles with zero silent disagreement, 1,317/1,317 tests passed, all 20 mutations
were killed with none surviving or unapplied, and the production browser gate
passed 22/22 required stages with zero problems. The same run exposed stale
chooser questions reappearing after an export refusal; the suite now treats the
server's empty post-attempt question list as authoritative and keeps explicit
corrective questions when the server supplies them. RHF1201 now progresses from
formed-lead questions to land-pattern questions without reviving either group.
The later combined prerelease run made every stage through official LTspice
green, then exposed one browser-instrument classification error: an unusable
live manufacturer-resource candidate correctly returned 422, the automatic
recovery loop handled it, but the global HTTP watcher counted that designed miss
as an application crash. Resource-import 422 now has the same narrow exemption
as answerable export/model 422; all other resource failures remain findings.
That combined browser rerun is left to the operator, as requested.

The run fixed general defects along the way: three-sided module geometry,
three-pin SOT placement, optional STEP dimensions blocking usable CAD, generic
fixed-voltage families silently choosing their first voltage, reviewed device
class accidentally selecting the first spec block, visual-only scope labels
creating false choices, passive/discrete documents offering impossible analog
class choices, missing Würth official-resource discovery, exact instrumentation-
amplifier gain-law recovery, and irregular numbered-land packages. The last item
is important: NCP163 had previously passed with four wrongly placed regular-row
lands. `terminalPads` now carries explicit numbered coordinates and sizes from
extraction or one structured user answer, validates an exact one-to-one pin set,
and bypasses the regular-row approximation. The universe gate now compares that
geometry independently so the old wrong footprint cannot pass again.

Everything here was walked on 2026-09-01 by removing the configuration and
starting from nothing, so the steps are what actually happens rather than what
should.

## What you need

- Node 21 or later
- A Google Cloud service account with Vertex AI enabled, or a Gemini API key

A parse takes **65 to 90 seconds**, almost all of it the model. About a second of
that is Forge. Any host you run this on must allow a request to last ~150
seconds; Vercel's Hobby tier caps at 60 and will not work.

## First run

```bash
npm install
npm run build
npm start          # http://localhost:3000
```

With no configuration at all it builds, boots, and serves the page. It will
refuse to read anything, and say so:

```
{"level":"warn","event":"preflight","code":"MODE_DEFAULTED",
 "message":"FORGE_DEPLOYMENT_MODE is not set. In production this defaults to
            air-gapped (fail-closed) ..."}
```

and a parse answers **503 MODEL_UNAVAILABLE**, "No local reader is configured for
this air-gapped deployment, so the datasheet was never read." That is the
intended behaviour: it fails closed and tells you which knob is missing.

## Configuring the reader

Copy `.env.example` to `.env.local`. The three lines that matter:

```
FORGE_DEPLOYMENT_MODE=commercial          # or air-gapped
GOOGLE_APPLICATION_CREDENTIALS=./gcp-key.json
FORGE_VERTEX_PROJECT=your-project-id      # the ID, not the display name
```

Vertex needs BOTH the credential and the project; either alone is treated as not
configured, because guessing the project means guessing who gets billed.

A Gemini API key works instead:

```
GOOGLE_GEMINI_API_KEY=...
```

An air-gapped install uses neither and points at a local model on a private
address (`FORGE_LOCAL_MODEL_URL`). Controlled datasheets never leave that
network, and the guarantee is structural: the cloud providers are reachable only
through a dynamic import on the commercial branch, enforced by a test.

## What it will cost

Every billed call is metered and capped.

```
FORGE_SPEND_LIMIT_USD=25     # cumulative across every parse. 0 disables.
```

Over the limit, both routes answer 402 and nothing is sent. The running total
lives in `.forge/spend.json`. A local model is never counted and never capped.

A parse costs roughly $0.03. Sixty-three calls during testing came to $2.13.

## What to expect from a read

- The card at the top says one of seven things and the button under it agrees
  with it. If it says nothing can be built, the button is withheld.
- Values that two independent readings agreed on ship silently. Everything else
  is listed as "worth a glance", with the page it came from. On the tuned corpus
  that is **1.73 values per part**, and never more than 5.
- Questions are asked only where the datasheet does not answer them. Ceramic flat
  packs will ask for a formed lead span, because no manufacturer prints one: the
  leads are straight until your line forms them.

## If something looks wrong

- `npm run bench:kicad` opens every emitted file with KiCad itself.
- `npm run bench:altium` opens every emitted file with an independent reader.
- `npm run bench:instruments` breaks each check on purpose and confirms it
  complains. If that one is red, distrust every other number.
