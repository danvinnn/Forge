# SPICE model generation: groundwork

For Anthony, or whoever builds the second half of the product.

**This document does not decide anything.** It separates what is already decided
for you, by `RULES.md` and by code that ships, from what is genuinely open and
has to be answered before the first line is written. Where something is open it
says what bounds the answer and what it costs to get it wrong.

It exists because `src/app/suite/HANDOFF.md` describes the SPICE half in one
bullet, seam 4, and that bullet is a contract rather than a specification. The
contract is right. It is not enough to build from.

Written 2026-09-02, against the code as it stood that day.

---

## 0. What exists today

Verified 2026-09-02 by reading the tree, not by memory.

| Thing | State |
| --- | --- |
| `Intent = "cad" \| "spice" \| "both"` | `src/lib/intent.ts`. Exists. |
| The `SPICE model` chip and the intent-aimed read | `SuiteWorkspace.tsx`. UI only. |
| A stage name that changes with the intent | `readprogress.ts:88`. Display only. |
| `/api/model` | **Does not exist.** |
| A SPICE emitter | **Does not exist.** `src/lib/emitters/` holds `kicad.ts` and `altium/`. |
| A parameter type on the record | **Does not exist.** `PartRecord` carries `dimensions`, `pins`, `radiation`. |
| A SPICE field in `extractionFields` | **None.** All 38 entries are identity, package, pin or radiation fields. |
| `exportFormats` | `["kicad", "altium", "cadence"]`. Three board tools. Nothing for LTspice. |
| The SPICE panel in the suite | A placeholder reading "Netlist panel goes here." |

Every `netlist` in `src/lib` refers to schematic connectivity, not to SPICE.
There is no SPICE code in this repository.

**One live defect, in the UI, worth fixing whoever gets there first.** For
`intent === "spice"` the format picker is not rendered, so `format` keeps its
`"kicad"` default, and the button labelled "Take the model" posts `/api/export`
with `format: "kicad"` after a status line reading "Building the KiCad bundle".
It does not refuse. It builds the wrong thing. That is the 2026-08-28 defect
shape with the silence removed and a wrong answer put in its place.

---

## 1. The first decision: generate, or find?

**This is the one that decides whether the rest of the document is relevant, and
it is not answered anywhere.**

Seam 4 says "the SPICE emitter: deterministic templating over extracted
parameters". That presumes generation. But TI, ADI, Microchip and others publish
their own SPICE models for most of these parts, written and validated by the
people who designed the silicon. So there are two products here and they share
almost no code:

- **Generate.** Read parameters off the datasheet, template a subcircuit. Every
  parameter has to be read, confirmed under RULES.md 7, and defended. The output
  is ours and so is the responsibility for it.
- **Find, fetch and verify.** Locate the vendor's published model, check it is
  the right part and revision, present it with its provenance. Almost no
  extraction. The hard parts move to retrieval and to trust.

`RULES.md` 5 says simpler is usually more, and asks what would have to be true
for a thing not to be needed. For a part whose vendor publishes a validated
model, a generated one is a worse artefact produced at higher cost, and shipping
it alongside the vendor's is the product inviting a user to trust ours over
theirs.

`RULES.md` 6 says the engineer's expectation wins. **Go and find out what a
working analogue engineer does when they need a model for a part.** That answer
decides this, and neither this document nor the code can supply it.

**A likely shape, stated as a hypothesis and not as a decision:** fetch the
vendor's model where one exists, generate only where none does, and say plainly
on screen which of the two the user is holding. That has a real cost, which is
that the product then owns two paths, and `RULES.md` 5 is the argument against
it. It is written here so it is decided rather than defaulted into.

Nothing below matters until this is settled. If the answer is "find", most of
sections 3 through 8 are about the wrong product.

---

## 2. The second decision: which device classes

**A template is per class, and the class list is not written down anywhere.**

"SPICE model" is not one artefact. The tuned corpus alone spans op-amps
(`LMP7704-SP`, `OPA333`), a PWM controller (`NCP1200`) and an RF part
(`RHF310A`). An op-amp macromodel and a switching-controller model share no
topology, no parameter set and no validation method. One template does not cover
both, and there is no general "SPICE model of an arbitrary integrated circuit".

So the scope is a list of device classes, and each one costs a template, a
parameter set, a confirmation strategy and a bench. **Decide the list before
building the first one**, because the shape of `spiceModelSchema` depends on
whether it has to hold one class or five.

`RULES.md` 4 applies with force here. A template per device class is covering a
category. A branch added because one part came out wrong is tailoring to a
problem, and the test is the one the rule already states: can the rule be
written without naming a vendor, a part number or the symptom that prompted it?

**Start with one class, all the way through to a bench that can go red.** One
class finished is evidence the shape is right. Three classes half-built is the
same evidence as none.

---

## 3. What `RULES.md` already decides, and you do not get to choose

These are not open. They are the reason the CAD half is defensible and they
apply unchanged to parameters.

**Rule 1, do not invent.** Every parameter value comes from the datasheet, a
published standard, or a setting the user stated. A default gain-bandwidth for a
family, a "typical" figure carried over from a similar part, or a number chosen
because the simulation converged with it, is invention and does not ship. The
test is unchanged: name the source.

**Rule 2, do not assume.** This one is where a parameter path will fail first,
and it will not look like a failure. A datasheet prints min, typ and max for
almost every parameter. **Taking `typ` is not invention, and it is an
assumption.** Some engineers model worst case because the point of the
simulation is the corner. Nobody asked them which they wanted. Under rule 3 this
is either one right answer found from practice, or a setting, and it is decided
once rather than per parameter.

**Rule 3, read, ask, or offer a setting.** Nothing else. If the datasheet states
it, use it. If it does not and there is one right answer, find it from practice
and record the source. If it legitimately differs between users, it is a setting
on the first-run screen and it is settled before the first datasheet, not during
it. `src/lib/settings.ts` is the shape, and `SETTINGS_FIELDS` is where a new one
goes. Note what that file already knows: a field with a published standard
behind it may be left blank and blank names the standard; a field with no
standard is never defaulted and never required, because requiring it is what
made an engineer fabricate two numbers on 2026-08-28.

**Rule 4, general, never per-case.** See section 2.

**Rule 5, do not overengineer.** See section 1. Also: no second model call to
repair the first one's answer. That machinery was removed from the CAD path once
the reason for it was fixed at the source.

**Rule 7, nothing ships silently unless two independent sources agree.** This is
the invariant the product is judged on and it is section 4, because it is the
hardest thing in this document by a wide margin.

---

## 4. The confirmation problem

**`RULES.md`'s confirmation table has a row for every value that reaches a board
and no rows at all for parameters. This is the part to solve first, before any
templating, because it may change what the product is allowed to emit.**

The rule is not "check the value twice". It is that the two readings must be by
**different means**, so that they do not share a failure mode. A model that
misreads a rotated figure misreads it identically on a second call, which is why
a second model call is not a second source. Every pairing in `src/lib/confirm.ts`
is a reading against a different kind of reading: a model against text-layer
geometry, a printed drawing against IPC-7351B arithmetic, a pin table against a
lead count.

**Ask, for each parameter you intend to emit: what is the second means?** Some
candidates, none of them established, all of them needing measurement before
they are believed:

- The specification table against a characterisation curve on another page. Two
  genuinely different readings, and plausibly the strongest pairing available.
  Whether a curve can be read accurately enough to contradict a table is an
  empirical question and nobody here has measured it.
- The specification table against the text layer, the way `pinevidence.ts`
  corroborates the pinout. Cheap, deterministic, and it checks transcription
  rather than meaning.
- Cross-parameter consistency, for parameters that constrain each other by
  physics. Attractive, and it is the trap `RULES.md` names explicitly: **a bound
  that cannot fail is not a confirmation.** The worked example is the lead pitch,
  where "the lead row has to fit the body" sounded like a check and, measured
  across 94 correctly read parts, admitted almost every wrong pitch too. The
  bound was dropped rather than tuned. Any physics bound proposed here has to be
  measured against real readings before it counts, and dropped if it cannot fire.

**Three outcomes, and two of them are acceptable.** A parameter with a real
second source is confirmed and ships silently. A parameter with no second source
is flagged and the user sees it. A parameter that is flagged and pretends to be
confirmed is the one thing that must never happen.

**`MAX_FLAGGED` is 5 and it is Anthony's number from 2026-08-27.** Here is the
arithmetic that has to be faced honestly: an op-amp macromodel needs on the
order of ten to twenty parameters. If each is its own flagged item, every part is
over budget and every part is refused, and the SPICE half ships nothing.

So the unit of a flag has to be settled, and `confirm.ts` already shows how.
**The unit is a glance, not a field.** The pinout is one item whether the part
has 8 pins or 144, because a person checks a pinout against a figure in one
look. A parameter block read off one specification table is plausibly one glance
at that table. If that holds, the budget works. **If it does not hold, the honest
outcome is that this product refuses more parts than it serves, and that is
worth knowing before the emitter is written rather than after.**

Whatever is decided, `confirm.ts` is where it lives, `bench:confirm` is what
reports it, and the pairing table in `RULES.md` gains rows. A pairing that cannot
name two different means is not a confirmation, and `RULES.md` says to say so
rather than invent one.

---

## 5. The shape, by analogy

This part is low risk. The CAD path is a working answer to the same problem and
the SPICE path is the same pipeline with different fields. Follow it rather than
inventing a second architecture.

| CAD | SPICE counterpart | Note |
| --- | --- | --- |
| `extractionFields` in `extraction/contracts.ts` | the parameter field list | Field-directed. The reader is handed the fields and the pages. |
| `PackageDimensions` in `types.ts` | `SpiceParameters` | Every value an `Extracted<T>`, carrying value, confidence, method and citation. |
| `mergeModelValues` in `extraction/merge.ts` | same, unchanged | Where a model answer enters the record and is validated. |
| `confirm.ts` | new pairings, section 4 | The invariant. |
| `review.ts` | same, unchanged | The parameter and citation correction loop. `ReviewItem` is field-path based and already generic. |
| `geometry.ts` | no counterpart | A macromodel has no geometry. This is the one stage that drops out. |
| `emitters/kicad.ts` | `emitters/ltspice.ts` | Deterministic templating. No model writes the netlist. |
| `/api/export` | `/api/model`, or a format on `/api/export` | See below. |

**Every parameter is an `Extracted<T>`, with no exceptions.** That is what makes
`resolveForExport` able to refuse an untraceable value, what makes `review.ts`
able to show the page it came from, and what makes the record signable. A
parameter stored as a bare `number` is outside every guarantee the product
makes.

**`/api/model` or a format on `/api/export`?** Open, and lower stakes than it
looks. `exportFormats` is `["kicad", "altium", "cadence"]`, all board tools, and
a fourth member of a different kind may or may not belong there. The thing that
matters is that whichever route serves it applies `resolveForExport` and the same
refusal codes, because that gate is where traceability is actually enforced.

**The `both` bundle is unspecified.** One zip with a library and a model in it,
or two downloads. Decide it, then the button label follows.

---

## 6. The refusal contract, which is already decided

Reuse it verbatim. `/api/export` answers with the fields it could not stand
behind rather than a sentence, and the suite already renders three of the four:

| Code | Means |
| --- | --- |
| `INPUT_REQUIRED` | Your line has to answer this. Named fields, answered once in settings. |
| `UNTRACEABLE_EXTRACTION` | Read, but not locatable on any page. Refused for sign-off. |
| `INCOMPLETE_EXTRACTION` | The datasheet does not state it. |
| `FORMAT_CANNOT_ENCODE` | This format cannot carry this name. Suggests one that can. |

Seam 4 already states the contract correctly: a parameter the datasheet does not
state is asked for by name, or the model is refused. **Do not add a fifth code
for parameters until one of these genuinely does not fit.**

---

## 7. What LTspice actually consumes

**`HANDOFF.md` says "the `.asc` symbol" and that is wrong.** In LTspice `.asy` is
the symbol file and `.asc` is a schematic. The error is corrected in this
document and should be corrected there.

Settle the file set before the emitter, because it determines the bundle:

- The model text itself, as a `.subckt` block. Whether it ships as `.lib`,
  `.sub` or `.mod`, and whether that choice affects how LTspice resolves it.
- The `.asy` symbol, so the part can be placed rather than only referenced.
- **Whether the `.asy` pin order must agree with the CAD symbol this product
  emits for the same part.** If a user takes both, two artefacts from one tool
  that disagree about pin order is the worst failure available here, and it is
  silent.
- Whether anything has to be written into a library index for LTspice to find
  the model, or whether a file in the right folder is enough.

**Confirm every one of these against the real tool, not against documentation
and not against a parser.** `LEARNINGS.md` records why: `kiutils` and AltiumSharp
both accepted a symbol library that KiCad refuses to open, and `bench:kicad`
exists because of it. The SPICE equivalent is running LTspice, or ngspice where
LTspice cannot be driven headlessly, over the emitted netlist and confirming it
simulates. **An independent reader is not the customer's tool.**

---

## 8. The instruments

`RULES.md` is explicit that an instrument that cannot fail is not a check, and
`LEARNINGS.md` records four green checks that could never have gone red plus a
copper bench blind to a land moved 0.9 mm on 66 of 80 footprints. Build the
benches with the feature, and prove each one can go red.

At minimum:

- **`bench:model`.** Does the emitted netlist simulate in the real tool? This is
  `bench:kicad`'s counterpart and it is the one that decides whether any of this
  works.
- **A parameter accuracy bench**, the counterpart of `bench:dimensions`. Are the
  numbers read the right numbers? Needs hand-read ground truth on the tuned
  corpus, and that work is the real cost.
- **A behavioural bench.** A netlist can be syntactically valid, simulate
  cleanly, and be wrong. Does the model exhibit the gain-bandwidth the datasheet
  states? This is the SPICE-specific instrument with no CAD counterpart, and it
  is the only one that checks the artefact against what it claims to be.
- **`bench:instruments` must cover every one of them.** It refuses the run if an
  injected defect changes nothing, and that is what stops a new bench joining the
  four that were green for weeks.
- **A row of zeros is not a pass.** Where a bench had nothing to measure it says
  `NO DATA`.

---

## 9. What not to do

Each of these has already cost this project something, on the CAD side.

- **Do not let a model compute.** It reads; generation stays deterministic. A
  model asked to write a netlist will write a plausible one, and plausible is the
  failure mode this whole product exists to refuse.
- **Do not carry a parameter across parts in a family.** That is the hand-typed
  family table that `packages.ts` used to be, and deleting it is what let SOT-23
  and LFCSP work at all.
- **Do not widen a bound until a document passes.** Tailoring to a datasheet.
- **Do not add a second model call to work around a refusal.** Remove the reason
  for the refusal instead. The CAD pipeline made three calls per part until the
  third one's reason was fixed and the call was simply deleted.
- **Do not open the hold-out corpus.** Not to diagnose a SPICE failure, not as a
  subset, not once. A hold-out part that must be examined is promoted into the
  tuned corpus and replaced. `holdout.ts` starts a measurement the moment it is
  imported.
- **Do not ship a generated model beside a vendor's without saying which is
  which.** See section 1.

---

## 10. Suggested order

1. Answer section 1. Generate, or find. Everything else depends on it.
2. Answer section 2. One device class, named.
3. Answer section 4 on paper, for that class. What is the second means for each
   parameter, and does the flag budget survive? **If it does not, stop here and
   say so.** That is a real and reportable outcome, and it is far cheaper found
   now than after an emitter exists.
4. Settle section 7 against the real tool, with a throwaway netlist written by
   hand. No extraction involved. This proves the target before anything aims at
   it.
5. Build `bench:model` against that hand-written netlist, and prove it goes red.
6. Then, and only then, the field list, the record type, the emitter and the
   route.
7. The suite's SPICE panel and its review screen last. `HANDOFF.md` lists it as
   still open, and it should stay open until there is something real to review.

---

## 11. The open questions, collected

For whoever wants the list without the argument.

1. Generate models, retrieve the vendor's, or both? (§1)
2. Which device classes, and which one first? (§2)
3. `min`, `typ` or `max`? One right answer, or a setting? (§3, rule 2)
4. What is the second independent means for each parameter? (§4)
5. Is a parameter block one flagged item or many, and does the budget survive? (§4)
6. `/api/model`, or a fourth `exportFormat`? (§5)
7. What is in the `both` bundle? (§5)
8. Which files, and must the `.asy` pin order match the CAD symbol? (§7)

Questions 1, 2 and 4 are decisions about the product. The rest follow from them.

---

**When any of these is answered, record it here with its date and its reason, the
way `RULES.md` and `LEARNINGS.md` do.** A decision without its reason gets
re-litigated by the next person, and this document exists so that does not
happen twice.

---

# Part II: the decisions

Answered 2026-09-03, against measurements taken that day. Every claim below was
run, not reasoned. The reasons are recorded because §11 asks for them.

## 12. The eight questions, answered

### Q1. Generate, retrieve, or both? BOTH, and they are not two paths.

§1 framed these as two products sharing almost no code, and argued under rule 5
against owning both. That framing had a gap: it compared two SOURCES of a model
and never asked what CHECKS one.

**The shared component is a conformance harness**, which simulates a model and
compares its measured behaviour against the datasheet's own specification table.
Fetch and generate are then two sources feeding one verifier, not two products.
Rule 5 is satisfied because there is one artefact and one gate.

Measured 2026-09-03 on TI's own OPA333 model:

| spec | datasheet | TI's model | result |
| --- | --- | --- | --- |
| open-loop gain | 130 dB typ, 106 min | 127.13 dB | pass |
| gain-bandwidth | 350 kHz at CL=100pF | 352.86 kHz | 0.8% |
| input offset voltage | 2 uV typ | 2.00 uV | exact |
| quiescent current | 17 uA typ | 17.0 uA | exact |
| slew rate | 0.16 V/us at G=+1 | not cleanly measurable | open, see §13.5 |

The datasheet numbers were read out of the real PDF with the repository's own
`pdf-parse`. The model was TI's published `SBOC084`, unmodified.

**§1's premise that nobody generates from a published topology is false, and TI
disproves it in its own file.** `OPAx333.LIB` line 26:

    * Created with Green-Williams-Lis Op Amp Macro-model Architecture

A named, published architecture, parameterised from the datasheet. Their own
changelog records the conformance loop being run by hand: "Updated Aol to match
the GBW and UGB as per the datasheet", "Updated CMRR DC gain as per the
datasheet".

**This also settles rule 1, which was the original objection.** Rule 1 permits
"a published standard" as a source. The CAD half already ships structure found
in no datasheet: courtyard excess, fillets, annular ring, paste windowing, all
from IPC-7351B and IPC-7251. A macromodel is the same shape. The topology is a
published architecture applied uniformly and cited by name; only the parameters
come from the document.

One asymmetry is recorded rather than glossed: IPC-7351B is normative, whereas a
macromodel architecture is a published technique and different techniques give
different answers. That weaker footing is paid for by something the CAD half
does not have. **A model is executable, so its output can be tested.** A
footprint cannot be, short of building the board.

### Q2. Which device classes, and which first? OP-AMPS FIRST.

Then, in order: voltage references, comparators, LDOs, discretes, and data
converter analog front ends.

Op-amps first because the corpus is thick with them, the topology is published,
every parameter that matters is verifiable by a small-signal analysis, and the
rad-hard wedge (RHF310, LMP7704-SP) is op-amps.

**Data converters are IN, and an earlier claim that they were impossible was
wrong.** TI has shipped SAR ADCs with SPICE models since 2012 and ADI publishes
the analog input model as standard practice. What is modelled is the ANALOG
INPUT, a sampling capacitor, a switch resistance and the reference charge model,
and those values are printed in the analog input section of every SAR datasheet.

**The boundary is not a list of part categories. It is which question the model
answers:**

| question | verdict |
| --- | --- |
| analog behaviour at the pins | ours |
| digital I/O edge behaviour, for signal integrity | IBIS, a different format. Out, and refused by name. |
| digital functional behaviour | not SPICE, for anyone |

MCUs and FPGAs are out because the question asked of their pins is answered by
IBIS, not because nothing can model them.

### Q3. min, typ or max? ALL THREE, as parameters the user sweeps.

Not one right answer and not a setting.

**Verified 2026-09-03: TI's OPA333 model contains zero occurrences of min, max,
corner, Monte Carlo, .step or dev/gauss.** Vendor macromodels describe one
silicon sample, the typical one. The datasheet prints min and max in almost
every row, and nobody's model uses them.

Worst-case circuit analysis is a named deliverable in aerospace with its own
standard (Aerospace Corporation TOR-2012(8960)-4), covering manufacturing,
environmental, aging and radiation tolerances. Engineers currently hand-edit
vendor models to get corners.

So the emitted model exposes its parameters and the engineer sweeps them:

    .param CORNER=typ
    ... AOL={aol_{CORNER}} GBW={gbw_{CORNER}} ...

`.step param` is the native LTspice idiom for this, so the mechanism is the
tool's, not ours.

**We do not pick the worst case, and this is rule 2, not a limitation.** Which
corner is worst depends on the circuit, not on the part. Choosing one for the
user is the midpoint-of-the-body-length mistake exactly. We supply the corners.
The engineer, who knows the circuit, chooses.

This makes the generated model MORE traceable than a vendor's, not less: min and
max are read from the document's own columns with citations, and typical is the
only number a vendor gives.

### Q4. What is the second means for each parameter? PROPOSED, NOT YET MEASURED.

The pairing is the specification TABLE against a characterisation CURVE on
another page. Different pages, different representations, different failure
modes. This is §4's own strongest candidate and it remains unmeasured. **It must
be measured before it is believed**, and if a curve cannot be read precisely
enough to contradict a table, parameters ship flagged and Q5 decides whether
that is affordable.

**A new requirement §4 did not have: a parameter without its TEST CONDITIONS is
not a usable parameter.**

Found the hard way on 2026-09-03. The first conformance run read 461 kHz against
a 350 kHz spec, a 32% miss, and was very nearly reported as TI's model failing
its own datasheet. The datasheet prints `CL = 100 pF` directly beside the
number. Applying it gave 352.86 kHz.

A conformance check that does not reproduce the datasheet's stated conditions
measures nothing. The conditions are printed next to the value, so this is a
READING problem, which is the thing this product is already good at. Every
parameter carries its conditions or it is not emitted.

### Q5. One flagged item or many? ONE GLANCE, so ONE SPEC BLOCK.

A parameter block read off one specification table in one look is one item, the
same way a pinout is one item whether the part has 8 pins or 144.

Estimated 2 to 3 items for an op-amp: the specification block, the pinout, and
the supply or topology choice where one is needed. Inside `MAX_FLAGGED`.

**If measurement contradicts this, §10 step 3 applies: stop and say so.** That
outcome stays live until the parameter bench reports.

### Q6. `/api/model` or a fourth export format? A FOURTH FORMAT.

`resolveForExport` runs before the format branch, so a format inherits the
traceability gate and the four refusal codes for free. A new route would
re-implement the one gate where traceability is actually enforced.

### Q7. What is in the `both` bundle? ONE ZIP, with a folder layout.

LTspice resolves models by relative path, so the bundle must survive being
dropped somewhere as a unit.

