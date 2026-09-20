import test from "node:test";
import assert from "node:assert/strict";
import { contrastingTextColor } from "./color.js";

test("color buttons use a contrasting text color", () => {
  assert.equal(contrastingTextColor("#9b3e35"), "#fff8e7");
  assert.equal(contrastingTextColor("#465b73"), "#fff8e7");
  assert.equal(contrastingTextColor("#cdd4d2"), "#173b2d");
});
