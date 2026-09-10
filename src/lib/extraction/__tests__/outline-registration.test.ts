import { test } from "node:test";
import assert from "node:assert/strict";
import { FIELD_GUIDE } from "../models/prompt";

// HERMETIC MILITARY PACKAGES ARE REGISTERED UNDER MIL-STD-1835, NOT JEDEC.
//
// Found 2026-09-10 reading HS9-26CLV32RH-Q. Its datasheet prints
// `MIL-STD-1835: CDFP4-F16` on the pinout page and dimensions NOTHING, so the
// registration is the only route to a body size. The field asked for JEDEC
// registrations only, the model correctly answered null, and Forge went on to
// ask the user to type a body length the named drawing already defines.
//
// This asserts the ASK, which is all that can be checked without a model call.
// That the model then finds it is a separate, paid question.
test("the outline registration field asks for MIL-STD-1835, not only JEDEC", () => {
  const guide = FIELD_GUIDE.jedecOutline;
  assert.match(guide, /MIL-STD-1835/, "rad-hard and hermetic mil packages cite this register");
  assert.match(guide, /JEDEC/, "and the commercial case has not been dropped to make room");
  // The printed form is what the model has to recognise on the page.
  assert.match(guide, /CDFP4-F16|CDIP2-T16/, "an example of the code as it is printed");
});

// The registration belongs to ONE package, and these documents routinely
// describe two. HS1- is the SBDIP (CDIP2-T16) and HS9- the FLATPACK
// (CDFP4-F16): reporting either for both would put a 16-lead dual-inline
// outline on a flatpack.
test("the outline registration is scoped to the package that was reported", () => {
  assert.match(FIELD_GUIDE.jedecOutline, /packageType/, "says which package to answer for");
});
