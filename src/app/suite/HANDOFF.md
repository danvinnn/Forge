# Handoff — `ui/forge-suite`

For whoever picks this up. The original branch rationale is preserved below;
**“Decisions and resolved seams, 2026-09-05” is the current status.**

## TL;DR

A new route, `/suite`, contains Forge's approved multi-tool flow. The functionality merge is now
wired: identification, directed CAD reads, SPICE model generation, review/correction, confirmation,
refusals, CAD export, one combined `Both` archive, generated-symbol preview, and optional vendor
model checking all run through the shared routes and library rules. `/` redirects to `/suite`.

## Original branch files (historical inventory)

```
src/app/suite/page.tsx             route; force-dynamic (CSP nonce, same reason as layout.tsx)
src/app/suite/SuiteWorkspace.tsx   the phase machine and shell
src/app/suite/Onboarding.tsx       first run, two steps: the line, then the account
src/app/suite/SettingsPanel.tsx    the gear, top right; Account and Assembly line tabs
src/app/suite/AssemblyForm.tsx     the four settings rows, shared by both of the above
src/app/suite/AccountForm.tsx      the three account fields, shared by both of the above
src/app/suite/account.ts           localStorage for the account and both settings stores
src/app/suite/suite.css            scoped to .suite / .onboard; tokens from globals.css
src/lib/intent.ts                  the Intent type, out of the component so lib can import it
src/lib/readprogress.ts            what the read bar is allowed to say
src/lib/__tests__/readprogress.test.ts
```

The initial UI branch was additive. The completed functionality merge also changes shared library,
route, benchmark, and documentation files; use `git status` for the authoritative inventory.

`readprogress.ts` sits in `src/lib` rather than beside the shell because `npm test`
only globs `src/lib/**/__tests__`, and an unchecked progress bar is how the first
one came to be frozen. It is pure logic and imports nothing from React.

## The flow this implements

```
first run, until an account exists (settings, then the account; skippable in one click)
  → home: choose intent, then drop a PDF or name a part
  → identify: deterministic, ~1s, NO model call
     └ if the intent needs a footprint: choose the package, before the read
  → the read: ~90s, one model call, aimed by the intent
  → output
```

All four states render **inside one frame**. The composer is a persistent element: on submit it
settles to the top of the window and the body grows beneath it, each phase replacing the last.
One control — "Start another part" — resets. This replaced two alternatives that were built and
rejected: a chat-style append (the live content sinks below the fold and the composer asks for a
part the user does not have) and a back/forward pager (intent and package steer the read, so
after it they are not editable; "back" could only mean discard).

## Why intent is chosen BEFORE the read

This is the load-bearing decision and everything else follows from it.

1. **The reader is field-directed.** It is handed the fields and the pages to go after. A
   footprint wants the pin table and the package outline drawing; a SPICE model wants the
   specification table. Aiming after the fact means over-reading both or re-reading, and
   `src/app/page.tsx` already documents a re-read as the most expensive action on the screen.
2. **A package belongs to a footprint and to nothing else.** A macromodel describes the die, so
   an LTspice-only user should never see the package chooser. Choose-first is the only ordering
   that can skip it.
3. **A package chosen after the read arrives too late to be used** — every pin reader takes the
   package as an argument. The existing code says so; the new flow finally honours it.

Identification stays free so the choice is early without being blind: part number, manufacturer,
page count and the ordering table's designators come from a text pass with no model call.

## Original seams — all completed (historical rationale)

1. **`/api/identify` (new).** The model-free text pass `/api/parse` already runs first, exposed
   on its own. Returns `{partNumber, manufacturer, pageCount, packages[], specPages,
   outlinePage, sha256, fileName}`. It must stay model-free — the moment it costs a call it
   belongs behind the Read button with everything else that costs money.
2. **`intent` on `/api/parse` and `/api/lookup`.** `"cad" | "spice" | "both"`. Selects the field
   set and which pages get rendered for the second pass.
3. **`packageType` sent before the read.** `/api/lookup` already accepts it. The change is
   ordering only.