### Q8. Which files, and must the `.asy` pin order match the CAD symbol?

Three files: the model as a `.subckt` inside a `.lib`, our own `.asy` symbol,
and the CAD library the part already produces.

**We emit our own `.asy` with explicit pin geometry rather than referencing a
stock LTspice symbol.** Evidence: a tool written for nothing but LTspice
documents exact pin offsets for resistors, capacitors, inductors, voltage
sources, diodes, NPN and PNP, and then gives up on op-amps with "pins vary by
model, read existing WIRE endpoints in the file to find positions". Pin geometry
is per-symbol data and is not derivable from convention.

Because we define it, §7's silent-disagreement failure is preventable by
construction: **one internal terminal list feeds the CAD symbol, the `.asy` and
the `.subckt` port order.** The three orderings are then different views of one
list rather than three independent claims.

## 13. What was settled about the tooling

### 13.1 The verifier is ngspice, not LTspice

LTspice cannot be driven headlessly. ngspice 47 runs TI's production PSpice
models unmodified once PSpice compatibility is enabled:

    set ngbehavior=ps        (in .spiceinit)

Without it the model dies on `Undefined parameter [temp]`. With it, it
simulates. **Encryption is not a blocker for TI**, whose models are plaintext.
ADI's library is largely encrypted and is UNTESTED; that decides how much of the
fetch path works for their parts and is an open question.

### 13.2 Conformance is an OUTPUT INVARIANT, not a confirmation

These are two different questions and conflating them would put a false entry in
`confirm.ts`:

- **Confirmation** asks whether the value was READ correctly. Table against
  curve. Lives in `confirm.ts`. Rule 7.
- **Conformance** asks whether the emitted model EXHIBITS the value that was
  read. Simulation. Lives with `validateGeometry` as a gate on the export.

Conformance cannot confirm a reading, because a model built from a misread
number will reproduce that misread number perfectly.

### 13.3 Encoding, taken from prior art

LTspice files are frequently UTF-16LE with a BOM, and SPICE values are full of
`u` and degree signs. Detect the BOM, fall back to UTF-8, then fall back to
Latin-1 mapping each byte to its code point so those characters survive. Write
back in the encoding that was read.

### 13.4 The `Meg` trap

In SPICE, `Meg` is 1e6 and `m` is 1e-3, and suffixes are NOT case sensitive, so
`M` means milli. Emitting `1M` for a megohm produces a milliohm, a 1e9 error.

**This is the one defect class that would pass every gate this product has.**
The value is read correctly, cited correctly and confirmed by two independent
sources, then formatted wrong on the way out. It needs a test the day the
emitter exists.

### 13.5 Large-signal transient specs are second tier

AC and DC specs (gain, bandwidth, offset, quiescent current, CMRR, PSRR)
automate cleanly. Slew rate, settling and overload recovery need the datasheet's
specific test circuit; a generic rig is defeated by capacitive feedthrough
through the open-loop output impedance, which for OPA333 the datasheet gives as
2 kOhm. Ship the AC and DC block first and treat transient specs as their own
piece of work.

## 14. Build order

Replaces §10, which assumed §1 was unanswered.

1. **The conformance harness**, over a FETCHED vendor model. No extraction. This
   is §8's behavioural bench and it exists in prototype already. Prove it goes
   red.
2. **The parameter block on the record**, every value an `Extracted<T>`, each
   carrying its test conditions. Op-amps only.
3. **Measure Q4.** Table against curve. If the pairing does not hold, report it
   and stop for a decision rather than proceeding on hope.
4. **The emitter**: `.subckt`, `.asy`, one terminal list behind all three
   orderings. Gate on conformance and on the `Meg` test.
5. **The corner parameters**, once a single-corner model conforms.
6. **The fourth export format and the refusal codes.**
7. **The suite panel, last.** It should stay a placeholder until there is
   something real to review.

## 15. What remains open

- **Q4 is unmeasured.** The confirmation pairing is proposed, not established.
- **ADI encryption is untested**, and decides the fetch path's reach for their
  parts.
- **Slew rate has no working measurement**, only a method that is known to be
  defeated by feedthrough.
- **Demand for generated corner models is unverified.** The strategic case for
  the generate half rests on it. Aerospace worst-case analysis is a documented
  mandated deliverable; that rad-hard designers would pay us to serve it is an
  inference, not a finding.
- **The live defect in §0 is still live.** For `intent === "spice"` the format
  picker is not rendered, `format` keeps its `"kicad"` default, and the button
  builds a KiCad bundle after saying it is building a model.

---

## 16. Chasing the three unknowns, 2026-09-03

### 16.1 Slew rate: the MEASUREMENT is solved, the SPEC is not reproducible

The rig was being defeated by capacitive feedthrough: a fast input edge couples
straight to the output through the open-loop output impedance, which the OPA333
datasheet gives as 2 kOhm. A naive `when v(out)=X rise=1` finds that spike, not
the amplifier, and reports 4 V/us for a 0.16 V/us part.

**The fix, and it is general:** ignore a guard interval after the input
transition, then take the maximum SUSTAINED slope over a sliding window rather
than an instantaneous derivative. On OPA333 that cleanly separates a -0.675 V
instantaneous feedthrough step from real slewing.

Measured that way: **0.238 V/us against a datasheet 0.16 V/us, 49% high.**

**But the datasheet states only `G = +1` as the condition.** No step size, no
load, no output excursion. Two engineers measuring this spec from what the
document prints would get different answers, and so would we.

**This forces a third verdict.** PASS and FAIL are not enough:

| verdict | meaning |
| --- | --- |
| `pass` | reproduced under the datasheet's stated conditions |
| `fail` | reproduced under those conditions and disagreed |
| `unverifiable` | the datasheet does not state enough of the test circuit |

`unverifiable` is an honest and common outcome, and reporting it as `fail` would
accuse a correct model. It is the same discipline as flagging rather than
guessing, applied to conformance instead of to reading.

### 16.2 Demand: real for datasheet-derived models, still inferred for rad-hard

Found, from engineers rather than from vendors:

- "Not everything has a model and that is why, sometimes, you have to build your
  own."
- Vendor models are built from by hand when "the manufacturer own model does not
  work."
- The stated reason for wanting a hand-built model is to "study a circuit to see
  what happens if you change the Op Amp slew rate or bandwidth, offset, and so
  on." **That is parameter sweeping, which is the corner-model use case in the
  engineer's own words.**
- The published hand-build recipe uses a behavioural VCVS core with input R and
  C, an output series resistance and an offset source, and takes both TYPICAL
  and MAXIMUM values off the datasheet. That is the topology verified in §13 and
  it confirms the min/max reading of Q3.

**Still not found: a rad-hard engineer saying they need this.** The one TI forum
thread that would have said so returns 403 to automated fetching. So the
generate half still rests on an inference, exactly as §15 records. Unchanged and
still the biggest open risk.

### 16.3 ADI encryption: BLOCKED, not answered

analog.com refuses automated fetching, the same way st.com does: curl returns no
response at all and a fetch times out. Nothing was measured.

One indirect signal, worth exactly what it is: ADI's standalone per-part `.cir`
files are described in their own documentation as text files that open in a
plain editor, which would mean the ENCRYPTION IS IN THE BUNDLED LTSPICE LIBRARY
and not in the published per-part models. If that holds, the fetch path reaches
ADI's parts after all.

**Confirming it takes one person opening one `.cir` URL in a browser.** It is
the cheapest open question in this document and it is not answerable from here.

---

## 17. LICENSING, which inverts the risk in this document

Found 2026-09-03, and it is the most consequential thing in Part II.

**Not legal advice. This needs a lawyer before anything ships.** What follows is
what the documents say and what it means for the ARCHITECTURE.

### 17.1 What the two vendors actually grant

The reason analog.com could not be fetched is not a block on automation. **The
file sits behind a click-through licence agreement**, which also means it cannot
be accepted programmatically on a user's behalf.

**ADI, explicit terms:**

- GRANTS redistribution: "You may include copies of Analog Devices' SPICE models
  with any software you sell or distribute."
- FORBIDS selling, loaning, renting, leasing or licensing the model itself to
  anyone outside your company.
- FORBIDS any change to a redistributed copy "that affect[s] the performance or
  function of the model". Only two changes are allowed: adding COMMENTS, and
  changing NOMENCLATURE so it runs on your software.
- CARVES OUT third-party models inside their library, which "may not be
  redistributed" at all, and which we may have no reliable way to identify.

**TI, from the model header:**

- "(C) Copyright 2022 Texas Instruments Incorporated. **All rights reserved.**"
- A warranty disclaimer, and nothing else. **No redistribution grant appears
  anywhere in the file.**

So the vendor whose models we proved we can run is the one that grants us the
least, and the vendor we could not fetch is the one that explicitly permits
bundling.

### 17.2 This inverts §14's premise

Part II ordered the build as fetch-first BECAUSE fetch carried no invention
risk. That is still true technically, and it is now false commercially:

| half | technical | legal |
| --- | --- | --- |
| fetch and verify a vendor model | PROVEN | CONSTRAINED, and unclear for TI |
| generate from the datasheet | UNPROVEN | CLEAN. The topology is published and the parameters are the customer's own datasheet. |

**The generated model is the one we unambiguously own.** That is a reason to
build it that has nothing to do with rad-hard coverage, and it did not exist in
this document an hour ago.

### 17.3 The resolution: VERIFY, do not REDISTRIBUTE

The product value was never the vendor's file. It is the receipt. So:

- **Vendor models are verified, not shipped.** Either the user supplies the copy
  they already downloaded, or we point them at the vendor's own link and verify
  what they bring back. No redistribution, so no licence to breach, and no
  click-through to accept on anyone's behalf.
- **The conformance report is a SEPARATE artefact.** Never edits into the
  vendor's file. ADI permits comments, TI grants nothing, and a separate file is
  clean under both.
- **Corner models are GENERATED, never modified from a vendor's.** Changing typ
  to max is precisely the "change that affects performance or function" ADI
  forbids. Q3 already landed here for engineering reasons; the licence makes it
  mandatory.
- **Every fetched model carries its licence terms on the record**, the same way
  every value carries a citation. A model whose terms are unknown is treated as
  not redistributable.

This costs nothing that matters. The user ends up with the same model and a
receipt no one else offers, and Forge never becomes a distributor of someone
else's copyrighted file.

### 17.4 What still needs a lawyer

- Whether verifying a vendor model server-side, without redistributing it,
  requires accepting their agreement at all.
- Whether TI's silence on redistribution forbids it or merely fails to grant it.
- Whether an air-gapped enterprise deployment changes any of the above.

### 17.5 The decision, stated precisely. Amends §14.1.

The "fetch" half was three separate things and collapsing them cost a correction.
Only ONE of them is dropped.

| | what it is | verdict |
| --- | --- | --- |
| **2a** | ship the vendor's model file to the user | **DROPPED** |
| **2b** | say that a vendor model exists, and link it | **KEPT** |
| **2c** | verify a model the user already has | **KEPT** |

**2a is dropped, and it is a business decision rather than a technical one.**
TI's terms do not grant redistribution and ADI's grant carries a third-party
carve-out we cannot reliably detect. Neither is a wall: vendors do grant
redistribution to tool companies, and the way to open it is to ask them in
writing. It is declined for now because it buys us a file the user can fetch
themselves in one click, and it buys nothing at all in rad-hard, where our
market is and where vendor models do not exist.

**2b is kept because withholding it would be dishonest.** If a vendor publishes
a model built from measured silicon and we hand over ours built from spec-sheet
numbers without mentioning theirs, we have withheld the better artefact. Rule 6:
the engineer's expectation wins, and their expectation is to be told. It costs a
link.

**2c is kept because it is the differentiated half and it is licence-clean.**
The user already holds the file; we are not distributing anything. TI's own
engineers publish "trust but verify" guidance and nobody automates that check.
It is also not a second path under rule 5: the harness must exist for our own
generated models, and a user-supplied file is a different INPUT to it, not a
parallel pipeline.

**§14.1 stands, with its role renamed.** Running the harness over a fetched
vendor model remains the first build step, but as a PRIVATE BENCHMARK during
development, the way the hand-read pinout oracles work. If our generated OPA333
conforms as well as TI's does, the generator is good enough. That is a yardstick
on a developer's machine, not a shipped path, and it raises no licence question.

**What would reopen 2a:** written permission from a vendor. Worth asking only if
users ask for the file itself rather than for a model that works.

---

## 18. Verification pass, 2026-09-04

Every checkable claim in Part II, run rather than reasoned. Two broke.

### 18.1 BROKEN: the corner syntax in Q3 does not work

§12 Q3 wrote:

    .step param CORNER typ min max

**That is not valid syntax.** `.step` takes numeric values, not names. Worse,
the corrected numeric form also fails:

    .step param CORNER 1 3 1
    -> Error on line 17: Simulation interrupted due to error!
       Error: incomplete or empty netlist

**ngspice's `.step` does not re-evaluate `.param` expressions that depend on the
stepped parameter.** Since the whole point is that one stepped value drives every
other parameter, plain `.step` cannot express a corner in ngspice.

**What does work, measured:** `alterparam` plus `reset` inside a `.control`
loop. Three corners, every parameter moving together, no combinatorial blow-up:

| CORNER | Aol target | Aol measured | GBW target | GBW measured |
| --- | --- | --- | --- | --- |
| 1 (typ) | 120 dB | 120.000 dB | 1.000 MHz | 1.0000 MHz |
| 2 (min) | 106 dB | 106.021 dB | 700 kHz | 700.05 kHz |
| 3 (max) | 120 dB | 120.000 dB | 1.300 MHz | 1.3001 MHz |

**But this splits our verifier from the customer's tool, and that is the real
finding.** `alterparam` is an ngspice control-language command. The file we EMIT
is run by the user in LTspice, where `.step param` with dependent parameters is
ordinary practice and probably works fine.

So:

- **Our conformance harness**: `alterparam` loop. PROVEN.
- **The emitted model's corner mechanism in LTspice**: UNVERIFIED. LTspice is
  not installed here and ngspice cannot answer for it.

`LEARNINGS.md` already records why this matters: an independent reader is not the
customer's tool, and `bench:kicad` exists because `kiutils` accepted a library
KiCad refuses to open. **This is the same shape, found before the emitter was
written instead of after.** §14 gains a step: settle the corner mechanism against
real LTspice before the emitter templates it.

### 18.2 REFINED: Q6's claim about the traceability gate

The claim was that `resolveForExport` runs before the format branch, so a fourth
format inherits the gate for free. Checked in `src/app/api/export/route.ts`:

| line | what happens |
| --- | --- |
| 86 | format string validated against the three known values, 400 otherwise |
| 107 | `resolveForExport` runs |
| 256 | `createExportZip` builds the bundle for that format |

So resolution happens after the string check and **before** the per-format
emission. The claim holds for the branch that matters, but adding a format is
three edits, not one: `exportFormats`, the guard at line 86, and
`createExportZip`. Recorded so nobody discovers the guard by returning a 400.

### 18.3 CONFIRMED: the live defect in §0 is still live

Precisely, in `src/app/suite/SuiteWorkspace.tsx`:

- line 155: `const [format, setFormat] = useState<ExportFormat>("kicad")`
- line 446: `const showCad = intent !== "spice"`, which hides the format picker
- line 803: the button reads "Take the model" and calls `takeTheBundle()`

`format` is never reassigned for a SPICE intent, so it stays `"kicad"`. The
button labelled "Take the model" builds a KiCad library. Unchanged since
2026-09-02.

### 18.4 CONFIRMED, no change needed

| claim | result |
| --- | --- |
| `exportFormats` is the three board tools | `types.ts:6`, confirmed |
| all four refusal codes exist | confirmed, no fifth needed |
| `MAX_FLAGGED = 5` | `confirm.ts:109`, confirmed |
| `Extracted<T>` carries value, confidence, method, citation | `types.ts:759`, confirmed |
| `validateGeometry` is the output gate | `confidence.ts:978`, confirmed |
| `bench:instruments` exists to police new benches | `package.json:43`, confirmed |
| ngspice runs vendor PSpice models | confirmed, `set ngbehavior=ps` |
| `pdf-parse` can read the spec table | confirmed, used to read OPA333 |

`bench:model` does not exist yet, as expected.

### 18.5 What this pass changes about the plan

The plan is sound in shape. One mechanism in it was wrong and is now right for
the verifier and **openly unverified for the customer's tool**, which is the
honest state and the cheapest possible moment to have learned it.

**§14 gains a step, before the emitter:** install LTspice, hand it a corner model
written by hand, and confirm it steps. No extraction involved. This is §10 step 4
applied to the thing Part II added.

---

## 19. Generation, measured end to end, 2026-09-04

§18.5 said the plan's core was untested. It is now tested. **It works, and one
design assumption in Part II was wrong.**

Target: OPA333. Inputs: only values read from SBOS351E with `pdf-parse`.
Topology: the published behavioural macromodel. No vendor model consulted.

### 19.1 WRONG: "deterministic templating over extracted parameters" is not enough

Seam 4 and §12 both assumed generation means substituting datasheet values into
a template. **Measured, that misses by 20%:**

    direct substitution -> Aol 128.38 dB (target 130), GBW 279.9 kHz (target 350 kHz)

The cause is physical and general, not an OPA333 quirk. **A datasheet parameter
is measured AT THE OUTPUT, UNDER A LOAD.** OPA333's open-loop output impedance is
2 kOhm and its GBW is specified into 100 pF, so the stated 350 kHz already
contains a divider and an extra pole. Substituting 350 kHz as the model's
INTERNAL bandwidth therefore produces a part that is 20% slow at its pins.

**The fix converges in two iterations:**

| iter | internal Aol dB | internal GBW | measured Aol | measured GBW | error |
| --- | --- | --- | --- | --- | --- |
| 0 | 130.000 | 350.0 kHz | 128.381 | 279.9 kHz | -20.03% |
| 1 | 131.619 | 437.6 kHz | 130.003 | 343.2 kHz | -1.93% |
| 2 | 131.616 | 446.3 kHz | 130.001 | 349.3 kHz | **-0.20%** |

**So generation is a FIT, not a substitution: solve for the internal parameters
whose LOADED behaviour reproduces the datasheet's stated numbers under the
datasheet's stated conditions.**

This stays inside the rules. It is deterministic, no model is involved, and the
target of the fit is the document's own number, so rule 1's "name the source" is
answered by the datasheet exactly as before. It is also what TI does by hand;
their changelog reads "Updated Aol to match the GBW and UGB as per the
datasheet".

**And it makes the harness structural rather than a check bolted on the end.**
The generator is a loop around the verifier. §13.2's separation still holds:
conformance proves the model exhibits what was read, and it still cannot prove
the reading was right.

### 19.2 The generated model conforms, on every corner

| corner | Aol | GBW | Vos | Iq |
| --- | --- | --- | --- | --- |
| typ | 130.001 dB (130) | 349.3 kHz (350) | 2.000 uV (2) | 17.0 uA (17) |
| min | 106.032 dB (106) | 349.3 kHz | 10.00 uV (10) | 17.0 uA |
| max | 130.001 dB | 349.3 kHz | 10.00 uV | 25.0 uA (25) |

Datasheet values in brackets. Every corner lands on its own column.

**GBW does not move across corners, and that is correct.** SBOS351E prints only
a typical for it. **A corner exists only where the document publishes a range**,
so the model corners exactly as far as the datasheet knows and no further. That
falls out of the design rather than needing a rule.

### 19.3 Against TI's own model

| spec | datasheet | TI's model | ours, generated |
| --- | --- | --- | --- |
| Aol | 130 dB typ | 127.13 dB | **130.00 dB** |
| GBW | 350 kHz | 352.86 kHz | 349.30 kHz |
| Vos | 2 uV typ | 2.00 uV | 2.00 uV |
| Iq | 17 uA typ | 17.0 uA | 17.0 uA |
| corners | printed in the document | **none** | **all three** |

**On these four specs our generated model tracks the datasheet at least as
closely as TI's does, and it carries corners TI does not ship.**

### 19.4 What this does NOT establish, stated plainly

**Ours is a far smaller model than TI's and the table above flatters it.** TI's
465 lines carry roughly 25 blocks: noise, ESD structures, CMRR, PSRR, Vos drift
against temperature, Vos against common-mode voltage, output swing clamps, short
circuit current, supply-dependent quiescent current. Ours models six things.

So ours will be WRONG where TI's is right: near the rails, in noise analysis, over
temperature, and on common-mode effects. Four specs conforming is not a model of
equal quality, and saying otherwise would be the "plausible" failure this product
exists to refuse.

**The path is additive and each block is verifiable the same way**: a block is
added only for a spec the datasheet publishes, and it ships only once the harness
reproduces that spec. What ships first is a model that is honest about covering
gain, bandwidth, offset, slew, output impedance and supply current, and nothing
else.

---

## 20. LTspice, settled against the real tool, 2026-09-04

§18.1 left the corner mechanism proven in ngspice and unverified in the
customer's tool, and §14 gained a step to close it. **Closed.**

**LTspice runs headless here and needs no admin rights.** `LTspice.pkg` from
ltspice.analog.com, unpacked with `pkgutil --expand-full`, binary at
`LTspice.app/Contents/MacOS/LTspice`, run as `LTspice -b <file>.net`. It is
LTspice 17.2.4 for MacOS. Passing no arguments opens the GUI and hangs, so batch
mode is not optional here.

### 20.1 The corner mechanism works in LTspice

Same model text, both simulators, same answers:

| corner | target GBW | LTspice | ngspice | target Aol | LTspice |
| --- | --- | --- | --- | --- | --- |
| 1 typ | 1.000 MHz | 1e+06 | 1.00000e+06 | 120 dB | 120 dB |
| 2 min | 700 kHz | 700093 | 7.00046e+05 | 106 dB | 106.021 dB |
| 3 max | 1.300 MHz | 1.30017e+06 | 1.30008e+06 | 120 dB | 120 dB |

`.step param CORNER 1 3 1` with dependent `.param` expressions is honoured by
LTspice, which ngspice cannot do. **Q3's mechanism is sound in the tool the
customer actually runs.**

### 20.2 Two portability differences, found by running both

**These are exactly the `bench:kicad` shape and neither would have been found by
reading documentation.**

1. **B-source syntax. This one reaches the emitted file.**

       Bgm 0 n1 I={GM*V(inp,inn)}     LTspice REJECTS
         -> "Questionable use of curly braces", "undefined symbol in (gm)*[v](inp,inn)"
       Bgm 0 n1 I={GM}*V(inp,inn)     BOTH ACCEPT

   ngspice accepts both, so ngspice alone would have passed a file LTspice
   refuses. **Brace only the parameter, never the whole expression.** This is an
   emitter rule and it needs a test.

2. **Measurement syntax. This does NOT reach the emitted file.**

       ngspice   .meas ac gbw when vdb(out)=0 fall=1
       LTspice   .meas AC gbw WHEN mag(V(out))=1 FALL=1

   `vdb()` does not exist in LTspice and the measurement silently `FAIL`ed rather
   than erroring. Analysis directives are our harness, not the artefact, so the
   two rigs simply differ. Worth knowing because a `FAIL'ed` measurement looks
   like a bad model and is not.

