#!/usr/bin/env node
// PreToolUse hook for the answering process. Exit 2 = block the tool call.
// Usage (set up by runner.mjs):  node guard.mjs <policy.json>
// Policy: { builtin: [...], skills: ["rqb:x"], mcp: { server: { preset, tools } }, denyPaths: [regex...] }
import fs from "node:fs";
import { MONGO_READ_OPS } from "./mcp.mjs";

export const DEFAULT_DENY_PATHS = [
  "(^|/)\\.env", "\\.pem$", "\\.key$", "\\.p12$", "\\.pfx$", "\\.jks$", "id_rsa", "secret", "credential",
  "(^|/)\\.claude(/|$)", "\\.claude\\.json$", "(^|/)\\.report-qa-bridge(/|$)", "\\.token$", "(^|/)\\.git/",
];

/** Pure decision function (exported for tests). Returns null to allow, or a reason string to block. */
export function decide(policy, tool, input = {}) {
  const text = JSON.stringify(input);
  const m = /^mcp__(.+?)__(.+)$/.exec(tool);
  if (m) {
    const [, server, op] = m;
    const s = policy.mcp?.[server];
    if (!s) return `MCP server "${server}" is not exposed for this report`;
    if (s.tools && !s.tools.includes(op)) return `MCP tool "${op}" is not exposed for this report`;
    if (s.preset === "mongodb") {
      if (!MONGO_READ_OPS.includes(op)) return `MongoDB tool "${op}" is not allowed (read-only)`;
      if (/["']\$(out|merge)["']/.test(text)) return "$out / $merge write stages are not allowed (read-only)";
      if (/\$where|\$function|\$accumulator/.test(text)) return "server-side JavaScript is not allowed";
    }
    return null;
  }
  if (tool === "Skill") {
    const name = String(input.skill || input.name || "");
    const ok = (policy.skills || []).some(s => s === name || s.split(":").pop() === name.split(":").pop());
    return ok ? null : `skill "${name}" is not exposed for this report`;
  }
  if (["Read", "Grep", "Glob"].includes(tool)) {
    const p = String(input.file_path || input.path || input.glob || "").replace(/\\/g, "/");
    for (const re of policy.denyPaths || DEFAULT_DENY_PATHS) if (new RegExp(re, "i").test(p)) return `path "${p}" is not allowed`;
    return (policy.builtin || []).includes(tool) ? null : `tool "${tool}" is not allowed`;
  }
  if (tool === "ToolSearch") return null;
  return `tool "${tool}" is not allowed (read-only Q&A)`;
}

// ---- hook entry point ----
if (process.argv[1] && process.argv[1].endsWith("guard.mjs")) {
  let raw = "";
  process.stdin.on("data", c => (raw += c));
  process.stdin.on("end", () => {
    try {
      const policy = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
      const evt = JSON.parse(raw || "{}");
      const reason = decide(policy, String(evt.tool_name || ""), evt.tool_input || {});
      if (reason) { process.stderr.write(`report-qa-bridge guard: ${reason}\n`); process.exit(2); }
      process.exit(0);
    } catch (e) {
      process.stderr.write(`report-qa-bridge guard: ${e.message}\n`);
      process.exit(2); // fail closed
    }
  });
}