4. **`/api/model` (new).** The SPICE emitter: deterministic templating over extracted
   parameters, exactly like the footprint emitters. No model writes the netlist. A parameter the
   datasheet does not state is asked for by name, or the model is refused — the same contract as
   `422 INCOMPLETE_EXTRACTION`.

   **That is the contract, and it is not a specification. See [`SPICE.md`](../../../SPICE.md)
   before writing any of it.** This bullet names no parameters, no device class, no file set and
   no confirmation pairing, and `RULES.md` 7 has no rows for parameters at all. `SPICE.md`
   separates what is already decided from the eight questions that are open, and two of them
   (generate vs. retrieve the vendor's published model; whether a parameter block fits inside
   `MAX_FLAGGED`) can change what this half of the product is.
5. **Panels to move from `src/app/page.tsx`, unchanged:** the verdict card, "worth a glance",
   **"Show the full record"**, the review list with page images and corrections, the
   export-refusal panel (`missing` vs `untraceable`), install-scoped answers, and the reader's
   notes. They drop into the `done` body. Do not rewrite them; their comments record defects that
   took weeks to find.

   **The full record was missing from this list until 2026-09-02, and it is the one entry that
   would not have been noticed missing.** Every other panel is absent from `/suite` in a way you
   can see. The record is a disclosure that is closed by default, so a `done` body without it
   looks finished. `/suite` currently renders five things after a read: the footprint preview, the
   SPICE placeholder, the format picker, the refusal panel and the export button. That is the
   whole of it.

   What has to move is `page.tsx` §6, "THE RECORD" (around line 2231): the `disclose` button,
   the 26 dimension rows across `Package` and `Printed footprint`, and the pin table with its
   editable number and name cells.

   **The data is already there.** `SuiteWorkspace` holds `part` as a `PartRecord` from the moment
   the read returns, which is the same object `page.tsx` holds, citations included. Nothing new
   has to be fetched or plumbed; this is a rendering job.

   **The catch, and why this branch did not do it.** `Row`, `Provenance` and `showValue`
   (`page.tsx:175-227`) are module-local and not exported. Porting the record means extracting
   them, which edits `page.tsx` — a file `main` also has. Every change on `ui/forge-suite` lives
   in untracked `src/app/suite/`, so the merge surface with `main` is currently exactly zero, and
   this was left alone to keep it that way. Extract those three into `src/lib` when `page.tsx` is
   open for the functionality merge anyway. **Do not copy them into `src/app/suite/` instead:**
   two `Provenance` implementations means two screens that can disagree about where a value came
   from, and that disagreement is the one thing this product cannot ship.

## The copy pass, 2026-09-02

Anthony read the shell and said there was too much text on it for no reason. There
was. Nothing about the flow changed and no behaviour was added or removed; what
changed is how much of the reasoning is printed rather than kept in the source.

The rule applied: **the screen states the decision, the source states the reason.**
Every sentence cut is still written down, in the file that owns the behaviour.

- **The identify table is gone.** Five rows: three were already in the composer
  line two inches above it, one was a count of the list directly below it, and
  one was eight characters of a sha256 nothing on the screen used. The composer
  line carries part, manufacturer and page count now.
- **The read screen.** Four stage rows each carried a sentence explaining
  themselves, under a four-line paragraph. The sentences moved to `title` on the
  row and **the paragraph is gone** — Anthony's call, 2026-09-02, on the last
  line of it. What is left is the bar, four named stages and the clock.
- **The elapsed clock is in one place**, the composer. It was also inside the
  `aria-live` region, so a screen reader announced the seconds every 250ms and
  the one worthwhile announcement, the run going long, landed in the middle of
  that.

**One thing to know, since the estimate no longer says it is one.** The
timestamps in the stage list are the SCHEDULE's boundaries from
`src/lib/readprogress.ts`, not observed times: the routes do not report when a
stage begins, so `0:10` means "this is where stage two starts on a typical run"
rather than "stage two started at ten seconds". Nothing else on the screen reads
as a measurement, and the bar still cannot fill until the response lands. When
`/api/parse` streams real stage boundaries, the column becomes true as written
and this note goes away.
- **The named standard prints only while its row is blank.** That is the whole
  window in which "blank means IPC-7351B, nominal density level B" decides
  anything; it used to print under a row that had been set to C.
- **The `Forge` eyebrow over the hero heading is gone.** One wordmark, in the
  bar, and no heat rule on it: the heat bar beside it was removed 2026-09-10.
