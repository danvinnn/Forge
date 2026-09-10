import { test } from "node:test";
import assert from "node:assert/strict";
import { datasheetTextFromPages, namesThePart, looksLikeWrongDocument } from "../pdftext";

// A REAL DATASHEET FOR THE WRONG PART.
//
// Found 2026-08-21 by hand-reading a package drawing that did not match the part
// it was filed under. Three of the 123 cached datasheets were the wrong device:
//
//     TPS7A4700 -> TPS7A20,  TPS7A4700 -> TPS7A84,  TPS7A4901 -> TPS7A20
//
// Each reads perfectly and produces a complete, correct library for a chip
// nobody asked for. Nothing downstream can tell.

test("a datasheet for a different part in the same family is refused", () => {
  // The real front matter of the document that was cached as TPS7A4700.
  // Sized like the real thing, deliberately: the document that was cached as
  // TPS7A4700 is 48 pages of genuine TI datasheet. A toy fixture would be caught
  // by `looksLikeWrongDocument` on size alone and would prove nothing about the
  // case this function exists for.
  const body = "Electrical characteristics over operating free-air temperature range. ".repeat(40);
  const wrong = datasheetTextFromPages([
    "TPS7A20 www.ti.com SBVS338C - MARCH 2020 TPS7A20 300-mA, Ultra-Low-Noise, Low-IQ, High PSRR LDO",
    "Features Low output voltage noise " + body,
    ...Array.from({ length: 8 }, () => body)
  ]);
  assert.equal(namesThePart(wrong, "TPS7A4700"), false, "TPS7A is a shared PREFIX, not this part");
  assert.equal(namesThePart(wrong, "TPS7A4901"), false);
  // And it IS a real datasheet, so the size-based check cannot help here.
  assert.equal(looksLikeWrongDocument(wrong), false, "this is why a second check was needed");
});

test("the part's own datasheet is accepted", () => {
  const right = datasheetTextFromPages([
    "TPS7A4700 www.ti.com SBVS204 36-V, 1-A, 4.17-uVRMS, RF LDO Voltage Regulator",
    "Features"
  ]);
  assert.equal(namesThePart(right, "TPS7A4700"), true);
});

// THE HALF THAT KEEPS IT FROM BREAKING WORKING PARTS.
//
// Family datasheets are common and correct, and never write the full ordering
// number in their front matter. Refusing them would trade three broken parts for
// dozens.
test("a family datasheet naming the stem as its own token is accepted", () => {
  const family = datasheetTextFromPages([
    "L78 Datasheet Positive voltage regulator ICs Features Output current up to 1.5 A",
    "Output voltages of 5; 6; 8; 9; 12; 15; 18; 24 V"
  ]);
  assert.equal(namesThePart(family, "L7805"), true, "L78 stands alone and L7805 extends it");

  const connector = datasheetTextFromPages([
    "1.25mm Pitch Miniature Crimping Connector (UL Listed) DF13 Series Type Mounting Type",
    "Features"
  ]);
  assert.equal(namesThePart(connector, "DF13-4P-1.25DSA"), true, "DF13 stands alone");
});

// The distinction the whole rule turns on, stated directly.
test("a shared prefix is not a family stem", () => {
  const shared = datasheetTextFromPages(["TPS7A20 300-mA LDO", "Features"]);
  const standalone = datasheetTextFromPages(["TPS7A Series regulators", "Features"]);
  assert.equal(namesThePart(shared, "TPS7A4700"), false, "TPS7A inside TPS7A20 is not a token");
  assert.equal(namesThePart(standalone, "TPS7A4700"), true, "TPS7A as its own word is");
});

test("front matter only: a part named deep in a comparison table does not count", () => {
  const deep = datasheetTextFromPages([
    "TPS7A20 300-mA LDO",
    "Features",
    "Application note: see also TPS7A4700 for higher voltage"
  ]);
  assert.equal(namesThePart(deep, "TPS7A4700"), false, "page 3 is not front matter");
});