3. **LTspice writes its logs in UTF-16LE**, confirming §13.3 from the tool itself
   rather than from prior art. Anything that reads an LTspice log must decode it.

### 20.3 What §14 now looks like

The pre-emitter LTspice step added by §18.5 is **done**. The emitter can be
written against a mechanism proven in both tools, with one syntax rule and one
encoding rule already known.

---

## 21. Demand, as far as it can be established without asking an engineer

§1 asked for what a working analogue engineer does. Below is what they and their
vendors write down. It is stronger than §16.2 and it is still not a conversation
with a customer.

### 21.1 The strongest evidence: the vendors teach the workflow they do not supply

- **TI publishes SLYT120, "Worst-case design of op amp circuits."**
- **ADI publishes "LTspice: Worst-Case Circuit Analysis with Minimal Simulation
  Runs."**

**Both vendors teach engineers to do worst-case op-amp analysis. Both ship
typical-only models.** §12 Q3 verified the second half in TI's own file: zero
occurrences of min, max, corner or `.step`.

So the gap is not one we inferred. It is defined by the vendors on one side and
left unfilled by the same vendors on the other.

### 21.2 Engineers describe using the max column directly

> "Engineers can choose either the typical value or the worst-case value... input
> bias currents may be 40 nA typical and maximum 90 nA, and engineers choose the
> worst case which is 90 nA."

That is the corner feature, in an engineer's words, chosen by hand off a
datasheet column.

Supporting, from §16.2: models are hand-built when "the manufacturer own model
does not work", and the stated purpose is "to study a circuit to see what happens
if you change the Op Amp slew rate or bandwidth, offset".

NASA JPL on rad-hard practice: hardening "requires conservative practices such as
widening design margins for stability, gain, and noise", and "circuit parameters
must account for worst-case radiation effects". Consistent with the case, and it
is about margin policy rather than about tooling.

### 21.3 Counter-evidence, recorded because it is real

**Three findings cut against this feature and none of them were sought.**

1. **"Many datasheets aren't extensive enough to form the basis of a model."**
   Some parts will be refused for the document's sake, not ours. That is a
   coverage ceiling we have not measured.

2. **"To fully model stability, the open loop output impedance is needed, but
   this information is usually not stated in the datasheet at all."** OPA333
   happens to print it (2 kOhm at 350 kHz) and §19 used it. **We may have picked
   an unusually well-specified part for the first proof.** If Zo is commonly
   absent, §19's fit has no anchor on other parts and the result does not
   generalise. **This is the single most important thing to measure next**, and
   it is measurable for free across the corpus.

3. **Worst-case analysis is not universally preferred.** It "often violates design
   specifications leading to expensive component selection, and statistically does
   not represent commonly observed results". Some engineers use Monte Carlo
   instead. Corners may therefore be the right artefact for the aerospace segment
   and the wrong default for everyone else, which argues for corners being
   offered rather than assumed.

### 21.4 What is still not known

Nobody has asked a rad-hard engineer whether they would use this. Everything
above is what the trade writes down, which is a different and weaker thing than
a customer saying yes. **§1's requirement is not met and should not be recorded
as met.**

---

## 22. Spec census over the tuned corpus, 2026-09-04

§21.3 raised the risk that §19 proved generation on an unusually well-specified
part. **Measured. The risk was real and it is narrower than feared.**

Method: `pdf-parse` over all 60 cached datasheets in `.bench-cache`, the TUNED
corpus. **`.holdout-cache` and `.blind-cache` were not opened.** 15 datasheets
are amplifier-shaped, meaning they print both an open-loop gain and an offset
voltage.

| spec | printed by | | note |
| --- | --- | --- | --- |
| Aol | 15/15 | 100% | |
| Vos | 15/15 | 100% | |
| Iq | 15/15 | 100% | |
| SR | 14/15 | 93% | |
| CMRR | 14/15 | 93% | |
| GBW | 13/15 | 87% | |
| PSRR | 11/15 | 73% | |
| **Zo** | **6/15** | **40%** | **the anchor §19's fit used** |

**So OPA333 was indeed a favourable pick.** It sits in the 40% that print
open-loop output impedance, and §19's fit used that 2 kOhm value to model the
load pole the datasheet's GBW already contains.

**What that costs, and it is less than it looks.** Without Zo the fit still
converges, because the target is the datasheet's number under the datasheet's
stated load. What is lost is EXTRAPOLATION: a model fitted without Zo is
characterised at the conditions the document states and cannot be trusted at
other loads. That is a scope statement to print on the receipt, not a refusal.

**The six parameters that carry the model are at 87% to 100%.** Gain, offset,
supply current, slew rate, CMRR and bandwidth are almost always printed. The
feature is not blocked by what datasheets publish.

### 22.1 The instrument is crude, and says so

Classification is a regex over the text layer, and it over-counts: `STM32H743ZI`
is an MCU and `REF5025` is a voltage reference, both caught by matching an
open-loop gain and an offset voltage somewhere in the document. So the real
op-amp count is about 13, not 15, and the percentages are approximate.

It is good enough for the question asked, which was whether Zo is usually
present. It is not good enough to size the feature, and nothing downstream should
treat these as exact.

### 22.2 The next generation test names itself

§19 proved the fit on a part WITH Zo. **The next one must be a part WITHOUT it**,
from the 60%. `AD8628`, `TS922`, `TSV911` and `LT1013` are all in the tuned
corpus and all lack it. If the fit converges there too, generation is established
across both halves of the corpus rather than on its easy half.

---

## 24. Can a spec table be read? First measurement, 2026-09-04

Free, on the local `qwen2.5vl:7b`, against OPA333's Electrical Characteristics
page rendered at 110 DPI. Ground truth is the hand-verified text-layer read
from §12.

| spec | truth | model said | verdict |
| --- | --- | --- | --- |
| GBW | 350 kHz, CL=100pF | **106 min / 130 typ dB**, CL=100pF | **WRONG ROW** |
| SR | 0.16 V/us, G=+1 | 0.16 V/us, G=+1 | correct |
| Aol | 106 min / 130 typ dB, RL=10k | 106 min / 130 typ dB, RL=10k | correct |
| Vos | 2 typ / 10 max uV | **2 MIN** / 10 max uV | **WRONG COLUMN** |
| Iq | 17 typ / 25 max uA, IO=0A | 17 typ / 25 max uA, IO=0A | correct |

**Three of five correct. The two failures are the two classic table failures**,
and one of them hit the single most important parameter in a macromodel.

- **GBW took the OPEN-LOOP GAIN row's numbers.** The rows are adjacent. It even
  attached the correct test condition, `CL = 100 pF`, to the wrong values, so the
  answer looked internally coherent and was wrong.
- **Vos put the TYP value in the MIN column.** Values right, column assignment
  wrong. On a corner model that silently swaps which corner is which.

### 24.1 What this does and does not establish

**Does not:** this is a 7B local model, not the production reader, and
`forge-local-model` already records it as weaker. A production run would very
likely score higher. **This is a floor, not a measurement of our product.**

**Does:** spec-table reading is not trivially solved, the failure mode is row and
column misalignment rather than misread digits, and **RULES.md 7 is necessary
here rather than ceremonial.** A single reading of this table would have shipped
a model with the wrong bandwidth by a factor of a thousand and the wrong units.

### 24.2 A second means that is deterministic, free, and just fired

The wrong GBW answer was **106 dB**. A gain-bandwidth product cannot be in dB.

**Every parameter has an expected physical dimension**, and a value whose unit
does not match it is wrong without any second reading:

| parameter | admissible unit |
| --- | --- |
| GBW | Hz |
| slew rate | V/s |
| Aol, CMRR, PSRR | dB or V/V |
| Vos | V |
| Iq | A |
| Zo | ohm |

This is cheap, deterministic, needs no model call, and **it catches the exact
error made above.** It is not the "bound that cannot fail" that RULES.md warns
about: it fired on the first real misread it was shown.

It does not replace the table-against-curve pairing, because it cannot catch a
plausible-but-wrong number in the right unit, such as the Vos column swap. It is
a cheap first gate under it.

### 24.3 Ordering the confirmation work

1. **Unit dimension check.** Free, deterministic, proven to fire. Build first.
2. **Column discipline.** The Vos failure suggests min/typ/max assignment needs
   its own check, plausibly ordering (`min <= typ <= max`) which is free and
   would have caught it.
3. **Table against curve.** Still the strongest pairing and still unmeasured.

**Note that 1 and 2 are both free and neither was in the plan before today.**

---

## 25. Can a CURVE be read? The rule 7 pairing, first measurement, 2026-09-04

§4 proposed the specification table against a characterisation curve as "plausibly
the strongest pairing available" and recorded that nobody had measured it.
**Measured. It does not look good, and one of the two problems has nothing to do
with model quality.**

### 25.1 The model result

OPA333 Figure 3, "Open-Loop Gain and Phase vs Frequency", rendered from the
document, three attempts of increasing fairness:

| attempt | what was shown | answer | truth |
| --- | --- | --- | --- |
| whole page, wrong page | index page, no plot | **correctly refused** | n/a |
| whole page, right page | 4 plots at 150 DPI | -20 dB, 0 dB at 10 Hz | 130 dB, 350 kHz |
| **cropped to Figure 3 alone**, 260 DPI, axes and caption visible | one plot | **0 dB at 1 kHz** | **350 kHz** |

**Wrong by a factor of 350 on a clean, isolated, fully labelled plot.**

Worth recording that on the first attempt it **refused rather than invented an
answer** when shown a page that genuinely lacked the figure. That is the correct
behaviour and it was my page detector that was wrong, not the model.

**Caveat, and it is a real one:** this is the local `qwen2.5vl:7b`, not the
production reader, and `forge-local-model` already records it as much weaker on
production prompts. **This is a floor, not a verdict on our pipeline.** But the
GRADIENT is informative: the same model read the spec TABLE 3 of 5 (§24) and the
CURVE 0 of 1, badly. Curve reading is materially harder than table reading, which
is what the pairing depends on being cheap.

### 25.2 The structural problem, which no model can fix

**Reading Figure 3 by hand: the plot's frequency axis starts at 10 Hz, and the
gain curve enters the frame at about 93 dB.** OPA333's DC open-loop gain is
130 dB, and its dominant pole is near 0.1 Hz.

**So the datasheet's own 130 dB is OFF-SCALE on the datasheet's own curve.** A
perfect curve reader still cannot confirm Aol from this figure, because the DC
asymptote is not drawn.

This is a property of how vendors draw Bode plots, not of any reader:

| parameter | can the curve confirm it? |
| --- | --- |
| GBW | **Yes.** The 0 dB crossing is on the plot by construction. |
| Aol (DC) | **No, usually.** Plots start at or above 1 Hz; the DC asymptote is off-scale. |
| CMRR, PSRR (DC) | Same problem, same reason. |
| Vos, Iq, SR | No curve exists to read. |

**So the pairing was never going to cover the parameter set.** It plausibly
covers GBW and nothing else reliably.

### 25.3 What this means for rule 7, stated without softening

§4 said three outcomes are possible and two are acceptable. **On this evidence
the parameter block heads for "flagged", not "confirmed"**, because:

- the unit-dimension check (§24.2) is real but **cannot confirm a value**, only
  reject an impossible one;
- min <= typ <= max ordering (§24.3) likewise rejects, never confirms;
- the curve pairing reaches GBW at best, and is unproven even there.

That is not fatal. §4 already says a parameter with no second source is FLAGGED
and shown to the user, and that this is an acceptable outcome. **But it makes Q5
decisive rather than academic:** if the parameter block is one glance it fits in
`MAX_FLAGGED` and the product ships with parameters shown to the user for
checking. If it is not, §10 step 3 fires and the honest answer is that this half
refuses more than it serves.

**Q5 has not been measured and is now the single most important open question in
this document.** It was ranked fifth.

### 25.4 What would change this

A production-model run on the same figure. If a stronger reader lands GBW within
a few percent, the pairing is real for GBW and the picture improves. It cannot
fix the off-scale problem for Aol, CMRR and PSRR, which is structural.

---

## 26. The second source exists, and it is not the curve, 2026-09-04

§25 concluded the parameter block was heading for "flagged" because the
table-against-curve pairing is weak and partly impossible. **That conclusion was
premature. I fixated on the curve and under-weighted the candidate §4 had already
listed:**

> "The specification table against the text layer, the way `pinevidence.ts`
> corroborates the pinout. Cheap, deterministic, and it checks transcription
> rather than meaning."

**It is better than that. Built and measured today, in one pass, free.**

### 26.1 Geometry, not flattened text

The flattened text layer is useless here: OPA333's row arrives as
`GBWGain-bandwidthproductC` / `L` / `= 100 pF350kHz`. But `mupdf` gives every
span its **position**, and a specification table is a grid:

    PARAMETER   TEST CONDITIONS   MIN[406]  TYP[450]  MAX[494]  UNIT[527]
    VOS  Input offset voltage  VS = 5 V   [460]2   [501]10   [530]uV
    AOL  Open-loop voltage gain          [407]106 [452]130   [530]dB
    GBW  Gain-bandwidth product  CL=100pF [452]350          [529]kHz
    SR   Slew rate  G = +1               [450]0.16          [528]V/us

**Take the MIN, TYP and MAX x-coordinates from the header row, then assign every
number to a column by where it is PRINTED.** No model, no heuristics about
reading order.

### 26.2 It catches both failures the model made

§24 measured the vision model at 3 of 5 on this exact table:

| failure | model said | geometric reader |
| --- | --- | --- |
| GBW took the adjacent row | 106/130 **dB** | **350 kHz**, cond `CL = 100 pF` |
| Vos put TYP in the MIN column | MIN=2 | **TYP=2** (x=460, TYP header at 450) |

**5 of 5 where the model scored 3 of 5**, and the two it fixed are precisely the
two classes of table error.

### 26.3 Measured across six amplifier datasheets

| part | params read | notes |
| --- | --- | --- |
| OPA333 | 4/5 | all correct against hand-read truth |
| AD8628 | 4/5 | Aol 125/145 dB, Iq 0.85/1.1 mA, GBW 2.5 MHz, SR 1.0 |
| LT1013 | 4/5 | Vos 40/150 uV correct; Aol 1.5/8.0 read, **unit missed** (V/uV) |
| TLV9061 | 3/5 | GBW 10 MHz, SR 6.5 V/us correct; **Iq "0.5/1.5 uA" is suspect** |
| OPA2277 | 2/5 | GBW 1 MHz, SR 0.8 V/us |
| OPA2189 | 2/5 | SR 20 V/us correct; Iq condition string mangled |

**Two to four parameters per part, and where it reads it is right, with one
suspect.** This is a prototype written in a single pass, not a tuned reader.

### 26.4 What this does to RULES.md 7

The pairing is **a model reading the rendered page against deterministic
geometry on the text layer**. That is two genuinely different means with no
shared failure mode, and it is the same shape as `pinevidence.ts`, which is
already proven in this codebase for pinouts.

Three outcomes, all honest:

- **both read and agree** -> confirmed, ships silently
- **both read and disagree** -> flagged, with both readings and the page
- **only one reads** -> flagged, single source named

**§25.3's gloomy conclusion is withdrawn.** Parameters are not heading for
"flagged by default". Coverage of the pairing is partial, 2 to 4 of 5 today, so
some parameters will still be single-source and flagged, which is exactly what
`MAX_FLAGGED` is for.

**The curve keeps a smaller job.** §25.2's structural finding stands: DC gain,
CMRR and PSRR asymptotes are off-scale on typical Bode plots and no reader can
confirm them there. But a coarse curve read is still a useful DISAGREEMENT
detector: the model's "1 kHz" against a table's "350 kHz" is three decades apart
and any reader that can place the crossing within a decade would catch it.

### 26.5 Honest limits

- The reader is mine, written in one pass. It is not `pinevidence.ts` quality and
  the TLV9061 Iq reading needs checking by hand before anyone trusts this.
- It finds the FIRST matching row and stops. Datasheets with per-supply
  specification tables print the same parameter several times, and §12 Q3's
  corners depend on getting the right block.
- Unit capture is weaker than value capture. Two of six parts lost a unit, and
  §24.2's dimension check depends on it.
- Only amplifier tables were tried.

---

## 27. Hardening the deterministic reader, 2026-09-04

§26.5 listed three weaknesses. All three chased. **Two produced findings that
change the design.**

### 27.1 The SYMBOL disambiguates rows that share a description

TLV9061 prints two rows with the identical description:

    y=173  IQ    Quiescent current per amplifier              [529]uA
    y=209  IQSD  Quiescent current per amplifier  [450]0.5  [500]1.5  [529]uA

`IQSD` is the **shutdown** current. The v1 reader matched on the description,
found no numbers on the `IQ` line, and took `IQSD`'s. **0.5 uA reported for a
part whose operating quiescent current is about 500 uA. A 1000x error, silent.**

**Fix, and it is general: a row must carry an ACCEPTED SYMBOL, matched exactly.**
`IQSD` is not `IQ`. With the gate in place TLV9061's Iq is REFUSED rather than
wrong, which is the correct outcome.

Enumerating the symbols the trade uses for a parameter (`AOL`, `AVO`, `AVOL` for
open-loop gain) is covering a category, not tailoring: it is the same shape as
the pin-type vocabulary map in `types.ts`. **It costs coverage** - LT1013's Aol
and OPA2189's Iq dropped out - and that is the right trade, because it converts
wrong answers into refusals.

### 27.2 A font substitution that turns 1 V/us into 1 V/ms, and the unit check CANNOT see it

AD8628's slew rate unit read as `V/ms`. That is not my reader. It is the
document. Codepoints, from the text layer:

| part | printed | text layer | codepoints |
| --- | --- | --- | --- |
| AD8628 (ADI, older PDF) | uV/degC | `mV/∞C` | `6d 56 2f 221e 43` |
| AD8628 | V/us | `V/ms` | `56 2f 6d 73` |
| OPA333 (TI, modern PDF) | uV/degC | `μV/°C` | `3bc 56 2f b0 43` |
| OPA333 | V/us | `V/μs` | `56 2f 3bc 73` |

**The PDF uses a Symbol font: the glyph DRAWN is a micro sign, the character code
stored is the letter `m`.** Degrees is stored as U+221E, INFINITY.

Three consequences, and the third is the important one:

1. **A slew rate of 1 V/us is stored as 1 V/ms. A factor of 1000.**
2. **§24.2's unit-dimension check is blind to it.** `V/ms` is a perfectly valid
   slew-rate dimension. The check cannot fire.
3. **A model reading the RENDERED page sees the micro sign correctly**, because
   the glyph draws correctly and only the character mapping is wrong.

**This is the clearest demonstration in this document of why RULES.md 7 demands
different MEANS rather than two readings.** One reader consumes character codes
and is wrong; the other consumes pixels and is right; they cannot fail together,
so the disagreement surfaces. A second model call would have agreed with the
first and shipped the error.

**A deterministic tell exists too.** U+221E appearing inside a temperature unit
is a reliable signature of this font mapping, and it means every `m` in a unit
position on that page is suspect. Cheap, and it flags the document rather than
guessing the value.

### 27.3 Multi-block reading, fixed

Datasheets print one specification block per supply voltage or grade. The reader
now returns every occurrence with its page and conditions rather than the first:

    AD8628   Aol MIN=125 TYP=145 dB p2   |   MIN=110 TYP=140 dB p3
             GBW TYP=2.5 MHz p2          |   TYP=2 MHz p3
             Iq  TYP=0.85 MAX=1.1 mA p2  |   TYP=0.75 MAX=1.0 mA p3

**Q3's corners depend on this.** Fitting a corner from one supply's minimum and
another supply's maximum would produce a part that does not exist. The blocks
must be kept apart and chosen as a set, and they now are.

---

## 28. The blind run, and why its headline number is meaningless, 2026-09-04

Ran the deterministic reader over all 43 `.blind-cache` datasheets, none of which
had been opened. `.holdout-cache` was not touched. **No part was diagnosed or
fixed afterwards.**

**Headline: 4 of 43 datasheets yielded any parameter, 9%.**

**That number says nothing about this feature, and reporting it alone would have
been the mistake this project keeps making.**

### 28.1 Count the denominator

The blind corpus was assembled to measure CAD extraction across every part type.
It is mostly MCUs, connectors, regulators, logic and memory.

| | count |
| --- | --- |
| datasheets | 43 |
| amplifier-shaped by regex | 5 |
| **genuinely op-amps, hand-classified** | **2** (`ti-lmp7721`, `ti-opa2810`) |

The other three "amplifier-shaped" hits are an ADC (`ads127l01`) and two power
converters (`ti-lm5170`, `ti-tps548b22`), caught because they print an offset
voltage and a gain somewhere.

**So the real result is 1 of 2 op-amps**, not 4 of 43:

- `ti-opa2810`: read GBW **70 MHz** across 3 blocks, and Vos MAX 2.4 mV. OPA2810
  is a 70 MHz amplifier, so the value is right.
- `ti-lmp7721`: read nothing.

It also correctly read quiescent current off three regulators, which is a
legitimate read of a real row and not a false positive.

### 28.2 What the free checks did

Across all 5 parameter blocks read from unseen documents:

| check | result |
| --- | --- |
| unit dimension | 5 ok, **0 wrong**, 0 missing |
| min <= typ <= max | 2 ok, **0 violated** |
| magnitude band | 4 ok, **0 out of band** |

**Zero false readings, and zero checks fired.** Both facts matter, and the second
is a warning: `RULES.md` says an instrument that cannot fail is not a check.
These three have now been exercised on real unseen data and produced nothing,
so they remain UNPROVEN as instruments. They caught a model error in §24 and
they have never caught a geometry error.

### 28.3 The actual finding: there is no instrument for this feature

**Neither the blind nor the hold-out corpus can measure amplifier parameter
reading, because neither contains enough amplifiers.** The tuned corpus has ~13.
The blind corpus has 2.

So the honest state of generalisation is: **unmeasured, and currently
unmeasurable.** The tuned result (2 to 4 parameters on 6 of 6) is a fitted
number, and this project's own history says fitted numbers overstate by roughly
twenty points.

**Before this feature can claim a generalisation figure, an amplifier hold-out
corpus has to exist**: 20 to 30 op-amps, references and comparators from vendors
across the range, written down before any is opened, under the same rule as
`holdout-corpus.ts`. That is a prerequisite, not a nice-to-have, and it did not
appear anywhere in this plan until the measurement was attempted.

`forge-validate-the-instrument` records the same shape: a new bench reported 454
findings and the truth was zero. Here a new bench reported 9% and the truth is
that it was asking the wrong 43 documents.

---

## 29. Design audit against this codebase's own failure shapes, 2026-09-04

Before building. `LEARNINGS.md` section 2 lists the shapes that account for most
of what every audit here has found. **The SPICE design is checked against each
one below.** Seven gaps found, one already fixed by measurement.

### 29.1 "We had it and threw it away" — TWO GAPS

The dominant shape: an answer is collected, paid for, and never consumed.