- **`.pkg-active` was still blue** inside a shell whose accent is the ember, so
  the selected package card and the chip beside it disagreed about which colour
  means "picked". Overridden under `.suite`, in `suite.css`.
- **The refusal panel's second paragraph is gone.** One of its three variants
  told the user what to do next; the other two argued that the refusal was
  correct, to somebody who is blocked on an export.

`RULES.md` is untouched by this and so is every claim the product makes. What a
value is, whether it was confirmed, and what could not be confirmed are all still
on screen and still named.

## Design decisions baked in

- **Ember (`oklch(.62 .17 47)`) replaces the blue accent, inside `.suite` only.** Blue survives
  as the cold/locked note: hot means unfinished, cold means signed off. `globals.css` is
  untouched, so `/` keeps its blue.
- **The heat bar is driven, and it is an estimate that says so.** *Changed 2026-09-01.* It used
  to report position only, and it did not even do that: the fill was pinned at a constant width
  and the active stage was hardcoded to index 2, so it said the same thing at one second and at
  two minutes. It now advances from the clock against a per-stage schedule in
  `src/lib/readprogress.ts`. Three properties are load-bearing and are under test: it only ever
  increases, it never reaches full while the request is open, and **the last stage is closed by
  the response landing, never by a timer**. No numeric percentage is printed, because the split
  between the stages is a display estimate rather than a reading of the run. *Changed 2026-09-02:*
  the copy that said so on screen is gone; the properties above are unchanged and still under
  test, and the caveat that outlived the sentence is in the copy-pass section above.
- **The first run opens itself, and still cannot gate a read.** *Changed 2026-09-01.* RULES.md 3
  wants the settings settled before the first datasheet, so the window opens on its own until an
  account exists. What it must not do is force an answer: the 2026-08-28 finding is that
  requiring the two forming-die numbers made an engineer invent two of them. So the two rows no
  standard answers stay blank and optional, every button on the window leaves it, and a part
  that genuinely needs the die is still refused by name later with the drawing beside the
  question.
- **An account is a local record that the first run happened.** No server, no request, no
  credential. The standing constraint is that controlled datasheets never leave the customer
  environment and that it is enforced structurally; an account that phoned home would be the
  first crack in that. Signing out forgets the account and **keeps the settings**, which belong
  to the installation rather than to whoever typed them.
- **Intent and package lock once the read runs**, because they are what aimed it. Changing them
  afterwards would describe a read that did not happen.
- **The take button is disabled when `packageChoice.ok === false`**, with the missing fields
  named — the same rule `page.tsx` applies to *Build library*.

## Preset values — proposals, not decisions

| Preset | densityLevel | footprintSource | forming die |
| --- | --- | --- | --- |
| Hobbyist / bench | `A` | `datasheet-first` | untouched |
| Production | `B` | `datasheet-first` | untouched |
| Rad-hard / flight | `C` | `standard-always` | untouched |

Blank is a real answer: no published standard specifies one shop's forming die, so there is no
default and the value is asked per part when needed.

**No preset writes the forming die**, and the flight preset used to. *Changed 2026-09-01.* It
carried `9.4` and `0.51`, which are one shop's numbers dressed as a recommendation: a preset that
fills them in is the product inventing manufacturing data on the user's behalf, which is the whole
of RULES.md 1. Both rows are typed into directly, by whoever knows their own die.

## Decisions and resolved seams, 2026-09-05

- **Keep `Both` as the third first-class intent chip.** The product owner confirmed that the
  branch's functional flow is the intended one. It now produces one movable `-forge.zip`, with
  CAD under `cad/`, SPICE under `spice/`, and a root README; the button says “Take CAD + SPICE.”
- **Failure states are wired.** Input failures return to the identifiable pre-read state with a
  reason. Designed `422` refusals complete the read and render the named missing fields, with
  inputs only for values the user is allowed to supply. A package refusal cannot disable an
  unrelated SPICE model.
- **SPICE review is inline in the existing result flow.** A disclosure lists every extracted
  min/typ/max value, unit, and page. “Review or correct” shows the rendered source page, accepts
  reviewed corners/unit/page, rebuilds, and records the correction as user-reviewed in both the
  screen and conformance receipt. It does not add another wizard step.