// PART NUMBERS THAT CARRY THEIR PACKAGE IN A PREFIX, BOTH DIRECTIONS.
//
// Reported 2026-09-10 as "it said it could not find the datasheet and then acted
// like it was reading one" for HS9-26CLV32RH-Q. The front matter below is the
// real Intersil document (FN4907.2), which prints both package variants of one
// device: HS1- is the SBDIP, HS9- the FLATPACK, and the screening level is a
// further -Q suffix. Three characters before the first hyphen, and the device
// identity after it.
//
// The stem rule reduced that to `HS9` and accepted anything sharing it. The
// requested part was accepted too, but for the same wrong reason, so both are
// asserted here: the second test is the one that fails without the fix, and the
// first pins down that closing the hole does not close the door on the part the
// user actually asked for.
const radHard = datasheetTextFromPages([
  "HS-26CLV32RH Radiation Hardened 3.3V Quad Differential Data Sheet May 28, 2009 FN4907.2 Line Receiver",
  "HS-26CLV32RH Pinouts HS1-26CLV32RH HS9-26CLV32RH (16 LD SBDIP) (16 LD FLATPACK)"
]);

test("a package-prefixed part number accepts its own datasheet", () => {
  assert.equal(namesThePart(radHard, "HS9-26CLV32RH-Q"), true, "the FLATPACK variant is printed here");
  assert.equal(namesThePart(radHard, "HS1-26CLV32RH-Q"), true, "so is the SBDIP one");
  assert.equal(namesThePart(radHard, "HS-26CLV32RH"), true, "and the base number the document is titled with");
});

test("a shared package prefix is not an identification", () => {
  // Each of these is a real, DIFFERENT device that happens to share the prefix.
  // `HS9` matched as a standalone token because the hyphen after it read as the
  // end of a word, so this document answered for all of them.
  assert.equal(namesThePart(radHard, "HS9-1840ARH"), false, "HS9 is a package code, not a family");
  assert.equal(namesThePart(radHard, "HS9-302RH-Q"), false);
  assert.equal(namesThePart(radHard, "HS1-26C31RH"), false, "same prefix, different receiver");
});

test("a part number too short to discriminate is never refused", () => {
  const anything = datasheetTextFromPages(["Some regulator", "Features"]);
  assert.equal(namesThePart(anything, "L7"), true, "too short to judge, so it does not judge");
});

// A RUN OF LETTERS IS NOT A FAMILY STEM.
//
// Reported 2026-09-10: typing `NOTAPART` returned a 30-page Microsoft trademark
// list, offered as that part's datasheet with a Read button beside it. The stem
// loop had shrunk the request to `NOT`, which stands alone in almost any
// document. `looksLikeWrongDocument` cannot help here - at 30 pages of real
// prose it is not a thin document, it simply is not a datasheet.
test("a stem that is an English word is not an identification", () => {
  const notADatasheet = datasheetTextFromPages([
    "Microsoft Trademarks List FY25 Q3. This list is not exhaustive and does not include all marks.",
    "Trademarks are not to be used without permission."
  ]);
  assert.equal(namesThePart(notADatasheet, "NOTAPART"), false, "NOT is a word, not a family");
  assert.equal(namesThePart(notADatasheet, "NOT-A-PART"), false, "and separators do not change that");
  assert.equal(namesThePart(notADatasheet, "NOTHING"), false);
  assert.equal(namesThePart(notADatasheet, "ANDGATE"), false, "AND reaches the same document");
  // And it is not the WORDS that are refused, it is the shape: the guard has no
  // list to be caught out by. A letters-only vendor prefix goes the same way.
  const ti = datasheetTextFromPages(["TPS Product Portfolio overview", "Features"]);
  assert.equal(namesThePart(ti, "TPSABCDEF"), false, "a letters-only head is a prefix, not an identity");
});

// The half that keeps the digit rule from refusing working parts: every family
// stem this loop exists for is alphanumeric, because part numbers are.
test("an alphanumeric family stem still passes the digit rule", () => {
  const family = datasheetTextFromPages(["L78 Datasheet Positive voltage regulator ICs", "Features"]);
  assert.equal(namesThePart(family, "L7805"), true, "L78 carries a digit and still stands alone");
  const connector = datasheetTextFromPages(["DF13 Series 1.25mm Pitch Crimping Connector", "Features"]);
  assert.equal(namesThePart(connector, "DF13-4P-1.25DSA"), true, "so does DF13");
});