**Gap A: the reader returns every specification block and the design never says
which one is used.** §27.3 collects 4 Vos blocks for LT1013 and says they "must
be chosen as a set". It does not say HOW. Taking the first silently discards
three, and on LT1013 those blocks are different GRADES of the part.

**Gap B: test conditions are read and have nowhere to live.** §19 proved the fit
is impossible without them (`CL = 100 pF` is the difference between 350 kHz and
280 kHz) and §24 proved a value without them cannot be verified. But `Extracted<T>`
carries value, confidence, method, citation. **There is no field for conditions.**
Read, essential, and homeless is exactly the shape.

**Both must be settled before the record type is written.**

### 29.2 Hold-out contamination — GAP

Three parts once sat in the tuned and hold-out corpora at once, and nothing
noticed for months, because a contaminated hold-out does not look broken. It
reads slightly high forever.

§28 asks for an amplifier hold-out corpus. **It must ship with its separation
test on the same day**, extending `corpus-separation.test.ts`. The lesson is
recorded as "every assumption a headline number rests on should have a test",
and that assumption was previously stated in a 30-line comment and enforced
nowhere.

### 29.3 The bench measures the product WITHOUT the user — GAP

Six parts once read as complete failures in the bench and shipped 6 for 6 once
the package was NAMED, because naming it re-reads the document for that package.

**The SPICE equivalent is the supply voltage.** A datasheet printing one block
per supply is ambiguous to the bench and not to a user who says "5 V". So
`bench:model`'s refusals will be a FLOOR, not a coverage figure, and something
like `packagehint.ts` is needed for the supply before any refusal is believed.

### 29.4 "Fixed in one place, not the other" — GAP, and this is the dominant mode

Four instances in one day, called "the dominant failure mode in this codebase by
a distance". The first question on any change should be: **where else does this
value live?**

**The parameter list will live in at least five places**: the extraction fields,
the record type, the emitter, the confirmation pairings, and the bench. Adding
CMRR to four of them is this shape exactly.

**It needs one definition everything else derives from**, plus the test that
already exists in spirit: `types.ts` enums are read and the prompt asserted to
mention every value.

**One thing the design already gets right:** the CAD symbol, the `.asy` and the
`.subckt` port order all come from ONE internal terminal list (§12 Q8), so they
cannot disagree. **That needs a test that would fail if someone re-derived any of
the three**, or it is a convention rather than a guarantee.

### 29.5 An allowlist broken by the next case — ONE GOOD, ONE GAP

**Good:** the symbol whitelist fails SAFE. An unrecognised symbol means the row
is not matched, so the parameter is refused rather than read wrong. That is the
right side, and §27.1 measured the cost: LT1013's Aol and OPA2189's Iq dropped
out.

**Gap:** the unit-dimension check does not. In the blind run an unrecognised unit
scored as `missing`, not as `wrong`. **A parameter whose unit cannot be
recognised must be FLAGGED, never treated as confirmed.** `wasPaidFor` is the
worked example of getting this backwards, and under-reporting has been three
separate defects in one file.

### 29.6 Two readers disagreeing is not one being better — GOOD, with a live temptation

§26.4 names the CONFLICT rather than ranking the readers, which is the rule that
measured well. Keep it.

**The temptation to watch for:** §27.2 found a document where the geometric
reader is KNOWN wrong (the Symbol-font micro sign). The instinct will be "prefer
the model on documents with the U+221E signature". **That is a ranking rule and
this codebase has measured ranking rules to be worse than conflict rules every
time.** Flag the document, surface the disagreement, do not pick a winner.

### 29.7 A question the model cannot answer — GAP

`leadForm` was the biggest blocker in the corpus because the prompt offered two
of three legal values. The model was answering correctly every time.

**The parameter prompt has the same trap in three places:** a parameter may have
only a typical and no min or max; a parameter may be absent entirely; and units
have a vocabulary. If the prompt does not say that "only a typical is printed" and
"not stated" are valid answers, the model will invent or refuse.

### 29.8 Null treated as a default — CRITICAL GAP

`throughHoleFootprint` shipped a 3-lead TO-220 as two rows because null was the
same as unread.

**The SPICE version is worse, because it fabricates a guarantee.** If a datasheet
prints only a typical GBW and the corner code defaults `max = typ`, the model
claims the vendor guarantees a bandwidth ceiling that the document never states.
A worst-case analysis built on it is wrong in the safe-looking direction.

**A missing corner must produce NO corner for that parameter, never one equal to
typ.** §23 got this right incidentally, and GBW correctly did not move across
AD8628's corners. **It must be explicit and it must have a test**, because the
state a parameter arrives in when unread is exactly the state that falls through.

### 29.9 Vocabulary and word-boundary traps — FOUND AND FIXED

`\bLQFP\b` cannot match `LQFP64`. The same trap was live in my symbol gate.

The normaliser stripped every non-letter, so **digits vanished**:

| printed | old norm | accepted? | truth |
| --- | --- | --- | --- |
| `IQ1` | `IQ` | **yes** | different row, per-channel current |
| `IQ2` | `IQ` | **yes** | different row |
| `IS1` | `IS` | **yes** | different row |
| `IDD1` | `IDD` | **yes** | different row |
| `ICC2` | `ICC` | **yes** | different row |

On a dual or quad amplifier, `IQ1` and `IQ2` are per-channel currents and the
gate would take whichever came first.

**Fix: strip separators only, never digits.** A digit is part of the symbol's
identity. Measured over 11 cases: **5 wrong before, 0 after.** `I_Q` and `I Q`
still normalise to `IQ`; `IQ1` no longer does.

### 29.10 Summary

| shape | verdict |
| --- | --- |
| we had it and threw it away | **2 gaps**: block selection, and conditions have no home |
| hold-out contamination | **gap**: separation test must ship with the corpus |
| bench without the user | **gap**: supply voltage is the SPICE package-hint |
| fixed in one place, not the other | **gap**: parameter list will live in 5 places |
| allowlist broken by the next case | symbols safe; **unknown unit must flag** |
| ranking two readers | good, with a named temptation to resist |
| a question it cannot answer | **gap**: prompt must permit typ-only and not-stated |
| null as a default | **critical gap**: a missing corner must not become typ |
| word-boundary traps | **found and fixed before any code shipped** |

**Nothing here invalidates the design. All nine are things to build correctly the
first time**, and finding them cost one afternoon instead of the months each of
their predecessors took.

---

## 30. Overcomplication and tailoring pass, 2026-09-04

Anthony named the three pathologies to check for: not asking for enough, reading
something and throwing it away, and a guard that refuses for no reason.
**All three were live in this design. Two are now fixed by REMOVING something.**

### 30.1 A guard refusing for no reason — FOUND AND FIXED

§27.1 added a rule that a row must carry an ACCEPTED SYMBOL. It stopped the
IQSD defect. It also refused this:

    OPA2189   [99]Quiescent current per  [191]VS = ±2.25 V to ±18 V  [462]1.3  [502]1.7

**OPA2189 prints no symbol for that row at all.** Requiring one refuses a
perfectly readable line forever, for a reason that is ours and not the
document's. That is the guard-for-no-reason shape exactly, introduced by me
three hours ago while fixing something else.

**The rule was inverted: REJECT a contradicting symbol, never REQUIRE a
confirming one.**

- a symbol is printed and it is a near-miss of one we accept (`IQSD` against
  `IQ`) -> refuse, it is a different row
- a symbol is printed and it matches -> accept
- **no symbol is printed -> accept, because the description is all the document
  gives**

Measured over five cases including both real defects: **require-a-symbol got 1 of
5 wrong, reject-on-clash got 0 of 5.** It keeps every protection and stops
refusing correct rows.

**The general lesson, which this codebase already had: a guard that turns correct
readings into refusals is not conservative, it is broken.** LT1013's Aol was also
lost this way, to nothing more than an incomplete symbol list (`AVOL` was
missing) - the "audit vocabularies before writing readers" trap, again.

### 30.2 Not asking for enough — A REAL DESIGN CHANGE

The reader asks for five named parameters. **That is field-directed reading
applied where it costs more than it saves.**

A specification table is ONE table. Reading five rows from it and reading all of
them cost virtually the same. But **the prompt is the cache key**, so the day
CMRR, PSRR, noise or input capacitance is wanted for a better model, every cached
answer is stranded and the whole corpus is re-read for money.

**Read the whole specification table once. Consume what today's model needs.
Keep the rest on the record.** Adding a block later then costs nothing.

This is not scope creep; it is the cheaper option, and it is the direct fix for
`forge-we-had-it-and-threw-it-away`, which is five instances of paying for an
answer and not keeping it.

### 30.3 Throwing away what was read — A THIRD INSTANCE

§29.1 found two. Here is a third, and it is structural:

    LT1013  [44]AVOL  Large-Signal Voltage Gain  VO=±10V, RL=2k  [329]1.5  [365]8.0  [438]1.2  [476]7.0  V/µV

**Four value columns. LT1013 prints two GRADES side by side**, so the header
carries MIN/TYP twice. The reader finds the first MIN/TYP/MAX group and reads
`1.5 / 8.0`, silently discarding the second grade's `1.2 / 7.0`.

A part number selects a grade. Reading one grade and labelling it with the other
part's number is a wrong answer, not a partial one. **The header must be parsed
as possibly several column groups, and the grade chosen, not defaulted.**

### 30.4 A check that has never fired — DELETE IT OR PROVE IT

§24.2 proposed three free checks. On the blind corpus:

| check | fired | verdict |
| --- | --- | --- |
| unit dimension | caught a MODEL error (§24), never a geometry error | keep, do not count as safety yet |
| min <= typ <= max | 0 | unproven |
| magnitude band | **0, and it is the loosest of the three** | **suspect** |

`RULES.md`: **a bound that cannot fail is not a confirmation.** The magnitude band
admits GBW anywhere from 1 kHz to 10 GHz, which is seven decades. That is the
lead-pitch bound that was dropped rather than tuned.

**Either prove it can go red by injecting a defect, or delete it.** Do not carry
it as decoration.

### 30.5 Is the design overcomplicated? Audited part by part

| piece | needed? |
| --- | --- |
| the fit loop | **yes**, but only for the 40% printing Zo; 2 iterations, one correction |
| two readers | **yes**, RULES.md 7, and §27.2 proves they fail differently |
| corners | **yes**, ~5 extra `.param` lines, and it is the differentiator |
| symbol handling | **yes**, but as a rejector, not a requirement (§30.1) |
| unit check | keep, cheap, unproven |
| magnitude band | **probably delete** (§30.4) |
| field-directed reading | **delete**, read the whole table (§30.2) |

**Net: this pass removed two things and added none.** The design is smaller than
it was this morning.

---

## 31. What datasheets ACTUALLY print, and the corner nobody ships, 2026-09-04

Anthony asked for the prompt to request everything we could possibly need, so it
never has to change. **The prompt is the cache key, so widening it later re-reads
the whole corpus for money.** The only honest way to build the field list is from
the documents.

260 value rows extracted from 10 amplifier datasheets in the tuned corpus.

### 31.1 THE FINDING: rad-hard datasheets print a POST-RADIATION corner

From `LMP7704-SP`, inside the electrical characteristics table:

    Flight model post-HDR exposure   |  82   | dB
    Flight model post-TID exposure   | ±400  |

The document specifies parameter values **after irradiation**: post high-dose-rate
and post total-ionising-dose. It is characterised to 150 krad(Si) LDR and
100 krad(Si) HDR.

**So a rad-hard datasheet carries a FOURTH corner beyond min/typ/max, and it is
the one our market exists for.**

- Worst-case analysis in space **must** account for radiation degradation. JPL:
  "circuit parameters must account for worst-case radiation effects."
- **No vendor model contains it.** TI's models are typical and pre-radiation;
  §12 Q3 verified zero corner support of any kind.
- It is **printed in the document, with a page to cite**, exactly like every other
  value this product reads.

**A post-radiation model is the single most differentiated artefact this product
could ship, it is unavailable from anyone at any price, and it is aimed precisely
at the segment Forge is positioned for.**

It was found by asking what datasheets contain rather than by asking for five
parameters. **A five-field reader would never have seen it**, which is Anthony's
point about throwing things away, made concrete before any code was written.

### 31.2 The field list, measured rather than imagined

| parameter | rows | parts | in my 5-field list? |
| --- | --- | --- | --- |
| voltage noise | 16 | 6/10 | **NO** |
| quiescent / supply current | 13 | 6/10 | yes |
| gain-bandwidth | 12 | 7/10 | yes |
| offset voltage drift | 11 | 6/10 | **NO** |
| CMRR | 11 | 6/10 | **NO** |
| input bias current | 10 | 4/10 | **NO** |
| PSRR | 10 | 5/10 | **NO** |
| output voltage swing | 10 | 4/10 | **NO** |
| offset voltage | 9 | 4/10 | yes |
| open-loop gain | 9 | 5/10 | yes |
| current noise | 8 | 6/10 | **NO** |
| input offset current | 8 | 3/10 | **NO** |
| input voltage range | 6 | 3/10 | **NO** |
| output / short-circuit current | 6 | 2/10 | **NO** |
| overload recovery | 6 | 4/10 | **NO** |
| **slew rate** | **5** | **4/10** | yes |
| open-loop output impedance | 4 | 3/10 | **NO** |
| phase margin | 3 | 2/10 | **NO** |
| channel separation | 3 | 3/10 | **NO** |
| capacitive load drive, THD | 2 | 1/10 | **NO** |
| settling time, input capacitance, supply range, turn-on, shutdown | 1 | 1/10 | **NO** |

**My five-field list covered 5 of 25 parameters and missed the most common one.**
Voltage noise appears in more rows than anything else and is exactly what an
op-amp model is used to simulate.

**Two corrections to earlier sections:**

- **Slew rate is printed by only 4 of 10 parts.** §22 reported 93% from a
  full-text regex, which was matching the phrase anywhere in the document
  including typical-characteristics captions. The value ROW is much rarer. §22's
  percentages are upper bounds, not coverage.
- **Every one of TI's macromodel blocks** (§13, the Green-Williams-Lis list: noise,
  CMRR, PSRR, Vos drift, Vos vs Vcm, output clamps, short-circuit current,
  quiescent current) **corresponds to a parameter in this table.** The blocks are
  not arbitrary; they are what the datasheet publishes. Reading the whole table is
  what makes the model extensible without a re-read.

### 31.3 The prompt must therefore ask for

1. **Every row of every specification table**, not a named subset.
2. **Both dimensions of the table:** min, typ, max AND the test conditions, the
   temperature, and the supply the block applies to.
3. **The grade or variant a column group belongs to** (§30.3: LT1013 prints two
   grades side by side).
4. **Post-radiation columns as first-class values**, with their exposure type and
   dose.
5. **The unit exactly as printed**, because §27.2 showed the text layer can lie
   about the micro sign and only the rendered glyph is right.
6. Permission to answer **"only a typical is printed"** and **"not stated"**
   without inventing (§29.7).

---

## 32. The discard audit and the refusal audit, 2026-09-04

Anthony: do not throw anything away for no reason, and do not refuse stupidly.
Both are enumerated here rather than asserted, because both have cost this
project real months on the CAD side.

### 32.1 Every point where the design discards something

| # | what is discarded | verdict |
| --- | --- | --- |
| 1 | parameters outside a 5-field list | **FIXED** (§31): read every row |
| 2 | post-radiation values | **would have been total** (§31.1). Now first-class. |
| 3 | one spec block chosen, others dropped (multi-supply) | **KEEP ALL**, tagged by supply. The user names the supply; the bench cannot. |
| 4 | one grade's columns, the other dropped (LT1013) | **KEEP ALL**, tagged by grade. Choosing by part number is a decision, not a default. |
| 5 | test conditions | **KEEP**, and they need a home on the record. Without them a value cannot be fitted (§19) or verified (§24). |
| 6 | the unit as printed | **KEEP the glyph**, not a normalised form. §27.2: the text layer lies about the micro sign; only the rendered form is trustworthy. |
| 7 | the loser of a model/geometry disagreement | **KEEP BOTH.** The conflict record IS the flagged item. Discarding one turns a disagreement into a silent choice. |
| 8 | rows we cannot model yet (THD, settling, phase margin) | **KEEP on the record.** The prompt is the cache key; discarding them means paying to read them again. |

**Seven of eight say KEEP.** The single rule that covers all of them: **read once,
store everything, decide later.** Consumption is a separate question from
extraction, and conflating them is what produced five "we had it and threw it
away" defects on the CAD side.

### 32.2 Every refusal in the design, and whether it earns its place

| refusal | fires when | verdict |
| --- | --- | --- |
| contradicting symbol (`IQSD` vs `IQ`) | a different parameter's row | **KEEP.** Measured: stops a 1000x error. |
| no symbol printed | ~~always~~ | **DELETED** (§30.1). Refused OPA2189 for a reason that was ours. |
| symbol not in the vocabulary | a vendor uses an unlisted name | **KEEP, but it is a vocabulary bug, not a guard.** It cost LT1013's `AVOL`. Enumerate from the corpus, do not wait to be bitten. |
| magnitude band | never, in 5 blind readings | **DELETE unless it can be shown to go red.** Seven decades wide. This is the lead-pitch bound again. |
| unit unrecognised | an unknown unit string | **DO NOT REFUSE. FLAG.** Refusing loses a value the document states; flagging shows it to the user. |
| min > typ > max | never yet | **KEEP but prove it.** Cheap, and it catches the column swap the model made in §24. |
| conformance mismatch | the model does not reproduce a spec | **FLAG WITH THE REPORT, do not refuse the model.** The engineer can judge a 5% bandwidth miss; a refusal gives them nothing. |
| spec not reproducible | the datasheet omits the test circuit (§16.1) | **`unverifiable`, a third verdict.** Not a failure and not a pass. |
| missing corner | the document prints no min or max | **Emit no corner. Do not refuse the part, and never default to typ** (§29.8). |

**One deletion, one demotion from refusal to flag, and one bound on probation.**

### 32.3 The rule behind both audits

Every discard and every refusal above resolves the same way:

**A value the document states must reach the record, and a value the record holds
must reach the user, even when the product cannot use it.** Refusal is for what
the document does not say. It is never for what we have not got round to
modelling, and never for a shape we did not anticipate.

The CAD half learned this the expensive way: 12 hold-out parts once reported "no
pins" with complete pinouts sitting on the record.

---

## 33. The defect where every input passes, 2026-09-04

`LEARNINGS.md` section 3: "The dangerous defect is the one every input passes...
It is the worst failure this product has, because every input is individually
valid and the result looks entirely ordinary in CAD." The worked example is
MAX232: right lead count, wrong drawing, nothing fired.

**The SPICE version exists and is worse, because the conformance harness CANNOT
catch it.**

### 33.1 The defect

LT1013 prints **three** min/typ/max column groups on a single row:

    [327]LT1013AM     [404]LT1014AM     [467]LT1013M/LT1014M
    SYMBOL PARAMETER  CONDITIONS  MIN TYP MAX | MIN TYP MAX | MIN TYP MAX | UNITS
    VOS Input Offset Voltage   [341]80 [365]300 | [419]90 [442]350 | [494]110 [520]550 | µV

Three grades side by side, and **one of them is a different part number**
(LT1014 is the quad, LT1013 the dual).

A reader that takes the first group returns **80 / 300 uV** for a part whose
datasheet guarantees **110 / 550 uV**. Nearly 2x optimistic on the maximum.

**Why nothing catches it:**

- every value is individually valid and correctly transcribed
- the units, the ordering and the magnitude all pass
- the geometric reader and the model would BOTH read the leftmost group, so
  RULES.md 7's pairing agrees
- **the conformance harness compares the model against the same wrong column, so
  it PASSES**

That is the MAX232 shape exactly: a correct-looking artefact built from another
variant's data, with every individual check green.

### 33.2 Frequency, measured

| datasheets checked | multi-group |
| --- | --- |
| 10 amplifiers in the tuned corpus | **1** (LT1013) |

One in ten, the same order as the multi-package problem on the CAD side, which
produced two guards and is still listed as a residual risk.

### 33.3 The guard is possible, because the labels are printed

The grade names sit one row ABOVE the header, positioned over their own column
groups (`LT1013AM` at x=327 over the group spanning 313 to 363).

**So the guard can PROVE a disagreement, which is the standard `LEARNINGS.md`
sets:**

1. detect more than one MIN/TYP/MAX group in a header
2. read the labels above them and bind each group to its label
3. match the label against the requested part number
4. **on no match, refuse with the list of grades offered** - genuinely absent
   input, not a plausibility argument

Like `declaredLeadCount` and `outlineCodeDesignator`, it returns null and stays
silent where it cannot prove anything: one column group, or groups with no labels.

### 33.4 The blind spot, stated rather than papered over

**A datasheet printing several column groups WITHOUT labels is unguarded**, and
that frequency is not measured. It is the direct analogue of the 20 parts that
carry no outline code and describe several packages.

**Also unmeasured: how often a part number's suffix maps cleanly onto a printed
grade label.** `LT1013M` against `LT1013M/LT1014M` needs the slash understood; a
naive equality test fails and would refuse a part it should accept, which is the
stupid-refusal shape.

### 33.5 What this changes

**Grade selection is a first-class question, not a parsing detail.** It joins
supply voltage and package as a thing the product may have to ASK, and §29.3's
point applies: the bench cannot answer it, so bench refusals here are a floor.

---

## 34. The table's heading, and the shape-only rule that reads the wrong table

`LEARNINGS.md` section 6: "A table of contents is geometrically identical to a
number-first pin table. Any shape-only rule will read a contents page and report
pin 1 as `Features`."

**My reader is a shape-only rule.** It anchors on a MIN/TYP/MAX header and has no
idea which table it is reading.

### 34.1 It survives by accident

Measured on OPA333 and TLV9061:

| table | header shape |
| --- | --- |
| Absolute Maximum Ratings | MIN/MAX |
| Recommended Operating Conditions | MIN/MAX |
| **Electrical Characteristics** | **MIN/TYP/MAX** |

Requiring all three columns skips the absolute-maximum tables. **That is luck,
not design.** A vendor printing a NOM or TYP column in Recommended Operating
Conditions, which is common, would be read as electrical characteristics, and an
absolute-maximum supply voltage substituted into a model is not a small error.

### 34.2 Auditing the heading vocabulary BEFORE writing the reader

What actually sits above a MIN/TYP/MAX table, across 10 amplifier datasheets:

| heading | parts |
| --- | --- |
| `Electrical Characteristics` | 5 |
| `Electrical Characteristics (continued)` | 3 |
| **`(NO HEADING FOUND)`** | **3** |
| `ELECTRICAL CHARACTERISTICS` | 1 (ADI caps) |
| `SPECIFICATIONS` | 1 (ADI, AD8232) |
| `Electrical Characteristics: LM358B and LM358` | 1 |
| `Electrical Characteristics VS = 5 V` / `VS = 10 V` | 1 (LMP7704-SP) |

### 34.3 THE HEADING CARRIES THE BLOCK'S IDENTITY, and I was about to discard it

This is the important finding, and it answers two open questions at once:

- **`Electrical Characteristics VS = 5 V`** and **`VS = 10 V`**: LMP7704-SP
  separates its supply blocks **in the heading**, not in column labels. That is
  §29.3's supply-block ambiguity, already answered by the document.
