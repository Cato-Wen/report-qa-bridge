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
  if (/toolbox/i.test(blob) && /--prebuilt[\s=]+bigquery/i.test(blob)) return "bigquery";
  return null;
}

// Google MCP Toolbox (prebuilt bigquery) has no read-only switch: expose metadata tools + execute_sql,
// and let the guard allow only single SELECT/WITH statements. forecast / analyze_contribution create
// BigQuery ML models and ask_data_insights calls an external agent, so they stay off.
export const BIGQUERY_READ_TOOLS = ["list_dataset_ids", "list_table_ids", "get_dataset_info", "get_table_info", "search_catalog", "execute_sql"];

const SQL_FORBIDDEN = /\b(insert|update|delete|merge|create|drop|alter|truncate|grant|revoke|call|export|load|execute|declare|set|begin|commit|rollback|undrop)\b/i;

/** null = allowed; otherwise the reason. Fails closed on anything that is not one plain query. */
export function checkReadOnlySql(sql) {
  if (typeof sql !== "string" || !sql.trim()) return "empty SQL";
  const s = sql
    .replace(/--[^\n]*|#[^\n]*/g, " ")            // line comments
    .replace(/\/\*[\s\S]*?\*\//g, " ")             // block comments
    .replace(/'''[\s\S]*?'''|"""[\s\S]*?"""/g, "''") // triple-quoted strings
    .replace(/'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"/g, "''") // string literals
    .trim();
  if (!/^\(*\s*(select|with)\b/i.test(s)) return "only SELECT / WITH queries are allowed (read-only)";
  if (/;\s*\S/.test(s)) return "only a single statement is allowed";
  const m = SQL_FORBIDDEN.exec(s);
  if (m) return `"${m[1].toUpperCase()}" is not allowed (read-only)`;
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
  if (preset === "bigquery") {
    const tools = spec.tools?.length ? spec.tools.filter(t => BIGQUERY_READ_TOOLS.includes(t)) : BIGQUERY_READ_TOOLS;
    const extra = (spec.tools || []).filter(t => !BIGQUERY_READ_TOOLS.includes(t));
    if (extra.length) throw new Error(`BigQuery tools not allowed in read-only mode: ${extra.join(", ")}`);
    return { config, policy: { preset, tools } };
  }
  if (!spec.tools?.length && !spec.allowAll) {
    throw new Error(`MCP server "${spec.name}" has no built-in read-only mode; list the tools to expose, e.g. --mcp-tools ${spec.name}=toolA,toolB`);
  }
  return { config, policy: { preset: null, tools: spec.tools?.length ? spec.tools : null } };
}