- **The generated `.asy` is drawn.** The preview parses the same symbol text included in the ZIP
  and labels every terminal with its `.SUBCKT` order.
- **The SPICE path builds SPICE.** It calls `/api/model`, not `/api/export`; pure-SPICE downloads
  contain `.lib`, `.asy`, and the conformance receipt.
- **Vendor-model checking and rescue are available without redistribution.** Where Forge generated
  a class model, a supplied model is mapped to canonical terminals only when unambiguous and checked
  against the same datasheet targets. Where generation refuses, any standalone `.SUBCKT` can retain
  its declared order behind a neutral adapter; multi-declaration files require an explicit choice.
  That result is labelled structural, never numerical conformance. In both cases the vendor file is
  excluded from the archive.
- **The suite has its own light and dark palettes.** Dark mode uses distinct elevated surfaces,
  lower-chroma accents, readable technical text, keyboard focus rings, and touch-sized controls.
- **The suite is browser-driven.** `npm run bench:browser -- --spice --full` now requires the
  review, correction, symbol, and vendor seams as well as the real archives. The 2026-09-05 run
  passes 22/22 required stages with zero browser problems, including the
  value-bearing primitive configuration seam.

## Flipping `/` over

When the flow is signed off, in one commit: make `src/app/page.tsx` a redirect to `/suite`, or
move `src/app/suite/*` up to `src/app/`. Keep the old file in history rather than deleting its
comments wholesale — several of them are the only record of why a rule exists.

## Verify

```powershell
./node_modules/.bin/tsc --noEmit
npm run lint
npm run dev          # then open /suite, not /
```

The independent CAD-reader tests also require:

```bash
python3 -m pip install -r requirements-oracles.txt
```

Historically, **`npm test` reported a green ZERO on Windows.** The script is
`tsx --test 'src/lib/**/__tests__/*.test.ts'` and the single quotes survive into `cmd`, which
does not strip them, so tsx matches nothing and prints `tests 0 / pass 0 / fail 0`. That reads
exactly like a pass. Expand the paths instead:

```bash
npx tsx --test $(ls src/lib/__tests__/*.test.ts src/lib/*/__tests__/*.test.ts | tr '\n' ' ')
```

Current release result on 2026-09-05: **1,180/1,180 tests pass** after installing the independent
Python readers `pyaltiumlib` and `kiutils`. `npm run build` completes on Next 15.5.20. The retained
Playwright production pass drives `/suite`, opens the SPICE/KiCad/Altium archives, exercises the
answerable refusal flow, and now requires all 22 release stages.

## CAD release audit, 2026-09-05

The CAD path now uses the same product-wide assurance policy as SPICE: contradictions refuse,
answerable gaps ask, and unsupported claims remain named limitations. Five unresolved review
actions is the preferred interaction budget, not a reason to withhold otherwise correct output.
Reviews are semantic user decisions (pinout, package outline, or
complete copper pattern), not one glance per internal field. Package choice is explicit and the
file-producing route enforces the assurance contract again rather than trusting a disabled button.

The blind CAD corpus read 39/43 unseen cached datasheets and could ship 35/43 after safe answers;
31/43 needed no answer. The four unread documents remain named refusals rather than fabricated
parts. Across the current replay corpus, 77 records ship, 56 have a supported answer path, one is a
hard refusal, and 49 are stale historical prompt records that cannot be reconstructed and are not
counted as current reads.

Independent release checks opened every emitted KiCad library in KiCad 10 and all 146 emitted
Altium files with `pyaltiumlib`; the corruption bench caught all 13 output fault classes, the CAD
mutation bench killed 20/20 mutations, and published-footprint comparison left zero unexplained
outliers among 56 matches. The final product gate is **1,180/1,180 tests**, a clean TypeScript and
ESLint pass, a successful production build, and **22/22 required browser stages with 3/3 optional
paths and zero browser problems**.

Electrical pin types that a datasheet does not state remain `unspecified`: name-based inference was
measured and was too inaccurate to ship. The UI therefore names incomplete ERC coverage without
withholding correct symbol, pin-number, or copper output, and recomputes that limitation from the
editable record if the user supplies authoritative types. Native Cadence/OrCAD output remains an
explicit unavailable format, not a renamed or approximate deliverable.