- **`Electrical Characteristics: LM358B and LM358`**: the heading names which
  VARIANTS the block applies to. That is §33's grade problem, answered a second
  way, for a datasheet that does not label column groups.

**So the heading is not a section marker to match against. It is a scope
statement that must be READ and KEPT on the record with the block.** Discarding
it and then asking "which supply is this?" is the throwing-it-away shape, one
step before it happens.

### 34.4 The rule, and it is reject-on-contradiction again

**3 of 10 parts have no findable heading.** So requiring one refuses 30% of the
corpus for a reason that is ours, which is exactly the guard §30.1 deleted.

Same shape as the symbol fix:

- heading says **Absolute Maximum, Recommended Operating, Thermal, ESD** ->
  **REJECT.** A proven-wrong table, not a plausibility argument.
- heading says **Electrical Characteristics or Specifications** -> accept, and
  **parse it for supply, variant and temperature scope**.
- **no heading found** -> **ACCEPT.** Our failure to locate one is not evidence
  the document lacks a specification table.

`SPECIFICATIONS` is ADI's word. Anchoring on `Electrical Characteristics` alone
refuses AD8232, which is the vocabulary gap that has already cost this project
`LGA`, `HTSSOP` and `\bLQFP\b`.

### 34.5 Running total of instances found in this design

| # | shape | where | status |
| --- | --- | --- | --- |
| 1 | throw away | 5-field list dropped 20 of 25 parameters | fixed |
| 2 | throw away | post-radiation corner discarded entirely | fixed, and it is the best feature found |
| 3 | throw away | spec blocks collected, one used | rule written |
| 4 | throw away | test conditions homeless | rule written |
| 5 | throw away | grade columns, one read | rule written |
| 6 | throw away | **the heading's scope** | **found here** |
| 7 | stupid refusal | require-a-symbol refused OPA2189 | deleted |
| 8 | stupid refusal | magnitude band, 7 decades, never fires | on probation |
| 9 | stupid refusal | unknown unit refused rather than flagged | demoted to flag |
| 10 | stupid refusal | **requiring a heading would refuse 3 of 10** | **found here** |
| 11 | every input passes | multi-grade columns; conformance cannot catch it | guard designed |
| 12 | every input passes | **abs-max table read as electrical characteristics** | **found here** |
| 13 | word boundary | `IQ1` normalised to `IQ` | fixed |
| 14 | vocabulary gap | `AVOL` missing; `SPECIFICATIONS` missing | enumerate from corpus |

---

## 35. The header vocabulary, and two more silent total losses

The reader anchors on `/^MIN$/i`, `/^TYP$/i`, `/^MAX$/i`. **Audited against how
the corpus actually prints those cells:**

| printed | strict match? | parts |
| --- | --- | --- |
| `MIN` `TYP` `MAX` | yes | 7 |
| `Min` `Typ` `Max` | yes | 2 |
| `UNIT` / `UNITS` / `Unit` / `Units` | yes | 6 / 2 / 3 / 2 |
| `NOM` | yes | 3 |
| **`TYP(2)`** and **`TYP (2)`** | **NO** | LM358 |
| **`Min.` `Typ.` `Max.`** | **NO** | TSV911 |

### 35.1 Two parts lost entirely, for punctuation

- **LM358**: TI fuses a footnote marker to the header, `TYP(2)`. Five pages of
  electrical characteristics become invisible. §34's continuation-page detector
  first reported this as "value rows with no header on the page"; the header was
  there and the regex could not see it. **The instrument was right about the
  symptom and I nearly recorded the wrong cause.**
- **TSV911**: ST writes `Min.` `Typ.` `Max.` with trailing periods. **The whole
  part reads zero parameters.** This is why §33.2's group census reported
  `TSV911 column groups: 0` and I passed over it.

`\bLQFP\b` cannot match `LQFP64`; `^TYP$` cannot match `TYP(2)` or `Typ.`. **Same
trap, one level up, and it costs whole datasheets rather than single fields.**

### 35.2 `NOM` is a signal, not just another column

Three parts print a `NOM` column. Min/nom/max is the shape of a **Recommended
Operating Conditions** table, not electrical characteristics. So `NOM` is
positive evidence about WHICH TABLE this is, and §34.4's reject list gains a
cheap deterministic tell that needs no heading at all.

### 35.3 Running total: 16 instances, 4 classes

| class | instances |
| --- | --- |
| threw away what was read | 6 (fields, post-radiation, blocks, conditions, grades, heading scope) |
| refused for our own reasons | 4 (require-symbol, magnitude band, unknown unit, require-heading) |
| every input passes | 2 (multi-grade columns, absolute-maximum table) |
| vocabulary / word boundary | 4 (`IQ1`, `AVOL`, `SPECIFICATIONS`, `TYP(2)` / `Typ.`) |

**The classes stopped multiplying several instances ago. Only the instances keep
coming.** That is the useful finding: this design does not have sixteen different
problems, it has four, and they recur wherever a reader meets a document it did
not anticipate.

**The general defence, which is cheaper than sixteen fixes:**

1. **Normalise before matching, everywhere.** Strip footnote markers, trailing
   periods and case from header cells; strip separators but never digits from
   symbols. One normaliser, audited once, used at every comparison.
2. **Enumerate every vocabulary from the corpus before writing the reader**, and
   put the enumeration in one place with a test that fails when a corpus document
   uses a term the list lacks.
3. **Reject on proof, never on absence.** Every refusal in §32.2 that survived is
   a proven contradiction; every one deleted was an absence.
4. **Read once, store everything, decide later.** Six of the six throw-aways were
   a decision made at extraction time that belonged at consumption time.

---

# Part III: built, 2026-09-04

`src/lib/spice/`, `src/app/api/model/route.ts`, `src/lib/__bench__/spicemodel.ts`.
1003 tests pass, 0 type errors, lint clean.

## 36. What it does

A datasheet in, three files out: a `.subckt` library, a `.asy` symbol, and a
conformance report saying which datasheet values the model reproduces and which
it cannot.

    vocab.ts     every vocabulary and the one normaliser
    specs.ts     the deterministic reader: a spec table from text-layer geometry
    pdfspans.ts  positioned text out of a PDF (dynamic import, air-gap safe)
    units.ts     printed unit to SI, and the Meg trap on the way out
    model.ts     rows to one coherent block of model parameters
    emit.ts      the .subckt and the .asy, from ONE terminal list
    verify.ts    ngspice, and the three verdicts
    confirm.ts   RULES.md 7 for parameters
    prompt.ts    the second reading, asked for once and in full
    build.ts     the fit loop: the generator IS a loop around the verifier

**Measured, `npm run bench:model`, free:**

| | |
| --- | --- |
| models built | **9 of 10** tuned-corpus amplifiers |
| conformance checks passing | **74 of 74** that could be checked |
| checks that could not be checked | 19, each naming why |
| the one refusal | LT1013, which prints no gain-bandwidth anywhere |
| corpus values against hand-read truth | **17 of 17** |
| bench proven able to go red | yes, 22 failures from an injected defect |

**Verified in the customer's tool.** Two Forge models in one LTspice schematic
with a corner sweep: gain 130 / 106 / 130 dB, exactly the datasheet's own
columns.

## 37. Defects found by building, that the design pass did not catch

Nine, and three would have been serious in the field.

| # | defect | how it was found |
| --- | --- | --- |
| 1 | **A hyphen in a part number is a MINUS SIGN in SPICE.** `.subckt LMP7704-SP` was never registered and the netlist reported "unknown subckt". **Every `-SP` rad-hard part, the entire target segment.** | running the bench |
| 2 | **Two models in one schematic collided.** Every parameter was global, so a second include gave "Fatal Error: Duplicate definitions for gbw_trim". A board with two op-amps is the ordinary case. | including two, which no single-part test does |
| 3 | **Gain was assumed to be in dB.** LM358 prints `100 V/mV`, so the emitter computed `10^5000`. Fixed by canonicalising where the unit is still known. | a part reading 0 measurements |
| 4 | Presence was not usability: LMP7704-SP has a gain row with no typical, so `missing` was empty and the netlist referenced a `.param` never emitted. | the same 0-measurement run |
| 5 | **A test was green for the wrong reason.** The absolute-maximum rejection passed because the unit `V` was mistaken for a symbol and vetoed the row. Section numbers (`6.1 Absolute Maximum Ratings`) had always defeated the heading match. | fixing an unrelated guard made the test fail |
| 6 | Adjacent column groups stole each other's values: LT1013's third group claimed the second's maximum. | a unit test written from the real geometry |
| 7 | A condition string counted as a parameter label, so `RLOAD = 10 kOhm` beat the real label. OPA2189 and TSV911 were refused for gain printed plainly on page 10. | chasing refusals rather than accepting them |
| 8 | The carried header never expired, so Typical Characteristics graph axis labels were read as specification rows. | the vocabulary audit printing `SOIC` as a parameter |
| 9 | A contradicting symbol DISCARDED the row instead of leaving it unnamed. | auditing every `continue` in the built code |

**Six of the nine are the same four classes** the design pass enumerated. The
classes were right; the instances keep coming, which is why the defences are
structural rather than a list.

## 38. Two guards added during the audit that were not in the design

**A typical column is what makes a table a characterisation.** Absolute Maximum
Ratings and Recommended Operating Conditions print MIN/MAX or MIN/NOM/MAX;
there is no such thing as a typical maximum rating. Requiring a TYP identifies
the right table STRUCTURALLY, without a heading, which matters because 3 of 10
corpus parts print their table under no heading this can find and because a
heading vocabulary is always one vendor away from a gap.

**The vocabulary audit runs every time.** `bench:model` prints every description
read from a specification table that the vocabulary cannot name. Fourteen of the
sixteen design defects were a vocabulary gap and every one was found by accident;
this makes them continuously visible. It found defect 8 within a minute of
existing.

## 39. What is still open, stated plainly

- **The second reading is not wired to a paid model.** `prompt.ts` and
  `confirm.ts` are built and tested, and `buildModel` takes the reading as an
  argument. Until something supplies it, every part reports its parameters
  **flagged as single-source**, which is the honest state and is what the receipt
  says. Nothing is confirmed that was read once.
- **No amplifier hold-out corpus exists**, so there is still no generalisation
  figure. Section 28 measured why: the blind corpus contains two op-amps. The
  90% above is a tuned number and this project's history says tuned numbers run
  about twenty points optimistic.
- **Slew rate is `unverifiable` by construction**, and the reason is in
  `verify.ts` so nobody re-adds it without solving the feedthrough problem.
- **Only op-amps.** References, comparators, LDOs and data-converter front ends
  are the same shape and are not built.

---

# Part IV: the second reading, 2026-09-04

Part III shipped one reading. RULES.md 7 needs two, so until this existed every
parameter was FLAGGED as single-source: honest, and not the finished product.

## 40. What was built

    prompt.ts     what the model is asked, designed once to ask for everything
    read-model.ts renders the table pages and takes the reading
    confirm.ts    compares the two, names the conflict, never ranks the readers

**Only the pages that carry a table are rendered.** The deterministic read has
already found them, so this pays for those pages and no others. The CAD path has
to let the model choose its own pages; here the question is already answered for
free, which makes the second reading both cheaper and more accurate than a
whole-document read. Measured: **about $0.012 a part.**

The prompt asks for **every row of every specification table**, not the six a
macromodel consumes today, because the prompt is the cache key and widening it
later re-reads the corpus for money. It also asks for the things this corpus
proved matter: test conditions per row, one entry per column group, one block per
supply, post-radiation values as first-class, and the unit as DRAWN rather than
as stored.

## 41. Four defects, all in the COMPARISON, all found by running it live

The readers were fine. The join between them was wrong four different ways, and
every one made the product report LESS confidence than it had earned. That
direction matters: a false disagreement is not a safe failure, it is noise that
teaches a user to click past the flags that do matter.

| # | defect | effect |
| --- | --- | --- |
| 1 | **A stale model name**, duplicated instead of shared with the CAD path. The API refused `gemini-2.5-flash`. | no second reading at all |
| 2 | **An unlabelled group was `null` on one side and `0` on the other.** My own prompt said "or by index if unlabelled"; the reader says null. | OPA333 reported 0 of 6 corroborated when both readings agreed on all six |
| 3 | **The canonical unit was applied to one side only.** LM358 prints `70 V/mV`, which the record turns into dB; the model's side stayed in V/V. | a disagreement reported where both readings said the same thing |
| 4 | **The join ignored the block scope**, which `toComparable` read and then dropped. | LMP7704-SP's 5 V row joined the model's 10 V row, and two correct readings were called a disagreement |
| 5 | **Fixing 4 by FILTERING on scope broke the opposite case.** The two readings word one heading differently: `LM358, LM358A` against `LM358 and LM358A`. | LM358 went from one disagreement to ZERO of six corroborated |

**Defect 5 is worth its own line, because it is a guard I added while fixing
another defect and it refused correct matches for a reason that was mine.** That
is the exact shape section 30.1 deleted from the reader hours earlier, committed
again in a different file. The rule that fixes it is the same one: **scope
DISAMBIGUATES, it does not GATE.** Where several candidates match, the block
decides between them; where one matches, a wording difference is not proof of a
different block. Reject on proof, never on absence.

**Defects 1, 3 and 4 are all "fixed in one place, not the other"**, which
`LEARNINGS.md` calls this codebase's dominant failure mode. All three were in
code I had written that same afternoon, with that lesson open in front of me.
The shape is not obvious from inside the change; it is only obvious when the two
copies are made to disagree.

**Defect 2 is a contract I wrote on both sides and made inconsistent.** The
prompt and the reader are the two ends of one interface, and nothing checked
they described the same thing. There is a test now.

## 42. What the second reading actually caught

Beyond the join defects, the pairing does the job it exists for. On the tuned
corpus it reports genuine disagreements between two independent readings of the
same table, each one a place where a value would otherwise have shipped silently
and one of the two readers is wrong.

The rule holds in both directions:

- **agree** -> confirmed, ships without being mentioned
- **disagree** -> flagged, with BOTH readings and the page, and no winner picked
- **only one reads** -> flagged, single source named

There is no fourth state and nothing falls through.

## 43. The amplifier hold-out corpus

`src/lib/spice/__bench__/holdout-corpus.ts`, 28 parts, written down before any
was opened, with `corpus-separation.test.ts` shipping the same day rather than
after the first misleading number.

It spans seven vendors, four device classes, four decades of typesetting, and
four rad-hard parts. That breadth is the point: every vocabulary defect found so
far was one vendor's house style, so a corpus from two vendors would measure two
house styles and call it generalisation.

**It is not measured yet.** The datasheets are not cached and fetching them is
the next step. Until then the 90% remains a tuned number, and this project's
history says tuned numbers run about twenty points optimistic.

## 44. The remaining disagreements are genuine, and one names a gap

Measured after the five join defects were fixed: **6 of 9 built models have both
readings agreeing on every parameter.** The other three are hand-checked below
rather than assumed, because five join bugs is enough to distrust a sixth.

**OPA2277, offset voltage max, 25 uV against 20 uV.** Genuine, and the reason is
worth recording. Its offset row is a centred label with grade sub-rows, and the
grade is named INLINE in each:

    OPAx277PA, UA    +/-20   +/-50
    OPAx277AIDRM     +/-35   +/-100
    VOS  Input offset voltage                 uV
    OPA277P, U               +/-30
    OPA2277P, U              +/-50

**That is a THIRD way a datasheet says which grade a value belongs to**, after
column-group labels (LT1013) and heading text (LM358). Both readings picked a
different sub-row, so neither is wrong: the value is genuinely ambiguous without
knowing which grade the user holds, and flagging it is the correct outcome.

**The gap, stated rather than closed:** inline grade labels are not modelled, so
these sub-rows are not separated into blocks the way the other two mechanisms
are. The consequence is a FLAG rather than a wrong value, which is the safe
direction, and closing it means teaching `specs.ts` a third grade mechanism.

`LMP7704-SP` (84 dB against 100 dB) and `LM358` (300 uA against 350 uA) are the
same shape: a parameter stated several times under different conditions, where
the two readings settled on different rows.

**So the pairing is doing its job.** Every one of the three is a place where a
value would otherwise have shipped silently and the two independent readings do
not agree on what it is.

## 45. Cost

    a second reading            about $0.012 a part
    the ten-part corpus         about $0.23 a run
    total spent this session    $1.21, against a $100 ceiling
    running total on the account $14.31

The whole deterministic half, the emitter, the verifier and `bench:model` are
**free**: no model calls, no network.

---

## 23. Generation on a part WITHOUT Zo, 2026-09-04

§22.2 named the next test. **Run. AD8628, which prints no open-loop output
impedance, generated from its own datasheet.**

| corner | Aol | target | GBW | target | Vos | target | Iq | target |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| typ | 145.000 dB | 145 | 2.5002 MHz | 2.5 | 1.000 uV | 1 | 0.850 mA | 0.85 |
| min | 125.000 dB | 125 | 2.5002 MHz | 2.5 | 5.000 uV | 5 | 0.850 mA | 0.85 |
| max | 145.000 dB | 145 | 2.5002 MHz | 2.5 | 5.000 uV | 5 | 1.100 mA | 1.1 |

**Exact on every corner, in ONE pass. No fitting was needed.**

### 23.1 The rule this establishes

§19 needed two fitting iterations; §23 needed none. The difference is not the
vendor or the part, it is whether the DATASHEET STATES A LOAD CONDITION that
creates a pole:

- **OPA333** specifies GBW at `CL = 100 pF` and prints `Zo = 2 kOhm`. Those two
  form a real pole that the stated 350 kHz already includes, so the internal
  parameter is not the printed one and must be solved for.
- **AD8628** prints no Zo and states no capacitive load on GBP, so there is no
  load pole to compensate and the printed number IS the internal number.

**So the fit is not a general complication. It is the correction applied when,
and only when, the document publishes enough to require it.** Direct substitution
is correct for the 60% of parts that print no Zo, and it is WRONG by 20% for the
40% that do. Both branches are now measured.

### 23.2 An instrument bug, found here rather than in the bench

The first AD8628 run reported Aol as 143.22 dB against a 145 dB target and the
model was correct. The rig measured Aol at 0.1 Hz, and with 145 dB and 2.5 MHz
the dominant pole sits at **0.14 Hz**, so the measurement was taken on the
roll-off.

**`bench:model` must derive its Aol measurement frequency from the part's own
pole (GBW/Aol), never use a fixed one.** A fixed low frequency silently
under-reports gain on exactly the high-gain precision parts this product is aimed
at, and it would have reported a correct model as failing. `LEARNINGS.md` already
holds several of these; this one is recorded before the bench exists rather than
after.

---

# Part V: the plan to finish, 2026-09-04

Five phases, ordered so the one that can still invalidate the others runs first.
**Money is authorised.** Estimates below are measured, not guessed: a second
reading costs about $0.012 a part and the ten-part corpus run costs about $0.23.

## Phase 1: measure on datasheets nobody tuned against

**This runs first because it can invalidate everything after it.** `bench:model`
reads 90% and that number cannot predict anything: every rule in `vocab.ts` was
added because a part in the tuned list failed. The extraction parser once read
69% tuned and 49% hold-out; retrieval read 95% and 87%. **Assume a gap and find
out how big.**

1. Fetch the 28 datasheets in `spice/__bench__/holdout-corpus.ts` through the
   existing retrieval chain, into a `.spice-holdout-cache`. Retrieval resolves
   about 87% on unseen part numbers, so expect 24 or 25 to arrive and RECORD the
   misses rather than substituting parts.
2. Add `bench:model-holdout`, the same instrument pointed at that cache, with
   `--confirm` available. **It must refuse to run against the tuned corpus**, and
   `corpus-separation.test.ts` already guards the lists.
3. Run it. Free without `--confirm`; about **$0.30** with it.

**What it proves:** whether the reader generalises or whether ten datasheets were
fitted. **Stop condition:** if models built falls below about 50%, stop and
report the failure CLASSES before building anything else. Do not fix individual
hold-out parts; that is what destroys the measurement.

**Cost: ~$0.30. Time: under an hour, mostly fetching.**

## Phase 2: run it in a browser

`LEARNINGS.md` records an app that never ran in a browser while every instrument
stayed green, because the CSP killed Next's bootstrap. **The SPICE button in
`SuiteWorkspace` has been typechecked and never clicked.** That is the same
omission.

1. Extend `bench:browser` to the SPICE intent: upload a cached datasheet, choose
   `spice`, click the button, assert a zip comes back with three files in it.
2. Fix whatever it finds.

**What it proves:** that the feature exists for a user and not only for a test.
**Cost: free.**

## Phase 3: the device classes after op-amps

Only when 1 and 2 are green, because a second class built on an unmeasured
reader multiplies the unknown.

In order, each the same shape as the op-amp and each a small addition to
`PARAMETERS`, `MODEL_PARAMETERS` and one emitter branch:

- **voltage references**: output voltage, initial accuracy, temperature drift,
  line and load regulation, quiescent current
- **comparators**: offset, hysteresis, propagation delay, output type
- **LDOs**: dropout, line and load regulation, PSRR, quiescent current
- **data converter analog front ends**: the sampling capacitor, switch
  resistance and reference charge model, which is what people actually simulate

**Each class ends with its own bench row and its own hold-out parts**, not with a
claim. The hold-out corpus already carries references and comparators for this.

**Cost: about $0.05 a part to verify. Time: the real work of the phase.**

## Phase 4: inline grade labels

OPA2277 names its grades inside the value sub-rows, a third mechanism after
column-group labels and heading text. Today that produces a FLAG rather than a
wrong value, so it is a coverage item and not a correctness one, which is why it
sits here rather than in phase 1.

Teach `specs.ts` to bind a sub-row to the grade named on it, and give the block
key a third component. **Measure the flag count before and after**: if it does
not fall, revert it rather than keep it.

**Cost: free.**

## Phase 5: commit

Nothing in Part III or IV is committed. Split by seam, not by file:

1. the reader (`vocab`, `specs`, `pdfspans`, `units`) and its tests
2. the model, emitter, verifier and the fit loop
3. the second reading (`prompt`, `read-model`, `confirm`) and its tests
4. the route, the UI branch and the live-defect fix
5. `bench:model`, the hold-out corpus and the separation test
6. `SPICE.md`

## What is deliberately NOT in this plan

- **Retrieval for SPICE.** The datasheet arrives the way it already does.
- **A cache for the second reading.** One call a part at $0.012 does not earn a
  cache, and a cache keyed on a prompt that is still changing is a trap.
- **Slew rate.** It stays `unverifiable` until someone reproduces a datasheet's
  own test circuit, and the reason is in `verify.ts` so nobody re-adds it blind.
- **Anything that reads a curve.** Measured 2026-09-04: the pairing that works is
  table against geometry, and the Bode plot cannot confirm DC gain because the
  asymptote is off-scale on the vendor's own plot.

# Part VI: the plan executed, 2026-09-04

Part V set out five phases. What follows is what each of them actually found,
because the findings are worth more than the plan was.

