import test from "node:test";
import assert from "node:assert/strict";
import { decide } from "../src/guard.mjs";

const policy = {
  builtin: ["Read", "Grep", "Glob"],
  skills: ["rqb:wonder-cookbook"],
  mcp: {
    "mongodb-prod": { preset: "mongodb", tools: null },
    atlassian: { preset: null, tools: ["getJiraIssue"] },
  },
};
const allow = (tool, input) => assert.equal(decide(policy, tool, input), null, `${tool} should be allowed`);
const block = (tool, input) => assert.notEqual(decide(policy, tool, input), null, `${tool} should be blocked`);

test("mongodb: read tools allowed", () => {
  allow("mcp__mongodb-prod__find", { collection: "item_versions", limit: 5 });
  allow("mcp__mongodb-prod__count", {});
  allow("mcp__mongodb-prod__aggregate", { pipeline: [{ $match: {} }, { $group: { _id: "$x" } }] });
});

test("mongodb: write tools and write stages blocked", () => {
  block("mcp__mongodb-prod__delete-many", {});
  block("mcp__mongodb-prod__update-many", {});
  block("mcp__mongodb-prod__drop-collection", {});
  block("mcp__mongodb-prod__insert-many", {});
  block("mcp__mongodb-prod__aggregate", { pipeline: [{ $match: {} }, { $out: "x" }] });
  block("mcp__mongodb-prod__aggregate", { pipeline: [{ $merge: { into: "x" } }] });
  block("mcp__mongodb-prod__find", { filter: { $where: "sleep(1000)" } });
});

test("non-preset MCP: only listed tools", () => {
  allow("mcp__atlassian__getJiraIssue", {});
  block("mcp__atlassian__editJiraIssue", {});
  block("mcp__mongodb-qa__find", {}); // server not exposed
});

test("skills: only selected", () => {
  allow("Skill", { skill: "rqb:wonder-cookbook" });
  allow("Skill", { skill: "wonder-cookbook" });
  block("Skill", { skill: "code-review" });
  block("Skill", { skill: "update-config" });
});

test("files: secrets blocked, code allowed", () => {
  allow("Read", { file_path: "D:/repo/backend/src/Foo.java" });
  allow("Grep", { pattern: "DRAFT", path: "D:/repo/backend" });
  block("Read", { file_path: "C:/Users/x/.claude.json" });
  block("Read", { file_path: "D:/repo/.env.local" });
  block("Read", { file_path: "C:\\Users\\x\\.report-qa-bridge\\users.json" });
  block("Glob", { path: "D:/repo/.git/config" });
});

test("everything else blocked", () => {
  for (const t of ["Bash", "PowerShell", "Edit", "Write", "WebFetch", "Agent", "NotebookEdit"]) block(t, {});
});
