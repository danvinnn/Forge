import { test } from "node:test";
import assert from "node:assert/strict";
import { parseAsy } from "../asy";

test("the LTspice preview parses Forge lines and ordered pins", () => {
  const drawing = parseAsy([
    "Version 4",
    "LINE Normal -32 -48 32 0",
    "RECTANGLE Normal -16 -16 16 16",
    "PIN -32 -32 LEFT 8",
    "PINATTR PinName IN+",
    "PINATTR SpiceOrder 1"
  ].join("\n"));
  assert.deepEqual(drawing.lines[0], { x1: -32, y1: -48, x2: 32, y2: 0 });
  assert.deepEqual(drawing.rectangles[0], { x1: -16, y1: -16, x2: 16, y2: 16 });
  assert.deepEqual(drawing.pins[0], { x: -32, y: -32, side: "LEFT", name: "IN+", order: 1 });
  assert.ok(drawing.viewBox.width > 64);
});
