import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { sweepStaleRuntime, RUNTIME_PREFIX } from "../src/runner.mjs";

test("sweep keeps dirs of live bridges, removes dead / unowned ones", () => {
  // isolated base dir: never touch the real temp dir (a running bridge lives there)
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "rqb-sweeptest-"));
  const mk = (pid) => {
    const d = fs.mkdtempSync(path.join(base, RUNTIME_PREFIX));
    if (pid !== undefined) fs.writeFileSync(path.join(d, "owner.pid"), String(pid));
    return d;
  };
  const live = mk(process.ppid);      // parent process is alive
  const dead = mk(2147480000);         // no such process
  const unowned = mk();                // pre-fix leftover without pid file
  sweepStaleRuntime(base);
  assert.ok(fs.existsSync(live), "live bridge dir must survive");
  assert.ok(!fs.existsSync(dead), "dead bridge dir must be removed");
  assert.ok(!fs.existsSync(unowned), "unowned dir must be removed");
  fs.rmSync(base, { recursive: true, force: true });
});