`npm run bench:cad-opportunity` is the non-spend coverage-closure gate. It fails if a hand-read
drawing shows that Forge asked for a value it already held, dropped, or failed to read; it also
requires the complete 43-document blind corpus, at least 90% READ, at least 80% safe completion,
current cached readings, and no result above the five-action review budget. Hold-out questions are
not hand-labelled because opening those drawings would contaminate the only unseen CAD corpus.
They measure generalisation and outcome coverage; the separate tuned-corpus oracle measures whether
questions are avoidable.

`npm run bench:cad-release` adds false-confirmation, output-corruption, mutation, and independent
KiCad/Altium reader gates. `npm run bench:release` joins that with the SPICE capability, hold-out,
ngspice, official LTspice, production-build, and browser gates. A false CAD pinout/copper
confirmation or an over-budget release now exits nonzero; those benches previously printed the
failure while still returning success.

## SPICE coverage closure, 2026-09-05

Keep the approved suite flow. A SPICE refusal can now expose two different next
steps without adding a workflow stage: a fixed-regulator ordering option uses
the existing one-value question; a measured parameter the reader missed opens
the rendered specification pages and requires min/typ/max, printed unit, and
source page. Do not merge these paths. The former is user configuration with no
datasheet citation; the latter is a reviewed correction whose citation must
survive into the conformance receipt.

The exhaustive hold-out is 43 frozen parts for the free census and an exact
13-part set cover for paid second readings. The 31 risk cells and solver live in
`src/lib/spice/__bench__/coverage.ts`. Add a risk cell when a new class,
topology, document layout, qualification regime, or vendor mechanism enters the
product; do not add redundant parts merely to make the corpus look larger.

The current free floor is 25/43 automatic and 36/43 (84%) after the one safe
configuration answer. Instrumentation amplifiers remain an explicit safe
refusal until their external gain equation and resistor constant can be read
reliably. Do not replace that refusal with an assumed 50 kΩ or 100 kΩ constant.

The exact paid panel completed for $0.5842: all 13 received the independent
reading, five of eight buildable models fully agreed, and three remained
flagged for review. The complete browser release pass reaches all 22/22
required stages with zero browser problems. The full unseen conformance run records 201 passes, zero
failures and 85 unverifiable checks; the class-wide mutation pass produces 70
failures.

Every refusal now names a route: safe configuration, cited page review, vendor
model, declaration selection, or unusable vendor file. A no-class reading with
specification pages offers the four supported device descriptions; choosing one
reveals its required values and never infers the class from a part number. An
empty deterministic block can be seeded only by corrections carrying real PDF
page citations. The fallback vendor adapter covers arbitrary standalone
subcircuits plus every ordinary LTspice model-card contract that can be
instantiated without invented data: R/C (with an explicit instance value),
diode, BJT, JFET, MESFET, monolithic and vertical MOSFET, IGBT, voltage- and
current-controlled switch, lossy transmission line, and distributed RC (with
explicit length). LTspice does not recognize `L` as an inductor model-card
type. `npm run bench:model-capabilities` holds this strategy registry and runs
before the release gate; the official-LTspice stage executes every declared
contract and fails if its table drifts from the registry.

## Automatic recovery and vendor CAD import, 2026-09-06

The Suite begins official-resource discovery as soon as it knows a part and
manufacturer. Only links on the manufacturer's own product page and hostname
are returned. Supported direct resources and bounded archives can be imported
without a download/re-upload loop; an archive with several plausible files is
left as an explicit ordering-code choice rather than taking its first member.
Air-gapped mode returns no resources and never loads the network resolver.

Vendor `.kicad_mod` copper and Autodesk EAGLE/Fusion Electronics XML `.lbr`
packages are parsed with bounded source, token, compressed-download and
expanded-text limits. They become the same neutral
`FootprintGeometry` used by every emitter, including holes and pad rotations,
and then passes the normal terminal-set and geometry invariants at the export
boundary. Back-side footprints are refused rather than silently mirrored. The
manifest identifies the vendor file and records that there was no independent
copper corroboration; provenance is not upgraded merely because the source was
official.

