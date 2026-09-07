import { test } from "node:test";
import assert from "node:assert/strict";
import { runNgspice } from "../verify";

test("a simulator process that never exits is killed at the verification boundary", async () => {
  const started = Date.now();
  const result = await runNgspice("unused.cir", {
    executable: process.execPath,
    args: ["-e", "setInterval(() => {}, 1000)"],
    timeoutMs: 50
  });

  assert.equal(result.ok, false);
  assert.equal(result.failure, "timeout");
  assert.ok(Date.now() - started < 2_000, "a stuck simulator cannot hold a route or CI job open");
});

test("a simulator rejection is distinct from a missing executable", async () => {
  const rejected = await runNgspice("unused.cir", {
    executable: process.execPath,
    args: ["-e", "process.exit(7)"],
    timeoutMs: 1_000
  });
  const missing = await runNgspice("unused.cir", {
    executable: `forge-simulator-that-does-not-exist-${process.pid}`,
    timeoutMs: 1_000
  });

  assert.equal(rejected.failure, "rejected");
  assert.equal(missing.failure, "missing");
});