The short version: **the hold-out measured, and it disagreed with the tuned
number by 38 points.** The op-amp half generalises reasonably. The gap to the
headline was almost entirely device classes this product could not model at all,
which is a coverage fact and not a reading failure. Fixing the two mechanisms
behind the op-amp misses, and building the first of the missing classes, is what
the rest of the session went on.

## Phase 1: the hold-out, which is the only number that predicts anything

`bench:model-holdout` now exists, pointed at `.spice-holdout-cache`, and it is
the SAME instrument as `bench:model`: `spicerun.ts` holds the measurement and the
two runners differ only in which directory the PDFs come from and what the header
says. Two corpora scored by two copies of a measurement is the "fixed in one
place, not the other" shape, and the copies drift into a generalisation gap that
is really a bench difference.

It refuses to run if any part appears in both corpora, rather than warning.

### The first run

Twenty-eight parts were chosen before any was opened. Retrieval found 18 of them;
seven never resolved at all and are named in the output rather than counted as
misses, because a document we never fetched says nothing about the reader. Three
more came from the CAD corpus, which already held the same public documents.

The first honest number was **44% of cached parts built, against 90% tuned.**

That headline is misleading and the bench now says why. Split by class:

| class | built | note |
|---|---|---|
| op-amp | 8 of 11 (73%) | the generalisation gap: 17 points below tuned |
| comparator | 0 of 4 | not a class this product could model |
| instrumentation amp | 0 of 2 | same |
| voltage reference | 0 of 2 | same |

So the feature was an op-amp macromodel builder measured against a corpus of
amplifiers-in-general, and two thirds of its miss was a coverage boundary it had
never claimed to cross. The refusals were honest: a comparator datasheet does not
state an open-loop gain or a gain-bandwidth, and refusing to invent them is
correct.

### What the three op-amp misses had in common

All three refused for `gain-not-named`. Not a gain that was missing: a gain that
was PRINTED and whose wording was outside `vocab.ts`'s list of phrasings.

`vocab.ts` matches a row's printed description against a regular expression. That
is an allowlist, and `LEARNINGS.md` records allowlists broken by the next case
over and over in this codebase. The numbers were read. Only the name was missing.
That is `forge-we-had-it-and-threw-it-away`, the shape this project has hit more
than any other.

### The fix is not more phrasings

Adding the three wordings would have made the hold-out a second training set and
destroyed the only honest signal the feature has.

The product already takes a second reading of the same tables from the rendered
page, on every request, and already asks it to return every row. It can also say
WHICH standard quantity a row states, which is a naming question about text on
the page rather than a measurement. Asking costs nothing: it is one more field in
a reply already being paid for.

`identify.ts` applies that naming to rows the vocabulary left unnamed, under
three refusals, each rejecting on PROOF rather than absence:

1. a name outside the list is not a name;
2. a printed unit that contradicts the quantity's dimension refuses it, so a
   gain cannot be named in amps;
3. a row our own vocabulary already named something else is NEVER renamed. Two
   readings disagreeing about identity is a conflict, not an upgrade, and it is
   reported with both names and no winner.

**The model never supplies a value.** Numbers come from the deterministic reader
as they always have, so a row named this way still has both readings agreeing on
what it says. Only its identity has one source, and `confirm.ts` flags exactly
that, quoting the row's printed description and its page.

Measured on the tuned corpus, four parts had rows named this way: TLV9061's
quiescent current, OPA2189's and TSV911's gain-bandwidth, LT1013's output swing.

### One defect the fix introduced, and the rule that closed it

A model-named row displaced a vocabulary-named one on OPA2189 and took two
conformance checks from pass to unverifiable, because the row it displaced was
the one carrying the test conditions.

A row BOTH readings named now outranks one only the model named. That is not
ranking the readers, which is the rule this project has broken and paid for: it
chooses between rows that all claim to be the same parameter, and prefers the
better-attested identity.

## Phase 2: the button had never been pressed

`bench:browser --spice` loads `/suite`, the screen the SPICE intent lives on. No
instrument in this repository had ever loaded it. That is the same omission as
2026-08-24, when the whole application had been serving a dead page for its
entire life with every other instrument green.

`/suite` hydrates, so the CSP class of defect is not present. Four others were.

**1. `/api/identify` did not exist.** `/suite` posts every chosen file to it the
moment it lands. Every upload 404'd, the component caught the failure and carried
on, and nothing looked broken. The route is now built: the deterministic text
pass `/api/parse` already runs before the model leg, returned on its own. Free,
no model call, no network.

It returns `partNumberFrom`, because the part number it hands back is the FILE
NAME. `buildPartRecord` derives it from the uploaded name and marks it `user`. A
screen that prints that as an identification is presenting an assumption as a
fact, so the composer line now says "named from the file" when that is what
happened.

**2. A SPICE run spent a CAD parse it does not need.** The flow went through
`/api/parse` first, a full CAD extraction and about ninety seconds, purely to
populate a part number, and then posted the same PDF to `/api/model`, which reads
the document again. Two reads and two waits for one artefact, one of them for a
footprint nobody asked for.

**3. The model button was disabled by a footprint problem.** `packageChoice.ok`
gated the primary action for every intent, so a package that could not be settled
greyed out the button for an artefact that has no package, with a note beside it
about a missing dimension the model does not use.

**4. The SPICE panel was the string "Netlist panel goes here."** The receipt
existed only inside the downloaded zip, so the argument the product is built on -
here is what was checked, and here is what you should look at - was invisible
until somebody unzipped a file.

All four are fixed. `/api/model` grew a JSON response carrying the same bytes
plus the conformance rows and the flags, so the screen and the file cannot
disagree, and the free browser pass is green.

## Phase 3: the second device class

The hold-out said the biggest single gap was classes this product could not
model. The first of them is built.

### The bottleneck was not the vocabulary

Reading REF5025 first, before writing any of it: every value on its
specification page had **no unit at all**. A table with two column groups is
typeset over two header lines, the words PARAMETER, TEST CONDITIONS and UNIT on
the first and MIN TYP MAX MIN TYP MAX on the second. `readHeader` reads one line,
accepted the second, and came back with no unit column. Fifteen rows, not one of
them usable, because a value whose magnitude is unknown may not reach a model.

`adoptUnitColumn` looks up for the printed word, exactly as `labelGroups` already
looks up for the group names. It finds nothing on a one-line header, which is the
common case and is unaffected.

`units.ts` also had to learn that `ppm` and `%` carry their own magnitude rather
than a prefix. Treating `ppm` as scale 1 puts a 20 ppm/mA load regulation on the
record as 20 per milliamp.

### The topology is the datasheet's own definitions

A reference datasheet does not describe a circuit, but it states two partial
derivatives and states them by name. REF5025 prints them beside their own
symbols: `dVOUT/dVIN` line regulation, `dVOUT/dILOAD` load regulation. A source
whose value moves with the input at the stated slope, behind a resistance equal
to the stated output slope, IS those two statements.

The line slope needs an anchor, and the anchor is READ: the minimum supply the
datasheet states. Where none was read the line term is omitted rather than
anchored somewhere convenient, and the file says so.

The class is chosen from what the table states, never from the part number. An
output voltage alone is not enough - an amplifier datasheet can print a row
called `Output voltage` too - so the requirement is a genuine disjunction and is
written as one: an output voltage AND at least one regulation term.

### It is not fitted, and that is deliberate

The amplifier's fit loop exists because its parameters are specified at the pins
under a load, so the printed number already contains a divider the model must
solve back out. A reference's two regulation slopes ARE the pin behaviour. There
is nothing to solve for, and a loop here would be machinery that changes no
number.

REF5025 builds and verifies: 12 checks pass, 0 fail, 3 unverifiable, and the
unverifiable ones are the temperature drift, which is honest because temperature
is not a node in the netlist.

### What the new class then found in the OLD one

Running the hold-out with two classes exposed two defects that had nothing to do
with references.

**The verifier measured parameters the emitter never emitted.** `usable()` is the
one definition of when a value counts, and the emitter asks it. `verify` had its
own test, `valueAt(...) !== null` per corner. A parameter with a value at one
corner and not at every corner produces no element, and the rig went on measuring
it: TSB611 was reported as disagreeing with its own datasheet by its whole
offset. That is the LMP7704-SP presence-versus-usability defect a second time, in
the one other place with a private notion of "present".

**The reference rig refused to simulate anything without a stated supply.** Only
the line regulation depends on where the input sits. Two references built cleanly
and scored 0 of 9.

## Phase 4: the grades printed beside the value

OPA2277 states four offset voltages under one heading, labelled not above a
column group but in the test-conditions column, once per value line:

```
VOS   Input offset voltage    OPA277P, U        ±10   ±20   µV
                              OPA2277P, U       ±10   ±25
                              OPAx277PA, UA     ±20   ±50
```

Dropped, those look like readings of one row that disagree, and the two readings
of the page pick different lines: OPA2277 reported "offsetVoltage max: text layer
reads 25 µV, the page reads 20 µV" when both readings were correct.

A grade discriminates the whole table; a condition belongs to one row. That is
the evidence used: a non-relational cell carrying both a letter and a digit is a
candidate, and it is promoted only if it recurs across more than one parameter.
`To 0.01%` passes the first test and fails the second, which is the point.

**It does NOT split the block, and the reason is measured.** OPA2277's gain and
gain-bandwidth are discriminated by LOAD, not by grade, so splitting on grade
leaves every grade without the two parameters a model needs and refuses a part
that builds today. The grade travels on the row and joins the two readings.

## What was NOT built, and why

**Comparators, instrumentation amplifiers, LDOs and ADC front ends.** Six of the
ten hold-out refusals are these, so this is the largest remaining gap and it is a
coverage boundary rather than a reading failure. A comparator needs propagation
delay and hysteresis, which means a transient rig; the reference needed only DC.
Building one class properly and measuring it is worth more than four begun.

**An LTspice run of the reference netlist.** LTspice is no longer installed on
this machine. The syntax rules the previous LTspice session established - braced
parameter never braced expression, no hyphen in a subcircuit name, no parameter
outside the subcircuit, no suffixed value - are now asserted for EVERY emitter by
`netlist-syntax.test.ts`, together rather than one per emitter, because a second
emitter is exactly where "fixed in one place, not the other" recurs. That is not
the same as running it, and a new emitter still wants one hand-run.

## One open finding, not chased

MAX44242's model reproduces its offset voltage as 47.34 µV against a stated
50 µV, and the product reports it as a FAIL. The ratio is exactly the attenuation
a unity-gain follower shows at an open-loop gain of about 25 dB, which is not an
op-amp's open-loop gain, so the likely cause is an implausible gain that the
conformance check cannot see because the model reproduces whatever gain was read.

Swept synthetically across the whole slew-rate range, the offset rig is exact, so
this is not the tanh limiter and not a general defect. Diagnosing further needs
the page, and MAX44242 is a hold-out part. It is recorded here rather than fixed.

The interesting part is the mechanism: **the offset check is an independent
witness of an implausible gain**, and it is the only thing in the product that
noticed.

## Two measured negatives, so nobody retries them

**A graph-axis rejection rule is not worth its code.** Typical Characteristics
pages leak rows into the reader: OPA2277 page 11 yields `Input Bias Current (nA)`
with a "unit" of `Short-Circuit Current (mA)`, which is another axis label. A
rule refusing a row whose unit cell fails to parse AND reads like a parameter
description was measured across the tuned corpus: it drops **3 rows of 488, all
of them on one part, and none of them a model parameter.** Adding a guard on one
part's evidence is the tailoring the rules forbid. The related risk it looked
like it might close - a graph axis read as a supply voltage, which the reference
class now uses as its line-regulation anchor - is already shut, because a row
whose unit will not parse never enters a block at all.

**A percent fused to its value is not read.** REF5025 prints its initial accuracy
as `0%`, `0.9%`, `0.14%`, with the percent sign in the value cell and the unit
column empty. `parseNumber` refuses anything but a bare number, so those rows
carry no values and never reach the record. `initialAccuracy` is in the
vocabulary and will name the row wherever a vendor puts the unit in its own
column. Reading a fused unit out of a value cell is a separate change and is not
made on one part's evidence either.

## A cost defect found while waiting for the measurement

The second reading pays to render pages, and `tablePagesOf` chose them by ROW
COUNT. A Typical Characteristics page comes out of the text layer as rows whose
"unit" is another axis label, so a page of graphs outranks a real continuation
page.

Measured: LM358 rendered pages 16 and 19, three rows each and not one carrying a
scalable unit, while pages 7, 9 and 13 - two rows each, both scalable - were
dropped. REF5025 spent half its rendered pages on graphs, OPA2277 three of five.

Ranking instead by rows carrying a unit this reader can SCALE takes OPA2277 from
five pages to two, REF5025 from four to one, and puts LM358's three continuation
pages back in place of its two graph pages. Cheaper and better evidence at once.

Deliberately NOT ranked by whether the vocabulary could name the row: naming is
the very thing the second reading is asked to help with, and ranking on it would
starve the pages it is needed for. Where no page has a scalable unit the raw
count is the fallback, so a document this reader understands poorly is still
read rather than skipped.

## Three defects the audit found after the build

**The reference rig lost the precision its answer lived in.** Both regulation
terms are differences between two nearly equal voltages: a 1 ppm/V slope moves a
2.5 V output by 2.5 µV. The rig printed the two voltages and subtracted them in
TypeScript, which throws away every digit that matters. Measured: a stated
1.0 ppm/V came back as 0.8 ppm/V, a 20% error that is entirely printed
precision, and REF5025's 0.32% "agreement" was the same defect being flattered
by a larger number. Differencing inside the simulator with `let` takes every
reference check to **0.0000%**.

Found only by exercising the emitter's OTHER branch. REF5025 states both
regulation terms, so the no-load-regulation path had never been run; a test that
builds and simulates it now exists.

**`/api/model` declared no time budget.** `/api/parse` declares 150 seconds and
races the model pass against it, discarding the model leg when it expires. This
route, written afterwards, declared nothing and inherited the platform default,
so a slow second reading killed the whole request and the user got a generic
failure instead of the model the deterministic reading alone can always produce.
It now declares 150, gives the second reading 90 of them, and DEGRADES: a reading
that does not arrive leaves the parameters flagged as single-source, which is
exactly what the receipt already says when no second reading was taken. A timeout
is silence, and silence is not agreement.

**A zero-ohm resistor is a claim.** Where no load regulation was stated the
emitter wrote `Rout nref OUT 0`, which asserts a perfect output impedance the
datasheet never promised, as well as being an element some simulators warn on.

## Phase 2, finished: the button has now been pressed

`npm run build && npm run bench:browser -- --spice --full`

```
  /suite first-run window: "How does your line build boards?"
  model bundle: LMP7704_SP.lib, LMP7704_SP.asy, LMP7704_SP-conformance.txt

Required stages: 7/7
Browser problems: 0

OK. The app loads, hydrates and runs with no browser errors.
```

A real browser, the production build, the SPICE intent chosen, the datasheet
uploaded, the button pressed, and a zip with all three files opened and its
netlist checked for a `.subckt` line. The bench also asserts that **`/api/parse`
was never called**, so the double-spend fix is verified rather than asserted.

The free pass, `bench:browser -- --spice`, is green too and costs nothing.

One bench defect found on the way: the screen labels the read "Read for SPICE"
before a file is chosen and "Read for the model" after, and a bench that knows
one label reports a missing button when the other is on screen. The bench now
matches the shared prefix, and the screen's second label is "Read for the SPICE
model", so it gets more specific rather than less as the CAD one does.

## `--prove` was proving only half the output

`bench:model --prove` injects a defect into every model and requires the run to
go red. Its injection was `GBW_TRIM=0.5`, which is a parameter only the amplifier
netlist has. So the moment a second device class existed, the bench reported "the
bench can go red" while **every reference model went through the sabotage
untouched**, and its conformance checking was unproven.

An instrument that cannot fail on half its output is not a check on that half.
The injection is now per class - the amplifier's gain-bandwidth trim, the
reference's output voltage - and REF5025 goes from 0 failures to 3 under it.

This is the same shape as `forge-check-that-never-ran`: a check matched something
the thing under test does not produce. It took ten minutes to find and only
because the discipline is to run `--prove` after changing the instrument.

# Part VII: the numbers, 2026-09-04

Both corpora, same build, second reading taken on every part.

## Tuned, `bench:model -- --confirm`

```
models built: 10 of 11 (91%)   checks passing: 90 of 90 (100%)
built as: 9 opamp, 1 reference
refused:  1x opamp:gbw   LT1013

RULES.md 7: 6 of 10 built models had BOTH readings agree on every parameter.
```

The one refusal is LT1013, which genuinely prints no gain-bandwidth anywhere.

## Hold-out, `bench:model-holdout -- --confirm`

Twenty-eight parts written down before any was opened. Twenty-one are on this
machine; seven never resolved and are named rather than counted.

```
models built: 11 of 21 (52%)   checks passing: 98 of 101 (97%)

by device class:
  opamp             9/13   69%
  instrumentation   0/2     0%
  comparator        0/4     0%
  reference         2/2   100%

RULES.md 7: 6 of 11 built models had BOTH readings agree on every parameter.
```

**Read this as two numbers, not one.** 69% on unseen op-amps against 91% tuned is
the generalisation gap, and it is in line with what this project has measured
twice before: the extraction parser read 69% tuned and 49% hold-out, retrieval
95% and 87%. The remaining six refusals are comparators and instrumentation
amplifiers, which this product cannot model at all and refuses honestly.

The reference class, built today, reads **2 of 2 on parts it has never seen**.
One datasheet, REF5025, is what it was written against. That is a small
denominator and is stated as one.

## Phase 4 passed its own test

Part V said of the inline grade labels: *measure the flag count before and after;
if it doesn't fall, revert it.* Among the nine parts comparable across both runs,
disagreements between the two readings went from **5 to 3**. OPA2277 and LM358
both stopped reporting a conflict neither reading had made.

## The naming mechanism moved ZERO parts, and this is the honest result

`identify.ts` named rows on five tuned parts and seven hold-out parts. **Not one
of those twelve went from refusing to building.** Where a part was refused for a
gain, the model mostly did not propose a name for a gain row either: three of the
four refusing hold-out op-amps had nothing proposed at all, and one was named and
then stopped by a later gate.

So what it buys is not coverage. It buys conflict visibility - AD8232's two
readings now disagree over a gain, one saying 110 dB and the other 100 V/V, which
is a real conflict worth a person's glance - and it costs nothing extra, being
one more field in a reply already paid for. It is kept on those grounds and not
on a coverage claim, and the bench prints the count so the claim cannot drift.

The bench now also prints the GATE a named row failed at, so the next person does
not have to wonder why a mechanism's numbers went up while coverage did not.

## The second reading is now cached, reversing a Part V decision

Part V decided against caching: *"$0.012 a call does not earn one, and caching a
prompt that is still changing is a trap."* Measurement disproved both halves in a
day. A hold-out pass is 21 multi-image calls, costs $0.65, and took two and a
half hours because each request returns in minutes. It was wanted three times in
one session and paid for twice.

The prompt is IN THE KEY, which is the answer to the second objection: a reworded
prompt misses rather than reading a stale answer. A FAILED reading is never
stored, so one bad afternoon does not become permanent. The cache is
`__bench__`-only: a user's datasheet is read fresh every time, because caching a
reading of somebody's document is a decision about their data and the air-gapped
deployment has nowhere to put it.

## Session total

**$15.93.** Tests 1069, lint clean, typecheck clean, `bench:model --prove` red on
both device classes, `bench:browser --spice --full` 7/7 with zero browser
problems.

# Part VIII: the frontend, finished, 2026-09-04

`/suite` is the product. `/` is a redirect and `src/app/page.tsx` is forty lines.

## What had to be extracted rather than copied

`HANDOFF.md` named the catch: porting the panels means editing `page.tsx`, and
two copies of `Provenance` means two screens that can disagree about where a
value came from. So nothing was copied. Four modules now hold what both screens
needed, and the second screen was deleted rather than kept in step:

- `src/lib/record-ui.tsx` - the verdict card, worth a glance, the record panel,
  and now the review list, the question panel and the page image
- `src/lib/verdict.ts` - what the screen SAYS after a read, all seven states
- `src/lib/answers.ts` - what counts as a valid correction or answer, and the
  two bounds that mirror the export route

The verdict was the important one. `VerdictCard` had already been shared so the
two screens said the same thing; the DECISION of what to say was still a
120-line `useMemo` in `page.tsx`, and that is the half that can diverge while
each screen still looks self-consistent.

## Four defects on the SPICE path, found by pressing the button

Reported in Part VI and fixed: `/api/identify` did not exist, a SPICE run spent a
CAD parse it does not need, the model button was disabled by package problems,
and the receipt panel was a placeholder.

## Four more, found by porting the CAD path onto it

**The `done` body required `part`.** A SPICE run has no record, because it no
longer runs the CAD parse, so a finished read rendered NOTHING - no error, no
panel, a blank screen.

**`INPUT_REQUIRED` was a dead end.** `/suite` turned the one refusal the product
can actually resolve into a list of labels with nowhere to type. The question
panel is now on screen and the answers reach the export.

**An answered question came back looking unanswered.** A land pattern is asked
for as a GROUP - length, width and span - and the export re-asks the whole group
until all three are in hand, which is right. Clearing the box meant the same
three fields came back with the same empty inputs and no sign the number had been
taken. The answer stays in the box now.

**The route's explanation was thrown away.** `askForLandPattern` distinguishes
three cases and says which: a check rejected what the document printed, the
pattern was read and the arrangement was not, or the document genuinely did not
say. The screen replaced all three with "3 values are needed", which is a count
of the questions and tells the user nothing about whether to look at the page
again or reach for an application note. Measured live: with the sentence
restored, RHF1201 now says *"Ceramic SO48: the printed footprint was rejected: a
10.16 mm land on a 10.16 mm centre span"* - which is the truth, and which is also
how the bench's arbitrary numbers were finally identified as the cause of a
"loop" that had looked like a product defect for four runs.

## `intent` was never wired to the server, and does not need to be

`HANDOFF.md` seam 2 asks for `intent` on `/api/parse` and `/api/lookup` to select
the field set and the pages. It buys nothing: a SPICE read does not call
`/api/parse` at all - the model is built from the document by `/api/model` - so
there is no field set to narrow and nothing to skip. The seam is closed by the
architecture rather than implemented.

## The bench follows the screen

`bench:browser` drove `/`. Six hundred lines of it were deleted with the page,
and every property they held is asserted against the screen that ships:
hydration, the settings bound, blank settings not blocking a datasheet, the
verdict card, the record, the question loop, and a bundle in EVERY format,
downloaded and opened.

```
Required stages: 13/13
  KiCad bundle: 6 entries
  Altium bundle: 5 entries
  model bundle: LMP7704_SP.lib, LMP7704_SP.asy, LMP7704_SP-conformance.txt
Browser problems: 0
```

