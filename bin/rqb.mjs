#!/usr/bin/env node
// report-qa-bridge CLI. Run `rqb help` for usage.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import {
  HOME, PATHS, ensureHome, readJson, loadUsers, addUser, removeUser, normalizeName,
  listReports, loadReport, saveReport, removeReport, checkReportId,
} from "../src/config.mjs";
import { findCurrentSession, sessionExists } from "../src/sessions.mjs";
import { loadMcpCatalog, buildServer } from "../src/mcp.mjs";
import { resolveSkill } from "../src/skills.mjs";
import { injectFile } from "../src/inject.mjs";

const HELP = `report-qa-bridge (rqb) — let colleagues ask Claude about an HTML report you generated.

Server
  rqb serve [--local] [--port 8787] [--allow ip1,ip2] [--concurrency 2] [--per-user 20] [--model <m>]
      Default listens on the LAN (0.0.0.0). --local = 127.0.0.1 only (use with a tunnel).

Users (each person gets a personal token; only its hash is stored)
  rqb user add <name> [--out <file>]     issue a token (printed once, or appended to --out)
  rqb user rotate <name> [--out <file>]  issue a new token, the old one stops working
  rqb user remove <name>
  rqb user list

Reports
  rqb report add <html> --id <id> [options]   register a report and inject the ask widget into the HTML
  rqb report update <id> [options]            change settings (re-injects the widget if --html is known)
  rqb report list | show <id> | remove <id>
  rqb inject <html> --id <id>                 (re)inject the widget only
    options:
      --title <text>           shown in the panel (default: the HTML <title>)
      --session current|none|<session-id>
                               conversation the answers fork from (default: current = your latest
                               interactive Claude Code session in --cwd)
      --cwd <dir>              repo the answering process may read (default: git root of the HTML, else cwd)
      --mcp a,b                MCP servers to expose (MongoDB servers are forced read-only)
      --mcp-tools name=t1,t2   expose only these tools of a server (required for servers without a read-only preset)
      --skills a,b             skills to expose (copied into a private plugin; Bash-dependent skills won't work)
      --users a,b|*            who may ask (default: *)
      --prompt <text>          extra instructions for the answering model
      --lang zh|en             widget language (default: from <html lang>)

Other
  rqb stats [--days 7]        questions and cost per user / report
  rqb doctor                  check claude CLI, users, reports, MCP and skills
  State: ${HOME}`;

// ---------- arg parsing ----------
const argv = process.argv.slice(2);
const positional = [], flags = {};
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a.startsWith("--")) {
    const k = a.slice(2);
    const next = argv[i + 1];
    const v = next === undefined || next.startsWith("--") ? true : (i++, next);
    if (k === "mcp-tools") (flags[k] ||= []).push(v); else flags[k] = v;
  } else positional.push(a);
}
const list = v => (typeof v === "string" ? v.split(",").map(s => s.trim()).filter(Boolean) : []);
const die = msg => { console.error(`error: ${msg}`); process.exit(1); };

