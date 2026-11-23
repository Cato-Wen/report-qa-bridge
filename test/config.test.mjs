import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.RQB_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "rqb-test-"));
const cfg = await import("../src/config.mjs");
const { buildServer, presetFor } = await import("../src/mcp.mjs");

test("user tokens: stored hashed, resolvable, rotatable", () => {
  cfg.ensureHome();
  const { token } = cfg.addUser("Bonnie");
  assert.equal(cfg.userByToken(token), "bonnie");
  assert.ok(!fs.readFileSync(cfg.PATHS.users, "utf8").includes(token), "plaintext token must not be stored");
  const { token: t2 } = cfg.addUser("bonnie", { rotate: true });
  assert.equal(cfg.userByToken(token), null);
  assert.equal(cfg.userByToken(t2), "bonnie");
  assert.throws(() => cfg.addUser("bonnie"));
  assert.throws(() => cfg.normalizeName("bad name!"));
});

test("report reader list", () => {
  assert.ok(cfg.userMayAsk({ users: ["*"] }, "anyone"));
  assert.ok(cfg.userMayAsk({}, "anyone"));
  assert.ok(cfg.userMayAsk({ users: ["felix"] }, "felix"));
  assert.ok(!cfg.userMayAsk({ users: ["felix"] }, "joel"));
});

test("mcp: mongodb forced read-only, others need a tool list", () => {
  const catalog = {
    "mongodb-prod": { config: { type: "stdio", command: "npx", args: ["-y", "mongodb-mcp-server", "--connectionString", "mongodb+srv://u:p@h/db"] } },
    atlassian: { config: { type: "http", url: "https://mcp.example.com/v1" } },
  };
  assert.equal(presetFor(catalog["mongodb-prod"].config), "mongodb");
  const m = buildServer({ name: "mongodb-prod" }, catalog);
  assert.ok(m.config.args.includes("--readOnly"));
  assert.throws(() => buildServer({ name: "atlassian" }, catalog), /read-only mode/);
  assert.deepEqual(buildServer({ name: "atlassian", tools: ["getJiraIssue"] }, catalog).policy.tools, ["getJiraIssue"]);
  assert.throws(() => buildServer({ name: "missing" }, catalog), /not found/);
});