When the same official archive contains a KiCad symbol, Forge independently
parses its numbered pin names. Exact agreement settles the single pinout review;
an exact disagreement is a contradiction and refuses the export. A library
containing several symbols is scoped to the requested part (including explicit
KiCad inheritance) before comparison, and an unscopable optional symbol is
treated as unavailable evidence rather than evidence against otherwise valid
copper. The vendor symbol never overwrites the extracted symbol. This
complements the existing rendered-page visual read and text-layer/package
checks with a source that fails differently.

An EAGLE library can provide the same independent check through its device
connection table. Forge uses it only when the requested part and selected
package identify exactly one device; similar package names and archive order
are never evidence. A disagreement is a contradiction at the export boundary,
while an unscopable device table remains optional evidence and does not discard
otherwise valid copper.

Ranked official resources are now attempted automatically for the selected
intent before the paid read can start. Failed URLs fall through inside the same
job. A unique part/package match is attached; several plausible archive members
remain a recognition-based user choice, because archive order is not evidence.
Async discovery/import is tied to the identified part so an old request cannot
attach a model or footprint after the user starts another part. Redirects are
rechecked both for SSRF safety and manufacturer-domain provenance.

Typing a part number now runs a free verified identification lookup before the
read, just as uploading a PDF does. This restores pre-read package selection and
lets official recovery run before spend. SPICE-only and combined requests no
longer require a browser-side upload: `/api/model` retrieves the public PDF,
checks that it names the requested part, and then uses the same byte-oriented
builder. Air-gapped deployments still require an upload.

Imported footprints now preserve arbitrary front-copper pad positions,
duplicate shapes on one terminal, rotations, round/oval/rectangular/rounded
shapes, plated and non-plated holes, slotted drills, paste/mask intent,
rounded-corner ratios, and explicit Fab/courtyard bounds. They pass the same
neutral-geometry and output-format gates as generated footprints; unsupported
features are refused rather than flattened.

Native Altium output now preserves rectangular and oval pads, slotted holes, and the stated per-layer
rounded-corner percentage, checked by the independent reader. EAGLE elongated
pads remain unavailable because Autodesk defines their aspect ratio through the
destination board's design rules rather than completely in the library; Forge
does not substitute the common 2:1 setting.

CI installs and executes ngspice before the simulator-aware test suite. A
manual macOS prerelease job unpacks the signed and notarized official Analog
Devices LTspice package without installing it, then runs every generated model
class and declared vendor-adapter contract in the real customer simulator.

A separate Linux prerelease job installs KiCad and asks `kicad-cli` to parse and
render every generated symbol and footprint. Four tracked records cover dual-
row SMD (including `no_connect`), rectangular quad plus thermal land,
through-hole, and grid-array placement on a clean checkout. An ignored local
replay cache adds breadth when present but is never the gate's only input.
`bench:cad-release` invokes that stage in gate mode, so a machine with no KiCad
fails rather than printing that it checked nothing and exiting green.

The Windows LTspice prerelease attempt installed successfully but every batch
process timed out without a log, consistent with a first-run GUI block. The job
now uses the already-proven macOS headless path. The harness treats timeout,
signal termination, and a missing simulation log as instrument failures and
stops immediately instead of reporting every artifact as rejected.

## Manufacturer STEP models, 2026-09-07

Treat STEP/STP as a 3D package-body resource, never as footprint copper. A
unique official file is imported automatically after part/package matching,
bounded and checked for complete ISO-10303-21 HEADER and DATA sections, then
preserved exactly. KiCad references that file; native Altium embeds it. Do not
parse arbitrary STEP transforms or units to invent metadata. Altium duplicates
the installed component height outside the model payload, so ask only for
`bodyHeightMm` when neither the datasheet nor an answer supplies it. The same
missing value must not withhold the valid KiCad bundle.

An imported official model replaces an unavailable approximate generated body;
it does not relax terminal, copper, or pinout assurance. Export request limits
are enforced on the actual UTF-8 body, not only a client-controlled
`Content-Length`. The local final state after repairing the manual prerelease
jobs is 1,253/1,253 tests, clean TypeScript and ESLint, and a successful
production build. Official LTspice accepted all 23 generated/emitted cases.
Official KiCad 10.0.5 plotted all 80 locally available footprints and opened
all 80 symbol libraries; the clean-checkout subset independently passed 4/4
footprints and 4/4 symbols. The workflow version of these two proofs still
requires a commit/push and a manual dispatch with `official_tools` enabled.