function gitRoot(dir) {
  try { return execFileSync("git", ["-C", dir, "rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim(); } catch { return null; }
}
const htmlTitle = file => (fs.readFileSync(file, "utf8").match(/<title>([^<]*)<\/title>/i) || [])[1]?.trim();
const htmlLang = file => ((fs.readFileSync(file, "utf8").match(/<html[^>]*\blang="([^"]+)"/i) || [])[1] || "").toLowerCase().startsWith("zh") ? "zh" : "en";

function applyOptions(report, { requireValid = true } = {}) {
  if (flags.title) report.title = flags.title;
  if (flags.cwd) report.cwd = path.resolve(flags.cwd);
  if (flags.prompt) report.prompt = flags.prompt;
  if (flags.lang) report.lang = flags.lang;
  if (flags.users) report.users = list(flags.users);
  if (flags.mcp !== undefined || flags["mcp-tools"]) {
    const names = new Set(list(flags.mcp));
    const tools = {};
    for (const spec of flags["mcp-tools"] || []) {
      const [name, t] = String(spec).split("=");
      tools[name] = list(t); names.add(name);
    }
    report.mcp = [...names].map(name => ({ name, ...(tools[name] ? { tools: tools[name] } : {}) }));
  }
  if (flags.skills !== undefined) report.skills = list(flags.skills);
  if (flags.session !== undefined || report.session === undefined) {
    const s = flags.session === undefined || flags.session === true ? "current" : flags.session;
    report.session = s === "none" ? null : s === "current" ? findCurrentSession(report.cwd) : s;
  }
  if (!requireValid) return report;
  // validate
  if (report.session && !sessionExists(report.cwd, report.session)) die(`session ${report.session} not found for ${report.cwd}`);
  const catalog = loadMcpCatalog(report.cwd);
  for (const spec of report.mcp || []) { try { buildServer(spec, catalog); } catch (e) { die(e.message); } }
  for (const s of report.skills || []) { try { resolveSkill(s, report.cwd); } catch (e) { die(e.message); } }
  const users = loadUsers();
  for (const u of report.users || []) if (u !== "*" && !users[u]) die(`user "${u}" does not exist (rqb user add ${u})`);
  return report;
}

function widgetCfg(report) { return { reportId: report.id, title: report.title, lang: report.lang }; }

function printReport(r) {
  console.log(`${r.id}  —  ${r.title || ""}`);
  console.log(`  html    : ${r.doc || "-"}`);
  console.log(`  cwd     : ${r.cwd}`);
  console.log(`  session : ${r.session || "(none — answers start without conversation context)"}`);
  console.log(`  mcp     : ${(r.mcp || []).map(m => m.tools ? `${m.name}[${m.tools.join("|")}]` : m.name).join(", ") || "-"}`);
  console.log(`  skills  : ${(r.skills || []).join(", ") || "-"}`);
  console.log(`  users   : ${(r.users && r.users.length ? r.users : ["*"]).join(", ")}`);
  if (r.prompt) console.log(`  prompt  : ${r.prompt.slice(0, 120)}`);
}

// ---------- commands ----------
ensureHome();
const [cmd, sub, arg] = positional;

switch (cmd) {
  case "serve": {
    const { startServer } = await import("../src/server.mjs");
    startServer({
      host: flags.local ? "127.0.0.1" : "0.0.0.0",
      port: Number(flags.port || 8787),
      allowIps: list(flags.allow),
      concurrency: Number(flags.concurrency || 2),
      perUserPerHour: Number(flags["per-user"] || 20),
      model: typeof flags.model === "string" ? flags.model : "",
    });
    break;
  }

  case "user": {
    if (sub === "list") {
      const users = loadUsers();
      Object.entries(users).forEach(([n, u]) => console.log(`${n.padEnd(16)} created ${u.createdAt.slice(0, 10)}${u.rotatedAt ? `, rotated ${u.rotatedAt.slice(0, 10)}` : ""}`));
      if (!Object.keys(users).length) console.log("(no users)");
    } else if (sub === "add" || sub === "rotate") {
      if (!arg) die(`usage: rqb user ${sub} <name>`);
      const names = list(arg);
      for (const n of names) {
        const { name, token } = addUser(n, { rotate: sub === "rotate" });
        if (typeof flags.out === "string") {
          fs.appendFileSync(flags.out, `${name}\t${token}\n`, { mode: 0o600 });
          console.log(`${sub === "add" ? "added" : "rotated"} ${name} (token written to ${flags.out})`);
        } else console.log(`${name}\t${token}`);
      }
    } else if (sub === "remove") {
      if (!arg) die("usage: rqb user remove <name>");
      removeUser(arg); console.log(`removed ${normalizeName(arg)}`);
    } else die("usage: rqb user add|rotate|remove|list");
    break;
  }

  case "report": {
    if (sub === "list") {
      const rs = listReports();
      rs.forEach(r => console.log(`${r.id.padEnd(28)} ${r.title || ""}`));
      if (!rs.length) console.log("(no reports)");
    } else if (sub === "show") {
      const r = loadReport(checkReportId(arg)); if (!r) die(`report "${arg}" not found`); printReport(r);
    } else if (sub === "remove") {
      removeReport(checkReportId(arg)); console.log(`removed ${arg} (the widget stays in the HTML but will show "not registered")`);
    } else if (sub === "add") {
      const html = arg && path.resolve(arg);
      if (!html || !fs.existsSync(html)) die("usage: rqb report add <html> --id <id> [options]");
      const id = checkReportId(flags.id || die("--id is required"));
      if (loadReport(id)) die(`report "${id}" already exists (use: rqb report update ${id} ...)`);
      const report = { id, doc: html, cwd: path.resolve(flags.cwd || gitRoot(path.dirname(html)) || process.cwd()), title: htmlTitle(html), lang: htmlLang(html), createdAt: new Date().toISOString() };
      applyOptions(report);
      saveReport(report);
      injectFile(html, widgetCfg(report));
      printReport(report);
      console.log(`\nwidget injected into ${html}`);
    } else if (sub === "update") {
      const r = loadReport(checkReportId(arg)); if (!r) die(`report "${arg}" not found`);
      if (flags.html) r.doc = path.resolve(flags.html);
      applyOptions(r);
      r.updatedAt = new Date().toISOString();
      saveReport(r);
      if (r.doc && fs.existsSync(r.doc)) injectFile(r.doc, widgetCfg(r));
      printReport(r);
    } else die("usage: rqb report add|update|list|show|remove");
    break;
  }

  case "inject": {
    const html = sub && path.resolve(sub);
    if (!html || !fs.existsSync(html)) die("usage: rqb inject <html> --id <id>");
    const r = loadReport(checkReportId(flags.id || die("--id is required")));
    if (!r) die(`report "${flags.id}" not registered (use: rqb report add)`);
    injectFile(html, widgetCfg(r));
    console.log(`widget injected into ${html}`);
    break;
  }

  case "stats": {
    const days = Number(flags.days || 7);
    const since = Date.now() - days * 86400_000;
    const files = fs.existsSync(PATHS.logs) ? fs.readdirSync(PATHS.logs).filter(f => f.endsWith(".jsonl")) : [];
    const agg = {};
    for (const f of files) for (const line of fs.readFileSync(path.join(PATHS.logs, f), "utf8").split("\n")) {
      if (!line.trim()) continue;
      let e; try { e = JSON.parse(line); } catch { continue; }
      if (Date.parse(e.time) < since) continue;
      const k = `${e.user}\t${e.reportId}`;
      const a = (agg[k] ||= { n: 0, err: 0, cost: 0 });
      a.n++; if (e.error) a.err++; a.cost += e.cost || 0;
    }
    console.log(`last ${days} days\nuser            report                        questions  errors  cost(USD)`);
    let total = 0;
    for (const [k, a] of Object.entries(agg).sort()) {
      const [u, r] = k.split("\t"); total += a.cost;
      console.log(`${u.padEnd(16)}${String(r).padEnd(30)}${String(a.n).padStart(9)}${String(a.err).padStart(8)}${a.cost.toFixed(2).padStart(11)}`);
    }
    console.log(`total cost: $${total.toFixed(2)}`);
    break;
  }

  case "doctor": {
    let ok = true;
    const check = (label, fn) => { try { const msg = fn(); console.log(`✓ ${label}${msg ? `: ${msg}` : ""}`); } catch (e) { ok = false; console.log(`✗ ${label}: ${e.message}`); } };
    check("claude CLI", () => execFileSync("claude", ["--version"], { encoding: "utf8" }).trim());
    check("state dir", () => HOME);
    check("users", () => { const n = Object.keys(loadUsers()); if (!n.length) throw new Error("none — rqb user add <name>"); return n.join(", "); });
    for (const r of listReports()) {
      check(`report ${r.id}`, () => {
        if (r.doc && !fs.existsSync(r.doc)) throw new Error(`html missing: ${r.doc}`);
        if (r.session && !sessionExists(r.cwd, r.session)) throw new Error(`session ${r.session} not found`);
        const catalog = loadMcpCatalog(r.cwd);
        (r.mcp || []).forEach(s => buildServer(s, catalog));
        (r.skills || []).forEach(s => resolveSkill(s, r.cwd));
        return `${(r.mcp || []).length} mcp, ${(r.skills || []).length} skills`;
      });
    }
    process.exit(ok ? 0 : 1);
  }

  default:
    console.log(HELP);
}
