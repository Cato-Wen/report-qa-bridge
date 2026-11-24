// State lives outside the repo: ~/.report-qa-bridge (override with RQB_HOME).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

export const HOME = process.env.RQB_HOME || path.join(os.homedir(), ".report-qa-bridge");
export const PATHS = {
  defaults: path.join(HOME, "defaults.json"),
  users: path.join(HOME, "users.json"),
  reports: path.join(HOME, "reports"),
  threads: path.join(HOME, "threads.json"),
  logs: path.join(HOME, "logs"),
};

export function ensureHome() {
  fs.mkdirSync(PATHS.reports, { recursive: true });
  fs.mkdirSync(PATHS.logs, { recursive: true });
}

export function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
}

export function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, file);
}

export const hashToken = t => crypto.createHash("sha256").update(String(t)).digest("hex");

// ---------- defaults applied to newly registered reports ----------
export const loadDefaults = () => ({ mcp: [], skills: [], ...readJson(PATHS.defaults, {}) });
export const saveDefaults = d => writeJson(PATHS.defaults, d);

// ---------- users ----------
const NAME_RE = /^[a-z0-9][a-z0-9._-]{0,31}$/;
export function normalizeName(name) {
  const n = String(name || "").trim().toLowerCase();
  if (!NAME_RE.test(n)) throw new Error(`invalid user name "${name}" (use letters, digits, . _ -)`);
  return n;
}

export const loadUsers = () => readJson(PATHS.users, {});

export function addUser(name, { rotate = false } = {}) {
  const n = normalizeName(name);
  const users = loadUsers();
  if (users[n] && !rotate) throw new Error(`user "${n}" already exists (use "user rotate ${n}" to issue a new token)`);
  if (!users[n] && rotate) throw new Error(`user "${n}" does not exist`);
  const token = crypto.randomBytes(24).toString("hex");
  users[n] = { tokenHash: hashToken(token), createdAt: users[n]?.createdAt || new Date().toISOString(), rotatedAt: rotate ? new Date().toISOString() : undefined };
  writeJson(PATHS.users, users);
  return { name: n, token };
}

export function removeUser(name) {
  const n = normalizeName(name);
  const users = loadUsers();
  if (!users[n]) throw new Error(`user "${n}" does not exist`);
  delete users[n];
  writeJson(PATHS.users, users);
}

export function userByToken(token) {
  if (!token) return null;
  const given = Buffer.from(hashToken(token), "hex");
  for (const [name, u] of Object.entries(loadUsers())) {
    const want = Buffer.from(u.tokenHash, "hex");
    if (want.length === given.length && crypto.timingSafeEqual(want, given)) return name;
  }
  return null;
}

// ---------- reports ----------
const ID_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;
export function checkReportId(id) {
  if (!ID_RE.test(String(id || ""))) throw new Error(`invalid report id "${id}" (lowercase letters, digits, . _ -)`);
  return id;
}
const reportFile = id => path.join(PATHS.reports, `${checkReportId(id)}.json`);

export function listReports() {
  if (!fs.existsSync(PATHS.reports)) return [];
  return fs.readdirSync(PATHS.reports).filter(f => f.endsWith(".json")).map(f => readJson(path.join(PATHS.reports, f), null)).filter(Boolean);
}

export function loadReport(id) {
  const f = reportFile(id);
  if (!fs.existsSync(f)) return null;
  const r = readJson(f, null);
  if (r) r._mtime = fs.statSync(f).mtimeMs;
  return r;
}

export function saveReport(report) {
  const { _mtime, ...clean } = report;
  writeJson(reportFile(clean.id), clean);
}

export function removeReport(id) {
  fs.rmSync(reportFile(id), { force: true });
}

export function userMayAsk(report, user) {
  const allowed = report.users && report.users.length ? report.users : ["*"];
  return allowed.includes("*") || allowed.includes(user);
}
