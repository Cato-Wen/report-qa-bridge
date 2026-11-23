// Resolve the author's MCP servers and turn them into a read-only config for the answering process.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readJson } from "./config.mjs";

const norm = p => path.resolve(p).replace(/\\/g, "/").toLowerCase();

/** name -> { config, source } from ~/.claude.json (user + this project's local scope) and <cwd>/.mcp.json */
export function loadMcpCatalog(cwd) {
  const out = {};
  const user = readJson(path.join(os.homedir(), ".claude.json"), {});
  for (const [k, v] of Object.entries(user.mcpServers || {})) out[k] = { config: v, source: "user" };
  for (const [proj, v] of Object.entries(user.projects || {})) {
    if (norm(proj) === norm(cwd)) for (const [k, c] of Object.entries(v.mcpServers || {})) out[k] = { config: c, source: "local" };
  }
  const projFile = path.join(cwd, ".mcp.json");
  if (fs.existsSync(projFile)) {
    for (const [k, v] of Object.entries(readJson(projFile, {}).mcpServers || {})) out[k] = { config: v, source: "project" };
  }
  return out;
}

/** Known servers that have a reliable read-only mode. */
export function presetFor(config) {
  const blob = [config.command, ...(config.args || []), config.url].filter(Boolean).join(" ");
  if (/mongodb-mcp-server/i.test(blob)) return "mongodb";
  return null;
}

export const MONGO_READ_OPS = [
  "connect", "list-connections", "list-databases", "list-collections", "collection-schema",
  "collection-indexes", "collection-storage-size", "db-stats", "count", "find", "aggregate",
  "aggregate-db", "explain", "mongodb-logs", "list-knowledge-sources", "search-knowledge",
];

/**
 * spec: { name, tools?: string[], allowAll?: boolean }
 * returns { config, policy: { preset, tools } }
 * Servers without a preset must list the exact tools to expose (safe by default).
 */
export function buildServer(spec, catalog) {
  const entry = catalog[spec.name];
  if (!entry) throw new Error(`MCP server "${spec.name}" not found (looked in ~/.claude.json and .mcp.json)`);
  const preset = presetFor(entry.config);
  const config = JSON.parse(JSON.stringify(entry.config));
  if (preset === "mongodb") {
    config.args = [...(config.args || []).filter(a => a !== "--readOnly"), "--readOnly", "--disabledTools", "export"];
    return { config, policy: { preset, tools: spec.tools?.length ? spec.tools : null } };
  }
  if (!spec.tools?.length && !spec.allowAll) {
    throw new Error(`MCP server "${spec.name}" has no built-in read-only mode; list the tools to expose, e.g. --mcp-tools ${spec.name}=toolA,toolB`);
  }
  return { config, policy: { preset: null, tools: spec.tools?.length ? spec.tools : null } };
}
