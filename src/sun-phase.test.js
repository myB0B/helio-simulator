import test from "node:test";
import assert from "node:assert/strict";
import { sunPhase } from "./sun-phase.js";

test("sun phase follows civil twilight thresholds", () => {
  assert.equal(sunPhase(42).id, "day");
  assert.equal(sunPhase(6).id, "day");
  assert.equal(sunPhase(5.9).id, "twilight");
  assert.equal(sunPhase(-5.9).id, "twilight");
  assert.equal(sunPhase(-6).id, "night");
});
