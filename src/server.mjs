// HTTP server: auth (per-user token), per-user rate limit, global concurrency, threads, logs.
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { PATHS, ensureHome, readJson, writeJson, userByToken, loadReport, userMayAsk, listReports, loadUsers } from "./config.mjs";
import { Runtime, runClaude, sweepStaleRuntime } from "./runner.mjs";

export function startServer(opts) {
  const {
    host = "0.0.0.0", port = 8787, allowIps = [], concurrency = 2, perUserPerHour = 20,
    timeoutMs = 6 * 60 * 1000, model = "", claudeBin = "claude",
  } = opts;

  ensureHome();
  sweepStaleRuntime();
  const runtime = new Runtime();
  const cleanup = () => runtime.cleanup();
  process.on("exit", cleanup);
  for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => { cleanup(); process.exit(0); });

  // ---------- state ----------
  const threads = readJson(PATHS.threads, {}); // threadId -> { user, reportId, sessionId, updatedAt }
  const saveThreads = () => writeJson(PATHS.threads, threads);
  const hits = new Map(); // user -> [timestamps]
  const inFlight = new Set(); // users with a running question
  let running = 0;
  const waiters = [];
  const acquire = () => new Promise(r => { if (running < concurrency) { running++; r(); } else waiters.push(r); });
  const release = () => { const next = waiters.shift(); if (next) next(); else running--; };

  function log(entry) {
    const f = path.join(PATHS.logs, `${new Date().toISOString().slice(0, 10)}.jsonl`);
    fs.appendFileSync(f, JSON.stringify({ time: new Date().toISOString(), ...entry }) + "\n");
  }

  // ---------- http helpers ----------
  function send(res, status, body) {
    res.writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*", // reports are opened via file:// (Origin: null); auth is the bearer token
      "Access-Control-Allow-Headers": "Authorization, Content-Type",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Private-Network": "true",
    });
    res.end(JSON.stringify(body));
  }
  const clientIp = req => String(req.socket.remoteAddress || "").replace(/^::ffff:/, "");
  const ipAllowed = ip => ip === "127.0.0.1" || ip === "::1" || !allowIps.length || allowIps.includes(ip);
  const readBody = (req, limit = 16 * 1024) => new Promise((resolve, reject) => {
    let data = "";
    req.on("data", c => { data += c; if (data.length > limit) { reject(new Error("body too large")); req.destroy(); } });
    req.on("end", () => { try { resolve(JSON.parse(data || "{}")); } catch { reject(new Error("bad json")); } });
  });

  function buildPrompt({ question, quote, ref }) {
    const parts = [];
    if (ref) parts.push(`提问人当前查看的位置：${ref}`);
    if (quote) parts.push(`提问人选中的文字：\n<<<\n${quote}\n>>>`);
    parts.push(`提问人的问题：\n${question}`);
    return parts.join("\n\n");
  }

  // ---------- routes ----------
  const server = http.createServer(async (req, res) => {
    const ip = clientIp(req);
    if (!ipAllowed(ip)) { console.warn(`[deny-ip] ${ip}`); return send(res, 403, { error: "forbidden" }); }
    if (req.method === "OPTIONS") return send(res, 204, {});
    const url = new URL(req.url, "http://x");
    const user = userByToken((req.headers.authorization || "").replace(/^Bearer\s+/i, ""));
    if (!user) return send(res, 401, { error: "unauthorized" });

    if (req.method === "GET" && url.pathname === "/health") {
      const id = url.searchParams.get("report");
      let report = null;
      try { report = id ? loadReport(id) : null; } catch {}
      return send(res, 200, {
        ok: true, user,
        report: report ? { id: report.id, title: report.title, allowed: userMayAsk(report, user), session: report.session || null } : null,
      });
    }

    if (req.method === "POST" && url.pathname === "/ask") {
      let body;
      try { body = await readBody(req); } catch (e) { return send(res, 400, { error: e.message }); }
      const question = String(body.question || "").trim().slice(0, 2000);
      const quote = String(body.quote || "").trim().slice(0, 3000);
      const ref = String(body.ref || "").trim().slice(0, 120);
      if (!question) return send(res, 400, { error: "question is required" });

      let report;
      try { report = loadReport(String(body.reportId || "")); } catch { report = null; }
      if (!report) return send(res, 404, { error: "report not registered on this bridge" });
      if (!userMayAsk(report, user)) return send(res, 403, { error: "you are not on this report's reader list" });

      const now = Date.now();
      const h = (hits.get(user) || []).filter(t => now - t < 3600_000);
      if (h.length >= perUserPerHour) return send(res, 429, { error: `rate limit: ${perUserPerHour} questions per hour` });
      if (inFlight.has(user)) return send(res, 429, { error: "your previous question is still being answered" });
      h.push(now); hits.set(user, h);

      let threadId = String(body.threadId || "");
      const t = threads[threadId];
      const continuing = t && t.user === user && t.reportId === report.id;
      if (!continuing) threadId = crypto.randomUUID();
      const resumeId = continuing ? t.sessionId : (report.session || null);

      inFlight.add(user);
      await acquire();
      try {
        const prepared = runtime.prepare(report);
        const r = await runClaude({
          report, prepared, user, prompt: buildPrompt({ question, quote, ref }),
          resumeId, fork: !continuing, timeoutMs, model, claudeBin, env: runtime.env,
        });
        threads[threadId] = { user, reportId: report.id, sessionId: r.sessionId, updatedAt: new Date().toISOString() };
        saveThreads();
        log({ user, reportId: report.id, threadId, sessionId: r.sessionId, ref, quote, question, answer: r.answer, cost: r.cost, durationMs: r.durationMs });
        console.log(`[ask] ${user} @${report.id} ${question.slice(0, 50).replace(/\s+/g, " ")} → ${Math.round((r.durationMs || 0) / 1000)}s $${(r.cost || 0).toFixed(2)}`);
        return send(res, 200, { threadId, sessionId: r.sessionId, baseSession: report.session || null, answer: r.answer });
      } catch (e) {
        log({ user, reportId: report.id, threadId, ref, quote, question, error: e.message });
        console.error(`[ask] ${user} @${report.id} failed: ${e.message.slice(0, 200)}`);
        return send(res, 500, { error: "failed to answer, please try again later" });
      } finally {
        release();
        inFlight.delete(user);
      }
    }
    send(res, 404, { error: "not found" });
  });

  server.listen(port, host, () => {
    const lan = Object.entries(os.networkInterfaces()).flatMap(([name, addrs]) =>
      (addrs || []).filter(a => a.family === "IPv4" && !a.internal && !/WSL|vEthernet|WARP|docker|vmnet|virtual/i.test(name)).map(a => a.address));
    console.log(`report-qa-bridge listening on http://${host}:${port}`);
    if (host === "0.0.0.0") console.log(`  LAN address : ${lan.map(ip => `http://${ip}:${port}`).join("  ") || "(none found)"}`);
    else console.log(`  loopback only (--local) — put a tunnel in front of it, or drop --local for LAN access`);
    console.log(`  users       : ${Object.keys(loadUsers()).join(", ") || "(none — add with: rqb user add <name>)"}`);
    console.log(`  reports     : ${listReports().map(r => r.id).join(", ") || "(none — add with: rqb report add <html> --id <id>)"}`);
    console.log(`  allowed IPs : ${allowIps.length ? allowIps.join(", ") : "any (token required)"}`);
    console.log(`  limits      : ${concurrency} concurrent, ${perUserPerHour}/user/hour`);
    console.log(`  state       : ${PATHS.logs.replace(/logs$/, "")}`);
  });
  return server;
}