Two bench defects were found on the way, both of the same shape: a selector that
matched nothing (`.verdict` for a card whose class is `.result`) and a control
that was the wrong one (the FIRST "Use this" button after filling the third box,
which submits the first question's value). Each reported the product as broken.

# Part IX: device classes and retrieval, 2026-09-04

## The comparator class, and the reading defect it exposed first

The class was blocked before it began, and not by vocabulary. **LM139AQML-SP
read ZERO rows.** Its QML military table prints `Symbol | Parameters |
Conditions | Notes | Min | Max | Unit` - **no typical column at all** - and
`readHeader` requires one.

That requirement is sound and stays: a typical is what tells an Electrical
Characteristics table from an Absolute Maximum Ratings one STRUCTURALLY, without
trusting a heading, and there is no such thing as a typical maximum rating. It
has one blind spot, and the blind spot is this product's own market. A rad-hard
comparator with its entire table on the page read nothing.

Two fixes, each rejecting on proof:

- a header with MIN and MAX and no TYP is admitted **only under a section
  heading that has positively identified the table**, which is the evidence the
  typical was standing in for. An absolute-maximum heading is refused before
  this, so nothing is admitted on structure alone that was not admitted before;
- the heading match allows a short lead-in. TI titles the section `LM133 883
  Electrical Characteristics DC Parameters`, and a prefix match refuses it.
  Bounded to sixteen characters, because "see the Electrical Characteristics
  table on page 6" is a sentence and not a heading.

**Zero rows to 67.** Neutral on the tuned corpus: 10 of 11 before, 10 of 11
after.

## What a comparator model has to reproduce

A comparator is a decision, not an amplifier. The topology is an offset source, a
rail-to-rail decision, and the datasheet's own propagation delay. The delay is
not decoration: it is why anyone simulates a comparator rather than working it
out in their head, and it is the number every comparator states and no amplifier
does, which also makes it the class's discriminator.

**Open collector, when the document says so.** A part stating a saturation
voltage or a sink current has a stage that pulls down and does not pull up.
Modelled as push-pull it would drive a rail the real part leaves floating.
Where the datasheet states neither, the output is push-pull and the header says
which it chose and why.

**The delay is a transmission line.** `E` sources with a delay are not spelled
the same in ngspice and LTspice, and a file verified only under ngspice can be
one the customer's tool refuses. A lossless line is plain SPICE in both.

LM139AQML-SP: **propagation delay reproduced to 0.04%.**

## Two defects in that emitter, both invisible from outside

**A gain of two that should not have been there.** A matched termination halves
the step only when the SOURCE has a series impedance of Z0; driven by an ideal
behavioural source, the far end sees the full amplitude. Doubling it drove the
output factor below zero, the stage became a negative resistance, and the output
sat at its saturation voltage forever. The model simulated perfectly cleanly and
produced no transition at all.

**`limit()` is silently wrong in ngspice.** ngspice ACCEPTS `limit(x,0,1)` in a
B-source expression, evaluates it to something else, and reports nothing. Same
symptom: a clean run, a model that did nothing. `max(0,min(1,x))` is plain SPICE
and means the same thing in both tools.

Neither would have been caught by anything that asks whether a file parses. Both
were found by running the deck by hand and printing the nodes.

## The refusal census was naming the wrong class

With three classes, every failing op-amp began reporting
`comparator:propagationDelay`, because a comparator needs one parameter and an
amplifier needs two. NJM4580, which states neither a gain nor a gain-bandwidth
and is not remotely a comparator, was filed under the comparator class.

A class is now "closest" only when the document supplied PART of what it needs.
Where nothing matched even partly, the slug is `no-class-matched`, which is a
class boundary and deserves its own name in the census.

## Retrieval: six of the seven misses were TIME, not absence

The chain gives up after 12 seconds. That is right for a person who has typed a
part number - better to say no quickly than to be slow and then say no - and it
is wrong for assembling a corpus, where nobody is waiting. Most of the misses had
logged `budgetExhausted: true` all along.

Raised to 60 seconds **in the corpus fetch and nowhere else**. The product keeps
its 12, and `bench:retrieval-holdout` still measures retrieval under the budget a
user actually gets.

**21 of 28 cached to 27 of 28.** The one that remains, OPA4H14-SEP, is a genuine
miss.

**This is a finding about the product, and it is the user's call.** Six of seven
amplifier lookups that failed had the answer within reach and ran out of time.
Raising the product's budget trades a longer wait for real coverage; the
measurement is here, the decision is not mine.

Probing the seven by hand also settled what a pattern could and could not fix.
ADA4077-2 is filed as `ADA4077-1_4077-2_4077-4.pdf`, a combined family name no
part-number pattern produces. Microchip answers with 677 kB of HTML. And
`lm6142.pdf` serves a real PDF for `LM6142QML-SP` - which must NOT be used, since
it is the commercial part's datasheet and a rad-hard part's post-radiation specs
are a different document. `namesThePart` already refuses it, correctly.

## Where it stands

| corpus | built | note |
|---|---|---|
| tuned, 12 parts | **11 (92%)** | 92 checks pass, 0 fail |
| hold-out, 27 parts | **17 (63%)** | 133 pass, 3 fail |

By class on the hold-out: **comparator 4/4, reference 2/2, op-amp 11/19 (58%)**,
instrumentation 0/2.

The headline fell from 71% because the corpus grew by six parts and four of them
refuse. That is a better number, not a worse one: it is measured on 27 of 28
parts instead of 21.

Refusals, all named:

```
   4x  opamp:openLoopGain     TLV2372, ADA4077-2, TSZ182, RHF43B
   4x  no-class-matched       INA333, AD8226, MCP6V01, NJM4580
   2x  no-spec-table-read     ISL28110, ISL70444SEH
```

The last line is the one worth chasing next: two Renesas datasheets from which
this reader gets NOTHING, which is the same shape as LM139's military table and
is a reading failure rather than a class boundary. Not chased here, because
diagnosing it means opening a hold-out part, and the rule is that a part examined
to fix it must be promoted into the tuned corpus and replaced.

# Part X: the plan to finish, 2026-09-04

Seven phases, ordered so that each one's result can change the ones after it.
Every phase states what would make it a failure, because a plan without a stop
condition is a wish.

The hold-out rule governs throughout: **nothing in
`spice/__bench__/holdout-corpus.ts` may be opened to diagnose a failure.** Where
a phase needs a document examined, it names a part OUTSIDE the hold-out to
examine instead. That is not a formality; it is the only reason the 63% means
anything.

---

## Phase 1: raise the retrieval budget (approved)

Six of seven amplifiers the chain could not find had the answer within reach and
ran out of time. `DEFAULT_BUDGET_FALLBACK_MS` goes from 12s to **45s**.

**The risk, which must be measured and not assumed.** `/api/lookup` has
`maxDuration = 150`, spends part of it fetching the PDF, and then asks
`worthAsking(budgetMs)` whether enough remains for the model call. A model call
takes about 90 seconds. So a chain that may now spend 45 seconds finding the
document can leave too little behind, and the failure is SILENT AND EXPENSIVE:
the user gets a text-only record with a note, not an error.

So this phase is not one constant. It is:

1. Raise the default to 45s.
2. Assert the interaction that the constant creates: a test that a chain
   consuming its full budget still leaves `worthAsking` true within
   `maxDuration`. That relationship exists today and nothing checks it.
3. `readprogress.ts` bills stage one, "finding the datasheet", at 10 seconds.
   Make it agree with the budget, or the bar tells a user the fetch is over when
   it has 35 seconds left to run.
4. Measure `bench:retrieval-holdout` and `bench:coverage --live` before and
   after, **in the same session**, because search availability swings both.

**Stop condition:** if `bench:extraction` READ falls at all, back the constant
out. A slower lookup that reads less is strictly worse than a faster one that
finds less. Free, network only.

---

## Phase 2: the two datasheets that read NOTHING

ISL28110 and ISL70444SEH produce **zero specification rows**. No class can help a
part the reader gets nothing from, which makes this the highest-value phase and
the first real work.

There is a fresh precedent: LM139AQML-SP read zero rows until 2026-09-04, and the
cause was a military table with no TYP column plus a heading the prefix match
refused. Zero to 67 rows, two rules, both rejecting on proof.

**How this respects the hold-out.** Both parts are Renesas, and
`.bench-cache/ISL71001M.pdf` is a Renesas rad-hard part that is NOT in the
hold-out. Diagnose there. If ISL71001M reads cleanly and the mechanism cannot be
found without opening a hold-out part, then ISL28110 is promoted into the tuned
corpus and a replacement Renesas amplifier is added to the hold-out. Say which
happened.

**Stop condition:** if ISL71001M reads fine and no general mechanism is visible,
stop and record it rather than promoting a part to chase one datasheet. Free.

---

## Phase 3: the LDO class

The cheapest class left, because it is mostly the reference class again. A
regulator states **line regulation, load regulation, dropout voltage, output
voltage and quiescent current** - four of those five are already read, already
scaled, and already modelled, and the topology is the same two derivatives with a
dropout limit on top.

Six candidate datasheets are already on this machine: L7805, LD1117,
TPS7A4501-SP, TPS7A4700, RHFL4913, RHFL4913A. Two are rad-hard.

**What is genuinely new:** dropout (the output follows the input minus Vdo once
the input falls too low), current limit, and the fact that a fixed and an
adjustable regulator are different parts - an adjustable one's output is set by
external resistors and the datasheet states a reference voltage instead.

**The discriminator** is dropout voltage: a reference never states one.

**It needs its own hold-out, written before anything is opened.** The amplifier
hold-out has no regulators, so an LDO class measured only on the six above would
be a fitted number, exactly what `bench:model` is and says it is.

**Stop condition:** if the adjustable and fixed cases cannot be told apart from
what the document states, build the fixed case only and refuse the other by name.
Free to build, about **$0.10** to take a second reading of the hold-out.

---

## Phase 4: instrumentation amplifiers

Two hold-out parts, INA333 and AD8226, and the class an analogue engineer reaches
for most after the op-amp.

**Why it is harder than it looks, and what that means for the design.** An
in-amp's gain is set by an EXTERNAL resistor and the datasheet states the
equation, not the gain: `G = 1 + (100k / RG)`. So the model takes RG as a
subcircuit parameter, and the constant in that equation has to be READ from the
page rather than assumed - it is 100k on one part and 50k on another, and getting
it wrong is a silent factor-of-two on every gain.

Bandwidth and CMRR are then stated PER GAIN, usually as a small table, which is a
reading problem before it is a modelling one.

**The discriminator** is the gain equation itself. No op-amp prints one.

**Stop condition:** if the gain equation cannot be read reliably off the page,
this class does not ship. A model whose gain is wrong by the resistor constant is
worse than a refusal, because it simulates cleanly. Free, plus a second reading.

---

## Phase 5: the four gains that are printed and not named

TLV2372, ADA4077-2, TSZ182 and RHF43B each refuse for an open-loop gain that is
ON THE PAGE in a wording `vocab.ts` does not carry. `identify.ts` was built for
exactly this and **recovered none of them**: measured, the model mostly did not
propose a name for the gain row either.

So the first job is to find out WHY, and the measurement already exists: the bench
prints the gate a named row failed at. Three candidates, cheapest first:

1. **The prompt does not make the naming question prominent enough.** It is one
   paragraph among nine. Cheap to test, and the cache makes a re-run free.
2. **The row is not being READ at all**, so there is nothing to name. Distinguish
   with the row counts already in the bench output.
3. **The symbol is there and the description is not.** `classify` already falls
   back to the symbol; the symbol list may simply be short.

**How this respects the hold-out.** Diagnose on the tuned corpus, where LT1013
still refuses on `gbw`, and on any new part fetched for the purpose. Do NOT open
the four.

**Stop condition:** if two attempts do not move the hold-out, record it as the
measured ceiling of the naming mechanism and stop. A third attempt fitted to four
parts is how a hold-out becomes a training set. About **$0.30** per measured
attempt, less once cached.

---

## Phase 6: MAX44242's offset, the only open FAIL

The model reproduces 47.34 µV against a stated 50 µV. The ratio is exactly the
attenuation a unity-gain follower shows at an open-loop gain of about 25 dB,
which is not an op-amp's gain, so the likely cause is an implausible gain that
the conformance check cannot see because the model reproduces whatever gain was
read.

The interesting part is the mechanism: **the offset check is an independent
witness of an implausible gain**, and it is the only thing in the product that
noticed. That is worth generalising into a plausibility note whether or not this
part is fixed.

**This one cannot be diagnosed without the page.** So: promote MAX44242 into the
tuned corpus, add a replacement Maxim-heritage amplifier to the hold-out, and say
in `SPICE.md` that the hold-out was reduced by one for this reason. Do it
deliberately or not at all. Free.

---

## Phase 7: the release gate, then commit

Not a phase of work so much as the list that decides whether this is finished.
Ticked in Part XI below, with what each one actually measured.

- [ ] every device class measured on parts chosen before they were opened
- [ ] zero false confirmations, on both halves
- [ ] `bench:model --prove` red for every class
- [ ] `bench:browser -- --full` 13/13 with a bundle in every format
- [ ] the receipt names the class, the block, and every value read with its page
- [ ] the running cost per part stated, and the spend ceiling live

Then commit, in seam-sized pieces rather than one lump:

1. the specification reader (`specs.ts`, `vocab.ts`, `units.ts`, `pdfspans.ts`)
2. the model, the emitters and the verifiers, one commit per device class
3. the second reading and `identify.ts`
4. `/api/model`, `/api/identify`, and the `/suite` cutover with `page.tsx` deleted
5. the shared UI: `record-ui.tsx`, `verdict.ts`, `answers.ts`
6. the benches, the corpora and the cache
7. `SPICE.md`, `LEARNINGS.md`

---

## What this does NOT include, and why

**ADC analogue front ends.** Named in the original plan and dropped here. An AFE
is a data converter with an amplifier in front of it, and the converter half is
the thing `SPICE.md` Part I established this product cannot model: a datasheet
does not describe the sampling network, and a model that pretends to is the
confident wrong answer this whole feature exists to refuse. The amplifier half is
already covered by the op-amp class.

**Slew rate verification.** Still `unverifiable` on nine parts, and it stays that
way until a datasheet prints the test circuit. Measured: a generic rig reads
4 V/us on a 0.16 V/us part, because a fast edge couples through the amplifier's
own output impedance before the loop responds.

**An LTspice run.** LTspice is not on this machine. `netlist-syntax.test.ts`
asserts every rule the last LTspice session established, for every emitter, but
that is not the same as running it, and a new emitter still wants one hand-run
before it is believed.


# Part XI: the plan executed, 2026-09-04

Part X's seven phases, run. What each one produced, what it cost, and the two it
was right to stop.

---

## Phase 1: the retrieval budget, 12s to 45s

`DEFAULT_BUDGET_FALLBACK_MS` is 45 seconds. The measurement that justified it is
in Part IX: of 28 amplifier datasheets the chain reached 21 at 12 seconds and 27
at 60, and six of the seven misses had `budgetExhausted: true` in the log all
along. The product was telling users to upload a datasheet it could have found.

The constant was the small part. Two things around it were not.

**The arithmetic nothing was checking.** `/api/lookup` walks the resolver chain
and then hands the bytes to the model, both inside one request bounded by
`maxDuration = 150`. The chain's ceiling lives in the retrieval layer, the
model's budget in the extraction layer, and the request's ceiling in the app
layer; no file knew about more than one of the three. Spending 33 more seconds
on retrieval eats a budget the model call has to fit inside afterwards, and the
failure is silent in both directions - overshoot and the platform kills the
function, returning a 504 and throwing away a record that had already succeeded;
undershoot by less and `worthAsking` skips the model pass and the user gets a
thinner record with a note on it.

`src/lib/__tests__/route-budget.test.ts` now asserts

    chain budget + RESPONSE_MARGIN_MS + TYPICAL_MODEL_CALL_MS <= maxDuration

for every route that reads a document, reading each route's declared ceiling out
of its own source. Proved live: at a 100 second chain budget two of its five
assertions go red.

**The progress bar had no retrieval stage at all.** It described the model
pipeline - four stages totalling ninety seconds - on BOTH paths. So a lookup
spent its entire fetch showing "Whole document to the model", which had not
started and had no document yet, and because the schedule totalled ninety seconds
while the request could now run to a hundred and thirty-five, a perfectly normal
lookup would reach the end of the schedule and drop into the overrun creep the
bar reserves for a read that has gone long. It would have called the common case
abnormal.

`stagesFor` now takes `{ retrieving }` and prepends a "Finding the datasheet"
stage on the lookup path only. Its duration is a measured typical fetch, not the
chain ceiling: a schedule built from the ceiling would crawl for forty-five
seconds through a fetch whose median is a second, and then jump. 96 resolver
hits from the runs below: median 1.1s, mean 3.2s, p75 3.0s, p90 7.2s, max 30.0s.
The stage is the mean rounded up, because a bar that over-estimates stalls and a
bar that under-estimates creeps.

### The measurement, both corpora, one session

Run back to back on 2026-09-04, the 12 second runs first, with the budget forced
by `FORGE_CHAIN_BUDGET_MS` so the comparison is of the CONSTANT and not of two
versions of the tree. Search availability swings both numbers together and hard,
which is why they have to be taken in the same session.

| corpus | 12s | 45s |
| --- | --- | --- |
| retrieval hold-out, 62 unseen parts | 34/62, **55%** | 38/62, **61%** |
| live coverage, 80 tuned parts | 57/80, **71%** | 58/80, **73%** |

Four more of the unseen parts and one more of the tuned ones. That is the right
shape: the misses that were really timeouts were concentrated in the corpus
nobody has ever added a vendor pattern for.

**The stop condition Part X wrote could not have fired, and saying so is the
point.** It was "back it out if `bench:extraction` READ falls at all", and
`bench:extraction` reads PDFs out of `.bench-cache` with no network at all, so
the chain budget cannot reach it. An instrument that cannot fail is not a check.
The live condition is the table above, and both halves of it went up.

---

## Phase 2: the two datasheets that read NOTHING

**Found a real mechanism, on a part outside the hold-out, and it was not theirs.**

`.bench-cache/ISL71001M.pdf` is a Renesas rad-hard part not in any hold-out. It
read **zero specification rows** off a 37-page datasheet with a perfectly
typeset table, and the cause was three characters: Renesas marks footnotes with
SQUARE brackets, and its header reads `Min[1] | Typ[2] | Max[1]`. Only round
brackets were stripped, so `MIN[1]` did not equal `MIN`, no header was found,
and nothing was read.

**ISL71001M: 0 rows to 47.** The tuned corpus is unchanged to the row, which is
what a footnote-marker rule should do. Five more Renesas datasheets were fetched
to check the rule generalises and all five read: ISL70617SEH 62 rows,
ISL70417SEH 65, ISL71218M 96, ISL28022 50, ISL28133 22.

**It did not move ISL28110 or ISL70444SEH.** Both still read zero. What is known
about them without opening either: both carry a full text layer (3578 and 2934
positioned spans), so this is not a scanned document; and five other Renesas
datasheets, including two rad-hard ones from the same era, now read.

Per the stop condition, that is where this stops. The mechanism found was
general and is fixed; chasing the last two would mean promoting a hold-out part
to explain one document, and the evidence says it is not a vendor-wide shape.

---

## Phase 3: the LDO class - SHIPPED

Four device classes now: operational amplifier, comparator, voltage reference,
low-dropout regulator.

**The topology** is the reference's plus the one thing that makes a regulator
one: `VOUT = min(regulated value, VIN - Vdo)`. Simulating a 3.3 V rail from a
battery that sags to 3.4 V is the question a person opens a regulator model to
ask, and a model without that term answers it wrongly and confidently.

**The reading problem was bigger than the modelling problem**, which was not the
expectation. Four defects had to be fixed before a regulator could be read at
all, and three of them are general rules that were costing amplifiers too. They
are written up in `LEARNINGS.md`; in short:

1. **The near-miss symbol veto fired in both directions.** `Vd` is how ST writes
   a dropout voltage, our vocabulary spells it `VDO`, and the page's own correct
   symbol vetoed the row on four regulators. LM139AQML-SP, in the TUNED corpus,
   was losing its open-loop gain to the same rule.
2. **A regulation figure is not a slope.** A reference states `1 ppm/V`; a
   regulator states `50 mV` with `VI = 7.5 to 25 V` beside it. Reading the second
   into the first is a factor of fifty thousand, silently. They are now separate
   keys, routed by the printed unit, and `conditions.ts` reads the range out of
   the test conditions so the change can become a slope. Where the range cannot
   be read - RHFL4913 states `VI = VO+2.5 V to 12 V`, whose low end depends on a
   value the row does not carry - the term is reported read-but-not-modelled and
   nothing is assumed.
3. **A table caption naming the part is a scope.** L7805's datasheet carries
   sixteen tables, `Electrical characteristics of L7805A` through `of L7824A`.
   All sixteen merged into one block, and whichever row sorted first became the
   part: a coin flip between a 5 V regulator and a 24 V one with every value read
   correctly. Now sixteen blocks, and the block whose caption names the part
   asked for is chosen - a read, not a pick.
4. **A dropout voltage does not separate a regulator from a reference.** A
   low-dropout SERIES reference states one, and both references in the amplifier
   hold-out were built as regulators. The convention each states its regulation
   in does separate them, and the reader was already distinguishing the two.

**The class is discriminated three ways, all from what the document states:** it
needs an output voltage and a dropout; a ppm-per-volt regulation slope proves it
is a reference instead; and a dropout proves it is not a comparator, which is
what a rad-hard regulator printing `tPHL` and `tPLH` for its INHIBIT pin needs -
RHFL4913 was built as a comparator with every value read correctly.

**The adjustable case refuses by name**, which is what the plan's stop condition
asked for. RHFL4913 states an operating output RANGE rather than a nominal, and
comes back `ldo:outputVoltage`. TPS7A4501-SP states an ADJ pin voltage and comes
back `no-class-matched`. Neither is built as something it is not.

**Tuned:** six regulators added to `bench:model`, and four of the six build.
L7805 and LD1117 pass 15 checks each with zero failures.

**Hold-out:** `REGULATOR_HOLDOUT`, fifteen parts across six vendors, written
down before any of them was opened and before a line of `ldo.ts` existed.
Fixed and adjustable, two rad-hard, both ends of the quiescent-current range.

---

## Phase 4: instrumentation amplifiers - NOT SHIPPED, and the measurement says why

The stop condition was: if the gain equation cannot be read reliably off the
page, this class does not ship, because a model whose gain is wrong by the
resistor constant simulates cleanly.

Two in-amp datasheets were fetched for the purpose, both OUTSIDE the hold-out.
The equation is in the text layer and reads cleanly:

    AD620   page 3   `G = 1 + (49.4 kOhm/RG)`

and then INA128, page 3, prints **four different equations**:

    `G = 1 + 50 kOhm / RG`
    `G = 1 + 49.4kOhm / RG`
    `G = 1 + 50 kOhm / RG`
    `G = 1 + 100kOhm / RG`

because that page compares the part against its siblings and a competitor. A
reader that finds "the" gain equation on INA128 has a one-in-three chance of the
right constant, and every wrong one produces a model that simulates perfectly
with a gain wrong by up to a factor of two.

There is a defensible rule available - use the constant only where the document
states exactly one - and it would ship AD620 and refuse INA128. That is a real
design and it is not this one: it is a prose reader, a new terminal set, a new
topology with an external component, and per-gain bandwidth and CMRR tables, for
a class whose hold-out is two parts and where a large fraction of real devices
would refuse anyway.

**The stop condition was met, on evidence, from a part nobody is scored on.**
INA333 and AD8226 continue to refuse with `no-class-matched`, which is the
correct answer for a device this product does not model.

---

## Phase 5: the four gains printed and not named

Two of the four resolved, and not by the naming mechanism.

**ADA4077-2 now builds.** It was refused for an open-loop gain that was on the
page; the symbol-direction fix in Phase 3 recovered it. That is the second time a
"the vocabulary is missing a phrasing" diagnosis turned out to be a veto firing
on a correct reading.

**MAX44242 is Phase 6 and is dealt with there.**

**The remaining three - TLV2372, TSZ182, RHF43B - are now known to be missing the
value entirely rather than holding an unusable one.** The refusal slug says which:
a parameter present on the record but not expressible at every corner reports as
`openLoopGain(read-not-every-corner)`, and none of the three does. So the
military-table hypothesis - a guaranteed minimum gain with no typical, in a block
whose other rows have typicals - is ruled out for these parts without opening
them, and the corner rule is not what is costing them.

That is one measured attempt of the two the plan allowed, and it spent nothing.

---

## Phase 6: MAX44242 - the only open FAIL, and it was not the gain check

MAX44242 was promoted into the tuned corpus and MAX4239 replaces it in the
hold-out: same vendor heritage, never opened, corpus the same size. That trade is
recorded in the corpus file itself as well as here.

**The cause was a Unicode character.** Maxim writes a test condition as
`250mV <= VOUT <=` using U+2264. `describedBy` recognises a condition by the
relation in it and matched only `[=<>]`, so that cell read as the row's own
DESCRIPTION. The row carrying the open-loop gain - min 134, typ 145 dB - was
filed under the parameter name `250mV <= VOUT <=`, and the gain was taken instead
from a sub-row of the INPUT OFFSET CURRENT above it, which sits at 25.

**The model shipped with an open-loop gain of 25 dB.** Every conformance check
passed except one: the offset came back 47.34 uV against a stated 50, because a
unity-gain follower at 25 dB attenuates its own offset by exactly that ratio.

The prediction in Part X was right about the mechanism and wrong about what to do
with it. It called for a plausibility note on implausible gains. What the episode
actually shows is stronger and needs no new constant: **a parameter check on an
unrelated quantity was the only thing in the product that noticed**, and it
noticed because the model reproduces whatever it was given and two independent
readings then disagree with each other. That is THE INVARIANT working, not a
missing bound.

MAX44242 now passes 12 of 12.

**One measured negative from the same investigation.** A phantom
`openLoopGain max 25 dB` row is still on the record, because a labelled row that
carries its own values is excluded from donating its label to an orphan sub-row.
Letting it compete on distance was tried and measured across nineteen datasheets:
it moves row attribution on twelve of them in both directions - AD8628 loses its
supply rejection entirely, OPA2277 drops from three offset-voltage rows to one -
and there is no oracle that can say which of those are improvements. Reverted.
The phantom does not ship: the block builder prefers a candidate carrying a
typical and the correct gain row has one.

---

## What the instruments gained

Three of these were found by the instrument failing to report something, which is
the failure mode `LEARNINGS.md` keeps naming.

- **`bench:model` and `bench:model-holdout` print every FAIL, always.** They
  printed the ten most common reasons a check did not pass, sorted by count, so
  the corpus's only three failures were invisible under ten copies of an honest
  "cannot measure".
- **A model built as a different class than the corpus expected is reported.**
  Every hold-out part carries a hand-written class recorded before the datasheet
  was opened. It sat unused while both voltage references were built as
  regulators; the bench was already loading the field.
- **`--prove` sabotages the regulator's dropout**, so the fourth class cannot pass
  a run that must go red.
- **The regulator hold-out is scored by the same runner as the amplifier one.**
  Two runners would drift the day one gained a flag the other did not.
- **The corpus-separation test covers the new corpus**: no regulator may sit in
  the tuned corpus, in the amplifier hold-out, or twice in its own list, and
  every class this product models must have both a tuned part and a hold-out.


---

## Phase 3b: the one question the model is allowed to ask

The LDO class shipped and then measured **3 of 13** on the regulator hold-out.
One refusal accounted for eight of them, `ldo:outputVoltage`, and the mechanism
was found entirely outside the hold-out.

**Fourteen regulator datasheets were fetched for the diagnosis. Seven state no
nominal output voltage anywhere.** TPS7A02, ADP151, TLV70012, LP5907, MIC5205
and the TPS736 family all print an output ACCURACY - `±2%`, `Nominal accuracy` -
and no nominal, because on a fixed LDO the voltage is an ORDERING OPTION. The
number lives in the part-number suffix and nowhere else in the document.

Decoding that suffix is not available to this product, and the reason is not
squeamishness: `-1.8` means 1.8 V on one vendor, `3302` means 3.3 V on another,
and the class-selection doctrine already says a model is decided from what the
document states and never from a part number. RULES.md 1 says the same about
values.

So the honest options were to refuse or to ask, and **asking for one number an
engineer is holding is the friction this product exists to trade for.**

### What was built, and the four things that keep it honest

1. **The list of askable values has exactly one entry.** `outputVoltage`, on a
   regulator. Each entry has to clear a bar: the document genuinely does not
   state it, the person holding the part knows it without looking anything up,
   and getting it wrong is obvious rather than silent. An open-loop gain or a
   propagation delay is a characterisation the vendor measured, and a box
   inviting somebody to type one would turn this product into the thing it
   exists to replace.

2. **A supplied value is never given a page.** `ModelValue.page` became
   nullable, and null means nobody read it. Every citation in the product is
   `page N`; printing one beside a number a person typed is fabricating
   provenance. The netlist header says `(supplied by you, not stated by this
   datasheet)`, then says it again in a sentence, and the receipt says it ABOVE
   the table of verdicts - because a check against the user's own number
   reproduces it perfectly and would otherwise look like evidence.

3. **A value the document states is never overwritten.** The user is answering a
   question this product asked because the page was silent. If the page was not
   silent the question should not have been asked, and the page wins. Asserted
   on L7805, where a supplied 42 V does not appear in the file at all.

4. **The question is not offered where its answer would go nowhere.**
   `ldo:outputVoltage` and `ldo:outputVoltage(read-not-every-corner)` are
   different refusals: the first is a silent document and an answer lifts it,
   the second is a value on the record that the model cannot use at every
   corner. MAX8880 is the second, and it gets no box.

### The numbers

The bench answers the question itself, with a deliberately implausible 7.77 V,
purely to find out WHICH refusal each one is. **The rebuilt model is thrown away
and its conformance checks are not counted**: a model built from a number the
bench invented reproduces that number perfectly, and scoring it would be the
bench marking its own homework.

| corpus | built | after one supplied value |
| --- | --- | --- |
| tuned, 20 parts | 16, **80%** | 18, **90%** |
| hold-out, 39 parts | 20, **51%** | 28, **72%** |
| hold-out, LDO class only, 13 parts | 3, **23%** | 11, **85%** |

The regulator class is the one the question was built for and it is the one that
moves: 23% to 85% on parts chosen before any of them was opened, for one number
an engineer reads off the part in front of them.

RHFL4913 is the case worth naming. It is a rad-hard ADJUSTABLE regulator, whose
output is set by external resistors, so its datasheet states an operating output
RANGE and no nominal - correctly. Part X's stop condition said to build the fixed
case and refuse the adjustable one by name. It does refuse by name, and then the
same question builds it, because what the user supplies is exactly the thing the
external resistors set.

---

## The hold-out, in full, 2026-09-04

39 parts, chosen before any was opened, never tuned against. Four not cached and
not counted: MAX4239, OPA4H14-SEP, LT1763, ISL75052SEH.

| class | built | of | after one answer |
| --- | --- | --- | --- |
| operational amplifier | 11 | 18 | 11 |
| comparator | 4 | 4 | 4 |
| voltage reference | 2 | 2 | 2 |
| low-dropout regulator | 3 | 13 | 11 |
| instrumentation amplifier | 0 | 2 | 0 - not modelled, see Phase 4 |

**149 checks pass, 0 fail.** The one failure this corpus had is Phase 6 and is
fixed. 71 unverifiable, and every one of them says why in the verifier's own
words: 27 are a slew rate no generic rig can reproduce from what a datasheet
states, 18 are a comparator's offset and hysteresis measured by a rig that only
sees the decision's timing.

**What is left, in order of how many parts it holds:**

- **8 regulators** now lift with one answer, which is the design above.
- **4 refuse as `no-class-matched`**: INA333 and AD8226 are instrumentation
  amplifiers, deliberately not modelled and explained in Phase 4; MCP6V01 and
  NJM4580 state neither an open-loop gain nor a gain-bandwidth.
- **3 refuse for an open-loop gain that is on the page** in a wording the
  vocabulary does not carry, and Phase 5 established the value is absent from the
  record entirely rather than present-and-unusable.
- **3 read no specification table at all.** Two are the Renesas pair from
  Phase 2; the third, LP2985, is new and unexamined.

---

## Phase 5, second and final attempt

The last attempt made the naming question the first instruction in the rendered
page prompt, then measured only TLV2372, TSZ182 and RHF43B. The hold-out runner
gained `--parts=` for this purpose, so a three-part hypothesis did not re-read
thirty-six unrelated documents.

**Result: 0 of 3 moved.** All three still refuse for `opamp:openLoopGain`.
The attempt cost **$0.1649**, or **$0.0550 per part**. The prompt change was
reverted because it bought no coverage. This is the second attempt Part X
allowed, so the naming mechanism stops here. Its measured value remains conflict
visibility, not additional models built.

The run exposed a separate production defect. The CAD extraction factory prefers
Vertex when its service-account credentials are configured, but the SPICE second
reading ignored that selection and always called AI Studio. AI Studio's prepaid
credits were depleted, so every model could still be built but no parameter could
receive its second reading. The SPICE path now makes the same provider choice as
the extraction path, uses the same model and Vertex endpoint definitions, and
records reasoning tokens on both transports.

---

## Phase 7: release gate

- [x] **Every shipped device class is measured on parts chosen before they were
  opened.** The hold-out has 18 op-amps, 4 comparators, 2 references and 13
  LDOs. Instrumentation amplifiers are not a shipped class; Phase 4 records the
  stop condition that refused them.
- [x] **Zero false confirmations, on both readings.** A missing, malformed or
  unavailable second reading stays flagged, a disagreement shows both values,
  and model-named rows remain flagged. The confirmation and provider-selection
  contract tests are green.
- [x] **`--prove` goes red for every shipped class.** On 2026-09-05 the tuned
  corpus produced 41 failures with defects injected and the hold-out produced
  56. The clean runs immediately afterwards produced 145/145 and 149/149
  passing measurable checks respectively, with zero failures.
- [x] **The production browser path completes every required stage.** The old
  13-stage wording in Part X is stale because the shared suite later added two
  required checks. `bench:browser -- --full` now passes **15/15**, with zero
  browser problems. It opens the SPICE `.lib`, `.asy` and conformance receipt,
  and opens both KiCad and Altium bundles.
- [x] **The receipt names the class, selected block and provenance.** It now
  lists the block and how it was chosen, then every parameter with its printed
  corners, unit and source page. A supplied value is named as supplied and is
  never assigned a page. The route contract asserts both an op-amp and an LDO.
- [x] **Cost and ceiling are visible.** The final naming attempt measured
  $0.0550 per part. The deployment ledger ended at **$17.7827 across 703 billed
  calls**, against a default cumulative ceiling of $25. The release session
  began at $17.2723 and added $0.5103. A requested $0.50 cap was configured as
  a $17.77 cumulative ceiling; the last call crossed it by about one cent
  because the guard checks before a call whose final token count is not yet
  known. That is a stop-before-next-call ceiling, not a reservation system.

### Defects found by the release gate

The gate found three issues and each is held by a check now:

1. When ngspice was absent from PATH, the op-amp verifier reported parameters
   the emitter had deliberately omitted and dropped the slew-rate
   `unverifiable` row. The missing-simulator path now uses the same `usable`
   predicate as the emitter and preserves honest unverifiable results.
2. A SPICE refusal with an answerable question moved `/suite` back to the
   pre-read phase. The question UI lives in the completed-read body, so the
   correct 422 response was present and invisible. A refusal now completes the
   read, the body admits a refusal without a built model, and the browser bench
   treats `/api/model` 422 as the designed response it is.
3. The SPICE second reader bypassed Vertex provider selection. It now follows
   the same preference as the CAD extraction path and has a local selection
   contract test.

### Commit status

The implementation is deliberately left uncommitted. This repository requires
explicit approval for each commit, and the worktree already contained the
feature as one large uncommitted set when this continuation began. The seven
seams in Part X remain the intended commit boundaries; creating them is the only
release step that still needs the owner's explicit instruction.

---

# Part XI — closing the suite handoff, 2026-09-05

The release gate above covered the model pipeline but not every product seam in
`src/app/suite/HANDOFF.md`. This continuation closes those seams without changing
the interaction flow the product owner approved.

## The two Renesas zero-row parts

The earlier Phase 2 stopped after fixing square-bracketed header footnotes on a
tuned Renesas part. ISL28110 and ISL70444SEH were then deliberately promoted out
of the hold-out and replaced before their pages were used for diagnosis.
ISL28118 and ISL70218SEH are the unseen replacements; both built without tuning.

The promoted pages exposed two more general layout rules:

1. Renesas staggers one logical header over adjacent baselines: MIN/MAX on one,
   TYP/UNIT roughly ten points below. Header reconstruction now merges header
   tokens only from adjacent baselines inside a tight 12-point bound.
2. An `AC SPECIFICATIONS` or `DC SPECIFICATIONS` subsection belongs to the
   supply scope immediately above it. Treating it as a fresh scope split
   open-loop gain from gain-bandwidth and left no buildable block.

Both rules have local contract tests. Fresh deterministic readings now produce
80 rows and a five-parameter op-amp model for ISL28110, and 104 rows and a
five-parameter op-amp model for ISL70444SEH.

## Review and correction

Every extracted model parameter is now reviewable in the suite. The folded list
shows printed min/typ/max, unit, and source page. Opening a row shows the rendered
page rather than the flattened PDF text. A correction requires a value, its
printed unit, and its source page; the server validates physical dimensions,
rebuilds the selected specification block, excludes the human-edited value from
the machine second-reading claim, and records `corrected by you from page N` in
the receipt. Corrections are bounded to 20 rows and 12KB.

## One bundle for Both

`Both` remains a first-class third intent because the approved suite flow is not
being redesigned. It now downloads one `${part}-forge.zip`, with CAD files under
`cad/`, model/symbol/receipt under `spice/`, and a root README. The route opens
and copies the server-created CAD ZIP; the browser never reimplements either
archive format.

## Vendor models

Forge never silently substitutes a vendor model for the generated one and never
redistributes a file supplied by the user. Where an exact model was verified to
exist, the result links directly to the vendor resource; otherwise it labels a
generic product-resource page without claiming a model exists. A supplied model
is wrapped behind Forge's canonical terminal order only when every terminal maps
unambiguously and there are no extras, then run through the same class-specific
datasheet checks. Refusal and missing-simulator states are explicit, and a
separate vendor conformance receipt is included without the vendor file.

## UI and release result

The exact emitted `.asy` is parsed into the on-screen symbol preview, including
the `.SUBCKT` terminal order. The parameter review and vendor check are
progressive disclosures inside the existing result screen, not new workflow
steps. The suite has dedicated light/dark semantic palettes, visible keyboard
focus, touch-size controls, and narrow-screen correction layouts.

Release results after these seams:

- `npm test`: **1,143/1,143 pass** (including independent pyaltiumlib and kiutils
  readers).
- `npm run build`: production build passes on Next 15.5.20.
- `npm run bench:browser -- --spice --full`: **19/19 required stages**, zero
  browser problems. The new parameter review, correction action, `.asy` preview,
  and vendor-model seam are required stages.
- `npm run bench:ltspice`: OPA333, LM139AQML-SP, REF5025, and L7805 are accepted
  by official LTspice 17.2.4.

The work remains deliberately uncommitted pending explicit commit approval.

---

# Part XII — exhaustive coverage without an exhaustive bill, 2026-09-05

“Exhaustive” now means every declared independent risk cell, not hundreds of
part numbers that repeat the same risks. `spice/__bench__/coverage.ts` declares
31 cells spanning every supported and intentionally refused class, seven vendor
house styles, legacy and modern documents, channel counts, commercial,
automotive and radiation-qualified parts, regulator variants, comparator output
stages, power regimes, and the layout mechanisms that have caused real reader
failures. An exact branch-and-bound set-cover solver selects 13 of the 43 frozen
hold-out parts. A test proves both that all cells are covered and that removing
any selected part loses coverage. This is the default paid `--confirm` panel;
`--all` is the explicit expensive option.

The full deterministic census remains free and runs over all 43 documents.
After the changes below it measures 25/43 automatic builds and 36/43 (84%) after
the single safe ordering-option answer. The coverage gate requires all 43
documents, every risk cell, at least 50% automatic builds, at least 80% safe
completion, no conformance failure, and no class disagreement. A minimum
set-cover panel is not a prevalence sample, so its percentage is never used as a
success-rate estimate; it gates only coverage and independent-reading
availability.

The minimized paid gate completed on all 13 selected documents for $0.5842.
Five of eight buildable models had both readings agree on every parameter; the
other three returned explicit review flags, not silent acceptance. The gate
therefore passed the availability and coverage contract without converting
disagreement into failure or agreement into a guess.

Two general mechanisms moved the result:

1. A PDF may fuse `MAX UNIT` into one text object and draw the actual unit close
   to the MAX heading. The reader now infers a unit column only from a repeated,
   dimensionally parseable x-cluster. Repeated inline qualifiers such as
   `Legacy chip` and `New chip` attach to the nearby centered parameter label
   and remain the grade, rather than replacing the parameter name.
2. The provenance corner set is not necessarily the set a topology can emit.
   A min/max-only required value and a typical-only required value honestly
   support min and max models through the document's stated typical fallback;
   an unrelated typical must not invalidate them. Each class now emits the
   intersection jointly supported by its required parameters. No missing corner
   is invented.

The remaining three hold-out op-amp gain misses now have a general recovery
path rather than a prompt fitted to three pages. A refusal returns rendered
specification pages and the missing parameter. The suite requires a human to
enter at least one printed corner, its printed unit and its source page. The
server validates the physical dimension, rebuilds the block, and records the
correction in the receipt. This channel is deliberately separate from the one
uncited value Forge accepts for a fixed regulator ordering option.

Instrumentation amplifiers still refuse. That is the Phase 4 stop condition,
not unfinished topology work: the gain-setting resistor constant must be read
from the equation, and the current reader cannot prove that association across
unseen documents. Forge will not ship a cleanly simulating factor-of-two error.
The class remains in the risk matrix so this refusal cannot disappear from
coverage reports.

Commands:

```bash
npm run bench:model-holdout                 # all 43, free and offline
NGSPICE_BIN=/path/to/ngspice npm run bench:model-coverage
                                             # full census and coverage floor
npm run bench:model-holdout -- --confirm --gate  # 13-part minimum paid panel
npm run bench:model-holdout -- --confirm --all   # explicit full paid census
NGSPICE_BIN=/path/to/ngspice LTSPICE_BIN=/path/to/LTspice npm run bench:model-release
                                             # coverage plus official LTspice
```

Final local verification: 1,149/1,149 tests, lint, TypeScript and the Next.js
production build pass; the production-browser suite passes 20/20 required
SPICE stages with zero browser problems; official LTspice 17.2.4 accepts the
op-amp, comparator, reference and LDO representatives. With the installed
ngspice selected explicitly, the complete unseen census produces 201 measurable
passes, zero failures and 85 honest unverifiable checks. Injecting a defect into
every emitted class produces 70 failures, proving the instrument can go red.

---

# Part XIII — no avoidable dead ends, 2026-09-05

“Every theoretically possible part” cannot mean that a datasheet always
contains enough information to derive an arbitrary transistor-level model. It
means Forge must never refuse an artefact it can hand over honestly, and every
non-result must name the missing route rather than falling outside a list of
four component classes.

There are now three exhaustive strategies:

1. Forge generates and numerically checks its four evidence-backed behavioural
   classes: op-amp, comparator, voltage reference and LDO.
2. If the table reader found relevant rows but missed class recognition or a
   required value, `/suite` shows the rendered specification pages. A person
   can identify the stated class and transcribe cited min/typ/max values. A
   correction cannot cite a page outside the uploaded PDF, and an empty machine
   reading can be seeded by those reviewed values without any part-number rule.
3. Any standalone vendor `.SUBCKT`, regardless of component category, can be
   adapted without interpreting its terminals. Forge displays and preserves
   the declaration's exact order and emits a neutral symbol. Files containing
   helper subcircuits require the user to select the part-level declaration.
   Primitive `.MODEL` cards cover resistor and capacitor models (after asking
   for their required instance value), diode, BJT, JFET, MESFET, monolithic and
   vertical MOSFET, IGBT, voltage- and current-controlled switch, lossy
   transmission line, and distributed RC (after asking for its required
   length). LTspice does not recognize `L` as an inductor model-card type, so a
   bare inductor remains an ordinary value-bearing instance rather than a
   vendor-model adapter.

The vendor file is never copied into the archive. The generated adapter uses an
`.include` and tells the user which original filename must sit beside it. This
is deliberately labelled **structural acceptance**: terminal order is checked,
but terminal meaning and numerical behaviour are not claimed unless the normal
class-specific conformance rig was available. The existing generated-model
cross-check refuses simulator-control and external-read directives before
handing uploaded text to ngspice.

`spice/opportunity.ts` is the strategy registry. Every generated class must
have automatic and cited-review routes; every primitive type declared there
must be accepted by the inspector; and every generated-model refusal resolves
to one named disposition: configuration, page review, vendor model, declaration
selection, or unusable vendor file. `npm run bench:model-capabilities` enforces
those contracts and is the first stage of `bench:model-release`.

The official-LTspice stage is table-driven from that same primitive registry.
Adding or removing an adapter contract without adding or removing its actual
LTspice execution case fails the release gate. Every declared contract, plus
an arbitrary subcircuit and one representative of every generated class, must
be accepted by LTspice before release.

This closes avoidable refusals without claiming the impossible. A document with
no sufficient measured behaviour and no usable supplied model still cannot
produce an honest model. Forge now says exactly that while offering the two
ways evidence can be added; it does not approximate an arbitrary topology from
a marketing table.

Final verification after this closure: **1,168/1,168 tests**, lint, TypeScript
and the production build pass. The full 43-part gate still reports 201
measurable passes, zero failures and 84% safe datasheet-only completion. The
production-browser suite passes **22/22 required stages** with no browser
problems, including refusal → vendor upload → helper selection → adapter and
the instance-value configuration path. Official LTspice 17.2.4 accepts all four
generated representatives, a numeric-named 128-terminal subcircuit adapter,
and every one of the 17 declared primitive `.MODEL` adapter contracts.
